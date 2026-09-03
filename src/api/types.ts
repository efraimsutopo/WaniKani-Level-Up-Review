export type SubjectType = "radical" | "kanji" | "vocabulary" | "kana_vocabulary";
export type QuestionKind = "meaning" | "reading";

export interface Resource<TData, TObject extends string = string> {
  id: number;
  object: TObject;
  url: string;
  data_updated_at: string;
  data: TData;
}

export interface Collection<T> {
  object: "collection";
  url: string;
  pages: {
    next_url: string | null;
    previous_url: string | null;
    per_page: number;
  };
  total_count: number;
  data_updated_at: string | null;
  data: T[];
}

export interface SummaryReport {
  object: "report";
  url: string;
  data_updated_at: string;
  data: {
    next_reviews_at: string | null;
    reviews: Array<{
      available_at: string;
      subject_ids: number[];
    }>;
  };
}

export interface UserData {
  level: number;
  username: string;
  subscription: {
    active: boolean;
    max_level_granted: number;
  };
}

export interface AssignmentData {
  subject_id: number;
  subject_type: SubjectType;
  level: number;
  srs_stage: number;
  passed_at: string | null;
  available_at: string | null;
  passed: boolean;
  hidden: boolean;
}

export interface SubjectMeaning {
  meaning: string;
  primary: boolean;
  accepted_answer: boolean;
}

export interface SubjectReading {
  reading: string;
  primary: boolean;
  accepted_answer: boolean;
  type?: string;
}

export interface SubjectData {
  characters: string | null;
  slug: string;
  level: number;
  meanings: SubjectMeaning[];
  component_subject_ids?: number[];
  amalgamation_subject_ids?: number[];
  parts_of_speech?: string[];
  meaning_mnemonic?: string;
  reading_mnemonic?: string;
  meaning_hint?: string;
  reading_hint?: string;
  readings?: SubjectReading[];
  pronunciation_audios?: PronunciationAudio[];
  context_sentences?: ContextSentence[];
  auxiliary_meanings?: Array<{
    meaning: string;
    type: "whitelist" | "blacklist";
  }>;
}

export interface ContextSentence {
  en: string;
  ja: string;
}

export interface PronunciationAudio {
  url: string;
  content_type: string;
  metadata: {
    pronunciation: string;
    voice_actor_name: string;
    gender: string;
    voice_description: string;
  };
}

export interface StudyMaterialData {
  subject_id: number;
  meaning_synonyms: string[];
  hidden: boolean;
}

export interface ReviewCreatePayload {
  assignment_id: number;
  incorrect_meaning_answers: number;
  incorrect_reading_answers: number;
  created_at: string;
}

export interface ReviewCreateResponse {
  id: number;
  object: "review";
  data: {
    assignment_id: number;
    subject_id: number;
    starting_srs_stage: number;
    ending_srs_stage: number;
  };
}

export interface ReviewItem {
  assignment: Resource<AssignmentData, "assignment">;
  subject: Resource<SubjectData, SubjectType>;
  components?: Array<Resource<SubjectData, SubjectType>>;
  examples?: Array<Resource<SubjectData, SubjectType>>;
  studyMaterial?: Resource<StudyMaterialData, "study_material">;
}
