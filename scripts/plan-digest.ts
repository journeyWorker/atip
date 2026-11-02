// Recomputes the plan digest test vectors in examples/plan-digest/ (spec 11.6): for each file, the RFC 8785 (JCS)
// canonical form of `plan` must equal `canonical`, and `sha256:` followed by the lower-case hex SHA-256 of its UTF-8
// bytes must equal `digest`. The canonicalizer below is this repository's own; the expected values were computed
// with two other implementations (see examples/README.md). Its number form is first checked against the values of
// RFC 8785 Appendix B. Run through scripts/validate.sh; needs no packages.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** RFC 8785 section 3.2.2: ECMAScript Number-to-String for numbers, JSON.stringify's escaping for strings. */
function serializeScalar(value: null | boolean | number | string): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${value} is not an I-JSON number`)
  if (typeof value === "string" && !value.isWellFormed()) throw new Error("a lone surrogate is not I-JSON")
  return JSON.stringify(value) // -0 serializes as 0, as RFC 8785 requires
}

/** RFC 8785 section 3.2.3: object members sorted by the UTF-16 code units of their names, recursively. */
function canonicalize(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (value !== null && typeof value === "object") {
    const names = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // `<` compares UTF-16 code units
    return `{${names.map((n) => `${serializeScalar(n)}:${canonicalize(value[n])}`).join(",")}}`
  }
  return serializeScalar(value)
}

// RFC 8785 Appendix B: IEEE 754 bit patterns and their canonical text.
const APPENDIX_B: [string, string][] = [
  ["0000000000000000", "0"], ["8000000000000000", "0"], ["0000000000000001", "5e-324"],
  ["8000000000000001", "-5e-324"], ["7fefffffffffffff", "1.7976931348623157e+308"],
  ["ffefffffffffffff", "-1.7976931348623157e+308"], ["4340000000000000", "9007199254740992"],
  ["c340000000000000", "-9007199254740992"], ["4430000000000000", "295147905179352830000"],
  ["44b52d02c7e14af5", "9.999999999999997e+22"], ["44b52d02c7e14af6", "1e+23"],
  ["44b52d02c7e14af7", "1.0000000000000001e+23"], ["444b1ae4d6e2ef4e", "999999999999999700000"],
  ["444b1ae4d6e2ef4f", "999999999999999900000"], ["444b1ae4d6e2ef50", "1e+21"],
  ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"], ["3eb0c6f7a0b5ed8d", "0.000001"],
  ["41b3de4355555553", "333333333.3333332"], ["41b3de4355555554", "333333333.33333325"],
  ["41b3de4355555555", "333333333.3333333"], ["41b3de4355555556", "333333333.3333334"],
  ["41b3de4355555557", "333333333.33333343"], ["becbf647612f3696", "-0.0000033333333333333333"],
  ["43143ff3c1cb0959", "1424953923781206.2"],
]

const repo = process.argv[2]
let passed = 0
let failed = 0
const report = (ok: boolean, what: string, problem?: string) => {
  ok ? passed++ : failed++
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${ok || !problem ? "" : `\n      ${problem}`}`)
}

const bits = new DataView(new ArrayBuffer(8))
const wrong = APPENDIX_B.filter(([hex, text]) => {
  bits.setBigUint64(0, BigInt(`0x${hex}`))
  return canonicalize(bits.getFloat64(0)) !== text
})
report(wrong.length === 0, `RFC 8785 Appendix B number forms (${APPENDIX_B.length} values)`, `differs for ${wrong.map(([h]) => h).join(", ")}`)

const dir = join(repo, "examples", "plan-digest")
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const vector = JSON.parse(readFileSync(join(dir, f), "utf8")) as { plan: Json; canonical: string; digest: string }
  const canonical = canonicalize(vector.plan)
  const digest = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`
  const problem =
    canonical !== vector.canonical ? `canonical form ${canonical}` : digest !== vector.digest ? `digest ${digest}` : undefined
  report(problem === undefined, `examples/plan-digest/${f}`, problem)
}
console.log(`\n${passed} passed, ${failed} failed (plan digests)`)
process.exit(failed ? 1 : 0)
