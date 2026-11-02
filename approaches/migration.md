# Adopting ATIP: a checklist and two worked examples

Not normative. How an existing command-line tool moves to ATIP, level by level, with canon 0.31.0 and lute 0.52.0
(both Rust, clap) as worked examples. Their status below is from their source and their read-only `schema`
output; anything not established that way is marked *unmeasured*. Section numbers ("spec 10.7") refer to
`spec/atip-1.md`, version 1.3.0.

The contract is not softened to ease adoption; where a rule costs a tool real work, the cost is recorded here (§4).

## 1. Checklist with the two examples

Legend: ✅ conforms · 🟡 close, mechanical change · 🔴 missing or different by design.

### L0: output selection, envelope, errors, exits

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| Text default, `--json` selects (4.3.1-4.3.3) | JSON by default, or an environment variable or TTY check that switches it | ✅ | ✅ |
| JSON mode from argv before parsing (4.3.4) | a parse error printed as text although `--json` was given | ✅ | ✅ |
| One document on stdout; stderr never carries the result or the error (5.1-5.2) | diagnostics repeated on stderr; load failures printed on stdout | ✅ | 🔴 diagnostics duplicated on stderr |
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
| Core codes (7.3) | finer variants of `INPUT_INVALID`, a renamed `PLAN_STALE` | 🟡 `USAGE` for unknown command, `PLAN_CHANGED`, nine `INPUT_*` variants, `INPUT_ELEMENT_FAILED` | 🔴 |
| Registry `{code,exit,retryable,meaning,fix}` (7.4.1) | codes without an exit or a fix | ✅ 175 codes | 🔴 no exit/retryable per code |
| Exit from registry only; precondition and during-the-work codes (7.4.2, 8.3) | call sites that set an exit; one I/O code for both stages | 🔴 `with_exit`, batch overrides; `WRITE_FAILED` exit 2 | 🔴 |
| Exits 0/1/2 only (8.6) | exit 3 and up; a successful change reported as a failure | ✅ | 🔴 exit 3; accepted patch exit 1 |
| Code names: a tool's own code is `<SUBJECT>_<CONDITION>`; refusal conditions (`*_INVALID`, `*_NOT_FOUND`, `*_UNAVAILABLE`, …) exit 2, `*_FAILED`, `*_INCOMPLETE`, `*_TIMEOUT` exit 1 (7.2; MUST for a 1.3 tool) | one I/O code for both stages | 🟡 `WRITE_FAILED` exit 2 today | 🔴 |
| A refusal prints nothing on stdout in text mode; exit 1 may print its result (5.3) | a refusal that prints partial output | *unmeasured* | *unmeasured* |
| Signals: a wait status or a launcher's 128+n, never another code (8.4, SHOULD) | a JavaScript or shell launcher that exits 1 when the binary is killed | *unmeasured* | *unmeasured* |
| `schema --errors` and `--error <CODE>` at L0 (7.4.4, SHOULD) | an L0 tool whose registry the checker cannot see | ✅ | 🔴 `--explain` text |
| `USAGE` carries `field`, else its hint names `<tool> schema <command> --json` (7.1.3, SHOULD) | a parse error that names no argument and has no hint | *unmeasured* | 🔴 no `field` |
| `meta.contractVersion` on every envelope of a tool that uses a 1.1 member (15.7) | a 1.1 member with no declaration | *unmeasured* | 🔴 |

