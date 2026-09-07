import type {
  AssignmentData,
  Collection,
  CurrentLevelProgress,
  CurrentLevelProgressItem,
  Resource,
  ReviewCreatePayload,
  ReviewCreateResponse,
  SummaryReport,
  StudyMaterialData,
  SubjectData,
  SubjectType,
  UserData,
} from "./types";

const API_BASE = "https://api.wanikani.com/v2";
const REVISION = "20170710";
const MAX_IDS_PER_REQUEST = 500;
const MAX_SUBJECT_IDS_PER_REQUEST = 1000;
const MAX_CONCURRENT_REQUESTS = 4;
const MIN_REQUEST_INTERVAL_MS = 0;
const SUBJECT_CACHE_KEY = "wanikani-review-subject-cache-v1";
const STUDY_MATERIAL_CACHE_KEY = "wanikani-review-study-material-cache-v1";
const PASSING_SRS_STAGE = 5;
const REVIEW_INTERVALS_BY_STAGE: Record<number, number> = {
  1: 14_400_000,
  2: 28_800_000,
  3: 82_800_000,
  4: 169_200_000,
};

type Fetcher = typeof fetch;
const defaultFetcher: Fetcher = (input, init) => globalThis.fetch(input, init);

export class WaniKaniError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WaniKaniError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof TypeError && error.message.toLocaleLowerCase().includes("fetch")) {
    return `${error.message}. Check your internet connection, API token permissions, or whether the browser blocked the request.`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export class WaniKaniClient {
  private lastRequestAt = 0;
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = defaultFetcher,
    private readonly minRequestIntervalMs = MIN_REQUEST_INTERVAL_MS,
    private readonly maxConcurrentRequests = MAX_CONCURRENT_REQUESTS,
  ) {}

  async getUser(): Promise<Resource<UserData, "user">> {
    return this.request<Resource<UserData, "user">>("/user");
  }

  async getSummary(): Promise<SummaryReport> {
    return this.request<SummaryReport>("/summary");
  }

  async getDueAssignments(): Promise<Array<Resource<AssignmentData, "assignment">>> {
    const assignments = await this.requestCollection<Resource<AssignmentData, "assignment">>(
      "/assignments?immediately_available_for_review",
    );

    return assignments.filter((assignment) => !assignment.data.hidden);
  }

  async getCurrentLevelProgress(level: number): Promise<CurrentLevelProgress> {
    const params = new URLSearchParams({
      levels: String(level),
      subject_types: "radical,kanji",
    });
    const subjectParams = new URLSearchParams({
      levels: String(level),
      types: "radical,kanji",
    });
    const [assignments, levelSubjects] = await Promise.all([
      this.requestCollection<Resource<AssignmentData, "assignment">>(
      `/assignments?${params.toString()}`,
      ),
      this.requestCollection<Resource<SubjectData, SubjectType>>(`/subjects?${subjectParams.toString()}`),
    ]);
    const visibleAssignments = assignments.filter((assignment) => !assignment.data.hidden);
    const levelSubjectById = new Map(levelSubjects.map((subject) => [subject.id, subject]));

    return buildCurrentLevelProgress(level, visibleAssignments, levelSubjects, levelSubjectById);
  }

  async getLevelSubjects(level: number): Promise<Array<Resource<SubjectData, SubjectType>>> {
    const params = new URLSearchParams({
      levels: String(level),
      types: "radical,kanji",
    });

    return this.requestCollection<Resource<SubjectData, SubjectType>>(`/subjects?${params.toString()}`);
  }

  async getAssignments(subjectIds: number[]): Promise<Array<Resource<AssignmentData, "assignment">>> {
    return this.requestChunkedCollection<Resource<AssignmentData, "assignment">>("/assignments", "subject_ids", subjectIds);
  }

  async getSubjects(subjectIds: number[]): Promise<Array<Resource<SubjectData, SubjectType>>> {
    return this.requestChunkedCollection<Resource<SubjectData, SubjectType>>(
      "/subjects",
      "ids",
      subjectIds,
      MAX_SUBJECT_IDS_PER_REQUEST,
    );
  }

  async getStudyMaterials(subjectIds: number[]): Promise<Array<Resource<StudyMaterialData, "study_material">>> {
    return this.requestChunkedCollection<Resource<StudyMaterialData, "study_material">>(
      "/study_materials",
      "subject_ids",
      subjectIds,
    );
  }

