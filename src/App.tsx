import { SubjectCharacter, stripMarkup, type DetailSectionName } from "./components/SubjectDetails";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  CheckCircle2,
  BookOpen,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { getErrorMessage, WaniKaniClient, WaniKaniError } from "./api/wanikani";
import type {
  CurrentLevelProgress,
  Resource,
  ReviewItem,
  SubjectData,
  SubjectType,
} from "./api/types";
import { playPronunciation } from "./review/audio";
import { getItemLevel, orderReviewItems, type SortMode } from "./review/order";
import { LessonsPage } from "./lessons/LessonsPage";
import { AppHeading } from "./components/AppHeading";
import { QuestionCard } from "./components/QuestionCard";
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
const SEND_MISTAKES_STORAGE_KEY = "wanikani-review-send-mistakes";

interface SyncState {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  username?: string;
  currentLevel?: number;
  currentLevelProgress?: CurrentLevelProgress;
}

type AppView = "review" | "learn" | "lessons";

interface LearnState {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  level: number | null;
  subjects: Array<Resource<SubjectData, SubjectType>>;
}

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
  const [showSessionInfo, setShowSessionInfo] = useState(true);
  const [showDueTable, setShowDueTable] = useState(true);
  const [playAudio, setPlayAudio] = useState(true);
  const [sendMistakes, setSendMistakes] = useState(
    () => localStorage.getItem(SEND_MISTAKES_STORAGE_KEY) === "true",
  );
  const [sortMode, setSortMode] = useState<SortMode>("lower-srs-first");
  const [activeView, setActiveView] = useState<AppView>("review");
  const [lessonsOpened, setLessonsOpened] = useState(false);
  const [learnLevel, setLearnLevel] = useState(
    () => syncState.currentLevel ?? 1,
  );
  const [learnState, setLearnState] = useState<LearnState>({
    status: "idle",
    message: "",
    level: null,
    subjects: [],
  });
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
  const dueBreakdown = getDueBreakdown(
    session,
    sortMode,
    syncState.currentLevel,
  );

  const client = useMemo(
    () => (token.trim() ? new WaniKaniClient(token.trim()) : null),
    [token],
  );

  useEffect(() => {
    if (syncState.currentLevel) setLearnLevel(syncState.currentLevel);
  }, [syncState.currentLevel]);

  useEffect(() => {
    if (!client || activeView !== "learn") return;
    if (learnState.status === "ready" && learnState.level === learnLevel)
      return;
    if (learnState.status === "loading" && learnState.level === learnLevel)
      return;

    void loadLevelSubjects(learnLevel);
  }, [activeView, client, learnLevel, learnState.level, learnState.status]);

  useEffect(() => {
    if (
      !reviewStarted ||
      !client ||
      session.totalCount > 0 ||
      syncState.status !== "idle"
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
        currentLevelProgress: loaded.currentLevelProgress,
      });
      setLearnLevel(loaded.currentLevel);
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

    const [nextSession, result] = answerCurrentQuestion(session, answer, sendMistakes);
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

  async function loadLevelSubjects(level: number) {
    if (!client) {
      setLearnState({
        status: "error",
        message: "Add your API token before loading level items.",
        level,
        subjects: [],
      });
      return;
    }

    setLearnState((state) => ({
      ...state,
      status: "loading",
      message: `Loading level ${level} radicals and kanji...`,
      level,
    }));

    try {
      const subjects = await client.getLevelSubjects(level);
      setLearnState({
        status: "ready",
        message:
          subjects.length === 0
            ? `No radical or kanji items found for level ${level}.`
            : "",
        level,
        subjects,
      });
    } catch (error) {
      setLearnState({
        status: "error",
        message:
          error instanceof WaniKaniError
            ? error.message
            : `Could not load level ${level}: ${getErrorMessage(error)}`,
        level,
        subjects: [],
      });
    }
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
          <AppHeading />

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
          <AppHeading warnBeforeReload />
          {syncState.message && (
            <div className="status-strip" data-status={syncState.status}>
              <span>{syncState.message}</span>
            </div>
          )}
        </header>

        <nav className="view-tabs" aria-label="app views">
          <button
            type="button"
            className={activeView === "lessons" ? "active" : undefined}
            onClick={() => {
              setLessonsOpened(true);
              setActiveView("lessons");
            }}
          >
            <BookOpen size={18} /> Lessons
          </button>
          <button
            type="button"
            className={activeView === "review" ? "active" : undefined}
            onClick={() => setActiveView("review")}
          >
            <RotateCcw size={18} />
            Review
          </button>
          <button
            type="button"
            className={activeView === "learn" ? "active" : undefined}
            onClick={() => setActiveView("learn")}
          >
            <BookOpen size={18} />
            Glossary
          </button>
        </nav>

        {activeView === "review" ? (
          <>
            <div className="progress-track" aria-hidden="true">
              <div style={{ width: `${progressPercent}%` }} />
            </div>

            <div className="review-layout">
              <aside className="side-panel" aria-label="review progress">
                <div className="progress-card">
                  <button
                    type="button"
                    className="table-toggle progress-card-toggle"
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
                      {syncState.currentLevelProgress && (
                        <CurrentLevelProgressMetrics
                          progress={syncState.currentLevelProgress}
                        />
                      )}
                    </div>
                  )}
                  {dueBreakdown.length > 0 && (
                    <DueBreakdown
                      rows={dueBreakdown}
                      expanded={showDueTable}
                      onToggle={() => setShowDueTable((shown) => !shown)}
                    />
                  )}
                </div>
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
                    <p>
                      Fetching due assignments and reusing cached item data.
                    </p>
                  </div>
                ) : currentQuestion ? (
                  <QuestionCard
                    item={currentQuestion.item}
                    kind={currentQuestion.kind}
                    answer={answer}
                    feedback={feedback}
                    submitting={
                      submittingAssignmentId ===
                      currentQuestion.item.assignment.id
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
                    className={
                      syncState.status === "loading" ? "spin" : undefined
                    }
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
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={sendMistakes}
                    onChange={(event) => {
                      setSendMistakes(event.target.checked);
                      localStorage.setItem(SEND_MISTAKES_STORAGE_KEY, String(event.target.checked));
                    }}
                  />
                  Send mistakes to WaniKani
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
          </>
        ) : activeView === "learn" ? (
          <LearnPage
            level={learnLevel}
            learnState={learnState}
            onLevelChange={(level) => setLearnLevel(level)}
            onReload={() => void loadLevelSubjects(learnLevel)}
          />
        ) : null}
        <div hidden={activeView !== "lessons"}>
          {client && lessonsOpened && (
            <LessonsPage
              key={token.trim()}
              client={client}
              username={syncState.username}
              currentLevel={syncState.currentLevel}
              onChangeToken={changeToken}
              playAudio={playAudio}
              onPlayAudioChange={setPlayAudio}
              onCompleted={() => {
                if (syncState.currentLevel) {
                  void client
                    .getCurrentLevelProgress(syncState.currentLevel)
                    .then((currentLevelProgress) => {
                      setSyncState((state) => ({
                        ...state,
                        currentLevelProgress,
                      }));
                    })
                    .catch(() => {
                      /* The next review sync will refresh progress. */
                    });
                }
              }}
            />
          )}
        </div>
      </section>
    </main>
  );
}


