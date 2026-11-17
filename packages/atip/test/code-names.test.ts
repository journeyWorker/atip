/**
 * Code names (atip/1 1.3: spec 7.2, 7.3.1; approaches/typescript.md "Code names (1.3)"): the grammar `conditionOf`
 * reads, the exit and retryability `defineError` takes from the condition and the definitions it refuses, and the
 * registries `defineTool` refuses for a tool that declares 1.3.
 */
import { describe, expect, test } from "bun:test";
import {
  type AnyDefinedError,
  CONDITIONS,
  type Condition,
  type ContractMinor,
  codeNameProblems,
  conditionOf,
  defineError,
  defineTool,
  type RegistryEntry,
} from "../src/index.ts";
import { ACME_TOOL_DECLARATION } from "./acme.ts";

const text = { meaning: "m", fix: "f" };

describe("the conditions (spec 7.2.2)", () => {
  test("fifteen conditions: exit 2 and not retryable, but FAILED, INCOMPLETE and TIMEOUT exit 1 and UNAVAILABLE and TIMEOUT retryable", () => {
    expect(Object.keys(CONDITIONS)).toEqual([
      "INVALID",
      "REQUIRED",
      "NOT_FOUND",
      "EXISTS",
      "CONFLICT",
      "STALE",
      "EXPIRED",
      "DENIED",
      "UNSUPPORTED",
      "TOO_LARGE",
      "CORRUPT",
      "UNAVAILABLE",
      "FAILED",
      "INCOMPLETE",
      "TIMEOUT",
    ]);
    for (const [condition, row] of Object.entries(CONDITIONS))
      expect({ condition, ...row }).toEqual({
        condition,
        exit: ["FAILED", "INCOMPLETE", "TIMEOUT"].includes(condition) ? 1 : 2,
        retryable: ["UNAVAILABLE", "TIMEOUT"].includes(condition),
      });
  });
});

describe("conditionOf (the ABNF of spec 7.2.1)", () => {
  test("every condition after a subject is read, and a bare condition is no code", () => {
    for (const condition of Object.keys(CONDITIONS)) {
      expect(conditionOf(`ITEM_${condition}`)).toBe(condition as Condition);
      expect(conditionOf(`ITEM_PART_${condition}`)).toBe(condition as Condition);
      expect(conditionOf(condition), `a bare ${condition}`).toBeUndefined();
    }
  });

  test("the longest condition: NOT_FOUND and TOO_LARGE are one condition each, FOUND and LARGE are none", () => {
    expect(conditionOf("MEMBER_NOT_FOUND")).toBe("NOT_FOUND");
    expect(conditionOf("FOUND_NOT_FOUND")).toBe("NOT_FOUND");
    expect(conditionOf("INPUT_TOO_LARGE")).toBe("TOO_LARGE");
    expect(conditionOf("MEMBER_FOUND")).toBeUndefined();
    expect(conditionOf("MEMBER_LARGE")).toBeUndefined();
    expect(conditionOf("NOT_FOUND_INVALID")).toBe("INVALID");
    expect(conditionOf("TOO_LARGE_FAILED")).toBe("FAILED");
  });

  test("a subject is never empty and keeps the grammar: upper-case letters then digits, segments joined by one underscore", () => {
    expect(conditionOf("_INVALID")).toBeUndefined();
    expect(conditionOf("X__INVALID")).toBeUndefined();
    expect(conditionOf("X_INVALID_")).toBeUndefined();
    expect(conditionOf("2FA_INVALID")).toBeUndefined();
    expect(conditionOf("2FA_REQUIRED")).toBeUndefined();
    expect(conditionOf("TWO_FA_REQUIRED")).toBe("REQUIRED");
    expect(conditionOf("MEMBER2_INVALID")).toBe("INVALID");
    expect(conditionOf("A1_B2_C3_CONFLICT")).toBe("CONFLICT");
    expect(conditionOf("M_2_INVALID")).toBe("INVALID");
    expect(conditionOf("member_INVALID")).toBeUndefined();
    expect(conditionOf("MEMBER_invalid")).toBeUndefined();
    expect(conditionOf("MEMBER-INVALID")).toBeUndefined();
    expect(conditionOf("MEMBER_INVALIDS")).toBeUndefined();
    expect(conditionOf("")).toBeUndefined();
  });

  test("the core codes: seven end in a condition, five predate the grammar, and STOPPED_MIDWAY ends in none", () => {
    const ending = {
      COMMAND_REQUIRED: "REQUIRED",
      INPUT_INVALID: "INVALID",
      INPUT_CONFLICT: "CONFLICT",
      INPUT_TOO_LARGE: "TOO_LARGE",
      BATCH_INCOMPLETE: "INCOMPLETE",
      PLAN_STALE: "STALE",
      CURSOR_INVALID: "INVALID",
    };
    for (const [code, condition] of Object.entries(ending))
      expect(conditionOf(code)).toBe(condition as Condition);
    for (const code of ["USAGE", "UNKNOWN_COMMAND", "INTERNAL", "UNVERIFIABLE", "OPERATION_REUSED"])
      expect(conditionOf(code), code).toBeUndefined();
    expect(conditionOf("STOPPED_MIDWAY")).toBeUndefined();
    expect(conditionOf("PROMOTE_REFUSED")).toBeUndefined();
  });
});

