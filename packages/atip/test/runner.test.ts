/**
 * The runner (`runCommandLine`) on the example tool `acme`, end to end with
 * fake hooks: parse, help and version, `--input` read through the hook and merged, the tool's own values, the
 * validators before any precondition, the preconditions, the handler and its outcome, a failure at its stage, a defect
 * as the tool's bug and an interruption kept. The hooks record each call, so the order of the steps is what is tested.
 */
import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import {
  type ArgvRefusal,
  argumentRecord,
  checkSelection,
  ArgumentsError,
  CommandFailure,
  decodeArguments,
  defineCommand,
  defineTool,
  report,
  type RunnerHooks,
  runCommandLine,
  defaulted,
  defineError,
  pagingOf,
  type Paging,
  bindCursor,
  unbindCursor,
  SelectionError,
  type Tool,
  type ToolInvocation,
} from "../src/index.ts";
import {
  ACME_TOOL,
  ACME_TOOL_DECLARATION,
  memberShow,
  memberTag,
  type Member,
  rosterOf,
  RosterUnavailable,
  schemaBuiltin,
} from "./acme.ts";

/** acme's failure as its envelope would print it. */
interface Failure {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

const failureOf = (parts: {
  readonly code: string;
  readonly message: string;
  readonly field?: string | undefined;
}): Failure => ({
  code: parts.code,
  message: parts.message,
  ...(parts.field === undefined ? {} : { field: parts.field }),
});

/** What a fake acme saw and printed, in order. */
type Step =
  | { readonly step: "readInput"; readonly value: string }
  | { readonly step: "values" }
  | { readonly step: "preconditions"; readonly command: string }
  | {
      readonly step: "execute";
      readonly command: string;
      readonly context: string;
      readonly note?: string;
    }
  | { readonly step: "outcome"; readonly data: unknown }
  | {
      readonly step: "failure";
      readonly stage: string;
      readonly code: string;
      readonly field?: string;
    }
  | { readonly step: "defect" }
  | { readonly step: "help"; readonly about: string }
  | { readonly step: "version" };

/** The world a fake acme runs in: files `--input` may name, stdin, whether the roster answers, a handler's trouble. */
interface World {
  readonly files?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly rosterDown?: boolean;
  readonly members?: ReadonlyArray<Member>;
  readonly trouble?: "defect" | "interrupt";
}

const MEMBERS: ReadonlyArray<Member> = [{ number: 7, name: "Ada", tags: ["core"] }];

const id = (invocation: ToolInvocation) => invocation.command.path.join(" ");

/** acme's hooks over `world`, recording every call into `steps`. */
const hooks = (world: World, steps: Array<Step>): RunnerHooks<Failure, string, unknown, never> => {
  const roster = rosterOf(world.members ?? MEMBERS);
  return {
    refusal: failureOf,
    readInput: (value) =>
      Effect.suspend(() => {
        steps.push({ step: "readInput", value });
        if (value.startsWith("{")) return Effect.succeed(JSON.parse(value));
        const text = world.files?.[value];
        return text === undefined
          ? Effect.fail({ code: "INPUT_INVALID", message: `no file ${value}`, field: "--input" })
          : Effect.succeed(JSON.parse(text));
      }),
    values: (invocation) =>
      Effect.sync(() => {
        steps.push({ step: "values" });
        return invocation.options["note"] === "-"
          ? { ...invocation, options: { ...invocation.options, note: world.stdin ?? "" } }
          : invocation;
      }),
    invalid: (failure) =>
      failure instanceof ArgumentsError
        ? { code: "USAGE", message: failure.issues.map((issue) => issue.message).join("; ") }
        : failure instanceof SelectionError
          ? { code: "USAGE", message: failure.message, field: "--fields" }
          : failureOf(failure),
    preconditions: (invocation) =>
      Effect.suspend(() => {
        steps.push({ step: "preconditions", command: id(invocation) });
        return world.rosterDown === true && id(invocation) !== "schema"
          ? Effect.fail({ code: "ROSTER_UNAVAILABLE", message: "the roster does not answer" })
          : Effect.succeed("session-1");
      }),
    execute: (invocation, context) =>
      Effect.suspend((): Effect.Effect<unknown, Failure> => {
        const note = invocation.options["note"];
        steps.push({
          step: "execute",
          command: id(invocation),
          context,
          ...(typeof note === "string" ? { note } : {}),
        });
        if (world.trouble === "defect") return Effect.die("a bug in the handler");
        if (world.trouble === "interrupt") return Effect.interrupt;
        const failed = (failure: CommandFailure | ArgumentsError) =>
          failure instanceof CommandFailure
            ? failureOf(failure)
            : { code: "USAGE", message: "arguments refused" };
        switch (id(invocation)) {
          case "member show":
            return decodeArguments(memberShow, argumentRecord(memberShow, invocation)).pipe(
              Effect.flatMap(memberShow.handler),
              Effect.provide(roster),
              Effect.mapError(failed),
            );
          case "member tag":
            return decodeArguments(memberTag, argumentRecord(memberTag, invocation)).pipe(
              Effect.flatMap(memberTag.handler),
              Effect.provide(roster),
              Effect.mapError(failed),
            );
          case "schema": {
            const bound = ACME_TOOL.bind(schemaBuiltin);
            return decodeArguments(bound, argumentRecord(bound, invocation)).pipe(
              Effect.flatMap(bound.handler),
              Effect.mapError(failed),
            );
          }
          case "member list":
            return Effect.succeed({ members: [{ number: 7, labels: { region: "eu" } }] });
          default:
            return Effect.die(`acme's fake runs no ${id(invocation)}`);
        }
      }),
    emit: {
      version: Effect.sync(() => {
        steps.push({ step: "version" });
        return 0;
      }),
      help: (request) =>
        Effect.sync(() => {
          steps.push({
            step: "help",
            about: request.command?.path.join(" ") ?? request.group ?? "acme",
          });
          return 0;
        }),
      failure: (failure, site) =>
        Effect.sync(() => {
          steps.push({
            step: "failure",
            stage: site.stage,
            code: failure.code,
            ...(failure.field === undefined ? {} : { field: failure.field }),
          });
          return 2;
        }),
      outcome: (data) =>
        Effect.sync(() => {
          steps.push({ step: "outcome", data });
          return 0;
        }),
      defect: () =>
        Effect.sync(() => {
          steps.push({ step: "defect" });
          return 1;
        }),
    },
  };
};

/** `acme ARGV` in `world`: its exit and every step, in order. */
const acme = async (
  argv: ReadonlyArray<string>,
  world: World = {},
  env = {},
  tool: Tool = ACME_TOOL,
) => {
  const steps: Array<Step> = [];
  const exit = await Effect.runPromiseExit(runCommandLine(tool, argv, env, hooks(world, steps)));
  return { exit, steps };
};

/** A member list whose report declares `fields` (spec 6.10): records under `/members`, `labels` a map. */
const memberList = defineCommand(
  {
    path: ["member", "list"],
    summary: "List the members",
    effect: { kind: "read" },
    input: Schema.Struct({}),
    outputs: [
      report(
        "Roster",
        "1.0",
        Schema.Struct({
          members: Schema.Array(
            Schema.Struct({
              number: Schema.Int,
              name: Schema.optionalKey(Schema.String),
              labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
            }),
          ),
        }),
        { fields: { records: "/members", keep: ["number"] } },
      ),
    ],
    errors: [RosterUnavailable],
    examples: ["acme member list --json"],
  },
  () => Effect.succeed({ members: [] }),
);

/** acme with `member list`: the package adds `--fields` to it, since its output declares `fields` (spec 6.10). */
const SELECTING_ACME = defineTool({
  ...ACME_TOOL_DECLARATION,
  commands: [...ACME_TOOL_DECLARATION.commands, memberList],
});

const exitCode = (exit: Exit.Exit<number>) => (Exit.isSuccess(exit) ? exit.value : undefined);

describe("runCommandLine: acme end to end with fake hooks", () => {
  test("an invocation runs parse, its own values, the validators, the preconditions, the handler, then its outcome is emitted", async () => {
    const { exit, steps } = await acme(["member", "show", "7", "--with-tags", "--json"]);
    expect(exitCode(exit)).toBe(0);
    expect(steps).toEqual([
      { step: "values" },
      { step: "preconditions", command: "member show" },
      { step: "execute", command: "member show", context: "session-1" },
      { step: "outcome", data: { number: 7, name: "Ada", tags: ["core"] } },
    ]);
  });

  test("a validator's refusal comes before any precondition: refused with its code, nothing read or run", async () => {
    const { exit, steps } = await acme(
      ["member", "tag", "7", "--tag", "core", "--expires", "2026-02-30", "--note", "trial"],
      { rosterDown: true },
    );
    expect(exitCode(exit)).toBe(2);
    expect(steps).toEqual([
      { step: "values" },
      { step: "failure", stage: "refused", code: "DATE_INVALID", field: "--expires" },
    ]);
  });

  test("a valid invocation meets the preconditions next: their failure is refused before the handler runs", async () => {
    const { exit, steps } = await acme(["member", "tag", "7", "--tag", "lead"], {
      rosterDown: true,
    });
    expect(exitCode(exit)).toBe(2);
    expect(steps).toEqual([
      { step: "values" },
      { step: "preconditions", command: "member tag" },
      { step: "failure", stage: "refused", code: "ROSTER_UNAVAILABLE" },
    ]);
  });

  test("a parser refusal is the tool's failure before anything else; a constraint is refused by the parser", async () => {
    const unknown = await acme(["member", "shw", "7"]);
    expect(unknown.steps).toEqual([
      { step: "failure", stage: "refused", code: "UNKNOWN_COMMAND", field: "command" },
    ]);
    const constraint = await acme([
      "member",
      "tag",
      "7",
      "--tag",
      "core",
      "--expires",
      "2026-03-01",
    ]);
    expect(constraint.steps).toEqual([
      { step: "failure", stage: "refused", code: "NOTE_REQUIRED", field: "--note" },
    ]);
  });

  test("--input is read through the hook and merged (spec 10.7 steps 1-5); a document's refusal names its key", async () => {
    const merged = await acme(["member", "tag", "7", "--input", "tag.json"], {
      files: { "tag.json": JSON.stringify({ tag: "lead", by: "grace" }) },
    });
    expect(exitCode(merged.exit)).toBe(0);
    expect(merged.steps).toEqual([
      { step: "readInput", value: "tag.json" },
      { step: "values" },
      { step: "preconditions", command: "member tag" },
      { step: "execute", command: "member tag", context: "session-1" },
      { step: "outcome", data: { number: 7, tags: ["core", "lead"], unchanged: false } },
    ]);
    const badKey = await acme(["member", "tag", "7", "--input", '{"tagg":"lead"}']);
    expect(badKey.steps).toEqual([
      { step: "readInput", value: '{"tagg":"lead"}' },
      { step: "failure", stage: "refused", code: "INPUT_INVALID", field: "/tagg" },
    ]);
    const conflict = await acme([
      "member",
      "tag",
      "7",
      "--tag",
      "core",
      "--input",
      '{"tag":"lead"}',
    ]);
    expect(conflict.steps.at(-1)).toEqual({
      step: "failure",
      stage: "refused",
      code: "INPUT_CONFLICT",
      field: "/tag",
    });
    const unread = await acme(["member", "tag", "7", "--input", "missing.json"]);
    expect(unread.steps.at(-1)).toEqual({
      step: "failure",
      stage: "refused",
      code: "INPUT_INVALID",
      field: "--input",
    });
    // a validator's refusal of a value from the document comes before the preconditions, too
    const late = await acme(
      ["member", "tag", "7", "--input", '{"tag":"core","expires":"2026-02-30","note":"trial"}'],
      { rosterDown: true },
    );
    expect(late.steps.map((step) => step.step)).toEqual(["readInput", "values", "failure"]);
  });

  test("the tool's own values are read after the merge, before the validators, and reach the handler", async () => {
    const refused = await acme(
      ["member", "tag", "7", "--tag", "core", "--expires", "2026-02-30", "--note", "-"],
      { stdin: "trial" },
    );
    expect(refused.steps).toEqual([
      { step: "values" },
      { step: "failure", stage: "refused", code: "DATE_INVALID", field: "--expires" },
    ]);
    const read = await acme(
      ["member", "tag", "7", "--tag", "lead", "--expires", "2026-03-01", "--note", "-"],
      { stdin: "trial" },
    );
    expect(read.steps.slice(0, 3)).toEqual([
      { step: "values" },
      { step: "preconditions", command: "member tag" },
      { step: "execute", command: "member tag", context: "session-1", note: "trial" },
    ]);
  });

  test("--help and --version print text; in JSON mode a 1.4 tool refuses both with USAGE once the path resolves (spec 4.4.1)", async () => {
    expect((await acme(["--version"])).steps).toEqual([{ step: "version" }]);
    expect((await acme(["member", "tag", "--help"])).steps).toEqual([
      { step: "help", about: "member tag" },
    ]);
    expect((await acme(["member", "--help"])).steps).toEqual([{ step: "help", about: "member" }]);
    const refused = async (argv: ReadonlyArray<string>) => {
      const refusals: Array<ArgvRefusal> = [];
      const steps: Array<Step> = [];
      const recording = hooks({}, steps);
      await Effect.runPromise(
        runCommandLine(
          ACME_TOOL,
          argv,
          {},
          {
            ...recording,
            refusal: (refusal) => {
              refusals.push(refusal);
              return recording.refusal(refusal);
            },
          },
        ),
      );
      const [refusal] = refusals;
      return { code: refusal?.code, field: refusal?.field, hint: refusal?.hint, steps };
    };
    expect(await refused(["member", "tag", "--help", "--json"])).toEqual({
      code: "USAGE",
      field: "--help",
      hint: "acme schema member tag --json",
      steps: [{ step: "failure", stage: "refused", code: "USAGE", field: "--help" }],
    });
    expect(await refused(["--help", "--json"])).toMatchObject({
      code: "USAGE",
      field: "--help",
      hint: "acme schema --json",
    });
    expect(await refused(["member", "--help", "--json"])).toMatchObject({
      hint: "acme schema member --json",
    });
    expect(await refused(["--help", "member", "tag", "--json"])).toMatchObject({
      field: "--help",
      hint: "acme schema member tag --json",
    });
    expect(await refused(["nosuch", "--help", "--json"])).toMatchObject({
      code: "UNKNOWN_COMMAND",
    });
    expect(await refused(["--help", "nosuch", "--json"])).toMatchObject({
      code: "UNKNOWN_COMMAND",
    });
    for (const argv of [
      ["--version", "--json"],
      ["member", "tag", "--version", "--json"],
    ])
      expect(await refused(argv), argv.join(" ")).toMatchObject({
        code: "USAGE",
        field: "--version",
        hint: "acme --version",
      });
  });

  test("a tool that declares 1.3 answers --help --json with the schema document of the same path", async () => {
    const acme13 = defineTool({
      ...ACME_TOOL_DECLARATION,
      profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion: "1.3" },
    });
    const json = await acme(["member", "tag", "--help", "--json"], {}, {}, acme13);
    expect(json.steps.slice(0, 3)).toEqual([
      { step: "values" },
      { step: "preconditions", command: "schema" },
      { step: "execute", command: "schema", context: "session-1" },
    ]);
    expect(json.steps.at(-1)).toMatchObject({
      step: "outcome",
      data: { kind: "command", command: "member tag" },
    });
  });

  test("a handler's failure is emitted while working with its context; a defect is the tool's bug; an interruption stays one", async () => {
    const missing = await acme(["member", "show", "9"]);
    expect(missing.steps.at(-1)).toEqual({
      step: "failure",
      stage: "working",
      code: "MEMBER_NOT_FOUND",
      field: "<number>",
    });
    const bug = await acme(["member", "show", "7"], { trouble: "defect" });
    expect([exitCode(bug.exit), bug.steps.at(-1)]).toEqual([1, { step: "defect" }]);
    const stopped = await acme(["member", "show", "7"], { trouble: "interrupt" });
    expect(Exit.isFailure(stopped.exit) && Cause.hasInterruptsOnly(stopped.exit.cause)).toBe(true);
    expect(stopped.steps.map((step) => step.step)).toEqual(["values", "preconditions", "execute"]);
  });
});

