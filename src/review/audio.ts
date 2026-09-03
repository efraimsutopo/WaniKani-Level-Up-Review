import type { ReviewItem } from "../api/types";

export function getPreferredAudioUrl(item: ReviewItem): string | null {
  const audios = item.subject.data.pronunciation_audios ?? [];
  const supported = audios.find((audio) => audio.content_type === "audio/mpeg") ?? audios[0];
  return supported?.url ?? null;
}

export async function playPronunciation(item: ReviewItem): Promise<void> {
  const url = getPreferredAudioUrl(item);
  if (!url) return;

  const audio = new Audio(url);
  await audio.play();
}
