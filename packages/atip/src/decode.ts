/**
 * The three schemas of one declaration (approaches/typescript.md §3.2): the **argv decoder** and the **fragment**
 * decoder, all-optional with no defaults and no domains, whose integers and numbers accept the numeric string too; and
 * the **argument** schema, the input Struct as declared (required keys, defaults, domains), applied to the merged
 * record. Integers are refused outside ±(2^53-1), never rounded (spec 9.7.5, Annex V3): `Schema.Int` checks it after either
 * spelling is read. Every refusal is an `ArgumentsError` whose issues carry JSON pointers into the decoded record, which
 * is the `--input` document's own pointer for a document (spec 10.8).
 */
import { Effect, Schema, SchemaTransformation } from "effect";
import type { Command } from "./command.ts";
import {
  type ArgumentDescription,
  argvValues,
  type CommandDescription,
  fieldName,
  INTEGER_PATTERN,
  NUMBER_PATTERN,
  type OptionDescription,
} from "./description.ts";
import { argumentIssues, ArgumentsError } from "./issues.ts";

const IntegerString = Schema.String.check(Schema.isPattern(new RegExp(INTEGER_PATTERN, "u"))).pipe(
  Schema.decodeTo(Schema.Int, SchemaTransformation.numberFromString),
);
const NumberString = Schema.String.check(Schema.isPattern(new RegExp(NUMBER_PATTERN, "u"))).pipe(
  Schema.decodeTo(Schema.Finite, SchemaTransformation.numberFromString),
);
/** An integer or its canonical string (`1`, `"1"`), safe (spec 9.7.2, 9.7.5). */
const IntegerValue = Schema.Union([Schema.Int, IntegerString]);
/** A finite number or its string in JSON number syntax. */
const NumberValue = Schema.Union([Schema.Finite, NumberString]);
const NotNull = Schema.Unknown.check(
  Schema.makeFilter((value: unknown) => value !== null, {
    expected: "a JSON value other than null",
  }),
);
/** A `json` argument on argv: its JSON text, not `null`. */
const JsonText = Schema.fromJsonString(NotNull);

/** A schema that decodes a source's value with no service. */
type ValueDecoder = Schema.Top & Schema.Decoder<unknown>;

/** One value of an argument as a source gives it: argv text, or a document's JSON value. */
const valueDecoder = (argument: ArgumentDescription, source: "argv" | "document"): ValueDecoder => {
  switch (argument.valueType) {
    case "switch":
      return Schema.Boolean;
    case "count":
      // a document gives a count as a non-negative integer (spec 9.7.2); argv as its occurrences, counted as text
      return source === "argv"
        ? Schema.Union([Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), IntegerString])
        : Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
    case "integer":
      return IntegerValue;
    case "number":
      return NumberValue;
    case "enum":
      return Schema.Literals(argument.possibleValues ?? []);
    case "json":
      return source === "argv" ? JsonText : NotNull;
    default:
      return Schema.String;
  }
};

/** A repeatable option's values; a document's list holds at least one, as the fragment says (`minItems: 1`). */
const keyDecoder = (option: OptionDescription, source: "argv" | "document"): ValueDecoder => {
  const one = valueDecoder(option, source);
  if (!option.repeatable || option.valueType === "count") return one;
  const array = Schema.Array(one);
  return source === "document" ? array.check(Schema.isMinLength(1)) : array;
};

const operandsDecoder = (
  command: CommandDescription,
  source: "argv" | "document",
): ValueDecoder => {
  const operands = command.operands;
  const fixed = operands
    .filter((entry) => !entry.variadic)
    .map((entry) => Schema.optionalKey(valueDecoder(entry, source)));
  const variadic = operands.find((entry) => entry.variadic);
  const tuple =
    variadic === undefined
      ? Schema.Tuple(fixed)
      : Schema.TupleWithRest(Schema.Tuple(fixed), [valueDecoder(variadic, source)]);
  return source === "document" ? tuple.check(Schema.isMinLength(1)) : tuple;
};

const sourceFields = (
  command: CommandDescription,
  source: "argv" | "document",
): Readonly<Record<string, Schema.optionalKey<ValueDecoder>>> => ({
  ...Object.fromEntries(
    command.options
      .filter((option) => source === "argv" || !option.flagOnly)
      .map((option) => [fieldName(option.name), Schema.optionalKey(keyDecoder(option, source))]),
  ),
  ...(command.operands.length === 0
    ? {}
    : { operands: Schema.optionalKey(operandsDecoder(command, source)) }),
});

/**
 * The argv decoder: every option, flag-only ones included, all optional; argv text decoded to values (`"1"` → `1`,
 * a `json` value's text to its JSON). Keys are field names (`resolutionRev`), operands under `operands`.
 */
const argvSchema = (command: Command<unknown, unknown>) =>
  Schema.Struct(sourceFields(command.description, "argv"));

/**
 * The fragment schema of one `--input` document (spec 9.9.2) of a command as its tool describes it: the argv decoder
 * without the flag-only options (the tool's rules applied: since 1.2 `limit`, `cursor`, `all` and `fields` too),
 * whose values are JSON values (a numeric string still accepted). An excess key is refused when it decodes. A command
 * whose every option is flag-only and that has no operands takes no key at all: a `Struct` without fields lets any key
 * through even with `onExcessProperty: "error"` (Effect 4.1), so every key is refused by its value instead.
 */