### L1: grammar and `schema`

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| Noun-verb, ≤ 2 words (4.1.1, SHOULD) | three-word paths, compound verbs | ✅ | ✅ toolchain verbs |
| No runnable groups (4.1.2) | a node that runs and has children | ✅ | 🔴 `scenario` |
| Modes (4.6.1) | an option that turns a read into a write | ✅ (0.28 split `report`) | ✅ `compile --stream` is a declared output |
| One operand kind; modifiers are options (4.6.2) | a second operand of another kind (`add <TARGET> <LABEL>...`) | ✅ | ✅ |
| Bare-noun ids (4.6.3) | `--thing-id` | ✅ | ✅ |
| Reserved names (4.5) | `--yes`, `--force`, `--offset`, `--input` used for something else | ✅ | ✅ |
| Argv syntax incl. `--` and `--name=value` (4.2) | | ✅ clap | ✅ clap |
| `schema [path] --json` (9.1) | `schema` that refuses `--json`, or none | ✅ | 🔴 refuses `--json` |
| Works without state, writes nothing (9.2) | telemetry or logs written by `schema` | ✅ (audit only on success) | 🔴 telemetry on every invocation |
| Tree with groups, `level` (9.3) | a flat leaf list | 🔴 flat leaf list | 🟡 top level only |
| `group` doc (9.4) | | 🔴 returns leaves | 🟡 node with subcommands |
| Command fields (9.5) | missing effect, errors or examples | 🟡 renames (`about`, `errorCodes`, `exits`, `nodeKind`); `schemas` only in the checked-in file | 🔴 no effect/errors/examples |
| `valueType` (9.7.2) | `takesValue` or `flag/value` only | 🔴 `flag/count/value` | 🔴 `takesValue` only |
| Typed defaults (9.7.3) | defaults as strings or prose | 🔴 strings, `[]` for 100 | 🔴 strings |
| `flagOnly` (9.7.1) | | 🟡 enforced, not published | n/a |
| Constraints (9.8) | relations checked in handlers and not published | 🟡 `requiredOneOf`, `conflictsWith`, `requires` published; value-conditional ones (`FINDING_REASON_REQUIRED`) not | 🔴 |
| Domains in the profile (9.7.4) and safe integers (9.7.5) | bounds checked in handlers | 🔴 `--round`/`--seq` ≥ 1 checked by handlers (`FINDING_INVALID_ARGUMENT`), not published | 🔴 |
| Validators (9.8.3) | stateless checks outside the domain profile | 🔴 `<TIMESTAMP>` (RFC 3339 or `YYYY-MM-DD`) checked, not published | *unmeasured* |
| Output schemas incl. artifacts (9.9) | reports without a JSON Schema | 🟡 schemars, artifacts have a schema; not in runtime answers | 🔴 |
| `--errors`/`--error` (7.4.4) | | ✅ | 🔴 `--explain` text |
| Help points at `schema` (4.4.2) | | *unmeasured* | 🔴 |
| Paging, fields (6.9, 6.10) | offsets, paging fields inside `data` | 🟡 `--limit/--cursor/--all/--fields`, paging in flattened meta, `UNKNOWN_FIELD`, snake_case accepted | 🟡 `context --max-items` |
| Tool-wide options accepted after a group word wherever `--json` is (4.7, SHOULD) | `<tool> <group> --repo . --json` answered `USAGE` | *unmeasured* | *unmeasured* |
| Reasons under codes (7.6, optional) | finer codes for one situation, or prose that callers parse | 🟡 nine `INPUT_*` variants are the natural reasons of `INPUT_INVALID` | *unmeasured* |
| Warning registry, `schema --warnings` / `--warning` (7.5.2, optional) | warning codes registered only as error entries with `exit` 1 | *unmeasured* | *unmeasured* |
| Escaped field paths `attributes["http.status-code"]` and map keys (6.10, optional) | a `--fields` that cannot name a key with a dot | *unmeasured* | *unmeasured* |

### L2: input, safety, long-running, guides

| Rule | What to look for in your tool | canon | lute |
|---|---|---|---|
| `--input` on every write (10.1) | | ✅ 47 leaves | 🔴 |
| Processing order, fragment schema, normalisation (10.5, 10.7) | a published input schema with `required`; argv parsed alone before the merge | 🟡 accepts numeric strings; publishes `required`; parses the merged argv only | — |
| Pointers for input-sourced errors (10.8) | | ✅ for document errors; *unmeasured* for parser errors | — |
| Conversion with operands after `--` (10.9; approaches/implementation.md §4) | | *unmeasured* | — |
| Batches (10.11) | a per-item failure code, exit overrides | 🟡 `INPUT_ELEMENT_FAILED`, exit overrides; pointer `/items/<i>/…` | — |
| `--input` twice, or last with no value, is `USAGE` with `field` `--input` (10.2) | `INPUT_INVALID` for a malformed command line | *unmeasured* | — |
| Refusals and previews write nothing (11.2); a `read` may write the cache or audit line its `effectNote` names when it ran (exit 0 or 1), never on a refusal, a preview or `--dry-run` (11.1, 11.2) | logs, telemetry or caches written before the command ran, or on a refusal | 🟡 `read_effects.rs` whitelists `subject show` writes | 🔴 telemetry |
| Preview + digest (11.4-11.7) | `--yes`, prompts, `--dry-run` as the only safety | ✅ 5 leaves; bare-hex digest; `PLAN_CHANGED` | 🟡 `tag --renumber --commit`, no digest |
| Commit `next` from normalised arguments (11.5) | | *unmeasured* | — |
| `async`, waiting (12.2, 12.3) | | ✅ (`waitingOn`) | n/a |
| Operation keys (12.4) | `--request-id`-style options | n/a | n/a |
| Stream protocol (13), with `output` on the start line when there are several outputs (13.1) | raw NDJSON without start and end lines | n/a: `dashboard` is a report that then serves until signalled, not a stream (spec 1.2, 8.4) | 🔴 `compile --stream`, `play --events` |
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
3. **L2.** `--input` in the order of spec 10.7, preview and commit with a digest, operation keys, streams and the
   embedded guide. Run the checker at L2.
