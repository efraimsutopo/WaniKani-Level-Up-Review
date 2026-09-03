import { describe, expect, it } from "vitest";
import type { ReviewItem, SubjectType } from "../api/types";
import { getItemLevel, orderReviewItems } from "./order";

describe("orderReviewItems", () => {
  it("prioritizes current-level radicals and kanji, then lower SRS by type", () => {
    const items = [
      item(1, "vocabulary", 10, 1),
      item(2, "kanji", 10, 7),
      item(3, "radical", 10, 8),
      item(4, "vocabulary", 9, 1),
      item(5, "radical", 8, 2),
      item(6, "kanji", 8, 2),
    ];

    expect(orderReviewItems(items, 10).map((reviewItem) => reviewItem.subject.id)).toEqual([3, 2, 1, 4, 5, 6]);
  });

  it("can sort remaining items by lower level first after the current-level critical path", () => {
    const items = [
      item(1, "vocabulary", 30, 1),
      item(2, "kanji", 30, 7),
      item(3, "vocabulary", 14, 8),
      item(4, "radical", 15, 8),
    ];

    expect(orderReviewItems(items, 30, "lower-level-first").map((reviewItem) => reviewItem.subject.id)).toEqual([2, 3, 4, 1]);
  });

  it("falls back to the subject level if assignment level is unavailable", () => {
    const reviewItem = item(1, "kanji", 12);
    reviewItem.assignment.data.level = undefined as unknown as number;

    expect(getItemLevel(reviewItem)).toBe(12);
  });
});

function item(id: number, type: SubjectType, level: number, srsStage = 4): ReviewItem {
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
        available_at: "2026-09-03T00:00:00.000000Z",
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
        readings: type === "radical" ? undefined : [{ reading: "にち", primary: true, accepted_answer: true }],
      },
    },
  };
}
