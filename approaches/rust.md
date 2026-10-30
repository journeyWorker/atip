# Rust: clap stays the source, the self-description is generated

Not normative. How a Rust tool built on clap 4 derive, such as canon and lute, can become ATIP conformant without a second
description of their command trees. Section numbers ("spec 11.7") refer to `spec/atip-1.md`, version 1.0.

## 1. The principle

clap already parses argv, so it is the only description of syntax. Everything clap does not know (effect,
idempotency, error codes, outputs, examples, value-conditional constraints) lives in one table per tool keyed by
command id, and a test proves the table and the clap tree name exactly the same commands. The `schema` answer, the
checked-in spec file and the guide's command reference are rendered from those two sources. canon (`spec.rs`)
already works this way; the shared crate makes the projection and the wire types common.

## 2. What canon already has

| canon file | What it does today | Change for atip/1 |
|---|---|---|
| `spec.rs` | Walks `cli::command()`; per option `name`, `kind` (`flag`/`count`/`value`), `short`, `aliases`, `valueName`, `required`, `repeatable`, `possibleValues`, `default` (strings), `help`, `env`, `conflictsWith`, `requires`; per leaf `effect`, `idempotency`, `exits`, `errorCodes`, `requiredOneOf`, `outputs`, `inputs`, `examples`. Reads `requires` from clap's `Debug` text because `Arg::requires` has no getter, pinned by a test. Writes `docs/cli/canon.cli.json`; `tests/cli_spec.rs` byte-diffs it. | `kind` → `valueType` (§4); typed `default` (§5); `conflictsWith`, `requires` and `requiredOneOf` → `constraints` (§4.2); `about` → `summary`; `errorCodes` → `errors`; `roles` → `x-canon`; drop `aliases`, `exits`, `nodeKind`, `supportsJson`; `flagOnly` on `repo`, `as`, `json`, `input`, `commit`, `plan-digest`. Moves into the shared crate. |
| `schema.rs` | `META` (effect, effectNote, roles, exits) per leaf; runtime `schema` answers: a flat leaf list, a full leaf node, `--errors`, `--error`, `--as` filter. | Tree with groups and `level`; `schema <group>` answers a `group`; command answers embed `schemas` (today they live only in `canon.cli.json`). `--as` stays (explicit filter, spec 10.2.2). |
| `spec_facts.rs` | `FACTS`: outputs and idempotency per leaf. | Merges with `META` into one table (§3.2). |
| `reports.rs` | `trait Report: Serialize + JsonSchema` with a default `schemaVersion` `1.0`; schemars 1.2. | Unchanged; the shared crate re-exports the trait. |
| `json_out.rs` | `Meta {command, schemaVersion, canonVersion, context{role,actor,repo}, next, warnings, …}` plus flattened extras (`returned`, `total`, `hasMore`, `nextCursor`, `unchanged`, `waitingOn`, `provenance`); compact one-line output; debug builds validate every emitted envelope against its schema (`validate`, `witness`). | `canonVersion` → `toolVersion`, add `tool`, `contract`, `output`; nulls in `context` omitted; paging extras → `meta.page`; `unchanged` and `waitingOn` → reports (a minor bump each); warnings `{code, message}`; `next` argv gains `--json` in JSON mode (spec 6.8); `meta.command` omitted when no word resolved (canon prints `"canon"`). Keep the debug validation. |
| `cli_error.rs` | `CliError` with builder (`hint`, `field`, `expected`, `received`, `suggestions`), `redact`, `CodeInfo` registry (`all_codes`), `EXIT_FAILED`/`EXIT_REFUSED`, `with_exit`. Body always prints `suggestions: []` and `hint: null`. | Omit absent members. Remove `with_exit` (spec 7.3.2); the batch call sites become `BATCH_INCOMPLETE` (spec 11.11). Split codes that occur both as a precondition and during the work (spec 8.3): `WRITE_FAILED` is exit 2 today and becomes 1. |
| `safety.rs` | `SafetyArgs` (`--commit`, `--plan-digest`), `Plan`, `Effect {action, path, record, detail}`, `digest()` = SHA-256 hex of the effects' `serde_json` text. | Moves into the shared crate; digest over the JCS form of the plan (effects and inputs) with a `sha256:` prefix (spec 12.6); `PLAN_CHANGED` → `PLAN_STALE`; the preview's `next` is built from normalised arguments (spec 12.5). |
| `input.rs` | `--input` (inline/file/`-`), whole-JSON-then-NDJSON framing, `#` comment lines, camelCase keys → `--name=value` argv, flag-only set, 8 MiB / 10 000 items, batches as sequential child processes. | Follow spec 11.7 exactly (§6 below): fragment validation before the merge, normalised conflict check, operands after `--`, field pointers translated back; drop `#` comments (spec 11.4); `INPUT_INVALID_TYPE`, `INPUT_STDIN_TTY`, `INPUT_UNKNOWN_FIELD`, … collapse into `INPUT_INVALID` with `field`; `INPUT_ELEMENT_FAILED` → `BATCH_INCOMPLETE`. |
| `build.rs` + `run/skills.rs` | Embeds `canon/skills/` and serves `skills show <NAME>`; `--json` data `{name, version, markdown}`. | `NAME` optional; data `{name, text, guides, full?}` (`schema/guide.schema.json`), a major bump of that output. |
| tests | `cli_spec.rs`, `schema.rs`, `schema_codes.rs`, `schema_examples.rs`, `docs_lint.rs`, `read_effects.rs`, `human_only.rs`. | Keep; `read_effects.rs`'s whitelist must not cover refusals or previews (spec 12.2). The shared checker adds the black-box layer. |

