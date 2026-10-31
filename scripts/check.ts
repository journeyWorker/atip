// Validates every example in examples/ against the ATIP JSON Schemas and against the rules JSON Schema cannot
// express (spec 10.13, and the semantic rules of sections 6, 7, 11 and 13). Run through scripts/validate.sh.
//
//   examples/*.json, *.ndjson          must pass every check
//   examples/invalid/*.json, *.ndjson  must fail at least one check (the first problem found is printed)
//
// Which checks apply follows the file name:
//   schema-*   a `schema` answer           schema-doc.schema.json + spec 10.13
//   input-*    an --input value            input-document.schema.json; `input-<tool>-<command>-…` also against
//                                           that command's fragment schema and, unless the name contains
//                                           `fragment`, its `argumentsRef`, `required` and `constraints` (11.7)
//   stream-*   an NDJSON stream            stream-line.schema.json + spec 13.5
//   caller-*   a document of a later minor that a caller of this one must read (spec 15.6, 15.8): it must pass
//              the contract schemas read open (`additionalProperties: false` ignored) and fail them closed, so it
//              really carries unknown members; `caller-schema-*` against schema-doc, the rest against envelope
//   anything else: an envelope             envelope.schema.json + spec 6-8, 11.11, and `data` against the
//                                           output schema of the command's own self-description example
//
// Every tool document (all but caller-*) is also checked against the contract minor it declares in
// `meta.contractVersion` (spec 15.7, 10.13 rule 16): absent means 1.0, which allows none of the 1.1 additions.
//
// The command documents and registries of the valid examples (examples/schema-*.json) are the reference that
// reports, inputs and streams are checked against. Every document is validated against its JSON Schema before
// it is read, so the types below describe documents that already passed that schema.
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
type SchemaNode = JsonObject | boolean
type Arg = {
  name: string
  valueType: string
  required: boolean
  default: JsonValue
  repeatable?: boolean
  variadic?: boolean
  possibleValues?: string[]
  flagOnly?: boolean
  short?: string
  domain?: JsonObject
}
type Constraint = { rule: string; names?: string[]; if?: { name: string; in?: JsonValue[] }; then?: string[]; code?: string }
type Validator = { arguments: string[]; code: string; description: string; rejects: string[] }
type Fields = { records: string; paths: string[]; keep?: string[]; default?: string[] }
type Output = { kind: string; schemaRef: string; schemaVersion: string; eventRef?: string; batch?: boolean; when?: string; fields?: Fields }
type CommandDoc = {
  command: string
  path: string[]
  operands: Arg[]
  options: Arg[]
  constraints?: Constraint[]
  validators?: Validator[]
  errors: string[]
  outputs: Output[]
  input?: { schemaRef: string; argumentsRef?: string; batch: boolean; maxItems?: number; example: JsonObject }
  examples: string[]
  schemas: Record<string, SchemaNode>
}
type TreeEntry = { command: string; path: string[] }
type Reason = { reason: string }
type RegistryEntry = { code: string; exit: number; retryable: boolean; reasons?: Reason[] }
type WarningEntry = { code: string }
type SchemaData =
  | ({ kind: "command" } & CommandDoc)
  | { kind: "tree"; query?: string; commands: TreeEntry[] }
  | { kind: "group"; command: string; path: string[]; commands: TreeEntry[] }
  | { kind: "errors"; errors: RegistryEntry[] }
  | { kind: "error"; error: RegistryEntry }
  | { kind: "warnings"; warnings: WarningEntry[] }
  | { kind: "warning"; warning: WarningEntry }
type NextStep = { command: string; argv: string[] }
type Meta = {
  command?: string
  tool: string
  schemaVersion: string
  contract?: string
  contractVersion?: string
  warnings?: { code: string }[]
  output?: string
  fields?: string[]
  page?: { nextCursor?: string }
  next?: NextStep[]
}
type ErrorBody = {
  code: string
  reason?: string
  field?: string
  hint?: string
  received?: JsonValue
  retryable: boolean
  details?: { code: string; reason?: string }[]
}
type Envelope = { ok: boolean; data?: JsonValue; error?: ErrorBody; meta: Meta }
type BatchItem = { index: number; status: string; error?: ErrorBody }
type StreamLine = {
  type?: string
  command?: string
  tool?: string
  schemaVersion?: string
  contractVersion?: string
  output?: string
  data?: JsonValue
  result?: Envelope
}

const repo = process.argv[2]
// Formats are annotations in draft 2020-12 unless a vocabulary asserts them; tools use their own (`uint`).
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
for (const f of readdirSync(join(repo, "schema"))) ajv.addSchema(JSON.parse(readFileSync(join(repo, "schema", f), "utf8")))
const contractSchema = (name: string): ValidateFunction => {
  const v = ajv.getSchema(`https://atip.dev/1/${name}`)
  if (!v) throw new Error(`schema/${name} is missing`)
  return v
}
const V = {
  envelope: contractSchema("envelope.schema.json"),
  schemaDoc: contractSchema("schema-doc.schema.json"),
  input: contractSchema("input-document.schema.json"),
  stream: contractSchema("stream-line.schema.json"),
  batch: contractSchema("batch-report.schema.json"),
}

/** The contract schemas read open, as a caller reads them (spec 15.8): every `additionalProperties: false` dropped. */
const openAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
const opened = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(opened)
  if (typeof node !== "object" || node === null) return node
  return Object.fromEntries(
    Object.entries(node).filter(([k, v]) => !(k === "additionalProperties" && v === false)).map(([k, v]) => [k, opened(v)]),
  )
}
for (const f of readdirSync(join(repo, "schema"))) openAjv.addSchema(opened(JSON.parse(readFileSync(join(repo, "schema", f), "utf8"))) as object)
const openSchema = (name: string): ValidateFunction => {
  const v = openAjv.getSchema(`https://atip.dev/1/${name}`)
  if (!v) throw new Error(`schema/${name} is missing`)
  return v
}

/** The contract minors this repository describes; a tool declares one of them (spec 15.7). */
const MINORS = ["1.0", "1.1"]
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

// The twelve reserved codes (spec 7.2.1), and the ones every tool registers.
const RESERVED: Record<string, { exit: number; retryable: boolean }> = {
  USAGE: { exit: 2, retryable: false },
  UNKNOWN_COMMAND: { exit: 2, retryable: false },
  COMMAND_REQUIRED: { exit: 2, retryable: false },
  INTERNAL: { exit: 1, retryable: false },
  UNVERIFIABLE: { exit: 1, retryable: false },
  INPUT_INVALID: { exit: 2, retryable: false },
  INPUT_CONFLICT: { exit: 2, retryable: false },
  INPUT_TOO_LARGE: { exit: 2, retryable: false },
  BATCH_INCOMPLETE: { exit: 1, retryable: false },
  PLAN_STALE: { exit: 2, retryable: false },
  OPERATION_REUSED: { exit: 2, retryable: false },
  CURSOR_INVALID: { exit: 2, retryable: false },
}
const ALWAYS = ["USAGE", "UNKNOWN_COMMAND", "COMMAND_REQUIRED", "INTERNAL"]
const PLACEHOLDER = /<[A-Z][A-Z0-9_]*>|\.\.\.|…/
const INTEGER = /^-?(0|[1-9][0-9]*)$/
const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/
const FLAG_ONLY = ["json", "input", "commit", "plan-digest"]
// Keywords a cut node may use (spec 6.10): annotations, and the shape keywords of its kind.
const ANNOTATIONS = ["title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "$comment"]
const CUT_OBJECT: Record<string, true> = Object.fromEntries(
  [...ANNOTATIONS, "type", "properties", "required", "additionalProperties"].map((k) => [k, true]),
)
const CUT_ARRAY: Record<string, true> = Object.fromEntries([...ANNOTATIONS, "type", "items", "minItems", "maxItems"].map((k) => [k, true]))
// The domain profile (spec 10.7.4): keywords by valueType, and the annotations a domain may carry.
const NUMERIC_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]
const STRING_KEYWORDS = ["minLength", "maxLength", "pattern"]
const STRUCTURAL_KEYWORDS = ["type", "enum", "const", "properties", "required", "additionalProperties", "items"]
const DOMAIN_ANNOTATIONS = ["title", "description", "$comment", "format"]
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  integer: NUMERIC_KEYWORDS,
  number: NUMERIC_KEYWORDS,
  count: NUMERIC_KEYWORDS,
  string: STRING_KEYWORDS,
  path: STRING_KEYWORDS,
  json: [...NUMERIC_KEYWORDS, ...STRING_KEYWORDS, ...STRUCTURAL_KEYWORDS],
}

/** The deepest errors first: under oneOf, the shallow ones only say that no branch matched. */
function ajvErrors(v: ValidateFunction): string {
  return [...(v.errors ?? [])]
    .filter((e: ErrorObject) => !["oneOf", "if", "anyOf"].includes(e.keyword))
    .sort((a, b) => b.instancePath.split("/").length - a.instancePath.split("/").length)
    .slice(0, 2)
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ")
}

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v)
const refName = (ref: string) => ref.replace("#/schemas/", "")
const camel = (kebab: string) => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
const hasSchema = (doc: CommandDoc, ref: string) => Object.prototype.hasOwnProperty.call(doc.schemas, refName(ref))

/** A validator for one named schema of a command document; `#/schemas/X` resolves against the document. */
let compiled = 0
function commandSchema(doc: CommandDoc, ref: string, mutate?: (schemas: Record<string, SchemaNode>) => void): ValidateFunction {
  const schemas = structuredClone(doc.schemas)
  mutate?.(schemas)
  return ajv.compile({ $id: `https://atip.dev/check/${++compiled}`, $ref: ref, schemas })
}

/** Splits a documented command line into argv words: whitespace, '…' and "…" quoting, backslash escapes. */
function shellWords(line: string): string[] {
  const words: string[] = []
  let cur = ""
  let quote: string | null = null
  let started = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === "\\" && quote === '"' && i + 1 < line.length && ['"', "\\", "$", "`"].includes(line[i + 1])) cur += line[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i]
      started = true
    } else if (/\s/.test(c)) {
      if (started) words.push(cur)
      cur = ""
      started = false
    } else {
      cur += c
      started = true
    }
  }
  if (quote) throw new Error(`unclosed ${quote} quote`)
  if (started) words.push(cur)
  return words
}

