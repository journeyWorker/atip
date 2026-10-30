# The conformance checker

Not normative in its implementation; spec 17 makes passing its MUST checks at the claimed level a requirement.
Section numbers ("spec 11.7") refer to `spec/atip-1.md`, version 1.0.

## 1. What it is

One program, `atip check`, that runs a **built binary** and checks the contract from outside: argv in; stdout,
stderr, exit status and the file system out. It knows nothing about clap or Effect. Every tool's CI builds its
binary and runs the checker against it, so all tools are held to one implementation of the rules instead of five
test suites that agree by intention.

```
atip check --bin target/release/canon --level L2 --fixture checker-fixture.json [--json]
```

- `--level` is the claimed level. For L1/L2 the checker also reads `data.level` from `schema --json` and fails
  when the two differ.
- `--fixture` is the tool's fixture file (§5): the state and the invocations the stateful checks need.
- Its own output follows the contract: text by default, `--json` for an envelope whose `data` lists every check.

It is written in TypeScript and runs with `bunx`, so no tool installs anything into its repository. The JSON
Schemas in `schema/` and the semantic rules of `scripts/check.ts` (spec 10.13) are bundled with it.

## 2. Results and coverage

Every check has an id, the rule it enforces, and a **strength**: `MUST` (a failure fails the level) or `SHOULD`
(an advisory; reported, never failing). Each run reports, per check, one of:

| Result | Meaning |
|---|---|
| `pass` | Exercised and held. |
| `fail` | Exercised and violated (for a SHOULD check: an advisory). |
| `unsupported` | The tool does not offer the feature (no batches, no `--fields`); the check does not apply. |
| `unprovided` | The check needs a fixture entry the tool did not provide. |
| `entailed` | The rule cannot be violated alone: every invocation that breaks it also breaks another declared rule (a `required` argument, a domain, another constraint). The report names those rules. |

A level is passed when no MUST check fails **and** no MUST check of that level is `unprovided`: a tool cannot
pass by withholding fixtures. `unsupported` is decided from the self-description (a command without `input.batch`
is `unsupported` for batch checks), never from the fixture. `entailed` is decided from the self-description too,
and it does not fail the level when every rule it names has the result `pass` in the same run: a rule with its own
isolated witness. A rule that is itself `entailed` does not count as support, so a cycle of entailments with no
passed rule in it is `unprovided`, never a pass. `entailed` is never reported as `pass`, because nothing exercised
the rule itself. A logically redundant constraint ("`--a` requires `--b`" when `--b` is already required) is legal
(spec 10.8), and no fixture could isolate it.

Before generating witnesses, the checker groups constraints that are **equivalent**: rules with the same set of
violating invocations, computed over the finite table of which named arguments are given and which `in` class
each value falls in (`atMostOne [a, b]` and "`a` forbids `b`" are equivalent). A group is one test obligation: one
generated invocation that violates the group and nothing else. It must be refused with a code one of the group's
rules declares, and the result is reported for every rule of the group. Rules of one group that declare different
codes make the expected refusal ambiguous, and the check fails. The same relation written twice is not a group:
it is invalid (spec 10.8.2, 10.13 rule 4) and L1.walk reports it.

## 3. How it runs a binary

- Every **sequence** gets a fresh copy of the fixture state as cwd, `HOME` pointing into that copy, an environment
  with only `PATH`, `HOME`, `LANG=C.UTF-8` and the fixture's declared variables, stdin closed (`/dev/null`) unless a
  check says otherwise, and the fixture's timeout (default 30 s; a check that exceeds it is `fail` with the reason,
  so a slow tool is not mistaken for a wrong one). A sequence is one invocation, or a run of invocations that
  depend on each other's state and so share one copy: a start and the `next` waits that follow it, a page and
  the next page it points to, the two runs of an idempotency check, a preview and its commit.
