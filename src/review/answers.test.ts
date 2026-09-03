import { describe, expect, it } from "vitest";
import type { ReviewItem } from "../api/types";
import { checkAnswer, getRequiredQuestionKinds, normalizeAnswer } from "./answers";

describe("answer checking", () => {
  it("normalizes meaning case and whitespace", () => {
    expect(normalizeAnswer("  Big   Tree ", "meaning")).toBe("big tree");
  });

  it("normalizes katakana readings to hiragana", () => {
    expect(normalizeAnswer("ニチ", "reading")).toBe("にち");
  });

  it("accepts official meanings and study-material synonyms", () => {
    const reviewItem = item();

    expect(checkAnswer(reviewItem, "meaning", "sun").correct).toBe(true);
    expect(checkAnswer(reviewItem, "meaning", "day star").correct).toBe(true);
  });

  it("blocks blacklisted meanings even if text is close", () => {
    const reviewItem = item();
    const result = checkAnswer(reviewItem, "meaning", "Sunday");

    expect(result.correct).toBe(false);
    expect(result.blockedByBlacklist).toBe(true);
  });

  it("requires only meaning for radicals", () => {
    expect(getRequiredQuestionKinds({ ...item(), subject: { ...item().subject, object: "radical" } })).toEqual(["meaning"]);
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
        auxiliary_meanings: [{ meaning: "Sunday", type: "blacklist" }],
      },
    },
    studyMaterial: {
      id: 20,
      object: "study_material",
      url: "",
      data_updated_at: "",
      data: {
        subject_id: 99,
        meaning_synonyms: ["day star"],
        hidden: false,
      },
    },
  };
}
