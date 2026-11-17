import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  bindCursor,
  commandLine,
  CONTRACT_VERSION,
  ErrorBody,
  FailureEnvelope,
  FieldPath,
  formatFieldPath,
  isJsonMode,
  nextStep,
  nextStepProblem,
  parseFieldPath,
  RESERVED,
  RESERVED_REASONS,
  shellQuote,
  shellSplit,
  splitFieldList,
  SuccessEnvelope,
  unbindCursor,
  withJson,
} from "../src/index.ts";
import { envelopeProblems, registryEntryProblems, warningEntryProblems } from "../src/validate.ts";

/** The package's copy of the schemas (what it publishes) and the specification's own `schema/`. */
const COPY = join(import.meta.dir, "..", "schema");
const SPEC = join(import.meta.dir, "..", "..", "..", "schema");

const schemaFiles = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

describe("the package's schema copy", () => {
  test("is the specification's schema/ directory, byte for byte (run `bun run schema:copy` after a schema edit)", () => {
    expect(CONTRACT_VERSION).toBe("1.6");
    const files = schemaFiles(SPEC);
    expect(files.length).toBeGreaterThan(0);
    expect(schemaFiles(COPY)).toEqual(files);
    for (const file of files)
      expect(readFileSync(join(COPY, file)).equals(readFileSync(join(SPEC, file))), file).toBe(true);
  });
});

describe("field paths (Annex F1, Annex S2 rule 15)", () => {
  test("a non-identifier key is bracketed, an identifier never is, and each path has one spelling", () => {
    const steps = parseFieldPath('attributes["http.status-code"]');
    expect(steps).toEqual(
      Result.succeed([
        { name: "attributes", list: false },
        { name: "http.status-code", list: false },
      ]),
    );
    expect(Result.isSuccess(parseFieldPath('members[].title["a \\" b"][].x'))).toBe(true);
    expect(Result.isSuccess(parseFieldPath('attributes[""]'))).toBe(true);
    expect(Result.isFailure(parseFieldPath('attributes["region"]'))).toBe(true);
    expect(Result.isFailure(parseFieldPath('attributes["open'))).toBe(true);
    expect(Result.isFailure(parseFieldPath('a["x\\n"]'))).toBe(true);
    expect(Result.isFailure(parseFieldPath("a.b-c"))).toBe(true);
    for (const path of [
      'attributes["http.status-code"]',
      'members[].title["a \\" b"][].x',
      'attributes[""]',
      "a.b[]",
    ]) {
      const parsed = parseFieldPath(path);
      expect(Result.isSuccess(parsed) && formatFieldPath(parsed.success)).toBe(path);
      expect(
        envelopeProblems({
          ok: true,
          data: {},
          meta: {
            schemaVersion: "1.0",
            tool: "t",
            toolVersion: "0",
            contract: "atip/1",
            contractVersion: "1.1",
            fields: [path],
          },
        }),
        path,
      ).toEqual([]);
      expect(Schema.is(FieldPath)(path), path).toBe(true);
    }
    expect(splitFieldList('runId, attributes["a,b"],attributes["c"]x,runId')).toEqual([
      "runId",
      'attributes["a,b"]',
      'attributes["c"]x',
    ]);
    expect(splitFieldList('attributes["a')).toBeUndefined();
  });
});

