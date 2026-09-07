import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

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
    expect(screen.getByText("口")).toBeInTheDocument();
    expect(screen.getByText("日")).toBeInTheDocument();
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
