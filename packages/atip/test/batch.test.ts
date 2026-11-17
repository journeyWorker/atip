/**
 * Batches (spec 10.11) through the runner on the example tool `acme` with a batch command, `member label`: every item
 * is checked before any runs (a refusal of one item answers for the batch, exit 2, its pointer under `/<index>`);
 * the items then run in order and the first that fails stops the batch with `BATCH_INCOMPLETE`, earlier items
 * `written` or `unchanged`, that item `failed` with its own error, later ones `skipped`. The reports are atip/1 batch
 * reports by the contract's schema; a destructive command and a command without `batch` take no batch.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import {
  argumentRecord,
  ArgumentsError,
  batchField,
  type BatchOutcome,
  batchReport,
  CommandFailure,
  decodeArguments,
  defineCommand,
  defineError,
  defineTool,
  operand,
  report,
  type RunnerHooks,
  runCommandLine,
  type Tool,
  type ToolInvocation,
} from "../src/index.ts";
import { batchReportProblems, envelopeProblems, schemaAnswerProblems } from "../src/validate.ts";
import {
  ACME_TOOL_DECLARATION,
  type Member,
  MemberNotFound,
  memberPurge,
  rosterOf,
  RosterReader,
} from "./acme.ts";

const MemberLabelled = Schema.Struct({
  number: Schema.Int,
  label: Schema.String,
  unchanged: Schema.Boolean,
});

/** `acme member label <NUMBER> --label <LABEL>`: a replay-safe write that takes a batch of up to three documents. */
const memberLabel = defineCommand(
  {
    path: ["member", "label"],
    summary: "Label a member",
    effect: { kind: "write", idempotency: "replay-safe" },
    operands: [
      operand("number", Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), {
        valueName: "NUMBER",
        help: "The member's number",
      }),
    ],
    input: Schema.Struct({
      label: Schema.String.check(Schema.isPattern(/^[a-z]+$/u)).annotate({
        valueName: "LABEL",
        description: "The label, lower-case letters",
      }),
    }),
    outputs: [report("MemberLabelled", "1.0", MemberLabelled)],
    errors: [MemberNotFound],
    batch: { maxItems: 3, report: "1.0" },
    examples: ["acme member label 7 --label lead --json"],
  },
  (args) =>
    Effect.gen(function* () {
      const [number] = args.operands;
      const member = yield* (yield* RosterReader).find(number);
      if (member === undefined)
        return yield* MemberNotFound.fail({ message: `no member has number ${number}` });
      return { number, label: args.label, unchanged: member.tags.includes(args.label) };
    }),
);

const BatchIncomplete = defineError({
  code: "BATCH_INCOMPLETE",
  meaning: "A batch stopped during execution: items before the failed one are done",
  fix: "Read data.items, fix the failed item, and send the failed and skipped items again",
});

const LABELLING_ACME = defineTool({
  ...ACME_TOOL_DECLARATION,
  commands: [...ACME_TOOL_DECLARATION.commands, memberLabel],
  errors: [...ACME_TOOL_DECLARATION.errors, BatchIncomplete],
});

/** acme's failure as its envelope prints it. */
interface Failure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly field?: string;
  readonly reason?: string;
}

const failureOf = (parts: {
  readonly code: string;
  readonly message: string;
  readonly field?: string | undefined;
  readonly reason?: string | undefined;
}): Failure => ({
  code: parts.code,
  message: parts.message,
  retryable: false,
  ...(parts.field === undefined ? {} : { field: parts.field }),
  ...(parts.reason === undefined ? {} : { reason: parts.reason }),
});

/** What acme printed: its envelope and exit. */
interface Printed {
  readonly envelope: unknown;
  readonly exit: number;
}

const MEMBERS: ReadonlyArray<Member> = [
  { number: 7, name: "Ada", tags: ["lead"] },
  { number: 8, name: "Grace", tags: [] },
];

const meta = (invocation: { readonly command: { readonly path: ReadonlyArray<string> } }) => ({
  schemaVersion: "1.0",
  tool: "acme",
  toolVersion: "0.1.0",
  command: invocation.command.path.join(" "),
  contract: "atip/1",
  contractVersion: "1.6",
});

