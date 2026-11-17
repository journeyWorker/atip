/**
 * The command library on its example tool `acme`: the documents it generates are atip/1
 * self-descriptions (the package's schema), its decoders type argv and `--input` values with pointers, its validators
 * and destructive runner behave as spec 9.8.2 and 11.4-11.7 say, its typed defaults cannot drift, and a declaration
 * the description could not state is refused when it is defined.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import {
  ArgumentsError,
  argvField,
  type CommandDescription,
  commandDocument,
  commaListProblems,
  commitOption,
  CONTRACT_VERSION,
  decodeArguments,
  decodeDocument,
  count,
  defaulted,
  defineCommand,
  type InputSchema,
  isJsonObject,
  json,
  operand,
  type OptionDescription,
  patternAdmitsComma,
  patternMinorProblems,
  patternProblem,
  planDigestOption,
  report,
  requires,
  runDestructive,
  sharedOptions,
  switchOption,
  toolDescription,
  validateArguments,
} from "../src/index.ts";
import {
  registryEntryProblems,
  schemaAnswerProblems,
  warningEntryProblems,
} from "../src/validate.ts";
import {
  ACME,
  ACME_TOOL,
  COMMANDS,
  DateInvalid,
  MemberNotFound,
  memberPurge,
  memberShow,
  memberTag,
  NoteRequired,
  rosterOf,
  RosterUnavailable,
  TagRepeated,
} from "./acme.ts";

/** A command document as `acme schema <COMMAND> --json` prints it. */
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

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromiseExit(effect);

/** A command as acme describes it (atip 1.3): what its `--input` documents are decoded against. */
const acmeDescribed = (command: { readonly description: CommandDescription }) =>
  toolDescription(command.description, ACME);

const members = rosterOf([
  { number: 7, name: "Ada", tags: ["core"] },
  { number: 8, name: "Grace", tags: [] },
]);

/** acme declaring 1.3: the form of the self-description before 1.4 (spec 15.7). */
const ACME_13 = { ...ACME, contractVersion: "1.3" as const };

