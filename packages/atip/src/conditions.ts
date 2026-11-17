/**
 * The fifteen conditions an error code ends in (spec 7.2): a tool's own code is `<SUBJECT>_<CONDITION>`, and the
 * condition fixes the exit and gives the default retryability (7.2.2), the way an HTTP client acts on 404, 409 or 503
 * without knowing the server. The grammar is that of 7.2.1.
 */

/** A condition's exit and its default retryability (spec 7.2.2). */
export interface ConditionRow {
  readonly exit: 1 | 2;
  readonly retryable: boolean;
}

/**
 * The conditions of spec 7.2.2 with their exit and default retryability: exit 2 (the command refused, nothing changed)
 * for all but `FAILED`, `INCOMPLETE` and `TIMEOUT` (the command ran: exit 1); retryable only for `UNAVAILABLE` and
 * `TIMEOUT`. A `FAILED`, `INCOMPLETE` or `TIMEOUT` code may be registered either way (7.2.3).
 */
export const CONDITIONS = {
  INVALID: { exit: 2, retryable: false },
  REQUIRED: { exit: 2, retryable: false },
  NOT_FOUND: { exit: 2, retryable: false },
  EXISTS: { exit: 2, retryable: false },
  CONFLICT: { exit: 2, retryable: false },
  STALE: { exit: 2, retryable: false },
  EXPIRED: { exit: 2, retryable: false },
  DENIED: { exit: 2, retryable: false },
  UNSUPPORTED: { exit: 2, retryable: false },
  TOO_LARGE: { exit: 2, retryable: false },
  CORRUPT: { exit: 2, retryable: false },
  UNAVAILABLE: { exit: 2, retryable: true },
  FAILED: { exit: 1, retryable: false },
  INCOMPLETE: { exit: 1, retryable: false },
  TIMEOUT: { exit: 1, retryable: true },
} as const satisfies Readonly<Record<string, ConditionRow>>;

/** A condition word of spec 7.2.2. */
export type Condition = keyof typeof CONDITIONS;

/** The conditions whose code MAY be registered retryable either way (spec 7.2.3): repeating is safe, or it is not. */
export const RETRYABLE_EITHER_WAY: ReadonlyArray<Condition> = ["FAILED", "INCOMPLETE", "TIMEOUT"];

/** The condition words of {@link CONDITIONS} (code-names.test.ts holds the two equal). */
const CONDITION_NAMES: ReadonlyArray<Condition> = [
  "INVALID",
  "REQUIRED",
  "NOT_FOUND",
  "EXISTS",
  "CONFLICT",
  "STALE",
  "EXPIRED",
  "DENIED",
  "UNSUPPORTED",
  "TOO_LARGE",
  "CORRUPT",
  "UNAVAILABLE",
  "FAILED",
  "INCOMPLETE",
  "TIMEOUT",
];

/** The subject of spec 7.2.1: never empty, an upper-case letter then upper-case letters and digits, in `_` segments. */
const SUBJECT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * The condition `code` ends in, by the ABNF of spec 7.2.1 (`code = subject "_" condition`): the longest condition that
 * follows a `_` after a non-empty subject. `undefined` for a code outside the grammar: a core code that predates it
 * (`USAGE`, `INTERNAL`, `UNKNOWN_COMMAND`, `OPERATION_REUSED`, `UNVERIFIABLE`), a bare condition (`NOT_FOUND`), or a name
 * that ends in none (`PROMOTE_REFUSED`, `STOPPED_MIDWAY`).
 */
export const conditionOf = (code: string): Condition | undefined => {
  let found: Condition | undefined;
  for (const condition of CONDITION_NAMES)
    if (
      code.endsWith(`_${condition}`) &&
      (found === undefined || condition.length > found.length) &&
      SUBJECT.test(code.slice(0, code.length - condition.length - 1))
    )
      found = condition;
  return found;
};
