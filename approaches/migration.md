# Adopting ATIP: a checklist and two worked examples

Not normative. How an existing command-line tool moves to ATIP, level by level, with canon 0.31.0 and lute 0.52.0
(both Rust, clap) as worked examples. Their status below is from their source and their read-only `schema`
output; anything not established that way is marked *unmeasured*. Section numbers ("spec 11.7") refer to
`spec/atip-1.md`, version 1.0.

The contract is not softened to ease adoption; where a rule costs a tool real work, the cost is recorded here (§4).

## 1. Checklist with the two examples

Legend: ✅ conforms · 🟡 close, mechanical change · 🔴 missing or different by design.

### L0: output selection, envelope, errors, exits

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| Text default, `--json` selects (4.1-4.3) | JSON by default, or an environment variable or TTY check that switches it | ✅ | ✅ |
| JSON mode from argv before parsing (4.4) | a parse error printed as text although `--json` was given | ✅ | ✅ |
| One document on stdout, stderr empty (5.1-5.2) | diagnostics repeated on stderr; load failures printed on stdout | ✅ | 🔴 diagnostics duplicated on stderr |
| Compact (5.4) | pretty-printed JSON | ✅ | 🔴 pretty |
| Nested `{ok,data,meta}` (6.1) | a flat document with the payload beside `ok` | ✅ | 🔴 flat |
| `meta.tool`, `toolVersion`, `contract` (6.6) | a tool-named version key, version at the root | 🟡 `canonVersion`, no `tool` | 🔴 |
| `meta.command` omitted when nothing resolved (6.6) | the tool name or `null` as the command | 🟡 prints `"canon"` | 🟡 `command` may be null |
| `meta.output` when several outputs (6.6) | | 🔴 | 🔴 |
| `meta.schemaVersion` per output `<major>.<minor>` (6.11, 15.3) | the release encoded in the version | ✅ | 🔴 `0.48.0.check` |
| No nulls; only the defined meta keys (6.5, 6.6) | `hint: null`, `suggestions: []`, extras flattened into `meta` | 🔴 `hint: null`, `suggestions: []`, nullable context, flattened extras | n/a |
| `context` keys = context option names (6.7) | keys that are not option names, null values | 🟡 `role`, `actor` with nulls | 🔴 |
| `next` includes `--json` in JSON mode (6.8) | | *unmeasured* | 🔴 no `next` |
| Error members (7.1) | `field`, `expected` nested in an array; no `retryable` | ✅ (+ nulls) | 🔴 no `retryable`/`field`/`expected` |
| UPPER_SNAKE codes (7.1) | prefixed or lower-case codes | ✅ | 🔴 `E-CLI-*` |
| Reserved codes (7.2) | finer variants of `INPUT_INVALID`, a renamed `PLAN_STALE` | 🟡 `USAGE` for unknown command, `PLAN_CHANGED`, nine `INPUT_*` variants, `INPUT_ELEMENT_FAILED` | 🔴 |
| Registry `{code,exit,retryable,meaning,fix}` (7.3) | codes without an exit or a fix | ✅ 175 codes | 🔴 no exit/retryable per code |
| Exit from registry only; precondition and during-the-work codes (7.3.2, 8.3) | call sites that set an exit; one I/O code for both stages | 🔴 `with_exit`, batch overrides; `WRITE_FAILED` exit 2 | 🔴 |
| Exits 0/1/2 only (8.6) | exit 3 and up; a successful change reported as a failure | ✅ | 🔴 exit 3; accepted patch exit 1 |