  async createReview(review: ReviewCreatePayload): Promise<ReviewCreateResponse> {
    return this.request<ReviewCreateResponse>("/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ review }),
    });
  }

  async loadDueReviewItems(): Promise<{
    currentLevel: number;
    currentLevelProgress: CurrentLevelProgress;
    username: string;
    items: Array<{
      assignment: Resource<AssignmentData, "assignment">;
      subject: Resource<SubjectData, SubjectType>;
      components?: Array<Resource<SubjectData, SubjectType>>;
      examples?: Array<Resource<SubjectData, SubjectType>>;
      studyMaterial?: Resource<StudyMaterialData, "study_material">;
    }>;
  }> {
    const user = await this.getUser();
    const [assignments, currentLevelProgress] = await Promise.all([
      this.getDueAssignments(),
      this.getCurrentLevelProgress(user.data.level),
    ]);
    const uniqueSubjectIds = [...new Set(assignments.map((assignment) => assignment.data.subject_id))];
    if (uniqueSubjectIds.length === 0) {
      return {
        currentLevel: user.data.level,
        currentLevelProgress,
        username: user.data.username,
        items: [],
      };
    }

    const [subjects, studyMaterialsResult] = await Promise.all([
      this.getCachedSubjects(uniqueSubjectIds),
      this.getCachedStudyMaterials(uniqueSubjectIds).then(
        (studyMaterials) => ({ ok: true as const, studyMaterials }),
        (error) => ({ ok: false as const, error }),
      ),
    ]);
    const componentSubjectIds = subjects.flatMap((subject) => subject.data.component_subject_ids ?? []);
    const components = componentSubjectIds.length > 0 ? await this.getCachedSubjects(componentSubjectIds) : [];
    const exampleSubjectIds = subjects
      .filter((subject) => subject.object === "kanji")
      .flatMap((subject) => subject.data.amalgamation_subject_ids ?? [])
      .slice(0, uniqueSubjectIds.length * 5);
    const examples = exampleSubjectIds.length > 0 ? await this.getCachedSubjects(exampleSubjectIds) : [];

    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const componentById = new Map(components.map((subject) => [subject.id, subject]));
    const exampleById = new Map(examples.map((subject) => [subject.id, subject]));
    const studyMaterials = studyMaterialsResult.ok ? studyMaterialsResult.studyMaterials : [];
    const studyMaterialBySubjectId = new Map(studyMaterials.map((material) => [material.data.subject_id, material]));

    return {
      currentLevel: user.data.level,
      currentLevelProgress,
      username: user.data.username,
      items: assignments.flatMap((assignment) => {
        const subject = subjectById.get(assignment.data.subject_id);
        if (!subject) return [];
        return [
          {
            assignment,
            subject,
            components: (subject.data.component_subject_ids ?? []).flatMap((componentId) => {
              const component = componentById.get(componentId);
              return component ? [component] : [];
            }),
            examples: (subject.data.amalgamation_subject_ids ?? []).flatMap((exampleId) => {
              const example = exampleById.get(exampleId);
              return example ? [example] : [];
            }),
            studyMaterial: studyMaterialBySubjectId.get(assignment.data.subject_id),
          },
        ];
      }),
    };
  }

  private async requestChunkedCollection<T>(
    path: string,
    paramName: string,
    ids: number[],
    chunkSize = MAX_IDS_PER_REQUEST,
  ): Promise<T[]> {
    const uniqueIds = [...new Set(ids)];
    const chunks = chunk(uniqueIds, chunkSize);
    const pages = await Promise.all(
      chunks.map((idChunk) => {
        const params = new URLSearchParams({ [paramName]: idChunk.join(",") });
        return this.requestCollection<T>(`${path}?${params.toString()}`);
      }),
    );

    return pages.flat();
  }

  private async requestCollection<T>(pathOrUrl: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = pathOrUrl;

    while (nextUrl) {
      const collection: Collection<T> = await this.request<Collection<T>>(nextUrl);
      results.push(...collection.data);
      nextUrl = collection.pages.next_url;
    }

    return results;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    await this.acquireSlot();
    let retryAfterMs: number | null = null;
    try {
      await this.waitForRateLimit();
      const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
      const response = await this.fetcher(url, {
        ...init,
        headers: mergeHeaders(
          {
            "Wanikani-Revision": REVISION,
            Authorization: `Bearer ${this.token}`,
          },
          init.headers,
        ),
      });

      if (response.status === 429) {
        const resetAt = response.headers.get("RateLimit-Reset");
        if (resetAt && attempt < 1) {
          retryAfterMs = Math.max(0, Number(resetAt) * 1000 - Date.now());
        } else {
          const resetMessage = resetAt
            ? ` Try again after ${new Date(Number(resetAt) * 1000).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}.`
            : "";
          throw new WaniKaniError(`WaniKani rate limit exceeded.${resetMessage}`, response.status);
        }
      } else if (!response.ok) {
        let message = `WaniKani request failed with HTTP ${response.status}.`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the generic HTTP error.
        }
        throw new WaniKaniError(message, response.status);
      } else {
        return response.json() as Promise<T>;
      }
    } finally {
      this.releaseSlot();
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, retryAfterMs ?? 0));
    return this.request<T>(pathOrUrl, init, attempt + 1);
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minRequestIntervalMs) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, this.minRequestIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private async acquireSlot(): Promise<void> {
    while (this.inFlight >= this.maxConcurrentRequests) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += 1;
  }

  private releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async getCachedSubjects(subjectIds: number[]): Promise<Array<Resource<SubjectData, SubjectType>>> {
    const cache = readResourceCache<Resource<SubjectData, SubjectType>>(SUBJECT_CACHE_KEY);
    const cached = subjectIds.flatMap((id) => {
      const resource = cache.records[id];
      return resource ? [resource] : [];
    });
    const missingIds = subjectIds.filter((id) => !cache.records[id]);

    if (missingIds.length === 0) return cached;

    const fetched = await this.getSubjects(missingIds);
    writeResourceCache(SUBJECT_CACHE_KEY, mergeCacheRecords(cache.records, fetched));
    return [...cached, ...fetched];
  }

  private async getCachedStudyMaterials(subjectIds: number[]): Promise<Array<Resource<StudyMaterialData, "study_material">>> {
    const cache = readResourceCache<Resource<StudyMaterialData, "study_material">>(STUDY_MATERIAL_CACHE_KEY);
    let records = cache.records;

    if (cache.cachedAt > 0) {
      const updated = await this.requestCollection<Resource<StudyMaterialData, "study_material">>(
        `/study_materials?updated_after=${encodeURIComponent(new Date(cache.cachedAt).toISOString())}`,
      );
      records = {
        ...records,
        ...Object.fromEntries(updated.map((resource) => [resource.data.subject_id, resource])),
      };
    }

    const cached = subjectIds.flatMap((id) => {
      const resource = records[id];
      return resource ? [resource] : [];
    });
    const missingIds = subjectIds.filter((id) => !records[id]);

    if (missingIds.length === 0) {
      writeResourceCache(STUDY_MATERIAL_CACHE_KEY, records);
      return cached;
    }

    const fetched = await this.getStudyMaterials(missingIds);
    const nextRecords = {
      ...records,
      ...Object.fromEntries(fetched.map((resource) => [resource.data.subject_id, resource])),
    };
    writeResourceCache(STUDY_MATERIAL_CACHE_KEY, nextRecords);
    return [...cached, ...fetched];
  }
}