/** acme's hooks: `--input` is inline JSON; a refusal and a batch are printed as acme's envelopes. */
const hooks = (
  printed: Array<Printed>,
  executed: Array<number>,
): RunnerHooks<Failure, string, unknown, never> => ({
  refusal: failureOf,
  readInput: (value) => Effect.sync(() => JSON.parse(value)),
  invalid: (failure, invocation) => {
    const parts =
      failure instanceof ArgumentsError
        ? { code: "USAGE", message: "arguments refused" }
        : failure instanceof CommandFailure
          ? failureOf(failure)
          : { code: "USAGE", message: failure.message, field: "--fields" };
    // an item's own refusal names its field under the item's index
    return invocation.item === undefined
      ? failureOf(parts)
      : failureOf({ ...parts, field: batchField(invocation.item, parts.field) });
  },
  preconditions: () => Effect.succeed("session"),
  execute: (invocation: ToolInvocation) =>
    decodeArguments(memberLabel, argumentRecord(memberLabel, invocation)).pipe(
      Effect.tap((args) => Effect.sync(() => executed.push(args.operands[0]))),
      Effect.flatMap(memberLabel.handler),
      Effect.provide(rosterOf(MEMBERS)),
      Effect.mapError((failure) =>
        failure instanceof CommandFailure
          ? failureOf(failure)
          : failureOf({ code: "USAGE", message: "arguments refused" }),
      ),
    ),
  emit: {
    version: Effect.succeed(0),
    help: () => Effect.succeed(0),
    failure: (failure, site) =>
      Effect.sync(() => {
        const command = site.stage === "refused" ? site.command : site.invocation.command;
        printed.push({
          envelope: {
            ok: false,
            error: failure,
            meta: command === undefined ? meta({ command: { path: [] } }) : meta({ command }),
          },
          exit: 2,
        });
        return 2;
      }),
    outcome: () => Effect.succeed(0),
    defect: () => Effect.succeed(1),
    batch: (outcome: BatchOutcome<Failure, string, unknown>) =>
      Effect.sync(() => {
        const built = batchReport(outcome, {
          item: (data) => ({
            status: Schema.is(MemberLabelled)(data) && data.unchanged ? "unchanged" : "written",
            data,
          }),
          error: (failure) => failure,
        });
        const exit = built.incomplete === undefined ? 0 : 1;
        printed.push({
          envelope: {
            ok: exit === 0,
            ...(built.incomplete === undefined ? {} : { error: built.incomplete }),
            data: built.data,
            meta: { ...meta(outcome), ...(built.output === undefined ? {} : { output: built.output }) },
          },
          exit,
        });
        return exit;
      }),
  },
});

/** `acme member label --input <BATCH> --json`: what it printed and which members it labelled, in order. */
const label = async (items: unknown, tool: Tool = LABELLING_ACME, path = ["member", "label"]) => {
  const printed: Array<Printed> = [];
  const executed: Array<number> = [];
  const exit = await Effect.runPromiseExit(
    runCommandLine(
      tool,
      [...path, "--input", JSON.stringify(items), "--json"],
      {},
      hooks(printed, executed),
    ),
  );
  if (!Exit.isSuccess(exit)) throw new Error("the runner did not finish");
  const [only] = printed;
  if (only === undefined || printed.length !== 1) throw new Error("acme printed no envelope");
  return { exit: exit.value, envelope: only.envelope, executed };
};

const dataOf = (envelope: unknown): unknown =>
  typeof envelope === "object" && envelope !== null && "data" in envelope
    ? envelope.data
    : undefined;

