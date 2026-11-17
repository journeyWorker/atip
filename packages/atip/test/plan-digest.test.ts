import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { canonicalJson, planDigest } from "../src/index.ts";

/** The specification's plan digest test vectors (spec 11.6), read in place from the repository's `examples/`. */
const VECTORS = join(import.meta.dir, "..", "..", "..", "examples", "plan-digest");

const Vector = Schema.Struct({ plan: Schema.Unknown, canonical: Schema.String, digest: Schema.String });
const decodeVector = Schema.decodeUnknownSync(Schema.fromJsonString(Vector));

const files = readdirSync(VECTORS)
  .filter((name) => name.endsWith(".json"))
  .sort();

describe("the plan digest vectors (spec 11.6)", () => {
  test("canonicalJson and planDigest reproduce each vector's canonical text and digest", async () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const name of files) {
      const vector = decodeVector(readFileSync(join(VECTORS, name), "utf8"));
      expect(canonicalJson(vector.plan), `${name} canonical`).toBe(vector.canonical);
      expect(await Effect.runPromise(planDigest(vector.plan)), `${name} digest`).toBe(
        vector.digest,
      );
    }
  });
});
