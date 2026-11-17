/**
 * The core codes by the minor a tool declares (atip/1 1.3: spec 7.3.1, 7.2.3, 8.3.2, 15.7; 1.2's 10.13 rule 14):
 * `STOPPED_MIDWAY` is a core code for a tool that declares exactly 1.2, the tool's own code at 1.1, and no code at 1.3,
 * where a part-way stop is the tool's own `<SUBJECT>_INCOMPLETE`; and the typed defaults `defineCommand` decodes when a
 * command is defined (approaches/typescript.md §3.4), on the example tool `acme` declaring 1.1, 1.2 and 1.3.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result, Schema } from "effect";
import {
  type AnyDefinedError,
  type ContractMinor,
  defaulted,
  defineCommand,
  defineError,
  defineTool,
  report,
  RESERVED,
  RESERVED_REASONS,
  reservedCodes,
  reservedReasons,
} from "../src/index.ts";
import {
  ACME_TOOL_DECLARATION,
  MemberIncomplete,
  MemberNotFound,
  MemberTagged,
  memberTag,
} from "./acme.ts";

/** acme's part-way stop: a later step met MEMBER_NOT_FOUND, or the plan changed between effects. */
const stoppedMidway = (exit: 1 | 2, reasons: Readonly<Record<string, string>>) =>
  defineError({
    code: "STOPPED_MIDWAY",
    exit,
    retryable: false,
    meaning: "The command stopped after a step made effects; error.reason names the refusal",
    fix: "Read what was done first, then act on the reason's fix",
    reasons: Object.fromEntries(
      Object.entries(reasons).map(([reason, meaning]) => [
        reason,
        { meaning, fix: "Read what was done first (acme member show <NUMBER> --json)" },
      ]),
    ),
  });

const STOP = stoppedMidway(1, {
  MEMBER_NOT_FOUND: "A later step found no member",
  PLAN_STALE: "A commit detected, after it made some of the effects, that the plan changed",
});

/** acme's group without a verb (spec 7.3.1). */
const CommandRequired = defineError({
  code: "COMMAND_REQUIRED",
  exit: 2,
  retryable: false,
  meaning: "A group was given without a command",
  fix: "List the group's commands: acme schema <GROUP> --json",
});

/** acme declaring `minor`, with `stop` among its tool-level errors. */
const acmeWith = (minor: ContractMinor, stop: AnyDefinedError) =>
  defineTool({
    ...ACME_TOOL_DECLARATION,
    errors: [...ACME_TOOL_DECLARATION.errors, CommandRequired, MemberNotFound, stop],
    profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion: minor },
  });

describe("STOPPED_MIDWAY is reserved for a tool that declares exactly 1.2 (spec 15.7, 8.3.2)", () => {
  test("the reserved tables by minor: STOPPED_MIDWAY (exit 1, not retryable) and its PLAN_STALE reason at exactly 1.2, the twelve core codes at 1.1 and 1.3", () => {
    for (const minor of ["1.1", "1.3"] as const) {
      expect(reservedCodes(minor)).toEqual(RESERVED);
      expect(Object.hasOwn(reservedCodes(minor), "STOPPED_MIDWAY")).toBe(false);
      expect(reservedReasons(minor)).toEqual(RESERVED_REASONS);
      expect(Object.hasOwn(reservedReasons(minor), "STOPPED_MIDWAY")).toBe(false);
    }
    expect(Object.keys(RESERVED)).toHaveLength(12);
    expect(reservedCodes("1.2")["STOPPED_MIDWAY"]).toEqual({ exit: 1, retryable: false });
    expect(Object.keys(reservedCodes("1.2"))).toHaveLength(13);
    expect(reservedReasons("1.2")["STOPPED_MIDWAY"]).toEqual(["PLAN_STALE"]);
  });

  test("acme declaring 1.2 defines a reserved STOPPED_MIDWAY whose reasons are exit-2 codes", () => {
    const tool = acmeWith("1.2", STOP);
    expect(tool.profile.contractVersion).toBe("1.2");
    const row = tool.errors.find((entry) => entry.code === "STOPPED_MIDWAY");
    expect(row).toMatchObject({ exit: 1, retryable: false });
    expect(row?.reasons?.map((entry) => entry.reason)).toEqual(["MEMBER_NOT_FOUND", "PLAN_STALE"]);
  });

  test("acme declaring 1.2 is refused a STOPPED_MIDWAY without the reserved exit, or with a reason that is no exit-2 code", () => {
    expect(() => acmeWith("1.2", stoppedMidway(2, { MEMBER_NOT_FOUND: "m" }))).toThrow(
      /reserved STOPPED_MIDWAY is registered with exit 2 and retryable false, not 1 and false/,
    );
    // INTERNAL is exit 1 and NOT_A_CODE is not registered: a reason is the stopping refusal's exit-2 code alone
    expect(() =>
      acmeWith("1.2", stoppedMidway(1, { INTERNAL: "m", NOT_A_CODE: "m", MEMBER_NOT_FOUND: "m" })),
    ).toThrow(
      /the STOPPED_MIDWAY reason INTERNAL is not an exit-2 code of the registry \(spec 8\.3\.2\); the STOPPED_MIDWAY reason NOT_A_CODE is not/,
    );
  });

  test("acme declaring 1.1 keeps STOPPED_MIDWAY as a code of its own: any exit and reasons", () => {
    const own = stoppedMidway(2, { INTERNAL: "m" });
    const tool = acmeWith("1.1", own);
    expect(tool.profile.contractVersion).toBe("1.1");
    expect(tool.errors.find((entry) => entry.code === "STOPPED_MIDWAY")).toMatchObject({ exit: 2 });
  });

  test("a core code keeps its reserved exit for every minor", () => {
    const internal = defineError({
      code: "INTERNAL",
      exit: 2,
      retryable: false,
      meaning: "m",
      fix: "f",
    });
    for (const minor of ["1.1", "1.2", "1.3"] as const)
      expect(() =>
        defineTool({
          ...ACME_TOOL_DECLARATION,
          errors: [
            ...ACME_TOOL_DECLARATION.errors.filter((error) => error.code !== "INTERNAL"),
            internal,
          ],
          profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion: minor },
        }),
      ).toThrow(/reserved INTERNAL is registered with exit 2 and retryable false, not 1 and false/);
  });

  test("acme declaring 1.2 keeps a legacy name that ends in no condition, at any exit", () => {
    const legacy = defineError({
      code: "PROMOTE_REFUSED",
      exit: 1,
      retryable: false,
      meaning: "A promotion was refused",
      fix: "Read the refusal",
    });
    const tool = acmeWith("1.2", legacy);
    expect(tool.errors.find((entry) => entry.code === "PROMOTE_REFUSED")).toMatchObject({
      exit: 1,
    });
    expect(() => acmeWith("1.3", legacy)).toThrow(
      /code PROMOTE_REFUSED is neither a core code nor <SUBJECT>_<CONDITION>/,
    );
  });
});

