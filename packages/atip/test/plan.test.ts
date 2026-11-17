import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { canonicalJson, commitArgv, PlanDigest, planDigest, sha256Hex } from "../src/index.ts";

describe("destructive plans (atip/1 §11.4-11.7)", () => {
  test("canonical JSON is RFC 8785: members sorted by UTF-16 code units, no whitespace, ES number and string forms", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: { z: -0, y: 1e21, x: 0.1 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"x":0.1,"y":1e+21,"z":0}}',
    );
    // RFC 8785 §3.2.3: names sort by UTF-16 code units, "\r" (0x000d) < "€" (0x20ac) < "😀" (0xd83d 0xde00)
    expect(canonicalJson({ "😀": 1, "€": 2, "\r": 3 })).toBe('{"\\r":3,"€":2,"😀":1}');
    expect(canonicalJson({ a: undefined, b: "line\nbreak" })).toBe('{"b":"line\\nbreak"}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  test("the digest is sha256: and the hex SHA-256 of the canonical JSON, the same for equal plans whatever their member order", async () => {
    const plan = {
      command: "run abandon",
      effects: [{ action: "write", target: "run/phase.json" }],
    };
    const digest = await Effect.runPromise(planDigest(plan));
    expect(digest).toBe(`sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`);
    expect(Schema.is(PlanDigest)(digest)).toBe(true);
    expect(
      await Effect.runPromise(planDigest({ effects: plan.effects, command: plan.command })),
    ).toBe(digest);
    expect(await Effect.runPromise(planDigest({ ...plan, command: "run release" }))).not.toBe(
      digest,
    );
  });

  test("sha256Hex is SHA-256 (FIPS 180-4) on every length around the block boundaries", () => {
    const encoder = new TextEncoder();
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const bytes = encoder.encode("한a".repeat(length).slice(0, length));
      expect(sha256Hex(bytes), String(length)).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  test("the commit line is the preview's argv with --commit --plan-digest before any --", () => {
    expect(commitArgv(["run", "abandon", "2026.10.24.1", "--reason", "r"], "sha256:ab")).toEqual([
      "run",
      "abandon",
      "2026.10.24.1",
      "--reason",
      "r",
      "--commit",
      "--plan-digest",
      "sha256:ab",
    ]);
    expect(commitArgv(["note", "--json", "--", "-x"], "d")).toEqual([
      "note",
      "--json",
      "--commit",
      "--plan-digest",
      "d",
      "--",
      "-x",
    ]);
  });
});