describe("runCommandLine: the read selection at step 6 (spec 6.10, 10.7)", () => {
  const list = (fields: string, world: World = {}) =>
    acme(["member", "list", "--fields", fields, "--json"], world, {}, SELECTING_ACME);

  test("an unknown --fields path is USAGE on --fields before a failing precondition: nothing read or run", async () => {
    const { exit, steps } = await list("nosuch", { rosterDown: true });
    expect(exitCode(exit)).toBe(2);
    expect(steps).toEqual([
      { step: "values" },
      { step: "failure", stage: "refused", code: "USAGE", field: "--fields" },
    ]);
  });

  test("an unknown --fields path is the same USAGE on --fields with or without --json", async () => {
    for (const argv of [
      ["member", "list", "--fields", "nosuch", "--json"],
      ["member", "list", "--fields", "nosuch"],
    ]) {
      const { exit, steps } = await acme(argv, {}, {}, SELECTING_ACME);
      expect(exitCode(exit)).toBe(2);
      expect(steps).toEqual([
        { step: "values" },
        { step: "failure", stage: "refused", code: "USAGE", field: "--fields" },
      ]);
    }
  });

  test("the refusal names the unknown paths and every selectable one; a value that is no field list is refused too", () => {
    const command = SELECTING_ACME.describe(memberList);
    const refusal = (fields: string) =>
      Effect.runSync(Effect.flip(Effect.fromResult(checkSelection(command, { fields }))));
    expect(refusal("name,nosuch,labels.region.deeper")).toMatchObject({
      _tag: "SelectionError",
      received: "name,nosuch,labels.region.deeper",
      unknown: ["nosuch", "labels.region.deeper"],
      expected: ["name", "labels"],
    });
    expect(refusal('labels["region')).toMatchObject({ unknown: [], expected: ["name", "labels"] });
    // a map's key is selectable only through the map's own path, and never with []
    expect(refusal("name[]").unknown).toEqual(["name[]"]);
  });

  test("declared paths, kept paths and a map's keys pass to the preconditions; without --fields nothing is checked", async () => {
    for (const fields of [
      "name",
      "number",
      "labels",
      "labels.region",
      'labels["http.code"]',
      "name,labels",
    ]) {
      const { steps } = await list(fields, { rosterDown: true });
      expect(steps).toEqual([
        { step: "values" },
        { step: "preconditions", command: "member list" },
        { step: "failure", stage: "refused", code: "ROSTER_UNAVAILABLE" },
      ]);
    }
    const plain = await acme(["member", "list", "--json"], {}, {}, SELECTING_ACME);
    expect(exitCode(plain.exit)).toBe(0);
  });
});

