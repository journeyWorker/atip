/**
 * The argv parser and `--input` merge over command descriptions (spec 4.2, 10.5-10.9), on the example tool `acme`:
 * paths, global options, the long, joined, short and `--` forms, switches, counts, repeatables, the environment,
 * required arguments, types, domains, constraints and every refusal kind with its parts; a document's keys, values and
 * conflicts with argv, and refusals at the document's pointers. The tool's own spellings (removed commands, renamed
 * options, moved operands) come from its profile.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  atLeastOne,
  type CommandDescription,
  count,
  defaulted,
  defineCommand,
  documentField,
  forbids,
  inputArgv,
  inputOption,
  json,
  mergeInput,
  operand,
  type ParsedCommand,
  parseCommandLine,
  parserProfile,
  report,
  switchOption,
  toolDescription,
  defineTool,
  type ToolProfile,
} from "../src/index.ts";
import { ACME, ACME_TOOL_DECLARATION, memberPurge, memberShow, memberTag } from "./acme.ts";

const Listed = Schema.Struct({ numbers: Schema.Array(Schema.Int) });

/** A read with every kind of argument: a variadic operand, an enum, a repeatable, bounds, a number, JSON, a count. */
const memberList = defineCommand(
  {
    path: ["member", "list"],
    summary: "List members",
    effect: { kind: "read" },
    operands: [
      operand("team", Schema.String, {
        valueName: "TEAM",
        help: "Teams",
        variadic: true,
        required: false,
      }),
    ],
    input: Schema.Struct({
      sort: Schema.optionalKey(
        Schema.Literals(["name", "number"]).annotate({ valueName: "KEY", description: "Order" }),
      ),
      label: Schema.optionalKey(
        Schema.Array(Schema.String).annotate({
          valueName: "LABEL",
          description: "A label",
          short: "l",
        }),
      ),
      limit: defaulted(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
        20,
      ).annotate({ valueName: "N", description: "How many", env: "ACME_LIMIT" }),
      ratio: Schema.optionalKey(
        Schema.Finite.annotate({ valueName: "RATIO", description: "A share" }),
      ),
      where: Schema.optionalKey(json().annotate({ valueName: "JSON", description: "A filter" })),
      verbose: count("More detail").annotate({ short: "v" }),
    }),
    constraints: [forbids({ name: "sort", in: ["number"] }, ["label"])],
    outputs: [report("Listed", "1.0", Listed)],
    errors: [],
    examples: ["acme member list core --json"],
  },
  () => Effect.succeed({ numbers: [] }),
);

/** A command no listing names (the tool starts it itself), which still runs. */
const memberAudit = defineCommand(
  {
    path: ["member", "audit"],
    summary: "Audit the roster",
    effect: { kind: "read" },
    input: Schema.Struct({
      mine: switchOption("Mine"),
      everyone: switchOption("Everyone"),
    }),
    constraints: [atLeastOne(["mine", "everyone"])],
    outputs: [report("Listed", "1.0", Listed)],
    errors: [],
    examples: ["acme member audit --mine --json"],
  },
  () => Effect.succeed({ numbers: [] }),
);

const status = defineCommand(
  {
    path: ["status"],
    summary: "Show the roster's state",
    effect: { kind: "read" },
    input: Schema.Struct({}),
    outputs: [report("Listed", "1.0", Listed)],
    errors: [],
    examples: ["acme status --json"],
  },
  () => Effect.succeed({ numbers: [] }),
);

/** The commands as acme describes them under `profile`, `member list` with `--input` too. */
const describedAs = (profile: ToolProfile): ReadonlyArray<CommandDescription> =>
  [memberShow, memberTag, memberPurge, memberList, memberAudit, status].map((command) => {
    const described = toolDescription(command.description, profile);
    return command === memberList
      ? { ...described, options: [...described.options, inputOption("The arguments")] }
      : described;
  });

const COMMANDS: ReadonlyArray<CommandDescription> = describedAs(ACME);

const PROFILE = parserProfile({
  name: "acme",
  listed: (command) => command.path.join(" ") !== "member audit",
  legacy: {
    removedCommand: (words) =>
      words.join(" ") === "member drop"
        ? {
            message: "acme member drop was removed: use acme member purge",
            received: "member drop",
            expected: ["acme member purge"],
            hint: "acme schema member purge --json",
          }
        : undefined,
    unknownCommand: (words) =>
      words[0] === "roster.sh"
        ? {
            message: "roster.sh was a script; acme member list replaces it",
            received: "roster.sh",
            expected: ["acme member list"],
            hint: "acme schema member list --json",
          }
        : undefined,
    renamedOption: (name) => (name === "who" ? "by" : undefined),
    movedOperands: (command) => (command.path.join(" ") === "member tag" ? "tag" : undefined),
  },
});