4. Whatever the tool, the changes that are not renames: no `--yes` (spec 11.8); a digest at `data.planDigest`;
   `--operation` as the idempotency key (spec 12.4); several values of one kind as a repeatable option (spec 4.6.2);
   no log or telemetry for refusals, previews and `schema` (spec 11.2).

## 3. Worked examples

### 3.1 canon (reference implementation, Rust)

canon has every mechanism the contract asks for, so it proves the contract and becomes the source of the shared
Rust crate.

1. Extract `envelope`, `error`, `spec`, `schema`, `input`, `safety`, `stream`, `skills` into the shared crate
   (approaches/rust.md §3) and switch canon to it. 2. Wire changes: `meta.tool`/`toolVersion`/`contract`/`output`;
   omit nulls and empty arrays; `meta.command` omitted when nothing resolved; paging extras → `meta.page`;
   `unchanged`/`waitingOn` → reports (minor bumps); warnings with codes; `next` with `--json`; `PLAN_CHANGED` →
   `PLAN_STALE`; `INPUT_*` → core codes; `UNKNOWN_COMMAND`, `COMMAND_REQUIRED` where `USAGE` is used today;
   remove `with_exit`; `BATCH_INCOMPLETE`; `WRITE_FAILED` exit 1 (plus a precondition code where the same failure
   can happen before the work starts); `UNKNOWN_FIELD` → `USAGE`. 3. Self-description: tree with groups and `level`;
   group documents; `valueType`; typed defaults; `flagOnly`; `constraints` (including the value-conditional checks
   handlers make today); `domain` for every stateless restriction of one argument (`--round`/`--seq`/`--limit` ≥ 1,
   in the profile of spec 9.7.4, declared in the per-command table and tested against the real parser,
   approaches/rust.md §4.3); `validators` for the checks outside the profile (`<TIMESTAMP>` options); integers
   refused outside ±(2^53-1); every command listing the core codes of its features (`CURSOR_INVALID` on paged
   lists); `schemas` in the command document; `roles` → `x-canon`. 4. `--input` in the order of spec 10.7, with the
   conflict check on lexically extracted argv (approaches/rust.md §6) instead of a full clap parse of the argv
   alone; fragment schemas without `required`; no `#` comments in NDJSON; batch pointers `/<i>/…`; a batch item
   whose finding does not exist fails the batch with `BATCH_INCOMPLETE` instead of failing preflight. 5. A purge
   preview lists the audit line its commit appends among `effects` (spec 11.4); lifted report schemas lose their own
   `$id`; a `--cursor` given with other filter arguments refuses (spec 6.9). 6. `skills show` with an optional
   `NAME` and `{name, text, guides, full}`; `dashboard` stays a command with a report output: with `--json` it
   prints one envelope and then serves until it is signalled, which its `effectNote` says. It is not a stream (a
   server is out of scope beyond its starting command's output, spec 1.2, and a run ended by a signal promises no
   envelope, 8.4), and the fixture lists it in `notRun` (approaches/checker.md §5) so the checker never waits on it;
   `subject show` keeps its cache as a `read` command whose `effectNote` names the cache (spec 11.1), and writes it
   only once the command has run (exit 0, or exit 1 for an incomplete answer): never on a refusal, a preview or
   `--dry-run` (11.2), so it writes the cache only after its checks pass. 7. Run the checker at L2 in CI. Every
   consumer of canon JSON (hooks, the skill, the website) moves in the same release.

