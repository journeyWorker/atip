# TypeScript and Effect 4: spec-first commands

Not normative. How a TypeScript tool built on Effect 4 can become ATIP conformant, and what the shared package
`@journeykit/atip` should look like. Section numbers ("spec 10.7") refer to `spec/atip-1.md`, version 1.4.0.

## 1. Where a TypeScript tool starts

Two starting points are common:

| | Hand-written command spec | `effect/cli` |
|---|---|---|
| Parser | A pure `parse(commands, argv, env)` over typed command records | `effect/cli` (`Command`, `Flag`, `Argument`) |
| Self-description | Rendered from the same records | None beyond help text and completions |
| Input types | Option records say an option is valued; each handler parses the string itself | Flag types (`Int`, `Choice`, …) in the parser, but no published JSON Schema |

Approach A (§2) describes the first; approach B (§3) is what both should end up with; §4 is an interim for the
second.

## 2. Approach A: a hand-written spec

Each command is a record: id, summary, operands, options (`name`, `valueName`, `required`, `repeatable`, `default`,
`possibleValues`, relations), effect, output, errors, examples. A pure parser reads the records; a
`defineLeaf(id, outputSchema, useCase, renderText)` binds a handler; `schema`, help and the guide are rendered from
the same records, and tests byte-compare the generated files and seed a violation of every grammar rule.

Strengths: one source for parser and description; no framework dependency; easy to test.

Weakness: **input typing is written twice.** The option record says `--round <N>` is valued, and the handler then
parses the string into an integer itself; nothing ties the two. Such a spec tends to have no option type and
defaults that are strings or prose, and every new option is two edits that a test cannot fully compare.

## 3. Approach B: `defineCommand` (spec-first, Effect Schema as the input type)

One declaration per command. The input is an Effect Schema `Struct`; argv parsing, `--input` decoding, help text,
the `schema` answer and the input JSON Schema are all derived from it, so the type exists once.

### 3.1 Sketch

The sketch declares canon's `finding close` (`examples/schema-command-canon-finding-close.json`) as a TypeScript
tool would.

```ts
import { Effect, Schema } from "effect"
import { defineCommand, defineError, defaulted, operand, path, report } from "@journeykit/atip"

const Disposition = Schema.Literals(["open", "fixed", "rejected", "deferred"])

export const FindingNotFound = defineError({
  code: "FINDING_NOT_FOUND", // condition NOT_FOUND: exit 2, not retryable, derived (below)
  meaning: "No committed finding has this change, round and seq",
  fix: "List the change's findings: canon finding list --change <CHANGE_ID>",
  fields: { change: Schema.String, round: Schema.Int, seq: Schema.Int },
}) // a Schema.TaggedError class plus its registry row

const FindingCloseReport = Schema.Struct({
  changeId: Schema.String,
  round: Schema.Int,
  seq: Schema.Int,
  disposition: Schema.String,
  from: Schema.optionalKey(Schema.NullOr(Schema.String)),
  staged: Schema.optionalKey(Schema.NullOr(Schema.String)),
  committed: Schema.optionalKey(Schema.NullOr(Schema.String)),
  unchanged: Schema.Boolean,
})

export const findingClose = defineCommand(
  {
    path: ["finding", "close"],
    summary: "Move an already-committed finding's disposition",
    effect: { kind: "write", idempotency: "replay-safe" },
    operands: [operand("change", Schema.String, { valueName: "CHANGE_ID", help: "The change under review" })],
    input: Schema.Struct({
      round: Schema.Int.annotate({ valueName: "N", description: "Which review round raised it (1-based)" }),
      seq: Schema.Int.annotate({ valueName: "N", description: "Its sequence number within the round" }),
      disposition: Disposition.annotate({ valueName: "DISPOSITION", description: "Where it lands" }),
      resolutionRev: Schema.optionalKey(
        Schema.String.annotate({ valueName: "REV", description: "Commit that resolves it", defaultNote: "HEAD when fixed" }),
      ),
      reason: Schema.optionalKey(Schema.String.annotate({ valueName: "TEXT", description: "Why" })),
      actor: defaulted(Schema.String, "canon").annotate({ valueName: "ACTOR_ID", description: "Actor" }),
      repo: Schema.optionalKey(path("dir").annotate({ valueName: "DIR", flagOnly: true, description: "Repository" })),
      promote: switchOption("Promote this write in the same run"),
      noPromote: switchOption("Keep this write staged"),
    }),
    constraints: [
      requires({ name: "disposition", in: ["rejected", "deferred"] }, ["reason"], FindingReasonRequired),
      forbids({ name: "disposition", in: ["open", "rejected", "deferred"] }, ["resolutionRev"], FindingResolutionRevUnexpected),
      atMostOne(["promote", "noPromote"]),
    ],
    outputs: [report("FindingCloseReport", "1.1", FindingCloseReport)],
    errors: [FindingNotFound, FindingReasonRequired, FindingResolutionRevUnexpected, ConfigMissing],
    batch: { maxItems: 10_000, report: "1.0" }, // adds BatchFindingCloseReport (spec 10.11)
    maxBytes: 8 * 1024 * 1024,
    examples: ["canon finding close add-login --round 1 --seq 1 --disposition fixed --json"],
    ext: { "x-canon": { roles: ["reviewer"] } },
  },
  (args) =>
    Effect.gen(function* () {
      // args: { operands: [string]; round: number; seq: number; disposition: "open" | …; actor: string; … }
      const ledger = yield* Ledger
      return yield* ledger.closeFinding(args) // typed as FindingCloseReport's Type
    }),
)
```

