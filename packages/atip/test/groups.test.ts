/**
 * What the command library gained so a tool can port every command onto it:
 * a report declares its field selection (spec 6.10) and the library derives its selectable paths; a validator's
 * refusal says why with the parts of an error (spec 7.1); a destructive plan may carry the digest of the system that
 * makes its effects (spec 11.6); and a tool keeping records of its own describes a shared option from its field.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import {
  commandDocument,
  CONTRACT_VERSION,
  decodeArguments,
  defineCommand,
  defineError,
  describeOperands,
  describeOptions,
  operand,
  report,
  runDestructive,
  validateArguments,
} from "../src/index.ts";
import { schemaAnswerProblems } from "../src/validate.ts";
import { ACME } from "./acme.ts";

const Member = Schema.Struct({
  number: Schema.Int,
  name: Schema.String,
  profile: Schema.Struct({ email: Schema.String, team: Schema.optionalKey(Schema.String) }),
  tags: Schema.Array(Schema.String),
  owners: Schema.Array(Schema.Struct({ name: Schema.String, since: Schema.String })),
  attributes: Schema.Record(Schema.String, Schema.String),
  "http.status": Schema.optionalKey(Schema.Int),
  url: Schema.String,
});

const Roster = Schema.Struct({
  members: Schema.Array(Member),
  total: Schema.Int,
  nextCursor: Schema.optionalKey(Schema.String),
});

const listing = (fields: Parameters<typeof report>[3]) =>
  defineCommand(
    {
      path: ["member", "list"],
      summary: "List the members",
      effect: { kind: "read" },
      input: Schema.Struct({}),
      outputs: [report("Roster", "1.0", Roster, fields)],
      errors: [],
      examples: ["acme member list --json"],
    },
    () => Effect.succeed({ members: [], total: 0 }),
  );

const answer = (data: unknown) => ({
  ok: true,
  data,
  meta: {
    schemaVersion: CONTRACT_VERSION,
    tool: "acme",
    toolVersion: "0.1.0",
    command: "schema",
    contract: "atip/1",
    contractVersion: CONTRACT_VERSION,
    output: "SchemaView",
  },
});

describe("a report's field selection (spec 6.10, 9.9.1)", () => {
  test("the selectable paths come from the report schema: members, [] into records, a map whole, bracketed names", () => {
    const command = listing({
      fields: {
        records: "/members",
        keep: ["number", "url"],
        default: ["number", "name", "profile.email"],
      },
    });
    const paths = [
      "name",
      "profile",
      "profile.email",
      "profile.team",
      "tags",
      "owners",
      "owners[].name",
      "owners[].since",
      "attributes",
      '["http.status"]',
    ];
    const [output] = command.description.outputs;
    expect(output?.fields).toEqual({
      records: "/members",
      paths,
      keep: ["number", "url"],
      // a kept path is selected anyway: the document's default lists the selectable ones
      default: ["name", "profile.email"],
    });
    const document = commandDocument(command.description, ACME);
    // a 1.4 document leaves out kind report and schemaVersion 1.0 (spec 9.5)
    expect(document["outputs"]).toEqual([
      {
        schemaRef: "#/schemas/Roster",
        fields: {
          records: "/members",
          paths,
          keep: ["number", "url"],
          default: ["name", "profile.email"],
        },
      },
    ]);
    expect(schemaAnswerProblems(answer(document))).toEqual([]);
  });

  test("the report itself is the record without records; no keep, no default: neither is written", () => {
    const [output] = listing({ fields: {} }).description.outputs;
    expect(output?.fields).toEqual({
      records: "",
      paths: [
        "members",
        "members[].number",
        "members[].name",
        "members[].profile",
        "members[].profile.email",
        "members[].profile.team",
        "members[].tags",
        "members[].owners",
        "members[].owners[].name",
        "members[].owners[].since",
        "members[].attributes",
        'members[]["http.status"]',
        "members[].url",
        "total",
        "nextCursor",
      ],
    });
  });

  test("a selection naming what the report does not have is refused when defined", () => {
    expect(() => listing({ fields: { records: "/people" } })).toThrow(
      /the output Roster's fields: records \/people: the report has no member people there/,
    );
    expect(() => listing({ fields: { records: "members" } })).toThrow(
      /records members is not an RFC 6901 pointer/,
    );
    expect(() =>
      listing({ fields: { records: "/members", keep: ["id"], default: ["nick"] } }),
    ).toThrow(/keep names id, which is no path[\s\S]*default names nick, which is no path/);
  });
});

const Reasoned = defineError({
  code: "WINDOW_INVALID",
  exit: 2,
  retryable: false,
  meaning: "The window is not a duration",
  fix: "Give 6h, 90m or 2d",
  reasons: { TOO_SHORT: { meaning: "Under an hour", fix: "Give at least 1h" } },
});

const sweep = defineCommand(
  {
    path: ["member", "sweep"],
    summary: "Sweep idle members",
    effect: { kind: "read" },
    operands: [
      operand("team", Schema.String, { valueName: "TEAM", help: "The team", required: false }),
    ],
    input: Schema.Struct({
      window: Schema.String.annotate({ valueName: "DURATION", description: "Idle for this long" }),
    }),
    validators: [
      {
        arguments: ["window"],
        error: Reasoned,
        description: "--window is a duration of at least 1h (6h, 90m, 2d).",
        rejects: ["acme member sweep --window 30m --json"],
        check: (args) =>
          args.window === "30m"
            ? {
                message: `--window ${args.window}: under an hour`,
                received: args.window,
                reason: "TOO_SHORT",
              }
            : args.window !== "soon",
      },
    ],
    outputs: [report("Swept", "1.0", Schema.Struct({ swept: Schema.Int }))],
    errors: [Reasoned],
    examples: ["acme member sweep --window 6h --json"],
  },
  () => Effect.succeed({ swept: 0 }),
);

describe("a validator's refusal (spec 9.8.2, 7.1)", () => {
  const refusal = (window: string) =>
    Effect.runPromise(
      Effect.flip(
        Effect.flatMap(Effect.orDie(decodeArguments(sweep, { window })), (args) =>
          validateArguments(sweep, args),
        ),
      ),
    );

  test("a refusal's parts say why: message, value and reason; its field defaults to the first argument", async () => {
    const failure = await refusal("30m");
    expect([
      failure.code,
      failure.message,
      failure.field,
      failure.received,
      failure.reason,
    ]).toEqual(["WINDOW_INVALID", "--window 30m: under an hour", "--window", "30m", "TOO_SHORT"]);
  });

  test("false refuses with the validator's description; true passes", async () => {
    const failure = await refusal("soon");
    expect([failure.code, failure.message, failure.field]).toEqual([
      "WINDOW_INVALID",
      "--window is a duration of at least 1h (6h, 90m, 2d).",
      "--window",
    ]);
    const passed = await Effect.runPromiseExit(
      Effect.flatMap(decodeArguments(sweep, { window: "6h" }), (args) =>
        validateArguments(sweep, args),
      ),
    );
    expect(passed).toEqual(Exit.void);
  });
});

describe("a plan whose digest a remote computed (spec 11.6)", () => {
  const committed: Array<string | undefined> = [];
  const remote = {
    plan: () =>
      Effect.succeed({
        effects: [{ action: "call", target: "POST /v1/members/8/purge" }],
        digest: `sha256:${"a".repeat(64)}`,
      }),
    commit: (_: unknown, plan: { readonly digest?: string }) =>
      Effect.sync(() => {
        committed.push(plan.digest);
        return { purged: true };
      }),
  };
  const request = {
    command: "member purge",
    arguments: { operands: [8] },
    previewArgv: ["member", "purge", "8", "--json"],
  };

  test("the preview carries the remote's digest and leads with its commit line", async () => {
    const preview = await Effect.runPromise(runDestructive(remote, {}, request));
    expect(preview).toEqual({
      committed: false,
      plan: await Effect.runPromise(remote.plan()),
      planDigest: `sha256:${"a".repeat(64)}`,
      commitArgv: [
        "member",
        "purge",
        "8",
        "--json",
        "--commit",
        "--plan-digest",
        `sha256:${"a".repeat(64)}`,
      ],
    });
  });

  test("the commit passes the given digest through to the remote, which judges it; no local PLAN_STALE", async () => {
    const other = `sha256:${"b".repeat(64)}`;
    const done = await Effect.runPromise(
      runDestructive(remote, {}, { ...request, commitDigest: other }),
    );
    expect(done).toEqual({ committed: true, planDigest: other, report: { purged: true } });
    expect(committed).toEqual([other]);
  });
});

describe("a shared option declared once as a field", () => {
  test("describeOptions describes a Struct's fields as describe does, and refuses what it would", () => {
    expect(
      describeOptions(
        Schema.Struct({
          reason: Schema.optionalKey(
            Schema.String.annotate({ valueName: "TEXT", description: "Why" }),
          ),
        }),
      ),
    ).toEqual([
      {
        name: "reason",
        valueName: "TEXT",
        valueType: "string",
        required: false,
        repeatable: false,
        default: null,
        flagOnly: false,
        help: "Why",
      },
    ]);
    expect(() =>
      describeOptions(Schema.Struct({ reason: Schema.String.annotate({ valueName: "TEXT" }) })),
    ).toThrow(/--reason: no help/);
    expect(() =>
      describeOptions(
        Schema.Struct({
          reasonId: Schema.String.annotate({ valueName: "ID", description: "Which reason" }),
        }),
      ),
    ).toThrow(/--reason-id ends in -id/);
  });
});

describe("the operands of a tool's own records", () => {
  test("describeOperands describes operands as describe does, and refuses what it would", () => {
    const operands = [
      operand("team", Schema.String, { valueName: "TEAM", help: "The team" }),
      operand("member", Schema.String, {
        valueName: "MEMBER",
        help: "Members to sweep",
        required: false,
        variadic: true,
      }),
    ];
    const described = describeOperands(operands);
    expect(described.map((entry) => [entry.name, entry.required, entry.variadic])).toEqual([
      ["team", true, false],
      ["member", false, true],
    ]);
    expect(described).toEqual(
      defineCommand(
        {
          path: ["member", "assign"],
          summary: "Assign members",
          effect: { kind: "read" },
          operands,
          input: Schema.Struct({}),
          outputs: [report("Assigned", "1.0", Schema.Struct({ assigned: Schema.Int }))],
          errors: [],
          examples: ["acme member assign core ana --json"],
        },
        () => Effect.succeed({ assigned: 0 }),
      ).description.operands,
    );
    expect(() =>
      describeOperands([operand("Team", Schema.String, { valueName: "TEAM", help: "The team" })]),
    ).toThrow(/<Team> is not a lower kebab-case name/);
    expect(() =>
      describeOperands([operand("flag", Schema.Boolean, { valueName: "FLAG", help: "A flag" })]),
    ).toThrow(/<flag>: an operand is never a switch/);
  });
});

describe("how a validator's arguments were given (spec 10.7 step 5)", () => {
  const Misplaced = defineError({
    code: "RUN_MISPLACED",
    exit: 2,
    retryable: false,
    meaning: "The run cannot be used here",
    fix: "Name another run",
  });
  const seen: Array<ReadonlyArray<string>> = [];
  const place = defineCommand(
    {
      path: ["member", "place"],
      summary: "Place a member",
      effect: { kind: "read" },
      input: Schema.Struct({
        run: Schema.optionalKey(
          Schema.String.annotate({ valueName: "RUN", description: "The run", env: "ACME_RUN" }),
        ),
      }),
      validators: [
        {
          arguments: ["run"],
          error: Misplaced,
          description: "--run names a run that exists.",
          rejects: ["acme member place --run gone --json"],
          check: (args, given) => {
            seen.push(given.fromEnv);
            if (args.run !== "gone") return true;
            return {
              hint: given.fromEnv.includes("run")
                ? "acme member place"
                : "acme member place --run gone",
            };
          },
        },
      ],
      outputs: [report("Placed", "1.0", Schema.Struct({ placed: Schema.Int }))],
      errors: [Misplaced],
      examples: ["acme member place --json"],
    },
    () => Effect.succeed({ placed: 0 }),
  );
  const refused = (
    record: Record<string, string>,
    env: Record<string, string>,
    fromEnv?: ReadonlyArray<string>,
  ) =>
    Effect.runPromise(
      Effect.flip(
        Effect.flatMap(Effect.orDie(decodeArguments(place, record, { env })), (args) =>
          validateArguments(place, args, fromEnv === undefined ? undefined : { fromEnv }),
        ),
      ),
    );

  test("a validator's check gets fromEnv: the options whose value came from the environment, none by default", async () => {
    seen.length = 0;
    const fromEnv = await refused({}, { ACME_RUN: "gone" }, ["run"]);
    expect(fromEnv.hint).toBe("acme member place");
    const named = await refused({ run: "gone" }, { ACME_RUN: "other" }, []);
    expect(named.hint).toBe("acme member place --run gone");
    const unsaid = await refused({ run: "gone" }, {});
    expect(unsaid.hint).toBe("acme member place --run gone");
    expect(seen).toEqual([["run"], [], []]);
  });
});