Source anchors: canon `crates/canon-cli/src/`.

## 3. The shared crate

The crate is `atip` (the name is free on crates.io).

```text
atip
├── envelope   Meta, Success<R>, Failure<R>, NextStep, Warning, Page; print_success / print_failure (one compact line)
├── argv       json_mode(&[OsString]) -> bool (the word `--json` before `--`, spec 4.4); the argv writer of spec 9.12.3
├── error      Code (static registry row), CliError (builder), reserved codes, text rendering (spec 7.4)
├── spec       CommandMeta table, project(&clap::Command, &Table) -> Vec<Node>, valueType, typed defaults, constraints
├── schema     the `schema` subcommand: Args (path, --errors, --error, --search, --json) and its handler
├── input      InputArgs (--input): read, frame, fragment-validate, conflict-check, merge, batch runner (spec 11)
├── safety     SafetyArgs (--commit, --plan-digest), Plan, Effect, digest (JCS + SHA-256), commit `next` builder
├── stream     StreamWriter: start line, event lines, end line (spec 13.5)
├── skills     `skills show` subcommand over a static guide table (include_str! from build.rs)
└── testing    the per-tool test functions of §3.3, seeded-violation helpers
```

### 3.1 Errors

```rust
/// One registry row. Exit and retryability live here and nowhere else.
pub struct Code {
    pub code: &'static str,          // UPPER_SNAKE
    pub exit: Exit,                  // Exit::Failed (1) | Exit::Refused (2)
    pub retryable: bool,
    pub meaning: &'static str,
    pub fix: &'static str,
}

pub const USAGE: Code = Code { code: "USAGE", exit: Exit::Refused, retryable: false,
    meaning: "The command line does not parse or does not satisfy the command's requirements",
    fix: "Run <tool> schema <COMMAND> --json" };
// … the other reserved codes of spec 7.2

pub struct CliError { code: &'static Code, message: String, hint: Option<String>, field: Option<Field>,
                      expected: Vec<String>, received: Option<Value>, suggestions: Vec<String>,
                      details: Vec<Detail> }

/// Where the fault is: an argv argument, or a JSON pointer into the --input document (spec 11.8).
pub enum Field { Argv(String), Pointer(String) }
```

