/**
 * Cursors bound to the invocation that produced them (spec 6.9, approaches/typescript.md §3.8): the cursor a tool
 * prints wraps its backend's cursor with a digest of the invocation's arguments. A cursor given with other arguments, or
 * one the tool never printed, is refused with `CURSOR_INVALID`, so a changed filter can never skip or repeat records
 * silently.
 *
 * Which arguments bind depends on the minor the tool declares:
 * - **1.1** binds the argument object of spec 10.7 step 6 (each option's explicit value, else its `env` value, else its
 *   default; the operands with their defaults) without `--limit`, `--cursor` and `--fields`, plus the flag-only options
 *   the invocation gave, `--json` among them. `--input` only carries arguments that are already there.
 * - **1.2** binds every argument except `--json`, `--limit`, `--all`, `--cursor` and `--fields`, each with its source: an
 *   explicit value (from argv or `--input`) as given, normalised; an `env` value marked as the environment's; a default
 *   as nothing, so an explicit default binds differently from its absence. A switch given `false` and a count given `0`
 *   are absent (spec 9.7.2).
 *
 * The next page's command line ({@link Paging.next}) carries exactly the explicit arguments plus `--cursor`, never a
 * default or an environment value, so that run in the same environment its own cursor accepts it (spec 6.9).
 *
 * The binding is `sha256:` and the hex SHA-256 of the binding's RFC 8785 canonical JSON (approaches/typescript.md §3.8),
 * the plan digest's form. It is not a secret and not a security boundary: it only tells one invocation from another.
 * The printed cursor is the base64url of `{"v":2,"c":<backend cursor>,"b":<binding>}`; any other string, a cursor of
 * another format version included, is `FOREIGN`.
 */
import { Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";
import { typedValue } from "./description.ts";
import { type ContractMinor, declaresAtLeast } from "./envelope.ts";
import { normalisedOperands, normalisedOption } from "./input.ts";
import type { ParsedCommand } from "./parser.ts";
import type { ArgvValue } from "./parser-checks.ts";
import { canonicalJson, sha256Hex } from "./plan.ts";

const Bound = Schema.Struct({ v: Schema.Literal(2), c: Schema.String, b: Schema.String });
const BoundJson = Schema.fromJsonString(Bound);
const decodeBound = Schema.decodeUnknownResult(BoundJson);
const encodeBound = Schema.encodeSync(BoundJson);

/** The invocation a cursor is bound to: its command, its arguments as argv text, and which came from the environment. */
export type PagedInvocation = Pick<ParsedCommand, "command" | "operands" | "options" | "fromEnv">;

/** The options no 1.1 cursor is bound to: the paging and selection options of spec 6.9, and `--input`. */
const UNBOUND_11: Readonly<Record<string, true>> = {
  limit: true,
  cursor: true,
  fields: true,
  input: true,
};
/** Since 1.2 (spec 6.9): the reserved options that never change the result set, and `--input`. */
const UNBOUND_12: Readonly<Record<string, true>> = {
  json: true,
  limit: true,
  all: true,
  cursor: true,
  fields: true,
  input: true,
};

/** The 1.1 binding: the argument object without the paging and selection options, and the flag-only options given. */
const argumentObject = (invocation: PagedInvocation): unknown => {
  const { command } = invocation;
  const options: Record<string, unknown> = {};
  for (const option of command.options) {
    if (UNBOUND_11[option.name] === true) continue;
    const value = invocation.options[option.name];
    if (value !== undefined) options[option.name] = normalisedOption(option, value);
    else if (!option.flagOnly && option.default !== null) options[option.name] = option.default;
  }
  const operands: Array<unknown> = [...normalisedOperands(command, invocation.operands)];
  for (const operand of command.operands.slice(invocation.operands.length)) {
    if (operand.default === null) break;
    if (operand.variadic && Array.isArray(operand.default)) operands.push(...operand.default);
    else operands.push(operand.default);
  }
  return { command: command.path.join(" "), operands, options };
};

/** The 1.2 binding: every argument but the five reserved ones, each with its source; a default is absent. */
const sourcedArguments = (invocation: PagedInvocation): unknown => {
  const { command } = invocation;
  const options: Record<string, unknown> = {};
  for (const option of command.options) {
    const value = invocation.options[option.name];
    if (UNBOUND_12[option.name] === true || value === undefined) continue;
    const normalised = normalisedOption(option, value);
    // a count of 0 says the same as its absence (a switch given false never reaches the parsed options)
    if (option.valueType === "count" && normalised === 0) continue;
    options[option.name] = invocation.fromEnv.includes(option.name)
      ? { env: normalised }
      : { given: normalised };
  }
  return {
    command: command.path.join(" "),
    operands: normalisedOperands(command, invocation.operands),
    options,
  };
};

/** One option's words: `--name`, its value joined (`--name=value`) when it is empty or starts with `-` (spec 4.2.2). */
const optionWords = (name: string, valueType: string, value: ArgvValue): ReadonlyArray<string> => {
  if (value === true) return [`--${name}`];
  if (valueType === "count") return Array.from({ length: Number(value) }, () => `--${name}`);
  return (typeof value === "string" ? [value] : value).flatMap((one) => {
    // an integer or a number in its canonical spelling, anything else as given
    const text =
      valueType === "integer" || valueType === "number"
        ? String(typedValue(valueType, one) ?? one)
        : one;
    return text === "" || text.startsWith("-") ? [`--${name}=${text}`] : [`--${name}`, text];
  });
};

/**
 * The next page's command line (argv after the tool name): the command's words, the explicit operands (after one `--`
 * when one starts with `-`), the explicit options in the command's order (a document's keys re-expressed as options,
 * never `--input`) with `--cursor <cursor>` where the command declares it. No value filled in from a default or an
 * `env` variable.
 */
const nextPageArgv = (invocation: PagedInvocation, cursor: string): ReadonlyArray<string> => {
  const { command, operands } = invocation;
  const options = command.options.flatMap((option) => {
    if (option.name === "cursor") return optionWords("cursor", "string", cursor);
    const value = invocation.options[option.name];
    return value === undefined ||
      option.name === "input" ||
      invocation.fromEnv.includes(option.name)
      ? []
      : optionWords(option.name, option.valueType, value);
  });
  const dashed = operands.some((operand) => operand.startsWith("-"));
  return [
    ...command.path,
    ...(dashed ? [] : operands),
    ...options,
    ...(dashed ? ["--", ...operands] : []),
  ];
};

/** An invocation's paging (spec 6.9): the binding of the cursors it prints and accepts, and the next page's command. */
export interface Paging {
  /** The digest a cursor this invocation prints carries, and a cursor it is given must carry. */
  readonly binding: string;
  /** The next page's command line (argv after the tool name) for the `nextCursor` this invocation printed. */
  readonly next: (cursor: string) => ReadonlyArray<string>;
}

/** The paging of an invocation of a tool that declares `minor`: what binds its cursors, and its next page's command. */
export const pagingOf = (minor: ContractMinor, invocation: PagedInvocation): Paging => ({
  binding: `sha256:${sha256Hex(
    new TextEncoder().encode(
      canonicalJson(
        declaresAtLeast(minor, "1.2") ? sourcedArguments(invocation) : argumentObject(invocation),
      ),
    ),
  )}`,
  next: (cursor) => nextPageArgv(invocation, cursor),
});

/** The cursor to print: the backend's cursor bound to `binding` ({@link Paging.binding}). */
export const bindCursor = (backend: string, binding: string): string =>
  Base64Url.encode(encodeBound({ v: 2, c: backend, b: binding }));

/**
 * Why a given cursor is refused (`CURSOR_INVALID`), as its reserved reason (spec 7.3.3): not one the tool printed, or
 * printed for other arguments.
 */
export type CursorRefusal = "FOREIGN" | "ARGUMENTS_CHANGED";

/** The backend's cursor inside a printed one, if it was printed for the same `binding`. */
export const unbindCursor = (
  cursor: string,
  binding: string,
): Result.Result<string, CursorRefusal> => {
  const text = Base64Url.decodeString(cursor);
  if (Result.isFailure(text)) return Result.fail("FOREIGN");
  const bound = decodeBound(text.success);
  if (Result.isFailure(bound)) return Result.fail("FOREIGN");
  return bound.success.b === binding
    ? Result.succeed(bound.success.c)
    : Result.fail("ARGUMENTS_CHANGED");
};
