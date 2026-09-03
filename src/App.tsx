import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { getErrorMessage, WaniKaniClient, WaniKaniError } from "./api/wanikani";
import type { ReviewItem } from "./api/types";
import { getAcceptedAnswers } from "./review/answers";
import { playPronunciation } from "./review/audio";
import { romajiToHiragana } from "./review/kana";
import { getItemLevel, orderReviewItems, type SortMode } from "./review/order";
import {
  answerCurrentQuestion,
  createReviewSession,
  getSrsGroup,
  getSrsLabel,
  getSrsSortRank,
  type AnswerResult,
  type ReviewSessionState,
} from "./review/session";

const TOKEN_STORAGE_KEY = "wanikani-review-token";

interface SyncState {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  username?: string;
  currentLevel?: number;
}

type DetailSectionName = "meaning" | "reading" | "composition" | "context";

export function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  );
  const [showToken, setShowToken] = useState(false);
  const [reviewStarted, setReviewStarted] = useState(() =>
    Boolean(localStorage.getItem(TOKEN_STORAGE_KEY)),
  );
  const [syncState, setSyncState] = useState<SyncState>({
    status: token ? "idle" : "error",
    message: token
      ? "Ready to sync due reviews."
      : "Add your WaniKani API token to begin.",
  });
  const [session, setSession] = useState<ReviewSessionState>(() =>
    createReviewSession([]),
  );
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [openDetailSections, setOpenDetailSections] = useState<
    Record<DetailSectionName, boolean>
  >({
    meaning: true,
    reading: true,
    composition: true,
    context: true,
  });
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [showDueTable, setShowDueTable] = useState(false);
  const [playAudio, setPlayAudio] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("lower-srs-first");
  const [submittingAssignmentId, setSubmittingAssignmentId] = useState<
    number | null
  >(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const currentQuestion = session.queue[0];
  const dueCount = session.totalCount - session.completedCount;
  const progressPercent =
    session.totalCount === 0
      ? 0
      : Math.round((session.completedCount / session.totalCount) * 100);
  const dueBreakdown = getDueBreakdown(session, sortMode);

  const client = useMemo(
    () => (token.trim() ? new WaniKaniClient(token.trim()) : null),
    [token],
  );

  useEffect(() => {
    if (
      !reviewStarted ||
      !client ||
      session.totalCount > 0 ||
      syncState.status === "loading"
    )
      return;
    void syncReviews();
  }, [client, reviewStarted, session.totalCount, syncState.status]);

  useEffect(() => {
    if (
      syncState.status !== "ready" ||
      !syncState.message.startsWith("Loaded ")
    )
      return;
    const timer = window.setTimeout(() => {
      setSyncState((state) =>
        state.status === "ready" ? { ...state, message: "" } : state,
      );
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [syncState.status, syncState.message]);

  function saveToken(nextToken: string) {
    setToken(nextToken);
    if (nextToken.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, nextToken.trim());
      setSyncState({
        status: "idle",
        message: "Token saved. Sync due reviews when ready.",
      });
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setSyncState({
        status: "error",
        message: "Add your WaniKani API token to begin.",
      });
    }
  }

  async function syncReviews() {
    if (!client) {
      setSyncState({
        status: "error",
        message: "Add your API token before syncing.",
      });
      return;
    }

    setFeedback(null);
    setAnswer("");
    setSyncState({
      status: "loading",
      message: "Syncing due reviews from WaniKani...",
    });

    try {
      const loaded = await client.loadDueReviewItems();
      const orderedItems = orderReviewItems(
        loaded.items,
        loaded.currentLevel,
        sortMode,
      );
      setSession(createReviewSession(orderedItems));
      setSyncState({
        status: "ready",
        message:
          orderedItems.length === 0
            ? "No reviews are due right now."
            : `Loaded ${orderedItems.length} due review${orderedItems.length === 1 ? "" : "s"}.`,
        username: loaded.username,
        currentLevel: loaded.currentLevel,
      });
      setReviewStarted(true);
      requestAnimationFrame(() => answerInputRef.current?.focus());
    } catch (error) {
      setSession(createReviewSession([]));
      setSyncState({
        status: "error",
        message:
          error instanceof WaniKaniError
            ? error.message
            : `Could not sync WaniKani reviews: ${getErrorMessage(error)}`,
      });
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentQuestion || !answer.trim()) return;

    const [nextSession, result] = answerCurrentQuestion(session, answer);
    if (playAudio && result.correct && currentQuestion.kind === "reading") {
      void playPronunciation(currentQuestion.item);
    }

    if (result.submitReadyReview && client) {
      const assignmentId = result.submitReadyReview.payload.assignment_id;
      setSubmittingAssignmentId(assignmentId);
      try {
        await client.createReview(result.submitReadyReview.payload);
        setSession(nextSession);
        setFeedback(result);
        setAnswer("");
      } catch (error) {
        setFeedback({
          ...result,
          correct: false,
          completedItem: false,
          submitReadyReview: undefined,
        });
        setSyncState({
          status: "error",
          message:
            error instanceof WaniKaniError
              ? `WaniKani rejected the submit: ${error.message}`
              : `WaniKani review submit failed: ${getErrorMessage(error)}`,
        });
      } finally {
        setSubmittingAssignmentId(null);
        requestAnimationFrame(() => answerInputRef.current?.focus());
      }

      return;
    }

    setSession(nextSession);
    setFeedback(result);
    setAnswer("");
    requestAnimationFrame(() => answerInputRef.current?.focus());
  }

  function changeToken() {
    setReviewStarted(false);
    setSession(createReviewSession([]));
    setFeedback(null);
    setAnswer("");
  }

  function changeSortMode(nextSortMode: SortMode) {
    setSortMode(nextSortMode);
    setSession((state) =>
      reorderSession(state, syncState.currentLevel ?? 0, nextSortMode),
    );
    requestAnimationFrame(() => answerInputRef.current?.focus());
  }

  if (!reviewStarted) {
    return (
      <main className="app-shell login-shell">
        <section className="login-panel" aria-label="WaniKani API token setup">
          <div>
            <p className="eyebrow">Level-up review</p>
            <h1>WaniKani Queue</h1>
          </div>

          <form
            className="login-form"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void syncReviews();
            }}
          >
            <label htmlFor="api-token">API token</label>
            <div className="token-input">
              <input
                id="api-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => saveToken(event.target.value)}
                placeholder="Paste a WaniKani v2 token"
                autoComplete="off"
                autoFocus
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowToken((shown) => !shown)}
              >
                {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                <span className="tooltip">
                  {showToken ? "Hide token" : "Show token"}
                </span>
              </button>
            </div>
            <button
              type="submit"
              className="primary-button"
              disabled={!token.trim() || syncState.status === "loading"}
            >
              <RefreshCw
                size={18}
                className={syncState.status === "loading" ? "spin" : undefined}
              />
              {syncState.status === "loading" ? "Syncing" : "Start reviews"}
            </button>
          </form>

          {syncState.message && (
            <div className="status-strip" data-status={syncState.status}>
              <span>{syncState.message}</span>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="review-panel" aria-label="WaniKani review app">
        <header className="topbar">
          <div>
            <p className="eyebrow">Level-up review</p>
            <h1>WaniKani Queue</h1>
          </div>
          {syncState.message && (
            <div className="status-strip" data-status={syncState.status}>
              <span>{syncState.message}</span>
            </div>
          )}
        </header>

        <div className="progress-track" aria-hidden="true">
          <div style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="review-layout">
          <aside className="side-panel" aria-label="review progress">
            <button
              type="button"
              className="table-toggle"
              onClick={() => setShowSessionInfo((shown) => !shown)}
            >
              <span>Session info</span>
              <strong>{showSessionInfo ? "Hide" : "Show"}</strong>
            </button>
            {showSessionInfo && (
              <div className="metrics">
                <Metric label="User" value={syncState.username ?? "-"} />
                <Metric
                  label="Level"
                  value={syncState.currentLevel?.toString() ?? "-"}
                />
                <Metric label="Due" value={dueCount.toString()} />
                <Metric label="Done" value={`${progressPercent}%`} />
              </div>
            )}
            {dueBreakdown.length > 0 && (
              <DueBreakdown
                rows={dueBreakdown}
                expanded={showDueTable}
                onToggle={() => setShowDueTable((shown) => !shown)}
              />
            )}
          </aside>

          <div className="review-center">
            {syncState.status === "loading" ? (
              <div
                className="empty-state loading-state"
                role="status"
                aria-live="polite"
              >
                <RefreshCw size={38} className="spin" />
                <h2>Syncing reviews</h2>
                <p>Fetching due assignments and reusing cached item data.</p>
              </div>
            ) : currentQuestion ? (
              <ReviewCard
                item={currentQuestion.item}
                kind={currentQuestion.kind}
                answer={answer}
                feedback={feedback}
                submitting={
                  submittingAssignmentId === currentQuestion.item.assignment.id
                }
                answerInputRef={answerInputRef}
                showDetails={showDetails}
                openDetailSections={openDetailSections}
                onToggleDetails={() => setShowDetails((shown) => !shown)}
                onToggleDetailSection={(section) =>
                  setOpenDetailSections((sections) => ({
                    ...sections,
                    [section]: !sections[section],
                  }))
                }
                onAnswerChange={setAnswer}
                onSubmit={submitAnswer}
              />
            ) : (
              <div className="empty-state">
                <CheckCircle2 size={38} />
                <h2>
                  {session.totalCount === 0
                    ? "No active session"
                    : "Session complete"}
                </h2>
                <p>
                  {session.totalCount === 0
                    ? "Sync due reviews to start."
                    : "All local review questions are complete."}
                </p>
              </div>
            )}
          </div>

          <aside
            className="side-panel side-actions"
            aria-label="review actions"
          >
            <button
              type="button"
              className="primary-button"
              onClick={syncReviews}
              disabled={!token.trim() || syncState.status === "loading"}
            >
              <RefreshCw
                size={18}
                className={syncState.status === "loading" ? "spin" : undefined}
              />
              {syncState.status === "loading" ? "Syncing" : "Sync"}
            </button>
            <button type="button" onClick={changeToken}>
              Change token
            </button>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={playAudio}
                onChange={(event) => setPlayAudio(event.target.checked)}
              />
              Play audio
            </label>
            <div className="sort-card" aria-label="sort mode">
              <span>Sort remaining</span>
              <div className="segmented-control">
                <button
                  type="button"
                  className={
                    sortMode === "lower-srs-first" ? "active" : undefined
                  }
                  onClick={() => changeSortMode("lower-srs-first")}
                >
                  Lower SRS
                </button>
                <button
                  type="button"
                  className={
                    sortMode === "lower-level-first" ? "active" : undefined
                  }
                  onClick={() => changeSortMode("lower-level-first")}
                >
                  Lower level
                </button>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function ReviewCard({
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
}: {
  item: ReviewItem;
  kind: "meaning" | "reading";
  answer: string;
  feedback: AnswerResult | null;
  submitting: boolean;
  answerInputRef: RefObject<HTMLInputElement | null>;
  showDetails: boolean;
  openDetailSections: Record<DetailSectionName, boolean>;
  onToggleDetails: () => void;
  onToggleDetailSection: (section: DetailSectionName) => void;
  onAnswerChange: (answer: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const acceptedAnswers = getAcceptedAnswers(item, kind);
  const meaningAnswers = getAcceptedAnswers(item, "meaning");
  const primaryMeanings = item.subject.data.meanings
    .filter((meaning) => meaning.primary && meaning.accepted_answer)
    .map((meaning) => meaning.meaning);
  const alternativeMeanings = item.subject.data.meanings
    .filter((meaning) => !meaning.primary && meaning.accepted_answer)
    .map((meaning) => meaning.meaning);
  const readingAnswers = getAcceptedAnswers(item, "reading");
  const readingGroups = getReadingGroups(item);
  const pairedReadings = getPairedReadings(readingGroups);
  const characters = item.subject.data.characters ?? item.subject.data.slug;
  const level = getItemLevel(item);
  const srsLabel = getSrsLabel(item.assignment.data.srs_stage);
  const srsGroup = getSrsGroup(item.assignment.data.srs_stage);
  const inputHint = kind === "meaning" ? "romaji" : "auto hiragana";

  return (
    <article
      className={`review-card ${feedback ? (feedback.correct ? "answer-correct" : "answer-incorrect") : ""}`}
    >
      <div className="review-main">
        <div className="item-meta">
          <span className={`type-badge ${item.subject.object}`}>
            {item.subject.object.replace("_", " ")}
          </span>
          <span>Level {Number.isFinite(level) ? level : "-"}</span>
          <span
            className={`srs-badge ${srsGroup}`}
            title={`SRS stage ${item.assignment.data.srs_stage}`}
          >
            {srsLabel}
          </span>
        </div>

        <div className={`characters ${item.subject.object}`} lang="ja">
          {characters}
        </div>

        <form onSubmit={onSubmit} className="answer-form" autoComplete="off">
          <label htmlFor="answer-input">
            {kind} <span>{inputHint}</span>
          </label>
          <input
            id="answer-input"
            ref={answerInputRef}
            name="wanikani-review-answer"
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
            {submitting ? "Submitting" : "Answer"}
          </button>
        </form>

        {feedback && !feedback.correct && (
          <InlineFeedback feedback={feedback} />
        )}
      </div>

      <div className="details-header">
        <button type="button" onClick={onToggleDetails}>
          <Info size={18} />
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {showDetails && (
        <section className="item-details" aria-label="item details">
          <DetailSection
            title="Meaning"
            active={kind === "meaning"}
            open={openDetailSections.meaning}
            onToggle={() => onToggleDetailSection("meaning")}
          >
            <WordList
              label="Primary"
              values={primaryMeanings.length ? primaryMeanings : meaningAnswers}
            />
            {alternativeMeanings.length > 0 && (
              <WordList label="Alternative" values={alternativeMeanings} />
            )}
            {item.studyMaterial?.data.meaning_synonyms.length ? (
              <WordList
                label="User synonyms"
                values={item.studyMaterial.data.meaning_synonyms}
              />
            ) : null}
            {item.subject.data.parts_of_speech?.length ? (
              <TextBlock
                label="Word type"
                value={item.subject.data.parts_of_speech.join(", ")}
              />
            ) : null}
            {item.subject.data.meaning_mnemonic ? (
              <TextBlock
                label="Explanation"
                value={stripMarkup(item.subject.data.meaning_mnemonic)}
              />
            ) : null}
            {item.subject.data.meaning_hint ? (
              <TextBlock
                label="Hint"
                value={stripMarkup(item.subject.data.meaning_hint)}
              />
            ) : null}
          </DetailSection>

          <DetailSection
            title="Reading"
            active={kind === "reading"}
            open={openDetailSections.reading}
            onToggle={() => onToggleDetailSection("reading")}
          >
            {pairedReadings ? (
              <ReadingPair
                left={pairedReadings.left}
                right={pairedReadings.right}
                active={kind === "reading"}
              />
            ) : null}
            {readingGroups
              .filter(
                (group) =>
                  group.label !== "Onyomi" && group.label !== "Kunyomi",
              )
              .map((group) => (
                <Detail
                  key={group.label}
                  label={group.label}
                  value={group.value}
                  lang="ja"
                  accepted={kind === "reading" && group.accepted}
                />
              ))}
            {!pairedReadings &&
              readingGroups.length === 0 &&
              readingAnswers.length > 0 && (
                <Detail
                  label="Reading"
                  value={readingAnswers.join(", ")}
                  lang="ja"
                  accepted={kind === "reading"}
                />
              )}
            {item.subject.data.reading_mnemonic ? (
              <TextBlock
                label="Explanation"
                value={stripMarkup(item.subject.data.reading_mnemonic)}
              />
            ) : null}
            {item.subject.data.reading_hint ? (
              <TextBlock
                label="Hint"
                value={stripMarkup(item.subject.data.reading_hint)}
              />
            ) : null}
          </DetailSection>

          {item.components?.length ? (
            <ComponentCards
              label={item.subject.object === "kanji" ? "Radicals" : "Kanji"}
              components={item.components}
              open={openDetailSections.composition}
              onToggle={() => onToggleDetailSection("composition")}
            />
          ) : null}
          {item.subject.data.context_sentences?.length ? (
            <ContextSentences
              sentences={item.subject.data.context_sentences}
              open={openDetailSections.context}
              onToggle={() => onToggleDetailSection("context")}
            />
          ) : null}
        </section>
      )}
      <p className="sr-only">
        Accepted answers include {acceptedAnswers.join(", ")}.
      </p>
    </article>
  );
}

function getReadingGroups(
  item: ReviewItem,
): Array<{ label: string; value: string; accepted: boolean }> {
  const readings = item.subject.data.readings ?? [];
  const groups = [
    { label: "Onyomi", type: "onyomi" },
    { label: "Kunyomi", type: "kunyomi" },
    { label: "Nanori", type: "nanori" },
  ];

  return groups.flatMap((group) => {
    const groupReadings = readings.filter(
      (reading) => reading.type === group.type,
    );
    const values = groupReadings.map((reading) =>
      reading.accepted_answer ? reading.reading : `${reading.reading}*`,
    );
    const accepted = groupReadings.some((reading) => reading.accepted_answer);

    return values.length > 0
      ? [{ label: group.label, value: values.join(", "), accepted }]
      : [];
  });
}

function Detail({
  label,
  value,
  lang,
  accepted = false,
}: {
  label: string;
  value: string;
  lang?: string;
  accepted?: boolean;
}) {
  return (
    <div className={accepted ? "detail-row accepted-detail" : "detail-row"}>
      <span>{label}</span>
      <strong lang={lang}>{value}</strong>
    </div>
  );
}

function DetailSection({
  title,
  active,
  open,
  onToggle,
  children,
}: {
  title: string;
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={active ? "wk-section active-section" : "wk-section"}>
      <button type="button" className="wk-section-toggle" onClick={onToggle}>
        <span>{title}</span>
        <strong>{open ? "Hide" : "Show"}</strong>
      </button>
      {open && <div className="wk-section-body">{children}</div>}
    </section>
  );
}

function WordList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;

  return (
    <div className="wk-subsection">
      <h3>{label}</h3>
      <ul>
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="wk-subsection">
      <h3>{label}</h3>
      <p>{value}</p>
    </div>
  );
}

function ComponentCards({
  label,
  components,
  open,
  onToggle,
}: {
  label: string;
  components: NonNullable<ReviewItem["components"]>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="wk-section component-detail">
      <button type="button" className="wk-section-toggle" onClick={onToggle}>
        <span>{label}</span>
        <strong>{open ? "Hide" : "Show"}</strong>
      </button>
      {open && (
        <div className="wk-section-body">
          <div className="component-grid">
            {components.map((component) => {
              const name =
                getAcceptedAnswers(
                  {
                    assignment: {
                      id: component.id,
                      object: "assignment",
                      url: "",
                      data_updated_at: "",
                      data: {
                        subject_id: component.id,
                        subject_type: component.object,
                        level: component.data.level,
                        srs_stage: 0,
                        passed_at: null,
                        available_at: null,
                        passed: false,
                        hidden: false,
                      },
                    },
                    subject: component,
                  },
                  "meaning",
                )[0] ?? component.data.slug;
              const readings = getAcceptedAnswers(
                {
                  assignment: {
                    id: component.id,
                    object: "assignment",
                    url: "",
                    data_updated_at: "",
                    data: {
                      subject_id: component.id,
                      subject_type: component.object,
                      level: component.data.level,
                      srs_stage: 0,
                      passed_at: null,
                      available_at: null,
                      passed: false,
                      hidden: false,
                    },
                  },
                  subject: component,
                },
                "reading",
              );

              return (
                <div
                  key={component.id}
                  className={`component-card ${component.object}`}
                >
                  <strong lang="ja">
                    {component.data.characters ?? component.data.slug}
                  </strong>
                  <small>{name}</small>
                  {readings.length > 0 && (
                    <small lang="ja">{readings.slice(0, 2).join(", ")}</small>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function ContextSentences({
  sentences,
  open,
  onToggle,
}: {
  sentences: NonNullable<ReviewItem["subject"]["data"]["context_sentences"]>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="wk-section context-detail">
      <button type="button" className="wk-section-toggle" onClick={onToggle}>
        <span>Context</span>
        <strong>{open ? "Hide" : "Show"}</strong>
      </button>
      {open && (
        <div className="wk-section-body">
          <div className="context-list">
            {sentences.map((sentence) => (
              <div
                key={`${sentence.ja}-${sentence.en}`}
                className="context-sentence"
              >
                <strong lang="ja">{sentence.ja}</strong>
                <small>{sentence.en}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function InlineFeedback({ feedback }: { feedback: AnswerResult }) {
  return (
    <div className="feedback incorrect" role="status">
      <span>Accepted: {feedback.acceptedAnswers.join(", ")}</span>
    </div>
  );
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function ReadingPair({
  left,
  right,
  active,
}: {
  left?: { label: string; value: string; accepted: boolean };
  right?: { label: string; value: string; accepted: boolean };
  active: boolean;
}) {
  return (
    <div className="reading-pair">
      {left ? (
        <Detail
          label={left.label}
          value={left.value}
          lang="ja"
          accepted={active && left.accepted}
        />
      ) : (
        <div />
      )}
      {right ? (
        <Detail
          label={right.label}
          value={right.value}
          lang="ja"
          accepted={active && right.accepted}
        />
      ) : (
        <div />
      )}
    </div>
  );
}

function getPairedReadings(
  readingGroups: Array<{ label: string; value: string; accepted: boolean }>,
) {
  const left = readingGroups.find((group) => group.label === "Onyomi");
  const right = readingGroups.find((group) => group.label === "Kunyomi");
  return left || right ? { left, right } : null;
}

function DueBreakdown({
  rows,
  expanded,
  onToggle,
}: {
  rows: DueBreakdown[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="due-table-wrap">
      <button type="button" className="table-toggle" onClick={onToggle}>
        <span>Due by level</span>
        <strong>{expanded ? "Hide" : "Show"}</strong>
      </button>
      {expanded && (
        <table
          className="due-table"
          aria-label="due reviews by level, type, and SRS"
        >
          <thead>
            <tr>
              <th>Lv</th>
              <th>Type</th>
              <th>SRS</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.level}-${row.type}-${row.srs}`}>
                <td>{row.level}</td>
                <td>
                  <span className={`mini-type ${row.type}`}>
                    {shortType(row.type)}
                  </span>
                </td>
                <td>{row.srs}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface DueBreakdown {
  level: number;
  type: "radical" | "kanji" | "vocabulary";
  srs: string;
  srsRank: number;
  count: number;
}

function getDueBreakdown(
  session: ReviewSessionState,
  sortMode: SortMode,
): DueBreakdown[] {
  const rows = new Map<string, DueBreakdown>();

  for (const item of session.items) {
    const progress = session.progressByAssignmentId[item.assignment.id];
    if (
      !progress ||
      progress.requiredKinds.every((kind) =>
        progress.completedKinds.includes(kind),
      )
    )
      continue;

    const level = getItemLevel(item);
    const type =
      item.subject.object === "kana_vocabulary"
        ? "vocabulary"
        : item.subject.object;
    const srs = getSrsLabel(item.assignment.data.srs_stage);
    const srsRank = getSrsSortRank(item.assignment.data.srs_stage);
    const key = `${level}-${type}-${srs}`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      rows.set(key, { level, type, srs, srsRank, count: 1 });
    }
  }

  return [...rows.values()].sort((left, right) => {
    if (sortMode === "lower-level-first") {
      return (
        left.level - right.level ||
        typeSort(left.type) - typeSort(right.type) ||
        left.srsRank - right.srsRank
      );
    }

    return (
      left.srsRank - right.srsRank ||
      typeSort(left.type) - typeSort(right.type) ||
      left.level - right.level
    );
  });
}

function shortType(type: ReviewItem["subject"]["object"]): string {
  if (type === "radical") return "Rad";
  if (type === "kanji") return "Kan";
  return "Voc";
}

function typeSort(type: ReviewItem["subject"]["object"]): number {
  if (type === "radical") return 0;
  if (type === "kanji") return 1;
  return 2;
}

function reorderSession(
  session: ReviewSessionState,
  currentLevel: number,
  sortMode: SortMode,
): ReviewSessionState {
  if (session.items.length === 0) return session;

  const unfinishedItems = session.items.filter((item) => {
    const progress = session.progressByAssignmentId[item.assignment.id];
    return (
      progress &&
      !progress.requiredKinds.every((kind) =>
        progress.completedKinds.includes(kind),
      )
    );
  });
  const orderedItems = orderReviewItems(
    unfinishedItems,
    currentLevel,
    sortMode,
  );
  const orderedQueue = orderedItems.flatMap((item) => {
    const progress = session.progressByAssignmentId[item.assignment.id];
    return progress.requiredKinds
      .filter((kind) => !progress.completedKinds.includes(kind))
      .map((kind) => ({ item, kind }));
  });

  return {
    ...session,
    queue: orderedQueue,
  };
}