function buildCurrentLevelProgress(
  level: number,
  assignments: Array<Resource<AssignmentData, "assignment">>,
  subjects: Array<Resource<SubjectData, SubjectType>>,
  subjectById: Map<number, Resource<SubjectData, SubjectType>>,
): CurrentLevelProgress {
  const assignmentBySubjectId = new Map(assignments.map((assignment) => [assignment.data.subject_id, assignment]));
  const radicals = buildCurrentLevelProgressGroup(subjects, assignmentBySubjectId, "radical");
  const kanji = buildCurrentLevelProgressGroup(subjects, assignmentBySubjectId, "kanji");
  const kanjiRequiredForLevelUp = Math.ceil(kanji.total * 0.9);
  const now = new Date();
  const radicalPassTimesBySubjectId = buildRadicalPassTimes(subjects, assignmentBySubjectId, now);
  const notGuruItems = buildNotGuruItems(subjects, assignmentBySubjectId, subjectById, radicalPassTimesBySubjectId, now);

  return {
    level,
    kanjiRequiredForLevelUp,
    kanjiRemainingForLevelUp: Math.max(0, kanjiRequiredForLevelUp - kanji.passed),
    fastestLevelUpAt: estimateFastestLevelUpAt(subjects, assignmentBySubjectId, notGuruItems, kanjiRequiredForLevelUp, now),
    radicals,
    kanji,
    notGuruItems,
  };
}