// ---- arguments ----
/** Explicitly given arguments of one invocation: operands in order, options by name (spec 11.7 step 4). */
type Args = { operands: JsonValue[]; options: Map<string, JsonValue> }

/**
 * Numeric strings of integer and number arguments denote numbers, in the JSON number grammar only (11.5). An integer
 * outside the safe range ±(2^53-1) stays a string, so it is refused rather than rounded (10.7.5).
 */
function normalise(valueType: string, v: JsonValue): JsonValue {
  if (typeof v !== "string") return v
  if ((valueType === "integer" || valueType === "count") && INTEGER.test(v) && Number.isSafeInteger(Number(v))) return Number(v)
  if (valueType === "number" && JSON_NUMBER.test(v) && Number.isFinite(Number(v))) return Number(v)
  return v
}

/** A value is valid for its argument's valueType (10.7.2), after normalisation. */
function validValue(arg: Arg, v: JsonValue): boolean {
  const n = normalise(arg.valueType, v)
  switch (arg.valueType) {
    // A JSON integer literal beyond 2^53-1 parses to a number that is not a safe integer, so it is refused too.
    case "integer": return typeof n === "number" && Number.isSafeInteger(n)
    case "number": return typeof n === "number" && Number.isFinite(n)
    case "enum": return typeof n === "string" && (arg.possibleValues ?? []).includes(n)
    case "string": case "path": return typeof n === "string"
    case "json": return n !== null
    case "switch": return typeof n === "boolean"
    case "count": return typeof n === "number" && Number.isSafeInteger(n) && n >= 0
    default: return false
  }
}

/**
 * The I-Regexp (RFC 9485) syntax of the body of a domain pattern, with the restrictions of spec 10.7.4 that make the
 * ECMAScript (`u` flag) and Rust `regex` readings of `^body$` agree: no `|` outside parentheses, no `.`, `^` or `$`
 * outside a character class, no `\-` outside a character class, and no `&&` or `~~` inside one (Rust's class
 * intersection and symmetric difference; `--` and a nested `[` are already not I-Regexp). Returns the first problem,
 * or undefined.
 */