describe("defineError at 1.3 (spec 7.2.2, 7.2.3)", () => {
  test("a code that ends in a condition takes the condition's exit and retryability", () => {
    for (const [condition, row] of Object.entries(CONDITIONS))
      expect(defineError({ code: `ITEM_${condition}`, ...text }).entry).toEqual({
        code: `ITEM_${condition}`,
        exit: row.exit,
        retryable: row.retryable,
        ...text,
      });
  });

  test("values that agree with the condition are allowed, and the row keeps the registry's member order", () => {
    const given = defineError({
      code: "ITEM_NOT_FOUND",
      meaning: "m",
      retryable: false,
      exit: 2,
      fix: "f",
      reasons: { GONE: { meaning: "gone", fix: "list" } },
    });
    expect(Object.keys(given.entry)).toEqual([
      "code",
      "exit",
      "retryable",
      "meaning",
      "fix",
      "reasons",
    ]);
    expect(given.entry).toMatchObject({ exit: 2, retryable: false });
    expect(
      defineError({ code: "ITEM_UNAVAILABLE", exit: 2, retryable: true, ...text }).entry,
    ).toMatchObject({ exit: 2, retryable: true });
  });

  test("a given exit that differs from the condition's throws when the error is defined", () => {
    expect(() => defineError({ code: "ITEM_NOT_FOUND", exit: 1, ...text })).toThrow(
      "error ITEM_NOT_FOUND is given exit 1, but its condition NOT_FOUND fixes exit 2 (spec 7.2.2)",
    );
    expect(() => defineError({ code: "ITEM_FAILED", exit: 2, ...text })).toThrow(
      "error ITEM_FAILED is given exit 2, but its condition FAILED fixes exit 1 (spec 7.2.2)",
    );
    expect(() => defineError({ code: "ITEM_TIMEOUT", exit: 2, retryable: true, ...text })).toThrow(
      /ITEM_TIMEOUT is given exit 2/,
    );
    // a core code that ends in a condition: PLAN_STALE is exit 2 (spec 7.3.1)
    expect(() => defineError({ code: "PLAN_STALE", exit: 1, ...text })).toThrow(
      /PLAN_STALE is given exit 1/,
    );
  });

  test("a given retryable that differs from the condition's default throws, except under FAILED, INCOMPLETE and TIMEOUT", () => {
    expect(() => defineError({ code: "ITEM_NOT_FOUND", retryable: true, ...text })).toThrow(
      "error ITEM_NOT_FOUND is given retryable true, but its condition NOT_FOUND fixes false (spec 7.2.3)",
    );
    expect(() => defineError({ code: "ITEM_UNAVAILABLE", retryable: false, ...text })).toThrow(
      "error ITEM_UNAVAILABLE is given retryable false, but its condition UNAVAILABLE fixes true (spec 7.2.3)",
    );
    expect(() => defineError({ code: "PLAN_STALE", retryable: true, ...text })).toThrow(
      /PLAN_STALE is given retryable true/,
    );
    for (const condition of ["FAILED", "INCOMPLETE", "TIMEOUT"] as const)
      for (const retryable of [true, false])
        expect(
          defineError({ code: `ITEM_${condition}`, retryable, ...text }).entry,
          `${condition} ${retryable}`,
        ).toEqual({
          code: `ITEM_${condition}`,
          exit: 1,
          retryable,
          ...text,
        });
  });

  test("a code that ends in no condition must give its exit and its retryability", () => {
    for (const code of [
      "USAGE",
      "INTERNAL",
      "UNKNOWN_COMMAND",
      "STOPPED_MIDWAY",
      "PROMOTE_REFUSED",
    ]) {
      expect(() => defineError({ code, ...text }), code).toThrow(
        `error ${code} ends in none of the fifteen conditions (spec 7.2.1), so it must give its exit and retryable`,
      );
      expect(() => defineError({ code, exit: 1, ...text }), code).toThrow(
        /must give its exit and retryable/,
      );
      expect(() => defineError({ code, retryable: false, ...text }), code).toThrow(
        /must give its exit and retryable/,
      );
      expect(defineError({ code, exit: 1, retryable: false, ...text }).entry).toEqual({
        code,
        exit: 1,
        retryable: false,
        ...text,
      });
    }
    // a bare condition is no code either
    expect(() => defineError({ code: "NOT_FOUND", ...text })).toThrow(/ends in none/);
  });
});

