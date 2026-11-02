# Changelog

## 1.2.0 (2026-11-02)

A minor (15.1) from implementer feedback. It adds no member, option, document kind or enum value. Its new rules
bind only a tool that declares `meta.contractVersion` `"1.2"`; a tool that declares 1.1 or 1.0 stays conforming
without a change (10.13 rule 16; 15.1's MINOR row now names the declaration of the minor as what such rules
govern), and nothing a 1.1 caller that reads the tool's self-description relied on changes (15.10).

- **Cursor binding (6.9, D32).** In a 1.2 tool a cursor is bound to every argument except the reserved options that
  never change the result set, `--json`, `--limit`, `--all`, `--cursor` and `--fields`. An argument given
  explicitly with its default value is given, except a switch given `false` or a count given `0`, which are absent
  (10.7.2). A value taken from an `env` variable is bound too, though it is not given. The next-page `next` carries
  exactly the arguments the invocation gave explicitly (an `--input -` document re-expressed as 12.5 says), never a
  default or an `env` value, so it continues in the same environment. The one relaxation, continuing a page after
  `--all` or `--json` changed, keeps the result set, so callers already handle it (15.1, 15.10).
  `approaches/typescript.md` §3.8: the 1.2 digest and next-page entry.
- **`--fields` without `--json` (6.10, D32).** A 1.2 tool parses and validates `--fields` the same in both modes;
  what it does to text is the tool's.
- **Flag-only paging and selection (9.8, 11.6, 10.13 rule 8, D32).** In a 1.2 tool `limit`, `cursor`, `all` and
  `fields` are flag-only, like `json`, `input`, `commit` and `plan-digest`.
- **Order of the stateless checks (11.7 step 6, D32).** In a 1.2 tool argv parse failures come first, the one at the
  earliest argv position among several; then `required`, domains, constraints and validators, in that order:
  operands in order and then options in declaration order for `required` and domains, declaration order for
  constraints and validators. The first failure answers.
- **A constraint's argument at fault (10.8.1, D32).** In a 1.2 document `field` names: for `requires` the first
  missing `then` name; for `forbids` the first given `then` name; for `atMostOne`, and `exactlyOne` with several
  given, the first given name; for `atLeastOne`, and `exactlyOne` with none given, the first name. For every minor,
  "first" follows the rule's own order, never argv's.