const line = (argv: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  parseCommandLine(PROFILE, COMMANDS, argv, env);

const invoked = (argv: ReadonlyArray<string>, env: Record<string, string> = {}): ParsedCommand => {
  const result = line(argv, env);
  if (Result.isFailure(result) || result.success.kind !== "invoke")
    throw new Error(`not invoked: ${JSON.stringify(result)}`);
  return result.success.parsed;
};

const refused = (argv: ReadonlyArray<string>, env: Record<string, string> = {}) => {
  const result = line(argv, env);
  if (Result.isSuccess(result)) throw new Error(`accepted ${argv.join(" ")}`);
  return result.failure;
};

const described = (path: string): CommandDescription => {
  const found = COMMANDS.find((command) => command.path.join(" ") === path);
  if (found === undefined) throw new Error(`no ${path}`);
  return found;
};

const LIST_FLAGS = [
  "--sort",
  "--label",
  "--limit",
  "--ratio",
  "--where",
  "--verbose",
  "--json",
  "--input",
  "--help",
  "--version",
];

describe("the command path", () => {
  test("a bare tool, or one with --json first, is COMMAND_REQUIRED listing the listed top words", () => {
    for (const argv of [[], ["--json"]])
      expect(refused(argv)).toEqual({
        refusal: {
          code: "COMMAND_REQUIRED",
          message: "acme needs a command",
          hint: "acme schema --json",
          expected: ["member", "status"],
        },
      });
  });

  test("an option before the path is OPTION_INVALID naming the global options", () => {
    expect(refused(["--repo", "."]).refusal).toEqual({
      code: "OPTION_INVALID",
      message: "--repo: before the command acme takes only --help, -h, --version and -V",
      field: "--repo",
      received: "--repo",
      hint: "acme schema --json",
      expected: ["--help", "-h", "--version", "-V"],
    });
  });

  test("a group without a command is COMMAND_REQUIRED listing its listed commands", () => {
    for (const argv of [["member"], ["member", "--json"]])
      expect(refused(argv).refusal).toEqual({
        code: "COMMAND_REQUIRED",
        message: "acme member is a group; add one of its commands",
        field: "command",
        hint: "acme schema member --json",
        expected: ["show", "tag", "purge", "list"],
      });
  });

  test("an unknown command suggests near ones, a destructive one only within one edit", () => {
    expect(refused(["member", "tga"]).refusal).toEqual({
      code: "UNKNOWN_COMMAND",
      message: "acme member has no command tga",
      field: "command",
      received: "tga",
      hint: "acme schema member --json",
      expected: ["show", "tag", "purge", "list"],
      suggestions: ["member tag"],
    });
    // purge is two edits from prg: a destructive command is never suggested that far, tag is
    expect(refused(["member", "prge"]).refusal.suggestions).toEqual(["member purge"]);
    expect(refused(["member", "prg"]).refusal.suggestions).toEqual(["member tag"]);
    expect(refused(["membr"]).refusal).toEqual({
      code: "UNKNOWN_COMMAND",
      message: "acme has no command membr",
      field: "command",
      received: "membr",
      hint: "acme schema --json",
      expected: ["member", "status"],
      suggestions: ["member"],
    });
    // an unlisted command still runs
    expect(invoked(["member", "audit", "--mine"]).command.path).toEqual(["member", "audit"]);
  });

  test("a removed command and an old script are refused in the tool's words, the hint their replacement", () => {
    expect(refused(["member", "drop", "7"]).refusal).toEqual({
      code: "UNKNOWN_COMMAND",
      message: "acme member drop was removed: use acme member purge",
      field: "command",
      received: "member drop",
      hint: "acme schema member purge --json",
      expected: ["acme member purge"],
    });
    expect(refused(["roster.sh", "list"]).refusal).toMatchObject({
      code: "UNKNOWN_COMMAND",
      field: "command",
      received: "roster.sh",
      hint: "acme schema member list --json",
    });
  });

  test("--help and --version answer wherever an option stands, never as a value or after --", () => {
    expect(line(["-V"])).toEqual(Result.succeed({ kind: "version" }));
    expect(line(["--help"])).toEqual(Result.succeed({ kind: "help" }));
    expect(line(["member", "-h"])).toEqual(Result.succeed({ kind: "help", group: "member" }));
    expect(line(["member", "--version"])).toEqual(Result.succeed({ kind: "version" }));
    expect(line(["member", "tag", "7", "--bogus", "--help"])).toEqual(
      Result.succeed({ kind: "help", command: described("member tag") }),
    );
    expect(invoked(["member", "tag", "7", "--tag", "core", "--note", "-V"]).options["note"]).toBe(
      "-V",
    );
    expect(invoked(["member", "list", "-l", "-h"]).options["label"]).toEqual(["-h"]);
    expect(invoked(["member", "list", "--", "--help"]).operands).toEqual(["--help"]);
  });
});

describe("options and operands", () => {
  test("the long, joined, short and -- forms, repeatables in order, counts by occurrence, the environment", () => {
    const parsed = invoked(
      [
        "member",
        "list",
        "core",
        "--label",
        "a",
        "-l",
        "b",
        "--label=",
        "-v",
        "--verbose",
        "--sort=name",
        "--",
        "-ops",
      ],
      { ACME_LIMIT: "50" },
    );
    expect(parsed).toEqual({
      command: described("member list"),
      operands: ["core", "-ops"],
      options: { label: ["a", "b", ""], verbose: "2", sort: "name", limit: "50" },
      fromEnv: ["limit"],
    });
    // a given value wins over the environment, and an empty variable is unset
    expect(invoked(["member", "list", "--limit", "5"], { ACME_LIMIT: "50" }).options).toEqual({
      limit: "5",
    });
    expect(invoked(["member", "list"], { ACME_LIMIT: "" }).fromEnv).toEqual([]);
    // a negative number is an operand, `-` is one
    expect(invoked(["member", "list", "-5", "-"]).operands).toEqual(["-5", "-"]);
  });

  test("an unknown option, a renamed one, a short one not declared", () => {
    expect(refused(["member", "list", "--labl", "x"]).refusal).toEqual({
      code: "OPTION_INVALID",
      message: "acme member list has no option --labl",
      field: "--labl",
      received: "--labl",
      hint: "acme schema member list --json",
      expected: LIST_FLAGS,
      suggestions: ["--label"],
    });
    expect(
      refused(["member", "tag", "7", "--tag", "core", "--who=ann", "--json"]).refusal,
    ).toMatchObject({
      code: "OPTION_INVALID",
      message: "--who was renamed --by",
      field: "--who",
      hint: "acme member tag 7 --tag core --by=ann --json",
      suggestions: ["--by"],
    });
    // a renamed spelling on a command without the new name is just unknown
    expect(refused(["member", "show", "7", "--who", "ann"]).refusal.message).toBe(
      "acme member show has no option --who",
    );
    expect(refused(["member", "list", "-x"]).refusal).toEqual({
      code: "OPTION_INVALID",
      message: "-x: acme uses long options only (besides -h, -V, -l and -v)",
      field: "-x",
      received: "-x",
      hint: "acme schema member list --json",
      expected: LIST_FLAGS,
    });
  });

  test("a switch or count with a value, a missing value, a value outside the possible ones, an option twice", () => {
    expect(refused(["member", "list", "--verbose=2"]).refusal).toEqual({
      code: "OPTION_VALUE_INVALID",
      message: "--verbose is a count and takes no value",
      field: "--verbose",
      received: "2",
      hint: "acme schema member list --json",
    });
    expect(refused(["member", "show", "7", "--with-tags=yes"]).refusal.message).toBe(
      "--with-tags is a switch and takes no value",
    );
    expect(refused(["member", "list", "--sort"]).refusal).toEqual({
      code: "OPTION_VALUE_REQUIRED",
      message: "--sort requires a value <KEY>",
      field: "--sort",
      hint: "acme member list core --json",
      expected: ["<KEY>"],
    });
    expect(refused(["member", "list", "--sort", "--json"]).refusal.message).toBe(
      "--sort requires a value <KEY> (the next word --json is an option; quote the value or use --sort=VALUE)",
    );
    expect(refused(["member", "list", "--sort", "nmae"]).refusal).toEqual({
      code: "OPTION_VALUE_INVALID",
      message: "--sort must be one of name, number",
      field: "--sort",
      received: "nmae",
      hint: "acme schema member list --json",
      expected: ["name", "number"],
      suggestions: ["name"],
    });
    expect(refused(["member", "list", "--sort", "name", "--sort", "name"]).refusal).toEqual({
      code: "OPTION_CONFLICT",
      message: "--sort was given twice",
      field: "--sort",
      hint: "acme schema member list --json",
    });
  });

  test("an unknown option and a missing operand keep their names for a tool that declares 1.2 or 1.1, and are OPTION_INVALID and OPERAND_REQUIRED from 1.3 (spec 7.3.2)", () => {
    const codes = (contractVersion: "1.1" | "1.2" | "1.3") => {
      const profile = parserProfile({ name: "acme", contractVersion });
      const commands = describedAs({ ...ACME, contractVersion });
      return [
        ["member", "list", "--labl", "x"],
        ["member", "show"],
      ].map((argv) => {
        const result = parseCommandLine(profile, commands, argv, {});
        return Result.isFailure(result) ? result.failure.refusal.code : "accepted";
      });
    };
    expect(codes("1.1")).toEqual(["UNKNOWN_OPTION", "OPERAND_MISSING"]);
    expect(codes("1.2")).toEqual(["UNKNOWN_OPTION", "OPERAND_MISSING"]);
    expect(codes("1.3")).toEqual(["OPTION_INVALID", "OPERAND_REQUIRED"]);
  });

  test("a missing operand, too many, values that became an option, a missing option", () => {
    expect(refused(["member", "show"])).toEqual({
      refusal: {
        code: "OPERAND_REQUIRED",
        message: "acme member show needs <NUMBER>",
        field: "number",
        hint: "acme member show 7 --with-tags --json",
        expected: ["<NUMBER>"],
      },
      command: described("member show"),
    });
    expect(refused(["member", "show", "7", "8"]).refusal).toEqual({
      code: "OPERAND_INVALID",
      message: "acme member show takes 1 operand(s); got 2",
      field: "operands",
      received: "8",
      hint: "acme member show 7 --with-tags --json",
    });
    expect(refused(["member", "tag", "7", "core", "lead", "--quiet"]).refusal).toEqual({
      code: "USAGE",
      message: "acme member tag takes these values with --tag, once per value",
      field: "operands",
      received: "core lead",
      hint: "acme member tag 7 --tag core --tag lead --quiet",
    });
    expect(refused(["member", "tag", "7"]).refusal).toEqual({
      code: "OPTION_REQUIRED",
      message: "acme member tag needs --tag <TAG>",
      field: "--tag",
      hint: "acme member tag 7 --tag core --json",
    });
  });

  test("an environment value outside the possible values names the variable", () => {
    const list = described("member list");
    const sorted: CommandDescription = {
      ...list,
      options: list.options.map((option) =>
        option.name === "sort" ? { ...option, env: "ACME_SORT" } : option,
      ),
    };
    const result = parseCommandLine(PROFILE, [sorted], ["member", "list"], { ACME_SORT: "age" });
    expect(Result.isFailure(result) && result.failure.refusal).toMatchObject({
      code: "OPTION_VALUE_INVALID",
      field: "ACME_SORT",
      received: "age",
    });
  });
});

describe("types, domains and constraints", () => {
  test("a value outside its type or domain is refused with the command's arguments as hint", () => {
    const value = (argv: ReadonlyArray<string>) => refused(["member", "list", ...argv]).refusal;
    expect(value(["--limit", "x"])).toEqual({
      code: "OPTION_VALUE_INVALID",
      message: "--limit must be an integer",
      field: "--limit",
      received: "x",
      hint: "acme schema member list --json",
    });
    expect(value(["--limit", "9007199254740993"]).message).toBe(
      "--limit is outside ±(2^53-1): acme never rounds an integer",
    );
    expect(value(["--limit", "0"]).message).toBe("--limit must be at least 1");
    expect(value(["--limit", "101"]).message).toBe("--limit must be at most 100");
    expect(value(["--ratio", "1e"]).message).toBe("--ratio must be a number");
    expect(invoked(["member", "list", "--ratio", "1.5e2"]).options["ratio"]).toBe("1.5e2");
    expect(refused(["member", "list"], { ACME_LIMIT: "500" }).refusal.field).toBe("--limit");
    expect(invoked(["member", "list", "--where", '{"a":null}']).options["where"]).toBe(
      '{"a":null}',
    );
    expect(value(["--where=null"]).field).toBe("--where");
    expect(refused(["member", "show", "0"]).refusal).toEqual({
      code: "OPERAND_INVALID",
      message: "number must be at least 1",
      field: "number",
      received: "0",
      hint: "acme schema member show --json",
    });
    expect(refused(["member", "tag", "7", "--tag", "Core"]).refusal.message).toBe(
      "--tag must be matching ^[a-z][a-z0-9-]*$",
    );
    expect(
      refused(["member", "tag", "7", "--tag", "core", "--by", "a".repeat(255)]).refusal.message,
    ).toBe("--by must be at most 254 characters");
  });

  test("every constraint kind, with its declared code; an environment value is not given", () => {
    expect(
      refused(["member", "tag", "7", "--tag", "core", "--expires", "2026-12-01"]).refusal,
    ).toEqual({
      code: "NOTE_REQUIRED",
      message: "--expires needs --note",
      field: "--note",
      hint: "acme schema member tag --json",
    });
    expect(
      refused(["member", "tag", "7", "--tag", "core", "--quiet", "--verbose"]).refusal,
    ).toEqual({
      code: "USAGE",
      message: "at most one of --quiet, --verbose can be given",
      field: "--quiet",
      hint: "acme schema member tag --json",
    });
    expect(refused(["member", "list", "--sort", "number", "-l", "x"]).refusal.message).toBe(
      "--sort number cannot be used with --label",
    );
    expect(invoked(["member", "list", "--sort", "name", "-l", "x"]).options["sort"]).toBe("name");
    expect(refused(["member", "audit"]).refusal).toEqual({
      code: "USAGE",
      message: "one of --mine, --everyone is required",
      field: "--mine",
      hint: "acme schema member audit --json",
    });
    // exactlyOne: two of its names given, or none
    const exactly: CommandDescription = {
      ...described("member audit"),
      constraints: [{ rule: "exactlyOne", names: ["mine", "everyone"] }],
    };
    const audit = (argv: ReadonlyArray<string>) =>
      parseCommandLine(PROFILE, [exactly], ["member", "audit", ...argv], {});
    expect(audit(["--mine", "--everyone"])).toMatchObject(
      Result.fail({
        refusal: {
          code: "USAGE",
          message: "at most one of --mine, --everyone can be given",
          field: "--mine",
        },
      }),
    );
    expect(audit([])).toMatchObject(
      Result.fail({
        refusal: {
          code: "USAGE",
          message: "one of --mine, --everyone is required",
          field: "--mine",
        },
      }),
    );
    expect(Result.isSuccess(audit(["--everyone"]))).toBe(true);
    // an `in` value that is no string holds for the value as argv writes it (`5`)
    const fiveForbidsLabel: CommandDescription = {
      ...described("member list"),
      constraints: [{ rule: "forbids", if: { name: "limit", in: [5] }, needs: ["label"] }],
    };
    const list = (argv: ReadonlyArray<string>) =>
      parseCommandLine(PROFILE, [fiveForbidsLabel], ["member", "list", ...argv], {});
    expect(list(["--limit", "5", "-l", "x"])).toMatchObject(
      Result.fail({
        refusal: {
          code: "USAGE",
          message: "--limit 5 cannot be used with --label",
          field: "--label",
        },
      }),
    );
    expect(Result.isSuccess(list(["--limit", "6", "-l", "x"]))).toBe(true);
    // a value from the environment does not make its option given (spec 9.8.1)
    const tag = described("member tag");
    const byNeedsNote: CommandDescription = {
      ...tag,
      constraints: [{ rule: "requires", if: { name: "by" }, needs: ["note"] }],
    };
    const withBy = (argv: ReadonlyArray<string>) =>
      parseCommandLine(PROFILE, [byNeedsNote], ["member", "tag", "7", "--tag", "core", ...argv], {
        ACME_USER: "ann",
      });
    expect(Result.isSuccess(withBy([]))).toBe(true);
    expect(withBy(["--by", "bob"])).toMatchObject(
      Result.fail({ refusal: { code: "USAGE", message: "--by needs --note", field: "--note" } }),
    );
    // with --input every requirement waits for the merge
    expect(invoked(["member", "tag", "--input", "{}"]).options).toEqual({ input: "{}" });
  });
});

describe("--input", () => {
  // the commands as a tool that declares 1.1 describes them, so --limit is a document key (flag-only since 1.2: "flag-only
  // keys since 1.2"); the parser profile stays the same
  const COMMANDS_11 = describedAs({ ...ACME, contractVersion: "1.1" });
  const described = (path: string): CommandDescription => {
    const found = COMMANDS_11.find((command) => command.path.join(" ") === path);
    if (found === undefined) throw new Error(`no ${path}`);
    return found;
  };
  const invoked = (argv: ReadonlyArray<string>, env: Record<string, string> = {}) => {
    const result = parseCommandLine(PROFILE, COMMANDS_11, argv, env);
    if (Result.isFailure(result) || result.success.kind !== "invoke")
      throw new Error(`not invoked: ${JSON.stringify(result)}`);
    return result.success.parsed;
  };
  const tag = described("member tag");
  const list = described("member list");
  const document = (command: CommandDescription, value: unknown) =>
    inputArgv(PROFILE, command, value);
  const merged = (
    argv: ReadonlyArray<string>,
    value: unknown,
    env: Record<string, string> = {},
  ) => {
    const parsed = invoked(argv, env);
    const words = document(parsed.command, value);
    if (Result.isFailure(words)) throw new Error(JSON.stringify(words.failure));
    return mergeInput(PROFILE, parsed, words.success, env);
  };

  test("a document becomes argv in the forms of spec 4.2", () => {
    expect(
      document(list, {
        operands: ["core", "-ops"],
        label: ["a", "-b"],
        limit: 5,
        ratio: "0.5",
        where: { a: [1, null] },
        verbose: 2,
        sort: "name",
      }),
    ).toEqual(
      Result.succeed([
        "--label=a",
        "--label=-b",
        "--limit=5",
        "--ratio=0.5",
        '--where={"a":[1,null]}',
        "--verbose",
        "--verbose",
        "--sort=name",
        "--",
        "core",
        "-ops",
      ]),
    );
    expect(document(tag, { quiet: false, note: "x" })).toEqual(Result.succeed(["--note=x"]));
  });

  test("a batch, a non-object and every bad key or value are INPUT_INVALID at their pointer, each in details", () => {
    expect(document(tag, [{}])).toEqual(
      Result.fail({
        code: "INPUT_INVALID",
        message: "acme member tag takes one JSON object in --input, not a batch",
        field: "--input",
        reason: "BATCH_UNSUPPORTED",
        hint: "acme member tag 7 --tag core --json",
      }),
    );
    expect(document(tag, "x")).toMatchObject(
      Result.fail({ code: "INPUT_INVALID", reason: "NOT_OBJECT", field: "--input" }),
    );
    const all = document(list, {
      operands: [null],
      json: true,
      lable: ["a"],
      sort: null,
      verbose: "2",
      limit: 1.5,
      label: ["a", 7],
      ratio: "x",
    });
    if (Result.isSuccess(all)) throw new Error("accepted");
    const problems = all.failure.details ?? [];
    expect(problems.map((problem) => [problem.field, problem.reason])).toEqual([
      ["/operands/0", "INVALID_VALUE"],
      ["/json", "FLAG_ONLY_KEY"],
      ["/lable", "UNKNOWN_KEY"],
      ["/sort", "INVALID_VALUE"],
      ["/verbose", "INVALID_VALUE"],
      ["/limit", "INVALID_VALUE"],
      ["/label/1", "INVALID_VALUE"],
      ["/ratio", "INVALID_VALUE"],
    ]);
    expect(all.failure).toMatchObject({
      field: "/operands/0",
      message: "operands/0 must be a string, not null",
    });
    expect(problems[1]?.message).toBe(
      "--input cannot hold json: --json is given on the command line only",
    );
    expect(problems[2]).toMatchObject({
      message: "--input has an unknown key lable",
      suggestions: ["label"],
      expected: ["operands", "sort", "label", "limit", "ratio", "where", "verbose"],
    });
    expect(problems[3]?.message).toBe("sort is null; omit the key instead");
    expect(problems[4]?.message).toBe("verbose is a count: a non-negative integer");
    expect(problems[5]).toMatchObject({
      message: "limit must be an integer (or its string), not number (--limit <N>)",
      expected: ["<N>"],
    });
    expect(problems[6]?.message).toBe(
      "label must be a string (or an array of them), not number (--label <LABEL>)",
    );
    expect(document(list, { sort: "nmae" })).toMatchObject(
      Result.fail({ field: "/sort", reason: "INVALID_VALUE", suggestions: ["name"] }),
    );
    expect(document(list, { operands: [] })).toMatchObject(
      Result.fail({
        field: "/operands",
        message: "operands must be a non-empty array of the operands' values",
      }),
    );
    expect(document(tag, { quiet: "yes" })).toMatchObject(
      Result.fail({ field: "/quiet", message: "quiet is a switch: true or false" }),
    );
  });

  test("argv and the document merge; a disagreement is INPUT_CONFLICT; refusals name the document's keys", () => {
    const result = merged(["member", "tag", "--input", "{}", "--quiet"], {
      operands: [7],
      tag: "core",
      quiet: true,
    });
    expect(result).toEqual(
      Result.succeed({
        command: tag,
        operands: ["7"],
        options: { tag: "core", quiet: true },
        fromEnv: [],
        fromInput: ["tag", "operands"],
      }),
    );
    expect(
      merged(["member", "tag", "7", "--input", "{}", "--tag", "lead"], { tag: "core" }),
    ).toEqual(
      Result.fail({
        refusal: {
          code: "INPUT_CONFLICT",
          message: "--tag and the --input key tag disagree",
          field: "/tag",
          hint: "acme schema member tag --json",
        },
        command: tag,
      }),
    );
    expect(merged(["member", "tag", "7", "--input", "{}"], { operands: [8], tag: "core" })).toEqual(
      Result.fail({
        refusal: {
          code: "INPUT_CONFLICT",
          message: "the operands on the command line and in --input differ",
          field: "/operands",
        },
        command: tag,
      }),
    );
    // a value from the document is refused at its pointer, one from argv at its flag
    expect(
      merged(["member", "tag", "--input", "{}"], { operands: ["0"], tag: "core" }),
    ).toMatchObject(Result.fail({ refusal: { code: "OPERAND_INVALID", field: "/operands/0" } }));
    expect(
      merged(["member", "list", "--input", "{}"], { operands: ["a"], limit: 0 }),
    ).toMatchObject(Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "/limit" } }));
    // the environment is no explicit argument: it never conflicts
    expect(
      merged(["member", "list", "--input", "{}"], { limit: 5 }, { ACME_LIMIT: "50" }),
    ).toMatchObject(Result.succeed({ options: { limit: "5" }, fromEnv: [], fromInput: ["limit"] }));
  });

  test("the environment applies after the merge, to options neither source gives (spec 10.7 steps 3, 5)", () => {
    // step 3 extracts argv without the environment: an invalid variable is not read yet
    expect(invoked(["member", "list", "--input", "{}"], { ACME_LIMIT: "0" })).toMatchObject({
      options: { input: "{}" },
      fromEnv: [],
    });
    // the document gives --limit, so ACME_LIMIT=0 (outside 1..100) never applies
    expect(
      merged(["member", "list", "--input", "{}"], { limit: 5 }, { ACME_LIMIT: "0" }),
    ).toMatchObject(Result.succeed({ options: { limit: "5" }, fromEnv: [], fromInput: ["limit"] }));
    // an option absent from both takes the variable, and an invalid one is refused as without --input
    expect(merged(["member", "list", "--input", "{}"], {}, { ACME_LIMIT: "50" })).toMatchObject(
      Result.succeed({ options: { limit: "50" }, fromEnv: ["limit"], fromInput: [] }),
    );
    expect(merged(["member", "list", "--input", "{}"], {}, { ACME_LIMIT: "0" })).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_VALUE_INVALID", field: "--limit" } }),
    );
    expect(refused(["member", "list"], { ACME_LIMIT: "0" }).refusal).toMatchObject({
      code: "OPTION_VALUE_INVALID",
      field: "--limit",
    });
  });

  test("argv and the document are compared as normalised values (spec 10.7 step 3)", () => {
    const accepted = (argv: ReadonlyArray<string>, value: unknown) =>
      expect(Result.isSuccess(merged(["member", "list", "--input", "{}", ...argv], value))).toBe(
        true,
      );
    const conflict = (argv: ReadonlyArray<string>, value: unknown, field: string) =>
      expect(merged(["member", "list", "--input", "{}", ...argv], value)).toMatchObject(
        Result.fail({ refusal: { code: "INPUT_CONFLICT", field } }),
      );
    // one value spelled two ways: a json value's member order, -0 and 0, 1.0 and 1, a number's string
    accepted(["--where", '{"b":[1,{"d":2,"c":3}],"a":1}'], {
      where: { a: 1, b: [1, { c: 3, d: 2 }] },
    });
    accepted(["--where", "-0"], { where: 0 });
    accepted(["--where", "1.0"], { where: 1 });
    accepted(["--ratio", "-0"], { ratio: 0 });
    accepted(["--ratio", "1.0"], { ratio: 1 });
    accepted(["--ratio=1"], { ratio: "1.0" });
    accepted(["--limit", "5"], { limit: "5" });
    accepted(["-v", "-v"], { verbose: 2 });
    // different values still conflict: a scalar is never an array, an array keeps its order, a string is no number
    conflict(["--where", "[1]"], { where: 1 }, "/where");
    conflict(["--where", '{"a":1}'], { where: { a: "1" } }, "/where");
    conflict(["--ratio", "1.5"], { ratio: 1 }, "/ratio");
    conflict(["-l", "a", "-l", "b"], { label: ["b", "a"] }, "/label");
    conflict(["--", "core"], { operands: ["ops"] }, "/operands");
  });

  test("an argument missing from both sources is named by its document pointer (spec 10.8)", () => {
    expect(merged(["member", "tag", "--input", "{}"], { operands: ["7"] })).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_REQUIRED", field: "/tag" } }),
    );
    expect(merged(["member", "tag", "--input", "{}"], { tag: "core" })).toMatchObject(
      Result.fail({ refusal: { code: "OPERAND_REQUIRED", field: "/operands/0" } }),
    );
    // a constraint's needed argument, missing from both
    expect(
      merged(["member", "tag", "7", "--input", "{}", "--tag", "core"], { expires: "2026-12-01" }),
    ).toMatchObject(Result.fail({ refusal: { code: "NOTE_REQUIRED", field: "/note" } }));
    // a value given on argv keeps its flag, one from the document its pointer (the first given name, spec 9.8.1)
    const tagged = ["member", "tag", "7", "--input", "{}", "--tag", "core"];
    expect(merged([...tagged, "--verbose"], { quiet: true })).toMatchObject(
      Result.fail({ refusal: { code: "USAGE", field: "/quiet" } }),
    );
    expect(merged([...tagged, "--quiet"], { verbose: true })).toMatchObject(
      Result.fail({ refusal: { code: "USAGE", field: "--quiet" } }),
    );
    // without --input, the argv argument
    expect(refused(["member", "tag", "7"]).refusal.field).toBe("--tag");
    // a constraint refusal names an operand as `<name>`: it is pointed at too (review 1 note 2)
    expect(documentField(tag, ["operands"], "<number>")).toBe("/operands/0");
  });

  test("document argv the parser refuses is pointed at its key", () => {
    const parsed = invoked(["member", "tag", "7", "--input", "{}"]);
    expect(mergeInput(PROFILE, parsed, ["--tagz=core"], {})).toMatchObject(
      Result.fail({
        refusal: { code: "INPUT_INVALID", reason: "UNKNOWN_KEY", field: "/tagz" },
      }),
    );
    expect(mergeInput(PROFILE, parsed, ["--by=x", "--by=y"], {})).toMatchObject(
      Result.fail({ refusal: { code: "OPTION_CONFLICT", field: "/by" } }),
    );
  });

  test("documentField writes a field as the document's pointer only when the document gave the value", () => {
    expect(documentField(list, ["limit"], "--limit")).toBe("/limit");
    expect(documentField(list, ["limit"], "--sort")).toBe("--sort");
    expect(documentField(list, ["operands"], "team")).toBe("/operands");
    expect(documentField(tag, ["operands"], "number")).toBe("/operands/0");
    expect(documentField(tag, ["operands"], "operands")).toBe("/operands");
    expect(documentField(tag, [], "--tag")).toBe("--tag");
  });
});

