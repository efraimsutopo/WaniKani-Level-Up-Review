import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonsPage } from "./LessonsPage";
import { WaniKaniClient, WaniKaniError } from "../api/wanikani";
import * as audio from "../review/audio";
import type { ReviewItem } from "../api/types";

const item: ReviewItem = {
  assignment: {
    id: 42,
    object: "assignment",
    url: "",
    data_updated_at: "",
    data: {
      subject_id: 1,
      subject_type: "kanji",
      level: 1,
      srs_stage: 0,
      passed_at: null,
      available_at: null,
      passed: false,
      hidden: false,
    },
  },
  subject: {
    id: 1,
    object: "kanji",
    url: "",
    data_updated_at: "",
    data: {
      characters: "一",
      slug: "一",
      level: 1,
      meanings: [{ meaning: "One", primary: true, accepted_answer: true }],
      readings: [{ reading: "いち", primary: true, accepted_answer: true }],
      meaning_mnemonic: "<kanji>One</kanji> line.",
      reading_mnemonic: "An itchy line.",
    },
  },
};

const vocabularyItem: ReviewItem = {
  ...item,
  assignment: {
    ...item.assignment,
    data: { ...item.assignment.data, subject_type: "vocabulary" },
  },
  subject: {
    ...item.subject,
    object: "vocabulary",
    data: {
      ...item.subject.data,
      characters: "一人",
      meanings: [
        { meaning: "One person", primary: true, accepted_answer: true },
      ],
      readings: [{ reading: "ひとり", primary: true, accepted_answer: true }],
    },
  },
};

const radicalItem: ReviewItem = {
  ...item,
  assignment: {
    ...item.assignment,
    data: { ...item.assignment.data, subject_type: "radical" },
  },
  subject: {
    ...item.subject,
    object: "radical",
    data: { ...item.subject.data, characters: "口", readings: [] },
  },
};

const kanaVocabularyItem: ReviewItem = {
  ...item,
  assignment: {
    ...item.assignment,
    data: { ...item.assignment.data, subject_type: "kana_vocabulary" },
  },
  subject: {
    ...item.subject,
    object: "kana_vocabulary",
    data: {
      ...item.subject.data,
      characters: "おやつ",
      meanings: [{ meaning: "Snack", primary: true, accepted_answer: true }],
      readings: [],
    },
  },
};

afterEach(() => vi.restoreAllMocks());

async function passQuiz() {
  await screen.findByLabelText("meaning romaji");
  fireEvent.change(screen.getByLabelText("meaning romaji"), {
    target: { value: "one" },
  });
  fireEvent.click(screen.getByText("Answer"));
  fireEvent.change(screen.getByLabelText("reading auto hiragana"), {
    target: { value: "ichi" },
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Answer"));
  });
}