describe("a stop part-way at 1.3 is the tool's own INCOMPLETE code (spec 8.3.2, 7.2.3)", () => {
  test("acme declaring 1.3 holds MEMBER_INCOMPLETE (exit 1, not retryable) whose reasons are exit-2 codes of the registry", () => {
    const tool = acmeWith("1.3", MemberIncomplete);
    expect(tool.profile.contractVersion).toBe("1.3");
    const row = tool.errors.find((entry) => entry.code === "MEMBER_INCOMPLETE");
    expect(row).toMatchObject({ exit: 1, retryable: false });
    expect(row?.reasons?.map((entry) => entry.reason)).toEqual(["MEMBER_NOT_FOUND", "PLAN_STALE"]);
    for (const { reason } of row?.reasons ?? [])
      expect(tool.errors.find((entry) => entry.code === reason)).toMatchObject({ exit: 2 });
  });

  test("acme declaring 1.3 is refused STOPPED_MIDWAY: it ends in no condition", () => {
    expect(() => acmeWith("1.3", STOP)).toThrow(
      /code STOPPED_MIDWAY is neither a core code nor <SUBJECT>_<CONDITION>/,
    );
  });
});

describe("defineCommand decodes {} through every defaulted field when the command is defined (typescript.md §3.4)", () => {
  const tagWith = (by: Schema.Decoder<unknown>) =>
    defineCommand(
      {
        path: ["member", "tag"],
        summary: "Tag a member",
        effect: { kind: "write", idempotency: "replay-safe" },
        input: Schema.Struct({
          tag: Schema.String.annotate({ valueName: "TAG", description: "The tag to add" }),
          by,
        }),
        outputs: [report("MemberTagged", "1.0", MemberTagged)],
        errors: [],
        examples: ["acme member tag --tag core --json"],
      },
      () => Effect.succeed({ number: 7, tags: [], unchanged: true }),
    );

  test("acme's defaulted --by decodes absent to its annotated default, so member tag is defined", () => {
    expect(memberTag.description.options.find((option) => option.name === "by")?.default).toBe(
      "acme",
    );
    const absent = Schema.decodeUnknownResult(memberTag.input)({ tag: "core" });
    expect(Result.isSuccess(absent) ? absent.success : undefined).toMatchObject({ by: "acme" });
    expect(
      tagWith(
        defaulted(Schema.String, "ops").annotate({ valueName: "WHO", description: "Who" }),
      ).description.options.find((option) => option.name === "by")?.default,
    ).toBe("ops");
  });

  test("a default whose decoder requires the key, or yields another value, refuses the definition", () => {
    expect(() =>
      tagWith(Schema.String.annotate({ default: "acme", valueName: "WHO", description: "Who" })),
    ).toThrow(/--by: it is described as optional, but the Struct refuses it absent/);
    expect(() =>
      tagWith(
        Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("ops"))).annotate({
          default: "acme",
          valueName: "WHO",
          description: "Who",
        }),
      ),
    ).toThrow(/--by: absent, it does not decode to its default "acme"/);
  });
});
