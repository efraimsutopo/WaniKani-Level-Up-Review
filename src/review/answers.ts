import type { QuestionKind, ReviewItem } from "../api/types";
import { romajiToHiragana } from "./kana";

export interface AnswerCheckResult {
  correct: boolean;
  acceptedAnswers: string[];
  blockedByBlacklist: boolean;
}

export function getRequiredQuestionKinds(item: ReviewItem): QuestionKind[] {
  if (item.subject.object === "radical" || item.subject.object === "kana_vocabulary") {
    return ["meaning"];
  }

  const acceptedReadings = item.subject.data.readings?.filter((reading) => reading.accepted_answer) ?? [];
  return acceptedReadings.length > 0 ? ["meaning", "reading"] : ["meaning"];
}

export function checkAnswer(item: ReviewItem, kind: QuestionKind, input: string): AnswerCheckResult {
  const acceptedAnswers = getAcceptedAnswers(item, kind);
  const normalizedInput = normalizeAnswer(input, kind);
  const blacklist = getBlacklistedMeanings(item).map((answer) => normalizeAnswer(answer, "meaning"));
  const blockedByBlacklist = kind === "meaning" && blacklist.includes(normalizedInput);

  return {
    correct: !blockedByBlacklist && acceptedAnswers.map((answer) => normalizeAnswer(answer, kind)).includes(normalizedInput),
    acceptedAnswers,
    blockedByBlacklist,
  };
}

export function getAcceptedAnswers(item: ReviewItem, kind: QuestionKind): string[] {
  if (kind === "reading") {
    return unique((item.subject.data.readings ?? []).filter((reading) => reading.accepted_answer).map((reading) => reading.reading));
  }

  const officialMeanings = item.subject.data.meanings
    .filter((meaning) => meaning.accepted_answer)
    .map((meaning) => meaning.meaning);
  const whitelistMeanings = (item.subject.data.auxiliary_meanings ?? [])
    .filter((meaning) => meaning.type === "whitelist")
    .map((meaning) => meaning.meaning);
  const synonyms = item.studyMaterial?.data.hidden ? [] : (item.studyMaterial?.data.meaning_synonyms ?? []);

  return unique([...officialMeanings, ...whitelistMeanings, ...synonyms]);
}

export function normalizeAnswer(value: string, kind: QuestionKind): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");

  return kind === "reading" ? katakanaToHiragana(romajiToHiragana(normalized)) : normalized;
}

function getBlacklistedMeanings(item: ReviewItem): string[] {
  return (item.subject.data.auxiliary_meanings ?? [])
    .filter((meaning) => meaning.type === "blacklist")
    .map((meaning) => meaning.meaning);
}

function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
