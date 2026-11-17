/**
 * `defineTool` on the example tool `acme`: its documents and registries come from the declarations with the tool's
 * rules and the contract's reserved options applied, each is an atip/1 answer by the contract's schemas, and the
 * built-ins `schema` and `skills show` answer from the tool they run in, refusing with the tool's own errors.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Option, Schema } from "effect";
import {
  CONTRACT_RULES,
  CONTRACT_VERSION,
  type CommandFailure,
  commandDocument,
  defineCommand,
  defineError,
  defineTool,
  Given,
  inputOption,
  jsonOption,
  type JsonObject,
  planDigestOption,
  report,
  type SchemaArguments,
  type SkillsArguments,
  suggest,
  toolDescription,
  toolProfile,
} from "../src/index.ts";
import {
  guideProblems,
  registryEntryProblems,
  schemaAnswerProblems,
  warningEntryProblems,
} from "../src/validate.ts";
import {
  ACME,
  ACME_TOOL,
  ACME_TOOL_DECLARATION,
  memberPurge,
  memberShow,
  memberTag,
  schemaBuiltin,
  skillsBuiltin,
} from "./acme.ts";

/** A `schema` answer as `acme schema … --json` prints it. */
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

const schemaArgs = (given: Partial<SchemaArguments>): SchemaArguments => ({
  operands: [],
  schemas: false,
  errors: false,
  warnings: false,
  ...given,
});

/** The built-in `schema` run in acme, the options given in `order` when it says. */
const askSchema = (given: Partial<SchemaArguments>, order?: ReadonlyArray<string>) => {
  const answered = ACME_TOOL.bind(schemaBuiltin).handler(schemaArgs(given));
  return Effect.runPromiseExit(
    order === undefined ? answered : Effect.provideService(answered, Given, { fromEnv: [], order }),
  );
};

const askSkills = (args: SkillsArguments) =>
  Effect.runPromiseExit(ACME_TOOL.bind(skillsBuiltin).handler(args));

/** The refusal of a run that must refuse. */
const failureOf = <A>(exit: Exit.Exit<A, CommandFailure>): CommandFailure =>
  Option.getOrThrowWith(
    Exit.findErrorOption(exit),
    () => new Error(`expected a refusal, got ${String(exit)}`),
  );

/** The answer of a run that must answer. */
const dataOf = <A>(exit: Exit.Exit<A, CommandFailure>): A => {
  if (Exit.isFailure(exit)) throw new Error(`expected an answer, got ${String(exit.cause)}`);
  return exit.value;
};

/** A `schema` answer, as JSON (its report is any JSON object). */
const schemaData = async (given: Partial<SchemaArguments>): Promise<unknown> =>
  dataOf(await askSchema(given));