### L1: grammar and `schema`

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| Noun-verb, ≤ 2 words (9.1, SHOULD) | three-word paths, compound verbs | ✅ | ✅ toolchain verbs |
| No runnable groups (9.2) | a node that runs and has children | ✅ | 🔴 `scenario` |
| Modes (9.3) | an option that turns a read into a write | ✅ (0.28 split `report`) | ✅ `compile --stream` is a declared output |
| One operand kind; modifiers are options (9.4) | a second operand of another kind (`add <TARGET> <LABEL>...`) | ✅ | ✅ |
| Bare-noun ids (9.5) | `--thing-id` | ✅ | ✅ |
| Reserved names (9.8) | `--yes`, `--force`, `--offset`, `--input` used for something else | ✅ | ✅ |
| Argv syntax incl. `--` and `--name=value` (9.12) | | ✅ clap | ✅ clap |
| `schema [path] --json` (10.1) | `schema` that refuses `--json`, or none | ✅ | 🔴 refuses `--json` |
| Works without state, writes nothing (10.2) | telemetry or logs written by `schema` | ✅ (audit only on success) | 🔴 telemetry on every invocation |
| Tree with groups, `level` (10.3) | a flat leaf list | 🔴 flat leaf list | 🟡 top level only |
| `group` doc (10.4) | | 🔴 returns leaves | 🟡 node with subcommands |
| Command fields (10.5) | missing effect, errors or examples | 🟡 renames (`about`, `errorCodes`, `exits`, `nodeKind`); `schemas` only in the checked-in file | 🔴 no effect/errors/examples |
| `valueType` (10.7.2) | `takesValue` or `flag/value` only | 🔴 `flag/count/value` | 🔴 `takesValue` only |
| Typed defaults (10.7.3) | defaults as strings or prose | 🔴 strings, `[]` for 100 | 🔴 strings |
| `flagOnly` (10.7.1) | | 🟡 enforced, not published | n/a |
| Constraints (10.8) | relations checked in handlers and not published | 🟡 `requiredOneOf`, `conflictsWith`, `requires` published; value-conditional ones (`FINDING_REASON_REQUIRED`) not | 🔴 |
| Domains in the profile (10.7.4) and safe integers (10.7.5) | bounds checked in handlers | 🔴 `--round`/`--seq` ≥ 1 checked by handlers (`FINDING_INVALID_ARGUMENT`), not published | 🔴 |
| Validators (10.8.3) | stateless checks outside the domain profile | 🔴 `<TIMESTAMP>` (RFC 3339 or `YYYY-MM-DD`) checked, not published | *unmeasured* |
| Output schemas incl. artifacts (10.9) | reports without a JSON Schema | 🟡 schemars, artifacts have a schema; not in runtime answers | 🔴 |
| `--errors`/`--error` (7.3.4) | | ✅ | 🔴 `--explain` text |
| Help points at `schema` (4.7) | | *unmeasured* | 🔴 |
| Paging, fields (6.9, 6.10) | offsets, paging fields inside `data` | 🟡 `--limit/--cursor/--all/--fields`, paging in flattened meta, `UNKNOWN_FIELD`, snake_case accepted | 🟡 `context --max-items` |

### L2: input, safety, long-running, guides

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| `--input` on every write (11.1) | | ✅ 47 leaves | 🔴 |
| Processing order, fragment schema, normalisation (11.5, 11.7) | a published input schema with `required`; argv parsed alone before the merge | 🟡 accepts numeric strings; publishes `required`; parses the merged argv only | — |
| Pointers for input-sourced errors (11.8) | | ✅ for document errors; *unmeasured* for parser errors | — |
| Conversion with operands after `--` (11.9) | | *unmeasured* | — |
| Batches (11.11) | a per-item failure code, exit overrides | 🟡 `INPUT_ELEMENT_FAILED`, exit overrides; pointer `/items/<i>/…` | — |
| Refusals and previews write nothing (12.2) | logs, telemetry or caches written before the command ran | 🟡 `read_effects.rs` whitelists `subject show` writes | 🔴 telemetry |
| Preview + digest (12.4-12.7) | `--yes`, prompts, `--dry-run` as the only safety | ✅ 5 leaves; bare-hex digest; `PLAN_CHANGED` | 🟡 `tag --renumber --commit`, no digest |
| Commit `next` from normalised arguments (12.5) | | *unmeasured* | — |
| `async`, waiting (13.2, 13.3) | | ✅ (`waitingOn`) | n/a |
| Operation keys (13.4) | `--request-id`-style options | n/a | n/a |
| Stream protocol (13.5), with `output` on the start line when there are several outputs (13.5.1) | raw NDJSON without start and end lines | 🔴 `dashboard` | 🔴 `compile --stream`, `play --events` |
| `skills show` (14) | a guide only on a website | 🟡 `NAME` required; `{name, version, markdown}` | 🔴 |
| Guide commands parse (14.5) | | ✅ `docs_lint.rs` | — |

**Where they stand:** canon is close to L2 with mechanical changes plus one design change (the input order and
batch result). lute is below L0 because of its flat envelope.

## 2. Order for any tool

1. **L0 first.** Output selection, the envelope, errors, the registry and exits do not depend on the parser.
   Change every caller of the tool's JSON in the same release.
2. **L1.** Generate the self-description from the parser (Rust: approaches/rust.md; TypeScript:
   approaches/typescript.md), add `level`, value types, typed defaults, constraints, domains, validators and
   output schemas. Run the checker at L1.
3. **L2.** `--input` in the order of spec 11.7, preview and commit with a digest, operation keys, streams and the
   embedded guide. Run the checker at L2.
4. Whatever the tool, the changes that are not renames: no `--yes` (spec 12.8); a digest at `data.planDigest`;
   `--operation` as the idempotency key (spec 13.4); several values of one kind as a repeatable option (spec 9.4);
   no log or telemetry for refusals, previews and `schema` (spec 12.2).

## 3. Worked examples

### 3.1 canon (reference implementation, Rust)

canon has every mechanism the contract asks for, so it proves the contract and becomes the source of the shared
Rust crate.

1. Extract `envelope`, `error`, `spec`, `schema`, `input`, `safety`, `stream`, `skills` into the shared crate
   (approaches/rust.md §3) and switch canon to it.
