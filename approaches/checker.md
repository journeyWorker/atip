# The conformance checker

Not normative, in its implementation or in its results. Conformance is defined by the spec alone (spec 3.7): the
checker tests a built binary against the rules of the spec, and what it reports is evidence for or against a claim,
never the definition of one. Section numbers ("spec 10.7") refer to `spec/atip-1.md`, version 1.4.0.

## 1. What it is

One program, `atip check`, that runs a **built binary** and checks the contract from outside: argv in; stdout,
stderr, exit status and the file system out. It knows nothing about clap or Effect. Every tool's CI builds its
binary and runs the checker against it, so all tools are held to one implementation of the rules instead of five
test suites that agree by intention.

The reference checker is a Rust binary named `atip`. It is built first inside canon's repository and is to be
published on its own, so that no tool needs canon to run it.

```
atip check --bin <PATH> --level <L0|L1|L2> --fixture <FILE> [--contract <MAJOR.MINOR>] [--json]
atip check --bin target/release/canon --level L2 --fixture checker-fixture.json
```

- `--level` is the claimed level. For L1/L2 the checker also reads `data.level` from `schema --json` and fails
  when it is below the claimed level (levels are cumulative, so a tree at L2 meets an L1 claim; L1.tree, whose
  report then says that the higher level went unchecked).
- `--fixture` is the tool's fixture file (§5): the state and the invocations the stateful checks need.
- `--contract` is the claimed minor (spec 15.5): `1.0`, `1.1`, `1.2`, `1.3` or `1.4`. It defaults to the fixture's
  `contractVersion`, and to `1.0` when the fixture has none; given with a fixture member that says otherwise it
  refuses with `USAGE`. The checker checks that every document declares that minor and carries nothing a later minor
  added (L0.contract-version), and runs the checks that the minor makes MUST (the Strength column of §6 names the
  minor where it matters).
- Its own output follows the contract: text by default, `--json` for an envelope whose `data` lists every check.

The JSON Schemas in `schema/` are embedded in the binary, and so are the semantic rules of Annex S2. The
repository's `scripts/check.ts` validates this repository's own examples; it is not the binary checker (§7.2 lists
where the two differ).

## 2. Results and coverage

Every check has an id, the rule it enforces, and a **strength**: `MUST` (a failure fails the level in the checker's
verdict) or `SHOULD`
(an advisory; reported, never failing). Each run reports, per check, one of:

| Result | Meaning |
|---|---|
| `pass` | Exercised and held. |
| `fail` | Exercised and violated (for a SHOULD check: an advisory). |
| `unsupported` | The tool does not offer the feature (no batches, no `--fields`); the check does not apply. |
| `unprovided` | The check needs a fixture entry (the Needs column of §6, described in §5) that the tool did not provide, or an invocation the fixture lists to succeed was refused for want of state or environment (§5), and nothing the run already observed shows the rule broken. A check that can already see a failure without that entry reports `fail`, not `unprovided`. |
| `entailed` | The rule cannot be violated alone: every invocation that breaks it also breaks another declared rule (a `required` argument, a domain, another constraint). The report names those rules. |

