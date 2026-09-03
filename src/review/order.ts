import type { ReviewItem, SubjectType } from "../api/types";
import { getSrsSortRank } from "./session";

export type SortMode = "lower-srs-first" | "lower-level-first";

const SUBJECT_TYPE_PRIORITY: Record<SubjectType, number> = {
  radical: 0,
  kanji: 1,
  vocabulary: 2,
  kana_vocabulary: 2,
};

export function orderReviewItems(items: ReviewItem[], currentLevel: number, sortMode: SortMode = "lower-srs-first"): ReviewItem[] {
  return [...items].sort((left, right) => {
    const priorityDifference = criticalPathPriority(left, currentLevel) - criticalPathPriority(right, currentLevel);
    if (priorityDifference !== 0) return priorityDifference;

    if (criticalPathPriority(left, currentLevel) === 0 && criticalPathPriority(right, currentLevel) === 0) {
      const criticalTypeDifference = SUBJECT_TYPE_PRIORITY[left.subject.object] - SUBJECT_TYPE_PRIORITY[right.subject.object];
      if (criticalTypeDifference !== 0) return criticalTypeDifference;

      const srsDifference = getSrsSortRank(left.assignment.data.srs_stage) - getSrsSortRank(right.assignment.data.srs_stage);
      if (srsDifference !== 0) return srsDifference;

      return left.subject.id - right.subject.id;
    }

    if (sortMode === "lower-srs-first") {
      const srsDifference = getSrsSortRank(left.assignment.data.srs_stage) - getSrsSortRank(right.assignment.data.srs_stage);
      if (srsDifference !== 0) return srsDifference;
    } else {
      const levelDifference = getItemLevel(left) - getItemLevel(right);
      if (levelDifference !== 0) return levelDifference;
    }

    const typeDifference = SUBJECT_TYPE_PRIORITY[left.subject.object] - SUBJECT_TYPE_PRIORITY[right.subject.object];
    if (typeDifference !== 0) return typeDifference;

    const levelDifference =
      sortMode === "lower-srs-first"
        ? getItemLevel(left) - getItemLevel(right)
        : getSrsSortRank(left.assignment.data.srs_stage) - getSrsSortRank(right.assignment.data.srs_stage);
    if (levelDifference !== 0) return levelDifference;

    const availableDifference = compareDates(left.assignment.data.available_at, right.assignment.data.available_at);
    if (availableDifference !== 0) return availableDifference;

    return left.subject.id - right.subject.id;
  });
}

function criticalPathPriority(item: ReviewItem, currentLevel: number): number {
  if (getItemLevel(item) !== currentLevel) return 1;
  return item.subject.object === "radical" || item.subject.object === "kanji" ? 0 : 1;
}

export function getItemLevel(item: ReviewItem): number {
  return item.assignment.data.level ?? item.subject.data.level;
}

function compareDates(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return Date.parse(left) - Date.parse(right);
}