describe("flag-only keys since 1.2 (spec 10.6)", () => {
  test("a 1.2 tool refuses limit, cursor, all and fields as document keys, INPUT_INVALID at the key", () => {
    const pager = defineCommand(
      {
        path: ["member", "page"],
        summary: "Page the roster",
        effect: { kind: "write", idempotency: "replay-safe" },
        input: Schema.Struct({
          limit: defaulted(Schema.Int, 20).annotate({ valueName: "N", description: "Per page" }),
          cursor: Schema.optionalKey(
            Schema.String.annotate({ valueName: "CURSOR", description: "Continue" }),
          ),
          all: switchOption("Every page"),
          fields: Schema.optionalKey(
            Schema.String.annotate({ valueName: "FIELDS", description: "Paths" }),
          ),
          team: Schema.optionalKey(
            Schema.String.annotate({ valueName: "TEAM", description: "A team" }),
          ),
        }),
        outputs: [report("Listed", "1.0", Listed)],
        errors: [],
        examples: ["acme member page --team core --json"],
      },
      () => Effect.succeed({ numbers: [] }),
    );
    const as = (contractVersion: "1.1" | "1.2" | "1.3") =>
      toolDescription(pager.description, { ...ACME, contractVersion });
    const reserved = ["limit", "cursor", "all", "fields"];
    const flagOnly = (command: CommandDescription) =>
      command.options.filter((option) => option.flagOnly).map((option) => option.name);
    expect(flagOnly(as("1.2"))).toEqual([...reserved, "input", "json"]);
    expect(flagOnly(as("1.3"))).toEqual([...reserved, "input", "json"]);
    expect(flagOnly(as("1.1"))).toEqual(["input", "json"]);
    for (const [key, value] of [
      ["limit", 5],
      ["cursor", "c"],
      ["all", true],
      ["fields", "numbers"],
    ] as const) {
      expect(inputArgv(PROFILE, as("1.2"), { team: "core", [key]: value })).toEqual(
        Result.fail({
          code: "INPUT_INVALID",
          message: `--input cannot hold ${key}: --${key} is given on the command line only`,
          field: `/${key}`,
          received: key,
          reason: "FLAG_ONLY_KEY",
        }),
      );
      // a tool that declares 1.1 keeps them document keys
      expect(Result.isSuccess(inputArgv(PROFILE, as("1.1"), { team: "core", [key]: value }))).toBe(
        true,
      );
    }
    // on argv they stay what they were
    expect(
      Result.isSuccess(
        parseCommandLine(
          PROFILE,
          [as("1.2")],
          ["member", "page", "--limit", "5", "--all", "--fields", "numbers", "--team", "core"],
          {},
        ),
      ),
    ).toBe(true);
  });
});

