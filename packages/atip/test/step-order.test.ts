/**
 * The first failure of a bad invocation (spec 10.7 step 6 since 1.2, 9.8.1's `field` table) on the example tool
 * `acme`, declared as 1.3, 1.2 and 1.1. A 1.2 tool answers with the earliest argv parse failure by position
 * (with `--input`, after the document is read and validated), then `required`, domains, constraints and validators,
 * operands before options; a 1.1 tool keeps 1.1's order; a 1.3 tool keeps 1.2's (1.3 relaxes it to a recommendation, Appendix A
 * D36, and this library keeps it) and names an unknown option `OPTION_INVALID` and a missing operand `OPERAND_REQUIRED`
 * (spec 7.3.2). Each case pairs two failure kinds in one invocation and runs
 * the whole runner, so the validators take part.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  ArgumentsError,
  type ConstraintDescription,
  type ContractMinor,
  defineCommand,
  defineTool,
  parseCommandLine,
  parserProfile,
  report,
  type RunnerHooks,
  runCommandLine,
  SelectionError,
  switchOption,
  toolDescription,
} from "../src/index.ts";
import { ACME, ACME_TOOL_DECLARATION } from "./acme.ts";

/** A failure as acme would print it: its code and field. */
interface Failure {
  readonly code: string;
  readonly field?: string;
}

const failureOf = (parts: {
  readonly code: string;
  readonly field?: string | undefined;
}): Failure =>
  parts.field === undefined ? { code: parts.code } : { code: parts.code, field: parts.field };

/** acme declaring `minor`: everything else as acme declares it. */
const acmeDeclaring = (contractVersion: ContractMinor) =>
  defineTool({
    ...ACME_TOOL_DECLARATION,
    profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion },
  });

const TOOLS = {
  "1.1": acmeDeclaring("1.1"),
  "1.2": acmeDeclaring("1.2"),
  "1.3": acmeDeclaring("1.3"),
  "1.4": acmeDeclaring("1.4"),
  "1.5": acmeDeclaring("1.5"),
  "1.6": acmeDeclaring("1.6"),
} as const;

/** Hooks that refuse or succeed without state: an inline `--input` is its JSON, a file named `missing` unreadable. */
const HOOKS: RunnerHooks<Failure | { readonly ran: true }, string, unknown, never> = {
  refusal: failureOf,
  readInput: (value) =>
    value.startsWith("{")
      ? Effect.succeed(JSON.parse(value))
      : Effect.fail({ code: "INPUT_INVALID", field: "--input" }),
  invalid: (failure) =>
    failure instanceof ArgumentsError
      ? { code: "USAGE" }
      : failure instanceof SelectionError
        ? { code: "USAGE", field: "--fields" }
        : failureOf(failure),
  preconditions: () => Effect.succeed("context"),
  execute: () => Effect.succeed(null),
  emit: {
    version: Effect.succeed(0),
    help: () => Effect.succeed(0),
    failure: () => Effect.succeed(2),
    outcome: () => Effect.succeed(0),
    defect: () => Effect.succeed(1),
  },
};

/** The first failure acme declaring `minor` answers `argv` with, or "ran". */
const firstFailure = (minor: ContractMinor, argv: ReadonlyArray<string>): Failure | "ran" => {
  let answer: Failure | "ran" = "ran";
  Effect.runSync(
    runCommandLine(
      TOOLS[minor],
      argv,
      {},
      {
        ...HOOKS,
        emit: {
          ...HOOKS.emit,
          failure: (failure) =>
            Effect.sync(() => {
              if (!("ran" in failure)) answer = failure;
              return 2;
            }),
        },
      },
    ),
  );
  return answer;
};