/** acme declaring `minor`, with `errors` among its tool-level errors (one of a code acme has replaces it). */
const acmeWith = (minor: ContractMinor, ...errors: ReadonlyArray<AnyDefinedError>) =>
  defineTool({
    ...ACME_TOOL_DECLARATION,
    errors: [
      ...ACME_TOOL_DECLARATION.errors.filter(
        (own) => !errors.some(({ code }) => code === own.code),
      ),
      ...errors,
    ],
    profile: { ...ACME_TOOL_DECLARATION.profile, contractVersion: minor },
  });

/**
 * A definition whose row `defineError` would refuse, built by hand (a library older than 1.3 let a tool register one):
 * the registry check must refuse it at the tool too.
 */
const forged = (entry: RegistryEntry): AnyDefinedError => ({
  ...defineError({ code: "FORGED_FAILED", ...text }),
  code: entry.code,
  entry,
});

describe("defineTool at 1.3 holds the registry to spec 7.2.3", () => {
  test("acme declaring 1.3 is accepted, and so is each of FAILED, INCOMPLETE and TIMEOUT registered either way", () => {
    expect(acmeWith("1.3").profile.contractVersion).toBe("1.3");
    const either = (["FAILED", "INCOMPLETE", "TIMEOUT"] as const).flatMap((condition) =>
      [true, false].map((retryable) =>
        defineError({ code: `${retryable ? "SAFE" : "ONCE"}_${condition}`, retryable, ...text }),
      ),
    );
    const tool = acmeWith("1.3", ...either);
    expect(tool.errors.filter((row) => conditionOf(row.code) === "TIMEOUT")).toMatchObject([
      { code: "SAFE_TIMEOUT", exit: 1, retryable: true },
      { code: "ONCE_TIMEOUT", exit: 1, retryable: false },
    ]);
  });

  test("a code that ends in no condition is refused: PROMOTE_REFUSED, STOPPED_MIDWAY, a bare NOT_FOUND", () => {
    for (const code of ["PROMOTE_REFUSED", "STOPPED_MIDWAY", "NOT_FOUND"])
      expect(() =>
        acmeWith("1.3", defineError({ code, exit: 1, retryable: false, ...text })),
      ).toThrow(`code ${code} is neither a core code nor <SUBJECT>_<CONDITION> (spec 7.2.3)`);
  });

  test("a registered exit or retryability other than the condition's is refused: FINDING_NOT_FOUND at exit 1, STORE_UNAVAILABLE not retryable, WRITE_FAILED at exit 2, PLAN_STALE retryable", () => {
    const refusal = (entry: RegistryEntry) => () => acmeWith("1.3", forged(entry));
    const row = { meaning: "m", fix: "f" };
    expect(refusal({ code: "FINDING_NOT_FOUND", exit: 1, retryable: false, ...row })).toThrow(
      "code FINDING_NOT_FOUND is registered with exit 1, but its condition NOT_FOUND fixes exit 2 (spec 7.2.3)",
    );
    expect(refusal({ code: "STORE_UNAVAILABLE", exit: 2, retryable: false, ...row })).toThrow(
      "code STORE_UNAVAILABLE is registered retryable false, but its condition UNAVAILABLE fixes true (spec 7.2.3)",
    );
    expect(refusal({ code: "WRITE_FAILED", exit: 2, retryable: false, ...row })).toThrow(
      /code WRITE_FAILED is registered with exit 2, but its condition FAILED fixes exit 1/,
    );
    expect(refusal({ code: "ITEM_STALE", exit: 2, retryable: true, ...row })).toThrow(
      /code ITEM_STALE is registered retryable true, but its condition STALE fixes false/,
    );
  });

  test("an own code never takes a core code's name at another exit or retryability", () => {
    const row = { meaning: "m", fix: "f" };
    expect(() =>
      acmeWith("1.3", forged({ code: "OPERATION_REUSED", exit: 1, retryable: false, ...row })),
    ).toThrow(
      "reserved OPERATION_REUSED is registered with exit 1 and retryable false, not 2 and false",
    );
    expect(() =>
      acmeWith("1.3", defineError({ code: "UNVERIFIABLE", exit: 2, retryable: false, ...text })),
    ).toThrow(
      "reserved UNVERIFIABLE is registered with exit 2 and retryable false, not 1 and false",
    );
    expect(() =>
      acmeWith("1.3", defineError({ code: "INTERNAL", exit: 1, retryable: true, ...text })),
    ).toThrow("reserved INTERNAL is registered with exit 1 and retryable true, not 1 and false");
  });

  test("a tool that declares 1.2 or 1.1 keeps a legacy name; one reserved row is reported once, not by both checks", () => {
    const legacy = defineError({ code: "PROMOTE_REFUSED", exit: 1, retryable: true, ...text });
    for (const minor of ["1.1", "1.2"] as const)
      expect(() => acmeWith(minor, legacy)).not.toThrow();
    expect(() =>
      acmeWith("1.3", defineError({ code: "INTERNAL", exit: 2, retryable: false, ...text })),
    ).toThrow(/^reserved INTERNAL is registered with exit 2 and retryable false, not 1 and false$/);
  });
});