function iregexpProblem(body: string): string | undefined {
  const cps = [...body]
  let i = 0
  const SINGLE_ESCAPES = new Set(["(", ")", "*", "+", "-", ".", "?", "[", "\\", "]", "^", "n", "r", "t", "{", "|", "}"])
  const CATEGORY = /^(L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/
  class Bad extends Error {}
  const fail = (what: string): never => {
    throw new Bad(`${what} at offset ${i}`)
  }
  const isCategory = () => cps[i] === "\\" && (cps[i + 1] === "p" || cps[i + 1] === "P")
  const escape = (inClass: boolean) => {
    if (isCategory()) {
      if (cps[i + 2] !== "{") fail("\\p without {")
      const end = cps.indexOf("}", i + 3)
      if (end < 0) fail("unclosed \\p{")
      const name = cps.slice(i + 3, end).join("")
      if (!CATEGORY.test(name)) fail(`unknown category ${name}`)
      i = end + 1
      return
    }
    const c = cps[i + 1]
    if (c === undefined || !SINGLE_ESCAPES.has(c)) fail(`escape \\${c ?? ""} is not I-Regexp`)
    if (c === "-" && !inClass) fail("\\- outside a character class")
    i += 2
  }
  const classChar = (): boolean => {
    const c = cps[i]
    if (c === "\\") {
      escape(true)
      return true
    }
    if (c === undefined || c === "-" || c === "[" || c === "]") return false
    if ((c === "&" || c === "~") && cps[i + 1] === c) fail(`${c}${c} in a character class (a set operation in Rust)`)
    i++
    return true
  }
  const charClass = () => {
    i++
    if (cps[i] === "^") i++
    let items = 0
    if (cps[i] === "-") {
      i++
      items++
    }
    while (cps[i] !== "]") {
      if (cps[i] === undefined) fail("unclosed [")
      if (isCategory()) escape(true)
      else if (cps[i] === "-" && cps[i + 1] === "]") i++
      else {
        if (!classChar()) fail(`${cps[i]} in a character class`)
        if (cps[i] === "-" && cps[i + 1] !== "]") {
          i++
          if (isCategory() || !classChar()) fail("bad range")
        }
      }
      items++
    }
    if (!items) fail("empty character class")
    i++
  }
  const digits = () => {
    if (!/[0-9]/.test(cps[i] ?? "")) fail("quantifier without digits")
    while (/[0-9]/.test(cps[i] ?? "")) i++
  }
  const quantifier = () => {
    const c = cps[i]
    if (c === "*" || c === "+" || c === "?") i++
    else if (c === "{") {
      i++
      digits()
      if (cps[i] === ",") {
        i++
        if (/[0-9]/.test(cps[i] ?? "")) digits()
      }
      if (cps[i] !== "}") fail("unclosed {")
      i++
    }
  }
  const alternatives = (depth: number) => {
    branch(depth)
    while (cps[i] === "|") {
      if (depth === 0) fail("| outside parentheses")
      i++
      branch(depth)
    }
  }
  const branch = (depth: number) => {
    while (i < cps.length && cps[i] !== "|" && cps[i] !== ")") {
      const c = cps[i]
      if (c === "(") {
        i++
        alternatives(depth + 1)
        if (cps[i] !== ")") fail("unclosed (")
        i++
      } else if (c === "[") charClass()
      else if (c === "\\") escape(false)
      else if (c === ".") fail(". outside a character class")
      else if (c === "^" || c === "$") fail(`${c} outside a character class`)
      else if ("*+?{}]".includes(c)) fail(`${c} without an atom`)
      else i++
      quantifier()
    }
  }
  try {
    alternatives(0)
    if (i < cps.length) fail(`unmatched ${cps[i]}`)
  } catch (e) {
    if (e instanceof Bad) return e.message
    throw e
  }
  return undefined
}

/**
 * The recorded cross-engine results (scripts/regex-cases.json): what the Rust regex crate does with each pattern, as
 * verified by scripts/regex-parity. A pattern of the form must compile in both engines (10.7.4); the ECMAScript half
 * is checked here, the Rust half comes from the record, so every pattern an example uses must be recorded.
 */
type UnicodeDifference = { kind: string; codePoint: string; ecmascript: string; rust: string }
type RegexCase = {
  pattern: string
  value: string
  form: boolean
  ecmascript: boolean | "error"
  rust: boolean | "error"
  difference?: UnicodeDifference
}
type RegexRecord = { engines: { ecmascript: { unicode: string }; rust: { unicode: string } }; cases: RegexCase[] }
const regexRecord = JSON.parse(readFileSync(join(repo, "scripts", "regex-cases.json"), "utf8")) as RegexRecord
const regexCases = regexRecord.cases

/** The form of spec 10.7.4: `^`, an I-Regexp body with its restrictions, `$`; ECMAScript `u` compiles it. */
function patternFormProblem(pattern: string): string | undefined {
  const body = pattern.startsWith("^") && pattern.endsWith("$") && pattern.length >= 2 ? pattern.slice(1, -1) : undefined
  if (body === undefined) return "is not ^…$"
  const problem = iregexpProblem(body)
  if (problem) return problem
  try {
    new RegExp(pattern, "u")
  } catch {
    return "does not compile as an ECMAScript pattern with the u flag"
  }
  return undefined
}

/** A domain pattern: the form, and compiling with the Rust regex crate's default limits, as recorded. */
function patternProblem(pattern: string): string | undefined {
  const form = patternFormProblem(pattern)
  if (form) return form
  const recorded = regexCases.find((c) => c.pattern === pattern)
  if (!recorded) return "is not recorded in scripts/regex-cases.json, so its Rust reading is unknown"
  if (recorded.rust === "error") return "the Rust regex crate refuses it with its default limits (scripts/regex-cases.json)"
  return undefined
}

/** Whether `value` is one code point of general category `category` in this ECMAScript engine's Unicode tables. */
const hasCategory = (value: string, category: string) => new RegExp(`^\\p{${category}}$`, "u").test(value)

/**
 * The ECMAScript half of a `unicode-version` difference (spec 10.7.4): the value is the recorded single code point, the
 * pattern depends on a category, the two recorded categories differ, and this engine's tables give the code point the
 * recorded ECMAScript category and not the Rust one. scripts/regex-parity verifies the Rust half.
 */
function differenceProblem(c: RegexCase, d: UnicodeDifference): string | undefined {
  if (d.kind !== "unicode-version") return `unknown difference kind ${d.kind}`
  if (regexRecord.engines.ecmascript.unicode === regexRecord.engines.rust.unicode) return "both engines are recorded with the same Unicode version"
  const cps = [...c.value]
  const codePoint = cps.length === 1 ? `U+${cps[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` : undefined
  if (codePoint !== d.codePoint) return `the value is not the single code point ${d.codePoint}`
  if (!/\\[pP]\{/.test(c.pattern)) return "the pattern uses no Unicode category, so a table version cannot explain the difference"
  if (d.ecmascript === d.rust) return "the recorded categories are the same"
  if (!hasCategory(c.value, d.ecmascript)) return `this engine's tables do not give ${d.codePoint} the category ${d.ecmascript}`
  if (hasCategory(c.value, d.rust)) return `this engine's tables also give ${d.codePoint} the category ${d.rust}`
  return undefined
}

/**
 * Every recorded case: `form` and `ecmascript` hold, and a pattern of the form that Rust compiles agrees in both
 * engines, unless the case is a verified `unicode-version` difference. Any other disagreement is a failure, and a
 * case marked as a difference on which the engines agree is stale. The record names the Unicode version of each
 * engine; this engine must have the recorded one, or the record must be made again.
 */
function checkRegexCases(): string[] {
  const problems: string[] = []
  const running = process.versions.unicode
  if (running !== regexRecord.engines.ecmascript.unicode)
    problems.push(`the record was made with ECMAScript Unicode ${regexRecord.engines.ecmascript.unicode}, this engine has ${running}: record the cases again`)
  for (const c of regexCases) {
    const where = `${c.pattern} ${JSON.stringify(c.value)}`
    if ((patternFormProblem(c.pattern) === undefined) !== c.form) problems.push(`${where}: form is recorded as ${c.form}`)
    let observed: boolean | "error"
    try {
      observed = new RegExp(c.pattern, "u").test(c.value)
    } catch {
      observed = "error"
    }
    if (observed !== c.ecmascript) problems.push(`${where}: ECMAScript gives ${observed}, recorded ${c.ecmascript}`)
    const disagree = c.form && c.rust !== "error" && c.ecmascript !== c.rust
    if (c.difference) {
      if (!disagree) problems.push(`${where}: marked as a ${c.difference.kind} difference, but the engines agree or the case is not of the form`)
      const problem = differenceProblem(c, c.difference)
      if (problem) problems.push(`${where}: ${problem}`)
    } else if (disagree) problems.push(`${where}: the engines disagree on a pattern of the form`)
  }
  return problems
}

/** A domain uses only the profile of its argument's valueType (spec 10.7.4), checked structurally. */
function domainProblems(arg: Arg, node: JsonValue, at: string, problems: string[]) {
  const keywords = DOMAIN_KEYWORDS[arg.valueType]
  if (!keywords) return void problems.push(`${at}: a ${arg.valueType} argument has no domain (spec 10.7.4)`)
  if (!isObject(node)) return void problems.push(`${at}: a domain schema is an object`)
  const integral = arg.valueType === "integer" || arg.valueType === "count"
  for (const [k, v] of Object.entries(node)) {
    if (DOMAIN_ANNOTATIONS.includes(k)) continue
    if (!keywords.includes(k)) {
      problems.push(`${at}: keyword ${k} is outside the domain profile of ${arg.valueType} (spec 10.7.4)`)
      continue
    }
    if (NUMERIC_KEYWORDS.includes(k)) {
      // Integer and count bounds are safe integers; number and json bounds are any finite binary64 (10.7.5).
      if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${at}: ${k} is not a finite number`)
      else if (integral && !Number.isSafeInteger(v)) problems.push(`${at}: ${k} ${v} is not a safe integer (spec 10.7.5)`)
      else if (k === "multipleOf" && v <= 0) problems.push(`${at}: multipleOf is not positive`)
    }
    if (k === "pattern") {
      const problem = typeof v === "string" ? patternProblem(v) : "is not a string"
      if (problem) problems.push(`${at}: pattern ${JSON.stringify(v)}: ${problem} (spec 10.7.4)`)
    }
    if ((k === "enum" || k === "const") && [v].flat().some((x) => x !== null && typeof x === "object"))
      problems.push(`${at}: ${k} admits only scalar values in a domain (spec 10.7.4)`)
    if (k === "properties" && isObject(v)) for (const [name, child] of Object.entries(v)) domainProblems(arg, child, `${at}/properties/${name}`, problems)
    if (k === "items" || (k === "additionalProperties" && typeof v !== "boolean")) domainProblems(arg, v, `${at}/${k}`, problems)
  }
}

/** The compiled `domain` of an argument (10.7.4), cached per argument object. */
const domains = new WeakMap<Arg, ValidateFunction>()
function domainOf(arg: Arg): ValidateFunction | undefined {
  if (!arg.domain) return undefined
  let v = domains.get(arg)
  if (!v) {
    v = ajv.compile(arg.domain)
    domains.set(arg, v)
  }
  return v
}

function checkValue(where: string, arg: Arg, v: JsonValue, problems: string[]) {
  if (typeof v === "string" && PLACEHOLDER.test(v)) problems.push(`${where}: placeholder ${v}`)
  if (!validValue(arg, v)) return void problems.push(`${where}: ${JSON.stringify(v)} is not a valid ${arg.valueType} value`)
  const domain = domainOf(arg)
  if (domain && !domain(normalise(arg.valueType, v))) problems.push(`${where}: ${JSON.stringify(v)} is outside the domain of ${arg.name}: ${ajvErrors(domain)}`)
}

/** Each operand value against its operand (the last one takes the rest when variadic). */
function checkOperands(doc: CommandDoc, operands: JsonValue[], where: string, problems: string[]) {
  operands.forEach((v, i) => {
    const arg = doc.operands[Math.min(i, doc.operands.length - 1)]
    if (arg && (i < doc.operands.length || arg.variadic)) checkValue(`${where} operand ${i}`, arg, v, problems)
  })
}

/** Requirements and constraints over the explicitly given arguments (spec 10.8, 11.7 step 6). */
function checkRequirements(doc: CommandDoc, args: Args, where: string, problems: string[]) {
  const operandIndex = (name: string) => doc.operands.findIndex((o) => o.name === name)
  const given = (name: string) => args.options.has(name) || (operandIndex(name) >= 0 && args.operands.length > operandIndex(name))
  const valuesOf = (name: string): JsonValue[] => {
    const option = doc.options.find((o) => o.name === name)
    if (option) {
      const v = args.options.get(name) ?? null
      return (option.repeatable && Array.isArray(v) ? v : [v]).map((x) => normalise(option.valueType, x))
    }
    const i = operandIndex(name)
    const arg = doc.operands[i]
    return (arg.variadic ? args.operands.slice(i) : [args.operands[i] ?? null]).map((x) => normalise(arg.valueType, x))
  }
  for (const o of doc.options) if (o.required && !args.options.has(o.name)) problems.push(`${where}: required --${o.name} missing`)
  const requiredOperands = doc.operands.filter((o) => o.required).length
  if (args.operands.length < requiredOperands) problems.push(`${where}: ${requiredOperands} operand(s) required`)
  if (!doc.operands.some((o) => o.variadic) && args.operands.length > doc.operands.length) problems.push(`${where}: too many operands`)
  for (const c of doc.constraints ?? []) {
    if (c.names) {
      const n = c.names.filter(given).length
      const violated = (c.rule === "atLeastOne" && n < 1) || (c.rule === "exactlyOne" && n !== 1) || (c.rule === "atMostOne" && n > 1)
      if (violated) problems.push(`${where}: constraint ${c.rule} ${c.names} violated`)
      continue
    }
    const condition = c.if
    if (!condition || !given(condition.name)) continue
    // Spec 10.8.1: condition literals and actual values are compared after the same normalisation.
    const target = [...doc.operands, ...doc.options].find((a) => a.name === condition.name)
    const literals = (condition.in ?? []).map((x) => normalise(target?.valueType ?? "string", x))
    if (condition.in && !valuesOf(condition.name).some((v) => literals.some((l) => jsonEqual(l, v)))) continue
    for (const t of c.then ?? []) {
      if (c.rule === "requires" && !given(t)) problems.push(`${where}: ${condition.name} requires ${t}`)
      if (c.rule === "forbids" && given(t)) problems.push(`${where}: ${condition.name} forbids ${t}`)
    }
  }
}

/** The explicit arguments of one --input document: camelCase keys name options (spec 11.5). */
function documentArgs(doc: CommandDoc, item: JsonObject, where: string, problems: string[]): Args {
  const operands = item.operands
  const args: Args = { operands: Array.isArray(operands) ? operands : [], options: new Map() }
  checkOperands(doc, args.operands, where, problems)
  for (const [key, value] of Object.entries(item)) {
    if (key === "operands") continue
    const option = doc.options.find((o) => camel(o.name) === key)
    if (!option) {
      problems.push(`${where}/${key}: no such option`)
      continue
    }
    if (option.flagOnly) problems.push(`${where}/${key}: flag-only option in a document`)
    const values = option.repeatable && option.valueType !== "count" && Array.isArray(value) ? value : [value]
    for (const v of values) checkValue(`${where}/${key}`, option, v, problems)
    const absent = (option.valueType === "switch" && value === false) || (option.valueType === "count" && value === 0)
    if (!absent) args.options.set(option.name, value)
  }
  return args
}

/** Structural JSON equality: arrays by order, objects by members whatever their order, no scalar equals an array. */
function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]))
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]))
  }
  return a === b
}

/** An argument's value normalised by its valueType and cardinality (11.7 step 3). */
function normaliseArgument(arg: Arg, v: JsonValue): JsonValue {
  if (arg.repeatable && arg.valueType !== "count") return Array.isArray(v) ? v.map((x) => normalise(arg.valueType, x)) : [normalise(arg.valueType, v)]
  return normalise(arg.valueType, v)
}

/**
 * The argument object of an invocation (spec 11.7 step 6), which `argumentsRef` describes: `operands` normalised (absent
 * operands with a non-null default appended in order), then every non-flag-only option under its camelCase name with
 * its normalised explicit value, or its non-null default. Environment values are not modelled here: fixtures have none.
 */
function argumentObject(doc: CommandDoc, args: Args): JsonObject {
  const object: JsonObject = {}
  const operands = args.operands.map((v, i) => normalise(doc.operands[Math.min(i, doc.operands.length - 1)]?.valueType ?? "string", v))
  for (const o of doc.operands.slice(operands.length)) {
    if (o.default === null) break
    // A variadic operand with no explicit value contributes the elements of its default, in order (S3).
    if (o.variadic) operands.push(...(Array.isArray(o.default) ? o.default : [o.default]).map((d) => normalise(o.valueType, d)))
    else operands.push(normalise(o.valueType, o.default))
  }
  if (operands.length) object.operands = operands
  for (const o of doc.options) {
    if (o.flagOnly) continue
    const explicit = args.options.get(o.name)
    const value = explicit !== undefined ? normaliseArgument(o, explicit) : o.default
    if (value !== null) object[camel(o.name)] = value
  }
  return object
}

/**
 * Step 6 of 11.7 on the merged arguments: requirements, constraints, and the informative `argumentsRef` (10.10). A
 * validator's `rejects` invocation skips `argumentsRef`, which may describe that very validator (10.13 rule 13).
 */
const argumentSchemas = new WeakMap<CommandDoc, ValidateFunction>()
function checkArguments(doc: CommandDoc, args: Args, where: string, problems: string[], withArgumentsRef = true) {
  checkRequirements(doc, args, where, problems)
  if (!withArgumentsRef) return
  const ref = doc.input?.argumentsRef
  if (!ref || !hasSchema(doc, ref)) return
  let validate = argumentSchemas.get(doc)
  if (!validate) {
    validate = commandSchema(doc, ref)
    argumentSchemas.set(doc, validate)
  }
  if (!validate(argumentObject(doc, args))) problems.push(`${where}: the argument object fails argumentsRef: ${ajvErrors(validate)}`)
}

/** Compares a document's arguments with argv's and merges them (spec 11.7 steps 3-4). */
function mergeArgs(argv: Args, document: Args, where: string, problems: string[], doc: CommandDoc): Args {
  if (argv.operands.length && document.operands.length) {
    const normaliseOperands = (ops: JsonValue[]) => ops.map((v, i) => normalise(doc.operands[Math.min(i, doc.operands.length - 1)]?.valueType ?? "string", v))
    if (!jsonEqual(normaliseOperands(argv.operands), normaliseOperands(document.operands))) problems.push(`${where}: INPUT_CONFLICT on /operands`)
  }
  const options = new Map(argv.options)
  for (const [name, v] of document.options) {
    const option = doc.options.find((o) => o.name === name)
    const previous = options.get(name)
    if (option && previous !== undefined && !jsonEqual(normaliseArgument(option, previous), normaliseArgument(option, v)))
      problems.push(`${where}: INPUT_CONFLICT on /${camel(name)}`)
    options.set(name, v)
  }
  return { operands: argv.operands.length ? argv.operands : document.operands, options }
}

/** Parses a documented invocation by the grammar of spec 9.12 against a command document (10.13 rule 12). */
function parseInvocation(doc: CommandDoc, tool: string, line: string, problems: string[], withArgumentsRef = true) {
  const where = `example ${JSON.stringify(line)}`
  let words: string[]
  try {
    words = shellWords(line)
  } catch (e) {
    return void problems.push(`${where}: ${(e as Error).message}`)
  }
  if (words.some((w) => PLACEHOLDER.test(w))) return void problems.push(`${where}: placeholder or ellipsis`)
  if (words[0] !== tool) return void problems.push(`${where}: does not start with ${tool}`)
  if (words.slice(1, 1 + doc.path.length).join(" ") !== doc.command) return void problems.push(`${where}: path is not ${doc.command}`)
  const args: Args = { operands: [], options: new Map() }
  let documents: Args[] | undefined
  const rest = words.slice(1 + doc.path.length)
  const plain = (w: string | undefined) => w !== undefined && (w === "-" || (w !== "" && !w.startsWith("-")))
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]
    if (word === "--") {
      args.operands.push(...rest.slice(i + 1))
      break
    }
    if (plain(word)) {
      args.operands.push(word)
      continue
    }
    let option: Arg | undefined
    let value: string | undefined
    let joined = false
    if (word.startsWith("--")) {
      const [name, ...eq] = word.slice(2).split("=")
      option = doc.options.find((o) => o.name === name)
      if (eq.length) {
        joined = true
        value = eq.join("=")
      }
    } else if (/^-[A-Za-z]$/.test(word)) {
      option = doc.options.find((o) => o.short === word.slice(1))
    }
    if (!option) {
      problems.push(`${where}: unknown option ${word}`)
      continue
    }
    if (option.valueType === "switch" || option.valueType === "count") {
      if (joined) problems.push(`${where}: --${option.name} takes no value`)
      const previous = args.options.get(option.name)
      args.options.set(option.name, option.valueType === "count" ? (typeof previous === "number" ? previous : 0) + 1 : true)
      continue
    }
    if (!joined) {
      if (!plain(rest[i + 1])) {
        problems.push(`${where}: --${option.name} needs a value (a value starting with "-" needs --${option.name}=…)`)
        continue
      }
      value = rest[++i]
    }
    const text = value ?? ""
    if (option.name === "input") {
      if (documents) problems.push(`${where}: --input given twice`)
      documents = inlineDocuments(doc, text, `${where} --input`, problems)
      continue
    }
    let typed: JsonValue = text
    if (option.valueType === "json") {
      try {
        typed = JSON.parse(text)
      } catch {
        problems.push(`${where}: --${option.name} is not JSON`)
      }
    }
    checkValue(`${where} --${option.name}`, option, typed, problems)
    const previous = args.options.get(option.name)
    if (option.repeatable) args.options.set(option.name, [...(Array.isArray(previous) ? previous : []), typed])
    else if (previous !== undefined) problems.push(`${where}: --${option.name} given twice`)
    else args.options.set(option.name, typed)
  }
  // A count's value is its number of occurrences, known only once every word is read (10.7.2).
  for (const o of doc.options) {
    const n = args.options.get(o.name)
    if (o.valueType === "count" && n !== undefined) checkValue(`${where} --${o.name}`, o, n, problems)
  }
  const typedOperands = args.operands.map((v, i) => {
    const arg = doc.operands[Math.min(i, doc.operands.length - 1)]
    if (arg?.valueType !== "json" || typeof v !== "string") return v
    try {
      return JSON.parse(v) as JsonValue
    } catch {
      problems.push(`${where}: operand ${i} is not JSON`)
      return v
    }
  })
  checkOperands(doc, typedOperands, where, problems)
  const argv = { ...args, operands: typedOperands }
  // Spec 11.7: each document is merged with the argv arguments and validated as a complete invocation.
  for (const [i, document] of (documents ?? [undefined]).entries()) {
    const at = documents && documents.length > 1 ? `${where} item ${i}` : where
    checkArguments(doc, document ? mergeArgs(argv, document, at, problems, doc) : argv, at, problems, withArgumentsRef)
  }
}

/** Frames and validates an inline `--input` value of an example as spec 11.2-11.7 say (10.13 rule 12). */
function inlineDocuments(doc: CommandDoc, text: string, where: string, problems: string[]): Args[] | undefined {
  if (!/^\s*[{[]/.test(text)) return void problems.push(`${where}: an example must not read stdin or a file (--input ${text})`)
  if (!doc.input) return void problems.push(`${where}: the command declares no input`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return void problems.push(`${where}: not JSON`)
  }
  if (!V.input(parsed)) return void problems.push(`${where}: ${ajvErrors(V.input)}`)
  const value = parsed as JsonObject | JsonObject[]
  if (Array.isArray(value)) {
    if (!doc.input.batch) return void problems.push(`${where}: a batch, but ${doc.command} takes no batch (spec 11.4)`)
    if (value.length > (doc.input.maxItems ?? 0)) problems.push(`${where}: a batch over maxItems`)
  }
  const fragment = commandSchema(doc, doc.input.schemaRef)
  return (Array.isArray(value) ? value : [value]).map((item, i) => {
    const at = Array.isArray(value) ? `${where} /${i}` : where
    if (!fragment(item)) problems.push(`${at}: fragment: ${ajvErrors(fragment)}`)
    return documentArgs(doc, item, at, problems)
  })
}

// ---- projection (spec 6.10) ----
/** The decoded segments of an RFC 6901 pointer (`~1` is `/`, `~0` is `~`). */
const decodePointer = (pointer: string) => pointer.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))

/**
 * The steps of a field path (spec 6.10): `.name`, or since 1.1 a bracketed JSON string `["a.b"]` for a member
 * whose name is not an identifier, each optionally followed by `[]`. Undefined when the path is malformed.
 */
type Step = { name: string; array: boolean; bracket: boolean }
function parseFieldPath(path: string): Step[] | undefined {
  const steps: Step[] = []
  let i = 0
  while (i < path.length) {
    let name = ""
    let bracket = false
    if (path.startsWith('["', i)) {
      let j = i + 2
      for (; j < path.length && path[j] !== '"'; j++) {
        if (path[j] === "\\") {
          if (path[j + 1] !== '"' && path[j + 1] !== "\\") return undefined
          j++
        }
        name += path[j]
      }
      if (!path.startsWith('"]', j) || name === "") return undefined
      bracket = true
      i = j + 2
    } else {
      if (steps.length) {
        if (path[i] !== ".") return undefined
        i++
      }
      name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(path.slice(i))?.[0] ?? ""
      if (!name) return undefined
      i += name.length
    }
    const array = path.startsWith("[]", i)
    if (array) i += 2
    steps.push({ name, array, bracket })
  }
  return steps.length ? steps : undefined
}
const stepNames = (path: string) => (parseFieldPath(path) ?? []).map((s) => s.name)

/** Spec 10.13 rule 15: brackets exactly for names that are not identifiers. */
function fieldPathProblem(path: string): string | undefined {
  const steps = parseFieldPath(path)
  if (!steps) return `field path ${path} is malformed (spec 6.10)`
  const named = steps.find((s) => s.bracket && IDENT.test(s.name))
  if (named) return `field path ${path} writes the identifier ${named.name} in brackets (spec 10.13 rule 15)`
  return undefined
}

/** A trie of field paths: a member maps to WHOLE (covered, kept entirely) or to the trie of its kept descendants. */
const WHOLE = "whole"
type Trie = Map<string, Trie | typeof WHOLE>
function fieldTrie(paths: string[]): Trie {
  const root: Trie = new Map()
  for (const path of paths) {
    const segments = stepNames(path)
    let node = root
    for (const [i, segment] of segments.entries()) {
      const existing = node.get(segment)
      if (existing === WHOLE) break // an ancestor is covered: this path adds nothing (rule 2)
      if (i === segments.length - 1) {
        node.set(segment, WHOLE) // covers the member, replacing any narrower selection below it
        break
      }
      const child: Trie = existing ?? new Map()
      node.set(segment, child)
      node = child
    }
  }
  return root
}

/** Members present that no kept path covers and that are not ancestors of a kept path (rules 2-3). */
function leaks(value: JsonValue, trie: Trie, at: string, found: string[]) {
  if (Array.isArray(value)) return value.forEach((v, i) => leaks(v, trie, `${at}/${i}`, found))
  if (!isObject(value)) return
  for (const [k, v] of Object.entries(value)) {
    const child = trie.get(k)
    if (child === undefined) found.push(`${at}/${k}`)
    else if (child !== WHOLE) leaks(v, child, `${at}/${k}`, found)
  }
}

/** Follows `$ref`s to the schema they name. */
function deref(schemas: Record<string, SchemaNode>, node: SchemaNode | undefined): SchemaNode | undefined {
  let current = node
  for (let i = 0; i < 16 && isObject(current) && typeof current.$ref === "string" && current.$ref.startsWith("#/schemas/"); i++)
    current = schemas[refName(current.$ref)]
  return current
}

/** The non-null branch of a null-admitting `anyOf`, or the node itself. */
function nonNull(schemas: Record<string, SchemaNode>, node: SchemaNode | undefined): SchemaNode | undefined {
  const n = deref(schemas, node)
  if (isObject(n) && Array.isArray(n.anyOf)) return deref(schemas, n.anyOf.find((b) => !(isObject(b) && b.type === "null")) as SchemaNode)
  return n
}

const typesOf = (node: JsonObject) => [node.type].flat().filter((t): t is string => typeof t === "string")

/**
 * Checks that every cut node along `trie` is projectable (spec 6.10, 10.13 rule 11). The caller passes the output's
 * root schema and a trie that starts with the decoded `fields.records` segments, so the spine above the records is
 * checked as well as the records, the record and the ancestors of every declared path.
 */
function checkCut(schemas: Record<string, SchemaNode>, node: SchemaNode | undefined, trie: Trie, at: string, problems: string[]) {
  if (node === undefined) return // a member the schema does not declare: rule 11's path check reports it
  if (!isObject(node)) return void problems.push(`${at}: the boolean schema ${node} is not a projectable cut node (spec 6.10)`)
  const annotationsOnly = (allowed: string) =>
    Object.keys(node).filter((k) => k !== allowed && !ANNOTATIONS.includes(k)).forEach((k) => problems.push(`${at}: keyword ${k} beside ${allowed} in a cut node (spec 6.10)`))
  if (typeof node.$ref === "string") {
    annotationsOnly("$ref")
    return checkCut(schemas, deref(schemas, node), trie, at, problems)
  }
  if (node.anyOf !== undefined) {
    annotationsOnly("anyOf")
    const branches = Array.isArray(node.anyOf) ? node.anyOf : []
    const isNull = (b: JsonValue) => isObject(b) && b.type === "null" && Object.keys(b).length === 1
    if (branches.length !== 2 || branches.filter(isNull).length !== 1) return void problems.push(`${at}: anyOf in a cut node must be exactly one schema and {"type":"null"}`)
    return checkCut(schemas, branches.find((b) => !isNull(b)) as SchemaNode, trie, at, problems)
  }
  const types = typesOf(node)
  if (!types.length) return void problems.push(`${at}: a cut node declares no type (spec 6.10)`)
  if (types.includes("array") || node.items !== undefined) {
    for (const k of Object.keys(node)) if (!CUT_ARRAY[k]) problems.push(`${at}: keyword ${k} in an array cut node (spec 6.10)`)
    if (types.some((t) => t !== "array" && t !== "null")) problems.push(`${at}: an array cut node admits ${types}`)
    return checkCut(schemas, node.items as SchemaNode, trie, `${at}[]`, problems)
  }
  for (const k of Object.keys(node)) if (!CUT_OBJECT[k]) problems.push(`${at}: keyword ${k} in an object cut node (spec 6.10)`)
  if (types.some((t) => t !== "object" && t !== "null")) problems.push(`${at}: an object cut node admits ${types}`)
  const props = isObject(node.properties) ? node.properties : {}
  for (const [member, child] of trie) if (child !== WHOLE) checkCut(schemas, props[member] as SchemaNode, child, `${at}.${member}`, problems)
}

/** The schema at the `records` pointer of an output schema (the record array, or the record). */
function recordsSchema(schemas: Record<string, SchemaNode>, output: Output): SchemaNode | undefined {
  let node = nonNull(schemas, schemas[refName(output.schemaRef)])
  for (const segment of decodePointer(output.fields?.records ?? "")) {
    const props = isObject(node) && isObject(node.properties) ? node.properties : {}
    node = props[segment] as SchemaNode | undefined
    node = nonNull(schemas, node)
  }
  return node
}

/** The record schema: the items of the records array, or the records schema itself. */
function recordSchema(schemas: Record<string, SchemaNode>, output: Output): SchemaNode | undefined {
  const node = recordsSchema(schemas, output)
  return isObject(node) && node.items !== undefined ? nonNull(schemas, node.items as SchemaNode) : node
}

/**
 * The schema a field path names: a member the record schema declares, reached through an array only with `[]`; a
 * last step without `[]` may name a whole array (spec 6.10). Undefined when the path is not declared.
 */
function pathNode(schemas: Record<string, SchemaNode>, record: SchemaNode | undefined, path: string): SchemaNode | undefined {
  let node = record
  const steps = parseFieldPath(path)
  if (!steps) return undefined
  for (const [i, step] of steps.entries()) {
    const props = isObject(node) && isObject(node.properties) ? node.properties : undefined
    if (!props || !(step.name in props)) return undefined
    node = nonNull(schemas, props[step.name] as SchemaNode)
    const isArray = isObject(node) && (typesOf(node).includes("array") || node.items !== undefined)
    if (step.array !== isArray && (step.array || i < steps.length - 1)) return undefined
    if (isArray && isObject(node)) node = nonNull(schemas, node.items as SchemaNode)
  }
  return node ?? true
}
const pathDeclared = (schemas: Record<string, SchemaNode>, record: SchemaNode | undefined, path: string) =>
  pathNode(schemas, record, path) !== undefined

/** A map (spec 6.10): an object schema whose `additionalProperties` is a schema and that has no `properties`. */
const isMap = (node: SchemaNode | undefined) =>
  isObject(node) && node.properties === undefined && node.additionalProperties !== undefined && node.additionalProperties !== false

/** The declared map path a selected path extends by one key, if it is a map-key selection (spec 6.10). */
function mapKeyOf(doc: CommandDoc, output: Output, path: string): string | undefined {
  const steps = parseFieldPath(path)
  if (!steps || steps.length < 2 || steps.at(-1)?.array) return undefined
  const record = recordSchema(doc.schemas, output)
  const declared = [...(output.fields?.paths ?? []), ...(output.fields?.keep ?? [])]
  const prefix = JSON.stringify(steps.slice(0, -1).map((s) => [s.name, s.array]))
  return declared.find((d) => {
    const ds = parseFieldPath(d)
    return ds && JSON.stringify(ds.map((s) => [s.name, s.array])) === prefix && isMap(pathNode(doc.schemas, record, d))
  })
}

/**
 * The output schema with `required` reduced in every object cut node along the kept paths (spec 6.10). Cut nodes are
 * inlined (cloned) so shared definitions are not changed, and null-admitting unions are kept around the projected
 * branch.
 */
function projectedSchema(doc: CommandDoc, output: Output, trie: Trie): ValidateFunction {
  return commandSchema(doc, output.schemaRef, (schemas) => {
    const project = (node: SchemaNode | undefined, keep: Trie): SchemaNode | undefined => {
      const target = structuredClone(deref(schemas, node))
      if (!isObject(target)) return target
      if (Array.isArray(target.anyOf)) {
        target.anyOf = target.anyOf.map((b) => (isObject(b) && b.type === "null" ? b : (project(b as SchemaNode, keep) as JsonValue)))
        return target
      }
      if (target.items !== undefined) {
        target.items = project(target.items as SchemaNode, keep) as JsonValue
        return target
      }
      if (Array.isArray(target.required)) target.required = target.required.filter((r) => keep.has(String(r)))
      const props = isObject(target.properties) ? target.properties : {}
      for (const [member, child] of keep) if (child !== WHOLE && member in props) props[member] = project(props[member] as SchemaNode, child) as JsonValue
      return target
    }
    // Clone along the records pointer without reducing anything above the records, then project from there.
    const descend = (node: SchemaNode | undefined, segments: string[]): SchemaNode | undefined => {
      if (!segments.length) return project(node, trie)
      const target = structuredClone(deref(schemas, node))
      if (!isObject(target)) return target
      if (Array.isArray(target.anyOf)) {
        target.anyOf = target.anyOf.map((b) => (isObject(b) && b.type === "null" ? b : (descend(b as SchemaNode, segments) as JsonValue)))
        return target
      }
      const props = isObject(target.properties) ? target.properties : {}
      const [head, ...tail] = segments
      if (head in props) props[head] = descend(props[head] as SchemaNode, tail) as JsonValue
      return target
    }
    const name = refName(output.schemaRef)
    schemas[name] = descend(schemas[name], decodePointer(output.fields?.records ?? "")) ?? schemas[name]
  })
}

// ---- self-description (spec 10.13) ----
function checkCommandDoc(doc: CommandDoc, tool: string, problems: string[]) {
  const all = [...doc.operands, ...doc.options]
  // Rule 9: names and short letters are unique.
  const names = new Set<string>()
  for (const a of all) {
    if (names.has(a.name)) problems.push(`duplicate argument name ${a.name}`)
    names.add(a.name)
  }
  const shorts = doc.options.flatMap((o) => (o.short ? [o.short] : []))
  if (new Set(shorts).size !== shorts.length) problems.push("duplicate short option letter")
  // Rule 1.
  if (doc.command !== doc.path.join(" ")) problems.push(`command ${doc.command} is not path ${doc.path.join(" ")}`)
  // Rule 2: refs resolve by membership; every schema compiles; outputs do not share a schemaRef.
  const refs = [...doc.outputs.flatMap((o) => [o.schemaRef, o.eventRef]), doc.input?.schemaRef, doc.input?.argumentsRef]
  for (const ref of refs) if (ref && !hasSchema(doc, ref)) problems.push(`${ref} does not resolve in schemas`)
  for (const name of Object.keys(doc.schemas)) {
    try {
      commandSchema(doc, `#/schemas/${name}`)
    } catch (e) {
      problems.push(`schemas.${name} does not compile: ${(e as Error).message.split("\n")[0]}`)
    }
  }
  const outputRefs = doc.outputs.map((o) => o.schemaRef)
  if (new Set(outputRefs).size !== outputRefs.length) problems.push("two outputs share a schemaRef")
  // Rule 3: defaults valid and in their domains; domains within the profile of 10.7.4.
  for (const a of all) {
    if (a.valueType === "enum" && a.default !== null)
      for (const d of [a.default].flat()) if (!a.possibleValues?.includes(String(d))) problems.push(`default ${d} of ${a.name} not in possibleValues`)
    if (a.domain) {
      const before = problems.length
      domainProblems(a, a.domain, `the domain of ${a.name}`, problems)
      if (problems.length > before) continue
      try {
        domainOf(a)
      } catch (e) {
        problems.push(`the domain of ${a.name} does not compile: ${(e as Error).message.split("\n")[0]}`)
        continue
      }
    }
    // A count's default is one integer, not an array (10.7.2), and is checked like any other (S2).
    const defaults = a.default === null ? [] : a.valueType !== "count" && (a.repeatable || a.variadic) && Array.isArray(a.default) ? a.default : [a.default]
    for (const d of defaults) checkValue(`default of ${a.name}`, a, d, problems)
  }
  // Rule 4.
  const relations = new Map<string, number>()
  for (const [index, c] of (doc.constraints ?? []).entries()) {
    for (const n of [...(c.names ?? []), ...(c.if ? [c.if.name] : []), ...(c.then ?? [])])
      if (!names.has(n)) problems.push(`constraint names unknown argument ${n}`)
    const target = c.if && all.find((a) => a.name === c.if?.name)
    if (target && c.if?.in) {
      if (target.valueType === "switch" || target.valueType === "count") problems.push(`constraint uses in on ${target.valueType} ${target.name}`)
      else for (const v of c.if.in) checkValue(`constraint value for ${target.name}`, target, v, problems)
    }
    if (c.code && !doc.errors.includes(c.code)) problems.push(`constraint code ${c.code} not in errors`)
    // The same relation twice, whatever the order of its names or values and whatever its code (10.8.2).
    const sorted = (xs: JsonValue[] | undefined) => xs && [...xs].map((x) => JSON.stringify(normalise(target?.valueType ?? "string", x))).sort()
    const key = JSON.stringify([c.rule, sorted(c.names), c.if?.name, sorted(c.if?.in), sorted(c.then)])
    const earlier = relations.get(key)
    if (earlier !== undefined) problems.push(`constraint ${index} repeats constraint ${earlier} (spec 10.8.2)`)
    else relations.set(key, index)
  }
  // Rule 4: a command lists the reserved code of each feature it offers (7.2.1).
  const has = (name: string) => doc.options.some((o) => o.name === name)
  const featureCodes: [boolean, string[]][] = [
    [doc.input !== undefined, ["INPUT_INVALID", "INPUT_CONFLICT", "INPUT_TOO_LARGE"]],
    [doc.input?.batch === true, ["BATCH_INCOMPLETE"]],
    [has("commit"), ["PLAN_STALE"]],
    [has("operation"), ["OPERATION_REUSED"]],
    [has("cursor"), ["CURSOR_INVALID"]],
  ]
  for (const [offered, codes] of featureCodes) if (offered) for (const c of codes) if (!doc.errors.includes(c)) problems.push(`${doc.command} offers the feature of ${c} but does not list it in errors (spec 7.2.1)`)
  // Rule 13: stateless validators (10.8.3).
  for (const v of doc.validators ?? []) {
    for (const n of v.arguments) if (!names.has(n)) problems.push(`validator names unknown argument ${n}`)
    if (!doc.errors.includes(v.code)) problems.push(`validator code ${v.code} not in errors`)
    const entry = registered(tool, v.code)
    if (entry && entry.exit !== 2) problems.push(`validator code ${v.code} exits ${entry.exit}, not 2 (spec 10.8.3)`)
    for (const line of v.rejects) {
      if (doc.examples.includes(line)) problems.push(`validator rejects example ${JSON.stringify(line)} is also a valid example`)
      const before: string[] = []
      parseInvocation(doc, tool, line, before, false)
      if (before.length) problems.push(`validator rejects example fails before the validator: ${before[0]}`)
    }
  }
  // Rule 6.
  const keys = doc.outputs.map((o) => `${o.batch ? "batch" : ""}|${o.when ?? ""}`)
  if (new Set(keys).size !== keys.length) problems.push("outputs not distinguished by when or batch")
  // Rule 8.
  const reservedShape: Record<string, string> = {
    json: "switch", commit: "switch", all: "switch", input: "string", "plan-digest": "string",
    cursor: "string", fields: "string", operation: "string", limit: "integer",
  }
  for (const o of doc.options) {
    if (reservedShape[o.name] && o.valueType !== reservedShape[o.name]) problems.push(`reserved option --${o.name} must be ${reservedShape[o.name]}`)
    if (FLAG_ONLY.includes(o.name) && o.flagOnly !== true) problems.push(`--${o.name} must be flagOnly`)
  }
  // Rule 10: the fragment contract.
  if (doc.input) {
    const fragment = deref(doc.schemas, doc.schemas[refName(doc.input.schemaRef)])
    if (!isObject(fragment)) problems.push("the fragment schema is not an object schema")
    else {
      if (fragment.required !== undefined) problems.push("the fragment schema has a root required list (spec 10.10)")
      if (fragment.additionalProperties !== false) problems.push("the fragment schema does not set additionalProperties: false")
      const allowed = new Set(["operands", ...doc.options.filter((o) => !o.flagOnly).map((o) => camel(o.name))])
      for (const key of Object.keys(isObject(fragment.properties) ? fragment.properties : {}))
        if (!allowed.has(key)) problems.push(`the fragment schema has property ${key}, which is not a document key`)
    }
  }
  // Rule 11: fields.
  for (const o of doc.outputs) {
    if (!o.fields) continue
    const record = recordSchema(doc.schemas, o)
    const declared = [...o.fields.paths, ...(o.fields.keep ?? [])]
    // Cut nodes (6.10): every schema from the output root to a selectable field. The trie starts with the decoded
    // records segments; below the records it holds every proper ancestor of a declared path, and every declared
    // map, whose keys are selectable.
    const ancestors: Trie = new Map()
    for (const p of declared) {
      const names = stepNames(p)
      const map = isMap(pathNode(doc.schemas, record, p))
      let node = ancestors
      for (const segment of map ? names : names.slice(0, -1)) {
        const existing = node.get(segment)
        const child: Trie = existing instanceof Map ? existing : new Map()
        node.set(segment, child)
        node = child
      }
    }
    const records = decodePointer(o.fields.records)
    const spine = records.reduceRight<Trie>((below, segment) => new Map([[segment, below]]), ancestors)
    let at: SchemaNode | undefined = nonNull(doc.schemas, doc.schemas[refName(o.schemaRef)])
    for (const segment of records) {
      const props = isObject(at) && isObject(at.properties) ? at.properties : undefined
      if (!props || !(segment in props)) {
        problems.push(`fields.records ${o.fields.records} does not lead through declared members`)
        at = undefined
        break
      }
      at = nonNull(doc.schemas, props[segment] as SchemaNode)
    }
    if (at !== undefined) checkCut(doc.schemas, doc.schemas[refName(o.schemaRef)], spine, refName(o.schemaRef), problems)
    for (const d of o.fields.default ?? []) if (!o.fields.paths.includes(d)) problems.push(`fields.default ${d} is not in fields.paths`)
    for (const k of o.fields.keep ?? []) if (o.fields.paths.includes(k)) problems.push(`fields.keep ${k} is also in fields.paths`)
    for (const p of declared) {
      const problem = fieldPathProblem(p)
      if (problem) problems.push(problem)
      else if (!pathDeclared(doc.schemas, record, p)) problems.push(`field path ${p} is not declared by the record schema`)
    }
  }
  // Rules 7 and 12.
  for (const example of doc.examples) parseInvocation(doc, tool, example, problems)
  if (doc.input) {
    const fragment = commandSchema(doc, doc.input.schemaRef)
    if (!fragment(doc.input.example)) problems.push(`input.example fails the fragment schema: ${ajvErrors(fragment)}`)
    checkArguments(doc, documentArgs(doc, doc.input.example, "/input/example", problems), "input.example", problems)
  }
}

// ---- the valid command documents and registries of the examples, by tool ----
const exampleDir = join(repo, "examples")
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
const commandDocs = new Map<string, CommandDoc>()
const registries = new Map<string, RegistryEntry[]>()
const warningRegistries = new Map<string, WarningEntry[]>()
for (const f of readdirSync(exampleDir).filter((f) => f.startsWith("schema-") && f.endsWith(".json"))) {
  const answer = readJson(join(exampleDir, f)) as { data: SchemaData; meta: Meta }
  if (answer.data.kind === "command") commandDocs.set(`${answer.meta.tool} ${answer.data.command}`, answer.data)
  if (answer.data.kind === "errors") registries.set(answer.meta.tool, answer.data.errors)
  if (answer.data.kind === "warnings") warningRegistries.set(answer.meta.tool, answer.data.warnings)
}
/** The registry entry of an error code: the tool's own row (with its reasons), else the reserved code's (7.2.1). */
const registered = (tool: string, code: string): RegistryEntry | undefined =>
  registries.get(tool)?.find((e) => e.code === code) ?? (RESERVED[code] ? { code, ...RESERVED[code] } : undefined)
const warningRegistered = (tool: string, code: string) => warningRegistries.get(tool)?.some((e) => e.code === code) ?? false

// ---- the contract minor a document declares (spec 15.7, 10.13 rule 16) ----
const declaredMinor = (meta: Meta) => meta.contractVersion ?? "1.0"
/** Whether the document may use the 1.1 additions; reports a minor this repository does not describe. */
function minorOf(meta: Meta, problems: string[]): boolean {
  const minor = declaredMinor(meta)
  if (!MINORS.includes(minor)) problems.push(`contractVersion ${minor} is not a minor this repository describes (spec 15.7)`)
  return minor !== "1.0"
}
const since11 = (allowed: boolean, what: string, problems: string[]) =>
  allowed || problems.push(`${what} is since 1.1, but the document declares contract 1.0 (spec 10.13 rule 16)`)

// ---- per-kind checks ----
function checkSchemaAnswer(value: unknown, problems: string[]) {
  const answer = value // ajv's guard narrows its argument to never on failure; inspect the alias instead
  if (!V.schemaDoc(value)) {
    // Report the errors of the branch `data.kind` selects, not of every oneOf branch.
    const data = answer && typeof answer === "object" && "data" in answer ? answer.data : undefined
    const kind = data && typeof data === "object" && "kind" in data ? data.kind : undefined
    const branch = typeof kind === "string" && ["tree", "group", "command", "errors", "error", "warnings", "warning"].includes(kind)
      ? ajv.compile({ $ref: `https://atip.dev/1/schema-doc.schema.json#/$defs/${kind}` })
      : undefined
    const detail = branch && !branch(data) ? `/data: ${ajvErrors(branch)}` : ajvErrors(V.schemaDoc)
    return void problems.push(`schema-doc: ${detail}`)
  }
  const { data, meta } = value as { data: SchemaData; meta: Meta }
  const v11 = minorOf(meta, problems)
  if (meta.schemaVersion !== declaredMinor(meta))
    problems.push(`a schema answer's schemaVersion ${meta.schemaVersion} is not its contract version ${declaredMinor(meta)} (spec 10.1.4)`)
  if (data.kind === "warnings" || data.kind === "warning") since11(v11, `data.kind ${data.kind}`, problems)
  if (data.kind === "command") {
    for (const o of data.outputs)
      for (const p of [...(o.fields?.paths ?? []), ...(o.fields?.keep ?? []), ...(o.fields?.default ?? [])])
        if (parseFieldPath(p)?.some((s) => s.bracket)) since11(v11, `the bracketed field path ${p}`, problems)
    checkCommandDoc(data, meta.tool, problems)
  }
  if (data.kind === "group" && data.command !== data.path.join(" ")) problems.push(`group ${data.command} is not its path ${data.path.join(" ")}`)
  if (data.kind === "tree" || data.kind === "group") {
    const parent = data.kind === "group" ? data.path : []
    for (const e of data.commands) {
      if (e.command !== e.path.join(" ")) problems.push(`tree entry ${e.command} is not its path`)
      if (parent.length && (e.path.length !== parent.length + 1 || parent.some((p, i) => e.path[i] !== p)))
        problems.push(`${e.command} is not a direct child of ${parent.join(" ")}`)
    }
    if (data.kind === "tree" && !data.query) {
      const seen = new Set<string>()
      for (const e of data.commands) {
        if (e.path.length > 1 && !seen.has(e.path.slice(0, -1).join(" "))) problems.push(`${e.command} listed before its group`)
        seen.add(e.command)
      }
    }
  }
  if (data.kind === "errors" || data.kind === "error") {
    const entries = data.kind === "errors" ? data.errors : [data.error]
    // Rule 14: codes once, reserved codes as reserved, reasons once within their code.
    const seen = new Set<string>()
    for (const e of entries) {
      if (seen.has(e.code)) problems.push(`code ${e.code} is registered twice (spec 10.13 rule 14)`)
      seen.add(e.code)
      const reserved = RESERVED[e.code]
      if (reserved && (reserved.exit !== e.exit || reserved.retryable !== e.retryable)) problems.push(`reserved ${e.code} has the wrong exit or retryable`)
      if (e.reasons) since11(v11, `the reasons of ${e.code}`, problems)
      const reasons = (e.reasons ?? []).map((r) => r.reason)
      for (const r of new Set(reasons.filter((r, i) => reasons.indexOf(r) !== i))) problems.push(`reason ${r} appears twice under ${e.code} (spec 7.6.1)`)
    }
  }
  if (data.kind === "errors") {
    const codes = new Set(data.errors.map((e) => e.code))
    const needed = new Set(ALWAYS)
    for (const [key, doc] of commandDocs) if (key.startsWith(`${meta.tool} `)) for (const c of doc.errors) needed.add(c)
    for (const c of needed) if (!codes.has(c)) problems.push(`registry lacks ${c}`)
  }
  if (data.kind === "warnings") {
    const codes = data.warnings.map((w) => w.code)
    for (const c of new Set(codes.filter((c, i) => codes.indexOf(c) !== i))) problems.push(`warning ${c} is registered twice (spec 10.13 rule 14)`)
  }
}

function checkInput(file: string, value: unknown, problems: string[]) {
  if (!V.input(value)) return void problems.push(`input-document: ${ajvErrors(V.input)}`)
  const stem = basename(file).replace(/^input-/, "").replace(/\.json$/, "")
  const key = [...commandDocs.keys()].find((k) => stem === k.replace(/ /g, "-") || stem.startsWith(`${k.replace(/ /g, "-")}-`))
  const doc = key ? commandDocs.get(key) : undefined
  if (!doc?.input) return
  const document = value as JsonObject | JsonObject[]
  const items = Array.isArray(document) ? document : [document]
  const complete = !basename(file).includes("fragment")
  if (Array.isArray(document) && !doc.input.batch) problems.push(`${doc.command} takes no batch (spec 11.4)`)
  if (Array.isArray(document) && document.length > (doc.input.maxItems ?? 0)) problems.push("batch over maxItems")
  const fragment = commandSchema(doc, doc.input.schemaRef)
  // A complete document is validated as an invocation: argumentsRef sees its normalised argument object (S1).
  items.forEach((item, i) => {
    const where = Array.isArray(document) ? `/${i}` : ""
    if (!fragment(item)) problems.push(`${where || "/"} fragment: ${ajvErrors(fragment)}`)
    const args = documentArgs(doc, item, where, problems)
    if (complete) checkArguments(doc, args, where || "/", problems)
  })
}

/** Spec 6.8: `command` splits, as a POSIX shell would, into the tool name followed by `argv`. */
function checkNext(meta: Meta, problems: string[]) {
  for (const n of meta.next ?? []) {
    if (!n.argv.includes("--json")) problems.push(`next ${n.command} drops --json (spec 6.8)`)
    if (n.argv.some((w) => PLACEHOLDER.test(w))) problems.push(`next ${n.command} has a placeholder (spec 6.8)`)
    let words: string[] = []
    try {
      words = shellWords(n.command)
    } catch (e) {
      problems.push(`next ${n.command}: ${(e as Error).message}`)
    }
    if (JSON.stringify(words) !== JSON.stringify([meta.tool, ...n.argv])) problems.push(`next command ${JSON.stringify(n.command)} does not match its argv (spec 6.8)`)
  }
  const cursor = meta.page?.nextCursor
  if (cursor && !(meta.next ?? []).some((n) => n.argv.some((w, i) => (w === "--cursor" && n.argv[i + 1] === cursor) || w === `--cursor=${cursor}`)))
    problems.push("page.nextCursor without a next entry carrying that cursor (spec 6.9)")
}

/** Spec 7.3.2-7.3.3 and 7.6.2: a code is registered, its exit and retryability are the registry's, its reason too. */
function checkCode(tool: string, error: ErrorBody, at: string, problems: string[]): number | undefined {
  const entry = registered(tool, error.code)
  if (!entry) return void problems.push(`${at}${error.code} is not registered`)
  if (entry.retryable !== error.retryable) problems.push(`${at}${error.code} retryable is ${error.retryable}, the registry says ${entry.retryable}`)
  checkReason(tool, error, at, problems)
  return entry.exit
}

/** Spec 7.6.2: a reason is registered under its code. */
function checkReason(tool: string, error: { code: string; reason?: string }, at: string, problems: string[]) {
  if (error.reason === undefined) return
  const entry = registered(tool, error.code)
  if (entry && !(entry.reasons ?? []).some((r) => r.reason === error.reason))
    problems.push(`${at}reason ${error.reason} is not registered under ${error.code} (spec 7.6.2)`)
}

function checkEnvelope(value: unknown, problems: string[], stream?: { output?: Output }) {
  if (!V.envelope(value)) return void problems.push(`envelope: ${ajvErrors(V.envelope)}`)
  const env = value as Envelope
  const meta = env.meta
  const v11 = minorOf(meta, problems)
  checkNext(meta, problems)
  if (env.error) {
    const exit = checkCode(meta.tool, env.error, "", problems)
    if (exit === 2 && env.data !== undefined) problems.push(`refusal ${env.error.code} carries data (spec 6.4)`)
    if (env.error.code === "BATCH_INCOMPLETE" && env.data === undefined) problems.push("BATCH_INCOMPLETE without the batch report (spec 11.11)")
    if (env.error.reason !== undefined) since11(v11, "error.reason", problems)
    for (const [i, d] of (env.error.details ?? []).entries()) {
      if (!registered(meta.tool, d.code)) problems.push(`details ${i}: ${d.code} is not registered`)
      if (d.reason !== undefined) since11(v11, `details ${i} reason`, problems)
      checkReason(meta.tool, d, `details ${i}: `, problems)
    }
    // Spec 7.1.2: a hint that starts with the tool name is a command line that splits like next[].command.
    const hint = env.error.hint
    if (hint?.startsWith(`${meta.tool} `)) {
      try {
        shellWords(hint)
      } catch (e) {
        problems.push(`hint ${JSON.stringify(hint)} is not a command line (spec 7.1.2): ${(e as Error).message}`)
      }
    }
    // Spec 7.3.4: `schema --error` given a code only the warning registry has points at `schema --warning`.
    const asked = env.error.received
    if (meta.command === "schema" && env.error.field === "--error" && typeof asked === "string" && warningRegistered(meta.tool, asked)
      && !registries.get(meta.tool)?.some((e) => e.code === asked)) {
      const want = `${meta.tool} schema --warning ${asked} --json`
      if (hint !== want) problems.push(`schema --error ${asked}: a warning-only code, so the hint is ${JSON.stringify(want)} (spec 7.3.4)`)
    }
  }
  // Spec 7.5.1: every warning code is registered, in the warning registry or the error registry.
  for (const w of meta.warnings ?? [])
    if (!warningRegistered(meta.tool, w.code) && !registered(meta.tool, w.code)) problems.push(`warning ${w.code} is registered in neither registry (spec 7.5.1)`)
  if (!meta.command && meta.schemaVersion !== "1.0") problems.push(`unresolved command with schemaVersion ${meta.schemaVersion}, not 1.0 (spec 6.11)`)
  const doc = meta.command ? commandDocs.get(`${meta.tool} ${meta.command}`) : undefined
  if (!doc) return
  if (env.error && !doc.errors.includes(env.error.code)) problems.push(`${env.error.code} not in ${doc.command} errors`)
  if (env.data === undefined) {
    // Spec 6.11: the version of the output the invocation would have produced.
    const candidates = [doc.outputs.find((o) => !o.batch), doc.outputs.find((o) => o.batch), stream?.output].flatMap((o) => (o ? [o.schemaVersion] : []))
    if (!candidates.includes(meta.schemaVersion)) problems.push(`schemaVersion ${meta.schemaVersion} is not that of an output this invocation could produce (spec 6.11)`)
    return
  }
  if (doc.outputs.length > 1 && !meta.output) problems.push("meta.output missing (spec 6.6)")
  const output = meta.output ? doc.outputs.find((o) => refName(o.schemaRef) === meta.output) : doc.outputs[0]
  if (!output) return void problems.push(`meta.output ${meta.output} is not an output of ${doc.command}`)
  if (stream?.output && stream.output !== output) problems.push("the end result names another output than the stream's")
  if (meta.schemaVersion !== output.schemaVersion)
    problems.push(`meta.schemaVersion ${meta.schemaVersion} is not ${output.schemaVersion} of ${refName(output.schemaRef)} (spec 6.11)`)
  let schema: ValidateFunction | undefined = commandSchema(doc, output.schemaRef)
  if (meta.fields) {
    const declared = output.fields
    if (!declared) return void problems.push("meta.fields on an output without fields")
    const selectable = new Set([...declared.paths, ...(declared.keep ?? [])])
    for (const f of meta.fields) {
      const problem = fieldPathProblem(f)
      if (problem) problems.push(problem)
      else if (parseFieldPath(f)?.some((s) => s.bracket)) since11(v11, `the bracketed field path ${f}`, problems)
      if (selectable.has(f)) continue
      if (mapKeyOf(doc, output, f)) since11(v11, `the map key selection ${f}`, problems)
      else problems.push(`field ${f} is not selectable`)
    }
    for (const k of declared.keep ?? []) if (!meta.fields.includes(k)) problems.push(`kept field ${k} missing from meta.fields`)
    const trie = fieldTrie(meta.fields)
    let records: JsonValue = env.data
    for (const segment of decodePointer(declared.records)) records = isObject(records) ? records[segment] : null
    const found: string[] = []
    leaks(records, trie, declared.records, found)
    for (const f of found) problems.push(`unselected member ${f} present (spec 6.10)`)
    schema = projectedSchema(doc, output, trie)
  }
  if (!schema(env.data)) problems.push(`data fails ${refName(output.schemaRef)}${meta.fields ? " (projected)" : ""}: ${ajvErrors(schema)}`)
  if (output.batch) checkBatch(env, doc, problems)
}

/** Spec 11.11: the generic batch shape, one ordered status per item, nested errors registered, BATCH_INCOMPLETE exactly with a failed item. */
function checkBatch(env: Envelope, doc: CommandDoc, problems: string[]) {
  // The generic batch report applies whatever the command's own batch schema says.
  if (!V.batch(env.data)) problems.push(`data fails batch-report.schema.json: ${ajvErrors(V.batch)}`)
  const data = env.data as { items?: BatchItem[] }
  if (!isObject(data) || !Array.isArray(data.items)) return
  const statuses = data.items.map((i) => i.status).join(" ")
  if (!/^((written|unchanged) ?)*(failed( skipped)*)?$/.test(statuses)) problems.push(`batch statuses out of order: ${statuses}`)
  data.items.forEach((item, i) => {
    if (item.index !== i) problems.push(`item ${i} has index ${item.index}`)
    if (item.error) {
      checkCode(env.meta.tool, item.error, `item ${i}: `, problems)
      if (!doc.errors.includes(item.error.code)) problems.push(`item ${i}: ${item.error.code} not in ${doc.command} errors`)
    }
  })
  const failed = data.items.findIndex((i) => i.status === "failed")
  if (env.ok && failed >= 0) problems.push("a successful batch with a failed item")
  if (env.error?.code === "BATCH_INCOMPLETE") {
    if (failed < 0) problems.push("BATCH_INCOMPLETE without a failed item (spec 11.11)")
    else if (env.error.field !== `/${failed}`) problems.push(`BATCH_INCOMPLETE field is not /${failed}`)
  } else if (failed >= 0) problems.push("a failed item without BATCH_INCOMPLETE")
}

function checkStream(text: string, problems: string[]) {
  const lines = text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as StreamLine)
  if (lines.length === 1 && !("type" in lines[0])) {
    // Spec 13.5.3: a one-line answer without `type` is a refusal before the stream began.
    checkEnvelope(lines[0], problems)
    const env = lines[0] as Envelope
    if (env.ok || (env.error && registered(env.meta.tool, env.error.code)?.exit !== 2)) problems.push("a one-line stream answer that is not a refusal (spec 13.5.3)")
    return
  }
  lines.forEach((line, i) => {
    const l: StreamLine = line // ajv's guard narrows its argument to never on failure; inspect the alias instead
    if (V.stream(line)) return
    // Report the errors of the branch `type` selects, then of the end line's envelope.
    const branch = typeof l.type === "string" && ["start", "event", "end"].includes(l.type)
      ? ajv.compile({ $ref: `https://atip.dev/1/stream-line.schema.json#/$defs/${l.type}` })
      : undefined
    if (l.type === "end" && l.result !== undefined && !V.envelope(l.result)) problems.push(`line ${i + 1}: end result is not an envelope: ${ajvErrors(V.envelope)}`)
    else problems.push(`line ${i + 1}: ${branch && !branch(l) ? ajvErrors(branch) : ajvErrors(V.stream)}`)
  })
  const [first, last] = [lines[0], lines.at(-1)]
  if (first?.type !== "start") problems.push("first line is not start")
  if (last?.type !== "end") problems.push("last line is not end: the stream was cut off (spec 13.5.2)")
  lines.slice(1, -1).forEach((l, i) => l.type !== "event" && problems.push(`line ${i + 2} is ${l.type}, not event`))
  if (first?.type !== "start") return
  // Spec 13.5.1: the start line names the stream output when there are several; events are decoded by it at once.
  const doc = commandDocs.get(`${first.tool} ${first.command}`)
  const streams = doc?.outputs.filter((o) => o.kind === "stream") ?? []
  if (doc && doc.outputs.length > 1 && !first.output) problems.push("start line without output, but the command declares several outputs (spec 13.5.1)")
  const output = first.output ? streams.find((o) => refName(o.schemaRef) === first.output) : streams.length === 1 ? streams[0] : undefined
  if (doc && !output) problems.push(`start output ${first.output ?? "(none)"} is not a stream output of ${first.command}`)
  if (output && first.schemaVersion !== output.schemaVersion) problems.push(`start schemaVersion ${first.schemaVersion} is not ${output.schemaVersion}`)
  if (doc && output?.eventRef) {
    const events = commandSchema(doc, output.eventRef)
    lines.slice(1).forEach((l, i) => l.type === "event" && !events(l.data) && problems.push(`event ${i + 1} fails ${refName(output.eventRef ?? "")}: ${ajvErrors(events) || "no event allowed"}`))
  }
  if (last?.type !== "end" || !last.result) return
  const result = last.result
  if (result.meta?.command !== first.command || result.meta?.tool !== first.tool) problems.push("end result is for another command or tool (spec 13.5.1)")
  if (result.meta?.contractVersion !== first.contractVersion) problems.push("the end result declares another contract version than the start line (spec 15.7)")
  if (first.output && result.meta?.output !== first.output) problems.push(`end meta.output ${result.meta?.output ?? "(none)"} is not the start line's ${first.output}`)
  checkEnvelope(result, problems, { output })
}

/**
 * Spec 15.6 and 15.8: a document of a later minor (or one with members this repository does not know) that a caller
 * of this minor must read. It passes the contract schemas read open, and fails them closed, so that it really
 * exercises what a caller must ignore.
 */
function checkCallerDocument(name: string, value: unknown, problems: string[]) {
  const file = name.startsWith("caller-schema-") ? "schema-doc.schema.json" : "envelope.schema.json"
  const open = openSchema(file)
  if (!open(value)) problems.push(`a caller reading ${file} open rejects it: ${ajvErrors(open)}`)
  if (contractSchema(file)(value)) problems.push(`it passes ${file} closed, so it carries nothing a caller must ignore`)
}

function check(path: string): string[] {
  const problems: string[] = []
  const name = basename(path)
  try {
    if (name.endsWith(".ndjson")) checkStream(readFileSync(path, "utf8"), problems)
    else if (name.startsWith("caller-")) checkCallerDocument(name, readJson(path), problems)
    else if (name.startsWith("schema-")) checkSchemaAnswer(readJson(path), problems)
    else if (name.startsWith("input-")) checkInput(path, readJson(path), problems)
    else checkEnvelope(readJson(path), problems)
  } catch (e) {
    problems.push(`not parseable: ${(e as Error).message}`)
  }
  return problems
}

/** Every section number the spec's prose refers to exists as a heading or a numbered paragraph. */
function checkSpecReferences(): string[] {
  const spec = readFileSync(join(repo, "spec", "atip-1.md"), "utf8")
  const labels = new Set(
    spec.split("\n").flatMap((line) => line.match(/^(?:#+ |\*\*)?(\d+(?:\.\d+)*)\.? /)?.slice(1, 2) ?? []),
  )
  const prose = spec
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`[^`\n]*`/g, "") // code spans (versions, values)
    .replace(/\[[^\]\n]*\]/g, "") // evidence citations name sections of other files
    .replace(/D\d+(\.\d+)?|question 18\.\d+|RFC \d+ §\d+/g, "") // decision ids, earlier question numbers, RFC sections
  const missing = new Set<string>()
  // No section is numbered `N.0`, so `1.0` is the contract's version, not a reference.
  for (const m of prose.matchAll(/(?<![\w.])([1-9]\d?\.\d{1,2}(?:\.\d{1,2})?)(?![\w]|\.\d)/g))
    if (!m[1].endsWith(".0") && !labels.has(m[1])) missing.add(m[1])
  return [...missing].map((r) => `spec refers to section ${r}, which does not exist`)
}

let failed = 0
let passed = 0
for (const [dir, mustPass] of [[exampleDir, true], [join(exampleDir, "invalid"), false]] as const) {
  for (const f of readdirSync(dir).filter((f) => /\.(nd)?json$/.test(f)).sort()) {
    const problems = check(join(dir, f))
    const rel = join(dir, f).slice(repo.length + 1)
    const ok = mustPass === (problems.length === 0)
    ok ? passed++ : failed++
    if (mustPass) console.log(`${ok ? "ok  " : "FAIL"}  ${rel}${problems.map((p) => `\n      ${p}`).join("")}`)
    else console.log(`${ok ? "ok  " : "FAIL"}  ${rel.padEnd(70)} ${ok ? `rejected: ${problems[0]}` : "accepted, but it must be rejected"}`)
  }
}
const references = checkSpecReferences()
references.length ? failed++ : passed++
console.log(`${references.length ? "FAIL" : "ok  "}  spec/atip-1.md cross-references${references.map((p) => `\n      ${p}`).join("")}`)
const regex = checkRegexCases()
regex.length ? failed++ : passed++
console.log(`${regex.length ? "FAIL" : "ok  "}  scripts/regex-cases.json (${regexCases.length} cases, ECMAScript side and form)${regex.map((p) => `\n      ${p}`).join("")}`)
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