2. Wire changes: `meta.tool`/`toolVersion`/`contract`/`output`; omit nulls and empty arrays; `meta.command`
   omitted when nothing resolved; paging extras → `meta.page`; `unchanged`/`waitingOn` → reports (minor bumps);
   warnings with codes; `next` with `--json`; `PLAN_CHANGED` → `PLAN_STALE`; `INPUT_*` → reserved codes;
   `UNKNOWN_COMMAND`, `COMMAND_REQUIRED` where `USAGE` is used today; remove `with_exit`; `BATCH_INCOMPLETE`;
   `WRITE_FAILED` exit 1 (plus a precondition code where the same failure can happen before the work starts); `UNKNOWN_FIELD` → `USAGE`.
3. Self-description: tree with groups and `level`; group documents; `valueType`; typed defaults; `flagOnly`;
   `constraints` (including the value-conditional checks handlers make today); `domain` for every stateless
   restriction of one argument (`--round`/`--seq`/`--limit` ≥ 1, in the profile of spec 10.7.4, declared in the
   per-command table and tested against the real parser, approaches/rust.md §4.3); `validators` for the checks
   outside the profile (`<TIMESTAMP>` options); integers refused outside ±(2^53-1); every command listing the
   reserved codes of its features (`CURSOR_INVALID` on paged lists); `schemas` in the command document;
   `roles` → `x-canon`.
4. `--input` in the order of spec 11.7, with the conflict check on lexically extracted argv (approaches/rust.md §6)
   instead of a full clap parse of the argv alone; fragment schemas without `required`; no `#` comments in NDJSON;
   batch pointers `/<i>/…`; a batch item whose finding does not exist fails the batch with `BATCH_INCOMPLETE`
   instead of failing preflight.
5. A purge preview lists the audit line its commit appends among `effects` (spec 12.4); lifted report schemas lose
   their own `$id`; a `--cursor` given with other filter arguments refuses (spec 6.9).
6. `skills show` with an optional `NAME` and `{name, text, guides, full}`; `dashboard` on the stream protocol,
   with `output` on the start line when it declares more than one output (spec 13.5.1); `subject show` writes
   moved out of a `read` command or the command made `write`.
7. Run the checker at L2 in CI. Every consumer of canon JSON (hooks, the skill, the website) moves in the same
   release.

### 3.2 lute (Rust, using the crate from canon)

Nested envelope; registry with exits; stderr quiet in JSON; per-output versions; exit 3 → exit 1 with a code;
accepted patch → exit 0; `schema --json`; split `scenario`; `tag --renumber` digest-bound; `--input`; stream
protocol for `compile --stream` and `play --events`; `skills show`; no telemetry for refusals, `schema` and help.
Callers: the website and every harness that parses lute JSON. approaches/rust.md §7 has the details.

## 4. Costs the contract does not soften

| Rule | Who pays | Cost |
|---|---|---|
| No `--yes`; every destructive act previews and commits with a digest (12.8, D11.11) | any tool with `--yes`, `--force` or a confirmation prompt | One extra call per destructive act; the plan must cover the target's state so the digest means something; prompts go; every caller that passes `--yes` today (scripts, guides, the tool's own `next`) changes in the same release. |
| Refusals, previews and `schema` write nothing at all (12.2) | lute (telemetry on every invocation), canon (`subject show` writes as a read); any tool that logs every run | Telemetry and logs recorded only after a successful command; storage resolved only after the scope is checked; canon reclassifies or splits `subject show`. |
| One operand kind; modifiers are options (9.4) | any tool with a second operand of another kind | The values become a repeatable option; callers and guides change. |
| Fragment schemas without `required`; argv and document merged before requirements (11.7) | canon | canon's input path must stop rejecting a partial document before the merge; it publishes fragment schemas. |
| Batch failure during execution is always `BATCH_INCOMPLETE` with the batch report (11.11) | canon | `INPUT_ELEMENT_FAILED` and the exit overrides go; batch consumers read `data.items`. |
| Output schemas for artifacts (10.9) | canon (`skills show`, `export`, approval payloads, `completion`) | A JSON representation type per artifact command; `skills show` data changes shape (a major bump). |
| Exit 1 = ran with a negative or incomplete answer, 2 = refused to run (8.1, 8.3, D15) | every tool | Registries split I/O and backend codes into a precondition code (2) and a during-the-work code (1); exits move. |
| Stream protocol (13.5) | lute, canon | NDJSON outputs gain start and end lines; consumers that read raw lines change. |

## 5. Cutover rules

- Each tool moves in one release per level, with every caller migrated in that release; no compatibility flags
  (spec 9.10).
- A tool's changelog lists every renamed command, option and error code with its replacement.
- The checker runs in CI from the release that claims the level; before that it can run in report-only mode to
  show the remaining gaps.
