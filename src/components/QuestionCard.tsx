import { Info, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import type { ReviewItem } from "../api/types";
import { getAcceptedAnswers } from "../review/answers";
import { romajiToHiragana } from "../review/kana";
import { getItemLevel } from "../review/order";
import { getSrsGroup, getSrsLabel } from "../review/session";
import { SubjectDetails, SubjectCharacter, type DetailSectionName } from "./SubjectDetails";
import { InlineFeedback } from "./InlineFeedback";
import { WordTypeBadges } from "./WordTypeBadges";

export function QuestionCard({
  item,
  kind,
  answer,
  feedback,
  submitting,
  answerInputRef,
  showDetails,
  openDetailSections,
  onToggleDetails,
  onToggleDetailSection,
  onAnswerChange,
  onSubmit,
  answerId = "answer-input",
  submittingLabel = "Submitting",
  srsLabelOverride,
  srsBadgeFirst = false,
  children,
}: {
  item: ReviewItem;
  kind: "meaning" | "reading";
  answer: string;
  feedback: { correct: boolean; acceptedAnswers: string[] } | null;
  submitting: boolean;
  answerInputRef: RefObject<HTMLInputElement | null>;
  showDetails: boolean;
  openDetailSections: Record<DetailSectionName, boolean>;
  onToggleDetails: () => void;
  onToggleDetailSection: (section: DetailSectionName) => void;
  onAnswerChange: (answer: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  answerId?: string;
  submittingLabel?: string;
  srsLabelOverride?: string;
  srsBadgeFirst?: boolean;
  children?: ReactNode;
}) {
  const acceptedAnswers = getAcceptedAnswers(item, kind);
  const level = getItemLevel(item);
  const srsLabel = srsLabelOverride ?? getSrsLabel(item.assignment.data.srs_stage);
  const srsGroup = getSrsGroup(item.assignment.data.srs_stage);
  const srsBadge = (
    <span
      className={`srs-badge ${srsGroup}`}
      title={`SRS stage ${item.assignment.data.srs_stage}`}
    >
      {srsLabel}
    </span>
  );
  const inputHint = kind === "meaning" ? "romaji" : "auto hiragana";
  const [readingMeaningOpen, setReadingMeaningOpen] = useState(false);
  const meaningOpen =
    kind === "meaning" ? openDetailSections.meaning : readingMeaningOpen;

  useEffect(() => {
    if (kind === "reading") setReadingMeaningOpen(false);
  }, [item.assignment.id, kind]);

  return (
    <article
      className={`review-card ${feedback ? (feedback.correct ? "answer-correct" : "answer-incorrect") : ""}`}
    >
      <div className="review-main">
        <div className="item-meta">
          {srsBadgeFirst && srsBadge}
          <span className={`type-badge ${item.subject.object}`}>
            {item.subject.object.replace("_", " ")}
          </span>
          <span>Level {Number.isFinite(level) ? level : "-"}</span>
          {!srsBadgeFirst && srsBadge}
          <WordTypeBadges item={item} />
        </div>

        <div className={`characters ${item.subject.object}`} lang="ja">
          <SubjectCharacter
            subjectType={item.subject.object}
            {...item.subject.data}
          />
        </div>

        <form onSubmit={onSubmit} className="answer-form" autoComplete="off">
          <label htmlFor={answerId}>
            {kind} <span>{inputHint}</span>
          </label>
          <input
            id={answerId}
            ref={answerInputRef}
            name={answerId === "lesson-answer" ? "wanikani-lesson-answer" : "wanikani-review-answer"}
            value={answer}
            onChange={(event) =>
              onAnswerChange(
                kind === "reading"
                  ? romajiToHiragana(event.target.value, {
                      preserveTrailingN: true,
                    })
                  : event.target.value,
              )
            }
            placeholder={
              kind === "meaning"
                ? "Enter meaning in romaji"
                : "Enter reading in hiragana"
            }
            lang={kind === "reading" ? "ja" : "en"}
            inputMode="text"
            disabled={submitting}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
          <button
            type="submit"
            className="primary-button"
            disabled={submitting || !answer.trim()}
          >
            <RotateCcw size={18} />
            {submitting ? submittingLabel : "Answer"}
          </button>
        </form>

        {feedback && !feedback.correct && (
          <InlineFeedback feedback={feedback} />
        )}
        {children}
      </div>

      <div className="details-header">
        <button type="button" onClick={onToggleDetails}>
          <Info size={18} />
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {showDetails && (
        <SubjectDetails item={item} kind={kind}
          openDetailSections={{ ...openDetailSections, meaning: meaningOpen }}
          onToggleDetailSection={(section) => {
            if (section === "meaning" && kind === "reading") setReadingMeaningOpen((open) => !open);
            else onToggleDetailSection(section);
          }} />
      )}
      <p className="sr-only">
        Accepted answers include {acceptedAnswers.join(", ")}.
      </p>
    </article>
  );
}
