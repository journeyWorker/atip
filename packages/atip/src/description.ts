/**
 * A command as the contract describes it (spec 9.5-9.9), independent of how a tool declares it: what
 * `describeCommand` derives from a `defineCommand` declaration and what `commandDocument` prints. A tool with its own
 * command records can map them here to print its documents through the same generator.
 */
import { Option, type Schema } from "effect";
import { decodeJsonText, type Json, type JsonObject } from "./json.ts";

export type EffectKind = "read" | "write" | "destructive";
export type Idempotency = "replay-safe" | "content-keyed" | "appends" | "once";

/** An argument's type (spec 9.7.2). */
export type ValueType =
  | "switch"
  | "count"
  | "string"
  | "integer"
  | "number"
  | "path"
  | "enum"
  | "json";

/**
 * The restrictions of one argument's own value beyond its type (spec 9.7.4), as a JSON Schema in the domain profile:
 * the profile keywords of its valueType (`minimum`, `maxLength`, `pattern` …), the annotations the profile allows,
 * and for a `json` argument the structural keywords. Kept as JSON, in the order it is printed.
 */
export type Domain = JsonObject;

/** One operand (spec 9.6). */
export interface OperandDescription {
  /** Kebab-case. */
  readonly name: string;
  readonly valueName: string;
  readonly valueType: Exclude<ValueType, "switch" | "count">;
  readonly possibleValues?: ReadonlyArray<string>;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly default: Json;
  readonly defaultNote?: string;
  readonly domain?: Domain;
  readonly help: string;
}

/** One option (spec 9.7). */
export interface OptionDescription {
  /** The long name without dashes, kebab-case (the field `resolutionRev` is `resolution-rev`). */
  readonly name: string;
  /** Absent on a switch or a count. */
  readonly valueName?: string;
  readonly valueType: ValueType;
  readonly possibleValues?: ReadonlyArray<string>;
  readonly required: boolean;
  readonly repeatable: boolean;
  /** Typed (spec 9.7.3): `false` for a switch, an array or `null` for a repeatable option, else a value or `null`. */
  readonly default: Json;
  readonly defaultNote?: string;
  readonly domain?: Domain;
  readonly env?: string;
  /** Each argv and `env` value is a comma list of values (spec 9.7.6, a 1.6 tool); absent: a comma is part of the value. */
  readonly commaList?: true;
  readonly flagOnly: boolean;
  readonly short?: string;
  readonly help: string;
}

export type ArgumentDescription = OperandDescription | OptionDescription;

/**
 * A relation between arguments (spec 9.8.1), naming them as `name` does. `needs` is the wire member `then`: a record
 * with a `then` member is a thenable to JavaScript, so it is written only when the document is emitted.
 */
export type ConstraintDescription =
  | {
      readonly rule: "atLeastOne" | "exactlyOne" | "atMostOne";
      readonly names: ReadonlyArray<string>;
      readonly code?: string;
    }
  | {
      readonly rule: "requires" | "forbids";
      readonly if: { readonly name: string; readonly in?: ReadonlyArray<Json> };
      readonly needs: ReadonlyArray<string>;
      readonly code?: string;
    };

/** A stateless check neither a domain nor a constraint expresses (spec 9.8.2). */
export interface ValidatorDescription {
  readonly arguments: ReadonlyArray<string>;
  readonly code: string;
  readonly description: string;
  readonly rejects: ReadonlyArray<string>;
}

/** The selectable paths of an output (spec 6.10, 9.9.1). */
export interface FieldsDescription {
  /** JSON pointer of the record array in `data` (`""`: `data` is the record). */
  readonly records: string;
  readonly paths: ReadonlyArray<string>;
  readonly keep?: ReadonlyArray<string>;
  readonly default?: ReadonlyArray<string>;
}

/** An output's schema: an Effect Schema (its JSON Schema is generated) or a JSON Schema as it stands. */
export type OutputSchema = { readonly effect: Schema.Top } | { readonly json: Json };

