/**
 * A domain pattern written as a RegExp with a slash: ECMAScript's `source` escapes the
 * slash, which is no I-Regexp escape; the library publishes the pattern the RegExp means.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { defineCommand, describeCommand, report } from "../src/index.ts";
import { patternOfSource } from "../src/pattern.ts";

describe("patterns from RegExp sources", () => {
  test("a slash a RegExp's source escapes is published unescaped; an escaped backslash stays", () => {
    expect(patternOfSource(new RegExp("^a/b$", "u").source)).toBe("^a/b$");
    expect(patternOfSource(String.raw`^a\\/b$`)).toBe(String.raw`^a\\/b$`);
    expect(patternOfSource(String.raw`^[a/]\.b$`)).toBe(String.raw`^[a/]\.b$`);

    const target = defineCommand(
      {
        path: ["note", "add"],
        summary: "Adds a note to a target",
        effect: { kind: "write", idempotency: "appends" },
        input: Schema.Struct({
          target: Schema.String.check(Schema.isPattern(/^[0-9]+\/F-[0-9]{3}$/u)).annotate({
            description: "A finding as <run>/F-<n>",
            valueName: "TARGET",
          }),
        }),
        outputs: [report("NoteAdded", "1.0", Schema.Struct({ ok: Schema.Boolean }))],
        errors: [],
        examples: ["acme note add --target 1/F-001 --json"],
      },
      () => Effect.succeed({ ok: true }),
    );
    const [option] = describeCommand(target).options.filter(
      (candidate) => candidate.name === "target",
    );
    expect(option?.domain).toEqual({ pattern: "^[0-9]+/F-[0-9]{3}$" });
  });
});
