import { describe, expect, it } from "vitest";
import type { ReviewItem } from "../api/types";
import { answerCurrentQuestion, createReviewSession, getSrsGroup, getSrsLabel } from "./session";

describe("review session", () => {
  it("maps SRS stages to WaniKani labels", () => {
    expect(getSrsLabel(1)).toBe("Apprentice 1");
    expect(getSrsLabel(4)).toBe("Apprentice 4");
    expect(getSrsLabel(5)).toBe("Guru 1");
    expect(getSrsLabel(6)).toBe("Guru 2");
    expect(getSrsLabel(7)).toBe("Master");
    expect(getSrsLabel(8)).toBe("Enlightened");
    expect(getSrsLabel(9)).toBe("Burned");
  });

  it("maps SRS stages to color groups", () => {
    expect(getSrsGroup(1)).toBe("apprentice");
    expect(getSrsGroup(5)).toBe("guru");
    expect(getSrsGroup(7)).toBe("master");
    expect(getSrsGroup(8)).toBe("enlightened");
    expect(getSrsGroup(9)).toBe("burned");
  });

  it("retries incorrect answers immediately and submits only after all required parts are correct", () => {
    let session = createReviewSession([item()]);

    let result;
    [session, result] = answerCurrentQuestion(session, "moon");
    expect(result.correct).toBe(false);
    expect(session.queue.map((question) => question.kind)).toEqual(["meaning", "reading"]);

    [session, result] = answerCurrentQuestion(session, "sun");
    expect(result.correct).toBe(true);
    expect(result.submitReadyReview).toBeUndefined();

    [session, result] = answerCurrentQuestion(session, "にち");
    expect(result.correct).toBe(true);
    expect(result.submitReadyReview?.payload).toMatchObject({
      assignment_id: 10,
      incorrect_meaning_answers: 1,
      incorrect_reading_answers: 0,
    });
    expect(session.completedCount).toBe(1);
    expect(session.queue).toHaveLength(0);
  });
});

function item(): ReviewItem {
  return {
    assignment: {
      id: 10,
      object: "assignment",
      url: "",
      data_updated_at: "",
      data: {
        subject_id: 99,
        subject_type: "kanji",
        level: 4,
        srs_stage: 3,
        passed_at: null,
        available_at: "2026-09-03T00:00:00.000000Z",
        passed: false,
        hidden: false,
      },
    },
    subject: {
      id: 99,
      object: "kanji",
      url: "",
      data_updated_at: "",
      data: {
        characters: "日",
        slug: "sun",
        level: 4,
        meanings: [{ meaning: "Sun", primary: true, accepted_answer: true }],
        readings: [{ reading: "にち", primary: true, accepted_answer: true }],
      },
    },
  };
}