describe("defineTool: the documents and registries of acme", () => {
  test("the tree, every group and every command document of acme are atip/1 schema answers (schema-doc.schema.json)", () => {
    const documents: ReadonlyArray<JsonObject> = [
      ACME_TOOL.tree(),
      ...ACME_TOOL.groups.flatMap((group) => {
        const document = ACME_TOOL.group(group.name);
        return document === undefined ? [] : [document];
      }),
      ...ACME_TOOL.commands.map(ACME_TOOL.document),
    ];
    expect(documents).toHaveLength(2 + ACME_TOOL.groups.length + ACME_TOOL.commands.length - 1);
    for (const document of documents) expect(schemaAnswerProblems(answer(document))).toEqual([]);
  });

  test("every registry row is an atip/1 registry entry and every warning row a warning entry", () => {
    for (const row of ACME_TOOL.errors) expect(registryEntryProblems(row)).toEqual([]);
    for (const row of ACME_TOOL.warnings) expect(warningEntryProblems(row)).toEqual([]);
    expect(schemaAnswerProblems(answer({ kind: "errors", errors: ACME_TOOL.errors }))).toEqual([]);
    expect(
      schemaAnswerProblems(answer({ kind: "warnings", warnings: ACME_TOOL.warnings })),
    ).toEqual([]);
  });

  test("the tree lists every group before its commands, then the root commands, from the declarations alone; a 1.4 entry has no path and a command's no kind", () => {
    expect(ACME_TOOL.tree()).toEqual({
      kind: "tree",
      level: "L1",
      commands: [
        {
          command: "member",
          kind: "group",
          summary: "Members of the roster: show, tag, purge",
        },
        {
          command: "member show",
          summary: "Show one member",
          effect: "read",
        },
        {
          command: "member tag",
          summary: "Tag a member",
          effect: "write",
        },
        {
          command: "member purge",
          summary: "Remove a member and their tags",
          effect: "destructive",
        },
        { command: "skills", kind: "group", summary: "Guides of acme: show" },
        {
          command: "skills show",
          summary: "Print a guide of acme",
          effect: "read",
        },
        {
          command: "schema",
          summary:
            "Describe acme: the command tree, one command, the error codes or the warning codes",
          effect: "read",
        },
      ],
    });
  });

  test("a command as the tool describes it: its options then the shared ones, its constraints then theirs, its codes then the contract's", () => {
    const purge = ACME_TOOL.describe(memberPurge);
    expect(purge.options.map((option) => option.name)).toEqual([
      "input",
      "commit",
      "plan-digest",
      "json",
    ]);
    expect(purge.constraints).toEqual([
      { rule: "requires", if: { name: "commit" }, needs: ["plan-digest"], code: "OPTION_CONFLICT" },
      { rule: "requires", if: { name: "plan-digest" }, needs: ["commit"], code: "OPTION_CONFLICT" },
    ]);
    expect(purge.errors).toEqual([
      "MEMBER_NOT_FOUND",
      "ROSTER_UNAVAILABLE",
      "PLAN_STALE",
      "INPUT_INVALID",
      "INPUT_CONFLICT",
      "INPUT_TOO_LARGE",
      "OPTION_CONFLICT",
    ]);
    const document = ACME_TOOL.document(memberPurge);
    // USAGE, INTERNAL, the INPUT_* codes and PLAN_STALE (with --commit) are implied in 1.4 (spec 9.5)
    expect(document["errors"]).toEqual([
      "MEMBER_NOT_FOUND",
      "OPTION_CONFLICT",
      "ROSTER_UNAVAILABLE",
    ]);
    // the wire member `then` is written only in the document (spec 9.8.1), so it is compared as text
    expect(JSON.stringify(document["constraints"])).toBe(
      '[{"rule":"requires","if":{"name":"commit"},"then":["plan-digest"],"code":"OPTION_CONFLICT"},' +
        '{"rule":"requires","if":{"name":"plan-digest"},"then":["commit"],"code":"OPTION_CONFLICT"}]',
    );
    // a read takes none of it but --json
    expect(ACME_TOOL.describe(memberShow).options.map((option) => option.name)).toEqual([
      "with-tags",
      "json",
    ]);
  });

  test("the package adds the contract's options to a write and nothing else: --input, then --json, and the INPUT_* codes", () => {
    const described = toolDescription(memberTag.description, ACME);
    expect(described.constraints).toEqual(memberTag.description.constraints);
    expect(described.errors).toEqual([
      ...memberTag.description.errors,
      "INPUT_INVALID",
      "INPUT_CONFLICT",
      "INPUT_TOO_LARGE",
    ]);
    expect(described.ext).toEqual(memberTag.description.ext);
    expect(described.options).toEqual([
      ...memberTag.description.options,
      inputOption(CONTRACT_RULES.help.input),
      jsonOption(CONTRACT_RULES.help.json),
    ]);
  });

  test("a 1.3 document of a command with --input lists the INPUT_* codes though no generic code names them (Annex S2 rule 4); 1.4 implies them", () => {
    const profile13 = toolProfile({ name: "acme", genericErrors: [], contractVersion: "1.3" });
    const listed13 = commandDocument(memberTag.description, profile13)["errors"];
    expect(listed13).toEqual(expect.arrayContaining(["INPUT_CONFLICT", "INPUT_INVALID", "INPUT_TOO_LARGE"]));
    const profile14 = toolProfile({ name: "acme", genericErrors: [], contractVersion: "1.4" });
    const listed14 = commandDocument(memberTag.description, profile14)["errors"];
    expect(JSON.stringify(listed14)).not.toContain("INPUT_");
    // a read without --input lists none
    expect(JSON.stringify(commandDocument(memberShow.description, profile13)["errors"])).not.toContain("INPUT_");
  });

  test("a read that declares a batch takes --input by default (Annex S2 rule 5)", () => {
    const batchedRead = defineCommand(
      {
        path: ["member", "check"],
        summary: "Check members",
        effect: { kind: "read" },
        input: Schema.Struct({}),
        outputs: [report("Checked", "1.0", Schema.Struct({ ok: Schema.Boolean }))],
        errors: [],
        batch: { maxItems: 5, report: "1.0" },
        examples: ["acme member check --json"],
      },
      () => Effect.succeed({ ok: true }),
    );
    const described = toolDescription(batchedRead.description, ACME);
    expect(described.options.map((option) => option.name)).toEqual(["input", "json"]);
    expect(described.errors).toContain("BATCH_INCOMPLETE");
    expect(described.errors).toContain("INPUT_INVALID");
  });

  test("without a commit pair code the relation of --commit and --plan-digest answers USAGE, and no code is added", () => {
    const purge = toolDescription(memberPurge.description, ACME);
    expect(purge.options.map((option) => option.name)).toEqual([
      "input",
      "commit",
      "plan-digest",
      "json",
    ]);
    expect(purge.options.find((option) => option.name === "plan-digest")).toEqual(
      planDigestOption(CONTRACT_RULES.help.planDigest),
    );
    expect(purge.constraints).toEqual([
      { rule: "requires", if: { name: "commit" }, needs: ["plan-digest"] },
      { rule: "requires", if: { name: "plan-digest" }, needs: ["commit"] },
    ]);
    expect(purge.errors).toEqual([
      "MEMBER_NOT_FOUND",
      "ROSTER_UNAVAILABLE",
      "PLAN_STALE",
      "INPUT_INVALID",
      "INPUT_CONFLICT",
      "INPUT_TOO_LARGE",
    ]);
  });

  test("a tool's own option of a contract name, its own relation and its own --input rule replace the contract's", () => {
    const profile = toolProfile({
      name: "acme",
      genericErrors: [],
      sharedOptions: () => [jsonOption("One envelope on stdout")],
      sharedConstraints: (command) =>
        command.effect === "destructive"
          ? [{ rule: "requires", if: { name: "commit" }, needs: ["plan-digest"] }]
          : [],
      contract: { takesInput: () => true, help: { input: "A document" } },
    });
    const show = toolDescription(memberShow.description, profile);
    expect(show.options.map((option) => [option.name, option.help])).toEqual([
      ["with-tags", "Include the member's tags"],
      ["json", "One envelope on stdout"],
      ["input", "A document"],
    ]);
    // the tool stated one direction itself: the package adds only the other
    expect(toolDescription(memberPurge.description, profile).constraints).toEqual([
      { rule: "requires", if: { name: "commit" }, needs: ["plan-digest"] },
      { rule: "requires", if: { name: "plan-digest" }, needs: ["commit"] },
    ]);
  });

  test("--fields is added to a command whose output declares fields, and the codes of --cursor and --fields follow", () => {
    const Page = Schema.Struct({
      members: Schema.Array(Schema.Struct({ number: Schema.Int, name: Schema.String })),
    });
    const list = defineCommand(
      {
        path: ["member", "list"],
        summary: "List the members",
        effect: { kind: "read" },
        input: Schema.Struct({
          cursor: Schema.optionalKey(
            Schema.String.annotate({ valueName: "CURSOR", description: "Continue a listing" }),
          ),
        }),
        outputs: [report("MemberPage", "1.0", Page, { fields: { records: "/members" } })],
        errors: [],
        examples: ["acme member list --json"],
      },
      () => Effect.succeed({ members: [] }),
    );
    const plain = toolDescription(list.description, ACME);
    expect(plain.options.map((option) => [option.name, option.flagOnly])).toEqual([
      ["cursor", true],
      ["fields", true],
      ["json", true],
    ]);
    expect(plain.errors).toEqual(["CURSOR_INVALID"]);
    const finer = toolProfile({
      name: "acme",
      genericErrors: [],
      contract: { fieldsCode: "OPTION_VALUE_INVALID" },
    });
    expect(toolDescription(list.description, finer).errors).toEqual([
      "CURSOR_INVALID",
      "OPTION_VALUE_INVALID",
    ]);
  });

  test("defineTool refuses a code the package lists that the tool does not register", () => {
    expect(() =>
      defineTool({
        ...ACME_TOOL_DECLARATION,
        profile: { ...ACME_TOOL_DECLARATION.profile, contract: { commitPairCode: "COMMIT_REQUIRED" } },
      }),
    ).toThrow(/COMMIT_REQUIRED is listed by member purge but not registered/);
  });

  test("a command the profile does not list stays out of the tree and its group, and still has its document", () => {
    const hidden = defineTool({
      ...ACME_TOOL_DECLARATION,
      profile: {
        ...ACME_TOOL_DECLARATION.profile,
        listed: (command) => command.path.join(" ") !== "member purge",
        published: (command) => ({ ...command, ext: { "x-acme": { reviewed: true } } }),
      },
    });
    const listed = (document: JsonObject | undefined) =>
      JSON.stringify(document?.["commands"] ?? []).includes('"member purge"');
    expect(listed(hidden.tree())).toBe(false);
    expect(listed(hidden.group("member"))).toBe(false);
    expect(hidden.document(memberPurge)["command"]).toBe("member purge");
    // the tool's own members as it publishes them
    expect(hidden.document(memberPurge)["x-acme"]).toEqual({ reviewed: true });
  });

  test("the registry is the tool-level errors in their order, then each command's declared ones, each code once", () => {
    expect(ACME_TOOL.errors.map((row) => row.code)).toEqual([
      "USAGE",
      "INPUT_INVALID",
      "INPUT_CONFLICT",
      "INPUT_TOO_LARGE",
      "INTERNAL",
      "UNKNOWN_COMMAND",
      "SKILL_NOT_FOUND",
      "OPTION_CONFLICT",
      "PLAN_STALE",
      "MEMBER_NOT_FOUND",
      "ROSTER_UNAVAILABLE",
      "NOTE_REQUIRED",
      "DATE_INVALID",
    ]);
    // a row keeps its reasons; the tool's own members follow it
    const marked = defineTool({
      ...ACME_TOOL_DECLARATION,
      profile: {
        ...ACME_TOOL_DECLARATION.profile,
        errorMembers: (code) => ({ "x-acme": { generic: code === "USAGE" } }),
      },
    });
    expect(marked.errors.find((row) => row.code === "DATE_INVALID")).toEqual({
      code: "DATE_INVALID",
      exit: 2,
      retryable: false,
      meaning: "The date is not a day of the calendar",
      fix: "Give a real day as YYYY-MM-DD",
      reasons: [
        {
          reason: "NO_SUCH_DAY",
          meaning: "The month has no such day",
          fix: "Check the month's length",
        },
      ],
      "x-acme": { generic: false },
    });
    expect(marked.errors[0]?.["x-acme"]).toEqual({ generic: true });
    expect(ACME_TOOL.warnings).toEqual([
      { code: "TAG_REPEATED", meaning: "The member already had this tag", fix: "Nothing to redo" },
    ]);
  });

  test("a code defined twice (with different rows or as two values of one row), a command declared twice or an unknown default guide is refused when the tool is defined", () => {
    const twin = defineError({
      code: "MEMBER_NOT_FOUND",
      meaning: "Another meaning",
      fix: "Another fix",
    });
    expect(() =>
      defineTool({ ...ACME_TOOL_DECLARATION, errors: [...ACME_TOOL_DECLARATION.errors, twin] }),
    ).toThrow("member show: MEMBER_NOT_FOUND is defined twice, with different rows");
    // the same row as acme's MEMBER_NOT_FOUND, as a second value
    const copy = defineError({
      code: "MEMBER_NOT_FOUND",
      exit: 2,
      retryable: false,
      meaning: "No member has this number",
      fix: "List the members: acme member list --json",
    });
    expect(() =>
      defineTool({ ...ACME_TOOL_DECLARATION, errors: [...ACME_TOOL_DECLARATION.errors, copy] }),
    ).toThrow("member show: MEMBER_NOT_FOUND is defined twice");
    expect(() =>
      defineTool({
        ...ACME_TOOL_DECLARATION,
        commands: [...ACME_TOOL_DECLARATION.commands, memberShow],
      }),
    ).toThrow("commands declared twice: member show");
    expect(() =>
      defineTool({
        ...ACME_TOOL_DECLARATION,
        guides: { ...ACME_TOOL_DECLARATION.guides, default: "nope" },
      }),
    ).toThrow("the default guide nope is not a guide");
  });

  test("a usage replacement must be a registered exit-2 code a reader can tell: *_INVALID, *_REQUIRED or a meaning that says so (spec 7.3.2)", () => {
    const withReplacements = (usageReplacements: ReadonlyArray<string>) =>
      defineTool({
        ...ACME_TOOL_DECLARATION,
        profile: { ...ACME_TOOL_DECLARATION.profile, usageReplacements },
      });
    expect(() => withReplacements(["INPUT_INVALID"])).not.toThrow();
    expect(() => withReplacements(["NOSUCH_INVALID"])).toThrow(
      "the usage replacement NOSUCH_INVALID is not registered",
    );
    expect(() => withReplacements(["INTERNAL"])).toThrow(
      "the usage replacement INTERNAL is registered with exit 1, not 2",
    );
    expect(() => withReplacements(["OPTION_CONFLICT"])).toThrow(
      "the usage replacement OPTION_CONFLICT is named neither *_INVALID nor *_REQUIRED",
    );
  });
});

