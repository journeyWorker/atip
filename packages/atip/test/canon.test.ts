/**
 * canon's `finding close` as approaches/typescript.md §3.1 sketches it, declared with `defineCommand`: its generated
 * command document is the repository's example `examples/schema-command-canon-finding-close.json` (a 1.0 document,
 * read in place), compared after normalising key order. The one part Effect spells differently is the report's JSON
 * Schema, whose rewrite is stated below; atip's input examples of the command decode with its fragment decoder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import {
  atMostOne,
  commandDocument,
  conditionOf,
  decodeDocument,
  defaulted,
  defineCommand,
  defineError,
  forbids,
  inputOption,
  isJsonObject,
  type Json,
  jsonOption,
  operand,
  Path,
  report,
  requires,
  switchOption,
  toolDescription,
  toolProfile,
} from "../src/index.ts";
import { schemaAnswerProblems } from "../src/validate.ts";

const EXAMPLE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "examples",
  "schema-command-canon-finding-close.json",
);

/** One of canon's refusals; their texts are canon's registry's and not part of the command document. */
const refusal = <const Code extends string>(code: Code) =>
  defineError({
    code,
    // canon declares 1.0: a code that ends in no condition gives its row, one that does takes its condition's
    ...(conditionOf(code) === undefined ? { exit: 2, retryable: false } : {}),
    meaning: `canon's ${code}`,
    fix: "See canon schema --errors",
  });

const FindingReasonRequired = refusal("FINDING_REASON_REQUIRED");
const FindingResolutionRevUnexpected = refusal("FINDING_RESOLUTION_REV_UNEXPECTED");
const ERRORS = [
  refusal("CONFIG_MISSING"),
  refusal("CONFIG_UNREADABLE"),
  refusal("FINDING_INVALID_ARGUMENT"),
  refusal("FINDING_NOT_FOUND"),
  FindingReasonRequired,
  FindingResolutionRevUnexpected,
  refusal("FINDING_STAGED"),
  refusal("NO_COMMIT"),
  refusal("OLD_LAYOUT"),
  refusal("PROMOTE_FAILED"),
  refusal("REPO_UNREADABLE"),
  refusal("UNKNOWN_ROLE"),
  refusal("WRITE_FAILED"),
] as const;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const FindingCloseReport = Schema.Struct({
  changeId: Schema.String,
  round: Count,
  seq: Count,
  disposition: Schema.String,
  from: Schema.optionalKey(
    Schema.NullOr(Schema.String).annotate({
      description: "The disposition it moved from; absent when unchanged.",
    }),
  ),
  staged: Schema.optionalKey(Schema.NullOr(Schema.String)),
  committed: Schema.optionalKey(Schema.NullOr(Schema.String)),
  unchanged: Schema.Boolean.annotate({
    description:
      "Proposed: moved from canon's meta.unchanged (spec 6.6); the addition bumps the report to 1.1.",
  }),
}).annotate({
  description: "`canon finding close`: the transition staged or committed, or a no-op.",
});

const FindingIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const findingClose = defineCommand(
  {
    path: ["finding", "close"],
    summary:
      "Move an already-committed finding's disposition (promoted in the same run under `write: { promote: auto }` or with --promote; under `write.promote: manual`, commit it with `canon gate promote`)",
    effect: { kind: "write", idempotency: "replay-safe" },
    operands: [
      operand("change", Schema.String, {
        valueName: "CHANGE_ID",
        help: "The change under review — first component of the natural key",
      }),
    ],
    input: Schema.Struct({
      round: FindingIndex.annotate({
        valueName: "N",
        description: "Which review round raised it (1-based)",
      }),
      seq: FindingIndex.annotate({
        valueName: "N",
        description: "Its sequence number within the round (1-based)",
      }),
      disposition: Schema.Literals(["open", "fixed", "rejected", "deferred"]).annotate({
        valueName: "DISPOSITION",
        description:
          "Where it lands: fixed / rejected / deferred / open (reopening is a real transition)",
      }),
      resolutionRev: Schema.optionalKey(
        Schema.String.annotate({
          valueName: "REV",
          description: "The commit that resolves it; only fixed may carry one",
          defaultNote: "HEAD when --disposition is fixed",
        }),
      ),
      reason: Schema.optionalKey(
        Schema.String.annotate({
          valueName: "TEXT",
          description: "Why; required for rejected and deferred",
        }),
      ),
      actor: defaulted(Schema.String, "canon").annotate({
        valueName: "ACTOR_ID",
        description: "The actor recorded as authoring the transition",
      }),
      role: defaulted(Schema.String, "reviewer").annotate({
        valueName: "ROLE",
        description: "The role the record is attributed to",
      }),
      session: Schema.optionalKey(
        Schema.String.annotate({
          valueName: "SESSION_ID",
          description: "The harness session recorded with the actor",
        }),
      ),
      promote: switchOption("Promote this write in the same run"),
      noPromote: switchOption("Keep this write staged even under write: { promote: auto }"),
      repo: Schema.optionalKey(
        Path.annotate({
          valueName: "DIR",
          flagOnly: true,
          defaultNote: "the nearest ancestor directory holding a canon.yaml",
          description: "The repo to act on",
        }),
      ),
      as: Schema.optionalKey(
        Schema.Literals(["planner", "implementer", "reviewer", "orchestrator"]).annotate({
          valueName: "ROLE",
          env: "CANON_ROLE",
          flagOnly: true,
          description: "The role you act as; overrides CANON_ROLE",
        }),
      ),
    }),
    constraints: [
      requires(
        { name: "disposition", in: ["rejected", "deferred"] },
        ["reason"],
        FindingReasonRequired,
      ),
      forbids(
        { name: "disposition", in: ["open", "rejected", "deferred"] },
        ["resolutionRev"],
        FindingResolutionRevUnexpected,
      ),
      atMostOne(["promote", "noPromote"]),
    ],
    outputs: [report("FindingCloseReport", "1.1", FindingCloseReport)],
    errors: ERRORS,
    batch: { maxItems: 10_000, report: "1.0" },
    maxBytes: 8 * 1024 * 1024,
    examples: [
      'canon finding close add-login --round 1 --seq 1 --disposition rejected --reason "works as designed" --json',
      'canon finding close add-login --input \'{"round":1,"seq":2,"disposition":"fixed"}\' --json',
      'canon finding close --input \'{"operands":["add-login"],"round":1,"seq":1,"disposition":"rejected","reason":"works as designed"}\' --json',
      'canon finding close --input \'[{"operands":["add-login"],"round":1,"seq":1,"disposition":"fixed"}]\' --json',
    ],
    ext: { "x-canon": { roles: ["reviewer"] } },
  },
  (args) =>
    Effect.succeed({
      changeId: args.operands[0],
      round: args.round,
      seq: args.seq,
      disposition: args.disposition,
      unchanged: false,
    }),
);

/**
 * canon's choices: its generic codes, its `--input` and `--json` help, and a description on its fragment schemas. The
 * example is a document of an earlier minor (canon declares 1.0), so the profile declares 1.3, the last minor whose
 * command document has that form (spec 15.7).
 */
const CANON = toolProfile({
  name: "canon",
  contractVersion: "1.3",
  genericErrors: [
    "BATCH_INCOMPLETE",
    "INPUT_CONFLICT",
    "INPUT_INVALID",
    "INPUT_TOO_LARGE",
    "INTERNAL",
    "USAGE",
  ],
  sharedOptions: () => [
    inputOption(
      "The arguments as JSON: an object (one run) or an array / NDJSON file or - (a batch); keys are the option names in camelCase, operands an array",
    ),
    jsonOption("Output JSON instead of the human-readable form"),
  ],
  fragment: { description: () => "Fragment schema: no required keys (spec 9.10)." },
});

/** A JSON value with every object's keys sorted: key order is the one thing the comparison ignores. */
const sorted = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, sorted(value[key] ?? null)]),
  );
};

/**
 * Effect 4.1's spelling of two things the example writes otherwise, both the same JSON Schema meaning: a nullable
 * member is `anyOf [X, {type: null}]` (the example: `type: [X, "null"]`), and `Schema.Int` carries its safe range
 * (`maximum: 2^53-1`, spec 9.7.5, Annex V3), which the example leaves implied. This rewrites Effect's spelling to the example's.
 */
