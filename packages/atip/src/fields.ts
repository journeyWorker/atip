/**
 * Field paths as atip/1.1 writes them (Annex F1, Annex S2 rule 15, envelope `fieldPath`): steps separated by `.`, a
 * step is a name, `[]` after it descends into each element of an array. A name that is an identifier
 * (`[A-Za-z_][A-Za-z0-9_]*`) is written with a dot; any other name (a map key such as `http.status-code`, the empty
 * name) as a bracketed key `["…"]` in which only `\"` and `\\` are escapes. Each member has exactly one spelling, so
 * paths compare as text; a key holding U+0000 is not selectable (argv cannot carry it).
 */
import { Result, Schema } from "effect";

export interface FieldStep {
  readonly name: string;
  /** `[]`: the step descends into each element of the array `name`. */
  readonly list: boolean;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One step in its single spelling: `.name` (or `name` first) for an identifier, else `["…"]`. */
export const formatFieldStep = (step: FieldStep, first: boolean): string => {
  const name = IDENTIFIER.test(step.name)
    ? `${first ? "" : "."}${step.name}`
    : `["${step.name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
  return step.list ? `${name}[]` : name;
};

/** The path of `steps` in its single spelling. */
export const formatFieldPath = (steps: ReadonlyArray<FieldStep>): string =>
  steps.map((step, index) => formatFieldStep(step, index === 0)).join("");

/**
 * A path's steps, or why it is not a field path: a bracketed key that is not closed, holds U+0000 or an escape
 * other than `\"` and `\\`, or names an identifier (which is written with a dot), an empty step, a stray character.
 */
export const parseFieldPath = (path: string): Result.Result<ReadonlyArray<FieldStep>, string> => {
  const steps: Array<FieldStep> = [];
  let index = 0;
  while (index < path.length || steps.length === 0) {
    let name: string;
    if (path[index] === "[" && path[index + 1] === '"') {
      index += 2;
      name = "";
      for (;;) {
        const char = path[index];
        if (char === undefined) return Result.fail(`${path}: a bracketed key is not closed`);
        if (char === "\u0000") return Result.fail(`${path}: a key cannot hold U+0000`);
        if (char === "\\") {
          const escaped = path[index + 1];
          if (escaped !== '"' && escaped !== "\\")
            return Result.fail(`${path}: only \\" and \\\\ are escapes in a bracketed key`);
          name += escaped;
          index += 2;
        } else if (char === '"') {
          if (path[index + 1] !== "]") return Result.fail(`${path}: a bracketed key ends with "]`);
          index += 2;
          break;
        } else {
          name += char;
          index += 1;
        }
      }
      if (IDENTIFIER.test(name))
        return Result.fail(
          `${path}: ${name} is an identifier, written ${steps.length === 0 ? name : `.${name}`}, never in brackets`,
        );
    } else {
      if (steps.length > 0) {
        if (path[index] !== ".")
          return Result.fail(`${path}: a step starts with . or [" at ${index}`);
        index += 1;
      }
      const match = IDENTIFIER.exec(path.slice(index).split(/[.[]/, 1)[0] ?? "");
      if (match === null)
        return Result.fail(`${path}: a name is letters, digits and _, or a bracketed key`);
      name = match[0];
      index += name.length;
    }
    const list = path.startsWith("[]", index);
    if (list) index += 2;
    steps.push({ name, list });
  }
  return Result.succeed(steps);
};

/**
 * A field path in its one spelling, as `meta.fields` lists it: parses ({@link parseFieldPath}) and is written as
 * {@link formatFieldPath} writes it. Every such path matches the 1.1 `fieldPath` pattern of `envelope.schema.json`.
 */
export const FieldPath = Schema.String.check(
  Schema.makeFilter((path: string) => {
    const parsed = parseFieldPath(path);
    if (Result.isFailure(parsed)) return parsed.failure;
    return formatFieldPath(parsed.success) === path
      ? undefined
      : `${path} is not in its one spelling`;
  }),
);

/**
 * The paths of a `--fields` value: split at commas outside bracketed keys, trimmed, empty ones dropped, in order
 * without repeats; `undefined` when a bracketed key is not closed.
 */
export const splitFieldList = (value: string): ReadonlyArray<string> | undefined => {
  const paths: Array<string> = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index] ?? "";
    if (quoted) {
      current += char;
      if (char === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
      } else if (char === '"') quoted = false;
    } else if (char === ",") {
      paths.push(current);
      current = "";
    } else {
      if (char === '"' && current.endsWith("[")) quoted = true;
      current += char;
    }
  }
  if (quoted) return undefined;
  paths.push(current);
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path !== ""))];
};
