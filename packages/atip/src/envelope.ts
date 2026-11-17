/**
 * The atip/1 envelope, error object, warnings and registry rows as Effect Schemas (spec 6, 7; the normative shapes are
 * the package's copy of `schema/*.schema.json`, which the tests hold these to). A tool decodes what it prints against them.
 */
import { Schema } from "effect";
import { CONDITIONS, conditionOf, RETRYABLE_EITHER_WAY } from "./conditions.ts";
import { FieldPath } from "./fields.ts";

/** The contract identifier every envelope carries in `meta.contract` (spec 6.6). */
export const CONTRACT = "atip/1";

/**
 * The contract minors this library implements, oldest first (spec 15.5): a tool declares one of them, and one build of
 * a tool declares it everywhere and emits nothing a later minor added. A rule a minor adds for its own documents holds
 * only for a tool that declares that minor or a later one ({@link declaresAtLeast}); a tool that declares an earlier
 * minor keeps that minor's behaviour. A minor may also withdraw, for its own documents, what the one before it only
 * recommended: `STOPPED_MIDWAY` is a core code for a tool that declares exactly 1.2 and no later (spec 15.1, 15.7).
 */
export const CONTRACT_MINORS = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] as const;
export type ContractMinor = (typeof CONTRACT_MINORS)[number];

/** The newest minor this library implements, the one a tool declares unless it says otherwise (`meta.contractVersion`). */
export const CONTRACT_VERSION = "1.6" satisfies ContractMinor;

/** Whether a tool that declares `declared` is held to the rules `since` added (Annex S2 rule 16). */
export const declaresAtLeast = (declared: ContractMinor, since: ContractMinor): boolean =>
  CONTRACT_MINORS.indexOf(declared) >= CONTRACT_MINORS.indexOf(since);

export const SchemaVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
);

export const Code = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/));

export const NextStep = Schema.Struct({
  command: Schema.String,
  argv: Schema.Array(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});
export type NextStep = typeof NextStep.Type;

export const Warning = Schema.Struct({
  code: Code,
  message: Schema.String,
  field: Schema.optionalKey(Schema.String),
});

/** Paging (spec 6.9): `nextCursor` is present exactly when more items follow. */
export const Page = Schema.Struct({
  returned: Schema.Int,
  nextCursor: Schema.optionalKey(Schema.String),
  total: Schema.optionalKey(Schema.Int),
});
export type Page = typeof Page.Type;

/** An answer cut by size (spec 6.9). */
export const Truncated = Schema.Struct({
  path: Schema.String,
  kept: Schema.Int,
  total: Schema.optionalKey(Schema.Int),
  bytes: Schema.optionalKey(Schema.Int),
  maxBytes: Schema.optionalKey(Schema.Int),
});
export type Truncated = typeof Truncated.Type;

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);

export const Meta = Schema.Struct({
  schemaVersion: SchemaVersion,
  tool: Schema.String,
  toolVersion: Schema.String,
  command: Schema.optionalKey(Schema.String),
  contract: Schema.optionalKey(Schema.Literal(CONTRACT)),
  contractVersion: Schema.optionalKey(Schema.Literals(CONTRACT_MINORS)),
  output: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  next: Schema.optionalKey(Schema.Array(NextStep)),
  warnings: Schema.optionalKey(Schema.Array(Warning)),
  coverage: Schema.optionalKey(Schema.Record(Schema.String, Scalar)),
  page: Schema.optionalKey(Page),
  fields: Schema.optionalKey(Schema.Array(FieldPath)),
  truncated: Schema.optionalKey(Truncated),
});
export type Meta = typeof Meta.Type;

/**
 * One of several errors of one input (spec 7.1 `details`, `error.schema.json` `$defs/detail`): a code and a message,
 * with the same optional parts as the error itself and no `retryable`.
 */
export const ErrorDetail = <C extends Schema.Top, R extends Schema.Top>(code: C, reason: R) =>
  Schema.Struct({
    code,
    reason: Schema.optionalKey(reason),
    message: Schema.String,
    hint: Schema.optionalKey(Schema.String),
    field: Schema.optionalKey(Schema.String),
    expected: Schema.optionalKey(Schema.Array(Schema.String)),
    received: Schema.optionalKey(Schema.String),
    suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
  });

/**
 * The error object (spec 7.1) over a tool's code set and reason set (7.6: a reason registered under the error's
 * code), with the tool's `x-<tool>` members (spec 9.10.2; `{}` for none). `details` is present only when one input
 * yields several errors (two or more, each a {@link ErrorDetail}); the error itself is the first of them.
 */
export const ErrorBody = <
  C extends Schema.Top,
  R extends Schema.Top,
  X extends Schema.Struct.Fields,
