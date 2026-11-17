/**
 * Declaring a command's arguments (approaches/typescript.md §3.1, §3.3-3.5): an option is a field of the command's
 * `input` Struct, an operand is `operand(...)`. What the type does not say is an annotation on the field's schema:
 * `description` (the help), `valueName`, `defaultNote`, `env`, `flagOnly`, `short`, and `valueType` where the JSON
 * Schema cannot tell it (`json`, `count`). `describeCommand` reads them with the field's JSON Schema.
 */
import { Effect, Schema } from "effect";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /** The placeholder in help (`N`, `CHANGE_ID`); every argument but a switch or a count has one. */
      readonly valueName?: string | undefined;
      /** How a default computed at run time is found (spec 9.7.3). */
      readonly defaultNote?: string | undefined;
      /**
       * The environment variable read when the option is absent (spec 10.7 step 5). `decodeArguments` reads it from the
       * `env` record its caller passes (the library never reads `process.env`); a switch or a count has none.
       */
      readonly env?: string | undefined;
      /** The option cannot be given in an `--input` document (spec 10.6). */
      readonly flagOnly?: boolean | undefined;
      /** One letter (spec 9.7.1). */
      readonly short?: string | undefined;
      /** The valueType a JSON Schema does not tell: a `json` value, or a `count`. */
      readonly valueType?: "json" | "count" | undefined;
      /** The `description` of the argument's `domain` (the field's own `description` is its help). */
      readonly domainDescription?: string | undefined;
      /**
       * A repeatable option whose argv and `env` values are comma lists (spec 9.7.6, a 1.6 tool): `--tag a,b` gives two
       * values. Its domain must admit no comma (Annex S2 rule 18); `defineTool` refuses it otherwise.
       */
      readonly commaList?: boolean | undefined;
    }
  }
}

/**
 * A field with a typed default (§3.4): `withDecodingDefault` for the decoder, the `default` annotation for the
 * generator, which cannot see inside the decoding default. A default computed at run time is no `defaulted`: the field
 * is `optionalKey` with a `defaultNote`.
 */
export const defaulted = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value))).annotate({ default: value });

/** A path argument: a string the generator types `path` (relative to the working directory, spec 9.7.2). */
export const Path = Schema.String.annotate({ format: "path" });

/** A switch (`--name`, spec 9.7.2): false when absent, so the handler reads a boolean. */
export const switchOption = (help: string) =>
  defaulted(Schema.Boolean, false).annotate({ description: help });

/** A `json` argument: any JSON value but a top-level `null`; `schema` restricts it within the domain profile. */
export const json = <S extends Schema.Top = Schema.Unknown>(schema?: S) =>
  (schema ?? Schema.Unknown).annotate({ valueType: "json" });

/** A count (`-v -v`, spec 9.7.2): repeatable, a non-negative integer, `0` when absent. */
export const count = (help: string) =>
  defaulted(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 0).annotate({
    valueType: "count",
    description: help,
  });

/** What `operand` takes besides the name and the schema. */
export interface OperandOptions {
  readonly valueName: string;
  readonly help: string;
  /** Takes every remaining word (the last operand only); the handler gets an array. */
  readonly variadic?: boolean;
  /** Absent: required. */
  readonly required?: boolean;
  /** What an absent optional operand means. */
  readonly defaultNote?: string;
}

/** The schema of one operand value: it decodes with no service. */
export type OperandSchema = Schema.Top & Schema.Decoder<unknown>;

/**
 * One operand (§3.5): its schema is one value's; a variadic operand takes an array of them. `Variadic` and `Required`
 * are what the handler's `operands` tuple is typed from.
 */
export interface Operand<
  Name extends string,
  S extends OperandSchema,
  Variadic extends boolean,
  Required extends boolean,
> {
  readonly name: Name;
  readonly schema: S;
  readonly valueName: string;
  readonly help: string;
  readonly variadic: Variadic;
  readonly required: Required;
  readonly defaultNote?: string;
}

export type AnyOperand = Operand<string, OperandSchema, boolean, boolean>;

/** One operand, named in kebab-case as constraints and validators name it. */
export function operand<const Name extends string, S extends OperandSchema>(
  name: Name,
  schema: S,
  options: OperandOptions & { readonly variadic: true },
): Operand<Name, S, true, boolean>;
export function operand<const Name extends string, S extends OperandSchema>(
  name: Name,
  schema: S,
  options: OperandOptions & { readonly variadic?: false; readonly required: false },
): Operand<Name, S, false, false>;
export function operand<const Name extends string, S extends OperandSchema>(
  name: Name,
  schema: S,
  options: OperandOptions & { readonly variadic?: false; readonly required?: true },
): Operand<Name, S, false, true>;
export function operand<const Name extends string, S extends OperandSchema>(
  name: Name,
  schema: S,
  options: OperandOptions,
): Operand<Name, S, boolean, boolean> {
  return {
    name,
    schema,
    valueName: options.valueName,
    help: options.help,
    variadic: options.variadic ?? false,
    required: options.required ?? true,
    ...(options.defaultNote === undefined ? {} : { defaultNote: options.defaultNote }),
  };
}
