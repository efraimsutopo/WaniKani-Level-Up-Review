import type { QuestionKind, ReviewCreatePayload, ReviewItem } from "../api/types";
import { checkAnswer, getAcceptedAnswers, getRequiredQuestionKinds } from "./answers";

export interface ReviewQuestion {
  item: ReviewItem;
  kind: QuestionKind;
}

export interface ItemProgress {
  assignmentId: number;
  requiredKinds: QuestionKind[];
  completedKinds: QuestionKind[];
  incorrectMeaningAnswers: number;
  incorrectReadingAnswers: number;
}

export interface SubmitReadyReview {
  payload: ReviewCreatePayload;
  item: ReviewItem;
}

export interface AnswerResult {
  correct: boolean;
  completedItem: boolean;
  acceptedAnswers: string[];
  blockedByBlacklist: boolean;
  submitReadyReview?: SubmitReadyReview;
}

export interface ReviewSessionState {
  items: ReviewItem[];
  queue: ReviewQuestion[];
  progressByAssignmentId: Record<number, ItemProgress>;
  completedCount: number;
  totalCount: number;
}

export function getSrsLabel(stage: number): string {
  if (stage <= 0) return "Locked";
  if (stage <= 4) return `Apprentice ${stage}`;
  if (stage <= 6) return `Guru ${stage - 4}`;
  if (stage === 7) return "Master";
  if (stage === 8) return "Enlightened";
  return "Burned";
}

export function getSrsGroup(stage: number): "locked" | "apprentice" | "guru" | "master" | "enlightened" | "burned" {
  if (stage <= 0) return "locked";
  if (stage <= 4) return "apprentice";
  if (stage <= 6) return "guru";
  if (stage === 7) return "master";
  if (stage === 8) return "enlightened";
  return "burned";
}

export function getSrsSortRank(stage: number): number {
  return stage;
}

export function createReviewSession(items: ReviewItem[]): ReviewSessionState {
  const queue: ReviewQuestion[] = [];
  const progressByAssignmentId: Record<number, ItemProgress> = {};

  for (const item of items) {
    const requiredKinds = getRequiredQuestionKinds(item);
    progressByAssignmentId[item.assignment.id] = {
      assignmentId: item.assignment.id,
      requiredKinds,
      completedKinds: [],
      incorrectMeaningAnswers: 0,
      incorrectReadingAnswers: 0,
    };

    for (const kind of requiredKinds) {
      queue.push({ item, kind });
    }
  }

  return {
    items,
    queue,
    progressByAssignmentId,
    completedCount: 0,
    totalCount: items.length,
  };
}

export function answerCurrentQuestion(state: ReviewSessionState, input: string): [ReviewSessionState, AnswerResult] {
  const [question, ...remainingQueue] = state.queue;
  if (!question) {
    return [
      state,
      {
        correct: false,
        completedItem: false,
        acceptedAnswers: [],
        blockedByBlacklist: false,
      },
    ];
  }

  const check = checkAnswer(question.item, question.kind, input);
  const progress = state.progressByAssignmentId[question.item.assignment.id];

  if (!check.correct) {
    const updatedProgress = {
      ...progress,
      incorrectMeaningAnswers:
        question.kind === "meaning" ? progress.incorrectMeaningAnswers + 1 : progress.incorrectMeaningAnswers,
      incorrectReadingAnswers:
        question.kind === "reading" ? progress.incorrectReadingAnswers + 1 : progress.incorrectReadingAnswers,
    };

    return [
      {
        ...state,
        queue: [question, ...remainingQueue],
        progressByAssignmentId: {
          ...state.progressByAssignmentId,
          [updatedProgress.assignmentId]: updatedProgress,
        },
      },
      {
        correct: false,
        completedItem: false,
        acceptedAnswers: check.acceptedAnswers,
        blockedByBlacklist: check.blockedByBlacklist,
      },
    ];
  }

  const completedKinds = [...new Set([...progress.completedKinds, question.kind])];
  const updatedProgress = {
    ...progress,
    completedKinds,
  };
  const completedItem = updatedProgress.requiredKinds.every((kind) => completedKinds.includes(kind));
  const submitReadyReview = completedItem
    ? {
        item: question.item,
        payload: {
          assignment_id: question.item.assignment.id,
          incorrect_meaning_answers: updatedProgress.incorrectMeaningAnswers,
          incorrect_reading_answers: updatedProgress.incorrectReadingAnswers,
        },
      }
    : undefined;

  return [
    {
      ...state,
      queue: remainingQueue,
      progressByAssignmentId: {
        ...state.progressByAssignmentId,
        [updatedProgress.assignmentId]: updatedProgress,
      },
      completedCount: state.completedCount + (completedItem ? 1 : 0),
    },
    {
      correct: true,
      completedItem,
      acceptedAnswers: getAcceptedAnswers(question.item, question.kind),
      blockedByBlacklist: false,
      submitReadyReview,
    },
  ];
}