function buildCurrentLevelProgressGroup(
  subjects: Array<Resource<SubjectData, SubjectType>>,
  assignmentBySubjectId: Map<number, Resource<AssignmentData, "assignment">>,
  subjectType: "radical" | "kanji",
) {
  const matchingSubjects = subjects.filter((subject) => subject.object === subjectType);
  const remainingAssignments = matchingSubjects
    .map((subject) => assignmentBySubjectId.get(subject.id))
    .filter((assignment): assignment is Resource<AssignmentData, "assignment"> => Boolean(assignment && !isPassed(assignment)));

  return {
    total: matchingSubjects.length,
    passed: matchingSubjects.filter((subject) => {
      const assignment = assignmentBySubjectId.get(subject.id);
      return assignment ? isPassed(assignment) : false;
    }).length,
    remaining: matchingSubjects.filter((subject) => !isPassed(assignmentBySubjectId.get(subject.id))).length,
    nextAvailableAt: getEarliestAvailableAt(remainingAssignments),
  };
}

function isPassed(assignment: Resource<AssignmentData, "assignment"> | undefined): boolean {
  return Boolean(assignment?.data.passed || assignment?.data.passed_at);
}

function buildNotGuruItems(
  subjects: Array<Resource<SubjectData, SubjectType>>,
  assignmentBySubjectId: Map<number, Resource<AssignmentData, "assignment">>,
  subjectById: Map<number, Resource<SubjectData, SubjectType>>,
  radicalPassTimesBySubjectId: Map<number, number>,
  now: Date,
): CurrentLevelProgressItem[] {
  return subjects
    .flatMap((subject) => {
      if (subject.object !== "radical" && subject.object !== "kanji") return [];
      const assignment = assignmentBySubjectId.get(subject.id);
      if (isPassed(assignment)) return [];
      const currentSubject = subjectById.get(subject.id);
      if (!currentSubject) return [];

      const blockedByRadicals =
        subject.object === "kanji" && !assignment
          ? (subject.data.component_subject_ids ?? [])
              .flatMap((componentId) => {
                const radical = subjectById.get(componentId);
                if (!radical || radical.object !== "radical") return [];
                const radicalAssignment = assignmentBySubjectId.get(componentId);
                if (isPassed(radicalAssignment)) return [];
                const fastestGuruAt = radicalPassTimesBySubjectId.get(componentId);
                return [
                  {
                    subjectId: radical.id,
                    characters: radical.data.characters,
                    slug: radical.data.slug,
                    srsStage: radicalAssignment?.data.srs_stage ?? 0,
                    fastestGuruAt: fastestGuruAt ? new Date(fastestGuruAt).toISOString() : null,
                  },
                ];
              })
              .sort((left, right) => left.srsStage - right.srsStage || compareNullableDates(left.fastestGuruAt, right.fastestGuruAt))
          : [];

      const unlockAt = blockedByRadicals.length
        ? Math.max(
            now.getTime(),
            ...blockedByRadicals.map((radical) =>
              radical.fastestGuruAt ? Date.parse(radical.fastestGuruAt) : now.getTime(),
            ),
          )
        : now.getTime();

      return [
        {
          assignmentId: assignment?.id ?? null,
          subjectId: subject.id,
          subjectType: subject.object,
          characters: currentSubject.data.characters,
          slug: currentSubject.data.slug,
          srsStage: assignment?.data.srs_stage ?? 0,
          availableAt: assignment?.data.available_at ?? null,
          fastestGuruAt: new Date(estimateAssignmentPassTime(assignment, unlockAt)).toISOString(),
          blockedByRadicals,
        },
      ];
    })
    .sort(compareCurrentLevelProgressItems);
}