/** Each case: the two failures it holds, its argv, and the first failure each minor answers. */
const PAIRS: ReadonlyArray<{
  readonly pair: string;
  readonly argv: ReadonlyArray<string>;
  readonly "1.1": Failure;
  readonly "1.2": Failure;
  readonly "1.3": Failure;
}> = [
  {
    pair: "a wrong-type operand, then an unknown option",
    argv: ["member", "tag", "x", "--bogus", "--tag", "core"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "OPERAND_INVALID", field: "number" },
    "1.3": { code: "OPERAND_INVALID", field: "number" },
  },
  {
    pair: "an unknown option, then a wrong-type operand",
    argv: ["member", "tag", "--bogus", "x", "--tag", "core"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.3": { code: "OPTION_INVALID", field: "--bogus" },
  },
  {
    pair: "a word past the last operand, then an unknown option",
    argv: ["member", "show", "7", "8", "--bogus"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "OPERAND_INVALID", field: "operands" },
    "1.3": { code: "OPERAND_INVALID", field: "operands" },
  },
  {
    pair: "a missing value, then an unknown option",
    argv: ["member", "tag", "7", "--tag", "--bogus"],
    "1.1": { code: "OPTION_VALUE_REQUIRED", field: "--tag" },
    "1.2": { code: "OPTION_VALUE_REQUIRED", field: "--tag" },
    "1.3": { code: "OPTION_VALUE_REQUIRED", field: "--tag" },
  },
  {
    pair: "a wrong-type operand (parse) and a missing required option",
    argv: ["member", "tag", "x"],
    "1.1": { code: "OPTION_REQUIRED", field: "--tag" },
    "1.2": { code: "OPERAND_INVALID", field: "number" },
    "1.3": { code: "OPERAND_INVALID", field: "number" },
  },
  {
    pair: "a missing operand and a missing option: operands first",
    argv: ["member", "tag"],
    "1.1": { code: "OPERAND_MISSING", field: "number" },
    "1.2": { code: "OPERAND_MISSING", field: "number" },
    "1.3": { code: "OPERAND_REQUIRED", field: "number" },
  },
  {
    pair: "a missing required option and an operand outside its domain",
    argv: ["member", "tag", "0"],
    "1.1": { code: "OPTION_REQUIRED", field: "--tag" },
    "1.2": { code: "OPTION_REQUIRED", field: "--tag" },
    "1.3": { code: "OPTION_REQUIRED", field: "--tag" },
  },
  {
    pair: "an operand and an option outside their domains: the operand first",
    argv: ["member", "tag", "0", "--tag", "Core"],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.2": { code: "OPERAND_INVALID", field: "number" },
    "1.3": { code: "OPERAND_INVALID", field: "number" },
  },
  {
    pair: "an option outside its domain and a broken constraint",
    argv: ["member", "tag", "7", "--tag", "Core", "--expires", "2026-12-01"],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.2": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.3": { code: "OPTION_VALUE_INVALID", field: "--tag" },
  },
  {
    pair: "two broken constraints: declaration order",
    argv: [
      "member",
      "tag",
      "7",
      "--tag",
      "core",
      "--quiet",
      "--verbose",
      "--expires",
      "2026-12-01",
    ],
    "1.1": { code: "NOTE_REQUIRED", field: "--note" },
    "1.2": { code: "NOTE_REQUIRED", field: "--note" },
    "1.3": { code: "NOTE_REQUIRED", field: "--note" },
  },
  {
    pair: "a broken constraint and a failing validator: the constraint, its field by the table",
    argv: [
      "member",
      "tag",
      "7",
      "--tag",
      "core",
      "--expires",
      "2026-02-30",
      "--note",
      "trial",
      "--quiet",
      "--verbose",
    ],
    "1.1": { code: "USAGE", field: "--verbose" },
    "1.2": { code: "USAGE", field: "--quiet" },
    "1.3": { code: "USAGE", field: "--quiet" },
  },
  {
    pair: "an unknown option and a broken constraint",
    argv: ["member", "tag", "7", "--tag", "core", "--quiet", "--verbose", "--bogus"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.3": { code: "OPTION_INVALID", field: "--bogus" },
  },
  {
    pair: "a missing required option and a broken constraint",
    argv: ["member", "tag", "7", "--quiet", "--verbose"],
    "1.1": { code: "OPTION_REQUIRED", field: "--tag" },
    "1.2": { code: "OPTION_REQUIRED", field: "--tag" },
    "1.3": { code: "OPTION_REQUIRED", field: "--tag" },
  },
  {
    pair: "an option outside its domain and a failing validator",
    argv: ["member", "tag", "7", "--tag", "Core", "--expires", "2026-02-30", "--note", "trial"],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.2": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.3": { code: "OPTION_VALUE_INVALID", field: "--tag" },
  },
  {
    pair: "a failing validator alone",
    argv: ["member", "tag", "7", "--tag", "core", "--expires", "2026-02-30", "--note", "trial"],
    "1.1": { code: "DATE_INVALID", field: "--expires" },
    "1.2": { code: "DATE_INVALID", field: "--expires" },
    "1.3": { code: "DATE_INVALID", field: "--expires" },
  },
  {
    pair: "an argv parse failure and a bad --input key: with --input, the document first (steps 1-2)",
    argv: ["member", "tag", "7", "--bogus", "--input", '{"nosuch":1}'],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "INPUT_INVALID", field: "/nosuch" },
    "1.3": { code: "INPUT_INVALID", field: "/nosuch" },
  },
  {
    pair: "an argv parse failure and an unreadable --input: the read first",
    argv: ["member", "tag", "7", "--bogus", "--input", "missing"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "INPUT_INVALID", field: "--input" },
    "1.3": { code: "INPUT_INVALID", field: "--input" },
  },
  {
    pair: "an argv parse failure and a good --input: argv's at step 3, before any conflict",
    argv: ["member", "tag", "8", "--bogus", "--input", '{"operands":[7],"tag":"core"}'],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.3": { code: "OPTION_INVALID", field: "--bogus" },
  },
  {
    pair: "a missing option and an operand outside its domain after --input's merge",
    argv: ["member", "tag", "--input", '{"operands":[0]}'],
    "1.1": { code: "OPTION_REQUIRED", field: "/tag" },
    "1.2": { code: "OPTION_REQUIRED", field: "/tag" },
    "1.3": { code: "OPTION_REQUIRED", field: "/tag" },
  },
  {
    pair: "an operand and an option outside their domains after --input's merge",
    argv: ["member", "tag", "--input", '{"operands":[0],"tag":"Core"}'],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "/tag" },
    "1.2": { code: "OPERAND_INVALID", field: "/operands/0" },
    "1.3": { code: "OPERAND_INVALID", field: "/operands/0" },
  },
  {
    pair: "an argv operand outside its domain with --input: refused after the merge, by its argv name",
    argv: ["member", "tag", "0", "--input", '{"tag":"core"}'],
    "1.1": { code: "OPERAND_INVALID", field: "number" },
    "1.2": { code: "OPERAND_INVALID", field: "number" },
    "1.3": { code: "OPERAND_INVALID", field: "number" },
  },
  {
    pair: "an argv option outside its domain with --input: refused after the merge, by its flag",
    argv: ["member", "tag", "7", "--tag", "Core", "--input", '{"note":"why"}'],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.2": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.3": { code: "OPTION_VALUE_INVALID", field: "--tag" },
  },
  {
    pair: "an argv option outside its domain whose document gives it too: the conflict (step 3) first",
    argv: ["member", "tag", "7", "--tag", "Core", "--input", '{"tag":"core"}'],
    "1.1": { code: "OPTION_VALUE_INVALID", field: "--tag" },
    "1.2": { code: "INPUT_CONFLICT", field: "/tag" },
    "1.3": { code: "INPUT_CONFLICT", field: "/tag" },
  },
  {
    pair: "--input given twice: no one document to read, so argv's failure answers before any read",
    argv: ["member", "tag", "7", "--input", "missing", "--input", "missing"],
    "1.1": { code: "OPTION_CONFLICT", field: "--input" },
    "1.2": { code: "OPTION_CONFLICT", field: "--input" },
    "1.3": { code: "OPTION_CONFLICT", field: "--input" },
  },
  {
    pair: "an unknown option and --input given twice: the earliest argv failure, before any read",
    argv: ["member", "tag", "7", "--bogus", "--input", "missing", "--input", "missing"],
    "1.1": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.2": { code: "UNKNOWN_OPTION", field: "--bogus" },
    "1.3": { code: "OPTION_INVALID", field: "--bogus" },
  },
];

