/**
 * An `--input` document merged with argv (spec 10.5-10.9): the document is checked against the command's description
 * (known keys, flag-only keys absent, the type and enum of each value, `null`; every problem reported), converted to
 * argv in the forms of spec 4.2, scanned by the same parser, compared with the explicit argv arguments as
 * normalised values (`INPUT_CONFLICT`), merged, given the environment where both lack an option, and finished as one
 * command line, whose refusals then name the document's keys as JSON pointers (spec 10.8). Reading and framing the
 * source (step 1) is the tool's.
 */
import { Equal, Result } from "effect";
import type { ArgumentDescription, CommandDescription, OptionDescription } from "./description.ts";
import { argumentValue, fieldName, typedValue } from "./description.ts";
import type { ArgvValue } from "./parser-checks.ts";
import { type Environment, finishArguments, type ParsedCommand, scanArguments } from "./parser.ts";
import {
  type ArgvProblem,
  type ArgvRefusal,
  type ParserProfile,
  type Refused,
  unknownOptionCode,
} from "./parser-profile.ts";
import { suggest } from "./suggest.ts";

/**
 * One document value of a valued argument as its argv text by the argument's value type (spec 9.7.2, 10.5): a string
 * as it is; an integer also as a JSON integer within ±(2^53-1); a number also as a JSON number; a `json` argument any
 * JSON value, passed on as its JSON text. Anything else: what it should have been.
 */
const documentText = (
  argument: ArgumentDescription,
  value: unknown,
): string | { readonly expected: string } => {
  const type = argument.valueType;
  if (type === "json") return JSON.stringify(value);
  const numeric = type === "integer" || type === "number";
  // a number's string is its digits, within the type (spec 9.7.5: an unsafe integer in a document is refused)
  if (typeof value === "string" && (!numeric || typedValue(type, value) !== undefined))
    return value;
  if (type === "integer" && typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (type === "number" && typeof value === "number" && Number.isFinite(value))
    return String(value);
  return {
    expected:
      type === "integer"
        ? "an integer (or its string)"
        : type === "number"
          ? "a number (or its string)"
          : "a string",
  };
};

const jsonType = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** The problems of one `operands` value, and the operands' argv words. */
const documentOperands = (
  command: CommandDescription,
  value: unknown,
): { readonly words: ReadonlyArray<string>; readonly problems: ReadonlyArray<ArgvProblem> } => {
  if (!Array.isArray(value) || value.length === 0)
    return {
      words: [],
      problems: [
        {
          code: "INPUT_INVALID",
          message: "operands must be a non-empty array of the operands' values",
          field: "/operands",
          reason: "INVALID_VALUE",
        },
      ],
    };
  const words: Array<string> = [];
  const problems: Array<ArgvProblem> = [];
  for (const [index, item] of value.entries()) {
    const operand = command.operands[index] ?? command.operands.find((one) => one.variadic);
    const text = operand === undefined ? JSON.stringify(item) : documentText(operand, item);
    if (typeof text !== "string" || item === null) {
      problems.push({
        code: "INPUT_INVALID",
        message: `operands/${index} must be ${typeof text === "string" ? "a value" : text.expected}, not ${jsonType(item)}`,
        field: `/operands/${index}`,
        received: jsonType(item),
        reason: "INVALID_VALUE",
      });
      continue;
    }
    words.push(text);
  }
  return { words, problems };
};

/**
 * Converts an `--input` document (already JSON-decoded) to argv for the parser (spec 10.9): keys are option names in
 * camelCase, `operands` an array of the operands' values; `true` gives a switch, `false` is absent, a count its name
 * repeated; a valued argument takes the values of its type, a repeatable one also an array of them. Any other JSON
 * type is refused with the key's pointer, never stringified; so are unknown keys, `null`, batches and flag-only keys.
 * Every problem of the document is reported (spec 10.7 step 2): the first, with `details` listing each when there
 * are two or more.
 */
export const inputArgv = (
  profile: ParserProfile,
  command: CommandDescription,
  document: unknown,
): Result.Result<ReadonlyArray<string>, ArgvRefusal> => {
  const id = command.path.join(" ");
  if (Array.isArray(document))
    return Result.fail({
      code: "INPUT_INVALID",
      message: `${profile.name} ${id} takes one JSON object in --input, not a batch`,
      field: "--input",
      reason: "BATCH_UNSUPPORTED",
      hint: profile.hint.usage(command),
    });
  if (document === null || typeof document !== "object")
    return Result.fail({
      code: "INPUT_INVALID",
      message: "--input must be a JSON object",
      field: "--input",
      reason: "NOT_OBJECT",
      hint: profile.hint.usage(command),
    });
  const byKey = new Map(
    command.options
      .filter((option) => !option.flagOnly)
      .map((option) => [fieldName(option.name), option]),
  );
  const argv: Array<string> = [];
  let operands: ReadonlyArray<string> = [];
  const problems: Array<ArgvProblem> = [];
  for (const [key, value] of Object.entries(document)) {
    if (key === "operands") {
      const read = documentOperands(command, value);
      operands = [...operands, ...read.words];
      problems.push(...read.problems);
      continue;
    }
    const option = byKey.get(key);
    const flagOnly = command.options.find(
      (candidate) => candidate.flagOnly && fieldName(candidate.name) === key,
    );
    if (flagOnly !== undefined) {
      problems.push({
        code: "INPUT_INVALID",
        message: `--input cannot hold ${key}: --${flagOnly.name} is given on the command line only`,
        field: `/${key}`,
        received: key,
        reason: "FLAG_ONLY_KEY",
      });
      continue;
    }
    if (option === undefined) {
      problems.push({
        code: "INPUT_INVALID",
        message: `--input has an unknown key ${key}`,
        field: `/${key}`,
        received: key,
        reason: "UNKNOWN_KEY",
        hint: profile.hint.command(command),
        expected: ["operands", ...byKey.keys()],
        suggestions: suggest(key, [...byKey.keys()]),
      });
      continue;
    }
    if (value === null) {
      problems.push({
        code: "INPUT_INVALID",
        message: `${key} is null; omit the key instead`,
        field: `/${key}`,
        reason: "INVALID_VALUE",
      });
      continue;
    }
    if (option.valueType === "count") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        problems.push({
          code: "INPUT_INVALID",
          message: `${key} is a count: a non-negative integer`,
          field: `/${key}`,
          reason: "INVALID_VALUE",
        });
      else argv.push(...Array.from({ length: value }, () => `--${option.name}`));
      continue;
    }
    if (option.valueName === undefined) {
      if (typeof value !== "boolean")
        problems.push({
          code: "INPUT_INVALID",
          message: `${key} is a switch: true or false`,
          field: `/${key}`,
          reason: "INVALID_VALUE",
        });
      else if (value) argv.push(`--${option.name}`);
      continue;
    }
    const many = option.repeatable && Array.isArray(value);
    const items: ReadonlyArray<unknown> = many ? value : [value];
    for (const [index, item] of items.entries()) {
      const field = many ? `/${key}/${index}` : `/${key}`;
      const text = documentText(option, item);
      if (typeof text !== "string") {
        problems.push({
          code: "INPUT_INVALID",
          message: `${key} must be ${text.expected}${option.repeatable ? " (or an array of them)" : ""}, not ${jsonType(item)} (--${option.name} <${option.valueName}>)`,
          field,
          received: jsonType(item),
          reason: "INVALID_VALUE",
          hint: profile.hint.command(command),
          expected: [`<${option.valueName}>`],
        });
        continue;
      }
      if (option.possibleValues !== undefined && !option.possibleValues.includes(text)) {
        problems.push({
          code: "INPUT_INVALID",
          message: `${key} must be one of ${option.possibleValues.join(", ")}`,
          field,
          received: text,
          reason: "INVALID_VALUE",
          hint: profile.hint.command(command),
          expected: option.possibleValues,
          suggestions: suggest(text, option.possibleValues),
        });
        continue;
      }
      argv.push(`--${option.name}=${text}`);
    }
  }
  const [first, ...rest] = problems;
  if (first !== undefined)
    return Result.fail(rest.length === 0 ? first : { ...first, details: problems });
  return Result.succeed(operands.length === 0 ? argv : [...argv, "--", ...operands]);
};