function estimateFastestLevelUpAt(
  subjects: Array<Resource<SubjectData, SubjectType>>,
  assignmentBySubjectId: Map<number, Resource<AssignmentData, "assignment">>,
  notGuruItems: CurrentLevelProgressItem[],
  kanjiRequiredForLevelUp: number,
  now: Date,
): string | null {
  const passedKanjiCount = subjects.filter((subject) => {
    const assignment = assignmentBySubjectId.get(subject.id);
    return subject.object === "kanji" && isPassed(assignment);
  }).length;
  const neededKanjiCount = Math.max(0, kanjiRequiredForLevelUp - passedKanjiCount);
  if (neededKanjiCount === 0) return now.toISOString();

  const kanjiPassTimes = notGuruItems
    .filter((item) => item.subjectType === "kanji" && item.fastestGuruAt)
    .map((item) => Date.parse(item.fastestGuruAt as string))
    .sort((left, right) => left - right);

  return kanjiPassTimes.length >= neededKanjiCount ? new Date(kanjiPassTimes[neededKanjiCount - 1]).toISOString() : null;
}

function buildRadicalPassTimes(
  subjects: Array<Resource<SubjectData, SubjectType>>,
  assignmentBySubjectId: Map<number, Resource<AssignmentData, "assignment">>,
  now: Date,
): Map<number, number> {
  const radicalPassTimesBySubjectId = new Map<number, number>();
  for (const subject of subjects) {
    if (subject.object !== "radical") continue;
    radicalPassTimesBySubjectId.set(
      subject.id,
      estimateAssignmentPassTime(assignmentBySubjectId.get(subject.id), now.getTime()),
    );
  }
  return radicalPassTimesBySubjectId;
}

function estimateAssignmentPassTime(
  assignment: Resource<AssignmentData, "assignment"> | undefined,
  startAt: number,
): number {
  const srsStage = assignment?.data.srs_stage ?? 0;

  if (srsStage >= PASSING_SRS_STAGE) return startAt;
  if (srsStage === 0) {
    let reviewAt = startAt;
    for (let stage = 1; stage < PASSING_SRS_STAGE; stage += 1) {
      reviewAt += REVIEW_INTERVALS_BY_STAGE[stage] ?? 0;
    }
    return reviewAt;
  }

  let reviewAt = assignment?.data.available_at ? Math.max(Date.parse(assignment.data.available_at), startAt) : startAt;
  if (srsStage === PASSING_SRS_STAGE - 1) return reviewAt;

  for (let stage = srsStage + 1; stage < PASSING_SRS_STAGE; stage += 1) {
    reviewAt += REVIEW_INTERVALS_BY_STAGE[stage] ?? 0;
  }

  return reviewAt;
}

function compareCurrentLevelProgressItems(left: CurrentLevelProgressItem, right: CurrentLevelProgressItem): number {
  return (
    progressSubjectTypeSort(left.subjectType) - progressSubjectTypeSort(right.subjectType) ||
    left.srsStage - right.srsStage ||
    compareNullableDates(left.availableAt, right.availableAt) ||
    left.subjectId - right.subjectId
  );
}

function progressSubjectTypeSort(subjectType: CurrentLevelProgressItem["subjectType"]): number {
  return subjectType === "radical" ? 0 : 1;
}

function getEarliestAvailableAt(assignments: Array<Resource<AssignmentData, "assignment">>): string | null {
  return assignments
    .map((assignment) => assignment.data.available_at)
    .filter((availableAt): availableAt is string => Boolean(availableAt))
    .sort((left, right) => compareNullableDates(left, right))[0] ?? null;
}

function compareNullableDates(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return Date.parse(left) - Date.parse(right);
}

interface ResourceCache<T> {
  cachedAt: number;
  records: Record<number, T>;
}

function readResourceCache<T>(key: string): ResourceCache<T> {
  if (!storageAvailable()) return { cachedAt: 0, records: {} };

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { cachedAt: 0, records: {} };
    const parsed = JSON.parse(raw) as Partial<ResourceCache<T>>;
    return {
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0,
      records: parsed.records ?? {},
    };
  } catch {
    return { cachedAt: 0, records: {} };
  }
}

function writeResourceCache<T>(key: string, records: Record<number, T>): void {
  if (!storageAvailable()) return;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        records,
      }),
    );
  } catch {
    // Cache writes should never block reviews.
  }
}

function mergeCacheRecords<T extends Resource<unknown>>(records: Record<number, T>, resources: T[]): Record<number, T> {
  return {
    ...records,
    ...Object.fromEntries(resources.map((resource) => [resource.id, resource])),
  };
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function mergeHeaders(base: Record<string, string>, override?: HeadersInit): HeadersInit {
  const headers = new Headers(base);
  if (!override) return headers;

  new Headers(override).forEach((value, key) => {
    headers.set(key, value);
  });

  return headers;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