### 3.2 lute (Rust, using the crate from canon)

Nested envelope; registry with exits; stderr quiet in JSON; per-output versions; exit 3 → exit 1 with a code;
accepted patch → exit 0; `schema --json`; split `scenario`; `tag --renumber` digest-bound; `--input`; stream
protocol for `compile --stream` and `play --events`; `skills show`; no telemetry for refusals, `schema` and help.
Callers: the website and every harness that parses lute JSON. approaches/rust.md §7 has the details.

## 4. Costs the contract does not soften

| Rule | Who pays | Cost |
|---|---|---|
| No `--yes`; every destructive act previews and commits with a digest (11.8, D11.11) | any tool with `--yes`, `--force` or a confirmation prompt | One extra call per destructive act; the plan must cover the target's state so the digest means something; prompts go; every caller that passes `--yes` today (scripts, guides, the tool's own `next`) changes in the same release. |
| Refusals, previews and `schema` write nothing at all (11.2) | lute (telemetry on every invocation), canon (`subject show`, a read that writes a cache); any tool that logs every run | Telemetry and logs recorded only after a successful command; storage resolved only after the scope is checked. A `read` command may still keep a cache or an audit line its `effectNote` names (11.1), written only once the command has run (exit 0 or 1), never on a refusal; it need not become a `write`. |
| One operand kind; modifiers are options (4.6.2) | any tool with a second operand of another kind | The values become a repeatable option; callers and guides change. |
| Fragment schemas without `required`; argv and document merged before requirements (10.7) | canon | canon's input path must stop rejecting a partial document before the merge; it publishes fragment schemas. |
| Batch failure during execution is always `BATCH_INCOMPLETE` with the batch report (10.11) | canon | `INPUT_ELEMENT_FAILED` and the exit overrides go; batch consumers read `data.items`. |
| Output schemas for artifacts (9.9) | canon (`skills show`, `export`, approval payloads, `completion`) | A JSON representation type per artifact command; `skills show` data changes shape (a major bump). |
| Exit 1 = ran with a negative or incomplete answer, 2 = refused to run (8.1, 8.3, D15) | every tool | Registries split I/O and backend codes into a precondition code (2) and a during-the-work code (1); exits move. |
| Stream protocol (13) | lute | NDJSON outputs gain start and end lines; consumers that read raw lines change. |

## 5. Cutover rules

- Each tool moves in one release per level, with every caller migrated in that release; no compatibility flags
  (spec 4.6.7).
- A tool's changelog lists every renamed command, option and error code with its replacement.
- The checker runs in CI from the release that claims the level; before that it can run in report-only mode to
  show the remaining gaps.

## 6. From 1.0 to 1.1

For the author of a tool that conforms to 1.0, and for the author of a caller. 1.1.0 (spec 15.9) is the only
release that changes what a 1.0 caller must accept; every later 1.x keeps 15.1 and 15.6.

**Nothing is forced.** A 1.0 tool stays conforming without a change. It declares nothing, the checker's default
claim is `1.0`, and its documents carry no 1.1 member. The additions are optional or SHOULD:

| Addition | Spec | Strength |
|---|---|---|
| `error.reason` and registry `reasons` (reserved names for the core codes) | 7.1.1, 7.3.3, 7.6 | optional |
| A warning registry: `schema --warnings`, `schema --warning <CODE>` | 7.5.2, 7.5.3 | optional; SHOULD for a 1.1 tool's warning codes |
| Escaped keys in field paths, map keys selectable | 6.10 | optional |
| `schema --errors` and `--error` at L0 | 7.4.4 | SHOULD |
| Tool-wide options accepted after a group word | 4.7 | SHOULD |
| `USAGE` with `field`, or a hint naming `<tool> schema <command> --json` | 7.1.3 | SHOULD |
| Precondition and during-the-work code names; a code with two exits split in two | 7.4.2, 8.3 | naming SHOULD |
| Conservative staging: a write leaf reports a failure it cannot place as exit 1 | 8.3.1 | MAY |
| `--input` twice or without a value refused with `USAGE` | 10.2 | SHOULD for a 1.0 tool; MUST once it declares 1.1 |
| Text mode: a command that exits 1 prints its result on stdout | 5.3 | MAY (callers: see 15.9) |
| A launcher re-raises the signal or exits 128+n | 8.4 | SHOULD |

