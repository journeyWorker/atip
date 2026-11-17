/**
 * atip 1.6 in the library: comma lists (spec 9.7.6, Annex S2 rule 18), the tree's path
 * shape (spec 4.1.1, Annex S2 rule 19) and one meaning per group (Annex S1 item 4), on the example tool acme with a 1.6 command
 * `member select`. Its documents state both; the parser splits argv and `env` values; a declaration that breaks a rule
 * is refused when the tool is defined.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  decodeDocument,
  defineCommand,
  defineTool,
  patternAdmitsComma,
  report,
} from "../src/index.ts";
import { ACME_TOOL_DECLARATION, MemberView, RosterUnavailable } from "./acme.ts";

const Tag = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u));

/**
 * `member select`: members by tags and roles, both comma lists; `--tag` also from `ACME_TAGS`. As a write (`member
 * mark`, replay-safe) it takes `--input`, as acme's writes do.
 */
const memberSelect = (
  fields: Record<string, Schema.Top> = {},
  path: readonly [string, ...Array<string>] = ["member", "select"],
  writes = false,
) =>
  defineCommand(
    {
      path,
      summary: writes
        ? "Mark the members with any of the tags and roles"
        : "Members with any of the tags and roles",
      effect: writes ? { kind: "write", idempotency: "replay-safe" } : { kind: "read" },
      input: Schema.Struct({
        tag: Schema.optionalKey(
          Schema.Array(Tag).annotate({
            valueName: "TAG",
            description: "A tag the member has (a comma list)",
            env: "ACME_TAGS",
            commaList: true,
          }),
        ),
        role: Schema.optionalKey(
          Schema.Array(Schema.Literals(["lead", "member", "guest"])).annotate({
            valueName: "ROLE",
            description: "A role the member has (a comma list)",
            commaList: true,
          }),
        ),
        ...fields,
      }),
      outputs: [report("MemberView", "1.0", MemberView)],
      errors: [RosterUnavailable],
      examples: [`acme ${path.join(" ")} --tag core,ops --role lead --json`],
    },
    () => Effect.succeed({ number: 7, name: "Ada", tags: ["core"] }),
  );

const memberMark = memberSelect({}, ["member", "mark"], true);

const tool16 = (
  commands = [memberSelect(), memberMark],
  profile: {
    readonly pathShape?: ReadonlyArray<string>;
    readonly contractVersion?: "1.5" | "1.6";
  } = {
    pathShape: ["noun", "verb"],
  },
) =>
  defineTool({
    ...ACME_TOOL_DECLARATION,
    commands: [...ACME_TOOL_DECLARATION.commands, ...commands],
    profile: { ...ACME_TOOL_DECLARATION.profile, ...profile },
  });

describe("comma lists and the path shape in acme's documents", () => {
  test("a 1.6 acme writes commaList on its options and pathShape on its tree", () => {
    const tool = tool16();
    // `member select` and `member mark` share both options: the tree defines them once, each command names them
    const select = tool.command(["member", "select"]);
    if (select === undefined) throw new Error("no member select");
    expect(tool.document(select)["options"]).toEqual(["tag", "role"]);
    expect(tool.tree()).toMatchObject({
      pathShape: ["noun", "verb"],
      options: [
        expect.objectContaining({ name: "tag", commaList: true, env: "ACME_TAGS" }),
        expect.objectContaining({ name: "role", commaList: true }),
      ],
    });
    // a write's --input example holds the example's comma list as its pieces
    expect(tool.document(memberMark)["input"]).toMatchObject({
      example: { tag: ["core", "ops"], role: ["lead"] },
    });
  });

  test("a name defined two ways in two groups is never hoisted into the tree: each command keeps it whole (atip crate 0.3.1)", () => {
    const group = (valueName: string) =>
      Schema.optionalKey(Tag.annotate({ valueName, description: "A group" }));
    const member = { group: group("MEMBER_GROUP") };
    const roster = { group: group("DEPLOY_GROUP") };
    const tool = tool16([
      memberSelect(member),
      memberSelect(member, ["member", "mark"], true),
      memberSelect(roster, ["roster", "select"]),
      memberSelect(roster, ["roster", "mark"], true),
    ]);
    const treeOptions = (tool.tree()["options"] ?? []) as ReadonlyArray<{ name: string }>;
    expect(treeOptions.map((option) => option.name)).toEqual(
      expect.arrayContaining(["tag", "role"]),
    );
    expect(treeOptions.map((option) => option.name)).not.toContain("group");
    const grouped = tool.commands.filter((one) =>
      one.description.options.some((option) => option.name === "group"),
    );
    expect(grouped).toHaveLength(4);
    for (const command of grouped) {
      const valueName = command.description.path[0] === "member" ? "MEMBER_GROUP" : "DEPLOY_GROUP";
      expect(tool.document(command)["options"]).toContainEqual(
        expect.objectContaining({ name: "group", valueName }),
      );
    }
  });
});