const fragmentSchema = (command: CommandDescription) => {
  const fields = sourceFields(command, "document");
  return Object.keys(fields).length === 0
    ? Schema.Record(Schema.String, Schema.Never)
    : Schema.Struct(fields);
};

const refused =
  (source: ArgumentsError["source"]) =>
  (error: Schema.SchemaError): ArgumentsError =>
    new ArgumentsError({ source, issues: argumentIssues(error) });

/** The decoded record split into its options and its operands. */
const split = (decoded: { readonly [key: string]: unknown }) => {
  const { operands, ...options } = decoded;
  return { options, operands: Array.isArray(operands) ? operands : [] };
};

/** What `decodeArguments` takes besides the record. */
export interface DecodeOptions {
  /**
   * The environment the caller read (`process.env`, or a test's record): an option absent from the record takes its
   * declared `env` variable's value when set (spec 10.7 step 5), as argv text. The library never reads the
   * environment itself; without `env`, no variable applies.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The record with every absent option filled from its set `env` variable (a repeatable one as one value, a comma list's as its pieces). */
interface Environed {
  readonly record: unknown;
  /** The variable each filled key's value came from, by field name. */
  readonly fromEnv: ReadonlyMap<string, string>;
}

const withEnvironment = (
  command: Command<unknown, unknown>,
  record: unknown,
  env: DecodeOptions["env"],
): Environed => {
  if (env === undefined || typeof record !== "object" || record === null || Array.isArray(record))
    return { record, fromEnv: new Map() };
  const given = new Map(Object.entries(record));
  const fromEnv = new Map<string, string>();
  for (const option of command.description.options) {
    const key = fieldName(option.name);
    const value = option.env === undefined ? undefined : env[option.env];
    if (option.env === undefined || value === undefined || given.has(key)) continue;
    given.set(key, option.repeatable ? argvValues(option, value) : value);
    fromEnv.set(key, option.env);
  }
  return { record: Object.fromEntries(given), fromEnv };
};

/** The error with each issue about an environment value naming its variable (`env`). */
const naming =
  (fromEnv: ReadonlyMap<string, string>) =>
  (error: ArgumentsError): ArgumentsError => {
    if (fromEnv.size === 0) return error;
    return new ArgumentsError({
      source: error.source,
      issues: error.issues.map((issue) => {
        const variable = fromEnv.get(issue.pointer.split("/")[1] ?? "");
        return variable === undefined ? issue : { ...issue, env: variable };
      }),
    });
  };

/**
 * The record `decodeArguments` reads from a parsed command line (a `ParsedCommand`'s operands and options): the
 * command's own options under their field names (the shared ones a tool adds, `--json`, `--input`, are no argument of
 * its handler) and its operands, when it has any.
 */
export const argumentRecord = (
  command: { readonly description: CommandDescription },
  given: {
    readonly operands: ReadonlyArray<string>;
    readonly options: Readonly<Record<string, unknown>>;
  },
): Readonly<Record<string, unknown>> => {
  const own = new Set(command.description.options.map((option) => option.name));
  return {
    ...Object.fromEntries(
      Object.entries(given.options)
        .filter(([name]) => own.has(name))
        .map(([name, value]) => [fieldName(name), value]),
    ),
    ...(command.description.operands.length === 0 ? {} : { operands: given.operands }),
  };
};

/**
 * Decodes the arguments of a command from a plain record of argv values (strings; `true` for a switch; an array of
 * strings for a repeatable option; `operands` the operand words) as argv gives them after merging, with the caller's
 * environment for the options it omits: the argv decoder, then the argument schema (defaults, domains). The handler's
 * arguments, or every refused value with its pointer (`argvField` names its flag) and, for a value the environment
 * gave, its variable (`env`).
 */
export const decodeArguments: <Args>(
  command: Command<Args, unknown>,
  record: unknown,
  options?: DecodeOptions,
) => Effect.Effect<Args, ArgumentsError> = Effect.fn("atip.decodeArguments")(function* <Args>(
  command: Command<Args, unknown>,
  record: unknown,
  options?: DecodeOptions,
) {
  const environed = withEnvironment(command, record, options?.env);
  const typed = yield* Schema.decodeUnknownEffect(argvSchema(command), {
    errors: "all",
    onExcessProperty: "error",
  })(environed.record).pipe(
    Effect.mapError(refused("argv")),
    Effect.mapError(naming(environed.fromEnv)),
  );
  const { options: given, operands } = split(typed);
  return yield* command
    .toArguments(given, operands)
    .pipe(Effect.mapError(naming(environed.fromEnv)));
});

/**
 * Decodes one `--input` document with the fragment schema (spec 10.7 step 2): its values typed, an excess or flag-only
 * key refused. `command` is the command as its tool describes it (`tool.describe`, or `toolDescription` with the tool's
 * profile), so the flag-only options are the ones the tool's minor makes flag-only, as the runtime and the published
 * fragment schema have them. The result merges with argv's before `decodeArguments`' second step.
 */
export const decodeDocument = (
  command: CommandDescription,
  document: unknown,
): Effect.Effect<{ readonly [key: string]: unknown }, ArgumentsError> =>
  Schema.decodeUnknownEffect(fragmentSchema(command), { errors: "all", onExcessProperty: "error" })(
    document,
  ).pipe(Effect.mapError(refused("document")));