function LearnPage({
  level,
  learnState,
  onLevelChange,
  onReload,
}: {
  level: number;
  learnState: LearnState;
  onLevelChange: (level: number) => void;
  onReload: () => void;
}) {
  const radicals = learnState.subjects.filter(
    (subject) => subject.object === "radical",
  );
  const kanji = learnState.subjects.filter(
    (subject) => subject.object === "kanji",
  );

  return (
    <div className="learn-page">
      <div className="learn-toolbar">
        <label htmlFor="learn-level">Level</label>
        <input
          id="learn-level"
          type="number"
          min={1}
          max={60}
          value={level}
          onChange={(event) => {
            const nextLevel = Number(event.target.value);
            if (
              Number.isInteger(nextLevel) &&
              nextLevel >= 1 &&
              nextLevel <= 60
            ) {
              onLevelChange(nextLevel);
            }
          }}
        />
        <button
          type="button"
          className="primary-button"
          onClick={onReload}
          disabled={learnState.status === "loading"}
        >
          <RefreshCw
            size={18}
            className={learnState.status === "loading" ? "spin" : undefined}
          />
          {learnState.status === "loading" ? "Loading" : "Load"}
        </button>
      </div>

      {learnState.message && (
        <div
          className="status-strip learn-status"
          data-status={learnState.status}
        >
          <span>{learnState.message}</span>
        </div>
      )}

      {learnState.status === "loading" ? (
        <div
          className="empty-state loading-state"
          role="status"
          aria-live="polite"
        >
          <RefreshCw size={38} className="spin" />
          <h2>Loading level {level}</h2>
          <p>Fetching radicals and kanji.</p>
        </div>
      ) : (
        <div className="learn-content">
          <LearnGroup
            title="Radicals"
            count={radicals.length}
            subjects={radicals}
          />
          <LearnGroup title="Kanji" count={kanji.length} subjects={kanji} />
        </div>
      )}
    </div>
  );
}

