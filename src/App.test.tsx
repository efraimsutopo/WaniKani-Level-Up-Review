import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, getDueBreakdown } from "./App";
import type { ReviewItem, SubjectType } from "./api/types";
import type { ReviewSessionState } from "./review/session";

describe("App", () => {
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
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not repeatedly sync when no reviews are due", async () => {
    localStorage.setItem("wanikani-review-token", "token");
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/user")) {
        return jsonResponse({
          object: "user",
          data: {
            username: "leebo",
            level: 12,
            subscription: { active: true, max_level_granted: 60 },
          },
        });
      }

      if (requestUrl.includes("/assignments?immediately_available_for_review")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse([]);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    await screen.findByText("No reviews are due right now.");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.wanikani.com/v2/assignments?immediately_available_for_review",
      expect.any(Object),
    );
  });

  it("shows all current-level progress times in 24-hour format", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T03:00:00.000Z"));
    localStorage.setItem("wanikani-review-token", "token");

    const levelKanji = Array.from({ length: 13 }, (_, index) =>
      subject(200 + index, `kanji-${index + 1}`),
    );
    const levelAssignments = [
      ...levelKanji.slice(0, 11).map((kanji, index) =>
        assignment(300 + index, kanji.id, {
          srs_stage: 4,
          available_at: "2026-09-08T01:00:00.000Z",
        }),
      ),
      assignment(311, levelKanji[11].id, {
        srs_stage: 3,
        available_at: "2026-09-08T01:00:00.000Z",
      }),
      assignment(312, levelKanji[12].id, {
        srs_stage: 1,
        available_at: "2026-09-12T01:00:00.000Z",
      }),
    ];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/user")) {
        return jsonResponse({
          object: "user",
          data: {
            username: "leebo",
            level: 12,
            subscription: { active: true, max_level_granted: 60 },
          },
        });
      }

      if (requestUrl.includes("/assignments?immediately_available_for_review")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse(levelAssignments);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse(levelKanji);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    expect(await screen.findAllByText("Sep 10, 09:00")).not.toHaveLength(0);
    expect(screen.getAllByText("Sep 8, 10:00")).not.toHaveLength(0);
    expect(screen.queryByText(/\b(?:AM|PM)\b/)).not.toBeInTheDocument();
  });

  it("opens the learn page at the synced current level", async () => {
    localStorage.setItem("wanikani-review-token", "token");
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith("/user")) {
        return jsonResponse({
          object: "user",
          data: {
            username: "leebo",
            level: 12,
            subscription: { active: true, max_level_granted: 60 },
          },
        });
      }

      if (requestUrl.includes("/assignments?immediately_available_for_review")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/assignments?") && requestUrl.includes("levels=12")) {
        return collectionResponse([]);
      }

      if (requestUrl.includes("/subjects?") && requestUrl.includes("levels=12")) {
        return collectionResponse([
          {
            ...subject(120, "口"),
            object: "radical",
            data: {
              ...subject(120, "口").data,
              characters: null,
              slug: "elf",
              character_images: [{
                url: "https://example.com/elf.svg",
                content_type: "image/svg+xml",
                metadata: { inline_styles: true },
              }],
              readings: undefined,
            },
          },
          subject(121, "日"),
        ]);
      }

      throw new Error(`Unexpected URL: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    await screen.findByText("No reviews are due right now.");
    fireEvent.click(screen.getByRole("button", { name: /learn/i }));

    expect(screen.getByLabelText("Level")).toHaveValue(12);
    expect(await screen.findByText("Radicals")).toBeInTheDocument();
    expect(screen.getByText("Kanji")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "elf" })).toHaveAttribute(
      "src",
      "https://example.com/elf.svg",
    );
    expect(screen.queryByText("elf")).not.toBeInTheDocument();
    expect(screen.getByText("日")).toBeInTheDocument();
  });

  it("puts current-level radical and kanji rows first in the due breakdown using the selected sort", () => {
    const items = [
      reviewItem(1, "vocabulary", 31, 1),
      reviewItem(2, "kanji", 31, 0),
      reviewItem(3, "radical", 10, 1),
      reviewItem(4, "radical", 31, 3),
      reviewItem(5, "kanji", 30, 0),
      reviewItem(6, "radical", 31, 1),
    ];
    const session = reviewSession(items);

    expect(
      getDueBreakdown(session, "lower-srs-first", 31).map((row) => [
        row.level,
        row.type,
        row.srs,
      ]),
    ).toEqual([
      [31, "kanji", "Locked"],
      [31, "radical", "Apprentice 1"],
      [31, "radical", "Apprentice 3"],
      [30, "kanji", "Locked"],
      [10, "radical", "Apprentice 1"],
      [31, "vocabulary", "Apprentice 1"],
    ]);

    expect(
      getDueBreakdown(session, "lower-level-first", 31).map((row) => [
        row.level,
        row.type,
        row.srs,
      ]),
    ).toEqual([
      [31, "radical", "Apprentice 1"],
      [31, "radical", "Apprentice 3"],
      [31, "kanji", "Locked"],
      [10, "radical", "Apprentice 1"],
      [30, "kanji", "Locked"],
      [31, "vocabulary", "Apprentice 1"],
    ]);
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

function subject(id: number, characters = "日") {
  return {
    id,
    object: "kanji",
    url: "",
    data_updated_at: "",
    data: {
      characters,
      slug: characters,
      level: 12,
      meanings: [{ meaning: "Sun", primary: true, accepted_answer: true }],
      readings: [{ reading: "にち", primary: true, accepted_answer: true }],
    },
  };
}

function assignment(id: number, subjectId: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: "assignment",
    url: "",
    data_updated_at: "",
    data: {
      subject_id: subjectId,
      subject_type: "kanji",
      level: 12,
      srs_stage: 3,
      passed_at: null,
      available_at: "2026-09-08T01:00:00.000Z",
      passed: false,
      hidden: false,
      ...overrides,
    },
  };
}

function reviewSession(items: ReviewItem[]): ReviewSessionState {
  return {
    items,
    queue: [],
    progressByAssignmentId: Object.fromEntries(
      items.map((item) => [
        item.assignment.id,
        {
          assignmentId: item.assignment.id,
          requiredKinds: ["meaning"],
          completedKinds: [],
          incorrectMeaningAnswers: 0,
          incorrectReadingAnswers: 0,
        },
      ]),
    ),
    completedCount: 0,
    totalCount: items.length,
  };
}

function reviewItem(
  id: number,
  type: SubjectType,
  level: number,
  srsStage: number,
): ReviewItem {
  return {
    assignment: {
      id: id + 100,
      object: "assignment",
      url: "",
      data_updated_at: "",
      data: {
        subject_id: id,
        subject_type: type,
        level,
        srs_stage: srsStage,
        passed_at: null,
        available_at: "2026-09-13T00:00:00.000Z",
        passed: false,
        hidden: false,
      },
    },
    subject: {
      id,
      object: type,
      url: "",
      data_updated_at: "",
      data: {
        characters: "日",
        slug: `subject-${id}`,
        level,
        meanings: [{ meaning: "Sun", primary: true, accepted_answer: true }],
        readings:
          type === "radical"
            ? undefined
            : [{ reading: "にち", primary: true, accepted_answer: true }],
      },
    },
  };
}
