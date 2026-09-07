import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaniKaniClient } from "./wanikani";

describe("WaniKaniClient", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("follows collection pagination", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl.includes("page_after_id=1")) {
        return jsonResponse({
          object: "collection",
          pages: { next_url: null, previous_url: null, per_page: 1000 },
          total_count: 2,
          data_updated_at: null,
          url: requestUrl,
          data: [subject(2)],
        });
      }

      return jsonResponse({
        object: "collection",
        pages: {
          next_url: "https://api.wanikani.com/v2/subjects?ids=1,2&page_after_id=1",
          previous_url: null,
          per_page: 1000,
        },
        total_count: 2,
        data_updated_at: null,
        url: requestUrl,
        data: [subject(1)],
      });
    });

    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);
    await expect(client.getSubjects([1, 2])).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws a helpful authorization error body", async () => {
    const client = new WaniKaniClient(
      "bad-token",
      vi.fn(async () => jsonResponse({ error: "Unauthorized. Nice try.", code: 401 }, 401)) as typeof fetch,
      0,
    );

    await expect(client.getUser()).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized. Nice try.",
    });
  });

  it("throws a specific rate-limit error", async () => {
    const client = new WaniKaniClient(
      "token",
      vi.fn(async () => jsonResponse({ error: "Rate Limit Exceeded", code: 429 }, 429)) as typeof fetch,
      0,
    );

    await expect(client.getSummary()).rejects.toMatchObject({
      status: 429,
      message: "WaniKani rate limit exceeded.",
    });
  });

  it("posts completed reviews", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: 1,
        object: "review",
        data: {
          assignment_id: 10,
          subject_id: 99,
          starting_srs_stage: 3,
          ending_srs_stage: 4,
        },
      }),
    );
    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);

    await client.createReview({
      assignment_id: 10,
      incorrect_meaning_answers: 1,
      incorrect_reading_answers: 0,
      created_at: "2026-09-03T00:00:00.000Z",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.wanikani.com/v2/reviews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          review: {
            assignment_id: 10,
            incorrect_meaning_answers: 1,
            incorrect_reading_answers: 0,
            created_at: "2026-09-03T00:00:00.000Z",
          },
        }),
      }),
    );
  });

  it("loads due reviews with the immediately_available_for_review filter", async () => {
    localStorage.clear();
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      urls.push(requestUrl);

      if (requestUrl.endsWith("/user")) {
        return jsonResponse({
          object: "user",
          data: { username: "leebo", level: 12, subscription: { active: true, max_level_granted: 60 } },
        });
      }

      if (requestUrl.includes("/assignments?immediately_available_for_review")) {
        return collectionResponse([assignment(10, 99)]);
      }

      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse([
          assignment(20, 120, "radical", 12, { passed: true, passed_at: "2020-01-01T00:00:00.000Z" }),
          assignment(21, 121, "kanji", 12, { available_at: "2020-01-02T00:00:00.000Z" }),
        ]);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse([
          subject(120, "radical", "口"),
          subject(121, "kanji", "日"),
        ]);
      }

      if (requestUrl.includes("/subjects?")) {
        return collectionResponse([subject(99)]);
      }

      if (requestUrl.includes("/study_materials?")) {
        return collectionResponse([studyMaterial(5, 99)]);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });

    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);
    const loaded = await client.loadDueReviewItems();

    expect(loaded.items).toHaveLength(1);
    expect(loaded.currentLevelProgress.kanjiRequiredForLevelUp).toBe(1);
    expect(loaded.currentLevelProgress.kanji.nextAvailableAt).toBe("2020-01-02T00:00:00.000Z");
    expect(urls.some((url) => url.includes("/summary"))).toBe(false);
    expect(urls.some((url) => url.includes("immediately_available_for_review"))).toBe(true);
    expect(urls.some((url) => url.includes("/assignments") && url.includes("subject_ids="))).toBe(false);
  });

  it("refreshes cached study materials with updated_after instead of refetching all due ids", async () => {
    localStorage.clear();
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      urls.push(requestUrl);

      if (requestUrl.endsWith("/user")) {
        return jsonResponse({
          object: "user",
          data: { username: "leebo", level: 12, subscription: { active: true, max_level_granted: 60 } },
        });
      }

      if (requestUrl.includes("/assignments?immediately_available_for_review")) {
        return collectionResponse([assignment(10, 99)]);
      }

      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/subjects?")) {
        return collectionResponse([subject(99)]);
      }

      if (requestUrl.includes("updated_after=")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/study_materials?")) {
        return collectionResponse([studyMaterial(5, 99)]);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });

    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);
    await client.loadDueReviewItems();
    urls.length = 0;
    await client.loadDueReviewItems();

    expect(urls.some((url) => url.includes("updated_after="))).toBe(true);
    expect(urls.some((url) => url.includes("/subjects?ids="))).toBe(false);
    expect(urls.filter((url) => url.includes("subject_ids="))).toHaveLength(0);
  });

  it("loads current-level radical and kanji progress from assignments", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=8")) {
        return collectionResponse([
          assignment(1, 101, "kanji", 8, { passed: true, passed_at: "2020-01-01T00:00:00.000Z" }),
          assignment(2, 102, "kanji", 8, { passed: true, passed_at: "2020-01-01T00:00:00.000Z" }),
          assignment(3, 103, "kanji", 8, { available_at: "2020-01-04T00:00:00.000Z" }),
          assignment(4, 104, "kanji", 8, { available_at: "2020-01-03T00:00:00.000Z" }),
          assignment(5, 105, "radical", 8, { passed: true, passed_at: "2020-01-01T00:00:00.000Z" }),
          assignment(6, 106, "radical", 8, { srs_stage: 4, available_at: "2020-01-02T00:00:00.000Z" }),
        ]);
      }

      if (requestUrl.includes("/subjects?")) {
        return collectionResponse([
          subject(101, "kanji", "一"),
          subject(102, "kanji", "二"),
          subject(103, "kanji", "上"),
          subject(104, "kanji", "下"),
          {
            ...subject(107, "kanji", "中"),
            data: {
              ...subject(107, "kanji", "中").data,
              component_subject_ids: [106],
            },
          },
          subject(105, "radical", "丶"),
          subject(106, "radical", "口"),
        ]);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });

    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);
    const progress = await client.getCurrentLevelProgress(8);

    expect(progress).toMatchObject({
      level: 8,
      kanjiRequiredForLevelUp: 5,
      kanjiRemainingForLevelUp: 3,
      radicals: {
        total: 2,
        passed: 1,
        remaining: 1,
        nextAvailableAt: "2020-01-02T00:00:00.000Z",
      },
      kanji: {
        total: 5,
        passed: 2,
        remaining: 3,
        nextAvailableAt: "2020-01-03T00:00:00.000Z",
      },
    });
    expect(progress.notGuruItems.map((item) => item.subjectId)).toEqual([106, 107, 104, 103]);
    expect(progress.notGuruItems.find((item) => item.subjectId === 107)?.blockedByRadicals[0].subjectId).toBe(106);
    expect(progress.fastestLevelUpAt).not.toBeNull();
  });

  it("uses the Apprentice 3 kanji Guru time when 11 Apprentice 4 kanji are not enough to level up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T03:00:00.000Z"));

    const apprenticeFourAvailableAt = "2026-09-08T01:00:00.000Z";
    const apprenticeThreeAvailableAt = "2026-09-08T01:00:00.000Z";
    const expectedFastestLevelUpAt = "2026-09-10T00:00:00.000Z";
    const levelKanji = Array.from({ length: 13 }, (_, index) =>
      subject(200 + index, "kanji", `kanji-${index + 1}`),
    );
    const levelAssignments = [
      ...levelKanji.slice(0, 11).map((kanji, index) =>
        assignment(300 + index, kanji.id, "kanji", 12, {
          srs_stage: 4,
          available_at: apprenticeFourAvailableAt,
        }),
      ),
      assignment(311, levelKanji[11].id, "kanji", 12, {
        srs_stage: 3,
        available_at: apprenticeThreeAvailableAt,
      }),
      assignment(312, levelKanji[12].id, "kanji", 12, {
        srs_stage: 1,
        available_at: "2026-09-12T01:00:00.000Z",
      }),
    ];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse(levelAssignments);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse(levelKanji);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });

    const client = new WaniKaniClient("token", fetcher as typeof fetch, 0);
    const progress = await client.getCurrentLevelProgress(12);

    expect(progress.kanjiRequiredForLevelUp).toBe(12);
    expect(progress.kanjiRemainingForLevelUp).toBe(12);
    expect(progress.fastestLevelUpAt).toBe(expectedFastestLevelUpAt);
    expect(progress.notGuruItems.find((item) => item.subjectId === levelKanji[11].id)).toMatchObject({
      srsStage: 3,
      availableAt: apprenticeThreeAvailableAt,
      fastestGuruAt: expectedFastestLevelUpAt,
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function collectionResponse(data: unknown[]) {
  return jsonResponse({
    object: "collection",
    pages: { next_url: null, previous_url: null, per_page: 500 },
    total_count: data.length,
    data_updated_at: null,
    url: "",
    data,
  });
}

function subject(id: number, subjectType = "kanji", characters = "日") {
  return {
    id,
    object: subjectType,
    url: "",
    data_updated_at: "",
    data: {
      characters,
      slug: "sun",
      level: 1,
      meanings: [{ meaning: "Sun", primary: true, accepted_answer: true }],
      readings: [{ reading: "にち", primary: true, accepted_answer: true }],
    },
  };
}

function assignment(
  id: number,
  subjectId: number,
  subjectType = "kanji",
  level = 1,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    object: "assignment",
    url: "",
    data_updated_at: "",
    data: {
      subject_id: subjectId,
      subject_type: subjectType,
      level,
      srs_stage: 3,
      passed_at: null,
      available_at: "2020-01-01T00:00:00.000Z",
      passed: false,
      hidden: false,
      ...overrides,
    },
  };
}

function studyMaterial(id: number, subjectId: number) {
  return {
    id,
    object: "study_material",
    url: "",
    data_updated_at: "",
    data: {
      subject_id: subjectId,
      meaning_synonyms: ["sunlight"],
      hidden: false,
    },
  };
}