**If the tool uses any 1.1 member, it declares 1.1.** It sets `meta.contract` and `meta.contractVersion` (`"1.1"`)
on every envelope, a stream's end result included, and `contract` and `contractVersion` on every stream start line,
and its `schema` answers carry `meta.schemaVersion` `"1.1"` (spec 15.7, 9.1.4, 9.13 rule 16). The value is the same on every
document one build prints; in a Rust or TypeScript tool it is one constant of the shared package
(approaches/rust.md §3.1, approaches/typescript.md §3.2). The reverse holds as well: a tool that declares `1.0`
emits no reason, no `warnings` or `warning` document and no bracketed path, and the checker fails it if it does
(L0.contract-version). Declaring 1.1 also turns on rules that are meanings rather than members: a hint that
starts with the tool name must be a command line (7.1.2), so reword prose hints such as "canon can't find …"; a
declared map's keys become selectable and the map becomes a cut node (6.10), so drop `minProperties` and the like
from it or stop declaring it; and `--input` given twice must be `USAGE` (10.2). The tool's fixture gets `contractVersion: "1.1"` and a `registry` (approaches/checker.md §5),
and it claims "ATIP 1.1 L1".

**A caller's new duty (spec 15.6, 15.8).** Ignore every member you do not know, in every object the contract
defines, not only in reports; do not fail a document because a listed value (`data.kind`, `valueType`, `effect`) is
one you do not know, and do not act on what you cannot interpret (an unknown `effect` is `destructive`; an argument of an unknown
`valueType` is left out, and a command that requires one cannot be run). Spec 15.6 has one table with the treatment
of an unknown value for every listed member. A listed member that is not a string is a wrong type, not an unknown value. When validating, drop the completeness rules your view can no longer meet
(spec 15.8). Validate
with the published schemas read open (`additionalProperties: false` taken as absent), or not at all. Look a warning
code up in the warning registry first, when the tool has one, and the error registry second (7.5.3). Treat a missing `contractVersion` as
`1.0`. A caller that branches on `code` alone keeps working with a 1.1 tool: a reason refines a code and never
replaces it. The one-time break (15.9): a 1.0 caller that validated tool output against the closed 1.0 schemas
rejects the members 1.1 adds, and must be changed before it meets a 1.1 tool.

**Checklist for a tool author moving to 1.1**

