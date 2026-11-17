/**
 * Cursor binding and the next page (spec 6.9, approaches/typescript.md §3.8) by the minor a tool declares, on acme's
 * `member list`: a 1.1 tool binds the argument object (an explicit default the same as its absence, `--all` and
 * `--json` bound); a 1.2 tool binds every argument but `--json`, `--limit`, `--all`, `--cursor` and `--fields`, each
 * with its source (explicit, `env`, or a default as nothing), and its next page carries exactly the explicit
 * arguments, a document's keys re-expressed as options.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  bindCursor,
  type CommandDescription,
  type ContractMinor,
  count,
  defaulted,
  defineCommand,
  inputArgv,
  inputOption,
  jsonOption,
  mergeInput,
  pagingOf,
  type ParsedCommand,
  parseCommandLine,
  parserProfile,
  report,
  switchOption,
  toolDescription,
  toolProfile,
  unbindCursor,
  type CursorRefusal,
} from "../src/index.ts";

const memberList = defineCommand(
  {
    path: ["member", "list"],
    summary: "List the members",
    effect: { kind: "read" },
    input: Schema.Struct({
      sort: defaulted(Schema.Literals(["name", "-name"]), "name").annotate({
        valueName: "KEY",
        description: "Order",
      }),
      offset: Schema.optionalKey(
        Schema.Int.annotate({ valueName: "N", description: "Start at this member" }),
      ),
      limit: defaulted(Schema.Int, 20).annotate({ valueName: "N", description: "Per page" }),
      cursor: Schema.optionalKey(
        Schema.String.annotate({ valueName: "CURSOR", description: "Continue" }),
      ),
      all: switchOption("Every remaining page"),
      fields: Schema.optionalKey(
        Schema.String.annotate({ valueName: "FIELDS", description: "Only these paths" }),
      ),
      verbose: count("More detail"),
      active: switchOption("Only active members"),
      site: Schema.optionalKey(
        Schema.String.annotate({ valueName: "SITE", description: "The site", env: "ACME_SITE" }),
      ),
      repo: Schema.optionalKey(
        Schema.String.annotate({
          valueName: "REPO",
          description: "The roster's repository (changes the members listed)",
          flagOnly: true,
        }),
      ),
    }),
    outputs: [report("Listed", "1.0", Schema.Struct({ numbers: Schema.Array(Schema.Int) }))],
    errors: [],
    examples: ["acme member list --json"],
  },
  () => Effect.succeed({ numbers: [] }),
);

/** `member list` as acme describes it when it declares `minor`: `--input` and `--json` shared. */
const describedAs = (minor: ContractMinor): CommandDescription =>
  toolDescription(
    memberList.description,
    toolProfile({
      name: "acme",
      genericErrors: [],
      contractVersion: minor,
      sharedOptions: () => [inputOption("The arguments"), jsonOption("One JSON envelope")],
    }),
  );

type Env = Readonly<Record<string, string>>;

/** `acme member list ARGV` in `env`, with the `--input` document when given, as the runner merges it. */
const invoked = (
  minor: ContractMinor,
  argv: ReadonlyArray<string>,
  env: Env = {},
  document?: unknown,
): ParsedCommand => {
  const profile = parserProfile({ name: "acme", contractVersion: minor });
  const command = describedAs(minor);
  const line = parseCommandLine(profile, [command], ["member", "list", ...argv], env);
  if (Result.isFailure(line) || line.success.kind !== "invoke")
    throw new Error(`not invoked: ${JSON.stringify(line)}`);
  if (document === undefined) return line.success.parsed;
  const words = inputArgv(profile, command, document);
  if (Result.isFailure(words)) throw new Error(JSON.stringify(words.failure));
  const merged = mergeInput(profile, line.success.parsed, words.success, env);
  if (Result.isFailure(merged)) throw new Error(JSON.stringify(merged.failure));
  return merged.success;
};

/** Whether a cursor printed by `from` is accepted by `to` (both `[argv, env, document?]`). */
const continues = (
  minor: ContractMinor,
  from: readonly [ReadonlyArray<string>, Env?, unknown?],
  to: readonly [ReadonlyArray<string>, Env?, unknown?],
) => {
  const printed = bindCursor("server-7", pagingOf(minor, invoked(minor, ...from)).binding);
  return unbindCursor(printed, pagingOf(minor, invoked(minor, ...to)).binding);
};
const CONTINUES: Result.Result<string, CursorRefusal> = Result.succeed("server-7");
const CHANGED: Result.Result<string, CursorRefusal> = Result.fail("ARGUMENTS_CHANGED");

