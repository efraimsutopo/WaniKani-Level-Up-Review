import { describe, expect, it, vi } from "vitest";
import { WaniKaniClient } from "./wanikani";

const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const collection = (data: unknown[], next_url: string | null = null) => response({ data, pages: { next_url } });
const assignment = (id: number, extra = {}) => ({ id, object: "assignment", data: {
  subject_id: id, subject_type: "kanji", srs_stage: 0, hidden: false, ...extra,
} });

describe("lesson API", () => {
  it("loads paginated lessons in radical, kanji, vocabulary order and respects eligibility", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/user")) return response({ data: { level: 5, subscription: { max_level_granted: 3 } } });
      if (path.includes("page_after_id")) return collection([
        assignment(5, { subject_type: "vocabulary" }),
        assignment(7, { subject_type: "kana_vocabulary" }),
      ]);
      if (path.includes("/assignments?")) {
        expect(path).toContain("immediately_available_for_lessons&subject_types=radical,kanji,vocabulary,kana_vocabulary");
        return collection([assignment(1), assignment(2, { hidden: true }), assignment(3, { srs_stage: 1 }), assignment(4), assignment(6, { subject_type: "radical" })], "https://api.wanikani.com/v2/assignments?page_after_id=4");
      }
      if (path.includes("/subjects?")) return collection([1, 4, 5, 6, 7].map((id) => ({
        id,
        object: id === 6 ? "radical" : id === 5 ? "vocabulary" : id === 7 ? "kana_vocabulary" : "kanji",
        data: { level: id === 4 ? 4 : 1 },
      })));
      throw new Error(path);
    });
    const items = await new WaniKaniClient("token", fetcher).loadAvailableLessons();
    expect(items.map((item) => item.assignment.id)).toEqual([6, 1, 5, 7]);
  });

  it("starts a lesson with PUT and the assignment id, without submitting a review", async () => {
    const fetcher = vi.fn(async () => response(assignment(42)));
    await new WaniKaniClient("token", fetcher).startAssignment(42);
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.wanikani.com/v2/assignments/42/start");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ assignment: {} });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
  });

  it("reconciles an already-started lesson without writing progress again", async () => {
    const fetcher = vi.fn(async () => response(assignment(42, { srs_stage: 1 })));
    await new WaniKaniClient("token", fetcher).startAssignment(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