describe("argv", () => {
  const words = [
    "run",
    "list",
    "--filter",
    `{"title":"it's"}`,
    "",
    "a b",
    "$HOME",
    "x;y",
    "--json",
  ];

  test("a command line splits back to the tool and argv (spec 6.8)", () => {
    expect(shellSplit(commandLine("acme", words))).toEqual(["acme", ...words]);
    expect(shellQuote("run")).toBe("run");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("POSIX split handles double quotes and escapes", () => {
    expect(shellSplit(`acme "a \\"b\\"" c\\ d`)).toEqual(["acme", `a "b"`, "c d"]);
    expect(shellSplit(`acme 'open`)).toBeUndefined();
  });

  test("--json goes before --, once", () => {
    expect(withJson(["a", "b"])).toEqual(["a", "b", "--json"]);
    expect(withJson(["a", "--", "x"])).toEqual(["a", "--json", "--", "x"]);
    expect(withJson(["a", "--json"])).toEqual(["a", "--json"]);
    expect(isJsonMode(["a", "--", "--json"])).toBe(false);
  });

  test("next step problems: placeholder, split, missing --json", () => {
    const accepts = () => true;
    expect(
      nextStepProblem("acme", nextStep("acme", ["run", "show", "1", "--json"]), true, accepts),
    ).toBeUndefined();
    expect(
      nextStepProblem("acme", nextStep("acme", ["run", "show", "<RUN_ID>"]), false, accepts),
    ).toContain("placeholder");
    expect(nextStepProblem("acme", nextStep("acme", ["run", "show", "1"]), true, accepts)).toContain(
      "--json",
    );
    expect(
      nextStepProblem("acme", { command: "acme run", argv: ["run", "show"] }, false, accepts),
    ).toContain("split");
  });
});

describe("bound cursors (spec 6.9)", () => {
  // a binding is pagingOf's digest of the invocation (cursor.test.ts); any two differ the same way
  const binding = "0123456789abcdef";

  test("a cursor comes back to the same arguments only", () => {
    const cursor = bindCursor("server-cursor", binding);
    expect(unbindCursor(cursor, binding)).toEqual(Result.succeed("server-cursor"));
    expect(unbindCursor(cursor, "fedcba9876543210")).toEqual(Result.fail("ARGUMENTS_CHANGED"));
    expect(unbindCursor("server-cursor", binding)).toEqual(Result.fail("FOREIGN"));
  });
});

describe("the Effect schemas agree with the package's JSON Schemas", () => {
  const meta = {
    schemaVersion: CONTRACT_VERSION,
    tool: "acme",
    toolVersion: "0.5.0",
    command: "run list",
    contract: "atip/1",
    contractVersion: CONTRACT_VERSION,
    output: "RunList",
    context: { run: "2026.10.31.1" },
    next: [nextStep("acme", ["run", "list", "--cursor", "x", "--json"])],
    warnings: [{ code: "LIST_CAPPED", message: "m" }],
    page: { returned: 1, nextCursor: "x", total: 2 },
    fields: ["runId", 'attributes["http.status-code"]'],
    truncated: { path: "/runs", kept: 1, total: 2, bytes: 10, maxBytes: 5 },
  };
  const success = { ok: true, data: { runs: [] }, meta };
  const failure = {
    ok: false,
    error: {
      code: "INPUT_INVALID",
      reason: "NOT_JSON",
      message: "m",
      retryable: false,
      field: "--input",
      expected: ["a"],
    },
    meta: {
      schemaVersion: "1.0",
      tool: "acme",
      toolVersion: "0.5.0",
      contract: "atip/1",
      contractVersion: CONTRACT_VERSION,
    },
  };

  test("documents the Effect schemas accept are envelopes", () => {
    const decodeSuccess = Schema.decodeUnknownSync(SuccessEnvelope(Schema.Unknown), {
      onExcessProperty: "error",
    });
    const decodeFailure = Schema.decodeUnknownSync(
      FailureEnvelope(ErrorBody(Schema.String, Schema.String, {}), Schema.Unknown),
      {
        onExcessProperty: "error",
      },
    );
    expect<unknown>(decodeSuccess(success)).toEqual(success);
    expect<unknown>(decodeFailure(failure)).toEqual(failure);
    expect(envelopeProblems(success)).toEqual([]);
    expect(envelopeProblems(failure)).toEqual([]);
  });

  test("the JSON Schemas refuse what the contract forbids", () => {
    expect(envelopeProblems({ ...failure, error: { ...failure.error, hint: null } })).not.toEqual(
      [],
    );
    expect(envelopeProblems({ ...success, meta: { ...meta, workDir: "." } })).not.toEqual([]);
    expect(envelopeProblems({ ...success, meta: { ...meta, warnings: ["text"] } })).not.toEqual([]);
    const { contract: _contract, ...unmarked } = meta;
    expect(envelopeProblems({ ...success, meta: unmarked })).not.toEqual([]);
  });

  test("reserved codes are registry entries with their reserved exit, reasons and warnings have their own rows", () => {
    for (const [code, row] of Object.entries(RESERVED))
      expect(registryEntryProblems({ code, ...row, meaning: "m", fix: "f" }), code).toEqual([]);
    expect(Object.keys(RESERVED)).toHaveLength(12);
    expect(
      registryEntryProblems({ code: "X", exit: 3, retryable: false, meaning: "m", fix: "f" }),
    ).not.toEqual([]);
    for (const [code, reasons] of Object.entries(RESERVED_REASONS))
      expect(
        registryEntryProblems({
          code,
          exit: 2,
          retryable: false,
          meaning: "m",
          fix: "f",
          reasons: reasons.map((reason) => ({ reason, meaning: "m", fix: "f" })),
        }),
        code,
      ).toEqual([]);
    expect(warningEntryProblems({ code: "LIST_CAPPED", meaning: "m", fix: "f" })).toEqual([]);
    expect(
      warningEntryProblems({ code: "LIST_CAPPED", exit: 1, meaning: "m", fix: "f" }),
    ).not.toEqual([]);
  });
});