A level is passed (the checker's verdict, which is evidence for a claim and not the claim, spec 3.7) when no MUST check
fails **and** no MUST check of that level is `unprovided`: a tool cannot
pass by withholding fixtures. `unsupported` is decided from the self-description (a command without `input.batch`
is `unsupported` for batch checks) or, at L0 where there is no self-description, from observing the binary itself
(a command shown not to page, §5), never from the fixture alone: a fixture can name what to run, not declare a
feature absent, and leaving a command out of it never makes a check `unsupported`. One more source, at every level
and for advisories only: an S check whose subject the run never met has nothing to judge and is `unsupported`
(L0.usage-hint when no field-less `USAGE` was observed); a MUST check is never `unsupported` this way. `entailed`
is decided from the self-description too, and it does not fail the level when every rule it names has the result
`pass` in the same run: a rule with its own isolated witness. A rule that is itself `entailed` does not count as
support, so a cycle of entailments with no passed rule in it is `unprovided`, never a pass. `entailed` is never
reported as `pass`, because nothing exercised the rule itself. A logically redundant constraint ("`--a` requires
`--b`" when `--b` is already required) is legal (spec 9.8), and no fixture could isolate it.

Before generating witnesses, the checker groups constraints that are **equivalent**: rules with the same set of
violating invocations, computed over the finite table of which named arguments are given and which `in` class
each value falls in (`atMostOne [a, b]` and "`a` forbids `b`" are equivalent). A group is one test obligation: one
generated invocation that violates the group and nothing else. It must be refused with a code one of the group's
rules declares, and the result is reported for every rule of the group. Rules of one group that declare different
codes make the expected refusal ambiguous, and the check fails. The same relation written twice is not a group:
it is invalid (spec 9.8.1, Annex S2 rule 4) and L1.walk reports it.

**One owner per pass condition.** Each pass condition belongs to exactly one check. Other checks that observe the same
run do not re-assert it: the unknown-option check asserts the refusal code and `field`, while `L0.ok-exit` owns "the
exit equals the code's registered exit", `L0.json-mode-preparse` owns "a JSON envelope despite the parse failure",
`L0.one-document` owns "exactly one document", `L0.refusal-effects` owns "a refusal changes nothing", and `L0.registry`
owns "every emitted code, reason and warning is registered". So a seeded violation of one rule fails exactly its owner
check (§7.2). Ownership decides where a finding is reported, never whether it is: when one run breaks several
independent rules, each owner check reports its own failure, and a finding that schema validation surfaces is attributed
to the check that owns the rule, not dropped. Three consequences for reading the tables: an `exit 2` in a row is
shorthand for "refused with a code whose registered exit is 2"; the row asserts the code and `L0.ok-exit` asserts the
number. A `USAGE` in a row's expected result stands for "`USAGE` or its registered finer replacement (spec 7.3.2)": a
registered exit-2 code the tool uses instead of `USAGE`, whose `field` names an argument. As L1.registry says, a tool
that registers `OPTION_INVALID` (for a claim below 1.3 any name, such as `UNKNOWN_OPTION`) and never emits `USAGE` for
that situation passes. And every envelope is validated against `schema/envelope.schema.json` once, by `L0.envelope`; a
finding that belongs to another rule (a `null`, a member added in a later minor than the claim) is reported by that
rule's check, not by the schema check.

## 3. How it runs a binary

- Every **sequence** gets a fresh copy of the fixture state as cwd, `HOME` pointing into that copy, an environment
  with only `PATH`, `HOME`, `LANG=C.UTF-8` and the fixture's declared variables, stdin closed (`/dev/null`) unless a
  check says otherwise, and the fixture's timeout (default 30 s; a check that exceeds it is `fail` with the reason,
  so a slow tool is not mistaken for a wrong one). A sequence is one invocation, or a run of invocations that
  depend on each other's state and so share one copy: a start and the `next` waits that follow it, a page and
  the next page it points to, the two runs of an idempotency check, a preview and its commit.
- A check that needs a terminal on stdin or stdout (L0.no-prompt, L2.input-tty, the pty variation of
  L0.no-env-switch) runs the binary under a pseudo-terminal. Output and input settings are separate: output is
  untranslated (`OPOST` off, so no `ONLCR`, and a `\n` the tool writes arrives as `\n`, not `\r\n`); input is
  in canonical mode (`ICANON` on) with echo off, so that the `VEOF` character written at the start of a line
  makes a reader's `read` return 0, which is end-of-file. In raw mode (`ICANON` off) the same character arrives as
  the byte `0x04` and is not end-of-file, so the checker never relies on it there. A tool that switches the
  terminal to raw mode itself receives that byte; prompt libraries commonly treat it as cancel. The checker reads the master
  until EOF, or until the child has exited and the master is drained, before it closes it: on some platforms
  output that has not been read is lost when the slave side closes.
- A run that ends by a signal shows as a wait status naming the signal, or, behind a launcher that exits on the
  tool's behalf, as exit 128+n (spec 8.4). The checker treats both the same: no envelope is expected and the exit
  is not looked up in the registry.
- Telemetry opt-outs are **not** set: a write the tool does on its own is what the effects check (§4) must see.
- Asynchronous checks use the fixture's controllable worker (§5), never wall-clock races.

## 4. The effects check

The checker snapshots the invocation's directory and `HOME` (path, size, SHA-256 of every file) before and after
the invocation, and asks the fixture's `probe` command for remote state when one is declared. Snapshots count files
only: a directory created to hold an allowed file is not an effect. An `allowedEffects` pattern is a path relative to
the invocation's directory (a leading `./` allowed) or, written `~/…`, to `HOME`; `*` matches within one path segment,
`**` across segments (`**/` also matches nothing), `?` one character other than `/`, and the whole path must match.

- For every **refusal** (exit 2; owned by `L0.refusal-effects`), every **destructive preview**, every `--dry-run`,
  `--help`, `--version`, `schema` and `skills show`: any change is a MUST `fail` (spec 8.2, 11.2). `effectNote` is
  not consulted. One check owns each: L1.no-state for `schema`, L2.skills for `skills show`, L2.effects for the rest.
- For a successful **`read`** command: a change is allowed only if it matches the fixture's `allowedEffects` glob
  list for that command, and the command has an `effectNote`. Any other change is a MUST `fail`; the report names
  the changed paths.

The checker runs the refusal and preview cases of this check with commands whose `effectNote` is non-empty too,
so a note can never hide a write.

Strength by level, so that no level acquires a higher level's checks (spec 3.3) and none loses a rule it already
has: a refusal (exit 2) that changes anything is a MUST failure of `L0.refusal-effects` from L0, because spec
8.1-8.2 (L0) already say a refusal changes nothing; `schema` writing anything is a MUST failure of L1.no-state
from L1 (spec 9.2); previews are owned by L2.destructive-preview, and `--dry-run`, `--help`, `--version` and
the `read`-command allowlist by L2.effects (spec 11.2): MUST failures at L2, advisories at L0 and L1. Stream,
guide, input and preview checks run only for tools that offer the feature, as `unsupported` otherwise (§2).

**Staging.** The checker cannot see where a command's work started (spec 8.3.1). A `write` or `destructive`
command whose precondition failure the tool reports as exit 1 (its during-the-work code) is not a failure of
`L0.ok-exit`: the code is registered with exit 1 and the exit matches it. The reverse is always a failure: an
exit 2 with a change in the snapshot fails `L0.refusal-effects`, whatever the code.

## 5. Fixtures

A tool supplies a fixture file:

```json
{
  "contractVersion": "1.3",
  "prepare": [["git", "init", "--quiet"], ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "--quiet", "--message", "fixture"]],
  "setup": [["init", "--json"], ["finding", "add", "--change", "add-login", "--round", "1", "--seq", "1", "--severity", "note", "--actor", "r1", "--summary", "s", "--json"]],
  "env": { "CANON_ACTOR": "fixture" },
  "timeoutSeconds": 30,
  "probe": "status",
  "notRun": ["dashboard"],
  "globalOptions": [["--repo", "."]],
  "registry": [
    { "code": "USAGE", "exit": 2, "retryable": false },
    { "code": "INPUT_INVALID", "exit": 2, "retryable": false, "reasons": ["NOT_JSON", "UNKNOWN_KEY"] },
    { "code": "FINDING_NOT_FOUND", "exit": 2, "retryable": false },
    { "code": "STORE_FAILED", "exit": 1, "retryable": true }
  ],
  "warnings": ["LEGACY_ALIAS"],
  "commands": {
    "finding close": {
      "ok": [["finding", "close", "add-login", "--round", "1", "--seq", "1", "--disposition", "fixed", "--json"]],
      "refused": [["finding", "close", "add-login", "--round", "1", "--seq", "9", "--disposition", "fixed", "--json"]],
      "missingValue": [["finding", "close", "add-login", "--round", "1", "--disposition", "fixed", "--json"]],
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
      "paged": [["finding", "list", "--change", "add-login", "--limit", "1", "--json"]],
      "allowedEffects": [".canon/audit/access.jsonl"]
    },
    "purge": { "preview": [["purge", "--kind", "session", "--before", "2030-01-01", "--json"]] },
    "deploy start": { "async": { "start": ["deploy", "start", "staging", "--json"], "worker": "fixture-worker", "outcomes": ["done", "failed", "timeout"] } }
  },
  "search": [{ "query": "close a review finding", "expect": "finding close" }]
}
```

`prepare` lists programs that make the world the tool works in, for a tool whose records need it (above, a git
repository with one commit, which `finding add` requires). Each entry is an argv array whose first word is any
program on `PATH`; the entries run once, in order, in the template directory, before `setup`, without a shell, with
the environment, stdin and timeout of §3 (`HOME` in the template, the fixture's `env` included). A step that exits
non-zero, cannot be started or exceeds the timeout is an error of the fixture, not a failure of the tool: the
checker stops with its own error naming the step, and reports no check, so no level is passed by that run.
`prepare` is for what the tool reads but does not own; the state the tool keeps is still built by `setup`, through
the tool's own argv, so the checks run against state the tool produced itself. A step whose program resolves to the
binary under test (`--bin`) is therefore a fixture error too, and the checker's report lists every `prepare` step
with its argv, so that whoever reviews a level claim sees what was made outside the tool.

`setup` runs once into the template directory, after `prepare`; every sequence (§3) runs in its own copy. A
`setup` step that exits non-zero, cannot be started or exceeds the timeout is a fixture error in the same way: the
checker stops, reports the step and its answer, and reports no check. The
effects check (§4) starts from that copy, so nothing `prepare` or `setup` made counts as an effect of a checked
invocation. The checker never runs a `write` or `destructive` command that the fixture does not list. A command with
no fixture entry makes its stateful checks `unprovided`, never `unsupported`: an unlisted write does not decide
whether the tool offers a feature.

`notRun` lists commands, by path, that do not end on their own: a command that serves until it is signalled, whose
`effectNote` says so (spec 9.5). Every listed command must be in `schema` with a non-empty `effectNote`, and none may be
the `probe`, or the fixture is in error, as for a failing `prepare` step; at L0, where there is no `schema`, the list is
taken as given. The checker runs each listed command **once**: its first fixture `ok` invocation, else its first
example, with `--json`. It reads stdout up to the end of the first JSON document, checks that the process is still
running, then signals it (SIGTERM, then SIGKILL after a grace period). That document goes to the checks of every
envelope (L0.envelope, L0.no-null, L0.contract-version, L0.next) and to L1.output-data; the checks that read the exit
status or the whole of stdout (L0.ok-exit, L0.one-document) do not apply to it, since the run ended by the checker's
signal (spec 8.4). A listed command that exits on its own within the timeout, before or after its first document, is a
fixture error: it ends, so it belongs in no `notRun`. So is one refused at its start, except with a registered
precondition code (not one of the stateless steps 1-6 of spec 10.7): that refusal makes the run `unprovided`, and the
report names the code, as for any refused fixture invocation below. One that prints no document before the timeout fails
L0.envelope. Without an `ok` entry or an example (at L0, without an `ok` entry) the one run is `unprovided`. Beyond that
run, the runs that the checker expects to be refused still run, since a refusal ends: the generated refusals of
L1.constraints, L1.numbers, L1.validators and L1.check-order, and the out-of-range values of L1.domains. Skipped are the
other runs that would succeed and so never end: the command's other examples (L1.example-runs, L1.output-data), a
`meta.next` entry that names it (L1.next), the in-range values of L1.domains, its successful run in L2.effects, and its
other fixture entries (further `ok` invocations, `paged`, `fields`, `preview`). Each check computes its result from its
other runs and reports the runs it skipped with the reason `notRun`; a check whose every run was skipped this way is
`unprovided`, so listing commands cannot pass a level. The report lists the `notRun` commands, as it lists the `prepare`
steps.

`paged` lists invocations of a command that return `meta.page.nextCursor` in the fixture state; L0.page and
L1.paging run them. Which commands page is not taken from the fixture. From L1, a command pages when its command
document declares `--cursor`. At L0, where there is no `schema`, the checker observes the commands the fixture
lists: one of a command's `ok` invocations with `--cursor x` added. A refusal with the same code the tool gave
L0.unknown-option and `field: "--cursor"` shows the option does not exist, so the command does not page. A refusal
with `CURSOR_INVALID` shows a refused cursor value, so the command pages. (A paging command refuses a cursor it did
not issue with `CURSOR_INVALID`, spec 6.9, so a paging command that answers like an unknown option already breaks
6.9; from L1 its document shows it pages.) Any other answer (exit 0, or a refusal with another code or another
`field`) shows neither, and the checker takes the cautious reading: the command pages. L0.page and L1.paging are
`unsupported` only when no command pages: from L1 when no command document declares `--cursor`, at L0 when every
listed command is shown not to page. A paging command, by its document or by observation, with no `paged` entry and
no observed `nextCursor` makes them `unprovided`. At L0 a command the fixture does not list is not seen at all;
that limit is in §8.

`contractVersion` is the minor the tool claims (spec 15.5); it is what `--contract` overrides, and absent means
`"1.0"`. `registry` lists the codes the tool registers, with `exit`, `retryable` and the names of the reasons under
each code; `warnings` lists the warning codes. The prose of `meaning` and `fix` is not part of the fixture. It is
the checker's independent copy of the registry: comparing the tool's `schema --errors` with it is the checker's own
practice, not a rule of the spec (spec 3.7), and a code or reason the tool adds or loses without the fixture noticing
fails. `"registry": "from-schema"` instead
takes both the registry and the warning codes from the tool's own `schema --errors --json` and `schema --warnings
--json` (a fixture with `from-schema` has no `warnings` member): a fixture generated from the tool only proves the
generator ran, so with `from-schema` nothing is compared with the fixture, and L0.registry checks only that every
emitted code, reason and warning is in what the tool prints; an explicit list still pins the registry.
A tool that offers no `schema --errors` (allowed at L0) has nothing to take a registry from, so with `from-schema`
L0.ok-exit, the one check that then needs `registry`, is `unprovided` (L0.registry does not run without
`schema --errors`). `globalOptions` lists tool-wide options with a value (Annex S1 item 9); `missingValue` is an
invocation of a command with one required value left out (L0.no-prompt); both are needed at L0, where there is no
`schema` to read them from.

**The Needs column.** Each check in §6 names the fixture entry it needs. `probe` is the stateless command (and the
remote-state query of §4); `registry` is the fixture's `registry` and `warnings`; `commands` is the per-command
entries (`ok`, `missingValue`, `fields`, …); `—` needs nothing beyond the tool itself. A check whose needed entry
is missing is `unprovided`, and an unprovided MUST check fails its level (§2). Exception: when the check can
already observe a failure without the entry, it reports `fail`, never `unprovided`. For example `L0.registry`
checks every emitted code against the registry the tool prints even with no fixture `registry`, and fails on an
unregistered one; only the comparison with the fixture is then `unprovided`.

**A refused fixture invocation.** An invocation the fixture lists to succeed (`ok`, `paged`, `fields`, `preview`, an
async start) that the tool refuses with a registered exit-2 *precondition* code makes every check that runs it
`unprovided`, and the report names the code: the fixture's state or environment did not give the command what it
needs (credentials, a reachable backend), which shows no rule broken. This applies to every check, not only paging.
`unprovided` still fails a MUST check's level (§2), so withholding the environment passes nothing; the fixture
provides it in CI with a fake backend selected through `env`, as for the controllable worker below. A refusal from a
step that reads no state (spec 10.7 steps 1-6) is not this, and the check reports `fail`: `USAGE` and its registered
finer replacement, `UNKNOWN_COMMAND`, an `INPUT_*` code, a code the command document declares on a constraint or a
validator (an `env`-dependent validator included: the fixture's `env` decides it), and a code the run observed as an
argument's domain refusal (L1.domains: `USAGE` or the command's own code for that argument), since a domain declares
no code of its own. The fixture invocation is wrong, or the tool enforces a rule it does not declare. A refusal that
is the check's own subject (the `CURSOR_INVALID` L1.paging provokes, the `USAGE` for an unknown `--fields` path) is
judged by that check. At L0 there is no command document, so only the reserved codes of that list are known to be
stateless: any other exit-2 code is taken as a precondition, also when no registry says it is registered (the tool
offers no `schema --errors` and the fixture has none); the level cannot pass then anyway, since L0.ok-exit is
`unprovided`.

`domainRejects` lists, per argument, values the fixture author knows lie outside a `pattern` or a structural
domain. The checker substitutes each into the command's first `ok` invocation (spec 9.7.4, Annex V1). It cannot generate
such values itself: a string outside an arbitrary regular expression needs a solver.

For asynchronous commands the fixture names a **controllable worker**: a stub the tool's test build accepts that
completes, fails or hangs on command. `worker` is the name of the environment variable the test build reads; the
checker sets it to the outcome word (`done`, `failed`, `timeout`) for the start and for the wait, instead of waiting
on real work. `outcomes` lists the outcomes the stub supports; one it leaves out is not driven, and L2.async is then
`unprovided`. A wait driven to `timeout` without a `--timeout` of its own is given `--timeout 1s` when the command
accepts it.

## 6. Checks by level

Strength column: M = MUST, S = SHOULD. Needs column: the fixture entry the check needs (§5). Every envelope the
checker observes is validated against `schema/envelope.schema.json` (L0.envelope), and every observed failure's
code is looked up in the registry the tool prints (`schema --errors`), or in the fixture's `registry` when the tool
prints none. Each finding is reported by the check that owns its rule (§2). For a 1.4 claim, every row that reads a
command's `options` reads its **full option set** (spec 9.5: the implied reserved options, the options it names, each a
tree option or else a reserved option of fixed shape, and its own), an absent member has its default (spec 15.4), and a
row that uses the input fragment schema uses the one derived from the full option set (spec 9.9.2), which is also the
`Input` member of the command's `--schemas` answer (L1.schemas checks that the two agree, so a row may read either).
Only `--json`, `--input` (with `input`) and `--fields` (with an output's `fields`) are implied; `--commit` and
`--plan-digest` are listed whenever offered. A row marked "1.4" below is not run for an earlier claim.

### L0

| Id | | Invocation | Pass when | Rule | Needs |
|---|---|---|---|---|---|
| L0.version | M | `--version` | exit 0, stdout non-empty, stderr empty | 4.4.1 | — |
| L0.version-format | S | `--version` | one line `<tool> <version>`, where `<tool>` is `meta.tool` of an envelope seen in the run (the executable's file name only when no envelope was seen) | 4.4.1 | — |
| L0.unknown-command | M | `nosuch-xyz --json` | `ok: false`; `UNKNOWN_COMMAND`; `expected` non-empty; no `meta.command`; `meta.schemaVersion` `1.0` | 4.3.4, 6.4, 6.6, 6.11, 7.3 | — |
| L0.unknown-command-text | M | `nosuch-xyz` | stdout empty; stderr non-empty. Only a refusal must leave stdout empty; a command that ran and exits 1 may print its result (spec 5.3) | 5.3 | — |
| L0.text-error-form | S | `nosuch-xyz` | stderr starts `<tool>: UNKNOWN_COMMAND: ` | implementation.md §6 | — |
| L0.bare | M | `--json` | `COMMAND_REQUIRED` | 7.3, 4.1.2 | — |
| L0.unknown-option | M | `<probe> --bogus-xyz --json` | a registered code whose exit is 2 (`USAGE` or the tool's finer one, spec 7.3.2); `field: "--bogus-xyz"`; `meta.command` = the probe's id | 4.3.4, 6.6, Annex S1 item 6 | `probe` |
| L0.json-mode-preparse | M | `<probe> --json --bogus-xyz` and `<probe> --bogus-xyz --json` | both print an envelope with `ok: false` (not text), although the parse failed | 4.3.4 | `probe` |
| L0.after-dashdash | M | `<probe> -- --json` | stdout is not an envelope | 4.3.4 | `probe` |
| L0.ok-exit | M | every invocation | exit ∈ {0, 1, 2} or a signal (a wait status naming it, or 128+n from a launcher, spec 8.4; no envelope expected); `ok` exactly when exit 0; exit equals the code's registered exit; `retryable` equals the registered value; no `data` on exit 2 | 6.2, 6.4, 7.4.2, 7.4.2, 8.1, 8.3.1, 8.4 | `registry` |
| L0.no-null | M | every envelope | no `null` anywhere in `meta` or `error` | 6.5 | — |
| L0.envelope | M | every envelope | validates against `envelope.schema.json`; findings of L0.no-null and L0.contract-version are theirs | 6.1-6.6 | — |
| L0.compact | S; M for a 1.4 claim | every JSON document the tool prints: each envelope, `schema` answer and stream line | no space, tab, CR or LF outside strings, found by tokenising the text (never by comparing it with a re-serialisation, which would also rewrite number spellings and escapes such as `60.0` or `\u00e9`), then one newline. Below 1.4 an advisory: no indentation | 5.1 | — |
| L0.one-document | M | every JSON-mode stdout except a stream command's lines (spec 13) | UTF-8; the whole stdout parses as exactly one JSON document followed by one newline (indentation is allowed below 1.4; compactness is L0.compact's) | 5.1 | `probe` |
| L0.no-env-switch | M | `<probe> --json` with `CI=1`, `CLAUDECODE=1`, `OUTPUT_FORMAT=text`, `NO_COLOR=1`, `TERM=dumb`, and with stdout on a pty | each prints an envelope with the same `ok`, `error.code` (if any), `meta.command`, `meta.schemaVersion` and the same top-level key set of `data`; a run that prints no envelope where the plain run did fails | 4.3.3 | `probe` |
| L0.no-env-switch-text | M | `<probe>` (text mode) under the same variations | the output kind is the same under every variation: when the plain run's stdout is not an envelope, no variation's is; colour codes may differ. `schema` is not used as the probe, since its text mode may be the JSON document (spec 9.1.1) | 4.3.3 | `probe` |
| L0.contract | S, for a `1.0` claim only | every envelope | `meta.contract` present on every envelope, not only on `schema` answers (for a `1.1` claim, L0.contract-version owns presence) | 6.6 | — |
| L0.contract-version | M | every JSON document the tool prints: every envelope, `schema` answers included, and every stream line (a tool prints no other JSON document, spec 5.1, 13) | for a claim of `1.1` or later, every envelope and every stream start line carries both `contract` and `contractVersion`, and `contractVersion` equals the claim (an otherwise ordinary answer without the markers fails); for a `1.0` claim, `contractVersion` is absent everywhere; a `1.0` claim carries no member, document kind or path syntax annotated `x-atip-since` in `schema/` (`error.reason`, registry `reasons`, `warnings`/`warning` kinds, bracketed field paths); a `schema` answer's `meta.schemaVersion` equals the claim | 6.6, 9.1.2, Annex S2 rule 16, 15.5, 15.6 | — |
| L0.stderr-result | M | every JSON-mode run | stderr carries neither the error object nor the result: no stderr line parses as an envelope or equals the stdout document | 5.2 | — |
| L0.stderr-quiet | S | every JSON-mode run | stderr is empty (progress and heartbeat lines of a long-running command are allowed, spec 5.2) | 5.2 | — |
| L0.next | M | every `meta.next` entry observed | `argv` non-empty; no placeholder; `--json` in `argv` when the run that produced it was in JSON mode and the target accepts it (a target that `schema` shows without `json` is exempt); `command` splits (POSIX, no expansion) into the tool name followed by `argv` | 6.8 | — |
| L0.page | M | the fixture's `paged` invocations, and every other answer observed with `meta.page.nextCursor` | the answer carries `meta.page.nextCursor`, and some `meta.next` entry carries `--cursor <that cursor>` (at any position). Which commands page, and when the result is `unsupported` or `unprovided`, is decided as §5 says | 6.9 | `commands` |
| L0.refusal-effects | M | every refusal (exit 2) of every run | the directory and `HOME` snapshots (§4) are unchanged, and so is the remote state the `probe` reports, if any | 8.2, 11.2 | — |
| L0.no-prompt | M | the fixture's `missingValue` invocation with `--json`, run twice: a control run with stdin at end-of-file (`/dev/null`), then a run with stdin and stdout on a pty in canonical input mode (§3), the fixture's timeout | pass: the pty run exits, refusing, as the control run does. fail: the control run refuses, but the pty run is still running at a deadline (twice the control run's time plus two seconds, at most the timeout) and, when the checker then writes `VEOF` at the start of a line, exits or prints within two seconds: it was waiting on the terminal for input that end-of-file then ended. Also fail: output on the pty that asks for a value. Still running at the timeout with no output and no reaction to end-of-file: `unprovided` (slow, not shown to be waiting for input), with both elapsed times in the report. The checker's own tests (§7.2) run a canonical-mode reader, a raw-mode reader and a slow non-reader. Scope: the check covers a prompt read from stdin when stdin is a terminal. The pty is not made the process's controlling terminal, so a tool that opens `/dev/tty` directly is outside what it detects; that stays an obligation of the tool's own tests (§8) | 5.4 | `commands` |
| L0.registry | M (when `schema --errors` is offered, at any level) | `schema --errors --json`; `schema --error <CODE> --json` for each; `schema --warnings --json` and `schema --warning <CODE> --json` when offered; `schema --error <a warning-only code> --json`; every code, reason and warning code any run emitted | entries validate against `registry-entry.schema.json` and `warning-entry.schema.json`; the tool's registry equals the fixture's (codes, `exit`, `retryable`, and `reasons` when the fixture lists them) and its warning registry the fixture's `warnings` (neither compared when the fixture says `"registry": "from-schema"`, §5); every error code, every `reason` (under its own code) and every `meta.warnings` code emitted during the run is registered (a warning code in the warning or the error registry; for a 1.3 claim in the warning registry, spec 7.5.2); `--error` given a warning-only code refuses as an unknown code does (spec 7.4.3): exit 2, `USAGE`, `field: "--error"`, `hint` `<tool> schema --warning <CODE> --json` | 7.4.3, 7.5, 7.6 | `registry` |
| L0.usage-hint | S | every `USAGE` error observed | one without `field` carries the `hint` `<tool> schema <command> --json` for the command that was run (`<command> --help` when the tool has no `schema`), or `<tool> schema --json` (`<tool> --help`) when no command was resolved (`meta.command` absent). When no field-less `USAGE` was observed the rule has no subject and the result is `unsupported` (not applicable); no fixture entry triggers one | 7.1.3 | — |
| L0.hint-form | M for a tool that declares 1.1 or later, not run for one that declares 1.0 | every `hint` observed | a hint that starts with the tool name and a space splits like `next[].command` and holds nothing but that command line. Whether it names a real command needs the `schema` document and is L1.hint-command's. A 1.0 tool's prose hint may start with its name, so the check does not apply to it | 7.1.2 | — |
| L0.global-on-group | S | for each fixture `globalOptions` entry and one group: `<tool> <group> --json`, then `<tool> <group> <global-option> --json` | both refuse with `COMMAND_REQUIRED`, never `USAGE` for the option. No group known from the fixture's commands: `unprovided`; `unsupported` only when `schema` shows the tool has no groups | Annex S1 item 9 | `commands` |

`<probe>` is the fixture's `probe` command: any command that runs without state. L0.registry is the only check
that compares the tool's registry with the fixture; L1.registry, L1.reasons and L1.warnings check what the
registry says and need no fixture.

### L1

| Id | | Invocation | Pass when | Rule | Needs |
|---|---|---|---|---|---|
| L1.tree | M | `schema --json` | validates against `schema-doc.schema.json`; Annex S2 rule 1; every group before its commands; ids unique; `level` at or above the claimed level (levels are cumulative; when it is above, the report says that the higher claim went unchecked). For a 1.4 claim: an entry has no `path`, a command's entry no `kind` (absent means `command`), and neither an entry nor an `options` definition has a member at its default (Annex S2 rule 17) | 3.5, 9.3, Annex S2 | — |
| L1.no-state | M | `schema --json` in an empty directory, minimal environment | succeeds, and nothing is written (§4) | 9.2 | — |
| L1.walk | M | `schema <path> --json` for every tree entry | validates; Annex S2 rules 1-11 and 13 (rule 12, the examples, is L1.examples; rule 3 includes refusing a constraint's `in` on a switch or a count); group → its tree children exactly. For a 1.4 claim: no `path`, `schemas`, `input.option`/`schemaRef` or `validators[].rejects`; defaults applied before the rules are read, no member at its default, every name in `options` a tree option or a reserved option the document does not imply (spec 4.5), every tree option named by some command, no option given by name and object (Annex S2 rule 17); rule 4 over the full option set; rule 2's refs, `Input` and `rejects` are checked by L1.schemas | 9.4, 9.5, Annex S2 | — |
| L1.quoted-path | M | `schema "<a b>" --json` for one two-word command | equals the split form | 9.1.1 | — |
| L1.schema-errors | M | `schema nosuch-xyz --json`; `schema --errors --error USAGE --json`; `schema <a group> --errors --json`; `schema --error NOSUCH_XYZ --json`; for a 1.4 claim also `schema <a command> --schemas --errors --json` | exit 2 with `UNKNOWN_COMMAND`, `USAGE`, `USAGE`, and `USAGE` with `field: "--error"`; for a 1.4 claim `USAGE` for the fifth | 7.4.3, 9.1.1 | — |
| L1.schemas | M, 1.4 | `schema <path> --schemas --json` for every command; `schema --schemas --json`; `schema <a group> --schemas --json` | each command answers `data.kind` `schemas` (validates against `schema-doc.schema.json`), `command` its own, `schemas` exactly the members that its document's `schemaRef`, `eventRef` and `argumentsRef` name and that those reach through `#/schemas/<Name>`, plus `Input` when the command has `input`, no other, every ref resolving (Annex S2 rule 2) and every member compiling under draft 2020-12; `Input` equals, as JSON, the fragment schema the checker derives from the full option set (spec 9.9.2, Annex S2 rule 10), is absent for a command without `input`, and is no ref's target name; `rejects` is present exactly when the command has validators, an array with one list of strings per validator, in the document's `validators` order (Annex S2 rules 2, 13); the two others refuse `USAGE`, `field: "--schemas"` | 9.1.1, 9.8.2, 9.9.3, Annex S2 rules 2, 10, 13 | — |
| L1.help-json | M, 1.4 | `--help --json` and `<command> --help --json` for one command; `<tool> nosuch-xyz --help --json`; `--version --json` | the first two: exit 2, `USAGE` (or its registered finer replacement), `field: "--help"`, `hint` `<tool> schema <command> --json` (`<tool> schema --json` at the root), and no `schema` document is printed; the third: `UNKNOWN_COMMAND` (the path is resolved first); the fourth: exit 2, `USAGE` (or its registered finer replacement), `field: "--version"`, `hint` `<tool> --version`, and no version is printed outside `meta.toolVersion` | 4.4.1 | — |
| L1.registry | M | `schema --errors --json`, then `schema --error <CODE> --json` for each | codes unique; core codes that the tool registers have their exit and retryability (`STOPPED_MIDWAY` is a core code only for a 1.2 claim: exit 1, not retryable; for a 1.1 or 1.0 claim it is a code of the tool's own, and for a 1.3 claim it is not allowed, L1.code-names); `USAGE` (or its finer replacements), `UNKNOWN_COMMAND`, `COMMAND_REQUIRED`, `INTERNAL` present; each command's `errors[]` (for a 1.4 claim with its implied codes, spec 9.5) ⊆ registry (entry shapes are L0.registry's) | 7.3.1, 7.4, 8.3.2 | — |
| L1.code-names | M for a claim of 1.3 or later, not run below 1.3 | the same registry | every code is a core code (spec 7.3.1) or follows the grammar of spec 7.2.1 (`<SUBJECT>_<CONDITION>`, the condition one of the fifteen of 7.2.2) and has its condition's exit and retryability: exit 2 for every condition but `FAILED`, `INCOMPLETE` and `TIMEOUT`, which are exit 1; retryable for `UNAVAILABLE` and `TIMEOUT`, not for any other, except that a `FAILED`, `INCOMPLETE` or `TIMEOUT` code may be either; no code of the tool's own takes a core code's name. `STOPPED_MIDWAY` fails, since it ends in no condition. Whether a subject is a noun and not a verb is a judgement for the tool's review (implementation.md §7), not a mechanical test, and the checker does not decide it | 7.2, Annex S2 rule 14 | — |
| L1.reasons | M (when any entry lists `reasons`) | the same registry | within a code every `reason` is UPPER_SNAKE and unique (the same name under another code is another reason); a reason entry has no `exit` or `retryable`, because a reason shares its code's (spec 7.6); `schema --error <CODE>` lists the same reasons as `--errors`. That an emitted reason is registered under its code is L0.registry's | 7.6, 7.6 | — |
| L1.reasons-reserved | S | the same registry | a reason under a reserved code for a situation of the table in spec 7.3.3 uses the reserved name | 7.3.3 | — |
| L1.warnings | M (when `schema --warnings` is offered; for a 1.3 claim at L1 and above, always) | `schema --warnings --json`, then `schema --warning <CODE> --json` for each; `schema --warning NOSUCH_XYZ --json` | `data.kind` `warnings` and `warning`; codes unique; the entry of `--warning` equals the one in `--warnings`; an unknown code refuses `USAGE`, `field: "--warning"`; a code also in the error registry has the same `meaning` there (spec 7.5.2). For a 1.3 claim every warning code any run emitted is in the warning registry: one that only the error registry has fails, and so does a tool that emits a warning without offering `schema --warnings` (spec 7.5.2); whether a code of the error registry is also reported as an error is not mechanical, so the checker only compares the entries of codes that both registries list. A claim below 1.3 without `schema --warnings` registers its warning codes in the error registry, dual-use codes included, and this check does not run | 7.5.2, 7.5.2, 9.1 | — |
| L1.reserved-applicable | M | every command document, and the registry | each command lists the reserved codes of the features it offers (Annex S2 rule 4): `INPUT_INVALID`, `INPUT_CONFLICT`, `INPUT_TOO_LARGE` with `input`; `BATCH_INCOMPLETE` with `input.batch`; `PLAN_STALE` with `--commit`; `OPERATION_REUSED` with `--operation`; `CURSOR_INVALID` with `--cursor`. With L1.registry this makes them registered. `UNVERIFIABLE` has no marker in a command document, so it is checked like any listed code (L1.registry, L1.codes-known), and its situation by the tool's own tests (§8). For a 1.4 claim these codes, `USAGE`, the registered exit-2 codes the tool uses instead of `USAGE` (spec 7.3.2) and `INTERNAL` are implied and count as listed (spec 9.5), the features are read from the full option set (so `--commit` and `--plan-digest`, which are never implied, count only when the command lists them, as an object or as a reserved name), and a command that lists an implied code or an implied option (`--json`, `--input` with `input`, `--fields` with `fields`) fails | 7.3.1, 7.3.2, 9.5 | — |
| L1.codes-known | M | every failure observed in any check | code ∈ the command's `errors[]` (for a 1.4 claim, or an implied code, spec 9.5: `USAGE`, its registered finer replacements, `INTERNAL`, the feature codes) | 9.5 | — |
| L1.groups-not-runnable | M | `<group> --json` for every group | exit 2, `COMMAND_REQUIRED`, `expected` = the group's verbs | 4.1.2 | — |
| L1.grammar | M | every command document | kebab-case words; no option ending `-id`; reserved option shapes (Annex S2 rule 8; for a claim of 1.2 or later `limit`, `cursor`, `all` and `fields` are flag-only too, spec 10.6; for a claim of 1.4 the implied reserved options have these shapes by definition, and only listed or named ones, objects or names, are read) | 4.1.1, Annex S1 item 3, 4.5, 10.6 | — |
| L1.depth | S | tree | no path longer than two words | 4.1.1 | — |
| L1.one-meaning | M | all command documents | an option name has one `valueName` and one `valueType` across commands (for a claim of 1.4 over the full option set, a named tree option having the tree's definition) | Annex S1 item 4 | — |
| L1.one-meaning-values | S | all command documents | for an `enum` option name, report the commands whose `possibleValues` sets are disjoint, as a hint of two meanings; disjoint subsets of one shared set are allowed by Annex S1 item 4, so this is an advisory | Annex S1 item 4 | — |
| L1.examples | M | every `examples[]` entry | starts with the tool name; parses against the command document by the 4.2 grammar (§7.1 tokenising; for a claim of 1.4 against its full option set); values in their domains; satisfies `required` and `constraints`; when `argumentsRef` is present, the argument object (spec 10.7 step 6) validates against it; no placeholder. Guide lines are parsed the same way by L2.guide-commands | 4.2.1, 9.5, 9.9.2 | — |
| L1.example-runs | M | every example of a `read` command | run in the fixture: exit 0 or a registered code; never `USAGE` | 9.5 | `commands` |
| L1.constraints | M (the recommended choice of `field`: S for a 1.3 claim) | for each constraint of a `read` command, and for writes listed in the fixture: one generated invocation that satisfies `required` and every other constraint and violates only this one (built from a passing fixture invocation, changing the fewest arguments) | refused, exit 2, with the declared `code` (or `USAGE`); `field` names an argument of the rule that the caller can add or remove to satisfy it (a name of the rule that is missing when absence breaks it, given when presence breaks it, spec 9.8.1); for a 1.2 claim it is the argument of the per-rule table of implementation.md §2 (M), for a 1.3 claim another qualifying argument is only an advisory; a generated invocation that would also break another rule is not used; when every violating invocation also breaks another declared rule, the result is `entailed`, naming those rules (§2) | 9.8, 9.8.1, implementation.md §2 | `commands` |
| L1.domains | M | for each argument with a `domain`, on a `read` command or a write listed in the fixture: a passing fixture invocation with that one argument changed to values generated from the profile (Annex V1): each bound and the nearest value beyond it (`minimum - 1`, `maximum + 1`, the exclusive bounds themselves), a non-multiple for `multipleOf`, strings of `minLength - 1` and `maxLength + 1` characters, a value of a JSON type outside `type`; for `pattern` and the other structural keywords, the fixture's `domainRejects` values for that argument | the in-range values are accepted; each out-of-range value is refused with exit 2 and `USAGE` or the command's code for that argument, `field` naming the argument. A `pattern` or structural keyword without `domainRejects` is `unprovided` | 9.7.4, Annex V1 | `commands` |
| L1.patterns | M | every `pattern` in every command document's domains, with the `domainRejects` values and the fixture's accepted values for that argument | the pattern has the restricted I-Regexp form (Annex V2); it compiles with ECMAScript `u` and with the Rust `regex` crate at its default limits (the checker ships a small Rust helper, built from the same code as this repository's `scripts/regex-parity`); both engines give the same answer for each value. A different answer passes only as a verified Unicode-version difference: the value is one code point, the pattern uses a category, and each engine's own tables give that code point a different general category; the report names both Unicode versions and the code point. Any other difference fails. A TypeScript tool cannot see Rust's size limit from its own build, so this is where an oversized pattern is caught | 9.7.4, Annex V2 | `commands` |
| L1.numbers | M | for an `integer` argument, the passing invocation with `9007199254740992` and `-9007199254740992` (one beyond the safe range) on argv, and at L2 as a JSON number and as a string in a document | refused with exit 2 (`USAGE` or the argument's code on argv, `INPUT_INVALID` in a document); never accepted as `9007199254740991` or any other rounded value | 9.7.5, Annex V3 | `commands` |
| L1.validators | M | every `rejects` invocation of every validator (for a 1.4 claim, the lists of the `--schemas` answer's `rejects`, read by validator index; before 1.4, `validators[].rejects`), for `read` commands and writes listed in the fixture, run in a copy of the fixture state made **without** `prepare` or `setup` (an empty directory, the fixture's environment only) | exit 2 with the validator's `code`, `field` naming one of its `arguments`. A validator reads no state and runs before any precondition, with or without `--input` (spec 9.8.2), so a precondition code (an uninitialised store, a missing record) in place of the validator's is a failure | 9.8.2, 9.9.3 | `commands` |
| L1.check-order | M for a 1.2 claim, S for 1.3 or later, not run below 1.2 | for a `read` command, or a write listed in the fixture, a passing invocation changed to break two stages at once, each pair where the command has both: two parse failures (two unknown options, or an unknown option before a value of the wrong valueType); an unknown option and a missing required argument; a missing required argument and a broken domain or constraint; two arguments with broken domains; a broken domain and a broken constraint; two constraints with different codes; a constraint and a validator with different codes (a validator's `rejects` invocation changed to also break the constraint) | the earlier stage answers, with its code and `field`: argv parsing before step 6 (among parse failures, the earliest argv position), then `required`, domains, constraints, validators; within `required` and domains operands in order and then options in declaration order, within constraints and validators declaration order (implementation.md §1). For a 1.2 claim this order is required (it is the 1.2.1 text of spec 10.7 step 6); for a 1.3 claim the spec requires only that the first failure answers, so another order is an advisory. A pair the generator cannot build without breaking a third rule is not used | 10.7, implementation.md §1 | `commands` |
| L1.output-data | M | every `ok` fixture invocation and every example of a `read` command | `data` validates against the output schema `meta.output` names (or the only output; for a claim of 1.4 the schema is read from the `--schemas` answer, spec 9.9.3); `meta.schemaVersion` equals that output's | 6.6, 6.11, 9.9 | `commands` |
| L1.next | M | every `meta.next` observed | the first words of `argv` name an existing command; for `read` commands the checker runs it in the same sequence and it does not exit with `USAGE` (placeholders, `--json` and splitting are L0.next's). `next` is bound to the portable syntax of spec 4.2.1 too (a value that starts with `-` written `--name=value`, never as a separate word); this check does not test that, §8 | 6.8 | — |
| L1.hint-command | S in 1.1 (since 1.1.1) for a tool whose documents declare 1.1 or later (it was an advisory clause of L0.hint-form in 1.1.0), not run for one that declares 1.0 (spec 7.1.2 binds only 1.1 documents) | every `hint` observed that starts with the tool name and a space | it parses against the `schema` document as an invocation of an existing command: the command words, the option names and the 4.2 grammar (each option's arity, operand count). A value that comes from a `<UPPER_CASE>` placeholder is not checked against its domain or the constraints, since the checker cannot generate a value for an arbitrary pattern (§5). The split itself is L0.hint-form's | 7.1.2 | — |
| L1.help-line | M | `--help` | first line mentions `schema` | 4.4.2 | — |
| L1.defaults | S | every option with a non-null `default` | the `--help` text, when it shows a default in a recognised form (`[default: X]`, `(default X)`), shows the same value | 9.7.3 | — |
| L1.deterministic | S | `schema --json` twice, and every command document twice | byte-identical | 9.2 | — |
| L1.paging | M (when offered; the parts marked advisory are S for a 1.3 claim) | the fixture's `paged` invocations (§5) with `--limit 1`; without `paged`, each observed invocation whose answer carried `meta.page.nextCursor`, with `--limit 1` | `meta.page.returned` ≤ 1; running the `next` entry that L0.page found, in the same sequence, returns the next item; the cursor given with a changed filter argument refuses with `CURSOR_INVALID`, `field: "--cursor"`. For a claim of 1.2 or later also: that `next` entry with `--limit 1` replaced by `--all` is not refused with `CURSOR_INVALID`, and with the `env` variable of an option the invocation left out set to another valid value it is refused (a command without `--all`, without such an option, or without such a variable makes that part `unsupported`). For a 1.2 claim also, and an advisory for 1.3 or later (implementation.md §3): with an option other than a switch or a count added explicitly at its declared non-null default the cursor is refused (a switch given `false` and a count given `0` are absent, spec 9.7.2); and on a command with `input`, the paged invocation is also run with its document arguments given through `--input -`: its next-page `next` carries no `--input -`, no default and no `env` value the invocation did not give. That the next-page entry, run in the same sequence and environment, continues (spec 6.9, 11.5) is M for every claim; `--json` is not varied, since text is not compared. A 1.1 or 1.0 claim is tested on none of the 1.2 parts (spec 15.7). Whether the check is `unsupported` or `unprovided` is §5's | 6.9, 7.3.1 | `commands` |
| L1.fields | M (when offered) | the fixture's `fields` selections, including a nested path and an `[]` path when declared | `meta.fields` = selection plus `keep`; no unselected member at any depth (Annex F4 rules 1-3); selected members present whenever the unprojected answer has them (compared with the same invocation without `--fields`, in the same sequence); data validates against the output schema with `required` reduced along the kept paths; an unknown path refuses with `USAGE`, `field: "--fields"`. For a claim of 1.2 or later also: the first selection without `--json` is not refused for `--fields` (its text is not compared), and the unknown path without `--json` refuses as with it | 6.10, Annex F | `commands` |

### L2

| Id | | Invocation | Pass when | Rule | Needs |
|---|---|---|---|---|---|
| L2.input-present | M | command documents | every `write`/`destructive` command has `input` | 10.1 | — |
| L2.input-example | M | none | `input.example` validates against the fragment schema (for a claim of 1.4 the derived one, or the answer's `Input`, spec 9.9.2, 9.9.3) and satisfies `required`, the domains and `constraints`; when `argumentsRef` is present, its argument object (spec 10.7 step 6, numbers as numbers, defaults applied) validates against it | 9.9.2 | — |
| L2.input-refusals | M | for every command with `input`, in the fixture state: `{"bogusKey":1}`; `{"json":true}`; `{"commit":true}`; the example with one key `null`; `{"operands":[]}`; `[{}]` where `batch` is false; `./missing-xyz.json`; a value one byte over `maxBytes`; `{"bogusOne":1,"bogusTwo":2}`; for a claim of 1.2 or later, a document key for each of `limit`, `cursor`, `all` and `fields` the command offers | exit 2; `INPUT_INVALID` (`INPUT_TOO_LARGE` for the size case); `field` a JSON pointer, or `--input` for a framing failure (the size case included, spec 10.7 step 1); the two-key case has `details` with two entries; for a claim of 1.4 a key is unknown when it is no property of the derived fragment schema, or of the answer's `Input` (a flag-only option of the full option set is not one) | 10.2-10.8, 10.10, 9.9.2 | `commands` |
| L2.input-tty | M | `--input -` with a pty on stdin | exit 2 `INPUT_INVALID`, `field: "--input"`, within the timeout | 10.3 | — |
| L2.input-usage | M for a tool that declares 1.1 or later, S for one that declares 1.0 (spec 15.1: a minor adds no MUST an existing tool can fail) | an `ok` invocation with `--input '{}'` given twice; one with `--input` as its last word | `USAGE` or its registered finer replacement (spec 7.3.2), with `field: "--input"`; never `INPUT_INVALID` | 10.2 | `commands` |
| L2.input-reasons | S (when the registry lists reasons under `INPUT_INVALID` or `INPUT_TOO_LARGE`) | the framing failures of L2.input-refusals and L2.input-tty | the error carries the reserved reason of spec 7.3.3 for its situation (`NOT_JSON`, `NOT_OBJECT`, `UNKNOWN_KEY`, `FLAG_ONLY_KEY`, `INVALID_VALUE`, `UNREADABLE`, `STDIN_TTY`, `TOO_MANY_BYTES`, `BATCH_UNSUPPORTED`) | 7.3.3 | `commands` |
| L2.input-fragment | M | each `ok` fixture invocation split into argv operands + a document holding the rest | same result as the argv form: the same exit, `ok`, `error.code` and `error.field`, and the same `data` except the paths that differ between two runs of the argv form on fresh copies of the same state (a timestamp), which are volatile and left out | 10.7 | `commands` |
| L2.input-normalise | M | an `ok` invocation whose integer arguments are given as numeric strings in the document | same result, compared as in L2.input-fragment | 10.5 | `commands` |
| L2.input-conflict | M | an `ok` invocation plus a document giving one of its arguments another value; and one giving the same value, spelt differently where the command has such an argument (a `json` object with its members in another order, a `number` written `1.0` against `1`, an integer `-0` against `0` or as a numeric string) | `INPUT_CONFLICT` with the document pointer; the same-value cases succeed: values are compared after normalisation, never as text | 10.7 | `commands` |
| L2.input-env | M (when a command with `input` has an option that is the only one in the schema declaring its `env` variable; none: `unsupported`) | that option's key given in a document with a valid value, while its `env` variable is set to a value its argument refuses (a wrong type, outside the domain) | the same result as without the variable, compared as in L2.input-fragment: an `env` value applies only to an argument absent after the merge (spec 10.7 step 5), so it neither conflicts nor is validated here. A variable two options declare is not probed: it does not say which of them it fills, and filling an absent flag-only option from it is correct | 10.7 | `commands` |
| L2.input-pointer | M | a document violating one `constraints` rule, or omitting a required key that argv does not give either (the run really omits it); a rule that names a flag-only argument is not broken in a document | the constraint's code (or `USAGE`), `field` a document pointer | 10.8 | `commands` |
| L2.input-dash-values | M | a document whose string value starts with `-`, `{` and `[`, given to the first string argument that admits such values (up to four, in declaration order); a candidate whose runs are all refused with a registered precondition code cannot tell, and the next is tried | accepted as values (no option, file or inline-JSON misreading); a refusal whose `field` names that argument and whose `received` is the value also passes, since the value was read as a value. `unprovided` only when no candidate decides | 10.9, implementation.md §4 | `commands` |
| L2.batch-preflight | M | a batch whose last item fails a state-independent check (a type, a constraint); a constraint on a flag-only argument is given on argv, and one an item cannot break that way is skipped (every one: `unsupported`) | exit 2, that item's code, `field` `/<index>/…`, no `data` | 10.11 | `commands` |
| L2.batch-incomplete | M | fixture `batchFailsAt` and `batchFailsFirst` | exit 1, `BATCH_INCOMPLETE`, `field` `/<index>`, `data.items` one per submitted item in order, statuses as in spec 10.11, the failed item's own `error`, `meta.output` the batch output | 10.11 | `commands` |
| L2.batch-ok | M | a batch of the fixture's `ok` invocations | exit 0, batch report, every status `written` or `unchanged` | 10.11 | `commands` |
| L2.idempotency | M | each `ok` write run twice in one sequence | `replay-safe`: second run `unchanged` or same result, no new effect; `once`: second run exit 2 and nothing changed; `content-keyed`: same. A path matching the command's `allowedEffects` is left out of "no new effect" only when the command's `effectNote` names that side effect (an audit line); the report lists the paths left out. `appends` describes the command's records (spec 11.3), never an audit line | 11.3 | `commands` |
| L2.destructive-safety | M | command documents | every destructive command has `commit` and `plan-digest`, `flagOnly`, and no batch; for a claim of 1.4 they are not implied, so each is listed in `options`, as an object or as a reserved name (spec 9.5), and a destructive command that lists neither fails | 11.4, 11.8, 9.5 | — |
| L2.destructive-preview | M | every destructive command, fixture `preview` | exit 0; `planDigest`, `effects`, `committed: false`; `meta.next[0].argv` contains `--commit`, `--plan-digest <that digest>` (two words, or one word `--plan-digest=<that digest>`) and `--json`; nothing written | 11.2, 11.4, 11.5 | `commands` |
| L2.destructive-preview-stdin | M | the preview with its arguments given via `--input -` | `meta.next[0].argv` does not contain `--input -` and replays to the same plan | 11.5 | `commands` |
| L2.destructive-stale | M | the commit argv with a digest that differs in one character, in the form `next[0]` writes it (one word or two) | exit 2 `PLAN_STALE`, `meta.next[0]` the preview | 11.7 | `commands` |
| L2.destructive-half | M | `--commit` alone; `--plan-digest x` alone | exit 2 `USAGE`, its registered finer replacement (spec 7.3.2), or the `code` of the `requires` rule that states the relation (spec 9.8.1) | 11.7 | `commands` |
| L2.destructive-commit | M | the preview's `next[0]` | exit 0, `committed: true`, the effects happened | 11.7 | `commands` |
| L2.async | M (when offered) | the fixture's async start, then `next[0]`, with the worker set to `done`, `failed`, `timeout` | always: start exits 0 with `async: true` in the document and an identifier, and `next[0]` is present and names a `read` command. When `next[0]` carries `--wait`: `done` → 0; `failed` → 1 with a registered code; `timeout` → 1, retryable, `next[0]` the same wait. Without `--wait` (no command in the schema has it), only the outcome part is `unsupported` | 12.2, 12.3 | `commands` |
| L2.operation-key | M (when offered) | the async start twice with the same `--operation`, then twice concurrently with a fresh key, then once with another payload | the repeats return the same identifier and start nothing (the worker sees one start per key, also under the concurrent pair); the other payload is `OPERATION_REUSED` | 12.4 | `commands` |
| L2.stream | M (when offered) | each stream command with `--json`, every declared stream output (`when`) | start line first, naming its output when the command has several, and that output's `meta.output` again in the end result; events, end line last; every event's `data` validates against the output's `eventRef`; the end `result` passes every envelope check (L0.ok-exit, L1.output-data, `meta.output` naming the stream output); start and end agree on tool, command and version; exit equals the end result's; a usage error prints one plain failure envelope that is a refusal | 13 | `commands` |
| L2.skills | M | `skills show --json`, then each listed guide, then `skills show nosuch-xyz --json` | data validates against `guide.schema.json`; works in an empty directory; nothing written; the unknown name exits 2 with `expected` | 14 | — |
| L2.guide-commands | M | every fenced line of every guide that starts with the tool name | parses as in L1.examples after substituting placeholders (§7.1) | 14.3 | — |
| L2.search | S (when offered) | the fixture's `search` queries | a `tree` with `query`; the expected command among the first five entries. Ranking quality is not part of the contract (spec 9.10.1), so this is an advisory; the shape of the answer is checked by L1.tree | 9.10.1 | `commands` |
| L2.help-guide | M | `--help` | first line also names `skills show` | 4.4.3 | — |
| L2.effects | M (S at L0 and L1) | every `--dry-run`, `--help`, `--version` invocation and every successful `read` command of the fixture other than `schema` (L1.no-state) and `skills show` (L2.skills) | no change in the snapshots, except paths matching `allowedEffects` for a `read` command that has an `effectNote` | 11.2 | `commands` |

## 7. Details

### 7.1 Tokenising documented command lines

Examples and guide lines are split into argv words with a POSIX-shell subset: whitespace separates words; `'…'`
and `"…"` quote (backslash escapes `"` and `\` inside double quotes); a trailing `\` joins the next line. A line
that contains an unquoted `|`, `>`, `<` not part of a `<PLACEHOLDER>`, `;`, `&`, `$(` or a backtick is outside
spec 14.3 and is skipped (reported as `unsupported`). In guides, `<UPPER_CASE>` placeholders are replaced by a
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
| JSON error also printed on stderr | L0.stderr-result |
| `CI=1` switches text mode to JSON | L0.no-env-switch-text |
| `schema` refuses without a config file | L1.no-state |
| a group runs | L1.groups-not-runnable |
| option `--change-id` | L1.grammar |
| an example violating a declared constraint | L1.examples |
| a constraint declared but not enforced | L1.constraints |
| report missing a required field | L1.output-data |
| `next` without `--json` in a JSON-mode run | L0.next |
| a constraint implied by `required` (no isolated violation) | (none: L1.constraints is `entailed`, the level passes) |
| `--limit 0` accepted although the domain says `minimum: 1` | L1.domains |
| `9007199254740993` accepted as `9007199254740992` | L1.numbers |
| a validator's `rejects` invocation exits 0 | L1.validators |
| a validator whose command reads its store first, so that without `setup` it answers a precondition code | L1.validators |
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
| document value `-x` refused with `field` naming its option and `received: "-x"` | (none: L2.input-dash-values passes; the value was read as a value) |
| a tree that declares L2 checked with `--level L1` | (none: L1.tree passes, and its report says the L2 claim went unchecked) |
| a `replay-safe` write whose second run appends only to an audit file its `allowedEffects` lists and its `effectNote` names | (none: L2.idempotency passes and lists the path) |
| the same, with an `effectNote` that does not name the file | L2.idempotency |
| a preview whose `next[0]` writes `--plan-digest=<digest>` as one word | (none: L2.destructive-preview passes) |
| a `data` member holding the current time, different in the argv and the document forms | (none: L2.input-fragment leaves volatile paths out) |
| first batch item failure returns the item's code and no data | L2.batch-incomplete |
| preview writes a file, with a non-empty `effectNote` | L2.destructive-preview |
| refusal appends a telemetry line, or writes a file | L0.refusal-effects |
| preview `next` contains `--input -` | L2.destructive-preview-stdin |
| stale digest accepted | L2.destructive-stale |
| second `--operation` repeat starts a second worker | L2.operation-key |
| stream without an end line | L2.stream |
| stream event that fails `eventRef`, or an end result with the wrong `retryable` | L2.stream |
| `--fields profile.name` leaves `profile.email` | L1.fields |
| complete `--input` document with no argv arguments refused as missing arguments | L2.input-fragment |
| a batch whose first item names a missing object refuses in preflight (exit 2, no data) | L2.batch-incomplete |
| next-page entry not first in `meta.next` | (none: L0.page and L1.paging must still pass) |
| `nextCursor` without a `next` entry that carries it | L0.page |
| L0 claim, no `paged` entry, and every listed command refuses `--cursor x` with the code L0.unknown-option saw and `field: "--cursor"` | (none: L0.page and L1.paging are `unsupported`) |
| L1 claim, no `paged` entry, a command document declares `--cursor`, and no run observes a `nextCursor` | L0.page and L1.paging are `unprovided`, which fails the level, though the fixture lists no paging command |
| no `paged` entry, and a listed command refuses `--cursor x` with `CURSOR_INVALID` but no run observes a `nextCursor` | L0.page `unprovided` (the command pages; it is not `unsupported`) |
| L0 claim, no `paged` entry, and a listed command answers `--cursor x` with exit 0, or refuses it with a code other than L0.unknown-option's and `CURSOR_INVALID` | L0.page `unprovided` (read as paging, §5), which fails the level |
| a command that prompts on stdin when a required value is missing, and waits | L0.no-prompt |
| a command that sleeps for longer than the timeout without reading stdin | L0.no-prompt reports `unprovided`, not `fail` |
| a command that reads a line from a canonical-mode terminal when a value is missing | L0.no-prompt (it exits only after `VEOF`) |
| a command that switches the terminal to raw mode and waits for a key | L0.no-prompt (`unprovided` unless it prints a prompt or reacts to the `0x04` byte) |
| a 1.1 tool whose ordinary answer omits `contract` and `contractVersion` | L0.contract-version |
| a 1.0 tool whose hint is prose starting with its name (`ledger can't find this ledger.`) | nothing: L0.hint-form does not apply to 1.0 |
| a 1.0 command document whose declared map has `minProperties` | nothing: a 1.0 map is kept whole and is no cut node |
| a 1.1 command document whose declared map has `minProperties` | L1.walk (the map is a cut node) |
| an error with `reason: "NOT_JSON"` where the registry lists no such reason under that code | L0.registry |
| a `meta.warnings` code in neither registry | L0.registry |
| `schema --error <warning-only code>` answers with an entry | L0.registry |
| `schema --error <warning-only code>` refused with `USAGE` but `field: "CODE"` | L0.registry |
| fixture `"registry": "from-schema"`, and a run emits a code that `schema --errors` does not list | L0.registry |
| `--commit` alone refused with a registered `OPTION_REQUIRED` that the tool uses instead of `USAGE` (spec 7.3.2) | (none: L2.destructive-half passes) |
| `--plan-digest x` alone refused with the `code` its command's `requires` rule declares for the pair (spec 9.8.1) | (none: L2.destructive-half passes) |
| a fixture `prepare` step exits non-zero, or runs the binary under test | (none: the checker stops with a fixture error and reports no check, §5) |
| a fixture `setup` step exits non-zero | (none: the checker stops with a fixture error and reports no check, §5) |
| a command that serves until signalled, listed in `notRun`, whose example would never end | (none: it runs once until its first document, which passes the envelope and output checks; its other example-driven runs are skipped and reported as `notRun`, §5) |
| a command listed in `notRun` whose first document is not a valid envelope | L0.envelope |
| a command listed in `notRun` that exits on its own after printing its envelope | (none: the checker stops with a fixture error, §5) |
| a `paged` entry for a command listed in `notRun` | (none: the entry is skipped and reported as `notRun`, §5) |
| `notRun` naming a command without an `effectNote`, or one `schema` does not list | (none: the checker stops with a fixture error, §5) |
| `notRun` naming every `read` command that has examples | (none fails, but L1.example-runs is `unprovided`, which fails the level, §5) |
| a command in `notRun` that accepts an out-of-range domain value | L1.domains (its refusal runs still run) |
| a registry whose exit for one code differs from the fixture's | L0.registry |
| a tool declaring 1.0 that emits `error.reason`, or a 1.1 tool whose envelope lacks `meta.contractVersion` or says `1.0` | L0.contract-version |
| stderr holds a progress line in JSON mode | L0.stderr-quiet (advisory; no MUST check fails) |
| `USAGE` with no `field` and no hint | L0.usage-hint (advisory) |
| every `USAGE` the run observes carries `field` | (none: L0.usage-hint is `unsupported`) |
| a group answers `<tool> <group> --repo . --json` with `USAGE` | L0.global-on-group (advisory) |
| a 1.1 hint `canon finding clsoe <CHANGE_ID>` that names no command | L1.hint-command (advisory in 1.1) |
| a 1.1 hint `canon finding close <CHANGE_ID> --json` whose `CHANGE_ID` has a `pattern` that `x` does not match | (none: placeholder values are not checked against domains) |
| a reason listed twice under one code | L1.reasons |
| a warning code listed twice, or with another meaning in the two registries | L1.warnings |
| `--input` given twice answered `INPUT_INVALID` | L2.input-usage |
| `--dry-run` writes a file | L2.effects |
| a write leaf that exits 2 after it changed a file | L0.refusal-effects |
| a write leaf whose precondition failure exits 1 (spec 8.3.1) | (none: legal; L0.ok-exit still passes) |
| a paged invocation refused with a registered precondition code (no backend credentials in the fixture environment) | (none fails: L0.page and L1.paging are `unprovided`, naming the code, which fails the level, §5) |
| a listed `ok` invocation refused with `USAGE` | the check that runs it fails (a parse refusal is not a missing environment, §5) |
| a 1.2 command document whose `--limit` is not flag-only | L1.grammar |
| a 1.1 command document whose `--limit` is not flag-only | (none: the 1.2 rule does not apply) |
| a 1.2 tool that accepts `{"limit":1}` in a document | L2.input-refusals |
| a 1.2 registry with `STOPPED_MIDWAY` at exit 2 | L1.registry |
| a 1.1 registry whose own `STOPPED_MIDWAY` is retryable | (none: a code of the tool's own below 1.2) |
| a tool of 1.2 or later that refuses a cursor when `--all` replaces `--limit` | L1.paging |
| a 1.2 tool that accepts a cursor with an option added at its default value | L1.paging |
| a 1.3 tool that accepts a cursor with an option added at its default value | L1.paging (advisory; no MUST check fails) |
| a 1.1 tool that does either of the two above | (none: not tested below 1.2) |
| a 1.2 tool that refuses `--fields` without `--json` | L1.fields |
| a 1.2 tool that answers a broken domain and a broken constraint with the constraint's code | L1.check-order |
| an `env` value applied before the merge, so that an invalid variable refuses a document that gives the key | L2.input-env |
| a `json` value with its members in another order answered `INPUT_CONFLICT` | L2.input-conflict |
| a listed `ok` invocation refused with a code the command document declares on a validator | the check that runs it fails (a stateless refusal is not a missing environment, §5) |
| at L0 with no registry, a listed `ok` invocation refused with a tool's own exit-2 code | (none fails: the checks that run it are `unprovided`, §5) |
| a 1.2 tool whose next-page `next` after `--input -` writes out a default value, so its own cursor refuses it | L1.paging |
| a 1.2 tool that accepts a cursor after an option's `env` variable changed | L1.paging |
| a 1.2 tool that answers a missing required argument and a broken domain with the domain's code, or two broken domains with the later option's `field` | L1.check-order |
| exit 143 from a launcher after SIGTERM | (none: treated as a signal) |
| a 1.3 registry with `PROMOTE_REFUSED` | L1.code-names (it ends in no condition) |
| a 1.3 registry with `FINDING_NOT_FOUND` at exit 1 | L1.code-names |
| a 1.3 registry with `STORE_UNAVAILABLE` not retryable | L1.code-names |
| a 1.3 registry with `STOPPED_MIDWAY` (exit 1, not retryable) | L1.code-names |
| a 1.3 registry with a tool code that takes a core code's name at another exit | L1.registry |
| a 1.2 registry with `PROMOTE_REFUSED` at exit 1 | (none: 1.2 holds a tool's own code to no naming rule) |
| a 1.3 tool whose warning code is only in the error registry | L1.warnings (and L0.registry when the code is in neither registry) |
| a 1.3 tool that answers two stateless failures in another order than implementation.md §1 | L1.check-order (advisory; no MUST check fails) |
| a 1.2 tool that answers them in another order | L1.check-order |
| a 1.3 tool whose `requires` violation names another qualifying argument than implementation.md §2 | L1.constraints (advisory) |
| a 1.3 tool whose constraint violation names an argument the caller can neither add nor remove | L1.constraints |
| a 1.4 tool that prints an indented document | L0.compact |
| a 1.3 tool that prints an indented document | L0.compact (advisory; no MUST check fails) |
| a 1.4 tool that answers `--help --json` with the `schema` document | L1.help-json |
| a 1.3 tool that answers `--help --json` with the `schema` document | (none: L1.help-json is not run below 1.4) |
| `schema <path> --schemas` that holds a schema no ref reaches, or lacks one a ref reaches | L1.schemas |
| `schema --schemas --json` answered with a document | L1.schemas |
| a 1.4 command document with `"required": false` (a default member listed) | L1.walk (Annex S2 rule 17) |
| a 1.4 tree entry with `"kind": "command"` or a `path` | L1.tree |
| a 1.4 command that names a word that is neither a tree option nor a reserved option, or a tree option no command names | L1.walk (Annex S2 rule 17) |
| a 1.4 command that lists `--json`, or the code `USAGE` | L1.reserved-applicable |
| a 1.4 destructive command that lists `--commit` and `--plan-digest` as reserved names | (none: L1.walk and L2.destructive-safety pass) |
| a 1.4 destructive command that lists neither `--commit` nor `--plan-digest` | L2.destructive-safety |
| a 1.4 command that lists `--input` with `input`, or `--fields` with an output's `fields` | L1.reserved-applicable |
| a 1.4 command that omits the registered `OPTION_INVALID` the tool uses instead of `USAGE` from `errors` | (none: L1.codes-known passes) |
| `<tool> nosuch-xyz --help --json` answered with `USAGE` or with the tree | L1.help-json |
| `--version --json` answered with a version document, or with `field` `--help` | L1.help-json |
| a 1.4 command document with `validators[].rejects` | L1.walk |
| a `--schemas` answer without `Input` for a command with `input`, or with an `Input` that differs from the derivation | L1.schemas |
| a `--schemas` answer with `rejects` for a command without validators, or with a list count other than its validators | L1.schemas |
| a `--schemas` answer in which a ref names `Input` | L1.schemas |

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

A green checker run does not prove these. They are part of conformance, which is defined by the spec alone (spec 3.7),
and the checker cannot see them, so the tool's own tests must cover them and its CI must show the evidence:

| Obligation | Why the checker cannot | Evidence |
|---|---|---|
| The tree is complete: every parser node is in `schema` | the checker sees only what `schema` lists | parser/self-description parity test (canon `tests/cli_spec.rs`, the crate's `table_matches_tree`, a TypeScript tool's leaf-list test) |
| No call site overrides an exit; every emitted code is registered | unreached paths are invisible | source scan or typed construction (canon `schema_codes.rs`, `defineError`) |
| Constraints of commands that write, beyond the fixture | the checker runs only listed writers | `constraints_hold` (approaches/rust.md §3.3) or the TypeScript equivalent |
| A preview's `effects` are complete and a commit does exactly them | the checker sees files, not remote state | tool tests against fake stores |
| Remote effects of reads and refusals | outside the snapshot | tests with fake backends asserting no calls |
| Secrets never appear in errors, `next` or reports | the checker has no secrets to look for | tests that inject a known secret and grep all outputs |
| Commit atomicity against concurrent changes | needs controlled interleaving | tool tests (spec 11.7) |
| Operation keys: atomic reservation, concurrent duplicates, a crash between the remote effect and recording it, retention expiry | needs fault injection and a controllable clock | tool tests against a fake backend that can lose a reply after applying the effect (spec 12.4) |
| Streams cut off mid-way leave no half-applied state the report hides | the checker can only kill the process, not inspect the backend | tool tests that kill the stream writer between events |
| Every example and guide line parses with the real parser | the checker approximates the parser from the document | `examples_parse` (approaches/rust.md §3.3) or the TypeScript equivalent |
| No prompt reads the terminal through `/dev/tty` when a value is missing | the checker connects stdin and stdout to a pty but does not make it the process's controlling terminal, so it cannot detect a direct `/dev/tty` read; spec 5.4 forbids such a prompt all the same | a test or source scan showing the tool never opens `/dev/tty` |
| `meta.next` uses the portable syntax of spec 4.2.1 | no check parses `next` argv for the separate-word form of a `-`-leading value | a test that every `next` the tool builds parses with the real parser and writes such values as `--name=value` |
| At L0, every paging command pages correctly, listed in the fixture or not | without `schema` the checker sees only the commands the fixture lists (§5) | list every paging command with a `paged` entry, or claim L1, where the command documents name them |
| Domains and validators match the real parser and predicate beyond the published boundary values and witnesses; when several validators share a code, each is tested in isolation so that one cannot stand in for another | the checker sees one refusal per witness, not the predicate | boundary tests against the real parser (`constraints_hold`, approaches/rust.md §4.3) and a unit test per validator predicate |
| Conservative staging is reported correctly: a write leaf exits 2 only for a failure it knows came before the work (spec 8.3, 8.3.1) | the checker cannot see where the work started; it catches an exit 2 with a change in the snapshot, not an exit 2 after remote work, nor an exit 1 that could have been 2 | tests per write leaf that inject a failure before the first backend call and after it, asserting exit 2 and no change for the first and the during-the-work code for the second; an explicit work-begins marker makes this mechanical (approaches/rust.md §3.1, approaches/typescript.md §3.7) |
| Reasons are emitted only when registered under their code (spec 7.6) | the checker sees only the reasons its runs reach | typed construction (a per-code reason enum generated from the registry, approaches/rust.md §3.1; `reasons` keys of `defineError`, approaches/typescript.md §3.1) or a source scan |
| A command that works in steps reports a stop after a step made effects with its own `INCOMPLETE` code (`DEPLOYMENT_INCOMPLETE`) whose `reason` is the refused code, and its `next` reads what was done (spec 8.3.2; for a 1.2 tool the code is `STOPPED_MIDWAY`, a SHOULD) | the checker cannot stop a command between two of its steps | a test per such command that makes a later step refuse after an earlier one wrote, asserting exit 1, the code, the reason and `next` |
| Warning codes are registered (spec 7.5.1) | warnings no run raises are invisible | typed construction of warnings (`WarningInfo`, `defineWarning`) or a scan of `meta.warnings` call sites against the registry |