const exampleSpelling = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(exampleSpelling);
  if (!isJsonObject(value)) return value;
  const { anyOf, ...rest } = value;
  const [first, second] = Array.isArray(anyOf) ? anyOf : [];
  const nullable =
    first !== undefined &&
    isJsonObject(first) &&
    typeof first["type"] === "string" &&
    Object.keys(first).length === 1 &&
    JSON.stringify(second) === '{"type":"null"}';
  const merged: Record<string, Json> = nullable
    ? { type: [first["type"] ?? null, "null"], ...rest }
    : { ...value };
  if (merged["type"] === "integer" && merged["maximum"] === Number.MAX_SAFE_INTEGER)
    delete merged["maximum"];
  return Object.fromEntries(
    Object.entries(merged).map(([key, item]) => [key, exampleSpelling(item)]),
  );
};

const example = (): Json => {
  const parsed: unknown = JSON.parse(readFileSync(EXAMPLE, "utf8"));
  const data =
    typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : undefined;
  return Schema.decodeUnknownSync(Schema.Json)(data);
};

describe("canon's finding close, declared with defineCommand", () => {
  test("the generated command document is atip's example, key order aside (the report schema in atip's spelling)", () => {
    const generated = commandDocument(findingClose.description, CANON);
    const expected = example();
    if (!isJsonObject(expected)) throw new Error("the example has no data");
    const { schemas: generatedSchemas = {}, ...generatedRest } = generated;
    const { schemas: expectedSchemas = {}, ...expectedRest } = expected;
    expect(sorted(generatedRest)).toEqual(sorted(expectedRest));
    if (!isJsonObject(generatedSchemas) || !isJsonObject(expectedSchemas))
      throw new Error("no schemas");
    const { FindingCloseReport: generatedReport = null, ...generatedOthers } = generatedSchemas;
    const { FindingCloseReport: expectedReport = null, ...expectedOthers } = expectedSchemas;
    // the batch report and the fragment schema: exactly the example's
    expect(sorted(generatedOthers)).toEqual(sorted(expectedOthers));
    // the report: the example's once Effect's spelling of nullable members and safe integers is rewritten
    expect(sorted(exampleSpelling(generatedReport))).toEqual(sorted(expectedReport));
    expect(generatedReport).not.toEqual(expectedReport);
  });

  test("the generated answer is an atip/1 schema answer", () => {
    const document = commandDocument(findingClose.description, CANON);
    const meta = {
      schemaVersion: CANON.contractVersion,
      tool: "canon",
      toolVersion: "0.31.0",
      command: "schema",
      contract: "atip/1",
      contractVersion: CANON.contractVersion,
    };
    expect(schemaAnswerProblems({ ok: true, data: document, meta })).toEqual([]);
  });

  test("atip's input examples of the command decode with its fragment decoder", async () => {
    // the repository's examples/input-canon-finding-close*.json, read in place; the command as canon describes it, so
    // its flag-only options are canon's
    const close = toolDescription(findingClose.description, CANON);
    const input = (suffix: string): unknown =>
      JSON.parse(
        readFileSync(
          join(import.meta.dir, "..", "..", "..", "examples", `input-canon-finding-close${suffix}.json`),
          "utf8",
        ),
      );
    expect(await Effect.runPromiseExit(decodeDocument(close, input("")))).toEqual(
      Exit.succeed({
        operands: ["add-login"],
        round: 1,
        seq: 2,
        disposition: "rejected",
        reason: "works as designed",
      }),
    );
    expect(await Effect.runPromiseExit(decodeDocument(close, input("-numeric")))).toEqual(
      Exit.succeed({ operands: ["add-login"], round: 1, seq: 2, disposition: "fixed" }),
    );
    expect(await Effect.runPromiseExit(decodeDocument(close, input("-fragment")))).toEqual(
      Exit.succeed({ reason: "works as designed" }),
    );
    const batch = input("-batch");
    if (!Array.isArray(batch)) throw new Error("the batch example is no array");
    for (const item of batch)
      expect(Exit.isSuccess(await Effect.runPromiseExit(decodeDocument(close, item)))).toBe(true);
    // a flag-only key is no member of a document (spec 10.6)
    expect(Exit.isFailure(await Effect.runPromiseExit(decodeDocument(close, { repo: "." })))).toBe(
      true,
    );
  });
});