describe("defineTool: the built-in schema", () => {
  test("no words answer the tree, a group's name its group, a command's words (or one quoted word) its document", async () => {
    expect(await schemaData({})).toEqual(ACME_TOOL.tree());
    expect(await schemaData({ operands: ["member"] })).toEqual(ACME_TOOL.group("member"));
    const tag = ACME_TOOL.document(memberTag);
    expect(await schemaData({ operands: ["member", "tag"] })).toEqual(tag);
    expect(await schemaData({ operands: [" member  tag "] })).toEqual(tag);
  });

  test("--errors, --error, --warnings and --warning answer the registries and one row each", async () => {
    expect(await schemaData({ errors: true })).toEqual({
      kind: "errors",
      errors: ACME_TOOL.errors,
    });
    expect(await schemaData({ error: "NOTE_REQUIRED" })).toEqual({
      kind: "error",
      error: ACME_TOOL.errors.find((row) => row.code === "NOTE_REQUIRED"),
    });
    expect(await schemaData({ warnings: true })).toEqual({
      kind: "warnings",
      warnings: ACME_TOOL.warnings,
    });
    expect(await schemaData({ warning: "TAG_REPEATED" })).toEqual({
      kind: "warning",
      warning: ACME_TOOL.warnings[0],
    });
  });

  test("words that name nothing are the tool's UNKNOWN_COMMAND on command, expected the words valid where the first unknown one is", async () => {
    const inGroup = failureOf(await askSchema({ operands: ["member", "tags"] }));
    expect(inGroup).toMatchObject({
      code: "UNKNOWN_COMMAND",
      message: "no command member tags",
      field: "command",
      received: "member tags",
      expected: ["show", "tag", "purge"],
      suggestions: ["member tag"],
      hint: "acme schema member --json",
    });
    const top = failureOf(await askSchema({ operands: ["membr"] }));
    expect(top).toMatchObject({
      code: "UNKNOWN_COMMAND",
      field: "command",
      expected: ["schema", "member", "skills"],
      hint: "acme schema --json",
    });
    // a word after a leaf command: no word is valid there, so no expected (spec 9.1.1)
    const afterLeaf = failureOf(await askSchema({ operands: ["member", "tag", "nosuch"] }));
    expect(afterLeaf).toMatchObject({
      code: "UNKNOWN_COMMAND",
      field: "command",
      received: "member tag nosuch",
      hint: "acme schema member tag --json",
    });
    expect(afterLeaf).not.toHaveProperty("expected");
  });

  test("two registry options are USAGE on the one the command line gave second; with command words on the operands", async () => {
    expect(
      failureOf(await askSchema({ errors: true, warnings: true }, ["warnings", "errors"])),
    ).toMatchObject({
      code: "USAGE",
      field: "--errors",
      message: "--warnings and --errors cannot be used together: ask one registry at a time",
      hint: "acme schema --warnings --json",
    });
    expect(
      failureOf(await askSchema({ errors: true, warnings: true }, ["errors", "warnings"])),
    ).toMatchObject({ field: "--warnings", hint: "acme schema --errors --json" });
    // without Given, the declaration's order
    expect(failureOf(await askSchema({ warning: "X", error: "Y" }))).toMatchObject({
      field: "--warning",
      hint: "acme schema --error Y --json",
    });
    expect(failureOf(await askSchema({ errors: true, operands: ["member"] }))).toMatchObject({
      code: "USAGE",
      field: "<command>",
      received: "member",
      message: "--errors takes no command words (got member)",
    });
  });

  test("a code of the other registry only is refused with the command that shows it; an unknown one with the nearest codes", async () => {
    expect(failureOf(await askSchema({ error: "TAG_REPEATED" }))).toMatchObject({
      code: "USAGE",
      field: "--error",
      received: "TAG_REPEATED",
      message: "TAG_REPEATED is a warning code, not an error code",
      hint: "acme schema --warning TAG_REPEATED --json",
    });
    expect(failureOf(await askSchema({ warning: "PLAN_STALE" }))).toMatchObject({
      field: "--warning",
      hint: "acme schema --error PLAN_STALE --json",
    });
    expect(failureOf(await askSchema({ error: "PLAN_STAL" }))).toMatchObject({
      message: "no error code PLAN_STAL",
      suggestions: suggest(
        "PLAN_STAL",
        ACME_TOOL.errors.map((row) => row.code),
      ),
      hint: "acme schema --errors --json",
    });
    expect(failureOf(await askSchema({ error: "PLAN_STAL" }))).toMatchObject({
      suggestions: ["PLAN_STALE"],
    });
  });

  test("--schemas answers a command's schemas; without a path, with a group or a registry option it is USAGE on --schemas (spec 9.1.1, 9.9.3)", async () => {
    expect(await schemaData({ operands: ["member", "tag"], schemas: true })).toEqual(
      ACME_TOOL.schemas(memberTag),
    );
    expect(failureOf(await askSchema({ schemas: true }))).toMatchObject({
      code: "USAGE",
      field: "--schemas",
      hint: "acme schema --json",
    });
    expect(failureOf(await askSchema({ operands: ["member"], schemas: true }))).toMatchObject({
      code: "USAGE",
      field: "--schemas",
      hint: "acme schema member --json",
    });
    expect(
      failureOf(await askSchema({ operands: ["member", "tag"], schemas: true, errors: true })),
    ).toMatchObject({ code: "USAGE", field: "--schemas", hint: "acme schema --errors --json" });
    expect(
      failureOf(await askSchema({ operands: ["member", "nosuch"], schemas: true })),
    ).toMatchObject({ code: "UNKNOWN_COMMAND", field: "command" });
    const acme13 = defineTool({
      ...ACME_TOOL_DECLARATION,
      profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion: "1.3" },
    });
    // a tool that declares 1.3 has no --schemas: its schema is described without it, and its handler refuses it
    const schema13 = acme13.command(["schema"]);
    if (schema13 === undefined) throw new Error("acme has schema");
    expect(acme13.describe(schema13).options.map((option) => option.name)).not.toContain("schemas");
    const options13 = acme13.document(schema13)["options"];
    expect(Array.isArray(options13) ? options13 : []).not.toContainEqual(
      expect.objectContaining({ name: "schemas" }),
    );
    expect(acme13.parse(["schema", "member", "tag", "--schemas", "--json"], {})).toMatchObject({
      failure: { refusal: { code: "OPTION_INVALID", field: "--schemas" } },
    });
    const refused13 = await Effect.runPromiseExit(
      acme13
        .bind(schemaBuiltin)
        .handler(schemaArgs({ operands: ["member", "tag"], schemas: true })),
    );
    expect(failureOf(refused13)).toMatchObject({ code: "USAGE", field: "--schemas" });
  });
});

describe("defineTool: the built-in skills show", () => {
  test("the default guide, a named one with --full, each a valid guide (guide.schema.json)", async () => {
    const first = dataOf(await askSkills({ operands: [undefined], full: false }));
    expect(first).toEqual({
      name: "acme",
      text: "# acme\n\nA team roster.",
      guides: ["acme", "roster"],
      full: false,
    });
    const full = dataOf(await askSkills({ operands: ["roster"], full: true }));
    expect(full.text).toBe("# roster\n\nKeep it current.\n\n## Reference\n\nTags.");
    for (const guide of [first, full]) expect(guideProblems(guide)).toEqual([]);
  });

  test("an unknown guide is the tool's SKILL_NOT_FOUND, with the guides there are", async () => {
    expect(failureOf(await askSkills({ operands: ["rooster"], full: false }))).toMatchObject({
      code: "SKILL_NOT_FOUND",
      message: "no guide rooster",
      field: "name",
      received: "rooster",
      expected: ["acme", "roster"],
      suggestions: ["roster"],
      hint: "acme skills show",
    });
    expect(dataOf(await askSkills({ operands: ["acme"], full: false })).name).toBe("acme");
  });
});
