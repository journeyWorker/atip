/**
 * Destructive safety as atip/1 writes it (spec 11.4-11.7): a destructive command previews its plan by default, names
 * every effect, and acts only with `--commit --plan-digest <DIGEST>` taken from that preview. This module holds the
 * tool-independent parts: the plan's canonical JSON (RFC 8785, JCS) and digest (spec 11.6), the preview members of a
 * report, and the commit invocation a preview leads with (spec 11.5).
 */
import { Effect, Schema } from "effect";
import { defineError, type FailureOf } from "./errors.ts";

/** `sha256:` and the lower-case hex SHA-256 of the plan's canonical JSON (spec 11.6). */
export const PLAN_DIGEST_PATTERN = "^sha256:[0-9a-f]{64}$";

/** A plan digest: the form spec 11.6 recommends and this module computes. */
export const PlanDigest = Schema.String.check(Schema.isPattern(new RegExp(PLAN_DIGEST_PATTERN)));

/**
 * One effect a commit would make (spec 11.4): the action and its target, with what else a caller needs to decide from
 * it alone (a pid, a byte count, the server it goes to).
 */
export const PlanEffect = Schema.Struct({
  action: Schema.String,
  target: Schema.String,
  detail: Schema.optionalKey(Schema.String),
});
export type PlanEffect = typeof PlanEffect.Type;

/** The members every destructive report carries at the top of `data` (spec 11.4). */
export const PreviewMembers = {
  planDigest: PlanDigest,
  effects: Schema.Array(PlanEffect),
  committed: Schema.Boolean,
} as const;

const canonicalNumber = (value: number): string => {
  if (!Number.isFinite(value))
    throw new TypeError(`a plan holds only finite numbers, not ${value}`);
  // ECMAScript's Number::toString is the JCS number form (RFC 8785 §3.2.2.3); -0 is 0
  return Object.is(value, -0) ? "0" : String(value);
};

/** UTF-16 code unit order of property names (RFC 8785 §3.2.3). */
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A JSON value as its RFC 8785 canonical text: object members sorted by their names' UTF-16 code units, no
 * whitespace, strings and numbers serialised as ECMAScript's `JSON.stringify` does. A member whose value is
 * `undefined` is absent, as in JSON; anything that is no JSON value (a function, a bigint, NaN) is refused.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalNumber(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value))
        return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
      const members = Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .sort(([a], [b]) => byCodeUnits(a, b))
        .map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new TypeError(`a plan holds only JSON values, not a ${typeof value}`);
  }
};

/** SHA-256's round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * The SHA-256 of bytes (FIPS 180-4) as lower-case hex: computed here, synchronously and without I/O, so the contract
 * module needs nothing but `effect` and runs anywhere a tool does.
 */
