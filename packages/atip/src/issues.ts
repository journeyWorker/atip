/**
 * Arguments that do not decode (spec 10.7): every refused value with a JSON pointer into the decoded record, which is
 * the `--input` document's own pointer when a document gave it (`/round`, `/operands/0`). `argvField` turns a pointer
 * into what argv calls the value (`--max-minutes`, `<change>`), for a refusal's `field`.
 */
import { Schema, SchemaIssue } from "effect";
import { optionName } from "./description.ts";

/**
 * One refused value: where it is and why; `env` names the environment variable the value came from (spec 10.7 step 5),
 * when it was no argv or document value, so a tool can say which variable to fix.
 */
export const ArgumentIssue = Schema.Struct({
  pointer: Schema.String,
  message: Schema.String,
  env: Schema.optionalKey(Schema.String),
});
export type ArgumentIssue = typeof ArgumentIssue.Type;

/** Arguments that do not decode: from argv (`argv`), from an `--input` document (`document`), or after the merge. */
export class ArgumentsError extends Schema.TaggedError<ArgumentsError>()("ArgumentsError", {
  source: Schema.Literals(["argv", "document", "arguments"]),
  issues: Schema.Array(ArgumentIssue),
}) {}

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

const escape = (segment: string): string => segment.replaceAll("~", "~0").replaceAll("/", "~1");
const unescape = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const pointerOf = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string =>
  (path ?? [])
    .map((segment) => `/${escape(String(typeof segment === "object" ? segment.key : segment))}`)
    .join("");

/** A decoding failure as refused values, each pointer under `prefix` (`/operands` for the operands' tuple). */
export const argumentIssues = (
  error: Schema.SchemaError,
  prefix = "",
): ReadonlyArray<ArgumentIssue> =>
  formatter(error.issue).issues.map((issue) => ({
    pointer: `${prefix}${pointerOf(issue.path)}`,
    message: issue.message,
  }));

/**
 * What argv calls the value an issue pointer names: an option's long name (`/maxMinutes` → `--max-minutes`, an element
 * of a repeatable one too), an operand's name in angle brackets (`/operands/1` → `<target>`, every element past the
 * fixed ones the variadic operand's); undefined for a pointer at no argument (the record itself, an excess operand).
 * `operands` are the command's operands in order (`CommandDescription.operands`).
 */
export const argvField = (
  pointer: string,
  operands: ReadonlyArray<{ readonly name: string; readonly variadic: boolean }>,
): string | undefined => {
  const [, first, second] = pointer.split("/").map(unescape);
  if (first === undefined || first === "") return undefined;
  if (first !== "operands") return `--${optionName(first)}`;
  const index = Number(second);
  if (second === undefined || second === "" || !Number.isInteger(index) || index < 0)
    return undefined;
  const last = operands.at(-1);
  const operand = operands[index] ?? (last !== undefined && last.variadic ? last : undefined);
  return operand === undefined ? undefined : `<${operand.name}>`;
};
