import { describe, expect, it } from "vitest";
import type { ReviewItem } from "../api/types";
import { getPreferredAudioUrl } from "./audio";

describe("audio", () => {
  it("prefers mp3 pronunciation audio", () => {
    expect(getPreferredAudioUrl(item())).toBe("https://example.com/audio.mp3");
  });
});

function item(): ReviewItem {
  return {
    assignment: {
      id: 1,
      object: "assignment",
      url: "",
      data_updated_at: "",
      data: {
        subject_id: 2,
        subject_type: "vocabulary",
        level: 1,
        srs_stage: 1,
        passed_at: null,
        available_at: null,
        passed: false,
        hidden: false,
      },
    },
    subject: {
      id: 2,
      object: "vocabulary",
      url: "",
      data_updated_at: "",
      data: {
        characters: "一",
        slug: "one",
        level: 1,
        meanings: [{ meaning: "One", primary: true, accepted_answer: true }],
        readings: [{ reading: "いち", primary: true, accepted_answer: true }],
        pronunciation_audios: [
          {
            url: "https://example.com/audio.ogg",
            content_type: "audio/ogg",
            metadata: {
              pronunciation: "いち",
              voice_actor_name: "Kenichi",
              gender: "male",
              voice_description: "Tokyo accent",
            },
          },
          {
            url: "https://example.com/audio.mp3",
            content_type: "audio/mpeg",
            metadata: {
              pronunciation: "いち",
              voice_actor_name: "Kenichi",
              gender: "male",
              voice_description: "Tokyo accent",
            },
          },
        ],
      },
    },
  };
}