describe("F5 the example tool's documents", () => {
  test("every acme schema answer is an atip/1 schema answer (schema-doc.schema.json)", () => {
    // the tree, each command document and its schemas answer, the warning registry (its error registry is a test
    // tool's, without the codes L1 adds), as `acme schema … --json` prints them
    const answers: ReadonlyArray<readonly [string, unknown]> = [
      ["tree", answer(ACME_TOOL.tree())],
      ...ACME_TOOL.commands.flatMap((command): ReadonlyArray<readonly [string, unknown]> => {
        const name = command.description.path.join("-");
        return [
          [name, answer(ACME_TOOL.document(command))],
          [`${name}-schemas`, answer(ACME_TOOL.schemas(command))],
        ];
      }),
      ["warnings", answer({ kind: "warnings", warnings: ACME_TOOL.warnings })],
    ];
    for (const [name, document] of answers)
      expect(schemaAnswerProblems(document), name).toEqual([]);
  });

  test("the 1.4 command document is the call surface: no default, no implied option or code, commit and plan-digest by name (spec 9.5)", () => {
    expect(ACME_TOOL.document(memberTag)).toEqual({
      kind: "command",
      command: "member tag",
      summary: "Tag a member",
      effect: "write",
      idempotency: "replay-safe",
      operands: [
        {
          name: "number",
          valueType: "integer",
          required: true,
          domain: { minimum: 1 },
          help: "The member's number",
        },
      ],
      options: [
        {
          name: "tag",
          required: true,
          domain: { pattern: "^[a-z][a-z0-9-]*$" },
          help: "The tag to add",
        },
        {
          name: "by",
          valueName: "WHO",
          default: "acme",
          domain: { maxLength: 254 },
          env: "ACME_USER",
          help: "Who tags",
        },
        {
          name: "expires",
          valueName: "DAY",
          domain: { pattern: String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.+Z\-]+)?$` },
          help: "When the tag lapses",
        },
        { name: "note", valueName: "TEXT", help: "Why" },
        { name: "quiet", valueType: "switch", help: "Print nothing on success" },
        { name: "verbose", valueType: "switch", help: "Print the whole member" },
      ],
      constraints: [
        // spec 9.8.1 names the member `then`; the document is JSON, never awaited
        // oxlint-disable-next-line unicorn/no-thenable
        { rule: "requires", if: { name: "expires" }, then: ["note"], code: "NOTE_REQUIRED" },
        { rule: "atMostOne", names: ["quiet", "verbose"] },
      ],
      validators: [
        {
          arguments: ["expires"],
          code: "DATE_INVALID",
          description:
            "--expires is a day of the calendar (2026-02-30 matches the pattern and is refused).",
        },
      ],
      errors: ["DATE_INVALID", "MEMBER_NOT_FOUND", "NOTE_REQUIRED", "ROSTER_UNAVAILABLE"],
      outputs: [{ schemaRef: "#/schemas/MemberTagged" }],
      input: { maxBytes: 65_536, example: { operands: [7], tag: "core" } },
      examples: ["acme member tag 7 --tag core --json"],
    });
    expect(ACME_TOOL.document(memberPurge)["options"]).toEqual(["commit", "plan-digest"]);
  });

  test("the schemas answer holds what the refs reach, the derived Input and the rejects (spec 9.9.2, 9.9.3)", () => {
    const answered = ACME_TOOL.schemas(memberTag);
    expect(Object.keys(answered["schemas"] as object)).toEqual(["MemberTagged", "Input"]);
    expect((answered["schemas"] as Record<string, unknown>)["Input"]).toEqual({
      type: "object",
      properties: {
        operands: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          prefixItems: [
            { anyOf: [{ type: "integer" }, { type: "string", pattern: "^-?(0|[1-9][0-9]*)$" }] },
          ],
          items: false,
        },
        tag: { type: "string" },
        by: { type: "string" },
        expires: { type: "string" },
        note: { type: "string" },
        quiet: { type: "boolean" },
        verbose: { type: "boolean" },
      },
      additionalProperties: false,
    });
    expect(answered["rejects"]).toEqual([
      ["acme member tag 7 --tag core --expires 2026-02-30 --note trial --json"],
    ]);
    expect(ACME_TOOL.schemas(memberShow)).toEqual({
      kind: "schemas",
      command: "member show",
      schemas: { MemberView: expect.any(Object) },
    });
  });

  test("an option identical on two listed commands is defined once in the tree and named; a rarer definition of the same name stays whole (spec 9.3)", () => {
    const option = (name: string, help: string): OptionDescription => ({
      name,
      valueName: "N",
      valueType: "integer",
      required: false,
      repeatable: false,
      default: null,
      flagOnly: false,
      help,
    });
    const command = (path: string, options: ReadonlyArray<OptionDescription>) => ({
      ...memberShow.description,
      path: path.split(" "),
      options,
    });
    const one = command("a one", [option("width", "How many"), option("depth", "How deep")]);
    const three = command("a three", [
      option("width", "At most this many"),
      option("depth", "How deep"),
    ]);
    const shared = sharedOptions(
      [one, command("a two", [option("width", "How many")]), three].map((declared) =>
        toolDescription(declared, ACME),
      ),
      ACME.contractVersion,
    );
    expect(shared.map((entry) => entry.document)).toEqual([
      { name: "width", valueName: "N", valueType: "integer", help: "How many" },
      { name: "depth", valueName: "N", valueType: "integer", help: "How deep" },
    ]);
    expect(commandDocument(one, ACME, shared)["options"]).toEqual(["width", "depth"]);
    expect(commandDocument(three, ACME, shared)["options"]).toEqual([
      { name: "width", valueName: "N", valueType: "integer", help: "At most this many" },
      "depth",
    ]);
  });

  test("a tool that declares 1.3 keeps the 1.3 form: the arguments are derived from the Struct with every member stated", () => {
    const document = commandDocument(memberTag.description, ACME_13);
    expect(document["operands"]).toEqual([
      {
        name: "number",
        valueName: "NUMBER",
        valueType: "integer",
        required: true,
        variadic: false,
        default: null,
        domain: { minimum: 1 },
        help: "The member's number",
      },
    ]);
    expect(document["options"]).toEqual([
      {
        name: "tag",
        valueName: "TAG",
        valueType: "string",
        required: true,
        repeatable: false,
        default: null,
        domain: { pattern: "^[a-z][a-z0-9-]*$" },
        help: "The tag to add",
      },
      {
        name: "by",
        valueName: "WHO",
        valueType: "string",
        required: false,
        repeatable: false,
        default: "acme",
        domain: { maxLength: 254 },
        env: "ACME_USER",
        help: "Who tags",
      },
      {
        name: "expires",
        valueName: "DAY",
        valueType: "string",
        required: false,
        repeatable: false,
        default: null,
        domain: { pattern: String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.+Z\-]+)?$` },
        help: "When the tag lapses",
      },
      {
        name: "note",
        valueName: "TEXT",
        valueType: "string",
        required: false,
        repeatable: false,
        default: null,
        help: "Why",
      },
      {
        name: "quiet",
        valueType: "switch",
        required: false,
        repeatable: false,
        default: false,
        help: "Print nothing on success",
      },
      {
        name: "verbose",
        valueType: "switch",
        required: false,
        repeatable: false,
        default: false,
        help: "Print the whole member",
      },
      {
        name: "input",
        valueName: "JSON|FILE|-",
        valueType: "string",
        required: false,
        repeatable: false,
        default: null,
        flagOnly: true,
        help: "The arguments as one JSON document: inline, a file, or - for stdin",
      },
      {
        name: "json",
        valueType: "switch",
        required: false,
        repeatable: false,
        default: false,
        flagOnly: true,
        help: "Print one JSON envelope",
      },
    ]);
    expect(document["constraints"]).toEqual([
      // spec 9.8.1 names the member `then`; the document is JSON, never awaited
      // oxlint-disable-next-line unicorn/no-thenable
      { rule: "requires", if: { name: "expires" }, then: ["note"], code: "NOTE_REQUIRED" },
      { rule: "atMostOne", names: ["quiet", "verbose"] },
    ]);
    expect(document["validators"]).toEqual([
      {
        arguments: ["expires"],
        code: "DATE_INVALID",
        description:
          "--expires is a day of the calendar (2026-02-30 matches the pattern and is refused).",
        rejects: ["acme member tag 7 --tag core --expires 2026-02-30 --note trial --json"],
      },
    ]);
    expect(document["errors"]).toEqual([
      "DATE_INVALID",
      "INPUT_CONFLICT",
      "INPUT_INVALID",
      "INPUT_TOO_LARGE",
      "INTERNAL",
      "MEMBER_NOT_FOUND",
      "NOTE_REQUIRED",
      "ROSTER_UNAVAILABLE",
      "USAGE",
    ]);
    expect(document["input"]).toEqual({
      option: "--input",
      schemaRef: "#/schemas/MemberTagInput",
      batch: false,
      maxBytes: 65_536,
      example: { operands: [7], tag: "core" },
    });
  });

  test("a tool that declares 1.3 keeps its fragment schema in the command document: every non-flag-only key, no required, no excess", () => {
    const document = commandDocument(memberTag.description, ACME_13);
    const schemas = document["schemas"];
    expect(
      schemas !== undefined && isJsonObject(schemas) ? schemas["MemberTagInput"] : undefined,
    ).toEqual({
      type: "object",
      properties: {
        operands: {
          type: "array",
          items: { type: ["integer", "string"], pattern: "^-?(0|[1-9][0-9]*)$" },
          minItems: 1,
          maxItems: 1,
        },
        tag: { type: "string" },
        by: { type: "string" },
        expires: { type: "string" },
        note: { type: "string" },
        quiet: { type: "boolean" },
        verbose: { type: "boolean" },
      },
      additionalProperties: false,
    });
  });

  test("every error and warning row is a registry entry; a reason is registered under its code", () => {
    for (const error of [MemberNotFound, NoteRequired, DateInvalid, RosterUnavailable])
      expect(registryEntryProblems(error.entry)).toEqual([]);
    expect(DateInvalid.entry.reasons).toEqual([
      {
        reason: "NO_SUCH_DAY",
        meaning: "The month has no such day",
        fix: "Check the month's length",
      },
    ]);
    expect(warningEntryProblems(TagRepeated.entry)).toEqual([]);
    expect(TagRepeated.make("already tagged", "--tag")).toEqual({
      code: "TAG_REPEATED",
      message: "already tagged",
      field: "--tag",
    });
    const failure = DateInvalid.make({ message: "no 30 February", reason: "NO_SUCH_DAY" });
    expect([
      failure.code,
      failure.reason,
      DateInvalid.is(failure),
      MemberNotFound.is(failure),
    ]).toEqual(["DATE_INVALID", "NO_SUCH_DAY", true, false]);
  });
});

