/**
 * A tool's errors and warnings as values (approaches/typescript.md §3.1 "Reasons and warnings"): `defineError` gives
 * one registered code with its registry row (spec 7.4) and a failure constructor whose `reason` is one of the code's
 * own reasons (spec 7.6), so a reason not registered under the code does not type-check. A command lists the errors it
 * can fail with, and its handler's error channel is exactly their failures (`FailureOf`).
 *
 * A tool whose use cases already fail with their own tagged errors, which its boundary maps to codes, names those
 * classes as an error's `carriers`: a handler may fail with them too, and the tool's boundary keeps mapping them.
 */
import { Data, Effect } from "effect";
import { CONDITIONS, conditionOf, RETRYABLE_EITHER_WAY } from "./conditions.ts";
import type { ReasonEntry, RegistryEntry, WarningEntry } from "./envelope.ts";

/** The parts of an error the caller acts on (spec 7.1), besides its code: what a failure carries. */
export interface FailureParts<Reason extends string> {
  readonly message: string;
  /** One of the code's registered reasons (spec 7.6); a code with none takes none. */
  readonly reason?: Reason;
  readonly field?: string;
  readonly expected?: ReadonlyArray<string>;
  readonly received?: string;
  readonly suggestions?: ReadonlyArray<string>;
  readonly hint?: string;
  /**
   * `meta.next` of the refusal (spec 6.8): each an argv after the tool name, which the tool's boundary writes as a next
   * step with its own name (`nextStep(tool, argv)`). `PLAN_STALE` carries the preview (spec 11.7).
   */
  readonly next?: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * Every problem of one input when it has several (spec 7.1 `details`, two or more; the failure itself is the first):
   * each of the failure's code, with its own reason (the failure's when absent), message, field and hint.
   */
  readonly details?: ReadonlyArray<{
    readonly reason?: Reason;
    readonly message: string;
    readonly field?: string;
    readonly hint?: string;
  }>;
}

/**
 * A command's typed failure: a registered code with its parts. A `Data.TaggedError` and not a `Schema.TaggedError`:
 * its code and reason are type parameters, so that the failures of two codes are two types.
 */
export class CommandFailure<
  Code extends string = string,
  Reason extends string = string,
> extends Data.TaggedError("CommandFailure")<FailureParts<Reason> & { readonly code: Code }> {}

/** A class whose instances a tool's boundary maps to one code (a use case's own tagged error). */
export type Carrier<C = unknown> = abstract new (...args: ReadonlyArray<never>) => C;

/** One registered error code as a value: its registry row and its failure constructor. */
export interface DefinedError<Code extends string, Reason extends string, C extends Carrier> {
  readonly code: Code;
  /** The registry row `schema --errors` prints (spec 7.4, `registry-entry.schema.json`). */
  readonly entry: RegistryEntry;
  /** The names of the code's reasons (spec 7.6), in the order its row lists them. */
  readonly reasons: ReadonlyArray<Reason>;
  /** The classes the tool's boundary maps to this code. */
  readonly carriers: ReadonlyArray<C>;
  make(parts: FailureParts<Reason>): CommandFailure<Code, Reason>;
  fail(parts: FailureParts<Reason>): Effect.Effect<never, CommandFailure<Code, Reason>>;
  is(value: unknown): value is CommandFailure<Code, Reason>;
}

/** Any defined error, for lists of them. */
export type AnyDefinedError = DefinedError<string, string, Carrier>;

type InstanceOf<C> = C extends Carrier<infer I> ? I : never;

/** What a handler may fail with for one defined error: its failure, or an instance of one of its carriers. */
export type FailureOf<E> =
  E extends DefinedError<infer Code, infer Reason, infer C>
    ? CommandFailure<Code, Reason> | InstanceOf<C>
    : never;

/** The texts of one reason (spec 7.6); a reason has no exit of its own. */
export interface ReasonText {
  readonly meaning: string;
  readonly fix: string;
}

/**
 * A code's registry row without the code. `exit` and `retryable` are the condition's when the code ends in one (spec
 * 7.2.2) and may then be left out; a code that ends in none (a core code like `USAGE`, `INTERNAL`, or the legacy name of
 * a tool that declares 1.2 or earlier) gives both.
 */
export interface ErrorRow {
  readonly exit?: 1 | 2;
  readonly retryable?: boolean;
  readonly meaning: string;
  readonly fix: string;
  readonly reasons?: ReadonlyArray<ReasonEntry>;
}

/**
 * The exit and retryability a definition registers (spec 7.2.2, 7.2.3): the condition's, which a given value must equal
 * (`retryable` may differ on `FAILED`, `INCOMPLETE` and `TIMEOUT`: repeating the same invocation is safe, or it is
 * not); both as given for a code that ends in no condition.
 */