describe("runCommandLine: a validator sees the invocation's paging (spec 6.9, 10.7 step 6)", () => {
  const CursorInvalid = defineError({
    code: "CURSOR_INVALID",
    exit: 2,
    retryable: false,
    meaning: "The cursor was not printed for these arguments",
    fix: "Page on with meta.next of the previous page",
  });
  const seen: Array<Paging | undefined> = [];
  const page = defineCommand(
    {
      path: ["member", "page"],
      summary: "Page the members",
      effect: { kind: "read" },
      input: Schema.Struct({
        sort: defaulted(Schema.Literals(["name", "-name"]), "name").annotate({
          valueName: "KEY",
          description: "Order",
        }),
        cursor: Schema.optionalKey(
          Schema.String.annotate({ valueName: "CURSOR", description: "Continue" }),
        ),
        site: Schema.optionalKey(
          Schema.String.annotate({ valueName: "SITE", description: "The site", env: "ACME_SITE" }),
        ),
      }),
      validators: [
        {
          arguments: ["cursor"],
          error: CursorInvalid,
          description: "--cursor is one acme printed for the same arguments.",
          rejects: ["acme member page --cursor nope --json"],
          check: (args, given) => {
            seen.push(given.paging);
            return args.cursor === undefined || given.paging === undefined
              ? true
              : Result.isSuccess(unbindCursor(args.cursor, given.paging.binding));
          },
        },
      ],
      outputs: [report("Paged", "1.0", Schema.Struct({ numbers: Schema.Array(Schema.Int) }))],
      errors: [CursorInvalid],
      examples: ["acme member page --json"],
    },
    () => Effect.succeed({ numbers: [] }),
  );
  const PAGING_ACME = defineTool({
    ...ACME_TOOL_DECLARATION,
    commands: [...ACME_TOOL_DECLARATION.commands, page],
  });

  test("the binding is the declared minor's over the arguments with their sources; a cursor for others is refused at step 6", async () => {
    const env = { ACME_SITE: "tokyo" };
    const argv = ["member", "page", "--sort", "name", "--json"];
    const parsed = PAGING_ACME.parse(argv, env);
    if (Result.isFailure(parsed) || parsed.success.kind !== "invoke") throw new Error("not parsed");
    const paging = pagingOf(PAGING_ACME.profile.contractVersion, parsed.success.parsed);
    const cursor = bindCursor("server-1", paging.binding);
    seen.length = 0;
    // the validator accepts its own cursor: the invocation reaches the preconditions
    const { steps } = await acme([...argv, "--cursor", cursor], {}, env, PAGING_ACME);
    expect(steps).toContainEqual({ step: "preconditions", command: "member page" });
    expect(seen[0]?.binding).toBe(paging.binding);
    expect(seen[0]?.next("c")).toEqual([
      "member",
      "page",
      "--sort",
      "name",
      "--cursor",
      "c",
      "--json",
    ]);
    // without the explicit default, or in another environment, the same cursor is refused before any precondition
    for (const [words, world] of [
      [["member", "page", "--json"], env],
      [argv, { ACME_SITE: "osaka" }],
    ] as const) {
      const { exit, steps } = await acme([...words, "--cursor", cursor], {}, world, PAGING_ACME);
      expect(exitCode(exit)).toBe(2);
      expect(steps).toEqual([
        { step: "values" },
        { step: "failure", stage: "refused", code: "CURSOR_INVALID", field: "--cursor" },
      ]);
    }
  });
});