describe("the parser reads a comma list", () => {
  const tool = tool16();
  const optionsOf = (argv: ReadonlyArray<string>, env: Record<string, string> = {}) => {
    const parsed = tool.parse(argv, env);
    return Result.isSuccess(parsed) && parsed.success.kind === "invoke"
      ? parsed.success.parsed.options
      : parsed;
  };

  test("each argv value is split on commas and occurrences add up, in order", () => {
    expect(
      optionsOf(["member", "select", "--tag", "a,b", "--tag=c", "--role", "lead,guest"]),
    ).toEqual({
      tag: ["a", "b", "c"],
      role: ["lead", "guest"],
    });
  });

  test("an env value is split like an argv value; argv replaces it", () => {
    expect(optionsOf(["member", "select"], { ACME_TAGS: "core,ops" })).toEqual({
      tag: ["core", "ops"],
    });
    expect(optionsOf(["member", "select", "--tag", "x"], { ACME_TAGS: "core,ops" })).toEqual({
      tag: ["x"],
    });
  });

  test("an empty piece, a piece outside the values or the domain is refused like an invalid value", () => {
    expect(tool.parse(["member", "select", "--tag", "a,"], {})).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "--tag", received: "" } }),
    );
    expect(tool.parse(["member", "select", "--role", "lead,boss"], {})).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "--role", received: "boss" } }),
    );
    expect(tool.parse(["member", "select", "--tag", "a,B"], {})).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "--tag" } }),
    );
    expect(tool.parse(["member", "select"], { ACME_TAGS: "a,,b" })).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "ACME_TAGS", received: "" } }),
    );
  });

  test("an --input document's array is typed, never split: an item with a comma stays one item", async () => {
    const described = tool.describe(memberMark);
    expect(await Effect.runPromise(decodeDocument(described, { tag: ["a", "b"] }))).toEqual({
      tag: ["a", "b"],
    });
    expect(await Effect.runPromise(decodeDocument(described, { tag: ["a,b"] }))).toEqual({
      tag: ["a,b"],
    });
  });
});

describe("a declaration that breaks a 1.6 rule is refused when the tool is defined", () => {
  test("a comma list or a path shape in a tool that declares 1.5 (Annex S2 rule 16)", () => {
    expect(() =>
      tool16(undefined, { contractVersion: "1.5", pathShape: ["noun", "verb"] }),
    ).toThrow(/commaList is since 1\.6, the tool declares 1\.5.*pathShape is since 1\.6/);
  });

  test("a string comma list whose pattern admits a comma, or with none (rule 18)", () => {
    const loose = Schema.optionalKey(
      Schema.Array(Schema.String.check(Schema.isPattern(/^[^ ]+$/u))).annotate({
        valueName: "NAME",
        description: "A name",
        commaList: true,
      }),
    );
    expect(() => tool16([memberSelect({ name: loose })])).toThrow(
      /--name: a string comma list needs a domain pattern that admits no ","/,
    );
    expect(patternAdmitsComma("^[a-z0-9-]+$")).toBe(false);
    expect(patternAdmitsComma("^[^,]+$")).toBe(false);
    expect(patternAdmitsComma("^[^ ]+$")).toBe(true);
    expect(patternAdmitsComma("^a(,b)*$")).toBe(true);
  });

  test("an enum comma list with a value holding a comma (rule 18)", () => {
    const commaValue = Schema.optionalKey(
      Schema.Array(Schema.Literals(["a,b", "c"])).annotate({
        valueName: "PAIR",
        description: "A pair",
        commaList: true,
      }),
    );
    expect(() => tool16([memberSelect({ pair: commaValue })])).toThrow(
      /--pair: possible value "a,b" holds ","/,
    );
  });

  test("a comma list on a single value is refused when the command is described", () => {
    expect(() =>
      memberSelect({
        one: Schema.optionalKey(
          Tag.annotate({ valueName: "TAG", description: "One tag", commaList: true }),
        ),
      }),
    ).toThrow(/a comma list is a repeatable .* not a single string/);
  });

  test("a path longer than the shape, a label given twice (rule 19)", () => {
    expect(() =>
      tool16([memberSelect({}, ["member", "select", "all"])], { pathShape: ["noun", "verb"] }),
    ).toThrow(/path "member select all" is longer than the pathShape of 2 words/);
    expect(() => tool16(undefined, { pathShape: ["noun", "noun"] })).toThrow(
      /pathShape label "noun" is given twice/,
    );
  });

  test("one meaning per group: two value names in one group are refused, across groups allowed with another value name (Annex S1 item 4)", () => {
    const group = (valueName: string, type: Schema.Top = Tag) =>
      Schema.optionalKey(type.annotate({ valueName, description: "A group" }));
    // `member select --group MEMBER_GROUP` beside `member show`'s none: one command, nothing to compare
    expect(() => tool16([memberSelect({ group: group("MEMBER_GROUP") })])).not.toThrow();
    // another group (`roster`) may give --group another meaning under another value name
    const otherGroup = memberSelect({ group: group("DEPLOY_GROUP") }, ["roster", "select"]);
    expect(() =>
      tool16([memberSelect({ group: group("MEMBER_GROUP") }), otherGroup]),
    ).not.toThrow();
    // the same value name in another group is the same meaning: another value type is refused
    const sameNameOtherType = memberSelect({ group: group("MEMBER_GROUP", Schema.Int) }, [
      "roster",
      "select",
    ]);
    expect(() =>
      tool16([memberSelect({ group: group("MEMBER_GROUP") }), sameNameOtherType]),
    ).toThrow(/--group has two meanings in member select and roster select: the same value name/);
    // within one group a name keeps one value name
    const sameGroup = memberSelect({ group: group("DEPLOY_GROUP") }, ["member", "list"]);
    expect(() => tool16([memberSelect({ group: group("MEMBER_GROUP") }), sameGroup])).toThrow(
      /--group has two meanings in member list and member select: one value name and value type within the group "member"/,
    );
  });
});
