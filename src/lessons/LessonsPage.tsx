import { CheckCircle2, RefreshCw } from "lucide-react";
import { QuestionCard } from "../components/QuestionCard";
import type { DetailSectionName } from "../components/SubjectDetails";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ReviewItem } from "../api/types";
import {
  getErrorMessage,
  WaniKaniClient,
} from "../api/wanikani";
import {
  checkAnswer,
  getRequiredQuestionKinds,
  type AnswerCheckResult,
} from "../review/answers";
import { playPronunciation } from "../review/audio";
import { getItemLevel } from "../review/order";
import { useLessonSaves } from "./useLessonSaves";

export function LessonsPage({
  client,
  onCompleted,
  username,
  currentLevel,
  onChangeToken,
  playAudio = true,
  onPlayAudioChange,
}: {
  client: WaniKaniClient;
  onCompleted: () => void;
  username?: string;
  currentLevel?: number;
  onChangeToken?: () => void;
  playAudio?: boolean;
  onPlayAudioChange?: (enabled: boolean) => void;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  const { saves, saved: completed, resetSaved, enqueue, retry } = useLessonSaves(client, onCompleted);
  const pendingCount = saves.filter((save) => save.status !== "failed").length;
  const failedCount = saves.length - pendingCount;
  const [showDetails, setShowDetails] = useState(true);
  const [openDetailSections, setOpenDetailSections] = useState<Record<DetailSectionName, boolean>>({
    meaning: true, reading: true, composition: true, context: true,
  });
  const [localPlayAudio, setLocalPlayAudio] = useState(playAudio);
  const audioEnabled = onPlayAudioChange ? playAudio : localPlayAudio;
  const total = items.length + completed + saves.length;
  const progressPercent = total ? Math.round((completed / total) * 100) : 0;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMessage("");
    client.loadAvailableLessons().then(
      (loaded) => {
        if (!cancelled) {
          setItems(loaded);
          setStatus("ready");
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setMessage(getErrorMessage(error));
          setStatus("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  return (
    <section className="learn-page" aria-label="Available lessons">
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="review-layout">
        <LessonStatistics items={items} completed={completed} status={status} username={username} currentLevel={currentLevel} pendingCount={pendingCount} failedCount={failedCount} />
        <div className="learn-page review-center">
          {status === "loading" && (
            <div
              className="empty-state loading-state"
              role="status"
              aria-live="polite"
            >
              <RefreshCw size={38} className="spin" />
              <h2>Loading available lessons</h2>
              <p>Fetching unlocked assignments and lesson item data.</p>
            </div>
          )}
          {status === "error" && (
            <div className="empty-state">
              <p role="alert">{message}</p>
              <button type="button" className="primary-button" onClick={() => setReload((value) => value + 1)}>
                <RefreshCw size={18} /> Retry loading lessons
              </button>
            </div>
          )}
          {status === "ready" &&
            (items[0] ? (
              <Lesson
                key={items[0].assignment.id}
                item={items[0]}
                playAudio={audioEnabled}
                showDetails={showDetails}
                onToggleDetails={() => setShowDetails((shown) => !shown)}
                openDetailSections={openDetailSections}
                onToggleDetailSection={(section) => setOpenDetailSections((sections) => ({ ...sections, [section]: !sections[section] }))}
                onPassed={() => {
                  enqueue(items[0]);
                  setItems((remaining) => remaining.slice(1));
                }}
              />
            ) : (
              <div className="empty-state">
                {pendingCount ? <RefreshCw size={38} className="spin" /> : <CheckCircle2 size={38} />}
                <h2>
                  {failedCount ? "Lessons need saving" : pendingCount ? "Finishing lesson saves" : completed ? "Lessons saved to WaniKani" : "No lessons available"}
                </h2>
                <p>
                  {saves.length ? "Check background saves in the sidebar." : "New radicals, kanji, vocabulary, and kana vocabulary appear here when they become available in WaniKani."}
                </p>
              </div>
            ))}
        </div>
        <aside className="side-panel side-actions" aria-label="lesson actions">
          <button
            type="button"
            className="primary-button"
            disabled={status === "loading" || saves.length > 0}
            onClick={() => { resetSaved(); setReload((value) => value + 1); }}
          >
            <RefreshCw size={18} className={status === "loading" ? "spin" : undefined} />
            {status === "loading" ? "Syncing" : "Sync"}
          </button>
          {onChangeToken && <button type="button" disabled={saves.length > 0} onClick={onChangeToken}>Change token</button>}
          {pendingCount > 0 && (
            <div className="status-strip" role="status" aria-live="polite">
              <RefreshCw size={18} className="spin" /> Saving lessons in background ({pendingCount} pending)
            </div>
          )}
          {saves.filter((save) => save.status === "failed").map((save) => (
            <div className="status-strip" data-status="error" key={save.item.assignment.id}>
              <p role="alert">{save.item.subject.data.characters ?? save.item.subject.data.slug}: {save.error}</p>
              <button type="button" onClick={() => retry(save.item.assignment.id)} aria-label={`Retry saving lesson ${save.item.assignment.id}`}>
                Retry saving lesson
              </button>
            </div>
          ))}
          <label className="toggle-row">
            <input type="checkbox" checked={audioEnabled} onChange={(event) => {
              if (onPlayAudioChange) onPlayAudioChange(event.target.checked);
              else setLocalPlayAudio(event.target.checked);
            }} />
            Play audio
          </label>
        </aside>
      </div>
    </section>
  );
}

function LessonStatistics({
  items,
  completed,
  status,
  username,
  currentLevel,
  pendingCount,
  failedCount,
}: {
  pendingCount: number;
  failedCount: number;
  username?: string;
  currentLevel?: number;
  items: ReviewItem[];
  completed: number;
  status: "loading" | "ready" | "error";
}) {
  const [showSessionInfo, setShowSessionInfo] = useState(true);
  const [showDueTable, setShowDueTable] = useState(true);
  const levels = new Map<number, { radical: number; kanji: number; vocabulary: number }>();
  for (const item of items) {
    const level = getItemLevel(item);
    const counts = levels.get(level) ?? { radical: 0, kanji: 0, vocabulary: 0 };
    const type = item.subject.object === "kana_vocabulary" ? "vocabulary" : item.subject.object;
    counts[type] += 1;
    levels.set(level, counts);
  }
  const total = items.length + completed + pendingCount + failedCount;
  const done = total ? Math.round((completed / total) * 100) : 0;

  return (
    <aside className="side-panel" aria-label="lesson progress">
      <div className="progress-card">
        <button
          type="button"
          className="table-toggle progress-card-toggle"
          aria-expanded={showSessionInfo}
          onClick={() => setShowSessionInfo((shown) => !shown)}
        >
          <span>Session info</span>
          <strong>{showSessionInfo ? "Hide" : "Show"}</strong>
        </button>
        {showSessionInfo && (
          <div className="metrics">
            <div className="metric"><span>User</span><strong>{username ?? "-"}</strong></div>
            <div className="metric"><span>Level</span><strong>{currentLevel ?? "-"}</strong></div>
            <div className="metric"><span>Due</span><strong>{status === "ready" ? items.length : "-"}</strong></div>
            <div className="metric"><span>Saved</span><strong>{completed}</strong></div>
            {pendingCount > 0 && <div className="metric"><span>Pending</span><strong>{pendingCount}</strong></div>}
            {failedCount > 0 && <div className="metric"><span>Failed</span><strong>{failedCount}</strong></div>}
            <div className="metric"><span>Done</span><strong>{status === "ready" ? `${done}%` : "-"}</strong></div>
          </div>
        )}
        {status === "ready" && (
          <div className="due-table-wrap">
            <button
              type="button"
              className="table-toggle"
              aria-expanded={showDueTable}
              onClick={() => setShowDueTable((shown) => !shown)}
            >
              <span>Due by level</span>
              <strong>{showDueTable ? "Hide" : "Show"}</strong>
            </button>
            {showDueTable && (items.length ? (
              <table className="due-table" aria-label="due lessons by level and type">
                <thead><tr><th scope="col">Lv</th><th scope="col">Type</th><th scope="col">Count</th></tr></thead>
                <tbody>
                  {[...levels.entries()].sort(([left], [right]) => left - right).flatMap(([level, counts]) =>
                    (["radical", "kanji", "vocabulary"] as const).filter((type) => counts[type] > 0).map((type) => (
                      <tr key={`${level}-${type}`}>
                        <td>{Number.isFinite(level) ? level : "-"}</td>
                        <td><span className={`mini-type ${type}`}>{type === "radical" ? "Radical" : type === "kanji" ? "Kanji" : "Vocabulary"}</span></td>
                        <td>{counts[type]}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            ) : <p className="metric">No lessons due</p>)}
          </div>
        )}
      </div>
    </aside>
  );
}

function Lesson({
  item,
  onPassed,
  playAudio,
  showDetails,
  onToggleDetails,
  openDetailSections,
  onToggleDetailSection,
}: {
  playAudio: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
  openDetailSections: Record<DetailSectionName, boolean>;
  onToggleDetailSection: (section: DetailSectionName) => void;
  item: ReviewItem;
  onPassed: () => void;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<AnswerCheckResult | null>(null);
  const passedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const kinds = getRequiredQuestionKinds(item);
  const kind = kinds[questionIndex];
  useEffect(() => {
    inputRef.current?.focus();
  }, [questionIndex]);

  function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (passedRef.current || !answer.trim()) return;
    const result = checkAnswer(item, kind, answer);
    setAnswer("");
    if (!result.correct) {
      setFeedback(result);
      inputRef.current?.focus();
      return;
    }
    setFeedback(result);
    if (playAudio && kind === "reading") {
      void playPronunciation(item).catch(() => {});
    }
    if (questionIndex + 1 === kinds.length) {
      passedRef.current = true;
      onPassed();
    } else setQuestionIndex((index) => index + 1);
  }

  return (
    <QuestionCard
      item={item}
      kind={kind}
      answer={answer}
      feedback={feedback}
      submitting={false}
      srsLabelOverride={item.assignment.data.srs_stage === 0 ? "Lesson" : undefined}
      srsBadgeFirst
      answerId="lesson-answer"
      answerInputRef={inputRef}
      showDetails={showDetails}
      openDetailSections={openDetailSections}
      onToggleDetails={onToggleDetails}
      onToggleDetailSection={onToggleDetailSection}
      onAnswerChange={setAnswer}
      onSubmit={submitAnswer}
    />
  );
}