- **`STOPPED_MIDWAY` (7.2.1, 7.2.3, 8.3.2, 10.13 rule 14, D33).** A reserved code (exit 1, not retryable) for a
  command that works in steps and stops after a step made effects, because a later step meets what the command
  refuses before its work; `reason` is that refusal's code alone (its own reason is not carried), `meta.next`
  SHOULD read what was done. SHOULD for a 1.2 tool, so a tool with a code of its own stays conforming; a 1.2 tool
  that registers the name gives it that exit, retryability and meaning, which hold only in a document that declares
  1.2 (in an earlier document the code is the tool's own). `BATCH_INCOMPLETE` stays the batch's code; a stopped item
  is `failed` with `STOPPED_MIDWAY`. Reserved reason `PLAN_STALE` for a commit that detects a changed plan between
  effects (12.7).
- **Wording a patch could carry (D34).** A check that reads an option's `env` value is a validator; a configured
  role is a precondition (10.8.1). Rules stated for a document or tool that declares 1.1 now say "1.1 or later"
  (6.10, 7.1.2, 7.5.2, 11.2), as rule 16 already read them.
- **Approaches.** `typescript.md`: report schemas compare by meaning (Effect 4.1's `anyOf` nullable form and
  `Schema.Int`'s `maximum`); `defineCommand` decodes `{}` through every defaulted field at definition; the 1.2
  cursor digest and next-page entry. `migration.md` §7: moving from 1.1 to 1.2. The contract constants say `"1.2"`.
- **Checker (`approaches/checker.md`).** A fixture invocation listed to succeed and refused with a registered
  precondition code makes its checks `unprovided`, naming the code (§5); `unprovided` still fails the level. A
  refusal from a stateless step (a parse code, an `INPUT_*` code, a code declared on a constraint or a validator, or
  a code observed as a domain's refusal, since a domain declares none) is `fail`; at L0, with no command document,
  only the reserved stateless codes are known, and with no registry at all any other exit-2 code counts as a
  precondition. L1.walk names rule 3's `in` check on switches and counts. L2.input-pointer's omitted key is omitted
  from argv too. L2.input-conflict's same-value case uses other spellings (member order, `1.0`/`1`, `-0`/`0`). New
  L2.input-env: an `env` value applies only to an argument absent after the merge. L0.hint-form, L1.hint-command and
  L2.input-usage run for 1.1 or later. For a 1.2 claim: L1.grammar (four more flag-only options), L1.registry
  (`STOPPED_MIDWAY`), L1.paging (`--all` instead of `--limit` continues; an option other than a switch or count
  added at its default refuses; a changed `env` variable refuses; after `--input -` the next-page entry carries no
  default or `env` value and continues), L1.fields (`--fields` without `--json`), new L1.check-order (every pair of
  stages, two parse failures, two domains, constraint against validator), L2.input-refusals (paging keys in a
  document). A §8 obligation for `STOPPED_MIDWAY`. Seeded violations for each.
- **Checker changes that can fail a tool that passed the 1.1.2 checker, at its own claim.** L2.input-conflict's
  spelling variants, L2.input-env and L2.input-pointer's truly omitted key enforce 11.7 steps 3 and 5 and 11.8,
  which 1.0 already had. Every other new row runs only for a 1.2 claim, and the refused-invocation rule turns some
  `fail` results into `unprovided`, which still fails the level.
- **Examples and validator.** acme declares 1.2: its paging and selection options are flag-only, its registry
  reserves `STOPPED_MIDWAY` with the reason `ENVIRONMENT_FROZEN`, and `acme deploy start` stops part-way in
  `report-failure-acme-deploy-start-stopped-midway.json`. A new tool `tally` stays on 1.1 to show the 1.2 rules do
  not apply there; its own retryable `STOPPED_MIDWAY` is read by its registry entry (8.3.2). Caller documents of a
  later minor now declare `1.3`. `scripts/check.ts` knows minor 1.2 and applies rules 8 and 14 by the declared
  minor; invalid examples for each.

## 1.1.2 (2026-11-01)

A patch (15.1): wording, approaches and checker rows from implementer feedback and the round-12 notes. No member,
option, rule strength or document kind is added; `meta.contractVersion` stays `"1.1"`, and a tool that conformed to
1.1.1 still conforms (D31). Which arguments bind a cursor is unchanged and left for 1.2.0.

- **Stated where it could be read two ways.** A caller pages with the `next` entry's arguments, changing at most `--limit` and `--fields` (6.9).
  `--all` asks for every remaining item, a `--limit` without a bound (9.8). A batch input selects the batch output,
  so `--fields` on argv is read against its `fields` and refuses with `USAGE` when it declares none; those paths are
  paths into the batch report, so a single-item `--fields` value does not carry over, and a batch schema written as
  `allOf` `batch-report.schema.json` declares no `fields` (6.10). A lone `--commit` or `--plan-digest` may also
  refuse with the `code` of the `requires` rule that states the pair (12.7, 10.8.1). 12.7's closing sentence: a
  tool that recomputes its plan is not affected by the refusal, whether it detects changes per effect, holds a
  lock, or needs neither.
- **Checker (`approaches/checker.md`).** Fixture key `prepare`: argv arrays of any program, run without a shell,
  once, in the template directory before `setup`, with the fixture's `env`; a failing step, or one that runs the
  binary under test, is a fixture error, not a tool failure, and the report lists every step; the effects baseline
  is taken after `prepare` and `setup`; the tool's own state is still built by `setup`. A failing `setup` step is a
  fixture error too (it was undefined). L1.validators runs without `prepare` too (an empty directory). At L0, an
  answer to `--cursor x` that is neither the unknown-option refusal nor `CURSOR_INVALID` is read as paging. An
  advisory whose subject the run never met is `unsupported` at any level (§2 now says so; L0.usage-hint already
  did). With `from-schema` and no `schema --errors`, only L0.ok-exit is `unprovided` (L0.registry does not run).
  L2.destructive-half accepts the `requires` rule's `code`.
- **TypeScript (`approaches/typescript.md` §3.8).** The cursor digest adds the flag-only options the invocation
  gave (`--json`, a tool's own such as a repository or role option), which the 11.7 step 6 argument object leaves
  out but 6.9 binds.
- **Checker change that can fail a tool that passed the 1.1.1 checker.** An L0 command that answers `--cursor x`
  with exit 0, or refuses it with a code other than L0.unknown-option's and `CURSOR_INVALID`, had no defined result
  and is now read as paging, so without a `paged` entry or an observed `nextCursor` L0.page is `unprovided`. Such an
  answer already breaks 6.9 (a paging command refuses a foreign cursor with `CURSOR_INVALID`), or 9.9 and 7.2.2 (an
  unknown option refuses, with one code per situation); add a `paged` entry, or answer as those sections say.
- **Validator (`scripts/check.ts`).** The cross-reference check reads `1.x.y` as a contract version, not a section
  (section 1 has no third level); a bare patch version in the prose passed before only when one started a line.

## 1.1.1 (2026-11-01)

A patch (15.1): wording, the schema pattern of `meta.contractVersion`, approaches and checker rows, from implementer
feedback. No member, option, rule strength or document kind is added; `meta.contractVersion` stays `"1.1"`, and a
tool that conformed to 1.1.0 still conforms (D30).

- **Schema.** `meta.contractVersion` (and a stream start line's) matches `^1\.[1-9][0-9]*$`: `"1.0"` is never
  written, as 6.6 already said (absent means 1.0). New invalid example
  `stream-acme-build-start-contract-version-1-0.ndjson`.
- **Stated where it was missed.** Validators run for every invocation, with or without `--input`, before any
  precondition or state read (10.8.3). Field selection is per output; a single union-shaped output offers no
  `--fields` (6.10). A switch's `default` is always `false`; `defaultNote` says when configuration turns it on
  (10.7.3). `schema`'s unknown path omits an empty `expected`, and its `field`, when present, is `command`; its
  path/`--errors`/… exclusion is an `atMostOne` rule of `schema`'s own document, with `field` as for any
  `atMostOne` (10.1.2). Previews and `--dry-run` make no effect whatever their exit (12.2). When another system
  makes the effects and computes the digest, the tool passes it through (12.6). A commit whose digest only that
  system can recompute, when it cannot, is refused with the tool's own exit-2 code, not `PLAN_STALE`; a tool that
  recomputes the plan itself and detects changes per effect is unaffected. `USAGE` there includes its registered
  finer replacement (12.7). A fixture registry taken from the tool pins nothing (17.3).
- **Checker (`approaches/checker.md`).** `USAGE` in any row accepts its registered finer replacement (7.2.2).
  Fixture key `commands.<id>.paged` for L0.page and L1.paging; from L1 the command documents (`--cursor`) say which
  commands page, at L0 observation of the listed commands does, and leaving a command out of the fixture never
  makes paging `unsupported`. `"registry": "from-schema"` (errors and warnings; `unprovided` when the tool offers
  no `schema --errors`). New L1.hint-command, an advisory (S) in 1.1.1: command words, option names and grammar,
  not placeholder values; L0.hint-form keeps the split. Scope of L0.no-prompt (`/dev/tty`, a §8 obligation; 5.5
  still forbids the prompt), L0.contract-version (every JSON document), L0.usage-hint (`unsupported` without a
  field-less `USAGE`), L0.global-on-group (`unprovided` vs `unsupported`), L0.registry (`--error` with a
  warning-only code). Seeded violations for each.
- **Checker changes that can fail a tool that passed the 1.1.0 checker.** Each checks a rule 1.1.0 already had:
  - *L1.validators runs without `setup`*: 10.8.1 and 11.7 step 6 already put validators before any state read.
    A tool whose validator answers a precondition code in an empty directory must move the check before it reads
    state.
  - *L0.page and L1.paging are `unprovided` for a paging command with no `paged` entry and no observed
    `nextCursor`* (6.9): add a `paged` invocation for each paging command.
  - L1.hint-command enforces 7.1.2 but stays an advisory in 1.1.1, as its clause in L0.hint-form was in 1.1.0, so
    it fails no tool in this patch.
- **TypeScript (`approaches/typescript.md`).** The constraint member `then` makes records thenable; keep them under
  another field name and map at emission.

## 1.1.0 (2026-11-01)

Optional additions and SHOULD/MAY rules from implementer feedback from two early adopters, and a fix to how the
contract is versioned. A tool that conformed to 1.0.0 still conforms, as a 1.0 tool; a tool that uses anything new
declares `meta.contractVersion: "1.1"`.

- **Versioning (15, D20).** Versions are `MAJOR.MINOR.PATCH`, with three change classes (15.1). Callers ignore
  unknown members in every object the contract defines, not only in reports, and do not reject a document for an
  unknown enum value (15.6). A tool declares the minor it implements in `meta.contractVersion` and emits only what
  that minor defines (15.7, 10.13 rule 16). The schemas stay closed for tools; callers read them open; members added
  after 1.0 carry `"x-atip-since": "1.1"` (15.8). **This release breaks 1.0.0's promise once:** a 1.0 caller that
  validated output against the closed 1.0 schemas rejects the new members, and a warning code may live only in the
  new warning registry. The exception and its reason are in 15.9; it is not repeated in a later 1.x.
- **Reasons (7.1, 7.2.3, 7.6, D21).** `error.reason`, an optional sub-reason registered under its code in
  `reasons: [{reason, meaning, fix}]`; reserved reason names for `INPUT_INVALID`, `INPUT_TOO_LARGE` and
  `CURSOR_INVALID`.
- **Warning registry (7.5, D22).** `schema --warnings` and `schema --warning <CODE>`, entries `{code, meaning,
  fix}`; new `data.kind` values `warnings` and `warning`; `schema/warning-entry.schema.json`.
- **Field paths (6.10, D23).** Bracketed keys for member names that are not identifiers
  (`attributes["http.status-code"]`); keys of a declared map are selectable.
- **New SHOULD and MAY rules (D25).** An L0 tool SHOULD offer `schema --errors` (7.3.4), and the checker compares it
  with the fixture (17.3); tool-wide options SHOULD be accepted after group words (9.13); a write whose failure
  point cannot be shown to precede the work MAY report it with its during-the-work code (8.3.1).
- **Clarifications (D26).** `USAGE` SHOULD carry `field` (7.1.3); hint forms (7.1.2); text-mode stdout for refusals
  and exit 1 (5.3); `--input` given twice or without a value is `USAGE` (11.2); stage names of precondition and
  during-the-work codes (8.3); a code with two exits is split (7.3.2); a batch report is its own output (6.6);
  signals as a wait status or a launcher's 128+n (8.4); a report may keep its own paging members (6.9).
- **Declined (D24).** No per-command member saying whether a command accepts `--json`: `options` already says it.
- **A 1.0 tool is untouched.** The rules that are meanings rather than members apply only to a tool that declares
  1.1: map keys and map cut nodes (6.10), command-line hints (7.1.2), `--input` twice as `USAGE` (11.2); dual
  warning/error registration applies only to a tool with a warning registry (7.5.3). A second synthetic tool,
  `ledger`, stays on 1.0 in the examples to show it.
- **Callers keep what they understand.** A caller leaves out an argument, output, tree entry or batch item of an
  unknown variant, drops the completeness rules its view can then no longer meet, and never rejects a document for
  what it left out; a listed member that is not a string is still a wrong type (15.6, 15.8, D28).
- **Every listed value has a caller treatment.** One table in 15.6 covers every string member whose values the
  contract lists (kinds, effect, idempotency, level, valueType, constraint rule, input option, domain keywords and
  types, output kind, batch status, stream line type): leave it out, use the most cautious known value, the part is
  unusable, or (another major) refuse. `scripts/check.ts` fails when a schema lists values without a row (D29).
- **Map keys with NUL** are not selectable, since argv cannot carry them (6.10, D28).
- **Examples and validator.** The synthetic tool `acme` now declares 1.1: registry reasons, a warning registry,
  map and escaped field paths. `examples/caller-*.json` are documents of a later minor that a caller must read;
  `scripts/check.ts` validates them against the schemas read open and checks every tool document against the
  minor it declares.

## 1.0.0 (2026-10-30)

First version of ATIP, the Agent Terminal Invocation Protocol (`atip/1`): a contract for command-line tools whose
main callers are coding agents, built with Rust/clap or TypeScript/Effect 4 and checked against their built binaries.
A tool claims a conformance level per release: L0 covers output, errors and exits; L1 adds the grammar and the
`schema` self-description; L2 adds whole-command JSON input, destructive-command safety, long-running work,
streams and the guide. The normative text is `spec/atip-1.md`; the JSON Schemas in `schema/` are normative for
every wire shape.

- **Output.** Text by default, one JSON document on stdout with `--json`, nothing on stderr in JSON mode. Neither a
  TTY nor an environment variable changes the output kind.
- **Envelope.** `{ok, data, meta}` on success and `{ok, error, meta}` on failure, in camelCase with no `null`
  members. `meta` names the contract, tool, version, command and output, plus paging (`--limit`, `--cursor`,
  `meta.page`), field selection (`--fields`, with projection that always validates) and literal `next` steps.
- **Errors.** Each error has a `code` (UPPER_SNAKE), a `message` and `retryable`, and may add `hint`, `field`,
  `expected`, `received`, `suggestions` and `details`. Every tool has one registry
  `{code, exit, retryable, meaning, fix}`, and twelve codes are reserved for situations every tool shares.
- **Exits.** 0 is success. 1 means the command ran and its answer is negative or incomplete. 2 means the command
  refused to run, and a refusal changes nothing. A code's exit lives only in the registry.
- **Grammar.** Noun-verb paths, no runnable groups, the primary object as an operand, other ids as bare-noun options
  (`--change`), a fixed argv syntax (`--name=value`, `--`), reserved option names, and no aliases across a cutover.
- **Self-description.** `<tool> schema [path...] --json` answers with a tree, group, command, errors or error
  document. It works with no repository, configuration, network or state. A command document gives typed operands
  and options (`valueType`, typed defaults, interoperable `domain`s, I-Regexp patterns that read the same in
  ECMAScript and Rust), constraints between arguments, stateless validators with witnesses, error codes, output
  and event schemas, and runnable examples.
- **Numbers.** Integers lie within ±(2^53-1) and are never rounded; `number` is binary64.
- **JSON input.** `--input <JSON|FILE|->` carries one command's arguments, or a batch where a command declares it.
  It is processed in a fixed order: read, fragment validation, conflict check against argv, merge, defaults, then
  validation of the argument object with no state read. Errors point at the document with JSON pointers.
- **Batches.** A batch runs every state-free check first, then executes item by item. If it stops part-way, the
  failure is `BATCH_INCOMPLETE` with a per-item report.
- **Destructive commands.** They preview by default, act only with `--commit --plan-digest <DIGEST>`, and refuse a
  stale plan with `PLAN_STALE`. Previews and refusals write nothing, logs and telemetry included.
- **Long-running work and streams.** An `async` command's exit 0 means the work was accepted, not done. Operation
  keys (`--operation`) make repeats safe, including when the first attempt's outcome is unknown. Streams are NDJSON
  with `start`, `event` and `end` lines.
- **Guide.** The guide ships in the binary: `<tool> skills show [NAME]`.
- **Versioning.** A change that breaks a conforming tool or caller is `atip/2`. A 1.x only clarifies text, corrects
  examples and checks, or adds examples (spec 15.1).
- **Conformance.** A shared black-box checker (`approaches/checker.md`) runs each level's MUST checks against a
  built binary. The obligations the checker cannot see from outside belong to the tool's own tests.
  `scripts/validate.sh` checks the examples, the rules beyond JSON Schema and the cross-engine pattern record.