function LearnGroup({
  title,
  count,
  subjects,
}: {
  title: string;
  count: number;
  subjects: Array<Resource<SubjectData, SubjectType>>;
}) {
  return (
    <section className="learn-group">
      <div className="learn-group-header">
        <h2>{title}</h2>
        <strong>{count}</strong>
      </div>
      {subjects.length === 0 ? (
        <div className="empty-state compact-empty">
          <p>No items loaded.</p>
        </div>
      ) : (
        <div className="learn-grid">
          {subjects.map((subject) => (
            <LearnSubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      )}
    </section>
  );
}

function LearnSubjectCard({
  subject,
}: {
  subject: Resource<SubjectData, SubjectType>;
}) {
  const meanings = subject.data.meanings
    .filter((meaning) => meaning.accepted_answer)
    .map((meaning) => meaning.meaning);
  const primaryReadings =
    subject.data.readings
      ?.filter((reading) => reading.accepted_answer)
      .map((reading) => reading.reading) ?? [];
  const mnemonic =
    subject.object === "kanji"
      ? subject.data.reading_mnemonic || subject.data.meaning_mnemonic
      : subject.data.meaning_mnemonic;

  return (
    <article className={`learn-card ${subject.object}`}>
      <div className={`learn-characters ${subject.object}`}>
        <SubjectCharacter subjectType={subject.object} {...subject.data} />
      </div>
      <div className="learn-card-body">
        <div>
          <span>Meaning</span>
          <strong>{meanings.join(", ") || subject.data.slug}</strong>
        </div>
        {primaryReadings.length > 0 && (
          <div>
            <span>Reading</span>
            <strong lang="ja">{primaryReadings.join(", ")}</strong>
          </div>
        )}
        {mnemonic && <p>{stripMarkup(mnemonic)}</p>}
      </div>
    </article>
  );
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

function CurrentLevelProgressMetrics({
  progress,
}: {
  progress: CurrentLevelProgress;
}) {
  const kanjiPassedTowardLevelUp = Math.min(
    progress.kanji.passed,
    progress.kanjiRequiredForLevelUp,
  );

  return (
    <>
      <Metric
        label="Level-up kanji"
        value={`${kanjiPassedTowardLevelUp}/${progress.kanjiRequiredForLevelUp}`}
      />
      <Metric
        label="Need kanji"
        value={progress.kanjiRemainingForLevelUp.toString()}
      />
      <Metric
        label="Fastest next level"
        value={formatReviewTime(progress.fastestLevelUpAt)}
      />
      {progress.radicals.nextAvailableAt && (
        <Metric
          label="Next radical"
          value={formatReviewTime(progress.radicals.nextAvailableAt)}
        />
      )}
      {progress.kanji.nextAvailableAt && (
        <Metric
          label="Next kanji"
          value={formatReviewTime(progress.kanji.nextAvailableAt)}
        />
      )}
      {progress.notGuruItems.length > 0 && (
        <>
          <MetricSectionTitle>Current level not Guru</MetricSectionTitle>
          <NotGuruTable items={progress.notGuruItems} />
        </>
      )}
    </>
  );
}

function MetricSectionTitle({ children }: { children: ReactNode }) {
  return <div className="metric-section-title">{children}</div>;
}

function NotGuruTable({
  items,
}: {
  items: CurrentLevelProgress["notGuruItems"];
}) {
  return (
    <div className="not-guru-table-wrap">
      <table
        className="not-guru-table"
        aria-label="current level radical and kanji not Guru"
      >
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>SRS</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.subjectType}-${item.subjectId}`}>
              <td>
                <strong>
                  <SubjectCharacter
                    subjectType={item.subjectType}
                    characters={item.characters}
                    slug={item.slug}
                    character_images={item.characterImages}
                  />
                </strong>
              </td>
              <td>
                <span className={`mini-type ${item.subjectType}`}>
                  {shortType(item.subjectType)}
                </span>
              </td>
              <td>{getSrsLabel(item.srsStage)}</td>
              <td>{formatItemNextReview(item)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatItemNextReview(
  item: CurrentLevelProgress["notGuruItems"][number],
): string {
  if (item.availableAt) return formatReviewTime(item.availableAt);
  if (item.blockedByRadicals.length === 0) return "Lesson";

  return `After ${item.blockedByRadicals
    .map((radical) => radical.characters ?? radical.slug)
    .join(", ")} Guru`;
}

function formatReviewTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export interface DueBreakdown {
  level: number;
  type: "radical" | "kanji" | "vocabulary";
  srs: string;
  srsRank: number;
  count: number;
}

export function getDueBreakdown(
  session: ReviewSessionState,
  sortMode: SortMode,
  currentLevel?: number,
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
    const criticalPathDifference =
      dueBreakdownCriticalPathPriority(left, currentLevel) -
      dueBreakdownCriticalPathPriority(right, currentLevel);
    if (criticalPathDifference !== 0) return criticalPathDifference;

    return compareDueBreakdownRows(left, right, sortMode);
  });
}

function compareDueBreakdownRows(
  left: DueBreakdown,
  right: DueBreakdown,
  sortMode: SortMode,
): number {
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
}

function dueBreakdownCriticalPathPriority(
  row: DueBreakdown,
  currentLevel?: number,
): number {
  if (currentLevel === undefined || row.level !== currentLevel) return 1;
  return row.type === "radical" || row.type === "kanji" ? 0 : 1;
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