/** One form the command prints (spec 9.9). */
export interface OutputDescription {
  readonly kind: "report" | "artifact" | "stream";
  /** The schema's name under `schemas` (`schemaRef` is `#/schemas/<name>`). */
  readonly name: string;
  readonly schemaVersion: string;
  readonly schema: OutputSchema;
  /** An artifact's or a stream's media type. */
  readonly mediaType?: string;
  readonly batch?: boolean;
  readonly when?: string;
  readonly fields?: FieldsDescription;
  /** `x-<tool>` members of the output entry (spec 9.10.2). */
  readonly ext?: JsonObject;
}

/** What a command accepts through `--input` beyond its arguments (spec 9.9.2, 10.11). */
export interface InputDescription {
  /** The most bytes one `--input` takes; absent: the tool's. */
  readonly maxBytes?: number;
  /** A batch input (an array or NDJSON) of at most this many items, with its report version. */
  readonly batch?: { readonly maxItems: number; readonly report: string };
}

/** One command (spec 9.5). */
export interface CommandDescription {
  readonly path: ReadonlyArray<string>;
  readonly summary: string;
  readonly effect: EffectKind;
  readonly idempotency?: Idempotency;
  readonly effectNote?: string;
  readonly async: boolean;
  readonly operands: ReadonlyArray<OperandDescription>;
  /** The command's own options; a tool adds its shared ones (`--json`, `--input`) when it prints the document. */
  readonly options: ReadonlyArray<OptionDescription>;
  readonly constraints: ReadonlyArray<ConstraintDescription>;
  readonly validators: ReadonlyArray<ValidatorDescription>;
  readonly outputs: ReadonlyArray<OutputDescription>;
  /** The codes the command declares; the tool adds its generic ones when it prints the document. */
  readonly errors: ReadonlyArray<string>;
  readonly input: InputDescription;
  readonly examples: ReadonlyArray<string>;
  /** `x-<tool>` members (spec 9.10.2). */
  readonly ext: JsonObject;
}

/**
 * The values one argv or `env` text gives an option (spec 9.7.6): a comma list's pieces in order, split on `,` only (an
 * empty piece stays, for the caller to refuse), else the text itself. `default` and `--input` values are typed arrays
 * and are never split.
 */
export const argvValues = (option: OptionDescription, text: string): ReadonlyArray<string> =>
  option.commaList === true ? text.split(",") : [text];

/** A path word, an option or operand name, a path-shape label: lower kebab-case (spec 4.1.1, 9.6, Annex S1 item 5). */
export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The option name of a field (`resolutionRev` → `resolution-rev`). */
export const optionName = (field: string): string =>
  field.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The field of an option name, as an `--input` document keys it (`resolution-rev` → `resolutionRev`). */
export const fieldName = (option: string): string =>
  option.replaceAll(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** A canonical integer (spec 9.7.2): `-?(0|[1-9][0-9]*)`, within ±(2^53-1) once read (spec 9.7.5). */
export const INTEGER_PATTERN = "^-?(0|[1-9][0-9]*)$";
/** A number in JSON number syntax (spec 9.7.2). */
export const NUMBER_PATTERN = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$";

const INTEGER = new RegExp(INTEGER_PATTERN);
const NUMBER = new RegExp(NUMBER_PATTERN);

/**
 * One argv value of a type as JSON (`"5"` of an integer → `5`); `undefined` when the text is not of the type. A
 * `json` value stays text when it is JSON other than a top-level `null` (spec 9.7.2).
 */
export const typedValue = (type: ValueType, text: string): string | number | undefined => {
  if (type === "integer" || type === "count") {
    if (!INTEGER.test(text)) return undefined;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (type === "number") {
    if (!NUMBER.test(text)) return undefined;
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === "json") {
    const parsed = decodeJsonText(text);
    return Option.isSome(parsed) && parsed.value !== null ? text : undefined;
  }
  return text;
};

/**
 * One argv text as the value it denotes for its argument (spec 9.7.2): a number as the number (`1.0` is `1`), a `json`
 * value as its JSON, anything else (and text its type refuses) as the text. How a document holds the value, and what
 * spec 10.7 step 3 compares.
 */
export const argumentValue = (argument: ArgumentDescription, text: string): Json => {
  if (argument.valueType === "json") return Option.getOrElse(decodeJsonText(text), () => text);
  return typedValue(argument.valueType, text) ?? text;
};