>(
  code: C,
  reason: R,
  extensions: X,
) =>
  Schema.Struct({
    code,
    reason: Schema.optionalKey(reason),
    message: Schema.String,
    retryable: Schema.Boolean,
    hint: Schema.optionalKey(Schema.String),
    field: Schema.optionalKey(Schema.String),
    expected: Schema.optionalKey(Schema.Array(Schema.String)),
    received: Schema.optionalKey(Schema.String),
    suggestions: Schema.optionalKey(Schema.Array(Schema.String)),
    details: Schema.optionalKey(
      Schema.Array(ErrorDetail(code, reason)).check(Schema.isMinLength(2)),
    ),
    ...extensions,
  });

export const SuccessEnvelope = <D extends Schema.Top>(data: D) =>
  Schema.Struct({ ok: Schema.Literal(true), data, meta: Meta });

export const FailureEnvelope = <E extends Schema.Top, D extends Schema.Top>(error: E, data: D) =>
  Schema.Struct({ ok: Schema.Literal(false), error, meta: Meta, data: Schema.optionalKey(data) });

/** A situation under one code that needs its own next action (spec 7.6). */
export interface ReasonEntry {
  readonly reason: string;
  readonly meaning: string;
  readonly fix: string;
}

/** One row of a tool's error registry (spec 7.4): the exit is the code's, never a call site's. */
export interface RegistryEntry {
  readonly code: string;
  readonly exit: 1 | 2;
  readonly retryable: boolean;
  readonly meaning: string;
  readonly fix: string;
  readonly reasons?: ReadonlyArray<ReasonEntry>;
}

/** One row of a tool's warning registry (spec 7.5.2): no exit, no retryability. */
export interface WarningEntry {
  readonly code: string;
  readonly meaning: string;
  readonly fix: string;
}

/**
 * The reserved reasons of 1.1 (spec 7.3.3): the name a tool uses when it registers a reason for one of these situations
 * under the reserved code, so that callers branch on it across tools.
 */
export const RESERVED_REASONS = {
  INPUT_INVALID: [
    "UNREADABLE",
    "STDIN_TTY",
    "EMPTY",
    "NOT_JSON",
    "NOT_OBJECT",
    "BATCH_UNSUPPORTED",
    "UNKNOWN_KEY",
    "FLAG_ONLY_KEY",
    "INVALID_VALUE",
  ],
  INPUT_TOO_LARGE: ["TOO_MANY_BYTES", "TOO_MANY_ITEMS"],
  CURSOR_INVALID: ["FOREIGN", "ARGUMENTS_CHANGED", "EXPIRED"],
} as const;

/**
 * The reserved reason of a tool that declares exactly 1.2 (spec 7.2.3 of the 1.2 text): `PLAN_STALE` under
 * `STOPPED_MIDWAY`, a commit that detected, after it made some of the effects, that the plan changed (11.7). A tool that
 * declares 1.3 has no `STOPPED_MIDWAY`: its stop part-way is its own `<SUBJECT>_INCOMPLETE` whose reasons are the
 * refused codes (spec 8.3.2).
 */
const RESERVED_REASONS_AT_1_2 = { STOPPED_MIDWAY: ["PLAN_STALE"] } as const;

/** The reserved reasons of a tool that declares `minor`, by code. */
export const reservedReasons = (
  minor: ContractMinor,
): Readonly<Record<string, ReadonlyArray<string>>> =>
  minor === "1.2" ? { ...RESERVED_REASONS, ...RESERVED_REASONS_AT_1_2 } : RESERVED_REASONS;

/** A reserved code's exit and retryability (spec 7.3.1). */
export interface ReservedRow {
  readonly exit: 1 | 2;
  readonly retryable: false;
}

/**
 * The twelve core codes of spec 7.3.1 with their exit and retryability (the reserved situations of 1.0 and 1.1; in 1.3
 * the core set again): a tool that can produce one of them uses this code and registers it with these values.
 */
export const RESERVED: Readonly<Record<string, ReservedRow>> = {
  USAGE: { exit: 2, retryable: false },
  UNKNOWN_COMMAND: { exit: 2, retryable: false },
  COMMAND_REQUIRED: { exit: 2, retryable: false },
  INTERNAL: { exit: 1, retryable: false },
  UNVERIFIABLE: { exit: 1, retryable: false },
  INPUT_INVALID: { exit: 2, retryable: false },
  INPUT_CONFLICT: { exit: 2, retryable: false },
  INPUT_TOO_LARGE: { exit: 2, retryable: false },
  BATCH_INCOMPLETE: { exit: 1, retryable: false },
  PLAN_STALE: { exit: 2, retryable: false },
  OPERATION_REUSED: { exit: 2, retryable: false },
  CURSOR_INVALID: { exit: 2, retryable: false },
};