- A check that needs a terminal on stdin or stdout runs the binary under a pseudo-terminal.
- Telemetry opt-outs are **not** set: a write the tool does on its own is what the effects check (§4) must see.
- Asynchronous checks use the fixture's controllable worker (§5), never wall-clock races.

## 4. The effects check

The checker snapshots the invocation's directory and `HOME` (path, size, SHA-256 of every file) before and after
the invocation, and asks the fixture's `probe` command for remote state when one is declared.

- For every **refusal** (exit 2), every **destructive preview**, every `--dry-run`, `--help`, `--version`,
  `schema` and `skills show`: any change is a MUST `fail` (spec 12.2). `effectNote` is not consulted.
- For a successful **`read`** command: a change is allowed only if it matches the fixture's `allowedEffects` glob
  list for that command, and the command has an `effectNote`. Any other change is a MUST `fail`; the report names
  the changed paths.

The checker runs the refusal and preview cases of this check with commands whose `effectNote` is non-empty too,
so a note can never hide a write.

Strength by level, so that no level acquires a higher level's checks (spec 3.2) and none loses a rule it already
has: a refusal (exit 2) that changes anything is a MUST failure from L0, because spec 8.1-8.2 (L0) already say a
refusal changes nothing; `schema` writing anything is a MUST failure from L1 (spec 10.2.3); previews, `--dry-run`,
`--help`, `--version`, `skills show` and the `read`-command allowlist are MUST failures at L2 (spec 12.2) and
advisories at L0 and L1. Stream, guide, input and preview checks run only for tools that offer the feature, as
`unsupported` otherwise (§2).

## 5. Fixtures

A tool supplies a fixture file:

```json
{
  "setup": [["init", "--json"], ["finding", "add", "--change", "add-login", "--round", "1", "--seq", "1", "--severity", "note", "--actor", "r1", "--summary", "s", "--json"]],
  "env": { "CANON_ACTOR": "fixture" },
  "timeoutSeconds": 30,
  "probe": "status",
  "commands": {
    "finding close": {
      "ok": [["finding", "close", "add-login", "--round", "1", "--seq", "1", "--disposition", "fixed", "--json"]],
      "refused": [["finding", "close", "add-login", "--round", "1", "--seq", "9", "--disposition", "fixed", "--json"]],
      "batchFailsAt": [{ "input": [{"operands":["add-login"],"round":1,"seq":1,"disposition":"fixed"},{"operands":["add-login"],"round":1,"seq":9,"disposition":"fixed"}], "index": 1 }],
      "batchFailsFirst": [{ "input": [{"operands":["add-login"],"round":1,"seq":9,"disposition":"fixed"}], "index": 0 }]
    },
    "member tag": {
      "ok": [["member", "tag", "7", "--tag", "core", "--json"]],
      "domainRejects": { "tag": ["Core", "-core", "core tag"] }
    },
    "finding list": {
      "ok": [["finding", "list", "--change", "add-login", "--json"]],
      "fields": [["round", "summary"]],
      "allowedEffects": [".canon/audit/access.jsonl"]
    },
    "purge": { "preview": [["purge", "--kind", "session", "--before", "2030-01-01", "--json"]] },
    "deploy start": { "async": { "start": ["deploy", "start", "staging", "--json"], "worker": "fixture-worker", "outcomes": ["done", "failed", "timeout"] } }
  },
  "search": [{ "query": "close a review finding", "expect": "finding close" }]
}
```

`setup` runs once into a template directory; every sequence (§3) runs in its own copy. The checker never runs a
`write` or `destructive` command that the fixture does not list. A command with no fixture entry makes its stateful
checks `unprovided`.

`domainRejects` lists, per argument, values the fixture author knows lie outside a `pattern` or a structural
domain. The checker substitutes each into the command's first `ok` invocation (spec 10.7.4). It cannot generate
such values itself: a string outside an arbitrary regular expression needs a solver.