describe("mistyped words (F6)", () => {
  test("a word that names an object property is refused as any unknown word: command, option, value or document key", () => {
    const list = described("member list");
    for (const word of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(refused([word]).refusal).toMatchObject({ code: "UNKNOWN_COMMAND", field: "command" });
      expect(refused(["member", word]).refusal).toMatchObject({
        code: "UNKNOWN_COMMAND",
        field: "command",
        received: word,
      });
      expect(refused(["member", "list", `--${word}`]).refusal).toMatchObject({
        code: "OPTION_INVALID",
        field: `--${word}`,
      });
      expect(refused(["member", "list", "--sort", word]).refusal).toMatchObject({
        code: "OPTION_VALUE_INVALID",
        received: word,
      });
      // a computed key is the document's own member, as JSON.parse makes it
      expect(inputArgv(PROFILE, list, { [word]: 1 })).toMatchObject(
        Result.fail({ code: "INPUT_INVALID", reason: "UNKNOWN_KEY", field: `/${word}` }),
      );
    }
  });

  test("an invalid json value is refused as not JSON, never as not a number", () => {
    for (const text of ["{bad", "null", "'a'"])
      expect(refused(["member", "list", "--where", text]).refusal).toMatchObject({
        code: "OPTION_VALUE_INVALID",
        message: "--where must be JSON (not null)",
        field: "--where",
        received: text,
      });
    expect(refused(["member", "list", "--ratio", "x"]).refusal.message).toBe(
      "--ratio must be a number",
    );
    expect(refused(["member", "list", "--limit", "x"]).refusal.message).toBe(
      "--limit must be an integer",
    );
  });
});

