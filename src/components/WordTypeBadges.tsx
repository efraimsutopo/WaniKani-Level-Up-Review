import type { ReviewItem } from "../api/types";

export function WordTypeBadges({ item }: { item: ReviewItem }) {
  if (item.subject.object !== "vocabulary" && item.subject.object !== "kana_vocabulary") return null;
  const wordTypes = [...new Set(item.subject.data.parts_of_speech ?? [])];
  if (!wordTypes.length) return null;

  return (
    <div className="word-type-badges" role="group" aria-label="Word type">
      {wordTypes.map((wordType) => (
        <span className="word-type-badge" key={wordType}>{wordType}</span>
      ))}
    </div>
  );
}