describe("cursor binding by the declared minor (spec 6.9)", () => {
  test("1.2: an explicit default is given, so adding or removing it changes the arguments", () => {
    expect(continues("1.2", [["--sort", "name"]], [[]])).toEqual(CHANGED);
    expect(continues("1.2", [[]], [["--sort", "name"]])).toEqual(CHANGED);
    expect(continues("1.2", [["--sort", "name"]], [["--sort=name"]])).toEqual(CONTINUES);
    // the old binding: the argument object, where an explicit default is its absence
    expect(continues("1.1", [["--sort", "name"]], [[]])).toEqual(CONTINUES);
  });

  test("1.2: an env value binds; changing, unsetting or giving it explicitly instead changes the arguments", () => {
    const site = { ACME_SITE: "tokyo" };
    expect(continues("1.2", [[], site], [[], site])).toEqual(CONTINUES);
    expect(continues("1.2", [[], site], [[], { ACME_SITE: "osaka" }])).toEqual(CHANGED);
    expect(continues("1.2", [[], site], [[]])).toEqual(CHANGED);
    expect(continues("1.2", [[], site], [["--site", "tokyo"], site])).toEqual(CHANGED);
    expect(continues("1.2", [["--site", "tokyo"]], [[], site])).toEqual(CHANGED);
    // 1.1 binds the value, not its source
    expect(continues("1.1", [[], site], [["--site", "tokyo"]])).toEqual(CONTINUES);
    expect(continues("1.1", [[], site], [[], { ACME_SITE: "osaka" }])).toEqual(CHANGED);
  });

  test("--offset and the command's options bind, a tool's own flag-only option too", () => {
    for (const minor of ["1.1", "1.2"] as const) {
      expect(continues(minor, [["--offset", "1"]], [["--offset", "2"]])).toEqual(CHANGED);
      expect(continues(minor, [["--offset", "1"]], [[]])).toEqual(CHANGED);
      expect(continues(minor, [["--verbose"]], [[]])).toEqual(CHANGED);
      expect(continues(minor, [["--active"]], [[]])).toEqual(CHANGED);
      expect(continues(minor, [["--repo", "a"]], [["--repo", "b"]])).toEqual(CHANGED);
      expect(continues(minor, [["--offset", "1"]], [["--offset=1"]])).toEqual(CONTINUES);
    }
  });

  test("1.2 binds no --all, --json, --limit or --fields; 1.1 binds --all and --json", () => {
    const paging = ["--all", "--json", "--limit", "5", "--fields", "numbers"];
    expect(continues("1.2", [paging], [[]])).toEqual(CONTINUES);
    expect(continues("1.2", [[]], [paging])).toEqual(CONTINUES);
    expect(continues("1.1", [["--limit", "5", "--fields", "numbers"]], [[]])).toEqual(CONTINUES);
    expect(continues("1.1", [["--all"]], [[]])).toEqual(CHANGED);
    expect(continues("1.1", [["--json"]], [[]])).toEqual(CHANGED);
  });

  test("a switch given false and a count given 0 are absent; a document's keys bind as argv's", () => {
    expect(continues("1.2", [["--input", "{}"], {}, { active: false, verbose: 0 }], [[]])).toEqual(
      CONTINUES,
    );
    expect(
      continues(
        "1.2",
        [["--input", "{}"], {}, { sort: "name", verbose: 2, offset: 1 }],
        [["--sort", "name", "--verbose", "--verbose", "--offset", "1"]],
      ),
    ).toEqual(CONTINUES);
  });
});

describe("the next page (spec 6.9)", () => {
  test("1.2: exactly the explicit arguments and --cursor, never a default or an env value; it continues in the same environment", () => {
    const env = { ACME_SITE: "tokyo" };
    const argv = [
      "--offset",
      "1",
      "--json",
      "--sort",
      "name",
      "--all",
      "--limit",
      "5",
      "--cursor",
      "old",
    ];
    const paging = pagingOf("1.2", invoked("1.2", argv, env));
    const next = paging.next("c-2");
    expect(next).toEqual([
      "member",
      "list",
      "--sort",
      "name",
      "--offset",
      "1",
      "--limit",
      "5",
      "--cursor",
      "c-2",
      "--all",
      "--json",
    ]);
    const again = invoked("1.2", next.slice(2), env);
    expect(unbindCursor(bindCursor("s", paging.binding), pagingOf("1.2", again).binding)).toEqual(
      Result.succeed("s"),
    );
    // the default sort and the env site are left where they came from
    expect(pagingOf("1.2", invoked("1.2", [], env)).next("c")).toEqual([
      "member",
      "list",
      "--cursor",
      "c",
    ]);
  });

  test("an --input document is re-expressed as argv options, never --input", () => {
    const merged = invoked(
      "1.2",
      ["--input", "{}", "--json"],
      {},
      {
        sort: "-name",
        verbose: 2,
        offset: 3,
      },
    );
    expect(pagingOf("1.2", merged).next("c")).toEqual([
      "member",
      "list",
      "--sort=-name",
      "--offset",
      "3",
      "--cursor",
      "c",
      "--verbose",
      "--verbose",
      "--json",
    ]);
  });
});