For asynchronous commands the fixture names a **controllable worker**: a stub the tool's test build accepts (an
environment variable selecting a fake backend) that completes, fails or hangs on command. The checker drives
`done`, `failed` and `timeout` outcomes through it instead of waiting on real work.

## 6. Checks by level

Strength column: M = MUST, S = SHOULD. Every envelope the checker observes is validated against
`schema/envelope.schema.json`, and every observed failure's code is looked up in the registry (L1+) or in the
fixture's `registry` (L0).

### L0

| Id | | Invocation | Pass when | Rule |
|---|---|---|---|---|
| L0.version | M | `--version` | exit 0, stdout non-empty, stderr empty | 4.6 |
| L0.version-format | S | `--version` | one line `<tool> <version>` | 4.6 |
| L0.unknown-command | M | `nosuch-xyz --json` | exit 2; stdout is exactly one JSON document followed by one newline; `ok: false`; `UNKNOWN_COMMAND`; `expected` non-empty; no `meta.command`; `meta.schemaVersion` `1.0`; no `data`; stderr empty | 4.4, 5.1, 5.2, 6.4, 6.6, 6.11, 7.2 |
| L0.unknown-command-text | M | `nosuch-xyz` | exit 2; stdout empty; stderr non-empty | 5.3 |
| L0.text-error-form | S | `nosuch-xyz` | stderr starts `<tool>: UNKNOWN_COMMAND: ` | 7.4 |
| L0.bare | M | `--json` | exit 2, `COMMAND_REQUIRED` | 7.2, 9.2 |
| L0.unknown-option | M | `<probe> --bogus-xyz --json` | exit 2; a registered exit-2 code (`USAGE` or the tool's finer one, spec 7.2.2); `field: "--bogus-xyz"`; `meta.command` = the probe's id | 4.4, 6.6, 9.9 |
| L0.json-mode-preparse | M | `<probe> --json --bogus-xyz` and `<probe> --bogus-xyz --json` | both are JSON failures | 4.4 |
| L0.after-dashdash | M | `<probe> -- --json` | stdout is not an envelope | 4.4 |
| L0.ok-exit | M | every invocation | exit ∈ {0, 1, 2} or a signal; `ok` exactly when exit 0; exit equals the code's registered exit; `retryable` equals the registered value; no `data` on exit 2 | 6.2, 6.4, 7.3.2, 7.3.3, 8.1 |
| L0.no-null | M | every envelope | validates (the schema forbids `null` in `meta` and `error`) | 6.5 |
| L0.compact | S | every envelope | no indentation | 5.4 |
| L0.one-document | M | every JSON-mode stdout of a report or artifact command | UTF-8; the whole stdout parses as exactly one JSON document followed by one newline (indentation is allowed; see L0.compact) | 5.1 |
| L0.no-env-switch | M | `<probe> --json` with `CI=1`, `CLAUDECODE=1`, `OUTPUT_FORMAT=text`, `NO_COLOR=1`, `TERM=dumb`, and with stdout on a pty | each is still exactly one envelope with the same `ok`, `error.code` (if any), `meta.command`, `meta.schemaVersion` and the same set of `data` keys | 4.3 |
| L0.no-env-switch-text | M | `<probe>` (text mode) under the same variations | the output kind is the same under every variation: when the plain run's stdout is not an envelope, no variation's is; colour codes may differ. `schema` is not used as the probe, since its text mode may be the JSON document (spec 10.1.3) | 4.3 |
| L0.contract | S | every envelope | `meta.contract` present | 6.6 |

`<probe>` is the fixture's `probe` command: any command that runs without state.

### L1

| Id | | Invocation | Pass when | Rule |
|---|---|---|---|---|
| L1.tree | M | `schema --json` | validates against `schema-doc.schema.json`; spec 10.13 rule 1; every group before its commands; ids unique | 10.3, 10.13 |
| L1.no-state | M | `schema --json` in an empty directory, minimal environment | succeeds, and nothing is written (§4) | 10.2 |
| L1.walk | M | `schema <path> --json` for every tree entry | validates; spec 10.13 rules 1-11 and 13 (rule 12, the examples, is L1.examples); group → its tree children exactly | 10.4, 10.5, 10.13 |
| L1.quoted-path | M | `schema "<a b>" --json` for one two-word command | equals the split form | 10.1.1 |
| L1.schema-errors | M | `schema nosuch-xyz --json`; `schema --errors --error USAGE --json`; `schema <a group> --errors --json`; `schema --error NOSUCH_XYZ --json` | exit 2 with `UNKNOWN_COMMAND`, `USAGE`, `USAGE`, and `USAGE` with `field: "--error"` | 7.3.4, 10.1.2 |
| L1.registry | M | `schema --errors --json`, then `schema --error <CODE> --json` for each | entries validate; codes unique; reserved codes that the tool registers have their reserved exit and retryability; `USAGE` (or its finer replacements), `UNKNOWN_COMMAND`, `COMMAND_REQUIRED`, `INTERNAL` present; each command's `errors[]` ⊆ registry | 7.2.1, 7.3 |
| L1.reserved-applicable | M | every command document, and the registry | each command lists the reserved codes of the features it offers (spec 10.13 rule 4): `INPUT_INVALID`, `INPUT_CONFLICT`, `INPUT_TOO_LARGE` with `input`; `BATCH_INCOMPLETE` with `input.batch`; `PLAN_STALE` with `--commit`; `OPERATION_REUSED` with `--operation`; `CURSOR_INVALID` with `--cursor`. With L1.registry this makes them registered. `UNVERIFIABLE` has no marker in a command document, so it is checked like any listed code (L1.registry, L1.codes-known), and its situation by the tool's own tests (§8) | 7.2.1 |
| L1.codes-known | M | every failure observed in any check | code ∈ the command's `errors[]` | 10.5 |
| L1.groups-not-runnable | M | `<group> --json` for every group | exit 2, `COMMAND_REQUIRED`, `expected` = the group's verbs | 9.2 |
| L1.grammar | M | every command document | kebab-case words; no option ending `-id`; reserved option shapes (10.13 rule 8) | 9.1, 9.5, 9.8 |
| L1.depth | S | tree | no path longer than two words | 9.1 |
| L1.one-meaning | M | all command documents | an option name has one `valueName` and one `valueType` across commands | 9.6 |
| L1.one-meaning-values | S | all command documents | for an `enum` option name, report the commands whose `possibleValues` sets are disjoint, as a hint of two meanings; disjoint subsets of one shared set are allowed by spec 9.6, so this is an advisory | 9.6 |
| L1.examples | M | every `examples[]` entry | starts with the tool name; parses against the command document by the 9.12 grammar (§7.1 tokenising); values in their domains; satisfies `required` and `constraints`; when `argumentsRef` is present, the argument object (spec 11.7 step 6) validates against it; no placeholder | 10.5, 10.10 |
| L1.example-runs | M | every example of a `read` command | run in the fixture: exit 0 or a registered code; never `USAGE` | 10.5 |
| L1.constraints | M | for each constraint of a `read` command, and for writes listed in the fixture: one generated invocation that satisfies `required` and every other constraint and violates only this one (built from a passing fixture invocation, changing the fewest arguments) | refused, exit 2, with the declared `code` (or `USAGE`); a generated invocation that would also break another rule is not used; when every violating invocation also breaks another declared rule, the result is `entailed`, naming those rules (§2) | 10.8 |
| L1.domains | M | for each argument with a `domain`, on a `read` command or a write listed in the fixture: a passing fixture invocation with that one argument changed to values generated from the profile (spec 10.7.4): each bound and the nearest value beyond it (`minimum - 1`, `maximum + 1`, the exclusive bounds themselves), a non-multiple for `multipleOf`, strings of `minLength - 1` and `maxLength + 1` characters, a value of a JSON type outside `type`; for `pattern` and the other structural keywords, the fixture's `domainRejects` values for that argument | the in-range values are accepted; each out-of-range value is refused with exit 2 and `USAGE` or the command's code for that argument, `field` naming the argument, nothing written. A `pattern` or structural keyword without `domainRejects` is `unprovided` | 10.7.4 |
| L1.patterns | M | every `pattern` in every command document's domains, with the `domainRejects` values and the fixture's accepted values for that argument | the pattern has the restricted I-Regexp form (spec 10.7.4); it compiles with ECMAScript `u` and with the Rust `regex` crate at its default limits (the checker ships a small Rust helper, built from the same code as this repository's `scripts/regex-parity`); both engines give the same answer for each value. A different answer passes only as a verified Unicode-version difference: the value is one code point, the pattern uses a category, and each engine's own tables give that code point a different general category; the report names both Unicode versions and the code point. Any other difference fails. A TypeScript tool cannot see Rust's size limit from its own build, so this is where an oversized pattern is caught | 10.7.4 |
| L1.numbers | M | for an `integer` argument, the passing invocation with `9007199254740992` and `-9007199254740992` (one beyond the safe range) on argv, and at L2 as a JSON number and as a string in a document | refused with exit 2 (`USAGE` or the argument's code on argv, `INPUT_INVALID` in a document); never accepted as `9007199254740991` or any other rounded value | 10.7.5 |
| L1.validators | M | every `rejects` invocation of every validator, run in the fixture state, for `read` commands and writes listed in the fixture | exit 2 with the validator's `code`, `field` naming one of its `arguments`, nothing written | 10.8.3 |
| L1.output-data | M | every `ok` fixture invocation and every example of a `read` command | `data` validates against the output schema `meta.output` names (or the only output); `meta.schemaVersion` equals that output's | 6.6, 6.11, 10.9 |
| L1.next | M | every `meta.next` observed | each `argv` has no placeholder, includes `--json`, and its first words name an existing command; `command` splits (POSIX shell rules) into the tool name followed by `argv`; for `read` commands the checker runs it in the same sequence and it does not exit with `USAGE` | 6.8 |
| L1.help-line | M | `--help` | first line mentions `schema` | 4.7 |
| L1.defaults | S | every option with a non-null `default` | the `--help` text, when it shows a default in a recognised form (`[default: X]`, `(default X)`), shows the same value | 10.7.3 |
| L1.deterministic | S | `schema --json` twice, and every command document twice | byte-identical | 10.2.4 |
| L1.paging | M (when offered) | the fixture's paged command with `--limit 1` | `meta.page.returned` ≤ 1; when `nextCursor` is present, some `meta.next` entry carries `--cursor <nextCursor>` (at any position), and running it in the same sequence returns the next item; the cursor given with a changed filter argument refuses with exit 2, `CURSOR_INVALID`, `field: "--cursor"` | 6.9, 7.2.1 |
| L1.fields | M (when offered) | the fixture's `fields` selections, including a nested path and an `[]` path when declared | `meta.fields` = selection plus `keep`; no unselected member at any depth (6.10 steps 1-3); selected members present whenever the unprojected answer has them (compared with the same invocation without `--fields`, in the same sequence); data validates against the output schema with `required` reduced along the kept paths; an unknown path refuses with `USAGE`, `field: "--fields"` | 6.10 |

### L2

| Id | | Invocation | Pass when | Rule |
|---|---|---|---|---|
| L2.input-present | M | command documents | every `write`/`destructive` command has `input` | 11.1 |
| L2.input-example | M | none | `input.example` validates against the fragment schema and satisfies `required`, the domains and `constraints`; when `argumentsRef` is present, its argument object (spec 11.7 step 6, numbers as numbers, defaults applied) validates against it | 10.10 |
| L2.input-refusals | M | for every command with `input`, in the fixture state: `{"bogusKey":1}`; `{"json":true}`; `{"commit":true}`; the example with one key `null`; `{"operands":[]}`; `[{}]` where `batch` is false; `./missing-xyz.json`; a value one byte over `maxBytes`; `{"bogusOne":1,"bogusTwo":2}` | exit 2; `INPUT_INVALID` (`INPUT_TOO_LARGE` for the size case); `field` a JSON pointer or `--input`; the two-key case has `details` with two entries; nothing written | 11.2-11.8, 11.10 |
| L2.input-tty | M | `--input -` with a pty on stdin | exit 2 `INPUT_INVALID`, `field: "--input"`, within the timeout | 11.3 |
| L2.input-fragment | M | each `ok` fixture invocation split into argv operands + a document holding the rest | same result as the argv form | 11.7 |
| L2.input-normalise | M | an `ok` invocation whose integer arguments are given as numeric strings in the document | same result | 11.5 |
| L2.input-conflict | M | an `ok` invocation plus a document giving one of its arguments another value; and one giving the same value | `INPUT_CONFLICT` with the document pointer; the same-value case succeeds | 11.7 |
| L2.input-pointer | M | a document violating one `constraints` rule or omitting a required key | the constraint's code (or `USAGE`), `field` a document pointer | 11.8 |
| L2.input-dash-values | M | a document whose string value starts with `-`, `{` and `[` | accepted as values (no option, file or inline-JSON misreading) | 11.9 |
| L2.batch-preflight | M | a batch whose last item fails a state-independent check (a type, a constraint) | exit 2, that item's code, `field` `/<index>/…`, no `data`, nothing written | 11.11 |
| L2.batch-incomplete | M | fixture `batchFailsAt` and `batchFailsFirst` | exit 1, `BATCH_INCOMPLETE`, `field` `/<index>`, `data.items` one per submitted item in order, statuses as in spec 11.11, the failed item's own `error`, `meta.output` the batch output | 11.11 |
| L2.batch-ok | M | a batch of the fixture's `ok` invocations | exit 0, batch report, every status `written` or `unchanged` | 11.11 |
| L2.idempotency | M | each `ok` write run twice in one sequence | `replay-safe`: second run `unchanged` or same result, no new effect; `once`: second run exit 2 and nothing changed; `content-keyed`: same | 12.3 |
| L2.destructive-safety | M | command documents | every destructive command has `commit` and `plan-digest`, `flagOnly`, and no batch | 12.4, 12.8 |
| L2.destructive-preview | M | every destructive command, fixture `preview` | exit 0; `planDigest`, `effects`, `committed: false`; `meta.next[0].argv` contains `--commit`, `--plan-digest <that digest>` and `--json`; nothing written | 12.2, 12.4, 12.5 |
| L2.destructive-preview-stdin | M | the preview with its arguments given via `--input -` | `meta.next[0].argv` does not contain `--input -` and replays to the same plan | 12.5 |
| L2.destructive-stale | M | the commit argv with a digest that differs in one character | exit 2 `PLAN_STALE`, nothing written, `meta.next[0]` the preview | 12.7 |
| L2.destructive-half | M | `--commit` alone; `--plan-digest x` alone | exit 2 `USAGE` | 12.7 |
| L2.destructive-commit | M | the preview's `next[0]` | exit 0, `committed: true`, the effects happened | 12.7 |
| L2.async | M (when offered) | the fixture's async start, then `next[0]`, with the worker set to `done`, `failed`, `timeout` | start exits 0 with `async: true` in the document and an identifier; `next[0]` waits; `done` → 0; `failed` → 1 with a registered code; `timeout` → 1, retryable, `next[0]` the same wait | 13.2, 13.3 |
| L2.operation-key | M (when offered) | the async start twice with the same `--operation`, then twice concurrently with a fresh key, then once with another payload | the repeats return the same identifier and start nothing (the worker sees one start per key, also under the concurrent pair); the other payload is `OPERATION_REUSED` | 13.4 |
| L2.stream | M (when offered) | each stream command with `--json`, every declared stream output (`when`) | start line first, naming its output when the command has several, and that output's `meta.output` again in the end result; events, end line last; every event's `data` validates against the output's `eventRef`; the end `result` passes every envelope check (L0.ok-exit, L1.output-data, `meta.output` naming the stream output); start and end agree on tool, command and version; exit equals the end result's; a usage error prints one plain failure envelope that is a refusal | 13.5 |
| L2.skills | M | `skills show --json`, then each listed guide, then `skills show nosuch-xyz --json` | data validates against `guide.schema.json`; works in an empty directory; nothing written; the unknown name exits 2 with `expected` | 14 |
| L2.guide-commands | M | every fenced line of every guide that starts with the tool name | parses as in L1.examples after substituting placeholders (§7.1) | 14.5 |
| L2.search | S (when offered) | the fixture's `search` queries | a `tree` with `query`; the expected command among the first five entries. Ranking quality is not part of the contract (spec 10.11), so this is an advisory; the shape of the answer is checked by L1.tree | 10.11 |
| L2.help-guide | M | `--help` | first line also names `skills show` | 4.8 |

## 7. Details

### 7.1 Tokenising documented command lines

Examples and guide lines are split into argv words with a POSIX-shell subset: whitespace separates words; `'…'`
and `"…"` quote (backslash escapes `"` and `\` inside double quotes); a trailing `\` joins the next line. A line
that contains an unquoted `|`, `>`, `<` not part of a `<PLACEHOLDER>`, `;`, `&`, `$(` or a backtick is outside
spec 14.5 and is skipped (reported as `unsupported`). In guides, `<UPPER_CASE>` placeholders are replaced by a
value valid for the argument they stand for (an enum's first value, `1` for an integer, `x` for a string) before
parsing; in `examples[]` and `next`, any placeholder is a failure.

### 7.2 Seeded-violation tests

A check that never fails proves nothing, so every check is tested against a seeded violation of its rule.
The checker's own test suite has a **fake tool**: a small script whose behaviour is a JSON configuration. The
conforming configuration passes every check at L2. For every check id there is one configuration that breaks
exactly that rule, and the test asserts that this check fails and every other MUST check still passes or is
`unsupported`. Examples:

| Seeded violation | Check that must fail |
|---|---|
| prints `hint: null` | L0.no-null |
| unknown option exits 1 | L0.ok-exit |
| JSON error also printed on stderr | L0.unknown-command |
| `CI=1` switches text mode to JSON | L0.no-env-switch-text |
| `schema` refuses without a config file | L1.no-state |
| a group runs | L1.groups-not-runnable |
| option `--change-id` | L1.grammar |
| an example violating a declared constraint | L1.examples |
| a constraint declared but not enforced | L1.constraints |
| report missing a required field | L1.output-data |
| `next` without `--json` | L1.next |
| a constraint implied by `required` (no isolated violation) | (none: L1.constraints is `entailed`, the level passes) |
| `--limit 0` accepted although the domain says `minimum: 1` | L1.domains |
| `9007199254740993` accepted as `9007199254740992` | L1.numbers |
| a validator's `rejects` invocation exits 0 | L1.validators |
| a published domain `^[a&&b]+$`, or `^\p{L}{1,500}$` | L1.patterns |
| the fake tool's Rust helper reports an ASCII value differently and labels it a Unicode-version difference | L1.patterns (the categories do not differ) |
| the same `atMostOne` rule listed twice | L1.walk |
| two equivalent constraints declaring different codes | L1.constraints |
| two equivalent constraints (`atMostOne [a, b]`, "`a` forbids `b`"), neither enforced | L1.constraints (the group's one witness is accepted) |
| a command with `--cursor` that does not list `CURSOR_INVALID` | L1.reserved-applicable |
| a cursor reused with another team refused with `USAGE` | L1.paging |
| `--fields` leaves an unselected field | L1.fields |
| `--input '{"commit":true}'` accepted | L2.input-refusals |
| document `{"round":"1"}` refused | L2.input-normalise |
| document value `-x` read as an option | L2.input-dash-values |
| first batch item failure returns the item's code and no data | L2.batch-incomplete |
| preview writes a file, with a non-empty `effectNote` | L2.destructive-preview |
| refusal appends a telemetry line | effects check (§4) |
| preview `next` contains `--input -` | L2.destructive-preview-stdin |
| stale digest accepted | L2.destructive-stale |
| second `--operation` repeat starts a second worker | L2.operation-key |
| stream without an end line | L2.stream |
| stream event that fails `eventRef`, or an end result with the wrong `retryable` | L2.stream |
| `--fields profile.name` leaves `profile.email` | L1.fields |
| complete `--input` document with no argv arguments refused as missing arguments | L2.input-fragment |
| a batch whose first item names a missing object refuses in preflight (exit 2, no data) | L2.batch-incomplete |
| next-page entry not first in `meta.next` | (none: L1.paging must still pass) |

Two limits of the repository's `scripts/check.ts`, which the binary checker does not share: it checks the
`schemaVersion` of a data-less failure against every output the command could have produced, because a fixture
does not record its invocation (the binary checker knows the argv and checks the exact output, spec 6.11); and it
skips payload checks for a report or stream whose command has no example command document, where the binary
checker always has the `schema` answer and treats a missing one as `fail`.

The JSON Schemas and `scripts/check.ts` get the same treatment in this repository: `examples/invalid/` holds
documents that must be rejected, each breaking one rule, and `examples/` holds positive witnesses of the
alternative forms a check must accept (a declared short option, an example completed by an inline `--input`, a
`false` event schema, a boolean `json` operand, a nested projection); `scripts/validate.sh` fails when either side
flips.

## 8. What the tool's own tests must cover

A green checker run does not prove these; a level claim includes them, and the tool's CI must show the evidence
(spec 17.2):

| Obligation | Why the checker cannot | Evidence |
|---|---|---|
| The tree is complete: every parser node is in `schema` | the checker sees only what `schema` lists | parser/self-description parity test (canon `tests/cli_spec.rs`, the crate's `table_matches_tree`, a TypeScript tool's leaf-list test) |
| No call site overrides an exit; every emitted code is registered | unreached paths are invisible | source scan or typed construction (canon `schema_codes.rs`, `defineError`) |
| Constraints of commands that write, beyond the fixture | the checker runs only listed writers | `constraints_hold` (approaches/rust.md §3.3) or the TypeScript equivalent |
| A preview's `effects` are complete and a commit does exactly them | the checker sees files, not remote state | tool tests against fake stores |
| Remote effects of reads and refusals | outside the snapshot | tests with fake backends asserting no calls |
| Secrets never appear in errors, `next` or reports | the checker has no secrets to look for | tests that inject a known secret and grep all outputs |
| Commit atomicity against concurrent changes | needs controlled interleaving | tool tests (spec 12.7) |
| Operation keys: atomic reservation, concurrent duplicates, a crash between the remote effect and recording it, retention expiry | needs fault injection and a controllable clock | tool tests against a fake backend that can lose a reply after applying the effect (spec 13.4) |
| Streams cut off mid-way leave no half-applied state the report hides | the checker can only kill the process, not inspect the backend | tool tests that kill the stream writer between events |
| Every example and guide line parses with the real parser | the checker approximates the parser from the document | `examples_parse` (approaches/rust.md §3.3) or the TypeScript equivalent |
| Domains and validators match the real parser and predicate beyond the published boundary values and witnesses; when several validators share a code, each is tested in isolation so that one cannot stand in for another | the checker sees one refusal per witness, not the predicate | boundary tests against the real parser (`constraints_hold`, approaches/rust.md §4.3) and a unit test per validator predicate |