describe("the first failure (spec 10.7 step 6): 1.2's fixed order, kept in 1.3, and 1.1's", () => {
  for (const minor of ["1.1", "1.2", "1.3"] as const)
    test(`acme declaring ${minor}: each pair of failure kinds answers with the first in its order`, () => {
      for (const { pair, argv, ...expected } of PAIRS)
        expect({ pair, failure: firstFailure(minor, argv) }).toEqual({
          pair,
          failure: expected[minor],
        });
    });

  test("a valid invocation still runs under both minors", () => {
    for (const minor of ["1.1", "1.2", "1.3"] as const)
      expect(firstFailure(minor, ["member", "tag", "7", "--tag", "core", "--json"])).toBe("ran");
  });
});

// ------------------------------------------------------------------------------------- 9.8.1's field table

const audit = defineCommand(
  {
    path: ["member", "audit"],
    summary: "Audit the roster",
    effect: { kind: "read" },
    input: Schema.Struct({
      alpha: switchOption("Alpha"),
      beta: switchOption("Beta"),
      gamma: switchOption("Gamma"),
      delta: switchOption("Delta"),
    }),
    outputs: [report("Audit", "1.0", Schema.Struct({}))],
    errors: [],
    examples: ["acme member audit --alpha --json"],
  },
  () => Effect.succeed({}),
);

