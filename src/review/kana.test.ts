import { describe, expect, it } from "vitest";
import { romajiToHiragana } from "./kana";

describe("romajiToHiragana", () => {
  it("converts common readings", () => {
    expect(romajiToHiragana("nichi")).toBe("にち");
    expect(romajiToHiragana("kanji")).toBe("かんじ");
    expect(romajiToHiragana("kyo")).toBe("きょ");
    expect(romajiToHiragana("gakkou")).toBe("がっこう");
  });

  it("can preserve a trailing n while typing", () => {
    expect(romajiToHiragana("kan", { preserveTrailingN: true })).toBe("かn");
    expect(romajiToHiragana("kann", { preserveTrailingN: true })).toBe("かん");
  });
});