/**
 * The thirteenth core code, for a tool that declares exactly 1.2 (spec 15.7, 8.3.2 of the 1.2 text): `STOPPED_MIDWAY`, a
 * command that works in steps stopped after a step made effects, because a later step met what the command refuses
 * before its work. Its `reason` is that refusal's code alone, an exit-2 code the tool registers. Core only in a
 * document that declares 1.2: in an earlier one the code is the tool's own, and in 1.3 it is no code at all (it ends in
 * no condition, 7.2.3).
 */
export const RESERVED_AT_1_2: Readonly<Record<string, ReservedRow>> = {
  STOPPED_MIDWAY: { exit: 1, retryable: false },
};

/** The core codes of a tool that declares `minor`, with their exit and retryability. */
export const reservedCodes = (minor: ContractMinor): Readonly<Record<string, ReservedRow>> =>
  minor === "1.2" ? { ...RESERVED, ...RESERVED_AT_1_2 } : RESERVED;

/**
 * What a registry of a tool that declares `minor` gets wrong about the reserved codes (spec 7.3.1, Annex S2 rule 14): a
 * reserved code registered with another exit or retryability; and, for a tool that declares exactly 1.2, a `STOPPED_MIDWAY`
 * reason that is not the name of an exit-2 code the registry holds (8.3.2: the reason is the stopping refusal's code).
 * Empty: none.
 */
export const reservedRegistryProblems = (
  minor: ContractMinor,
  entries: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<string> => {
  const reserved = reservedCodes(minor);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  return entries.flatMap((entry) => {
    const row = Object.hasOwn(reserved, entry.code) ? reserved[entry.code] : undefined;
    const shape =
      row !== undefined && (row.exit !== entry.exit || row.retryable !== entry.retryable)
        ? [
            `reserved ${entry.code} is registered with exit ${entry.exit} and retryable ${entry.retryable}, not ${row.exit} and ${row.retryable}`,
          ]
        : [];
    const stops = minor === "1.2" && entry.code === "STOPPED_MIDWAY";
    const reasons = stops
      ? (entry.reasons ?? []).flatMap(({ reason }) =>
          byCode.get(reason)?.exit === 2
            ? []
            : [
                `the STOPPED_MIDWAY reason ${reason} is not an exit-2 code of the registry (spec 8.3.2)`,
              ],
        )
      : [];
    return [...shape, ...reasons];
  });
};

/**
 * What a registry of a tool that declares `minor` gets wrong about code names (spec 7.2.3; none below 1.3, which holds a
 * tool's own codes to no naming rule): every code is a core code (7.3.1) with its core exit and retryability, or follows
 * the grammar of 7.2.1 (`<SUBJECT>_<CONDITION>`) and has its condition's exit and retryability, except that a `FAILED`,
 * `INCOMPLETE` or `TIMEOUT` code may be registered either way. An own code never takes a core code's name, so a core name
 * at another exit or retryability is refused. `STOPPED_MIDWAY` fails: it ends in no condition. Whether a subject is a
 * noun is the author's judgement (approaches/implementation.md §7). Empty: none.
 */
export const codeNameProblems = (
  minor: ContractMinor,
  entries: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<string> =>
  !declaresAtLeast(minor, "1.3")
    ? []
    : entries.flatMap((entry) => {
        const core = Object.hasOwn(RESERVED, entry.code) ? RESERVED[entry.code] : undefined;
        if (core !== undefined)
          return core.exit === entry.exit && core.retryable === entry.retryable
            ? []
            : [
                `reserved ${entry.code} is registered with exit ${entry.exit} and retryable ${entry.retryable}, not ${core.exit} and ${core.retryable}`,
              ];
        const condition = conditionOf(entry.code);
        if (condition === undefined)
          return [
            `code ${entry.code} is neither a core code nor <SUBJECT>_<CONDITION> (spec 7.2.3): it ends in none of the fifteen conditions after a non-empty subject`,
          ];
        const row = CONDITIONS[condition];
        return [
          ...(entry.exit === row.exit
            ? []
            : [
                `code ${entry.code} is registered with exit ${entry.exit}, but its condition ${condition} fixes exit ${row.exit} (spec 7.2.3)`,
              ]),
          ...(entry.retryable === row.retryable || RETRYABLE_EITHER_WAY.includes(condition)
            ? []
            : [
                `code ${entry.code} is registered retryable ${entry.retryable}, but its condition ${condition} fixes ${row.retryable} (spec 7.2.3)`,
              ]),
        ];
      });