const AUDIT = toolDescription(audit.description, ACME);

/** The `field` acme declaring `minor` refuses `--FLAGS` with under one rule; undefined when it holds. */
const fieldUnder = (
  minor: ContractMinor,
  rule: ConstraintDescription,
  flags: ReadonlyArray<string>,
): string | undefined => {
  const result = parseCommandLine(
    parserProfile({ name: "acme", contractVersion: minor }),
    [{ ...AUDIT, constraints: [rule] }],
    ["member", "audit", ...flags.map((flag) => `--${flag}`)],
    {},
  );
  return Result.isFailure(result) ? (result.failure.refusal.field ?? "") : undefined;
};

/** Each row of the table: the rule, the names given, and the field each minor names. */
const ROWS: ReadonlyArray<{
  readonly row: string;
  readonly rule: ConstraintDescription;
  readonly given: ReadonlyArray<string>;
  readonly "1.1": string;
  readonly "1.2": string;
  readonly "1.3": string;
}> = [
  {
    row: "requires: the first name in then not given",
    rule: {
      rule: "requires",
      if: { name: "alpha" },
      needs: ["beta", "gamma", "delta"],
    },
    given: ["delta", "alpha"],
    "1.1": "--beta",
    "1.2": "--beta",
    "1.3": "--beta",
  },
  {
    row: "forbids: the first name in then given",
    rule: {
      rule: "forbids",
      if: { name: "alpha" },
      needs: ["beta", "gamma", "delta"],
    },
    given: ["delta", "gamma", "alpha"],
    "1.1": "--gamma",
    "1.2": "--gamma",
    "1.3": "--gamma",
  },
  {
    row: "atMostOne: the first given name (1.1: the second)",
    rule: { rule: "atMostOne", names: ["alpha", "beta", "gamma", "delta"] },
    given: ["delta", "gamma", "beta"],
    "1.1": "--gamma",
    "1.2": "--beta",
    "1.3": "--beta",
  },
  {
    row: "exactlyOne with more than one given: the first given name (1.1: the second)",
    rule: { rule: "exactlyOne", names: ["alpha", "beta", "gamma", "delta"] },
    given: ["delta", "beta"],
    "1.1": "--delta",
    "1.2": "--beta",
    "1.3": "--beta",
  },
  {
    row: "exactlyOne with none given: the first name",
    rule: { rule: "exactlyOne", names: ["beta", "gamma"] },
    given: ["alpha"],
    "1.1": "--beta",
    "1.2": "--beta",
    "1.3": "--beta",
  },
  {
    row: "atLeastOne with none given: the first name",
    rule: { rule: "atLeastOne", names: ["gamma", "delta"] },
    given: [],
    "1.1": "--gamma",
    "1.2": "--gamma",
    "1.3": "--gamma",
  },
];

describe("a constraint's field (spec 9.8.1): the rule's own order, never argv's", () => {
  for (const minor of ["1.1", "1.2", "1.3"] as const)
    test(`acme declaring ${minor}: every row of the table`, () => {
      for (const { row, rule, given, ...expected } of ROWS)
        expect({ row, field: fieldUnder(minor, rule, given) }).toEqual({
          row,
          field: expected[minor],
        });
    });
});