`defineCommand` returns a value; the tool's root is `defineTool({ name, version, level, commands: [...], groups:
[...], guides })`, which also adds `schema`, `skills show`, `--json`, `--input` and, for destructive commands,
`--commit`/`--plan-digest` (a 1.4 document lists them, as reserved names). The handler's error channel is typed: it can only fail with the declared error classes
(or defects, mapped to `INTERNAL`), so `errors` in the self-description is exact by construction. Constraint names
are field names of `input` (or operand names), checked by the type of `requires`/`forbids`/`atMostOne`.

**Reasons and warnings (since 1.1).** `defineError` takes `reasons`, an object keyed by reason name, and the failure
constructor takes `reason` typed as the union of that error's keys, so a reason that is not registered under the
code does not type-check. A reason has no exit of its own: it shares its code's (spec 7.6).

```ts
export const InputInvalid = defineError({
  code: "INPUT_INVALID",
  meaning: "--input cannot be read or framed, or a document fails its fragment schema",
  fix: "Run <tool> schema <COMMAND> --json and send a document that matches input.schemaRef",
  reasons: {
    NOT_JSON: { meaning: "The source is not JSON", fix: "Quote the document so the shell keeps its quotes" },
    UNREADABLE: { meaning: "The file named by --input cannot be read", fix: "Check the path, relative to the working directory" },
  },
})

InputInvalid.fail({ message: "…", field: "--input", reason: "NOT_JSON" })  // type-checks
InputInvalid.fail({ message: "…", field: "--input", reason: "NOT_OBJECT" }) // does not: not a key of `reasons`