const rowOf = (
  code: string,
  given: Pick<ErrorRow, "exit" | "retryable">,
): { readonly exit: 1 | 2; readonly retryable: boolean } => {
  const condition = conditionOf(code);
  if (condition === undefined) {
    if (given.exit === undefined || given.retryable === undefined)
      throw new Error(
        `error ${code} ends in none of the fifteen conditions (spec 7.2.1), so it must give its exit and retryable`,
      );
    return { exit: given.exit, retryable: given.retryable };
  }
  const row = CONDITIONS[condition];
  if (given.exit !== undefined && given.exit !== row.exit)
    throw new Error(
      `error ${code} is given exit ${given.exit}, but its condition ${condition} fixes exit ${row.exit} (spec 7.2.2)`,
    );
  if (
    given.retryable !== undefined &&
    given.retryable !== row.retryable &&
    !RETRYABLE_EITHER_WAY.includes(condition)
  )
    throw new Error(
      `error ${code} is given retryable ${given.retryable}, but its condition ${condition} fixes ${row.retryable} (spec 7.2.3)`,
    );
  return { exit: row.exit, retryable: given.retryable ?? row.retryable };
};

/**
 * One error code (spec 7.4): `reasons` is keyed by reason name, and the failure constructor takes `reason` typed as
 * the union of those keys. The exit is the code's: a reason shares it (spec 7.4.2). `carriers` are the tool's own
 * failure classes its boundary maps to this code (a use case's tagged errors): a handler of a command that lists this
 * error may fail with them too.
 *
 * A code that ends in a condition (`<SUBJECT>_<CONDITION>`, spec 7.2.1) takes its exit and retryability from it (7.2.2);
 * a given value must agree: another exit, or another `retryable` on any condition but `FAILED`, `INCOMPLETE` and
 * `TIMEOUT` (7.2.3), throws here, when the definition is made. A code that ends in none must give both.
 */
export const defineError = <
  const Code extends string,
  const Reasons extends Readonly<Record<string, ReasonText>> = Readonly<Record<never, ReasonText>>,
  const Carriers extends ReadonlyArray<Carrier> = readonly [],
>(
  definition: Omit<ErrorRow, "reasons"> & {
    readonly code: Code;
    readonly reasons?: Reasons;
    readonly carriers?: Carriers;
  },
): DefinedError<Code, keyof Reasons & string, Carriers[number]> => {
  const { code, reasons } = definition;
  const { exit, retryable } = rowOf(code, definition);
  const names =
    reasons === undefined
      ? []
      : Object.keys(reasons).filter((name): name is keyof Reasons & string =>
          Object.hasOwn(reasons, name),
        );
  const listed = names.flatMap((reason) => {
    const text = reasons?.[reason];
    return text === undefined ? [] : [{ reason, meaning: text.meaning, fix: text.fix }];
  });
  const carriers: ReadonlyArray<Carriers[number]> = definition.carriers ?? [];
  // the row's members in the registry's order (spec 7.4), whatever order the definition gives them in
  const entry: RegistryEntry = {
    code,
    exit,
    retryable,
    meaning: definition.meaning,
    fix: definition.fix,
    ...(listed.length === 0 ? {} : { reasons: listed }),
  };
  return {
    code,
    entry,
    reasons: names,
    carriers,
    make: (parts) => new CommandFailure({ ...parts, code }),
    fail: (parts) => Effect.fail(new CommandFailure({ ...parts, code })),
    is: (value): value is CommandFailure<Code, keyof Reasons & string> =>
      value instanceof CommandFailure && value.code === code,
  };
};

/** One occurrence of a warning in `meta.warnings` (spec 7.5). */
export interface WarningValue<Code extends string> {
  readonly code: Code;
  readonly message: string;
  readonly field?: string;
}

/** One warning code as a value: its registry row (spec 7.5.2) and the value a handler puts in `meta.warnings`. */
export interface DefinedWarning<Code extends string> {
  readonly code: Code;
  readonly entry: WarningEntry;
  make(message: string, field?: string): WarningValue<Code>;
}

/** One warning code: a warning that is not defined cannot be emitted. */
export const defineWarning = <const Code extends string>(
  entry: WarningEntry & { readonly code: Code },
): DefinedWarning<Code> => ({
  code: entry.code,
  entry: { code: entry.code, meaning: entry.meaning, fix: entry.fix },
  make: (message, field) =>
    field === undefined ? { code: entry.code, message } : { code: entry.code, message, field },
});