1. Pick the additions that earn their place: reasons where one code hides situations that need different next
   actions (canon's `INPUT_*` variants, folded into `INPUT_INVALID`, are the example); a warning registry where
   the tool emits warnings (lute's diagnostics registry is the example, approaches/rust.md §7).
2. Add `contractVersion` from one constant; add `reasons` and `WarningInfo`/`defineWarning` rows so that an
   unregistered reason or warning does not compile or type-check (approaches/rust.md §3.1,
   approaches/typescript.md §3.1).
3. Offer `schema --errors` and `--error` at any level, and `--warnings` and `--warning` when there is a warning
   registry. A warning-only code given to `--error` refuses with the `--warning` hint.
4. Accept tool-wide options after group words; make `USAGE` carry `field`; answer `--input` twice or without a
   value with `USAGE`, `field` `--input`.
5. Name the stages of failure codes; decide per write leaf between a work-begins marker and conservative staging
   (approaches/rust.md §3.6, approaches/typescript.md §3.7).
6. Add the fixture's `contractVersion`, `registry`, `warnings`, `globalOptions` and `missingValue`, run the checker
   at the claimed level, and record in the changelog what changed.

## 7. From 1.1 to 1.2

For the author of a tool that conforms to 1.1, and for the author of a caller. 1.2.0 changes nothing a 1.1 caller
relied on (spec 15.9).

**Nothing is forced.** A 1.1 tool stays conforming as a 1.1 tool; every 1.2 rule applies only to a tool that
declares 1.2 (spec 9.13 rule 16). Declaring 1.2 turns on:

| Rule | Spec | Strength for a 1.2 tool |
|---|---|---|
| A cursor is bound to every argument except `--json`, `--limit`, `--all`, `--cursor`, `--fields`; an argument given with its default value is given (a switch given `false` or a count given `0` is absent); `env` values are bound; the next-page `next` carries only the arguments given explicitly | 6.9, approaches/implementation.md §3 | MUST |
| `--fields` parsed and validated with or without `--json`; its effect on text is the tool's | 6.10 | MUST |
| `limit`, `cursor`, `all` and `fields` are flag-only (`flagOnly: true`, not in the fragment schema) | 4.5, 10.6, 9.13 rule 8 | MUST |
| Argv parse failures first; then step 6 checks `required`, domains, constraints, validators in that order (operands then options in declaration order for the first two, declaration order for the last two); the first failure answers | 10.7, approaches/implementation.md §1 | MUST |
| A constraint's `field` per rule: the first missing `then` name of `requires`, the first given `then` name of `forbids`, the first given name of `atMostOne`/`exactlyOne`, the first name when none is given | 9.8.1, approaches/implementation.md §2 | MUST |
| A stop after a step made effects is `STOPPED_MIDWAY` (exit 1, not retryable), `reason` the refusal's code alone, `next` reading what was done | 8.3.2, 15.9 | SHOULD; a registered `STOPPED_MIDWAY` has that exit, retryability and meaning, which hold only in a 1.2 document |

A tool moves by setting its contract constant to `"1.2"` (approaches/rust.md §3.1, approaches/typescript.md §3.2),
marking the four options flag-only, changing its cursor digest (approaches/typescript.md §3.8), and replacing any
during-the-work twins of refusal codes with `STOPPED_MIDWAY` and one reason per refusal (a tool that already has a
code of its own for this keeps it until it chooses to move; spec 4.6.7 applies to the rename). Its fixture gets
`contractVersion: "1.2"`, and the checker then runs the 1.2 halves of L1.grammar, L1.registry, L1.paging,
L1.fields, L1.check-order and L2.input-refusals (approaches/checker.md §6).

**A caller.** Nothing changes for a caller that pages with `meta.next` in the same environment. With a tool that
declares 1.2, a caller may also replace `--limit` by `--all` while paging; it puts `--limit`, `--cursor`, `--all`
and `--fields` on argv, never in a document; and it reads `STOPPED_MIDWAY` as any exit 1 after effects: read what
was done (`next`) before acting on the reason. In a document that declares 1.1 or 1.0, `STOPPED_MIDWAY` is the
tool's own code: read its registry entry. A tool moving on to 1.3 replaces `STOPPED_MIDWAY` with its own `INCOMPLETE` code (§8).

## 8. From 1.2 to 1.3

For the author of a tool that conforms to 1.2, and for the author of a caller. 1.3.0 adds no member, document kind
or enum value, so a 1.2 caller reads every 1.3 document (spec 15.10).

**Nothing is forced.** A 1.2 tool stays conforming as a 1.2 tool: it is held to the 1.2.1 text (spec 15.9). Declaring
1.3 turns on:

| Rule | Spec | Strength for a 1.3 tool |
|---|---|---|
| Every error code is a core code or `<SUBJECT>_<CONDITION>`, and its exit and retryability are its condition's (`FAILED` and `INCOMPLETE` may be retryable when a repeat resumes without repeating effects) | 7.2.1-7.2.3 | MUST |
| Every warning code is in the warning registry; the error registry keeps a warning code only when it is also an error | 7.5.2 | MUST |
| A stop part-way after effects is a code of the tool's own whose condition is `INCOMPLETE`, `reason` the refused code; `STOPPED_MIDWAY` is not a core code and does not fit the grammar | 8.3.2 | SHOULD (the code name itself is MUST, 7.2.3) |
| Warning code names follow `<SUBJECT>_<STATE>` | 7.2.4 | SHOULD |

and relaxes three 1.2 MUSTs into recommendations (`approaches/implementation.md`), which a 1.3 tool may keep:

| 1.2 rule | 1.3 | Where |
|---|---|---|
| The fixed order among the stateless checks of step 6 | the first failure answers; stateless checks still come before any state read | spec 10.7, implementation §1 |
| A constraint's `field` per rule | `field` names an argument the caller can add or remove to satisfy the rule | spec 9.8.1, implementation §2 |
| An argument given at its default value binds a cursor; the next-page entry carries exactly the explicit arguments | recommendations; an `env` value still binds a cursor | spec 6.9, implementation §3 |

A tool moves by setting its contract constant to `"1.3"` (approaches/rust.md, approaches/typescript.md), renaming its
codes as below, moving its warning codes into the warning registry, and replacing `STOPPED_MIDWAY` with its own
`INCOMPLETE` code. Its fixture gets `contractVersion: "1.3"`; the checker then runs `L1.code-names` and the 1.3 halves
of the registry and warning checks (approaches/checker.md §6).

**Renaming codes to the convention.** The procedure of `approaches/implementation.md` §7, applied to a registry:

1. Print the registry (`schema --errors --json`). Core codes keep their names. A code that already ends in a
   condition with that condition's exit and retryability keeps its name too.
2. For every other code, decide the stage from what actually happens (a refusal before the work, or a failure after
   it started), then the condition from the caller's next action (spec 7.2.2), then the subject (a noun the tool
   already uses).
3. A code whose registered exit differs from its condition's either had the wrong exit or hid two situations: split
   it (spec 7.4.2). A code whose situations need different retryability is two codes as well.
4. A code that is only ever a warning moves to the warning registry.
5. A new name is never one the tool used before with another meaning (spec 15.5).
6. Renaming a code is a breaking change of the tool's command surface (spec 15.5): one release, every caller
   migrated in it, the tool's changelog listing each old name with its new one, and no aliases (spec 4.6.7).

**canon as the worked example.** Codes from canon's registry (`canon schema --errors --json`) that do not follow
7.2, with the name the convention gives. The codes the owner cited (`PROMOTE_REFUSED`, `INVENTORY_ABORTED`,
`PLUGIN_SYNC_ERRORS`) come first; the rest show each kind of change.

| canon today | Exit, retryable | Under 7.2 | Why |
|---|---|---|---|
| `PROMOTE_REFUSED` | 1, no | `PROMOTION_FAILED`, reason `GATE` | ran; the gate's answer is negative. "Refused" is the word of exit 2 |
| `PROMOTE_FAILED` | 1, no | `PROMOTION_FAILED`, reason `WRITE` | same subject, same condition and caller action (read `data`); a reason tells the two apart |
| `INVENTORY_ABORTED` | 1, no | `INVENTORY_INCOMPLETE` | ran, and covered less than it was asked; `data.roots` says what was not indexed |
| `INVENTORY_REFUSED` | 2, no | `CONFIG_INVALID` and `INDEX_UNAVAILABLE` (retryable) | one name hid two caller actions: fix the configuration, or wait for the lock |
| `PLUGIN_SYNC_ERRORS` | 1, no | `PLUGIN_WRITE_FAILED` | `PLUGIN_SYNC_FAILED` is taken by an exit-2 meaning and is never reused |
| `PLUGIN_SYNC_FAILED` | 2, no | `CONFIG_INVALID`, `PLUGIN_REQUIRED` | "could not start" splits by cause |
| `FINDING_INVALID_ARGUMENT` | 2, no | `FINDING_ARGUMENT_INVALID` | condition last |
| `FINDING_SEQ_OCCUPIED` | 2, no | `FINDING_EXISTS` | the object to create exists |
| `FINDING_STAGED` | 2, no | `FINDING_CONFLICT` | the target's state forbids the act |
| `CONFIG_MISSING`, `NO_COMMIT`, `CHANGE_AMBIGUOUS` | 2, no | `CONFIG_REQUIRED`, `COMMIT_REQUIRED`, `CHANGE_REQUIRED` | the caller supplies something |
| `UNKNOWN_ROLE` | 2, no | `ROLE_INVALID` | a value the caller gave (through `CANON_ROLE`) |
| `HUMAN_ONLY` | 2, no | `ACTOR_DENIED` | only a person may act (spec 11.9) |
| `RELAY_DIGEST_MISMATCH` | 2, no | `RELAY_DIGEST_STALE` | a value from an earlier answer no longer matches |
| `OLD_LAYOUT` | 2, no | `LAYOUT_UNSUPPORTED` | well-formed, but this build cannot work on it |
| `ARTIFACTS_STORE_UNREACHABLE` | 2, yes | `ARTIFACTS_STORE_UNAVAILABLE` | same meaning, the condition's word |
| `DASHBOARD_PORT_IN_USE` | 1, yes | `PORT_UNAVAILABLE` (exit 2) | a precondition: nothing ran yet |
| `DISPATCH_END_IN_PROGRESS` | 1, yes | `RUN_UNAVAILABLE` (exit 2) | another process holds the run; nothing ran yet |
| `SKILLS_DRIFT`, `REPORT_STALE`, `FORMAT_VIOLATIONS`, `GATE_VIOLATIONS` | 1, no | `SKILLS_CHECK_FAILED`, `REPORT_CHECK_FAILED`, `FORMAT_CHECK_FAILED`, `GATE_CHECK_FAILED`, reasons `DRIFT`, `STALE`, … | a check's negative answer is `FAILED`; `STALE` and `INVALID` are exit-2 words |
| `MIGRATE_STOPPED` | 1, no | `MIGRATION_INCOMPLETE`, MAY be retryable | "running it again finishes the rest" is what 7.2.3 allows to be retryable |
| `WRITE_FAILED`, `WRITE_UNAVAILABLE`, `FINDING_NOT_FOUND`, `SUBJECT_EXISTS`, … | | unchanged | already follow 7.2 |

The exact split of a code with several causes (`PLUGIN_SYNC_FAILED`) is canon's to decide from its call sites; the
table shows the direction, not canon's release.

**A caller.** Nothing changes for a caller that branches on `code`, `retryable` and the exit status. In a document
that declares 1.3, a caller MAY also read an unknown code's condition (spec 7.2): `NOT_FOUND` means look the name up,
`UNAVAILABLE` means repeat later, `INCOMPLETE` means read what was done before repeating. A stop part-way is no longer
`STOPPED_MIDWAY` but the tool's own `INCOMPLETE` code with the refused code as `reason`. A warning code is looked up in
the warning registry only. While paging, a 1.3 tool may continue a cursor given with an argument added at its
default value, where a 1.2 tool refuses it; a caller that pages with `meta.next` never meets the difference.

**Section numbers.** 1.3 restructures the spec as a protocol document. Citations of 1.2 sections map as follows
(the rest keep their numbers: 2, 5, 6, 7.1, 7.5, 7.6, 8, 14, 15.1-15.8, 16):

| 1.2 | 1.3 |
|---|---|
| 1.1, 1.2 / 1.3 / 1.4 / 1.5 / 1.6 | 1.2 / 1.4 / 1.1 / 3.5 / 1.5 |
| 3.1 / 3.2 / 3.3 / 3.4 | 3.2 / 3.3 / 3.4 / 3.5 |
| 3.5, 17 (checker MUST checks) | removed; 3.7 (testing is informative), `approaches/checker.md` |
| 4.1-4.5 / 4.6 / 4.7 / 4.8 | 4.3.1-4.3.5 / 4.4.1 / 4.4.2 / 4.4.3 |
| 7.2.1 / 7.2.2 / 7.2.3 | 7.3.1 / 7.3.2 / 7.3.3 (new 7.2: code names) |
| 7.3.1-7.3.4 / 7.4 | 7.4.1-7.4.4 / `approaches/implementation.md` §6 |
| 9.1 / 9.2 / 9.3-9.7 / 9.8 / 9.9-9.11 | 4.1.1 / 4.1.2 / 4.6.1-4.6.5 / 4.5 / 4.6.6-4.6.8 |
| 9.12.1 / 9.12.2 / 9.12.3 / 9.13 | 4.2.1 / 4.2.2 / `approaches/implementation.md` §4 / 4.7 |
| 10.N (10.13 rule N) | 9.N (9.13 rule N) |
| 11.N (11.7 step N) | 10.N (10.7 step N) |
| 12.N | 11.N |
| 13.1-13.4 / 13.5.1-13.5.4 | 12.1-12.4 / 13.1-13.4 |
| 15.9, 15.10 | 15.9 (earlier minors), 15.10 (1.3 and callers) |
| 18 | removed (all decided; Appendix A) |
