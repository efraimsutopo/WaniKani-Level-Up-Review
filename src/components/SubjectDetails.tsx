import type { ReactNode } from "react";
import type { ReviewItem, SubjectType, SubjectCharacterImage } from "../api/types";
import { getAcceptedAnswers } from "../review/answers";
export type DetailSectionName = "meaning" | "reading" | "composition" | "context";

export function SubjectDetails({ item, kind, openDetailSections, onToggleDetailSection }: {
  item: ReviewItem;
  kind?: "meaning" | "reading";
  openDetailSections: Record<DetailSectionName, boolean>;
  onToggleDetailSection: (section: DetailSectionName) => void;
}) {
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
  return (
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

          {(item.subject.data.readings?.length ?? 0) > 0 && <DetailSection
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
          </DetailSection>}

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
  );
}

export function SubjectCharacter({
  subjectType,
  characters,
  slug,
  character_images,
}: {
  subjectType: SubjectType;
  characters: string | null;
  slug: string;
  character_images?: SubjectCharacterImage[];
}) {
  const image =
    subjectType === "radical" && !characters
      ? (character_images?.find(
          (entry) => entry.content_type === "image/svg+xml",
        ) ?? character_images?.[0])
      : null;

  return image ? (
    <img className="subject-character-image" src={image.url} alt={slug} />
  ) : (
    <span lang={characters ? "ja" : undefined}>{characters ?? slug}</span>
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
                  <strong>
                    <SubjectCharacter
                      subjectType={component.object}
                      {...component.data}
                    />
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

export function stripMarkup(value: string): string {
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