/** The argument a parser's `field` names (an option, or `operands` with the operand's index), and its document pointer. */
interface Pointed {
  readonly argument: string;
  readonly operand?: number;
  readonly pointer: string;
}

/** What a parser's `field` names, with the JSON pointer its document key has (spec 10.8); undefined for anything else. */
const pointed = (command: CommandDescription, field: string): Pointed | undefined => {
  const option = /^--([a-z0-9-]+)$/.exec(field)?.[1];
  if (option !== undefined) return { argument: option, pointer: `/${fieldName(option)}` };
  if (field === "operands") return { argument: "operands", pointer: "/operands" };
  // an operand is named bare (`run`) or, in a constraint refusal, as `<run>`
  const name = /^<(.+)>$/.exec(field)?.[1] ?? field;
  const index = command.operands.findIndex((operand) => operand.name === name);
  if (index === -1) return undefined;
  return {
    argument: "operands",
    operand: index,
    pointer: command.operands[index]?.variadic ? "/operands" : `/operands/${index}`,
  };
};

/**
 * A refusal's `field` as spec 10.8 writes it: the JSON pointer of the document key (`/maxMinutes`, `/operands/1`) when
 * the value at fault came from `--input`, else the argv argument as the parser named it.
 */
export const documentField = (
  command: CommandDescription,
  fromInput: ReadonlyArray<string>,
  field: string,
): string => {
  const at = pointed(command, field);
  return at !== undefined && fromInput.includes(at.argument) ? at.pointer : field;
};

