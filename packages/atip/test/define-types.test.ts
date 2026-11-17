/**
 * Type tests of `defineCommand`: `tsc --noEmit` (the workspace `typecheck`)
 * compiles this file, and every `@ts-expect-error` line must be an error, or the directive itself fails the build. So a
 * handler that fails with an error its command does not declare, reads an argument the command does not declare, or
 * sets a reason its code does not register does not compile. The runtime test only checks that the declarations load.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  defineCommand,
  defineError,
  operand,
  report,
  requires,
  switchOption,
} from "../src/index.ts";
import { memberPurge, type Roster, type RosterReader } from "./acme.ts";

const Declared = defineError({
  code: "DECLARED",
  exit: 2,
  retryable: false,
  meaning: "Declared",
  fix: "Fix it",
});
const Undeclared = defineError({
  code: "UNDECLARED",
  exit: 2,
  retryable: false,
  meaning: "Undeclared",
  fix: "Fix it",
});
const Reasoned = defineError({
  code: "REASONED",
  exit: 2,
  retryable: false,
  meaning: "Has reasons",
  fix: "Fix it",
  reasons: { KNOWN: { meaning: "Known", fix: "Fix it" } },
});

/** A use case's own failure that the tool's boundary maps to `CARRIED` (a carrier), and one it maps to nothing. */
class StoreDown extends Schema.TaggedError<StoreDown>()("StoreDown", { reason: Schema.String }) {}
class Unmapped extends Schema.TaggedError<Unmapped>()("Unmapped", { reason: Schema.String }) {}
const Carried = defineError({
  code: "CARRIED",
  exit: 2,
  retryable: true,
  meaning: "The store is down",
  fix: "Retry",
  carriers: [StoreDown],
});

const Done = Schema.Struct({ done: Schema.Boolean });

const declaration = {
  path: ["thing", "do"],
  summary: "Do a thing",
  effect: { kind: "write", idempotency: "replay-safe" },
  operands: [operand("target", Schema.String, { valueName: "TARGET", help: "What to do it to" })],
  input: Schema.Struct({
    round: Schema.Int.annotate({ valueName: "N", description: "Which round" }),
    force: switchOption("Do it anyway"),
  }),
  outputs: [report("Done", "1.0", Done)],
  errors: [Declared, Reasoned, Carried],
  examples: ["tool thing do x --round 1 --json"],
} as const;

export const typed = defineCommand(declaration, (args) => {
  // the arguments are typed from the declaration
  const target: string = args.operands[0];
  const round: number = args.round;
  const force: boolean = args.force;
  return target.length + round > 0 || force
    ? Effect.succeed({ done: true })
    : Declared.fail({ message: "no" });
});

export const failsWithACarrier = defineCommand(declaration, () =>
  Effect.fail(new StoreDown({ reason: "down" })),
);

export const failsWithAReason = defineCommand(declaration, () =>
  Reasoned.fail({ message: "known", reason: "KNOWN" }),
);

/**
 * The negative cases, each line a type error (`@ts-expect-error` fails the build if it is not). They are in a function
 * that never runs: a definition the type refuses may also throw when it is defined.
 */
export const negatives = () => [
  // the error lands on the handler and names the undeclared failure in its error channel; the Effect plugin reports
  // it again (missingEffectError), which `@ts-expect-error` does not cover, so the plugin rule is off for these two only
  // @effect-diagnostics missingEffectError:off
  defineCommand(
    declaration,
    // @ts-expect-error -- UNDECLARED is not in the command's errors
    () => Undeclared.fail({ message: "not declared" }),
  ),
  defineCommand(
    declaration,
    // @ts-expect-error -- Unmapped is no carrier of a declared code
    () => Effect.fail(new Unmapped({ reason: "no code" })),
  ),
  // @effect-diagnostics missingEffectError:on
  defineCommand(declaration, (args) =>
    // @ts-expect-error -- --rounds is not an argument of the command
    Effect.succeed({ done: args.rounds > 0 }),
  ),
  defineCommand(declaration, (args) =>
    // @ts-expect-error -- the command has one operand
    Effect.succeed({ done: args.operands[1].length > 0 }),
  ),
  defineCommand(declaration, () =>
    // @ts-expect-error -- REASONED registers KNOWN only
    Reasoned.fail({ message: "unknown", reason: "UNKNOWN" }),
  ),
  // @ts-expect-error -- the report is { done: boolean }
  defineCommand(declaration, () => Effect.succeed({ finished: true })),
  defineCommand(
    { ...declaration, effect: { kind: "destructive", idempotency: "once" } },
    // @ts-expect-error -- a destructive command's handler is { plan, commit }
    () => Effect.succeed({ done: true }),
  ),
  defineCommand(
    declaration,
    // @ts-expect-error -- a write command's handler is a function of its arguments
    { plan: () => Effect.succeed({ effects: [] }), commit: () => Effect.succeed({ done: true }) },
  ),
  defineCommand(
    {
      ...declaration,
      input: Schema.Struct({
        colour: Schema.Literals(["red", "blue"]).annotate({
          valueName: "COLOUR",
          description: "A colour",
        }),
      }),
      // @ts-expect-error -- green is no value of --colour
      constraints: [requires({ name: "colour", in: ["green"] }, ["target"])],
    },
    () => Effect.succeed({ done: true }),
  ),
];

/** The services a destructive handler's `plan` and `commit` need, as `defineCommand` inferred them. */
type PlanServices<H> = H extends {
  readonly plan: (args: never) => Effect.Effect<unknown, unknown, infer RPlan>;
}
  ? RPlan
  : never;
type CommitServices<H> = H extends {
  readonly commit: (args: never, plan: never) => Effect.Effect<unknown, unknown, infer R>;
}
  ? R
  : never;

/** acme's purge plans with exactly the read port: the type holds no write capability for its preview (spec 11.2). */
export const purgePlanReadsOnly: [PlanServices<typeof memberPurge.handler>] extends [RosterReader]
  ? [RosterReader] extends [PlanServices<typeof memberPurge.handler>]
    ? true
    : false
  : false = true;

/** Its commit is what changes the roster. */
export const purgeCommitWrites: Roster extends CommitServices<typeof memberPurge.handler>
  ? true
  : false = true;

describe("F1-F2 typed handlers", () => {
  test("the declarations of the type tests load (the type errors are tsc's to prove)", () => {
    expect(typed.description.errors).toEqual(["DECLARED", "REASONED", "CARRIED"]);
    expect(Carried.carriers).toEqual([StoreDown]);
    expect(Declared.carriers).toEqual([]);
    expect(Reasoned.reasons).toEqual(["KNOWN"]);
    // the row's members in the registry's order, its carriers no member of it
    expect(Object.keys(Carried.entry)).toEqual(["code", "exit", "retryable", "meaning", "fix"]);
    expect(Object.keys(Reasoned.entry)).toEqual([
      "code",
      "exit",
      "retryable",
      "meaning",
      "fix",
      "reasons",
    ]);
    expect(failsWithACarrier.description.path).toEqual(["thing", "do"]);
  });
});