No `with_exit`: the exit is `self.code.exit`. A tool's registry is `&'static [&'static Code]`, its own codes plus
the reserved ones it can produce; a test asserts every code a `CliError` is built with is in it (canon's
`schema_codes.rs` does this by scanning source).

clap's own errors are mapped once: `clap::error::ErrorKind::{UnknownArgument, InvalidValue, MissingRequiredArgument,
ArgumentConflict, …}` → `USAGE` with `field` (the argument), `expected` (`ContextKind::ValidValue`), `received`
(`ContextKind::InvalidValue`), `suggestions` (`ContextKind::SuggestedArg`/`SuggestedValue`);
`InvalidSubcommand` → `UNKNOWN_COMMAND`; `MissingSubcommand`/`DisplayHelpOnMissingArgumentOrSubcommand` →
`COMMAND_REQUIRED`. canon already extracts these contexts. When the invocation used `--input`, the mapper rewrites `Field::Argv` to the
document pointer the argument came from (§6).

### 3.2 The per-command table

```rust
pub struct CommandMeta {
    pub id: &'static str,                        // "finding close"
    pub effect: Effect,                          // Read | Write(Idempotency) | Destructive(Idempotency)
    pub effect_note: Option<&'static str>,
    pub is_async: bool,                          // spec 13.2
    pub errors: &'static [&'static Code],        // or generated, as canon's schema_codes
    pub outputs: &'static [Output],              // Report | Artifact { media_type } | Stream { media_type, event }
                                                 // each with { schema: fn() -> Schema, name, version, when, batch, fields }
    pub input: Option<InputMeta>,                // max_bytes, batch, max_items, example
    pub constraints: &'static [Constraint],      // value-conditional ones clap cannot report (§4.2)
    pub examples: &'static [&'static str],
    pub value_types: &'static [(&'static str, ValueType)], // overrides for custom value parsers
    pub ext: Option<fn() -> serde_json::Value>,  // the x-<tool> object
}
```

clap 4.5 has an `Arg::ext`/`Command::ext` mechanism only behind `unstable-ext`; until it is stable, the table is
keyed by id and the completeness test of §3.3 keeps it honest.

### 3.3 Tests the crate ships for a tool's own suite

- `table_matches_tree(&cmd, TABLE)`: every leaf has exactly one row, every row names a leaf (canon
  `tests/cli_spec.rs:28-60`).
- `examples_parse(&cmd, TABLE)`: every example and every guide command line parses with `try_get_matches_from`,
  contains no placeholder, and satisfies the declared constraints.
- `constraints_hold(&cmd, TABLE)`: for every constraint, one generated invocation that violates it is refused by the
  real parser or handler with the declared code, and one that satisfies it is not refused for that reason. This is
  what makes a table-declared constraint trustworthy (§4.2).
- `input_matches_argv(&cmd, TABLE)`: for every example, the equivalent `--input` document gives the same parse
  result, and the document with one value changed against argv gives `INPUT_CONFLICT` (spec 11.7).
- `destructive_has_safety`, `input_on_writes`: the L2 shape rules (spec 11.1, 12.4).
- `no_effect_on_refusal`: runs each command's refusals in a temporary directory and asserts nothing was written
  (spec 12.2), including telemetry and logs.

## 4. Projecting clap

### 4.1 valueType

| clap | valueType |
|---|---|
| `ArgAction::SetTrue` / `SetFalse` | `switch` |
| `ArgAction::Count` | `count` |
| non-empty `get_possible_values()` | `enum` |
| `get_value_parser().type_id()` equal to the `TypeId` of `i8…i64`, `u8…u64`, `isize`, `usize` | `integer` |
| … of `f32`, `f64` | `number` |
| … of `PathBuf` | `path` |
| … of `String`, `OsString` | `string` |
| custom parser | an entry in `CommandMeta.value_types` (a JSON value → `json`); without one, generation fails |

`ValueParser::type_id()` returns clap's `AnyValueId`, which implements `PartialEq<std::any::TypeId>` (checked in
clap_builder 4.6.7, `src/util/any_value.rs:72`). Failing on an unknown custom parser is deliberate: a guessed
`string` is how canon ended up with no option types at all.

`repeatable` = `ArgAction::Append` or `Count`, or `get_num_args()` with `max_values() > 1`. `required` =
`is_required_set()`.

### 4.2 Constraints

| Source | Constraint (spec 10.8) |
|---|---|
| `Command::get_arg_conflicts_with(&arg)` (public) | `atMostOne` of the pair |
| `Command::get_groups()`: `ArgGroup::is_required_set()`, `is_multiple()` (takes `&mut self`; call it on a clone), `get_args()` | required and not multiple → `exactlyOne`; required and multiple → `atLeastOne`; not required and not multiple → `atMostOne` |
| `Arg::requires` (no getter) | `requires {if: {name}}`: declared in the table, verified by `constraints_hold`, instead of parsing clap's `Debug` text |
| `required_if_eq`, `required_unless_present`, … (private fields) | the table, verified by `constraints_hold` |
| checks a handler makes before acting (canon's `FINDING_REASON_REQUIRED`) | the table, with `code` |

Moving `requires` from the `Debug` parse to the table removes the dependency on clap's debug format that canon's
`spec.rs:271-304` pins today; `constraints_hold` replaces the pin with a behavioural test.

### 4.3 Domains

A restriction of one argument's own value (spec 10.7.4, `domain`) comes from the table, keyed by argument, as a
typed value rather than free JSON, so that only the profile can be written:

```rust
pub enum Domain {
    Number { minimum: Option<i64>, maximum: Option<i64>, exclusive_minimum: Option<i64>, exclusive_maximum: Option<i64>, multiple_of: Option<NonZeroU64> },
    Text { min_length: Option<u32>, max_length: Option<u32>, pattern: Option<&'static str> },
    Json(serde_json::Value), // checked against the json profile when the crate builds the document
}
```

clap's `value_parser!(u32).range(1..)` builds a `RangedU64ValueParser` whose bounds have no public getter
(clap_builder 4.6.7 `builder/value_parser.rs:1315-1340`: only `new` and `range`), and the boxed `ValueParser`
erases the type anyway, so the projection cannot read them back. `examples_parse` and `constraints_hold` instead
check that the table's domain and the real parser agree on a value just inside and just outside every bound.


A `pattern` is checked twice when the crate builds the document: through the restricted I-Regexp check of spec
10.7.4, which the crate implements (no `&&` or `~~` inside a class, among the rest), and by compiling it with the
`regex` crate's default limits, which is also what the tool's parser uses. The crate refuses to build a document
whose pattern fails either. The restricted form matters for Rust even though the tool's own parser is Rust: the
published pattern is also read by every ECMAScript validator of the self-description, and for `^[a&&b]+$` the two
disagree (`scripts/regex-cases.json`). The crate's test runs `domainRejects`-style values through the parser and
the published pattern and asserts the same answer. A `format` is published as an annotation and never enforced by
the projection.

Integers (spec 10.7.5): an `integer` argument parses into `i64` and is then refused outside ±(2^53-1) with the
argument's code, so `9007199254740993` is refused rather than accepted as a value JavaScript would round. A bound
outside that range fails generation. An identifier that can exceed it is a `String` with a pattern.

Checks outside the profile, such as a `value_parser` closure that checks a calendar date or a comparison of two
arguments, are declared in the table as validators (spec 10.8.3): `Validator { arguments, code, description,
rejects }`. The crate publishes them in `validators`, and its `constraints_hold` test runs every `rejects`
invocation through the real parser and handler entry point and asserts that it is refused with that code and
nothing else fails first. canon's `--before` (RFC 3339 or `YYYY-MM-DD`) is the first such validator.


### 4.4 Typed defaults

clap stores defaults as `OsStr`. The projection parses each with the option's valueType (`"100"` → `100`) and fails
generation when it does not parse. A default computed at run time (`HEAD`, the nearest `canon.yaml`) is not a clap
default; it is `null` plus `defaultNote` from the table. A test renders `--help` and checks that every
`[default: X]` clap prints equals the typed `default` (canon's `limit.default: []` against help's 100 is what this
catches).

## 5. Report, artifact, stream and input schemas

Reports derive `schemars::JsonSchema` (canon does, schemars 1.2). The `schema` command's `schemas` member is each
output's schema with its `$defs` lifted to sibling names, `$ref`s rewritten to `#/schemas/<Name>`, and each lifted
schema's own `$id` and `$schema` removed: canon's report schemas carry `$id: "urn:canon:report:…"`, which would
make `#/schemas/…` resolve against that URN instead of the command document (found by `scripts/check.ts` on the
translated `purge` example). Artifacts have a JSON representation type of their own (`skills show` → `Guide`);
streams have an event type and a result type (spec 10.9). A record schema of an output with `fields` must be
projectable (spec 6.10); schemars emits `anyOf: [{$ref}, {type: null}]` for `Option<T>`, which is allowed.

The input **fragment** schema (spec 10.10) is generated from the clap node: one property per option that is not
flag-only (camelCase name; type from valueType in its encoded form, so an integer is
`{"type": ["integer","string"], "pattern": "^-?(0|[1-9][0-9]*)$"}`; `type: array` for repeatable options except
`count`), `operands` typed per operand, `additionalProperties: false`, and **no `required`**. canon's published
`FindingCloseInput` already accepts `round` as integer or string; it has to drop its `required` list.

## 6. `--input` in Rust

canon's approach, converting the document to argv and running clap, is kept for the one authoritative parse. What
changes is the conflict check before it (spec 11.7 step 3): it must see the explicit argv arguments **without**
clap enforcing requirements, constraints, environment or defaults, because a complete document may supply every
required argument and argv none (`canon finding close --input '{…}'`). An ordinary `try_get_matches_from` on the
argv alone fails with `MissingRequiredArgument` before the merge.

**Phase 1: lexical extraction (recommended).** The crate tokenises argv by the grammar of spec 9.12 using the
projected self-description, which already knows every option's long name, short letter and whether it takes a
value (`switch`/`count` versus valued). That is the same table the argv writer of step 3 uses, so no second
description exists. The result is the list of explicit occurrences, each with its argv position:

```rust
pub struct Occurrence { pub arg: &'static str, pub value: Option<OsString>, pub position: usize }
pub fn extract(spec: &CommandNode, argv: &[OsString]) -> Result<Vec<Occurrence>, CliError>
```

`extract` refuses only what is malformed by itself: an unknown option (`USAGE`, `field` the option, `suggestions`
from the names), a valued option without a value, a value that does not parse as its valueType or is not in
`possibleValues`. It never looks at `required`, constraints, `env` or defaults. Values are normalised by valueType
(an integer `"01"` is refused; `"1"` and `1` compare equal).

*Alternative considered: a relaxed clap pass.* `Command::mut_args(|a| a.required(false))`, `mut_group(…,
|g| g.required(false))` and resetting `default_value(None)`/`env(None)` are public in clap 4.6
(`clap_builder` `builder/command.rs:244-372`), but `Arg::requires`, `required_if_eq`, `required_unless_present`
and `conflicts_with` have no public reset, and `Command::ignore_errors(true)` does not say which errors it
suppresses. A relaxed copy of the command therefore still refuses some argv that the document completes. It is not
recommended.

**Phase 2: merge and the authoritative parse.**

1. Read and frame; fragment-validate each document with a JSON Schema validator (canon already depends on the
   `jsonschema` crate) and collect every problem into `details` (steps 1-2).
2. `extract` the argv (phase 1). For each document key whose argument also occurs on argv, compare normalised
   values (operands as one ordered list, repeatables as ordered lists); a difference is `INPUT_CONFLICT` with the
   document pointer (step 3).
3. Merge (step 4) and write the merged argv with the crate's argv writer (spec 9.12.3): `--name=value` for every
   value, so no value starting with `-`, `{` or `[` is misread; operands after one `--`; a `json` value as compact
   JSON text. While writing, keep a map from each written argv position to its source: an argv position or a
   document pointer.
4. Parse the merged argv once with the real `clap::Command` (steps 5-6). clap applies `env` and defaults to absent
   arguments; `ArgMatches::value_source(id)` then tells explicit values (`CommandLine`) from `EnvVariable` and
   `DefaultValue`, which is what the table's constraints need ("given" means explicit, spec 10.8). Check the
   table's constraints on the explicit set. Map clap errors with §3.1 and rewrite `field` through the source map:
   an argument that came from the document gets its pointer; a missing required argument gets the pointer its key
   would have (spec 11.8).
5. Run the command (step 7). State-dependent preconditions (the finding exists) are the handler's, never clap's.

**Batches.** Preflight is phase 1 and steps 1-4 of phase 2 for every item, with no state read; then the items run
in order in-process (canon today spawns a child per item; either works). An item whose handler refuses (its
finding does not exist) stops the batch: the report marks it `failed` with its own error and the batch fails with
`BATCH_INCOMPLETE` (spec 11.11), even at index 0.

Tests the crate ships for this path: a complete-document invocation with no argv arguments succeeds; a document
supplying a required peer of an argv constraint succeeds; a document value differing from argv is
`INPUT_CONFLICT` at the pointer; document values `-x`, `--`, `{` and `[1]` reach the handler unchanged; a missing
required argument under `--input` reports the pointer.

## 7. lute

Version 0.52.0; clap derive; `schema` already walks the same clap tree and is parity-tested against help.

| Area | Today | Work |
|---|---|---|
| Envelope | Flat `{command, schemaVersion, ok, …payload}`, pretty-printed; `schemaVersion` `0.48.0.check` encodes the release; `project_diagnostics` snake_case | Nest under `data`/`meta`; compact; per-output `1.0`; camelCase. Every consumer of lute JSON changes (website, harness scripts). |
| Errors | `E-CLI-USAGE`, `E-CLI-IO`, `E-CLI-INPUT`; `{code, message, argument?, hint?, path?}`; diagnostics duplicated on stderr in JSON mode; patch refusals use a second shape | `USAGE`, `INPUT_INVALID`, I/O codes split by stage (spec 8.3); `field` replaces `argument`/`path`; `retryable`; stderr empty in JSON; patch refusals use the error object. The diagnostic registry (`codes/registry.rs`) gains `exit`, `retryable`, `fix` for CLI codes. |
| Exits | 0/1/2 plus 3 for incomplete walks; an accepted patch with semantic changes exits 1 with `ok: false` | Decided (spec 8.6): the incomplete walk is exit 1 with a registered code; the accepted patch is exit 0 with the changes in `data`. |
| `schema` | Always JSON; refuses `--json`; no effect, idempotency, errors, examples, report schemas, constraints | Accept `--json`; text mode may keep printing JSON (spec 10.1.3); adopt the crate's projection; derive `JsonSchema` on reports; table rows. The hand-written outputs table (`envelope.rs:114-212`) becomes `CommandMeta.outputs`; `compile --stream` and `play --events` become `stream` outputs with the protocol of spec 13.5. |
| Grammar | Toolchain verbs, `--project`, bare-noun ids, vocabulary TSVs with mutation tests; `scenario` is runnable and a group; `-o` short | Split `scenario` (spec 9.2); `-o` stays, listed as `short`; keep the TSV gates. |
| Input | No `--input`; `patch <FILE>` reads a strict JSON request from a file | `InputArgs` on every write. `patch` keeps its request file as its operand; its `--input` carries the arguments. |
| Safety | `tag --renumber` previews and acts with `--commit`, not digest-bound | Add `--plan-digest`; plan = the renumbering; `PLAN_STALE` on drift. |
| Guide | None in the binary; `llms.txt` on the website | `skills show` over embedded Markdown generated from the same sources as `llms.txt`. |
| Telemetry | Every invocation, `schema` and `--help` included, writes local telemetry unless opted out | Record nothing for refusals, `schema`, `--help`, `--version` and previews (spec 12.2); successful runs may record, declared in `effectNote`. |