describe("kanji lessons", () => {
  it("keeps detail preferences across lessons and updates the progress bar after saving", async () => {
    vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons").mockResolvedValue([
      item, { ...item, assignment: { ...item.assignment, id: 43 } },
    ]);
    vi.spyOn(WaniKaniClient.prototype, "startAssignment").mockResolvedValue(item.assignment);
    const { container } = render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={vi.fn()} username="leebo" currentLevel={12} />);
    await screen.findByLabelText("meaning romaji");
    expect(screen.getByText("leebo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    await passQuiz();
    await waitFor(() => expect(container.querySelector(".progress-track > div")).toHaveStyle({ width: "50%" }));
    expect(screen.getByLabelText("meaning romaji")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "item details" })).not.toBeInTheDocument();
  });

  it.each([true, false])("respects the Play audio toggle (%s)", async (enabled) => {
    vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons").mockResolvedValue([item]);
    vi.spyOn(WaniKaniClient.prototype, "startAssignment").mockResolvedValue(item.assignment);
    const play = vi.spyOn(audio, "playPronunciation").mockResolvedValue();
    render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={vi.fn()} />);
    await screen.findByLabelText("meaning romaji");
    if (!enabled) fireEvent.click(screen.getByRole("checkbox", { name: "Play audio" }));
    await passQuiz();
    await screen.findByText("Lessons saved to WaniKani");
    expect(play).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it("syncs the lesson queue and exposes the change-token action", async () => {
    const load = vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons")
      .mockResolvedValueOnce([item]).mockResolvedValueOnce([]);
    const changeToken = vi.fn();
    render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={vi.fn()} onChangeToken={changeToken} />);
    await screen.findByLabelText("meaning romaji");
    fireEvent.click(screen.getByRole("button", { name: "Change token" }));
    expect(changeToken).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await screen.findByText("No lessons available");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("groups due lessons by level and type and removes saved lessons from counts", async () => {
    const levelTwoVocabulary: ReviewItem = {
      ...vocabularyItem,
      assignment: { ...vocabularyItem.assignment, id: 43, data: { ...vocabularyItem.assignment.data, level: 2 } },
      subject: { ...vocabularyItem.subject, data: { ...vocabularyItem.subject.data, level: 2 } },
    };
    const levelTwoKana: ReviewItem = {
      ...kanaVocabularyItem,
      assignment: { ...kanaVocabularyItem.assignment, id: 44, data: { ...kanaVocabularyItem.assignment.data, level: 2 } },
      subject: { ...kanaVocabularyItem.subject, data: { ...kanaVocabularyItem.subject.data, level: 2 } },
    };
    vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons")
      .mockResolvedValue([item, levelTwoVocabulary, radicalItem, levelTwoKana]);
    vi.spyOn(WaniKaniClient.prototype, "startAssignment").mockResolvedValue(item.assignment);
    render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={vi.fn()} />);

    const table = await screen.findByRole("table", { name: "due lessons by level and type" });
    const rows = () => within(table).getAllByRole("row").slice(1).map((row) =>
      within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows()).toEqual([
      ["1", "Radical", "1"], ["1", "Kanji", "1"], ["2", "Vocabulary", "2"],
    ]);
    await passQuiz();
    await waitFor(() => expect(rows()).toEqual([
      ["1", "Radical", "1"], ["2", "Vocabulary", "2"],
    ]));
    const statistics = within(screen.getByRole("complementary", { name: "lesson progress" }));
    expect(statistics.getByText("Due").parentElement).toHaveTextContent("Due3");
    expect(statistics.getByText("Saved").parentElement).toHaveTextContent("Saved1");
    expect(statistics.getByText("Done").parentElement).toHaveTextContent("Done25%");
    fireEvent.click(statistics.getByRole("button", { name: "Due by level Hide" }));
    expect(screen.queryByRole("table", { name: "due lessons by level and type" })).not.toBeInTheDocument();
  });

  it("automatically saves after correct meaning and reading and prevents duplicate submissions", async () => {
    vi.spyOn(
      WaniKaniClient.prototype,
      "loadAvailableLessons",
    ).mockResolvedValue([item]);
    let finish!: (value: ReviewItem["assignment"]) => void;
    const start = vi
      .spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const completed = vi.fn();
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={completed}
      />,
    );
    expect(await screen.findByLabelText("meaning romaji")).toHaveFocus();
    expect(screen.queryByText("Start lesson quiz")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "item details" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("meaning romaji"), {
      target: { value: "two" },
    });
    fireEvent.click(screen.getByText("Answer"));
    expect(screen.getByRole("status")).toHaveTextContent("Accepted: One");
    expect(screen.getByRole("status")).toHaveClass("feedback", "incorrect");
    expect(screen.getByRole("article")).toHaveClass("answer-incorrect");
    expect(start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("meaning romaji"), {
      target: { value: "one" },
    });
    fireEvent.click(screen.getByText("Answer"));
    expect(start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("reading auto hiragana"), {
      target: { value: "ichi" },
    });
    const form = screen.getByText("Answer").closest("form")!;
    fireEvent.click(screen.getByText("Answer"));
    expect(screen.getByRole("status")).toHaveTextContent("Saving lessons in background (1 pending)");
    expect(screen.getByRole("heading", { name: "Finishing lesson saves" })).toBeInTheDocument();
    expect(screen.queryByText("Lessons saved to WaniKani")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();
    expect(screen.queryByLabelText("reading auto hiragana")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(completed).not.toHaveBeenCalled();
    expect(screen.queryByText("Complete lesson & save to WaniKani")).not.toBeInTheDocument();
    fireEvent.submit(form);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(42);
    await act(async () => finish(item.assignment));
    await screen.findByText("Lessons saved to WaniKani");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("keeps a passed lesson available to retry after a permission failure", async () => {
    vi.spyOn(
      WaniKaniClient.prototype,
      "loadAvailableLessons",
    ).mockResolvedValue([item]);
    const start = vi
      .spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockRejectedValueOnce(new WaniKaniError("Forbidden", 403))
      .mockResolvedValue(item.assignment);
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={vi.fn()}
      />,
    );
    await passQuiz();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "assignments:start",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry saving lesson 42" }));
    await screen.findByText("Lessons saved to WaniKani");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("advances immediately and saves queued lessons sequentially without losing pending counts", async () => {
    const second: ReviewItem = { ...item, assignment: { ...item.assignment, id: 43 } };
    vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons").mockResolvedValue([item, second]);
    const finishes: Array<(value: ReviewItem["assignment"]) => void> = [];
    const start = vi.spyOn(WaniKaniClient.prototype, "startAssignment").mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
    const completed = vi.fn();
    const { container } = render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={completed} />);
    await passQuiz();
    expect(screen.getByLabelText("meaning romaji")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("1 pending");
    expect(completed).not.toHaveBeenCalled();
    expect(container.querySelector(".progress-track > div")).toHaveStyle({ width: "0%" });
    const statistics = within(screen.getByRole("complementary", { name: "lesson progress" }));
    expect(statistics.getByText("Saved").parentElement).toHaveTextContent("Saved0");
    await passQuiz();
    expect(screen.getByRole("status")).toHaveTextContent("2 pending");
    expect(start).toHaveBeenCalledTimes(1);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await act(async () => finishes[0](item.assignment));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(2, 43);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".progress-track > div")).toHaveStyle({ width: "50%" });
    await act(async () => finishes[1](second.assignment));
    expect(screen.getByText("Lessons saved to WaniKani")).toBeInTheDocument();
    expect(completed).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Sync" })).toBeEnabled();
    const afterSave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSave);
    expect(afterSave.defaultPrevented).toBe(false);
  });

  it("keeps failed saves available while continuing lessons and retries without advancing twice", async () => {
    const second: ReviewItem = { ...item, assignment: { ...item.assignment, id: 43 } };
    vi.spyOn(WaniKaniClient.prototype, "loadAvailableLessons").mockResolvedValue([item, second]);
    const start = vi.spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(item.assignment);
    const completed = vi.fn();
    render(<LessonsPage client={new WaniKaniClient("token")} onCompleted={completed} />);
    await passQuiz();
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
    expect(screen.getByLabelText("meaning romaji")).toHaveFocus();
    const statistics = within(screen.getByRole("complementary", { name: "lesson progress" }));
    expect(statistics.getByText("Failed").parentElement).toHaveTextContent("Failed1");
    fireEvent.change(screen.getByLabelText("meaning romaji"), { target: { value: "on" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry saving lesson 42" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("meaning romaji")).toHaveValue("on");
    expect(start).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(statistics.getByText("Due").parentElement).toHaveTextContent("Due1");
  });

  it("shows loading failures without automatically retrying", async () => {
    const load = vi
      .spyOn(WaniKaniClient.prototype, "loadAvailableLessons")
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue([]);
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Retry loading lessons"));
    await waitFor(() =>
      expect(screen.getByText("No lessons available")).toBeInTheDocument(),
    );
  });

  it("supports vocabulary lessons", async () => {
    vi.spyOn(
      WaniKaniClient.prototype,
      "loadAvailableLessons",
    ).mockResolvedValue([vocabularyItem]);
    const start = vi
      .spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockResolvedValue(vocabularyItem.assignment);
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={vi.fn()}
      />,
    );

    await screen.findByLabelText("meaning romaji");
    fireEvent.change(screen.getByLabelText("meaning romaji"), {
      target: { value: "one person" },
    });
    fireEvent.click(screen.getByText("Answer"));
    fireEvent.change(screen.getByLabelText("reading auto hiragana"), {
      target: { value: "hitori" },
    });
    fireEvent.click(screen.getByText("Answer"));

    await screen.findByText("Lessons saved to WaniKani");
    expect(start).toHaveBeenCalledWith(vocabularyItem.assignment.id);
  });

  it("supports meaning-only radical lessons", async () => {
    vi.spyOn(
      WaniKaniClient.prototype,
      "loadAvailableLessons",
    ).mockResolvedValue([radicalItem]);
    const start = vi
      .spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockResolvedValue(radicalItem.assignment);
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={vi.fn()}
      />,
    );

    expect(screen.queryByText("Reading")).not.toBeInTheDocument();
    await screen.findByLabelText("meaning romaji");
    fireEvent.change(screen.getByLabelText("meaning romaji"), {
      target: { value: "one" },
    });
    fireEvent.click(screen.getByText("Answer"));

    await screen.findByText("Lessons saved to WaniKani");
    expect(start).toHaveBeenCalledWith(radicalItem.assignment.id);
  });

  it("supports meaning-only kana vocabulary lessons", async () => {
    vi.spyOn(
      WaniKaniClient.prototype,
      "loadAvailableLessons",
    ).mockResolvedValue([kanaVocabularyItem]);
    const start = vi
      .spyOn(WaniKaniClient.prototype, "startAssignment")
      .mockResolvedValue(kanaVocabularyItem.assignment);
    render(
      <LessonsPage
        client={new WaniKaniClient("token")}
        onCompleted={vi.fn()}
      />,
    );

    expect(screen.queryByText("Reading")).not.toBeInTheDocument();
    await screen.findByLabelText("meaning romaji");
    fireEvent.change(screen.getByLabelText("meaning romaji"), {
      target: { value: "snack" },
    });
    fireEvent.click(screen.getByText("Answer"));

    await screen.findByText("Lessons saved to WaniKani");
    expect(start).toHaveBeenCalledWith(kanaVocabularyItem.assignment.id);
  });
});