describe("codeNameProblems", () => {
  const entry = (code: string, exit: 1 | 2, retryable: boolean): RegistryEntry => ({
    code,
    exit,
    retryable,
    ...text,
  });
  const BROKEN = [
    entry("PROMOTE_REFUSED", 1, false),
    entry("STOPPED_MIDWAY", 1, false),
    entry("FINDING_NOT_FOUND", 1, false),
    entry("STORE_UNAVAILABLE", 2, false),
    entry("ISSUE_STALE", 2, true),
    entry("INTERNAL", 2, false),
  ];

  test("none below 1.3, however the names read", () => {
    for (const minor of ["1.1", "1.2"] as const)
      expect(codeNameProblems(minor, BROKEN)).toEqual([]);
  });

  test("at 1.3 each broken row is one problem, and the core codes and the conforming rows none", () => {
    const problems = codeNameProblems("1.3", BROKEN);
    expect(problems).toHaveLength(BROKEN.length);
    BROKEN.forEach(({ code }, index) => expect(problems[index], code).toContain(code));
    const conforming = [
      entry("USAGE", 2, false),
      entry("INTERNAL", 1, false),
      entry("UNVERIFIABLE", 1, false),
      entry("BATCH_INCOMPLETE", 1, false),
      entry("COMMAND_REQUIRED", 2, false),
      entry("ITEM_NOT_FOUND", 2, false),
      entry("STORE_UNAVAILABLE", 2, true),
      entry("WAIT_TIMEOUT", 1, true),
      entry("WRITE_FAILED", 1, false),
      entry("WRITE_FAILED_TWICE_INCOMPLETE", 1, true),
    ];
    expect(codeNameProblems("1.3", conforming)).toEqual([]);
  });
});