/** One argv text as spec 10.7 step 3 compares it (`argumentValue`); a text no argument takes, as it is. */
const normalised = (argument: ArgumentDescription | undefined, text: string): unknown =>
  argument === undefined ? text : argumentValue(argument, text);

/** An option's value normalised: a switch as it is, a repeatable option as the ordered array of its values. */
export const normalisedOption = (
  option: OptionDescription | undefined,
  value: ArgvValue,
): unknown =>
  value === true
    ? true
    : typeof value === "string"
      ? normalised(option, value)
      : value.map((text) => normalised(option, text));

/** The operands normalised, as one ordered array. */
export const normalisedOperands = (
  command: CommandDescription,
  operands: ReadonlyArray<string>,
): ReadonlyArray<unknown> =>
  operands.map((text, index) =>
    normalised(
      command.operands[index] ?? command.operands.find((operand) => operand.variadic),
      text,
    ),
  );

/**
 * Merges a parsed command line with the argv of its `--input` document (`inputArgv`; spec 10.7 steps 3-6). The
 * command line is its explicit arguments (`parseCommandLine` applies no environment with `--input`); a key it also
 * gives must have the same normalised value (`INPUT_CONFLICT` otherwise). The explicit arguments are the union of
 * both; then the environment applies to the options absent from both, and required arguments, types, domains and
 * constraints are checked. A refusal names the document's key (spec 10.8) for a value from the document and for an
 * argument missing from both sources; a value from argv or the environment keeps its argv name.
 */
export const mergeInput = (
  profile: ParserProfile,
  parsed: ParsedCommand,
  documentArgv: ReadonlyArray<string>,
  env: Environment,
): Result.Result<ParsedCommand, Refused> => {
  const { command } = parsed;
  const fail = (refusal: ArgvRefusal) => Result.fail({ refusal, command });
  const scanned = scanArguments(profile, command, documentArgv);
  if (Result.isFailure(scanned)) {
    // the value came from the document: point at its key, not at a flag the caller never typed
    const { reason: _reason, ...detail } = scanned.failure;
    const flag = /^--([a-z0-9-]+)$/.exec(detail.field ?? "")?.[1];
    return fail({
      ...detail,
      ...(detail.code === unknownOptionCode(profile)
        ? { code: "INPUT_INVALID", reason: "UNKNOWN_KEY" }
        : {}),
      ...(flag === undefined ? {} : { field: `/${fieldName(flag)}` }),
    });
  }
  const doc = scanned.success;
  // spec 10.7 step 3: the explicit argv arguments, without the environment
  const flags = Object.fromEntries(
    Object.entries(parsed.options).filter(
      ([name]) => !parsed.fromEnv.includes(name) && name !== "input",
    ),
  );
  for (const [name, value] of Object.entries(doc.options)) {
    const flag = flags[name];
    const option = command.options.find((candidate) => candidate.name === name);
    if (
      flag !== undefined &&
      !Equal.equals(normalisedOption(option, flag), normalisedOption(option, value))
    )
      return fail({
        code: "INPUT_CONFLICT",
        message: `--${name} and the --input key ${fieldName(name)} disagree`,
        field: `/${fieldName(name)}`,
        hint: profile.hint.command(command),
      });
  }
  if (
    doc.operands.length > 0 &&
    parsed.operands.length > 0 &&
    !Equal.equals(
      normalisedOperands(command, doc.operands),
      normalisedOperands(command, parsed.operands),
    )
  )
    return fail({
      code: "INPUT_CONFLICT",
      message: "the operands on the command line and in --input differ",
      field: "/operands",
    });
  // step 4: the union, each argument remembering its source; steps 5-6 in finishArguments
  const merged = Object.fromEntries(
    Object.entries({ ...doc.options, ...flags }).filter(([name]) => name !== "input"),
  );
  const operands = doc.operands.length > 0 ? doc.operands : parsed.operands;
  const fromInput = [
    ...Object.keys(doc.options).filter((name) => flags[name] === undefined),
    ...(doc.operands.length > 0 && parsed.operands.length === 0 ? ["operands"] : []),
  ];
  const finished = finishArguments(profile, command, operands, merged, env);
  if (Result.isSuccess(finished)) return Result.succeed({ ...finished.success, fromInput });
  const { refusal } = finished.failure;
  const at = refusal.field === undefined ? undefined : pointed(command, refusal.field);
  if (at === undefined) return fail(refusal);
  const option = command.options.find((candidate) => candidate.name === at.argument);
  const missing =
    at.operand !== undefined
      ? at.operand >= operands.length
      : at.argument === "operands"
        ? operands.length === 0
        : !Object.hasOwn(merged, at.argument) &&
          (option?.env === undefined || (env[option.env] ?? "") === "");
  return fail(
    missing || fromInput.includes(at.argument) ? { ...refusal, field: at.pointer } : refusal,
  );
};
