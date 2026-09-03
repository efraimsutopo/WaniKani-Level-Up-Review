import { toHiragana } from "wanakana";

export function romajiToHiragana(input: string, options: { preserveTrailingN?: boolean } = {}): string {
  if (options.preserveTrailingN && /(?<!n)n$/i.test(input)) {
    return `${toHiragana(input.slice(0, -1), { IMEMode: true })}n`;
  }

  return toHiragana(input, { IMEMode: true });
}
