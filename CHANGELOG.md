# Changelog

## 1.1.0 (release candidate)

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
