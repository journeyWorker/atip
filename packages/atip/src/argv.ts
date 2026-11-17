/**
 * Command lines as atip/1 writes them (spec 6.8): `argv` is the invocation without the executable, every word
 * literal; `command` is the same invocation as one display string that a POSIX shell splits back to the tool name
 * followed by `argv`.
 */
import type { NextStep } from "./envelope.ts";

/** Words a POSIX shell reads back unchanged without quotes. */
const BARE = /^[A-Za-z0-9_\-.,/:=@%+]+$/;

/**
 * One argv word as a POSIX shell word: bare when it has no whitespace, quote, backslash or shell metacharacter, else
 * in single quotes, a single quote inside written `'\''` (spec 6.8).
 */
export const shellQuote = (word: string): string =>
  BARE.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** The display string of an invocation: the tool name and the quoted words of `argv`, joined by single spaces. */
export const commandLine = (tool: string, argv: ReadonlyArray<string>): string =>
  [tool, ...argv].map(shellQuote).join(" ");

/** A next step (spec 6.8): `{command, argv}`, with `reason` when the step needs one. */
export const nextStep = (tool: string, argv: ReadonlyArray<string>, reason?: string): NextStep => ({
  command: commandLine(tool, argv),
  argv: [...argv],
  ...(reason === undefined ? {} : { reason }),
});

/**
 * `argv` in JSON mode (spec 4.3.4, 4.3.5): `--json` is present before the first `--`; when it is missing it is added
 * there (or at the end when there is no `--`).
 */
export const withJson = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const dashes = argv.indexOf("--");
  const head = dashes === -1 ? argv : argv.slice(0, dashes);
  if (head.includes("--json")) return argv;
  return dashes === -1 ? [...argv, "--json"] : [...head, "--json", ...argv.slice(dashes)];
};

/** Whether an invocation is in JSON mode (spec 4.3.4): `--json` appears before the first `--`. */
export const isJsonMode = (argv: ReadonlyArray<string>): boolean => {
  const dashes = argv.indexOf("--");
  return (dashes === -1 ? argv : argv.slice(0, dashes)).includes("--json");
};

/**
 * Splits a display string as a POSIX shell would, without expansion: whitespace separates words; `'…'` quotes
 * literally; `"…"` quotes with `\` escaping `"`, `\`, `$` and a backtick; an unquoted `\` escapes the next character.
 * `undefined` for an unterminated quote or a trailing backslash.
 */
export const shellSplit = (line: string): ReadonlyArray<string> | undefined => {
  const words: Array<string> = [];
  let current = "";
  let started = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "'") {
      const end = line.indexOf("'", index + 1);
      if (end === -1) return undefined;
      current += line.slice(index + 1, end);
      started = true;
      index = end + 1;
    } else if (char === '"') {
      index += 1;
      for (;;) {
        if (index >= line.length) return undefined;
        const inner = line[index] ?? "";
        if (inner === '"') break;
        const following = line[index + 1];
        if (inner === "\\" && following !== undefined && '"\\$`'.includes(following)) {
          current += following;
          index += 2;
        } else {
          current += inner;
          index += 1;
        }
      }
      started = true;
      index += 1;
    } else if (char === "\\") {
      const following = line[index + 1];
      if (following === undefined) return undefined;
      current += following;
      started = true;
      index += 2;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
      index += 1;
    } else {
      current += char;
      started = true;
      index += 1;
    }
  }
  if (started) words.push(current);
  return words;
};

/** A word a caller would have to fill in (spec 6.8): `<UPPER_CASE>`, `…` or `...`. */
const PLACEHOLDER = /<[A-Z][A-Z0-9_]*>|…|\.\.\./;

/** Why a next step breaks spec 6.8, or `undefined`. `json`: the invocation was in JSON mode. */
export const nextStepProblem = (
  tool: string,
  step: NextStep,
  json: boolean,
  acceptsJson: (argv: ReadonlyArray<string>) => boolean,
): string | undefined => {
  if (step.argv.length === 0) return "argv is empty";
  const placeholder = step.argv.find((word) => PLACEHOLDER.test(word));
  if (placeholder !== undefined) return `argv word ${JSON.stringify(placeholder)} is a placeholder`;
  const split = shellSplit(step.command);
  if (split === undefined) return `command ${JSON.stringify(step.command)} does not split`;
  if (
    split[0] !== tool ||
    split.length !== step.argv.length + 1 ||
    split.some((word, index) => index > 0 && word !== step.argv[index - 1])
  )
    return `command ${JSON.stringify(step.command)} does not split into ${tool} followed by argv`;
  if (json && acceptsJson(step.argv) && !isJsonMode(step.argv))
    return "argv lacks --json in JSON mode";
  return undefined;
};