export const sha256Hex = (bytes: Uint8Array): string => {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15] ?? 0;
      const b = w[t - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [
      h[0] ?? 0,
      h[1] ?? 0,
      h[2] ?? 0,
      h[3] ?? 0,
      h[4] ?? 0,
      h[5] ?? 0,
      h[6] ?? 0,
      h[7] ?? 0,
    ];
    for (let t = 0; t < 64; t++) {
      const t1 =
        (hh +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (K[t] ?? 0) +
          (w[t] ?? 0)) >>>
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
};

/**
 * The digest of a plan (spec 11.6): `sha256:` and the hex SHA-256 of its canonical JSON. The plan holds the command,
 * its normalised arguments, the effects and the state they depend on, so a changed state gives another digest.
 */
export const planDigest = (plan: unknown): Effect.Effect<string> =>
  Effect.sync(() => `sha256:${sha256Hex(new TextEncoder().encode(canonicalJson(plan)))}`);

/**
 * The commit invocation a preview leads with (spec 11.5): the preview's normalised argv (never `--input -`) with
 * `--commit --plan-digest <DIGEST>` before any `--`, so a caller runs it as it stands.
 */
export const commitArgv = (
  previewArgv: ReadonlyArray<string>,
  digest: string,
): ReadonlyArray<string> => {
  const dashes = previewArgv.indexOf("--");
  const head = dashes === -1 ? previewArgv : previewArgv.slice(0, dashes);
  const tail = dashes === -1 ? [] : previewArgv.slice(dashes);
  return [...head, "--commit", "--plan-digest", digest, ...tail];
};

/** What a destructive handler's `plan` returns: the effects a commit would make, and the state they depend on. */
export interface Plan {
  readonly effects: ReadonlyArray<PlanEffect>;
  /**
   * From `plan`: the digest another system computed, when that system makes the effects (a remote service the tool
   * sends the plan to, spec 11.6); the runner passes it through unchanged and the check of spec 11.7 happens there.
   * Absent: the runner computes the digest and checks it. The plan `commit` gets always carries the digest it
   * commits, for its report's `planDigest` (spec 11.4) or for the remote.
   */
  readonly digest?: string;
}

/**
 * A destructive command's handler (approaches/typescript.md §3.5): `plan` computes the effects a commit would make
 * and the state they depend on; `commit` makes them, given the plan with the digest it commits. The tool runs `plan`
 * with no write capability in its environment (`RPlan`), so a preview cannot make an effect (spec 11.2).
 */
export interface PlanHandler<Args, P extends Plan, A, E, R, RPlan> {
  readonly plan: (args: Args) => Effect.Effect<P, E, RPlan>;
  readonly commit: (args: Args, plan: P & { readonly digest: string }) => Effect.Effect<A, E, R>;
}

/** The reserved refusal of a commit whose plan changed since its preview (spec 11.7). */
export const PlanStale = defineError({
  code: "PLAN_STALE",
  exit: 2,
  retryable: false,
  meaning: "The plan changed since the preview whose digest --plan-digest gives; nothing was done",
  fix: "Run the preview again, read its effects, then run the commit line it prints",
});

/** How a destructive invocation was asked for: its preview argv, and the commit and digest when it acts. */
export interface PlanRequest {
  /** The command's words (`run abandon`): the plan's digest covers them. */
  readonly command: string;
  /** The normalised argument object (spec 10.7 step 6), which the digest covers too. */
  readonly arguments: unknown;
  /** The preview's argv after the tool name, without `--commit` and `--plan-digest`. */
  readonly previewArgv: ReadonlyArray<string>;
  /** `--plan-digest` with `--commit`; absent: preview. */
  readonly commitDigest?: string;
}

/** A destructive invocation's outcome: the preview (nothing done), or the committed report. */
export type PlanOutcome<P extends Plan, A> =
  | {
      readonly committed: false;
      readonly plan: P;
      readonly planDigest: string;
      readonly commitArgv: ReadonlyArray<string>;
    }
  | { readonly committed: true; readonly planDigest: string; readonly report: A };

/**
 * Runs a destructive handler (spec 11.4-11.7): `plan`, then its digest over the command, the arguments and the plan;
 * without a commit digest that is the preview, with its commit line; with one, a different digest is `PLAN_STALE` with
 * the preview as its `next` and nothing done, the same one commits the plan it was computed from. A plan whose
 * `digest` another system computed is previewed with that digest and committed with the one the commit gives: that
 * system, which makes the effects, compares the two (spec 11.6).
 */
export const runDestructive: <Args, P extends Plan, A, E, R, RPlan>(
  handler: PlanHandler<Args, P, A, E, R, RPlan>,
  args: Args,
  request: PlanRequest,
) => Effect.Effect<PlanOutcome<P, A>, E | FailureOf<typeof PlanStale>, R | RPlan> = Effect.fn(
  "atip.runDestructive",
)(function* <Args, P extends Plan, A, E, R, RPlan>(
  handler: PlanHandler<Args, P, A, E, R, RPlan>,
  args: Args,
  request: PlanRequest,
) {
  const plan = yield* handler.plan(args);
  const digest =
    plan.digest ??
    (yield* planDigest({
      command: request.command,
      arguments: request.arguments,
      plan,
    }));
  if (request.commitDigest === undefined)
    return {
      committed: false as const,
      plan,
      planDigest: digest,
      commitArgv: commitArgv(request.previewArgv, digest),
    };
  if (plan.digest === undefined && request.commitDigest !== digest)
    return yield* PlanStale.fail({
      message: `the plan changed since ${request.commitDigest} (now ${digest}); nothing was done`,
      field: "--plan-digest",
      received: request.commitDigest,
      next: [request.previewArgv],
    });
  const report = yield* handler.commit(args, { ...plan, digest: request.commitDigest });
  return { committed: true as const, planDigest: request.commitDigest, report };
});
