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
    expect(urls.some((url) => url.includes("/subjects?"))).toBe(false);
    expect(urls.filter((url) => url.includes("subject_ids="))).toHaveLength(0);
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

function subject(id: number) {
  return {
    id,
    object: "kanji",
    url: "",
    data_updated_at: "",
    data: {
      characters: "日",
      slug: "sun",
      level: 1,
      meanings: [{ meaning: "Sun", primary: true, accepted_answer: true }],
      readings: [{ reading: "にち", primary: true, accepted_answer: true }],
    },
  };
}

function assignment(id: number, subjectId: number) {
  return {
    id,
    object: "assignment",
    url: "",
    data_updated_at: "",
    data: {
      subject_id: subjectId,
      subject_type: "kanji",
      level: 1,
      srs_stage: 3,
      passed_at: null,
      available_at: "2020-01-01T00:00:00.000Z",
      passed: false,
      hidden: false,
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