describe("batches (spec 10.11)", () => {
  test("a batch command's document declares the batch and its output; BATCH_INCOMPLETE is implied", () => {
    const document = LABELLING_ACME.document(memberLabel);
    expect(document["input"]).toMatchObject({ batch: true, maxItems: 3 });
    expect(document["outputs"]).toEqual([
      { schemaRef: "#/schemas/MemberLabelled" },
      { schemaRef: "#/schemas/BatchMemberLabelled", batch: true, when: "--input is an array or NDJSON" },
    ]);
    expect(document["errors"]).toEqual(["MEMBER_NOT_FOUND"]);
    expect(LABELLING_ACME.describe(memberLabel).errors).toContain("BATCH_INCOMPLETE");
    expect(
      schemaAnswerProblems({
        ok: true,
        data: document,
        meta: { ...meta({ command: { path: ["schema"] } }), schemaVersion: "1.6" },
      }),
    ).toEqual([]);
  });

  test("every item executed: exit 0, each item written or unchanged, in order", async () => {
    const { exit, envelope, executed } = await label([
      { operands: [7], label: "lead" },
      { operands: [8], label: "core" },
    ]);
    expect(exit).toBe(0);
    expect(executed).toEqual([7, 8]);
    expect(dataOf(envelope)).toEqual({
      items: [
        { index: 0, status: "unchanged", data: { number: 7, label: "lead", unchanged: true } },
        { index: 1, status: "written", data: { number: 8, label: "core", unchanged: false } },
      ],
    });
    expect(envelope).toMatchObject({ ok: true, meta: { output: "BatchMemberLabelled" } });
    expect(envelopeProblems(envelope)).toEqual([]);
    expect(batchReportProblems(dataOf(envelope))).toEqual([]);
  });

  test("an item that fails during execution stops the batch: BATCH_INCOMPLETE, exit 1, the rest skipped", async () => {
    const { exit, envelope, executed } = await label([
      { operands: [8], label: "core" },
      { operands: [9], label: "core" },
      { operands: [7], label: "core" },
    ]);
    expect(exit).toBe(1);
    expect(executed).toEqual([8, 9]);
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: "BATCH_INCOMPLETE",
        message: "item 1 of 3 failed (MEMBER_NOT_FOUND): 1 written, 1 skipped",
        field: "/1",
        retryable: false,
      },
    });
    expect(dataOf(envelope)).toEqual({
      items: [
        { index: 0, status: "written", data: { number: 8, label: "core", unchanged: false } },
        {
          index: 1,
          status: "failed",
          error: { code: "MEMBER_NOT_FOUND", message: "no member has number 9", retryable: false },
        },
        { index: 2, status: "skipped" },
      ],
    });
    expect(envelopeProblems(envelope)).toEqual([]);
    expect(batchReportProblems(dataOf(envelope))).toEqual([]);
  });

  test("the first item failing leaves nothing written", async () => {
    const { envelope } = await label([
      { operands: [9], label: "core" },
      { operands: [7], label: "core" },
    ]);
    expect(envelope).toMatchObject({
      error: { message: "item 0 of 2 failed (MEMBER_NOT_FOUND): nothing written, 1 skipped" },
    });
  });

  test("a preflight refusal of any item answers for the batch with its own code and pointer: nothing runs", async () => {
    // item 2 breaks the label's domain; items 0 and 1 are valid and would run, but none does
    const invalid = await label([
      { operands: [7], label: "lead" },
      { operands: [8], label: "core" },
      { operands: [8], label: "Core" },
    ]);
    expect(invalid.exit).toBe(2);
    expect(invalid.executed).toEqual([]);
    expect(invalid.envelope).toMatchObject({
      ok: false,
      error: { code: "OPTION_VALUE_INVALID", field: "/2/label" },
    });
    expect(dataOf(invalid.envelope)).toBeUndefined();
    // an unknown key of item 1, and an item that is no object
    expect(
      (await label([{ operands: [7], label: "lead" }, { labels: "x" }])).envelope,
    ).toMatchObject({ error: { code: "INPUT_INVALID", reason: "UNKNOWN_KEY", field: "/1/labels" } });
    expect((await label([{ operands: [7], label: "lead" }, ["x"]])).envelope).toMatchObject({
      error: { code: "INPUT_INVALID", field: "/1" },
    });
    // a required argument missing from an item is named by its pointer
    expect((await label([{ operands: [7] }])).envelope).toMatchObject({
      error: { field: "/0/label" },
    });
  });

  test("an empty batch and one over maxItems are refused before any item is read", async () => {
    expect((await label([])).envelope).toMatchObject({
      error: { code: "INPUT_INVALID", reason: "EMPTY", field: "--input" },
    });
    const many = Array.from({ length: 4 }, () => ({ operands: [7], label: "lead" }));
    const over = await label(many);
    expect(over.exit).toBe(2);
    expect(over.executed).toEqual([]);
    expect(over.envelope).toMatchObject({
      error: { code: "INPUT_TOO_LARGE", reason: "TOO_MANY_ITEMS", field: "--input" },
    });
  });

  test("a command without batch, and a destructive command, take no batch", async () => {
    expect(
      (await label([{ number: 7 }], LABELLING_ACME, ["member", "purge", "7"])).envelope,
    ).toMatchObject({ error: { code: "INPUT_INVALID", reason: "BATCH_UNSUPPORTED", field: "--input" } });
    expect(memberPurge.description.input.batch).toBeUndefined();
    expect(() =>
      defineCommand(
        {
          path: ["member", "drop"],
          summary: "Drop members",
          effect: { kind: "destructive", idempotency: "once" },
          input: Schema.Struct({}),
          outputs: [report("Dropped", "1.0", Schema.Struct({ dropped: Schema.Boolean }))],
          errors: [],
          batch: { maxItems: 10, report: "1.0" },
          examples: ["acme member drop --json"],
        },
        {
          plan: () => Effect.succeed({ effects: [] }),
          commit: () => Effect.succeed({ dropped: true }),
        },
      ),
    ).toThrow(/a destructive command takes no batch/);
  });

  test("a batch command needs BATCH_INCOMPLETE registered, and a runner without emit.batch is a defect", async () => {
    expect(() =>
      defineTool({
        ...ACME_TOOL_DECLARATION,
        commands: [...ACME_TOOL_DECLARATION.commands, memberLabel],
      }),
    ).toThrow(/BATCH_INCOMPLETE is listed by member label but not registered/);
    const { batch: _, ...emit } = hooks([], []).emit;
    const exit = await Effect.runPromiseExit(
      runCommandLine(
        LABELLING_ACME,
        ["member", "label", "--input", '[{"operands":[7],"label":"lead"}]'],
        {},
        { ...hooks([], []), emit },
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