describe("F1 decoding the arguments", () => {
  test("argv strings decode to the handler's typed arguments, defaults applied", async () => {
    const exit = await run(decodeArguments(memberTag, { operands: ["7"], tag: "core" }));
    expect(exit).toEqual(
      Exit.succeed({ operands: [7], tag: "core", by: "acme", quiet: false, verbose: false }),
    );
  });

  test("a value outside its type or domain is refused with its pointer, every one of them", async () => {
    const exit = await run(
      Effect.flip(
        decodeArguments(memberTag, {
          operands: ["0"],
          tag: "Core",
          by: "x".repeat(255),
          quiet: "yes",
        }),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const failure = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(failure).toBeInstanceOf(ArgumentsError);
    expect(failure?.source).toBe("argv");
    expect(failure?.issues.map((issue) => issue.pointer)).toEqual(["/quiet"]);
    const domains = await run(
      Effect.flip(
        decodeArguments(memberTag, { operands: ["0"], tag: "Core", by: "x".repeat(255) }),
      ),
    );
    const refused = Exit.isSuccess(domains) ? domains.value : undefined;
    expect(refused?.source).toBe("arguments");
    expect(refused?.issues.map((issue) => issue.pointer).toSorted()).toEqual([
      "/by",
      "/operands/0",
      "/tag",
    ]);
  });

  test("integers: the canonical string or a JSON integer, safe only, never rounded (spec 9.7.5)", async () => {
    for (const text of ["9007199254740993", "01", "1.0", " 7"]) {
      const exit = await run(decodeArguments(memberShow, { operands: [text] }));
      expect(Exit.isFailure(exit), text).toBe(true);
    }
    const document = await run(
      decodeDocument(acmeDescribed(memberShow), { operands: [9_007_199_254_740_992] }),
    );
    expect(Exit.isFailure(document)).toBe(true);
    expect(
      await run(decodeDocument(acmeDescribed(memberTag), { operands: [7], tag: "core" })),
    ).toEqual(Exit.succeed({ operands: [7], tag: "core" }));
    expect(
      await run(decodeDocument(acmeDescribed(memberTag), { operands: ["7"], tag: "core" })),
    ).toEqual(Exit.succeed({ operands: [7], tag: "core" }));
  });

  test("a document key that is flag-only or unknown is refused with its pointer (spec 10.6)", async () => {
    const exit = await run(
      Effect.flip(
        decodeDocument(acmeDescribed(memberTag), { tag: "core", json: true, colour: "red" }),
      ),
    );
    const refused = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(refused?.source).toBe("document");
    expect(refused?.issues.map((issue) => issue.pointer).toSorted()).toEqual(["/colour", "/json"]);
  });

  test("decodeDocument reads the tool's minor: limit, cursor, all and fields are document keys of a 1.1 tool only", async () => {
    const paging = {
      limit: defaulted(Schema.Int, 20).annotate({ valueName: "N", description: "Per page" }),
      cursor: Schema.optionalKey(
        Schema.String.annotate({ valueName: "CURSOR", description: "Continue" }),
      ),
      all: switchOption("Every page"),
      fields: Schema.optionalKey(
        Schema.String.annotate({ valueName: "FIELDS", description: "Paths" }),
      ),
    };
    const pager = (input: InputSchema) =>
      defineCommand(
        {
          path: ["member", "page"],
          summary: "Page the members",
          effect: { kind: "write", idempotency: "replay-safe" },
          input,
          outputs: [report("Paged", "1.0", Schema.Struct({ ok: Schema.Boolean }))],
          errors: [],
          examples: ["acme member page --json"],
        },
        () => Effect.succeed({ ok: true }),
      );
    const pointers = async (command: CommandDescription, document: unknown) => {
      const exit = await run(Effect.flip(decodeDocument(command, document)));
      return Exit.isSuccess(exit) ? exit.value.issues.map((issue) => issue.pointer).toSorted() : [];
    };
    const keys = { limit: 5, cursor: "c", all: true, fields: "ok" };
    // with a document key of its own, and with none left once the four are flag-only
    for (const [command, document] of [
      [
        pager(
          Schema.Struct({
            ...paging,
            team: Schema.optionalKey(
              Schema.String.annotate({ valueName: "TEAM", description: "A team" }),
            ),
          }),
        ),
        { ...keys, team: "core" },
      ],
      [pager(Schema.Struct(paging)), keys],
    ] as const) {
      expect(await pointers(acmeDescribed(command), document)).toEqual([
        "/all",
        "/cursor",
        "/fields",
        "/limit",
      ]);
      const as11 = toolDescription(command.description, { ...ACME, contractVersion: "1.1" });
      expect(await run(decodeDocument(as11, document))).toEqual(Exit.succeed(document));
    }
  });

  test("a validator refuses with its code what the domains accept (spec 9.8.2)", async () => {
    const decoded = await Effect.runPromise(
      decodeArguments(memberTag, {
        operands: ["7"],
        tag: "core",
        expires: "2026-02-30",
        note: "trial",
      }),
    );
    const refused = await run(Effect.flip(validateArguments(memberTag, decoded)));
    const failure = Exit.isSuccess(refused) ? refused.value : undefined;
    expect([failure?.code, failure?.field]).toEqual(["DATE_INVALID", "--expires"]);
    const fine = await Effect.runPromise(
      decodeArguments(memberTag, {
        operands: ["7"],
        tag: "core",
        expires: "2026-02-28",
        note: "trial",
      }),
    );
    expect(await run(validateArguments(memberTag, fine))).toEqual(Exit.void);
  });

  test("every defaulted field decodes absent to its annotated default (§3.4)", async () => {
    for (const command of COMMANDS) {
      // the required arguments given, every other one absent
      const args = await Effect.runPromise(command.toArguments({ tag: "core" }, [7]));
      const decoded: Readonly<Record<string, unknown>> = args;
      for (const [key, field] of Object.entries(command.input.fields)) {
        const annotated = Schema.resolveAnnotations(field)?.default;
        if (annotated !== undefined) expect(decoded[key], key).toEqual(annotated);
      }
    }
  });
});

describe("F1-F3 handlers", () => {
  test("a read handler gets its typed arguments; a declared failure is its own code", async () => {
    const show = (number: string) =>
      Effect.flatMap(
        decodeArguments(memberShow, { operands: [number], withTags: true }),
        memberShow.handler,
      ).pipe(Effect.provide(members));
    expect(await run(show("7"))).toEqual(Exit.succeed({ number: 7, name: "Ada", tags: ["core"] }));
    const missing = await run(Effect.flip(show("9")));
    const failure = Exit.isSuccess(missing) ? missing.value : undefined;
    expect(failure !== undefined && "code" in failure ? failure.code : undefined).toBe(
      "MEMBER_NOT_FOUND",
    );
  });

  test("a destructive command previews its plan and digest, commits only that digest, and refuses a stale one", async () => {
    const program = Effect.gen(function* () {
      const args = yield* decodeArguments(memberPurge, { operands: ["8"] });
      const request = {
        command: "member purge",
        arguments: { operands: [8] },
        previewArgv: ["member", "purge", "8", "--json"],
      };
      const preview = yield* runDestructive(memberPurge.handler, args, request);
      if (preview.committed) return yield* Effect.die("a preview committed");
      expect(preview.commitArgv).toEqual([
        "member",
        "purge",
        "8",
        "--json",
        "--commit",
        "--plan-digest",
        preview.planDigest,
      ]);
      const stale = yield* Effect.flip(
        runDestructive(memberPurge.handler, args, {
          ...request,
          commitDigest: `sha256:${"0".repeat(64)}`,
        }),
      );
      const done = yield* runDestructive(memberPurge.handler, args, {
        ...request,
        commitDigest: preview.planDigest,
      });
      const gone = yield* Effect.flip(runDestructive(memberPurge.handler, args, request));
      return { stale, done, gone };
    }).pipe(Effect.provide(members));
    const { stale, done, gone } = await Effect.runPromise(program);
    expect(
      "code" in stale ? [stale.code, stale.field, stale.next] : stale,
      "PLAN_STALE names the preview as its next step (spec 11.7)",
    ).toEqual(["PLAN_STALE", "--plan-digest", [["member", "purge", "8", "--json"]]]);
    expect(done).toMatchObject({
      committed: true,
      report: { number: 8, effects: [{ action: "remove", target: "member 8" }] },
    });
    expect("code" in gone ? gone.code : gone).toBe("MEMBER_NOT_FOUND");
  });

  test("the destructive options carry the digest's domain", () => {
    expect(commitOption("Act").flagOnly).toBe(true);
    expect(planDigestOption("The preview's digest").domain).toEqual({
      pattern: "^sha256:[0-9a-f]{64}$",
    });
  });
});

describe("F1 the environment, documents and argv names", () => {
  test("a document's values are what the fragment publishes: a count an integer, arrays not empty (review finding 8)", async () => {
    const listed = defineCommand(
      {
        path: ["thing", "list"],
        summary: "List things",
        effect: { kind: "read" },
        operands: [
          operand("names", Schema.String, {
            valueName: "NAME",
            help: "Names",
            variadic: true,
            required: false,
          }),
        ],
        input: Schema.Struct({
          verbose: count("More detail"),
          label: Schema.optionalKey(
            Schema.Array(Schema.String).annotate({ valueName: "LABEL", description: "A label" }),
          ),
        }),
        outputs: [report("Listed", "1.0", Schema.Struct({ ok: Schema.Boolean }))],
        errors: [],
        examples: ["acme thing list --json"],
      },
      () => Effect.succeed({ ok: true }),
    );
    const pointers = async (document: unknown) => {
      const exit = await run(Effect.flip(decodeDocument(acmeDescribed(listed), document)));
      return Exit.isSuccess(exit) ? exit.value.issues.map((issue) => issue.pointer) : [];
    };
    expect(await pointers({ verbose: "2" })).toEqual(["/verbose"]);
    expect(await pointers({ verbose: -1 })).toEqual(["/verbose"]);
    expect(await pointers({ label: [] })).toEqual(["/label"]);
    expect(await pointers({ operands: [] })).toEqual(["/operands"]);
    expect(
      await run(
        decodeDocument(acmeDescribed(listed), { verbose: 2, label: ["a"], operands: ["x"] }),
      ),
    ).toEqual(Exit.succeed({ verbose: 2, label: ["a"], operands: ["x"] }));
    // argv still counts occurrences as text, and gives no operands as an empty list
    expect(
      await Effect.runPromise(decodeArguments(listed, { verbose: "2", operands: [] })),
    ).toEqual({
      operands: [],
      verbose: 2,
    });
  });

  test("decodeArguments takes an absent option's env value from the caller's environment (spec 10.7 step 5)", async () => {
    expect(
      await Effect.runPromise(
        decodeArguments(
          memberTag,
          { operands: ["7"], tag: "core" },
          { env: { ACME_USER: "grace" } },
        ),
      ),
    ).toMatchObject({ by: "grace" });
    // argv wins over the environment; without an env record no variable applies
    expect(
      await Effect.runPromise(
        decodeArguments(
          memberTag,
          { operands: ["7"], tag: "core", by: "ada" },
          { env: { ACME_USER: "grace" } },
        ),
      ),
    ).toMatchObject({ by: "ada" });
    expect(
      await Effect.runPromise(decodeArguments(memberTag, { operands: ["7"], tag: "core" })),
    ).toMatchObject({
      by: "acme",
    });
    // an environment value is checked like argv's, and its issue names the variable
    const refused = await run(
      Effect.flip(
        decodeArguments(
          memberTag,
          { operands: ["0"], tag: "core" },
          { env: { ACME_USER: "x".repeat(255) } },
        ),
      ),
    );
    expect(
      Exit.isSuccess(refused)
        ? refused.value.issues
            .map(({ pointer, env }) => ({ pointer, env }))
            .toSorted((a, b) => a.pointer.localeCompare(b.pointer))
        : [],
    ).toEqual([
      { pointer: "/by", env: "ACME_USER" },
      { pointer: "/operands/0", env: undefined },
    ]);
  });

  test("argvField names the flag or operand of an issue pointer", () => {
    const operands = [
      { name: "change", variadic: false },
      { name: "files", variadic: true },
    ];
    expect(argvField("/maxMinutes", operands)).toBe("--max-minutes");
    expect(argvField("/label/1", operands)).toBe("--label");
    expect(argvField("/operands/0", operands)).toBe("<change>");
    expect(argvField("/operands/4", operands)).toBe("<files>");
    expect(argvField("/operands/2", [{ name: "change", variadic: false }])).toBeUndefined();
    expect(argvField("", operands)).toBeUndefined();
  });

  test("ArgumentsError is a schema-backed tagged error", () => {
    const error = new ArgumentsError({
      source: "argv",
      issues: [{ pointer: "/tag", message: "bad" }],
    });
    expect([error._tag, Schema.is(ArgumentsError)(error)]).toEqual(["ArgumentsError", true]);
  });
});

describe("F1 declarations the description cannot state are refused when defined", () => {
  const base = {
    path: ["thing", "do"],
    summary: "Do a thing",
    effect: { kind: "read" },
    outputs: [report("Done", "1.0", Schema.Struct({ ok: Schema.Boolean }))],
    errors: [],
    examples: ["acme thing do --json"],
  } as const;
  const handler = () => Effect.succeed({ ok: true });

  test("a check outside the domain profile must be a validator", () => {
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            name: Schema.String.check(
              Schema.makeFilter((value: string) => value.trim() === value),
            ).annotate({
              valueName: "NAME",
              description: "A name",
            }),
          }),
        },
        handler,
      ),
    ).toThrow(/--name: the check \(a predicate\) is outside the domain profile/);
  });

  test("a pattern without the u flag, a pattern outside I-Regexp, a field without help are refused", () => {
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            code: Schema.String.check(Schema.isPattern(/^[a-z]+$/)).annotate({
              valueName: "CODE",
              description: "A code",
            }),
          }),
        },
        handler,
      ),
    ).toThrow(/needs a RegExp with the u flag/);
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            code: Schema.String.check(Schema.isPattern(/^.+$/u)).annotate({
              valueName: "CODE",
              description: "A code",
            }),
          }),
        },
        handler,
      ),
    ).toThrow(/\. outside a character class/);
    expect(() =>
      defineCommand(
        { ...base, input: Schema.Struct({ count: Schema.Int.annotate({ valueName: "N" }) }) },
        handler,
      ),
    ).toThrow(/--count: no help/);
  });

  test("a constraint naming no argument is refused, and does not type-check", () => {
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            a: defaulted(Schema.Boolean, false).annotate({ description: "A" }),
          }),
          // @ts-expect-error -- `b` is no argument of this command
          constraints: [{ rule: "atMostOne", names: ["a", "b"] }],
        },
        handler,
      ),
    ).toThrow(/atMostOne names b, which is no argument/);
  });

  test("an operand is typed by its schema; variadic ones last", () => {
    const listed = defineCommand(
      {
        ...base,
        operands: [
          operand("first", Schema.String, { valueName: "FIRST", help: "The first" }),
          operand("rest", Schema.Int, {
            valueName: "N",
            help: "The others",
            variadic: true,
            required: false,
          }),
        ],
        input: Schema.Struct({}),
      },
      (args) =>
        Effect.succeed({ ok: args.operands[0].length > 0 && args.operands.slice(1).length >= 0 }),
    );
    expect(
      listed.description.operands.map((entry) => [entry.name, entry.valueType, entry.variadic]),
    ).toEqual([
      ["first", "string", false],
      ["rest", "integer", true],
    ]);
  });

  test("a json, a count, a repeatable and an enum option are derived and decoded", async () => {
    const listed = defineCommand(
      {
        ...base,
        input: Schema.Struct({
          filter: Schema.optionalKey(
            json(Schema.Struct({ name: Schema.String })).annotate({
              valueName: "JSON",
              description: "A filter",
            }),
          ),
          verbose: count("More detail per -v"),
          label: Schema.optionalKey(
            Schema.Array(Schema.String).annotate({
              valueName: "LABEL",
              description: "A label, repeatable",
            }),
          ),
          colour: defaulted(Schema.Literals(["red", "blue"]), "red").annotate({
            valueName: "COLOUR",
            description: "The colour",
          }),
        }),
      },
      handler,
    );
    expect(
      listed.description.options.map((option) => [
        option.name,
        option.valueType,
        option.repeatable,
        option.default,
        option.possibleValues ?? null,
        option.domain ?? null,
      ]),
    ).toEqual([
      [
        "filter",
        "json",
        false,
        null,
        null,
        {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          // the argument schema decodes a Struct ignoring other keys, which the domain says
          additionalProperties: true,
        },
      ],
      ["verbose", "count", true, 0, null, null],
      ["label", "string", true, null, null, null],
      ["colour", "enum", false, "red", ["red", "blue"], null],
    ]);
    expect(
      await Effect.runPromise(
        decodeArguments(listed, { filter: '{"name":"x"}', verbose: "2", label: ["a", "b"] }),
      ),
    ).toEqual({
      operands: [],
      filter: { name: "x" },
      verbose: 2,
      label: ["a", "b"],
      colour: "red",
    });
    expect(Exit.isFailure(await run(decodeArguments(listed, { filter: "null" })))).toBe(true);
  });

  test("the pattern form follows Annex V2", () => {
    expect(patternProblem("^(core|lead)$", "1.6")).toBeUndefined();
    expect(patternProblem("^core|lead$", "1.6")).toMatch(/\| outside parentheses/);
    expect(patternProblem("^[a&&b]+$", "1.6")).toMatch(/&& in a character class/);
    expect(patternProblem("^a\\-b$", "1.6")).toMatch(/\\- outside a character class/);
    expect(patternProblem("^\\d$", "1.6")).toMatch(/not I-Regexp/);
    expect(patternProblem("core", "1.6")).toBe("is not ^…$");
    expect(patternProblem("^[z-a]$", "1.6")).toMatch(/does not compile/);
  });

  test("\\p{White_Space} and \\P{White_Space} are admitted from 1.5 (spec 15.9), \\s never", () => {
    // the comma-free id pattern 1.6.1 records, and one line without leading or trailing white space
    const ids = "^[^,\\p{White_Space}]+$";
    const line = "^\\P{White_Space}([^\\n\\r]*\\P{White_Space})?$";
    for (const minor of ["1.5", "1.6"] as const) {
      expect(patternProblem(ids, minor)).toBeUndefined();
      expect(patternProblem(line, minor)).toBeUndefined();
    }
    for (const minor of ["1.1", "1.4"] as const) {
      expect(patternProblem(ids, minor)).toMatch(/White_Space\} is since 1\.5/);
      expect(patternProblem(line, minor)).toMatch(/White_Space\} is since 1\.5/);
    }
    expect(patternProblem("^\\p{Whitespace}+$", "1.6")).toMatch(/unknown category Whitespace/);
    expect(patternProblem("^\\s+$", "1.6")).toMatch(/not I-Regexp/);
    expect(new RegExp(ids, "u").test("a-b_c")).toBe(true);
    expect(new RegExp(ids, "u").test("a b")).toBe(false);
    expect(new RegExp(ids, "u").test("a,b")).toBe(false);
    expect(patternAdmitsComma(ids)).toBe(false);
  });

  test("a \\p{White_Space} domain is described, and defineTool holds it to the declared minor", () => {
    const id = Schema.String.check(Schema.isPattern(/^[^,\p{White_Space}]+$/u)).annotate({
      valueName: "ID",
      description: "An id",
    });
    const tagged = defineCommand(
      {
        ...base,
        input: Schema.Struct({
          id: Schema.optionalKey(id),
          tag: Schema.optionalKey(
            Schema.Array(id).annotate({ valueName: "TAG", description: "Tags", commaList: true }),
          ),
        }),
      },
      handler,
    );
    const options = tagged.description.options;
    expect(options[0]?.domain).toEqual({ pattern: "^[^,\\p{White_Space}]+$" });
    expect(options[1]?.commaList).toBe(true);
    expect(patternMinorProblems("1.6", [tagged.description])).toEqual([]);
    expect(commaListProblems("1.6", [tagged.description])).toEqual([]);
    expect(patternMinorProblems("1.4", [tagged.description])).toEqual([
      'thing do --id: pattern "^[^,\\\\p{White_Space}]+$" \\p{White_Space} is since 1.5 at offset 3 (Annex V2)',
      'thing do --tag: pattern "^[^,\\\\p{White_Space}]+$" \\p{White_Space} is since 1.5 at offset 3 (Annex V2)',
    ]);
  });

  /** A read command with these options (a Struct literal: its fields decode with no service). */
  const options = (input: InputSchema) => defineCommand({ ...base, input }, handler);

  test("a json domain may carry u-flag patterns anywhere in it (review finding 1)", () => {
    const described = options(
      Schema.Struct({
        filter: Schema.optionalKey(
          json(
            Schema.Struct({
              id: Schema.String.check(Schema.isPattern(/^[a-z]+$/u)),
              tags: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z]+$/u))),
              // a member named like the keyword (round 2 finding 1)
              pattern: Schema.String.check(Schema.isPattern(/^[0-9]+$/u)),
            }),
          ).annotate({ valueName: "JSON", description: "A filter" }),
        ),
      }),
    ).description.options[0];
    expect(described?.domain).toMatchObject({
      properties: {
        id: { pattern: "^[a-z]+$" },
        tags: { items: { pattern: "^[a-z]+$" } },
        pattern: { pattern: "^[0-9]+$" },
      },
    });
    expect(() =>
      options(
        Schema.Struct({
          filter: Schema.optionalKey(
            json(Schema.Struct({ id: Schema.String.check(Schema.isPattern(/^[a-z]+$/)) })).annotate(
              {
                valueName: "JSON",
                description: "A filter",
              },
            ),
          ),
        }),
      ),
    ).toThrow(/needs a RegExp with the u flag/);
  });

  test("an optional field decodes absent as its description says (review finding 2)", () => {
    expect(() =>
      options(
        Schema.Struct({
          name: Schema.String.annotate({ default: "x", valueName: "NAME", description: "A name" }),
        }),
      ),
    ).toThrow(
      /--name: it is described as optional, but the Struct refuses it absent: declare it with defaulted/,
    );
    expect(() =>
      options(Schema.Struct({ force: Schema.Boolean.annotate({ description: "Force" }) })),
    ).toThrow(
      /--force: it is described as optional, but the Struct refuses it absent: declare it with switchOption/,
    );
    expect(() =>
      options(
        Schema.Struct({
          force: Schema.optionalKey(Schema.Boolean.annotate({ description: "Force" })),
        }),
      ),
    ).toThrow(
      /--force: absent, it does not decode to its default false: declare it with switchOption/,
    );
    expect(() =>
      options(
        Schema.Struct({
          retries: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(3))).annotate({
            default: 5,
            valueName: "N",
            description: "Retries",
          }),
        }),
      ),
    ).toThrow(/--retries: absent, it does not decode to its default 5/);
    expect(
      options(
        Schema.Struct({
          retries: defaulted(Schema.Int, 3).annotate({ valueName: "N", description: "Retries" }),
        }),
      ).description.options[0]?.default,
    ).toBe(3);
  });

  test("a condition's in values are values of its argument; a switch takes none (review finding 3)", () => {
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            force: switchOption("Force"),
            note: Schema.optionalKey(
              Schema.String.annotate({ valueName: "TEXT", description: "Why" }),
            ),
          }),
          constraints: [requires({ name: "force", in: [true] }, ["note"])],
        },
        handler,
      ),
    ).toThrow(/requires on force: in a switch takes no in/);
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({
            round: Schema.optionalKey(
              Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
                valueName: "N",
                description: "Round",
              }),
            ),
            note: Schema.optionalKey(
              Schema.String.annotate({ valueName: "TEXT", description: "Why" }),
            ),
          }),
          constraints: [requires({ name: "round", in: [0, 1.5] }, ["note"])],
        },
        handler,
      ),
    ).toThrow(/in 0 must be at least 1[\s\S]*in 1.5 is not an integer/);
  });

  test("option and operand names follow Annex S1 items 3 and 5; extension keys are x- (spec 9.10.2; review finding 10)", () => {
    const named = (key: string) => () =>
      options(
        Schema.Struct({
          [key]: Schema.optionalKey(
            Schema.String.annotate({ valueName: "V", description: "A value" }),
          ),
        }),
      );
    expect(named("changeId")).toThrow(/--change-id ends in -id \(Annex S1 item 3/);
    expect(named("max_minutes")).toThrow(/--max_minutes is not a lower kebab-case name/);
    expect(named("maxMinutes")).not.toThrow();
    expect(() =>
      defineCommand(
        {
          ...base,
          operands: [operand("Target", Schema.String, { valueName: "T", help: "The target" })],
          input: Schema.Struct({}),
        },
        handler,
      ),
    ).toThrow(/<Target> is not a lower kebab-case name/);
    expect(() =>
      defineCommand(
        { ...base, input: Schema.Struct({}), ext: { kind: "group", "x-acme": {} } },
        handler,
      ),
    ).toThrow(/the command's ext member kind is no x-<name> extension/);
    expect(() =>
      defineCommand(
        {
          ...base,
          input: Schema.Struct({}),
          outputs: [
            report("Done", "1.0", Schema.Struct({ ok: Schema.Boolean }), {
              ext: { schemaRef: "x" },
            }),
          ],
        },
        handler,
      ),
    ).toThrow(/the output Done's ext member schemaRef is no x-<name> extension/);
  });

  test("a handler of the wrong shape is refused when defined, as its type refuses it", () => {
    expect(() =>
      defineCommand(
        { ...base, input: Schema.Struct({}), effect: { kind: "destructive", idempotency: "once" } },
        // @ts-expect-error -- a destructive command's handler is { plan, commit }
        handler,
      ),
    ).toThrow(/a destructive command's handler is \{ plan, commit \}/);
  });

  test("a switch or a count reads no environment variable", () => {
    expect(() =>
      options(Schema.Struct({ force: switchOption("Force").annotate({ env: "FORCE" }) })),
    ).toThrow(/--force: a switch reads no environment variable/);
  });
});