describe("the default profile", () => {
  test("atip's hints and global options unless the tool gives its own", () => {
    const plain = parserProfile({ name: "acme" });
    expect(plain.globalOptions.map((option) => option.name)).toEqual(["help", "version"]);
    expect(plain.hint.tool).toBe("acme schema --json");
    expect(plain.hint.group("member")).toBe("acme schema member --json");
    expect(plain.hint.command(described("member tag"))).toBe("acme schema member tag --json");
    expect(plain.hint.usage(described("member tag"))).toBe("acme member tag 7 --tag core --json");
    expect(plain.legacy.renamedOption("who")).toBeUndefined();
    expect(plain.listed(described("member audit"))).toBe(true);
  });
});

describe("a tool's parser", () => {
  test("defineTool gives the parser its commands as described, its spellings and its listings read on the declarations", () => {
    // the tool lists by a member of its declarations that its published description drops, as a tool's own `internal` member does
    const tool = defineTool({
      ...ACME_TOOL_DECLARATION,
      profile: {
        ...ACME_TOOL_DECLARATION.profile,
        listed: (command) =>
          command.path.join(" ") !== "member purge" && command.ext["x-acme"] === undefined,
        published: (command) => ({ ...command, ext: { "x-acme": { published: true } } }),
        parser: {
          legacy: { renamedOption: (name) => (name === "who" ? "by" : undefined) },
          hint: { tool: "acme help" },
        },
      },
    });
    // one description per command, the one the documents and the parser read
    expect(tool.descriptions()).toEqual(tool.commands.map(tool.describe));
    expect(tool.descriptions()[2]).toBe(tool.describe(memberTag));
    expect(tool.parser.name).toBe("acme");
    expect(tool.parser.hint.group("member")).toBe("acme schema member --json");
    expect(tool.parse([], {})).toMatchObject(
      Result.fail({
        refusal: {
          code: "COMMAND_REQUIRED",
          hint: "acme help",
          expected: ["schema", "member", "skills"],
        },
      }),
    );
    expect(tool.parse(["member", "prge"], {})).toMatchObject(
      Result.fail({ refusal: { expected: ["show", "tag"], suggestions: [] } }),
    );
    // an unlisted command still runs, with the shared options the tool's profile gives it
    expect(tool.parse(["member", "purge", "7", "--json"], {})).toMatchObject(
      Result.succeed({
        kind: "invoke",
        parsed: { command: tool.describe(memberPurge), options: { json: true } },
      }),
    );
    expect(tool.parse(["member", "purge", "7", "--commit"], {})).toMatchObject(
      Result.fail({
        refusal: { code: "OPTION_CONFLICT", message: "--commit needs --plan-digest" },
      }),
    );
    expect(tool.parse(["member", "tag", "7", "--tag", "core", "--who", "ann"], {})).toMatchObject(
      Result.fail({
        refusal: {
          message: "--who was renamed --by",
          hint: "acme member tag 7 --tag core --by ann",
        },
      }),
    );
  });
});