export const LegacyAlias = defineWarning({
  code: "LEGACY_ALIAS",
  meaning: "A deprecated spelling of an option was used",
  fix: "Use the current option name: <tool> schema <COMMAND> --json",
})
```

`defineWarning({ code, meaning, fix })` returns the value a handler puts into `meta.warnings`, so a warning code
that is not defined cannot be emitted. `defineTool` collects every defined warning reachable from `commands` into
the warning registry printed by `schema --warnings --json` and `schema --warning <CODE> --json` (spec 7.5.2), and
answers `schema --error <CODE>` for a warning-only code with `USAGE`, `field` `--error`, and the hint
`<tool> schema --warning <CODE> --json`. A situation that is a warning in some invocations and an error in others
is defined as both, with one `meaning`; a test compares the two. Reserved reason names (spec 7.3.3) ship as
ready-made `reasons` objects the tool spreads into its own `INPUT_INVALID` definition.

**Code names (1.3).** A tool's own code is `<SUBJECT>_<CONDITION>` (spec 7.2) and the condition fixes the exit and the
retryability, so `defineError` takes them from the condition and the author writes neither: `exit` and `retryable`
are optional and, when given, must equal the condition's (a mismatch fails at definition time). `defineError` checks
the `code` string against the grammar of spec 7.2.1 when the module loads and refuses a name that ends in no
condition (`PROMOTE_REFUSED`), a code of the tool's own that takes a core code's name, and a `retryable` other than the
condition's default on any condition but `FAILED`, `INCOMPLETE` and `TIMEOUT` (spec 7.2.3). The core codes (`USAGE`, `INTERNAL`, `PLAN_STALE`, …) are
ready-made definitions in the package with their exit and retryability as spec 7.3.1 gives them. `STOPPED_MIDWAY` is
one of them only when `CONTRACT_VERSION` is `"1.2"`; a 1.3 tool reports a stop part-way with its own
`<SUBJECT>_INCOMPLETE` definition whose `reasons` include the refused code (spec 8.3.2). That a subject is a noun is
the author's judgement (approaches/implementation.md §7), not the package's. A tool that declares 1.2 or earlier
writes `exit` and `retryable` out as before; the package then applies the 1.2.1 rules to it (spec 15.7).

**Parser behaviour that is a contract.** Tool-wide options (`--json`, `--repo`, `--actor`, any option declared on
`defineTool`) are accepted after group words as well as after commands (Annex S1 item 9), so
`canon finding --repo . --json` is answered with `COMMAND_REQUIRED`. `--input` given twice, or as the last word
with no value, is `USAGE` with `field` `--input` (spec 10.2), raised by the argv parser before any decoder runs;
`INPUT_INVALID` is only for a value that was given.

### 3.2 What is generated from the declaration

1. **Three schemas from one Struct.** The *argument* schema is the Struct as declared (required keys, defaults,
   checks). Two all-optional decoders are derived from it, with defaults removed and every `Int`/`Finite` field
   widened to its encoded form, a union of the number and a numeric string decoded to the number (in Effect 4,
   `Schema.Union([Schema.Int, Schema.NumberFromString.check(Schema.isInt())])` or the equivalent codec; a test
   pins the exact combinators):
   - the **argv decoder** keeps every field, flag-only ones included (`repo`, `as`), because argv may carry them;
   - the **fragment** schema (spec 9.9.2) additionally drops the flag-only fields and, for a 1.3 tool, is what
     `input.schemaRef` publishes (`Schema.toJsonSchemaDocument` of it); a 1.4 tool publishes nothing of it (item 9).
   Each source is decoded by its own decoder; the two results are merged with provenance (spec 10.7 step 4).
   Field checks inside the domain profile (spec 9.7.4, Annex V1) become the argument's `domain` and are applied only to the
   merged arguments, by the argument schema (§3.3 lists the mapping). Neither source decoder carries them.
   Integers in both decoders are refused outside ±(2^53-1), never rounded (spec 9.7.5, Annex V3): `Number.isSafeInteger`
   after decoding catches the numeric string and the JSON literal alike, because `JSON.parse` turns
   `9007199254740993` into `9007199254740992`, which is not a safe integer either.
2. **argv parser.** Options are the `input` fields: field `resolutionRev` → `--resolution-rev`. The parser follows
   spec 4.2 and builds a plain record from argv (`{ operands: ["add-login"], round: "1", repo: "." }`, values
   still strings) and decodes it with the argv decoder, which turns `"1"` into `1` and keeps `repo`. Neither
   decoder has `required`, so an argv that leaves required arguments to a document is not refused at this point:
   this is the relaxed first pass spec 10.7 step 3 needs.
3. **`--input`, in the order of spec 10.7.** Read and frame; decode each document with the fragment schema
   (`Schema.decodeUnknownEffect(fragment, { onExcessProperty: "error", errors: "all" })`; every `SchemaError` issue
   becomes a `details[]` entry with its JSON pointer; a flag-only key is an excess property and is refused);
   compare each key also given on argv structurally after normalisation (`INPUT_CONFLICT`); merge; apply `env` and
   defaults; decode the merged record with the argument schema (domains included), check `constraints`, then run
   the declared validators (§3.3). The decoded merged record is the argument object of spec 10.7 step 6, and
   `Schema.toJsonSchemaDocument` of the argument schema is what `input.argumentsRef` publishes: both have numbers
   where the document may have numeric strings, so the published schema never refuses an accepted spelling. The
   merged record never goes back through argv, so values starting with `-`, `{` or `[` and `json` values need no
   escaping, and `field` is the pointer from the start. `--json`, `--input`, `--commit` and `--plan-digest` are
   argv-only and are handled by `defineTool` before either decoder runs.
4. **Help.** Usage line, the agent line (spec 4.4.2), operands, options with value names and defaults.
5. **`schema`.** Tree, group, command (§3.3 mapping), errors and error from the registry built from every
   `defineError` reachable from `commands`, with their `reasons`; warnings and warning from every `defineWarning`
   reachable the same way.
6. **Output JSON Schemas.** `Schema.toJsonSchemaDocument(schema)` (draft 2020-12) of every output, with
   `definitions` lifted into the command document's `schemas` (for a 1.3 tool; item 9 for 1.4) and refs rewritten to
   `#/schemas/<Name>`. An artifact output declares its JSON representation Schema (`skills show` → `Guide`), a stream
   output its event and result Schemas. A test that pins a published report schema compares it by meaning, never
   byte for byte:
   Effect 4.1 writes a nullable member as `anyOf: [X, {"type": "null"}]` where a hand-written schema says
   `type: [..., "null"]` (both are the nullable forms of Annex F5), and gives `Schema.Int` a `maximum`, which the
   safe-integer rule of Annex V3 already implies. Neither is a contract promise about bytes.
7. **Envelope and exit.** The handler's success becomes `{ok: true, data, meta}`; the output is checked against
   its Schema (`onExcessProperty: "error"`) before printing, so a report can never drift from what `schema`
   publishes; a typed failure becomes the error object, with its `reason` when it has one, and the registry's
   exit. `meta.contract` and `meta.contractVersion` come from one constant of the package
   (`CONTRACT_VERSION = "1.3"`), set on every envelope including the `result` of a stream's `end` line; a tool does
   not write the minor itself (spec 15.5).
8. **Field paths.** `--fields` and the projection share one parser for field paths (spec 6.10, Annex F1): dotted names,
   `[]`, and a bracketed key for a name that is not an identifier (`attributes["http.status-code"]`, `attributes[""]`;
   only `\"` and `\\` escape inside the quotes, so it is not `JSON.parse`; U+0000 is refused, since argv cannot carry it). It rejects a bracketed identifier, so every member has one spelling
   and `meta.fields` compares as text; its writer is the inverse; the `--fields` value is split by a scanner that
   ignores commas inside brackets. In a tool that declares 1.1, a map the output schema declares (`Schema.Record`) has selectable keys and is a cut
   node; a tool that declares 1.0 keeps it whole. A
   test round-trips every path of the examples and one with a quote, a backslash and a comma in the key.
9. **The 1.4 form.** A tool that declares 1.4 maps the same declarations, and one serializer writes the document of spec
   9 (approaches/implementation.md §8): it omits every member at its default and the options and codes the document
   implies (`--json`, `--input` with `input`, `--fields` with `fields`; `USAGE`, its registered `OPTION_*`/`OPERAND_*`
   replacements (spec 7.3.2), `INTERNAL` and the feature codes), and prints compact JSON. A destructive command lists
   `--commit` and `--plan-digest` as reserved names, since they are not implied. It collects the shared options from the
   declarations, an option with the same definition on two or more commands going into the tree's `options` and each
   command naming it. The lifted `schemas` of item 6 are served by `schema <path> --schemas --json`, holding the schemas
   the command's refs reach and those they reference, and the command document has no `schemas`, `path`,
   `input.schemaRef`, `input.option` or `validators[].rejects`. The same answer holds the fragment schema of item 1
   under the name `Input` when the command has `input` (a reader may derive it from the options instead, spec 9.9.2;
   `defineTool` keeps using it to decode documents), and `rejects`, one list per declared validator in order (§3.3).
   `--help --json` and `--version --json` are refused with `USAGE`, `field` `--help` or `--version` (spec 4.4.1), after
   the path is resolved, so an unknown word is `UNKNOWN_COMMAND`.

### 3.3 Schema → self-description mapping

The mapping reads the field's JSON Schema (from `toJsonSchemaDocument`) plus the annotations, not Effect's AST,
so it does not depend on AST node tags that may change between Effect minors.

| Field schema | valueType | required | repeatable | default | fragment encoding |
|---|---|---|---|---|---|
| `Schema.Boolean` (optional) | `switch` | false | false | `false` | boolean |
| `Schema.Int` (JSON Schema `type: integer`) | `integer` | key not optional and no default | false | from `default` annotation | integer or `^-?(0\|[1-9][0-9]*)$` string |
| `Schema.Finite` / `Schema.Number` | `number` | 〃 | false | 〃 | number or numeric string |
| `Schema.String` | `string` | 〃 | false | 〃 | string |
| `path(kind)` (a `String` with `format: "path"` annotation) | `path` | 〃 | false | 〃 | string |
| `Schema.Literals([...])` (JSON Schema `enum`) | `enum`, `possibleValues` from `enum` | 〃 | false | 〃 | one of the literals |
| `Schema.Array(X)` | valueType of `X` | `minItems ≥ 1` | true | array or `null` | array of `X`'s encoding |
| `json()` (`Schema.Unknown`, or any Schema annotated `valueType: "json"`) | `json` | 〃 | false | any | any JSON value but a top-level `null` |
| `count()` (`Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` annotated `valueType: "count"`) | `count` | false | true | integer | non-negative integer |
| `Schema.optionalKey(X)` | as `X` | false | as `X` | `null` unless `defaulted` | as `X` |

Annotations read: `description` → `help`; `valueName`; `defaultNote`; `env`; `flagOnly` (left out of the fragment
schema, spec 10.6); `short`. Requirements between fields are not annotations: they are the `constraints` of the
declaration (spec 9.8), and `defineCommand` enforces them after the merge with the codes they declare.

The wire member `then` of a `requires` or `forbids` rule (spec 9.8.1) gives every object that carries it a
property named `then`, the name JavaScript uses to recognise a promise-like value; lints such as
`unicorn/no-thenable` reject it, and an object whose `then` were ever a function would be called by `await`. Keep
the rule records under another field name (`targets`; the helpers above take it positionally) and write `then` only
when the command document is emitted; parse an incoming document back into the same in-memory shape. The wire name
cannot change within `atip/1`.

Value checks become the argument's `domain` (spec 9.7.4, Annex V). The generator reads them from the field's JSON Schema,
keeps only the profile keywords of the field's valueType, and moves them out of both source decoders. They stay in
the argument schema, which applies them after the merge:

| Effect 4 check | JSON Schema keyword in `domain` |
|---|---|
| `Schema.isGreaterThanOrEqualTo(n)`, `Schema.isGreaterThan(n)` | `minimum`, `exclusiveMinimum` |
| `Schema.isLessThanOrEqualTo(n)`, `Schema.isLessThan(n)` | `maximum`, `exclusiveMaximum` |
| `Schema.isMultipleOf(n)` | `multipleOf` |
| `Schema.isMinLength(n)`, `Schema.isMaxLength(n)` | `minLength`, `maxLength` |
| `Schema.isPattern(re)` | `pattern`, which must be `^…$` around the restricted I-Regexp of Annex V2 (no `&&` or `~~` inside a class); the generator refuses any other regular expression at build time. It cannot see the Rust `regex` crate's size limit, which the checker's L1.patterns tests; keep counted repetitions of large classes short and put lengths in `maxLength` |
| a `json()` field's Struct, Array, Literals or a union of JSON types | `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const` |

Any other check, such as `Schema.makeFilter` with a custom predicate, a union of two object shapes, or a check of
one field against another, is outside the profile. The generator does not publish it in `domain`. It must be
declared as a validator with `validator({ arguments, code, description, rejects }, predicate)`. The validator runs
after the argument schema, and its `rejects` invocations are part of the tool's own tests and of the checker's
L1.validators; a 1.4 tool publishes them in the `--schemas` answer (spec 9.9.3), not in the command document. An
undeclared check outside the profile fails the build. The check names above follow Effect 4.1's
`Schema` module; a test pins the exact combinators, as for the numeric codec in §3.2.

### 3.4 The default helper

`Schema.withDecodingDefault` takes the default as an `Effect`, so neither JSON Schema generation nor a spec
generator can see the value. The helper applies both:

```ts
export const defaulted = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value))).annotate({ default: value })
```

The generator reads `default` from the annotation. `defineCommand` decodes `{}` through every field that declares a
`default` when the command is defined, before any invocation, and refuses the definition when the decoder requires
the key or yields another value than the annotation: the published `default` says the option may be left out, and a
decoder that requires the key would refuse every invocation that does so. The two cannot drift. A default computed
at run time is not `defaulted`: the field is `optionalKey` with a `defaultNote`, and the handler computes it.

### 3.5 Operands, destructive commands, batches, long-running work

- `operand(name, schema, opts)` declares one operand; `variadic: true` takes an `Array`. In `--input` they are the
  `operands` array, decoded with a tuple schema built from the operand list, each element in its fragment encoding
  (spec 10.5): a `json` operand takes any JSON value.
- `effect: { kind: "destructive", … }` makes `defineTool` add `--commit` and `--plan-digest` (listed in a 1.4 document),
  refuse `batch`, and
  require the handler to have the shape `{ plan: (args) => Effect<Plan>, commit: (args, plan) => Effect<Report> }`.
  `plan` runs with no write capability in its environment (no `FileSystem` write layer, no store writer), so a
  preview cannot make an effect (spec 11.2). The library computes the digest (JCS + SHA-256), prints the preview
  with the commit argv built from the normalised arguments (spec 11.5), and refuses `PLAN_STALE`.
- `batch: { maxItems, report }` adds the batch output (`Batch<Name>Report`, `allOf` the contract's
  `batch-report.schema.json`) and the runner of spec 10.11: preflight is steps 1-6 for every item, with the
  handler's environment holding no state services, so preflight cannot read state; an item whose handler refuses
  (a named object does not exist) stops the batch with `BATCH_INCOMPLETE`.
- `async: true` and `operation: true` add the spec 12.2 report rules and the `--operation <KEY>` option with the
  replay store of spec 12.4 (an `OperationStore` service the tool provides, which must reserve a key atomically,
  for example a unique-key insert, and keep the payload hash with it).
- Constraints with `in` on a repeatable option hold when any of its values is in `in` (spec 9.8).
- An output of kind `stream` gets a `Stream` handler; the library writes the start, event and end lines (spec 13).

### 3.6 Why B over A

| | A (hand-written spec) | B (`defineCommand`) |
|---|---|---|
| Input type written | twice (option records + handler parsing) | once (the Struct) |
| Option `valueType`, typed defaults | must be added by hand to every record | derived |
| `--input` and argv validation | same parser, but the typed decode is per handler | one decoder for both |
| Handler error types vs `errors` list | test-checked | type-checked |
| Framework | none | none (`effect` only) |
| Cost | none if it exists | the package, then a mechanical port of the records |

B keeps A's best property (one hand-written source, no framework parser) and removes the duplicated typing.

### 3.7 Conservative staging (spec 8.3, 8.3.1)

A write leaf that can fail both before and during the work has two registered codes (`STORE_UNAVAILABLE`, exit 2;
`STORE_FAILED`, exit 1). Which one a failure gets depends on whether the work began. For Effect use cases:

- **With a marker.** The use case reaches its ports through a `Work` service. `Work.begin` runs immediately before
  the first port call that can change state (a `Ref<boolean>` is set there, nothing else happens), and the
  library's error mapper reads the `Ref`: a failure before `begin` maps to the precondition code, a failure after
  it to the `_FAILED` code. Port wrappers for writes call `begin` themselves, so a use case cannot forget it. A
  test per write leaf injects a fault at the port before and after the first write and asserts exit 2 with no
  change, and exit 1.
- **Without a marker.** The leaf uses 8.3.1: it cannot show where the failure point is, so it reports every
  failure after argument parsing and object resolution with the `_FAILED` code, exit 1. Exit 2 stays reserved for
  what it knows came before the work. The reverse is never done: an exit 2 after a change breaks spec 8.2 and is
  what the checker's `L0.refusal-effects` catches.

A `read` leaf reports its precondition failures as refusals either way.

### 3.8 Cursors over keyset backends (spec 6.9)

A backend's own cursor (the last key of a keyset page, a continuation token) does not know the CLI's arguments.
The CLI wraps it: the cursor it prints is the backend cursor plus a digest of the normalised arguments of the
invocation (JCS + SHA-256 of every argument except `--limit`, `--cursor` and `--fields`), encoded as one opaque
string. On `--cursor`, the CLI decodes it, recomputes the digest from the current arguments, and refuses with
`CURSOR_INVALID` before the backend is called: reason `FOREIGN` when the string is not one of its cursors,
`ARGUMENTS_CHANGED` on a digest mismatch, `EXPIRED` when the backend then refuses the token. Binding on the
argument text as given, without normalising, is conservative: it can refuse a cursor given with another spelling
of the same arguments (`--round=1` against `--round 1`), and it
never accepts changed ones. Normalised binding is better, and the argument object of spec 10.7 step 6 is already
the normalised form.
The argument object leaves out flag-only options (spec 10.7 step 6), and the cursor is bound to them too: add
to the digest the flag-only options the invocation gave, `--json` and a tool's own (canon's `repo` and `as`, which
can change the result set), except `--input`, which only carries arguments that are already in the object.

**A tool that declares 1.2 or later** (spec 6.9, 10.6) binds the cursor to every argument except `--json`,
`--limit`, `--all`, `--cursor` and `--fields`, and binds `env` values too. The last four options are flag-only
there, so they are already out of the argument object; leave `--json` out of the digest as well. Digest each
remaining argument with its source: an explicit value as given (normalised), an `env` value marked as coming from
the environment, and nothing for a value filled in from a `default`. A switch given `false` and a count given `0`
are absent (spec 9.7.2), so they digest as left out. Keep the tool's own flag-only options that can change the
result set. The helpers that declare the reserved paging and selection options mark them `flagOnly` when the tool
declares 1.2 or later.

Two details are rules for a tool that declares 1.2 and recommendations for 1.3 (approaches/implementation.md §3). An
argument given with its default value counts as given: it is digested with its explicit value, so a cursor issued
without it is refused. A 1.3 tool that digests an explicit default as absent instead continues the same result set,
which spec 6.9 allows. And the next-page `next` is built from the explicit arguments only (an `--input -` or file
document re-expressed as argv options or one inline `--input` word, spec 11.5), never from the merged argument
object, so that the entry carries no default and no `env` value and its own cursor accepts it.

## 4. A tool on `effect/cli` in the meantime

A tool whose parser is `effect/cli` can reach L1 from its existing tree before it moves to `defineCommand`:

- Effect **4.1** exposes `Completions.fromCommand(cmd)` (public since 4.0.7, `@stability unstable`): per command
  `{name, description, flags, arguments, subcommands}`, flags with `FlagType` (`Boolean`, `String`, `Int`,
  `Finite`, `Date`, `Choice{values}`, `Path{pathType}`), arguments with `required` and `variadic`. That gives
  names, valueTypes and enums.
- It does **not** give a flag's `required`, its default (a `withDefault` closure), or `repeatable`. Those, and
  effect, idempotency, errors, outputs and examples, come from `Command.annotate` annotations or a table keyed by
  command path, merged at generation time.
- A test loads the command tree, generates the self-description, and for every option parses a synthetic argv
  with and without it to check `required` and the annotated default against what the parser actually does.

On Effect 4.0.6 and earlier the descriptor extractor is internal and blocked by the package's export map, so this
interim needs 4.1. It is a bridge: the hand-annotated half is exactly the duplication approach B removes, so a tool
should not stop there.

## 5. Adoption order

1. Publish `@journeykit/atip` with `defineCommand`, `defineError`, `defineTool`, the envelope, the registry and
   `schema`/`skills show`.
2. A tool with a hand-written spec ports its records to `defineCommand` one group at a time; handlers keep their
   bodies. Byte-compared generated files and seeded grammar tests stay and must stay green; the generated JSON
   changes only where atip/1 differs from the tool's earlier shape.
3. A tool on `effect/cli` reaches L0 first, independent of the parser (text by default with `--json`; `field`,
   `expected` and `suggestions` at the top of the error, `details` only for several errors; UPPER_SNAKE codes;
   `meta.tool`; nothing on stdout when a module fails to load, spec 5.5), then L1 through §4 or directly by
   porting families to `defineCommand`, then L2.
4. Whatever the starting point, the contract changes that are not renames: a `--yes` or `--dry-run`-to-act flag
   on a destructive command becomes preview + `--commit --plan-digest` (spec 11.8); a digest lives at
   `data.planDigest`; an idempotency key option is `--operation` (spec 12.4); several values of one kind are a
   repeatable option, never a second operand of another kind (Annex S1 item 2); a refusal or a `schema` call writes no
   log file (spec 11.2).
5. A tool that adopts 1.1 members (reasons, a warning registry, escaped field paths) sets `CONTRACT_VERSION` to
   `"1.1"` from the package and claims "ATIP 1.1" with its level (spec 15.5); `approaches/migration.md` lists the
   steps.
6. A tool that adopts 1.3 renames its own codes to `<SUBJECT>_<CONDITION>`, moves its warning codes into the warning
   registry, replaces `STOPPED_MIDWAY` by its own `INCOMPLETE` code, sets `CONTRACT_VERSION` to `"1.3"` and claims
   "ATIP 1.3" with its level (spec 15.5, 15.8); `approaches/migration.md` lists the steps.

`approaches/migration.md` lists the steps for any tool and two worked examples.
