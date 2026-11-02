# ATIP: Agent Terminal Invocation Protocol (`atip/1`)

Status: **1.2.0** (release candidate). Version 1.1.2 was adopted 2026-11-01 after two rounds of independent review.
1.2.0 is a minor (15.1) from implementer feedback: for a document that declares 1.2 it states which arguments bind a
cursor, accepts `--fields` without `--json`, makes the paging and field-selection options flag-only and fixes the
order of the stateless checks, and it reserves `STOPPED_MIDWAY` for work stopped part-way (Appendix A D32, D33); it
also carries wording and checker rows a patch could carry (D34). 1.1.1 and 1.1.2 were patches (D30, D31). Version
1.0.0 was adopted 2026-10-30 after six rounds and 1.1.0 on 2026-11-01 after four; 1.1.0 added optional members and
SHOULD/MAY rules and fixed how the contract is versioned (15, Appendix A D20-D29). Until revision 2 this contract
was called `agent-cli/1`; it was renamed by owner decision 2026-10-28 (Appendix A, D13).

## Abstract

ATIP (contract identifier `atip/1`) is a contract for command-line tools whose main callers are coding agents and
scripts, and whose
second audience is people at a terminal. It fixes what a caller can rely on without reading the tool's source:
how output is selected, the JSON envelope, errors and their registry, exit codes, the command grammar and argv
syntax, a machine-readable self-description, whole-command JSON input, the preview/commit protocol for
destructive commands, long-running work and streams, and the guide shipped inside the binary. It is written for
tools built with Rust and clap and with TypeScript and Effect 4, but nothing in it depends on either.

## Contents

1. Scope
2. Terms and notation
3. Conformance levels
4. Output selection
5. Output streams
6. Envelope and meta
7. Errors, warnings and the registries
8. Exit codes
9. Grammar, naming and argv syntax
10. Self-description: `schema`
11. JSON input: `--input`
12. Effects and destructive safety
13. Long-running work and streams
14. Guides: `skills show`
15. Versioning
16. Security
17. Checking conformance
18. Open questions

Appendix A: decisions. Appendix B: prior art.

---

## 1. Scope

1.1. This document specifies the externally observable behaviour of a conforming tool: its argv, stdout, stderr
and exit status, and the JSON documents it prints. It does not specify how a tool is built; `approaches/`
describes recommended implementations and is not normative.

1.2. It covers invocations that print a report, an artifact or a stream and exit. Servers started by a command
(`serve`, an MCP server) are out of scope except that the starting command declares its output (10.9) and its
side effects (10.5 `effectNote`).

1.3. The JSON Schemas in `schema/` are normative for wire shapes. Rules that JSON Schema cannot express (a value
that must equal another member, a reference that must resolve) are listed in 10.13 and are equally normative.
Where prose and a schema disagree, the schema wins for shape and the prose wins for behaviour; a disagreement is a
bug in this document.

1.4. Motivation. Agent-facing command-line tools, and the general-purpose CLIs agents already call, solve the same
problems in different ways: different envelope shapes, error shapes and default output formats, different ways to
authorise a destructive act, different self-description formats or none. An agent that learns one tool learns
nothing reusable about the next. The contract makes that knowledge transfer.

1.5. Conformance is stated as "ATIP 1.2 L1 conformant" (contract minor, then level L0, L1 or L2) for a tool and a
release (3.4, 15.7).

1.6. **Non-goals and related work.** ATIP is not a general CLI description format and does not align with or
export to OpenCLI (opencli.org): no consumer of OpenCLI documents exists for the tools ATIP was written for, and
OpenCLI v0.1 has none of ATIP's execution semantics (registry, effects, input merge, plan fencing, streams)
(Appendix A, D14).

## 2. Terms and notation

2.1. The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED,
MAY and OPTIONAL are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they
appear in all capitals.

2.2. Terms.

| Term | Meaning |
|---|---|
| tool | One executable that claims conformance (`canon`, `lute`). |
| command | A runnable node of the command tree, named by its **path** (`["finding","close"]`) and its **id**, the path words joined by one space (`finding close`). |
| group | A node that only groups commands (`finding`). |
| operand | A positional argument. |
| option | A named argument, `--name` or `--name <VALUE>`. |
| switch | An option that takes no value. |
| argument | An operand or an option, however given (argv, `--input`). |
| report | A JSON document printed inside the envelope (`data`). |
| artifact | Bytes printed as they are (Markdown, CSV) in text mode. |
| stream | Output produced over time (13.5). |
| registry | The tool's table of error and warning codes with their exit, retryability, meaning and fix. |
| JSON mode | The invocation contains `--json` (4.4). |
| effect | A change the command makes to state the tool or its user owns: files, records, remote objects, processes. |
| refusal | A failure with exit 2 (8.1). |
| caller | The agent, script or person running the tool. |

2.3. JSON member names in prose are written `like.this`; `data.kind` means the member `kind` of the member `data`.
Placeholders are written `<LIKE_THIS>`. JSON pointers are RFC 6901.

2.4. Decisions. A rule fixed by an owner decision cites it as `[Appendix A D<n>]`. Appendix B lists the prior art
the contract learned from.

## 3. Conformance levels

3.1. A tool conforms at one of three cumulative levels.

| Level | Adds | Sections |
|---|---|---|
| **L0** | Output selection, streams, envelope, errors and registry, exit codes, versioning, security | 4.1-4.6, 5, 6, 7, 8, 15, 16 |
| **L1** | Grammar, argv syntax and the `schema` self-description, with report schemas | 4.7, 9, 10 (10.11 OPTIONAL) |
| **L2** | `--input`, destructive safety, long-running work and streams, the embedded guide | 4.8, 11, 12, 13, 14 |

3.2. **No upward requirements.** A rule of a level never requires a feature of a higher level, in prose, in the
schemas or in the checker. Where a section of a lower level mentions a higher-level feature, the mention applies
only to tools that offer that feature. In particular: an L0 tool need not have `schema`; an L1 tool need not have
`--input`, preview/commit or `skills show`; the self-description schema accepts a destructive command without
`--commit` (that requirement is L2, 12.4, checked by the L2 checker).

3.3. A tool MAY offer features of a higher level than it claims. A feature it offers MUST follow this document
(an L1 tool with `--input` follows section 11).

3.4. **Declaration.** A tool at L1 or L2 declares its level as `data.level` of its `schema` tree (10.3). An L0
tool has no machine declaration beyond `meta.contract` (6.6); its level is configured in the checker (17). The
contract minor a tool implements is declared by `meta.contractVersion` (15.7) at every level.

3.5. A tool MUST NOT claim a level whose MUST-level checks it does not pass (17).

3.6. **Exceptions are declared, not silent.** A command that cannot follow a rule (a passthrough to a child
process, a hook whose stdin format another program owns) MUST declare the exception in its self-description:
its output kind (10.9) and its `effectNote` (10.5). There is no other exception mechanism.

## 4. Output selection

4.1. **Text is the default.** Without `--json`, a command prints text meant for a person. The text is not part of
the contract and MAY change in any release.

4.2. **`--json` selects the contract.** Every command whose outputs (10.9) include a report or an artifact MUST
accept `--json`; with it the command prints exactly one envelope (6) on stdout. For an artifact, `data` is the
artifact's JSON representation, described by that output's `schemaRef` (10.9). A stream command with `--json`
prints the stream protocol of 13.5 (L2).

4.3. **Nothing else switches the output.** The output kind (text, envelope, stream protocol) and the shape of the
JSON document MUST NOT depend on whether stdout or stdin is a terminal, on environment variables (`CI`,
`CLAUDECODE`, `OUTPUT_FORMAT`) or on configuration files. The same argv gives the same output kind everywhere.
This governs presentation only: what a command reports MAY change when its declared inputs change, including an
option's declared `env` variable, its context discovery and the configuration and state it reads (6.7, 11.7
step 5). Text styling (colour, terminal width) MAY follow `NO_COLOR`, `TERM` and whether stdout is a terminal;
the JSON document MUST NOT. Environment variables never authorise anything (12.8) and never filter `schema`
(10.2.2).

4.4. **JSON mode is decided from argv before parsing.** A tool MUST treat an invocation as JSON mode when the word
`--json` appears in argv before the first `--`, even when parsing then fails, so that an unknown command, an
unknown option or a missing value is reported as a JSON failure envelope.

4.5. `--json` MUST be accepted after the command path, anywhere before `--`. A tool MAY also accept it before the
path. Examples and `next` entries use the portable post-path form. `--json` has no other meaning (9.8).
[Appendix A D11.15]

4.6. `--help`/`-h` and `--version`/`-V` print text and exit 0. A tool MAY answer `--help --json` with the `schema`
document of the same path (L1). `--version` SHOULD print `<tool> <version>` on one line.

4.7. (L1) The first line of the root `--help` MUST point agents at the self-description, for example
`Agents: "canon schema --json" describes every command as JSON.` Every other `--help` SHOULD carry the same line.
An L0 tool MUST NOT point at a `schema` command it does not have.

4.8. (L2) The same line MUST also name the guide (`"canon skills show" is the guide.`).

## 5. Output streams

5.1. In JSON mode, stdout MUST hold exactly one JSON document followed by one newline, and nothing else, for
success and for failure. The only exception is a stream command's protocol (13.5), whose lines are each one JSON
document.

5.2. In JSON mode, stderr MUST NOT carry the result or the error, and SHOULD be empty. A long-running command MAY
write progress or heartbeat lines to stderr. Callers MUST NOT parse stderr.

5.3. In text mode, stdout holds only the result; errors, warnings and progress go to stderr. A refusal (exit 2)
prints nothing on stdout. A command that ran and exits 1 MAY print its result, partial or negative (the findings of
a check), on stdout, with the error on stderr. This sentence is a relaxation added in 1.1, not a reading of 1.0,
which said that a failure prints nothing on stdout; a tool that still prints nothing conforms, and 15.9 lists the
change for callers. [Appendix A D26]

5.4. The JSON document SHOULD be compact (no indentation). It MUST be UTF-8.

5.5. A tool MUST NOT prompt. If a value is missing the command refuses. Nothing reads stdin except `--input -`
(11.2) and options that declare `-` as a value; stdin is read at most once.

5.6. Failures before the tool's own code runs (a runtime that cannot load a module, an out-of-memory kill) cannot
always be enveloped. A tool MUST make them exit non-zero and SHOULD keep stdout empty. A failure that reaches the
tool's code MUST be enveloped in JSON mode.

## 6. Envelope and meta

Normative shape: `schema/envelope.schema.json`.

6.1. Success is `{"ok": true, "data": <report>, "meta": {…}}`. Failure is `{"ok": false, "error": {…}, "meta": {…}}`,
with `data` OPTIONAL (6.4). No other top-level members are allowed. [Appendix A D1]

6.2. `ok` MUST be `true` exactly when the exit status is 0.

6.3. Keys of the envelope, of `meta`, of `error` and of reports are camelCase. A report MAY embed a stored record
verbatim with that record's own key case; the report's JSON Schema shows where. Callers MUST NOT assume keys are
camelCase below such a record. [Appendix A D1]

6.4. On failure, `data` MAY carry the partial report of a command that ran: the findings of a failed check, the
batch report of a batch that stopped (11.11). A refusal (exit 2) MUST NOT carry `data`. When present, `data`
follows one of the command's output schemas, named by `meta.output` (6.6).

6.5. Optional members of the envelope, of `meta` and of `error` are omitted when absent, never `null`. Inside
`data`, the report's schema decides.

6.6. `meta` members. No others are allowed; tool-specific metadata goes under `x-<tool>` (10.12).

| Member | | Meaning |
|---|---|---|
| `schemaVersion` | REQUIRED | `<major>.<minor>` of the output `data` follows (6.11). On a `schema` answer, the version of the self-description format (10.1.4). |
| `tool` | REQUIRED | The executable name. |
| `toolVersion` | REQUIRED | The tool release. Never part of `schemaVersion`. |
| `command` | REQUIRED when resolved | The id of the command, or the longest path resolved before the failure (`finding` when the verb is unknown). Omitted when not even the first word resolved. |
| `contract` | REQUIRED on `schema` answers and, for a tool that declares 1.1 or later (15.7), on every envelope; SHOULD elsewhere | `"atip/1"`. [Appendix A D11.12, D20] |
| `contractVersion` | REQUIRED with `contract` for a tool that implements 1.1 or later (15.7); absent otherwise | The contract version the tool implements, `<major>.<minor>` (`"1.2"`). Absent means `"1.0"`. Since 1.1. [Appendix A D20] |
| `output` | REQUIRED when `data` is present and the command declares more than one output; OPTIONAL otherwise | The name of the output schema `data` follows (the key in the command's `schemas`, 10.9), so a caller can pick the decoder without inferring it. Each output of a command has its own `schemaRef`, so the name identifies exactly one output. The batch report of a batch input (11.11) is an output of its own, with its own name, even when every item yields the same report type. [Appendix A D12.1, D26] |
| `context` | OPTIONAL | 6.7. |
| `next` | OPTIONAL | 6.8. |
| `warnings` | OPTIONAL | 7.5. |
| `coverage` | OPTIONAL | What a check or listing examined (8.5). |
| `page` | REQUIRED on a paged answer (6.9) | `{returned, nextCursor?, total?}`. |
| `fields` | REQUIRED on a projected answer (6.10) | The field paths `data` was projected to. |
| `truncated` | REQUIRED on a cut answer (6.9) | `{path, kept, total?, bytes?, maxBytes?}`. |
| `x-<tool>` | OPTIONAL | Tool-specific. |

6.7. **Context.** `meta.context` reports the context the command resolved, so a caller can repeat it explicitly.
Its keys are the camelCase names of the options that select context (`repo`, `project`, `run`); each value is the
value the command used, whether given or resolved; paths are relative to the working directory; a key whose
context was not used is omitted, never null. Precedence for a context option, as for every option (11.7 step 5):
an explicit value (argv or `--input`) wins over its environment variable, which wins over discovery or the
default; a value given explicitly is never replaced by a discovered one. [Appendix A D11.4]

6.8. **Next steps.** `meta.next` lists runnable follow-up commands, best first, on success and on failure:
`[{command, argv, reason?, x-<tool>?}]`. `argv` is the invocation as argument words **without** the executable.
`command` is the same invocation as one display string: splitting it as a POSIX shell would (without expansion)
MUST give back exactly the tool name followed by `argv`. A tool SHOULD write it as the tool name and the words of
`argv` joined by single spaces, each word that is empty or contains whitespace, a quote, a backslash or a shell
metacharacter written in single quotes (a single quote inside as `'\''`). Every word of `argv` is literal: no
placeholder, no ellipsis, nothing the
caller fills in. When the current invocation is in JSON mode and the next command accepts `--json`, its `argv`
MUST include `--json`. Transport-specific members (an RPC transport's own `operation` or `input` keys) go under `x-<tool>`. A step that
needs a value the tool does not have is not a `next` entry (see `hint`, 7.1). [Appendix A D11.6]

6.9. **Paging and truncation.** A command that pages takes the reserved options `--limit <N>`, `--cursor <CURSOR>`
and `--all` (9.8). A paged answer carries `meta.page`: `returned` (items in this answer), `nextCursor` (opaque,
present exactly when more items follow) and `total` (when known). When `nextCursor` is present, `meta.next` MUST
contain an entry for the next page: the same invocation with `--cursor <nextCursor>` (at any position in `next`). A
cursor is bound to the arguments of the invocation that produced it, except `--limit`, `--cursor` and `--fields`:
given with different arguments, or not produced by this command, it refuses with `CURSOR_INVALID` (exit 2, 7.2.1),
so changing a filter can never skip or repeat records silently. **Since 1.2**, in a tool that declares 1.2:

- The exceptions are exactly the reserved options that never change the result set: `--json`, `--limit`, `--all`,
  `--cursor` and `--fields`.
- An argument given explicitly with its default value is given (10.8.1): adding or removing it changes the
  arguments, as changing its value does. A switch given `false` and a count given `0` are not given, since they are
  the same as absent (10.7.2).
- A value taken from an option's `env` variable (11.7 step 5) is bound too, though it is not given: setting,
  changing or unsetting the variable changes the arguments, and so does giving the option explicitly instead.
- The next-page entry carries exactly the arguments the invocation gave explicitly, normalised, plus
  `--cursor <nextCursor>`: as argv options or one inline `--input` word when they came from `--input -` or a file
  (12.5), never a value filled in from a default or an environment variable. Run in the same environment, it
  continues.

A tool that declares 1.1 or 1.0 keeps the binding of the first sentence (15.10). A caller pages with the `next`
entry's arguments, in the same environment, changing at most `--limit` and `--fields`, and `--all` with a tool that
declares 1.2. A report MAY also keep paging members of its own in `data` (a cursor in the report's schema from
before the tool adopted ATIP); `meta.page` is the contract's paging and is authoritative when the two differ. An
answer cut by size (not by paging) carries `meta.truncated`: `path` (JSON pointer of the list or value cut), `kept`,
and `total`, `bytes`, `maxBytes` when known, plus a `next` entry that reaches the rest. [Appendix A D11.5, D16.1,
D26, D31, D32]

6.10. **Field selection.** A command whose output declares `fields` (10.9) takes the reserved option
`--fields <FIELDS>`: a comma-separated list of field paths from that declaration. A field path is a dot path into
a record (`profile.name`); `name[]` descends into each element of the array `name` (`tags[]`, `owners[].email`).
A path goes through an array only with `[]`: `owners.email` is not a path when `owners` is an array. A last segment
without `[]` may name a whole array (`owners`). The records are the values at `fields.records`, an RFC 6901 pointer
into `data` decoded as RFC 6901 says (`~1` is `/`, `~0` is `~`). The pointer goes through object members only.
When the value there is an array, each element is a record.

**Escaped keys** (since 1.1). A member whose name is not an identifier (`[A-Za-z_][A-Za-z0-9_]*`), such as an
attribute key `http.status-code`, is written as a bracketed JSON string instead of `.name`: `["http.status-code"]`.
Inside the quotes only `\"` and `\\` are escapes; every other character except U+0000, control characters included,
stands for itself, and the quotes may enclose nothing (`attributes[""]` selects the key that is the empty string).
This is the grammar of the bracketed key, not JSON's: `\n`, `\u0041` and the other JSON escapes are not escapes
here. A path may start with a bracketed key, and a bracketed key may be followed by `[]` and by further steps:
`attributes["http.status-code"]`, `["x.y"].value`. A member whose name is an identifier is always written with a
dot, never in brackets, so each member has exactly one spelling and `meta.fields` can be compared as text. Paths
without brackets mean what they meant in 1.0. In the `--fields` value, commas inside a bracketed key do not separate
paths.

**Map keys** (since 1.1, for a document that declares 1.1 or later). A declared path whose schema is a *map*, an
object schema whose `additionalProperties` is a schema (`true` included) and whose `properties` is absent or empty,
also makes each of its keys selectable, except a key that contains U+0000, which no argv element can carry (9.12)
and which is reached only by selecting the whole map: `attributes.region`, `attributes["http.status-code"]` or
`attributes[""]` when `attributes` is declared. The map is the schema the declared path itself names: `labels`
declared as an array of maps names the array, so its keys are selected through `labels[]` (`labels[].region`), never
`labels.region`. Such a path selects the whole value under that key and goes no deeper. A key the record does not
have is simply absent from the projection. The map's schema is then a cut node. In a command document that declares
1.0, a declared map is a member kept whole, exactly as in 1.0: its keys are not selectable and its schema is not a
cut node, so a 1.0 tool's map may keep keywords such as `minProperties` (rule 16).

**Projection.** For each record:

1. The kept paths are the selected paths plus the declaration's `keep` paths.
2. A kept path *covers* a member when the member's path equals it or extends it. A member is present in the
   projection exactly when a kept path covers it, or when it is a proper ancestor of a kept path. A covered member
   is kept whole, even if another kept path names one of its descendants (selecting `profile` and `profile.name`
   keeps all of `profile`).
3. An ancestor that is not covered keeps only its members that are present by rule 2; an array on the way keeps
   every element, each projected the same way; a `null` ancestor stays `null`.
4. A present member appears whenever the unprojected record has it; a member that is not present is absent.
5. `meta.fields` lists the kept paths.
6. An unknown path refuses with `USAGE`, `field` `--fields`, `expected` the selectable paths.

**Projected schema.** The *cut nodes* of an output are the schemas on the path from the output's root schema (the
one `schemaRef` names, the schema of all of `data`) to every selectable field:

- the root schema;
- the schema of each member that `fields.records` goes through, and the schema at `fields.records`;
- the record schema;
- the schema of every member that is a proper ancestor of a declared path (`profile` when `profile.name` is
  declared, `owners` and its items when `owners[].email` is), whether or not that member is itself declared.

Each is reached through `$ref`, a null-admitting union and, for an array, `items`. Projection changes the value of
every cut node and of nothing else. The projected `data` validates against the output schema with one change: in
every object cut node at or below the record, `required` is reduced to the members present by rule 2. Above the
record no member is removed, so `required` there stays as it is. This is the whole rule, so every cut node MUST be
**projectable**:

- it is an object schema, never a boolean schema (`true` or `false`), and it declares `type`. The exceptions are a
  node that is only a `$ref` and a node that is only a null-admitting `anyOf` (see below), each with annotations;
- an object schema has `type` `"object"` (or `["object", "null"]`). Besides annotations (`title`, `description`,
  `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`), it uses only `properties`,
  `required` and `additionalProperties`, the last with any value: projection never adds a member, and a removed
  member was never an additional one;
- an array schema has `type` `"array"` (or `["array", "null"]`). Besides annotations it uses only `items`,
  `minItems` and `maxItems`. It has no `uniqueItems`, because projected elements can become equal;
- nullability is written `type: ["object", "null"]` (or `"array"`), or as `anyOf` with exactly two branches, one of
  them `{"type": "null"}`. The other branch is then the cut node;
- `$ref` resolves to a schema in `schemas`, which is itself checked as a cut node;
- in particular, no cut node, including the root and every node above the records, has `const`, `enum`,
  `minProperties`, `maxProperties`, `dependentRequired`, `dependentSchemas`, `patternProperties`,
  `propertyNames`, `unevaluatedProperties`, `if`/`then`/`else`, `oneOf`, `allOf`, `not` or `contains`. Each of
  these can reject a projection of a valid value. A `const` of the whole report on the root, or an `allOf` on the
  root that requires `members[].name`, would reject the projection `--fields profile.name` of a valid report.

Every other schema is unrestricted: a leaf, a member kept whole, or a member outside every declared path. A
`const` or `enum` on such a member is allowed, including an `enum` of objects on a member that is selected whole.

Under these rules, a projection of a value that validates against the output schema always validates against the
projected schema. The argument is by induction from the leaves to the root. A node that is not a cut node keeps
its value. An object cut node constrains its value only through its type, the schemas of its declared members,
`additionalProperties` (which applies to members projection never adds) and `required`. Projection only removes
members, and below the record `required` no longer lists them; above the record it removes none. An array cut node
constrains only its type, its items and its length, and projection keeps the length. (10.13 rule 11.)
[Appendix A D11.5, D16.2]

**Answers of more than one shape.** Selection is declared per output: each `outputs` entry has its own `fields` and
`when` (10.9.1). A command whose answer takes one of two shapes can declare two report outputs, each with its own
`fields`, and `--fields` is read against the output the invocation selects. A single output whose root or record
schema is a union (a `oneOf`, or an `anyOf` other than the two-branch nullable form above) has no projectable cut
node there, so it declares no `fields` and takes no `--fields`. A batch input selects the batch output (11.11), so
`--fields` on argv is read against that output's `fields` and refuses with `USAGE`, `field` `--fields`, when it
declares none. Those are paths into the batch report, so a single-item `--fields` value does not carry over, and a
batch schema written as `allOf` `schema/batch-report.schema.json` (the form that schema describes) has no
projectable root, so such a batch output declares no `fields`. [Appendix A D30, D31]

**With or without `--json`** (since 1.2). In a tool that declares 1.2, a command that takes `--fields` parses and
validates it the same way with or without `--json` (an unknown path refuses with `USAGE` in both modes), because
parsing does not depend on the output mode (4.3). What the selection does to text is the tool's: text is not part
of the contract (4.1), and leaving text unprojected is not ignoring an option (9.9). A tool that declares 1.1 or
1.0 may still refuse `--fields` without `--json`. [Appendix A D32]

6.11. **Version of `data`.** `meta.schemaVersion` is the version of the output `data` follows (the one `meta.output`
names when there are several). On a failure without `data`, it is the version of the output the invocation would
have produced: the batch output for a batch input (11.11), otherwise the command's first output without `batch`. Before a
command is resolved it is `"1.0"`.

## 7. Errors, warnings and the registries

Normative shapes: `schema/error.schema.json`, `schema/registry-entry.schema.json`, `schema/warning-entry.schema.json`.

### 7.1. The error object

7.1.1. `error` has REQUIRED `code`, `message`, `retryable`, and OPTIONAL `reason`, `hint`, `field`, `expected`,
`received`, `suggestions`, `details`, `x-<tool>`. [Appendix A D2, D21]

| Member | Meaning |
|---|---|
| `code` | UPPER_SNAKE_CASE, registered (7.3). Callers branch on it. |
| `reason` | Since 1.1. UPPER_SNAKE_CASE: which of the situations registered under `code` this is (7.6). Callers MAY branch on `code` and `reason` together; a caller that does not know the reason treats the error by its code alone. |
| `message` | One sentence for a person. Not stable; callers MUST NOT parse it. |
| `retryable` | `true` only when repeating the same invocation unchanged can succeed (busy, timeout, unavailable backend). Equal to the registry's. |
| `hint` | Advice for the next attempt, in exactly one of three forms (7.1.2). Callers MUST NOT run a hint without checking it for placeholders; a literal runnable command belongs in `meta.next` (6.8). |
| `field` | The argument at fault: the option as written on argv (`--round`), an operand's value name (`CHANGE_ID`), `command` for a command word, `--input` for the input value as a whole, or a JSON pointer into the `--input` document when the value came from it (11.8). |
| `expected` | The valid set, when there is one. |
| `received` | What was given, redacted when it may hold a secret (16.1). Never null. |
| `suggestions` | Close matches from `expected`, best first. Omitted when empty. |
| `details` | Only when one input yields several errors. Each item has `code`, `message` and the optional members above except `retryable` and `details`; the top-level `code` summarises. |

7.1.2. **Hint forms.** A `hint` is exactly one of: a runnable invocation; a command template whose missing values
are `<UPPER_CASE>` placeholders; or one sentence of prose. In a document that declares 1.1 or later, a hint that
starts with the tool name followed by a space is an invocation or a template: it splits as a POSIX shell would, like
`meta.next[].command` (6.8), and holds nothing but that command line, so a caller can tell the forms apart; such a
tool words a prose hint so that it does not start with the tool name and a space, and prose that explains a command
belongs in `message`. In a document that declares 1.0 a prose hint may start with the tool name, as 1.0 allowed, and
a caller does not read such a hint as a command. [Appendix A D26]

7.1.3. **`USAGE` names the argument.** A `USAGE` error SHOULD carry `field`. When the tool cannot map the problem
to an argument (a backend rejects a request built from several arguments and does not say which), it omits
`field`, and its `hint` SHOULD be `<tool> schema <command> --json` for the command that was run, or that command's
`--help` when the tool has no `schema`; when no command was resolved, `<tool> schema --json` (or `<tool> --help`).
[Appendix A D26]

### 7.2. Reserved codes

7.2.1. These situations occur in every tool. A tool MUST use these codes for them, and MUST register each one whose
situation the tool can produce (a tool without `--input` does not register the `INPUT_*` codes). There are twelve
reserved codes, and since 1.2 a thirteenth, `STOPPED_MIDWAY` (8.3.2). For that one the first sentence is a SHOULD,
for a tool that declares 1.2: a tool that keeps a code of its own for the situation stays conforming, and a tool
that registers `STOPPED_MIDWAY` while declaring 1.2 gives it the reserved exit, retryability and meaning, which hold
only in a document that declares 1.2 (8.3.2). A command that offers a feature lists that feature's codes in its
`errors` (10.5), so a checker can tell from the self-description alone that they are registered: `--input` gives the
three `INPUT_*` codes, `input.batch` gives `BATCH_INCOMPLETE`, `--commit` gives `PLAN_STALE`, `--operation` gives
`OPERATION_REUSED`, and `--cursor` gives `CURSOR_INVALID` (10.13 rule 4). `UNVERIFIABLE` has no such marker in the
self-description, and neither has `STOPPED_MIDWAY`: a command that can produce one lists it like any other code.
[Appendix A D11.9, D11.10, D12.2, D16.1, D33]

| Code | Exit | Retryable | When | Applies |
|---|---|---|---|---|
| `USAGE` | 2 | no | The command line does not parse or does not satisfy the command's requirements: unknown option, missing or invalid value, unexpected operand, a violated constraint (10.8) without a more specific code. `field` names the argument. | L0 |
| `UNKNOWN_COMMAND` | 2 | no | A command word is not in the tree. `expected` lists the valid words at that level. | L0 |
| `COMMAND_REQUIRED` | 2 | no | A group (or the bare tool) was run without a command. `expected` lists its commands. | L0 |
| `INTERNAL` | 1 | no | A bug in the tool. The message says how to report it. | L0 |
| `UNVERIFIABLE` | 1 | no | A check ran but could examine nothing in its scope, so it cannot report a clean result (8.5). | tools with checks |
| `INPUT_INVALID` | 2 | no | `--input` cannot be read or framed, or a document fails its fragment schema (11.7 steps 1-2). | tools with `--input` |
| `INPUT_CONFLICT` | 2 | no | A document value and an explicit argv argument differ (11.7 step 3). | tools with `--input` |
| `INPUT_TOO_LARGE` | 2 | no | `--input` exceeds `input.maxBytes`, or a batch exceeds `input.maxItems`. | tools with `--input` |
| `BATCH_INCOMPLETE` | 1 | no | A batch stopped during execution (11.11). | tools with batches |
| `PLAN_STALE` | 2 | no | `--plan-digest` no longer matches the recomputed plan (12.7). | tools with destructive commands |
| `OPERATION_REUSED` | 2 | no | An operation key (13.4) was used before with a different payload. | tools with `--operation` |
| `CURSOR_INVALID` | 2 | no | A `--cursor` was not produced by this command, or was produced with other arguments (6.9). `field` is `--cursor`. | tools with `--cursor` |
| `STOPPED_MIDWAY` | 1 | no | Since 1.2. A command that works in steps stopped after a step made effects, because a later step met what the command refuses before its work; `reason` names that refusal's code (8.3.2). | tools that declare 1.2 (SHOULD) |

7.2.2. A tool MAY register finer codes for parse failures (`UNKNOWN_OPTION`, `OPTION_REQUIRED`) only if it never
emits `USAGE` for the same situation; one situation has one code within a tool. Callers treat any exit-2 code whose
`field` names an argument as a usage problem. Under every other reserved code a tool tells situations apart with
registered reasons (7.6), never with finer codes, so that a caller branching on the reserved code still sees it.

7.2.3. **Reserved reasons** (since 1.1). When a tool registers a reason (7.6) for one of these situations under a
reserved code, it SHOULD use the name given here, so that callers can branch on it across tools. A tool MAY
register other reasons under a reserved code for situations this table does not name. [Appendix A D21]

| Code | Reason | Situation |
|---|---|---|
| `INPUT_INVALID` | `UNREADABLE` | The file named by `--input` cannot be read. |
| `INPUT_INVALID` | `STDIN_TTY` | `--input -` with stdin attached to a terminal (11.3). |
| `INPUT_INVALID` | `EMPTY` | The value or the source is empty (11.2). |
| `INPUT_INVALID` | `NOT_JSON` | The source is not JSON, nor NDJSON where that is allowed (11.4). |
| `INPUT_INVALID` | `NOT_OBJECT` | A document, or an item of a batch, is not a JSON object (11.4, 11.5). |
| `INPUT_INVALID` | `BATCH_UNSUPPORTED` | A batch for a command whose `input.batch` is not `true` (11.4). |
| `INPUT_INVALID` | `UNKNOWN_KEY` | A document key that is not a document key of the command (11.5). |
| `INPUT_INVALID` | `FLAG_ONLY_KEY` | A document key that names a flag-only option (11.6). |
| `INPUT_INVALID` | `INVALID_VALUE` | A value of the wrong type, outside its enum, or `null` (11.5, 11.7 step 2). |
| `INPUT_TOO_LARGE` | `TOO_MANY_BYTES` | The source exceeds `input.maxBytes`. |
| `INPUT_TOO_LARGE` | `TOO_MANY_ITEMS` | A batch exceeds `input.maxItems`. |
| `CURSOR_INVALID` | `FOREIGN` | The cursor was not produced by this command, or is not a cursor. |
| `CURSOR_INVALID` | `ARGUMENTS_CHANGED` | The cursor was produced with other arguments (6.9). |
| `CURSOR_INVALID` | `EXPIRED` | The cursor was produced by this command with these arguments but is no longer valid. |
| `STOPPED_MIDWAY` | `PLAN_STALE` | A commit detected, after it made some of the effects, that the plan changed (12.7, 8.3.2). Since 1.2. |

### 7.3. The registry

7.3.1. Every tool has one error registry: entries `{code, exit, retryable, meaning, fix}`, plus OPTIONAL
`reasons` (7.6, since 1.1). Every code the tool can emit as an error MUST be in it; a code emitted as a warning is
registered as 7.5 says. A code MUST NOT be reused with another meaning. `fix` is prose and MAY contain
`<PLACEHOLDER>`s. [Appendix A D2]

7.3.2. The exit status of a failure is the `exit` of its code. It MUST NOT be overridden at a call site. A
situation that needs another exit needs another code (8.3): a code that would need two exits is split into two
registered codes, never kept as one code with a per-call-site exit, and a reason (7.6) never changes the exit.
[Appendix A D11.8, D15, D26]

7.3.3. `retryable` in an error MUST equal the registry entry's.

7.3.4. (L1) The registry is printed by `<tool> schema --errors --json` (`data.kind: "errors"`) and one entry by
`<tool> schema --error <CODE> --json` (`data.kind: "error"`). An unknown code refuses with `USAGE`, `field`
`--error`. A code that is registered only in the warning registry (7.5) refuses the same way, with the `hint`
`<tool> schema --warning <CODE> --json` naming that code. An L0 tool SHOULD offer `schema --errors --json` and
`schema --error <CODE> --json` (3.3): they are what lets a caller, and the checker (17), see the registry the
tool really uses. A tool that keeps a warning registry (7.5.2) offers `schema --warnings` and `--warning` with
them. When it offers them, they follow this paragraph and 7.5.2. [Appendix A D25]

### 7.4. Errors in text mode

7.4.1. In text mode an error is printed on stderr, never on stdout (5.3). The RECOMMENDED form is:

```
<tool>: <CODE>: <message>
  field: <field>
  expected: <a>, <b>, <c>
  hint: <hint>
```

with absent members left out.

### 7.5. Warnings

7.5.1. `meta.warnings` is `[{code, message, field?}]`. Every code emitted as a warning MUST be registered, in the
warning registry (7.5.2) or, as 1.0 required, in the error registry. A warning code's registry `exit` applies only
if the same situation is ever reported as the error, never to a success that carries the warning.
[Appendix A D11.16]

7.5.2. **The warning registry** (since 1.1). A tool MAY keep its warning codes in a registry of their own: entries
`{code, meaning, fix}`, with no `exit` and no `retryable`, printed by `<tool> schema --warnings --json` (`data.kind:
"warnings"`) and one entry by `<tool> schema --warning <CODE> --json` (`data.kind: "warning"`). An unknown code
refuses with `USAGE`, `field` `--warning`. A tool that implements 1.1 or later SHOULD register every warning code
there; a warning registered only in the error registry with `exit: 1`, as in 1.0, stays valid. [Appendix A D22]

7.5.3. A tool that keeps a warning registry registers a situation that it reports as a warning in some
invocations and as an error in others in both registries, under the same code, with the same meaning. A tool
without a warning registry registers such a code once, in the error registry, as 1.0 allowed. A caller that looks
up a warning code reads the warning registry first, when the tool has one, and falls back to the error registry.

### 7.6. Reasons

7.6.1. A registry entry MAY list `reasons`: `[{reason, meaning, fix}]`, the situations under its code that need
different next actions (the source is not JSON, or the shell removed the document's quotes). A reason is
UPPER_SNAKE_CASE and unique within its code; the same name under another code is another reason.

7.6.2. An error carries `reason` only when that reason is registered under the error's `code`; a tool never emits
a reason outside its registry. The same holds for each item of `details`. A reason shares its code's `exit` and
`retryable`. An error without `reason` is still complete: a reason refines a code and never replaces it.

7.6.3. Reasons are part of the command surface (15.5): adding one is compatible, removing or renaming one is not.
[Appendix A D21]

## 8. Exit codes

8.1. **The rule.** A command's exit status is one of:

| Exit | Meaning | Examples |
|---|---|---|
| 0 | Success: the command did what was asked. | A destructive preview (12.4); a check that found nothing wrong; accepted asynchronous work (13.2); an empty listing of a scope that was read (8.5). |
| 1 | **The command ran, and its answer is negative or incomplete.** | A check with findings; an `UNVERIFIABLE` check; a wait that timed out or work that ended in failure (13.3); a batch that stopped during execution (11.11); a write that began and could not finish; a command stopped part-way after a step made effects (8.3.2); an internal error. |
| 2 | **The command refused to run.** Nothing changed. | Usage; an unknown command; invalid or conflicting input; a missing context, configuration or prerequisite; a named object or file that does not exist; a stale plan; a backend or login unavailable when the command was to start; a reused operation key. |

[Appendix A D3, D15]

8.2. Exits 1 and 2 always come with a failure envelope in JSON mode; exit 0 always with a success envelope. A
refusal (exit 2) makes no effect at any level: "nothing changed" in 8.1 means the rule of 12.2 for refusals, and
it applies from L0.

8.3. **When a command has run.** A command has *run* once it has passed its preconditions and started its work.
Its preconditions are: parsing argv and `--input` (11.7 steps 1-6), resolving the context and the configuration it
needs (6.7), checking its prerequisites (a backend reachable, a login present), resolving every object the
invocation names (an id, a file, a plan digest), and reserving an operation key (13.4). A failure of a
precondition is a refusal (exit 2) whatever the command's effect class, except as 8.3.1 allows. Anything that goes
wrong after the work started is exit 1. Hence:

- A failure category that can happen both as a precondition and during the work (I/O, an unavailable backend, an
  expired login) has two registered codes, one for each (`STORE_UNAVAILABLE` exit 2, `WRITE_FAILED` exit 1). Names
  SHOULD show the stage: `*_UNAVAILABLE`, `*_UNREACHABLE` or `*_REFUSED` for the precondition code (exit 2) and
  `*_FAILED` for the code of a failure during the work (exit 1). [Appendix A D26]
- A `read` command can exit 1 (a check with findings, an `UNVERIFIABLE` check, a wait that timed out), although it
  makes no effect: exit 1 says the answer is negative or incomplete, not that something changed.
- A batch's preconditions are the batch preflight (11.11: steps 1-6 for every item). Once preflight passed, the
  batch has run: the state-dependent preconditions of each item (an object it names exists) are checked when that
  item's turn comes, and a failure there, at any index including 0, makes the batch exit 1 with `BATCH_INCOMPLETE`
  while the item carries its own exit-2 code (11.11).
- `INTERNAL` is 1.

Callers branch on `code` and `retryable`, never on the exit alone. [Appendix A D11.8, D15]

8.3.1. **Conservative staging** (since 1.1). A `write` or `destructive` command whose failure point the tool cannot
show to be before the work started (the work is a sequence of calls to backends, any of which may be the first to
change something) MAY report that failure with its during-the-work code (exit 1). The reverse is never allowed:
exit 2 still means that nothing changed (8.2), so a tool reports exit 2 only for a failure it knows came before
the work. A `read` command reports its precondition failures as refusals as before. [Appendix A D25]

8.3.2. **Stopped part-way** (since 1.2). A command that does its work in steps (an orchestration of phases, a commit
that makes its effects one at a time) can meet, after an earlier step made effects, a situation it refuses with an
exit-2 code when it meets it before the work: a lease another run holds, a plan that changed between effects (12.7).
It can no longer exit 2 (8.2). A tool that declares 1.2 SHOULD report it with the reserved code `STOPPED_MIDWAY`
(exit 1, not retryable), whose `reason` is the name of that exit-2 code, registered under `STOPPED_MIDWAY` (7.6),
instead of a during-the-work twin of each such code. The refused step's own `reason`, if it had one, is not carried:
`reason` is always the refusal's code by itself, never a compound name, and the message can say more. The reason's
`fix` says what to do once the caller has read what was done, and `meta.next` SHOULD lead with a command that reads
it; repeating the command blindly could repeat the steps that already ran. A failure category that has its own
during-the-work code (`WRITE_FAILED`, 8.3) keeps it. `STOPPED_MIDWAY` is the code of one invocation: a batch item
that stops this way is `failed` with `STOPPED_MIDWAY` as its own error, and the batch is `BATCH_INCOMPLETE` (11.11).
The reserved meaning holds in a document that declares 1.2; in a document that declares 1.1 or 1.0, `STOPPED_MIDWAY`
is a code of the tool's own, and a caller reads it by that tool's registry entry (its `retryable` and `fix`).
[Appendix A D33]

8.4. **Signals.** Termination by a signal is outside this table: no envelope is promised, and signal exits are not
registry entries. It shows either as a wait status that names the signal, or as exit 128+n (130 for SIGINT, 143 for
SIGTERM) when a launcher or wrapper ran the tool and exits on its behalf; a caller and the checker treat both the
same. A launcher SHOULD re-raise the signal or exit 128+n, never another code. A tool SHOULD release what it claimed
before exiting. A tool SHOULD restore the default SIGPIPE behaviour. [Appendix A D26]

8.5. **A check that examined nothing is not clean.** A check or listing that ran (8.3) but could examine nothing
in its scope (the scope holds nothing of the kind the check examines, such as a project with no tests configured;
every target it was to read was unreachable or unreadable) MUST NOT exit 0; it fails with `UNVERIFIABLE` (exit 1)
and SHOULD say in `meta.coverage` what it looked for. A scope that does not exist, or a configuration the command
needs to start that is absent, is a precondition failure: a refusal (exit 2) with its own code (`CONFIG_MISSING`).
A scope that was read and holds zero items is a valid empty answer (exit 0).

8.6. **No other exits.** Exit codes other than 0, 1, 2 and signal exits MUST NOT be used. An incomplete walk or
search is exit 1 with a registered code; a command that applied what was asked and reports what changed is exit 0
with the changes in `data`. [Appendix A D11.1]

8.7. A passthrough command (one that runs a child process and returns its status, such as `exec -- …`)
is an exception and MUST declare it in `effectNote` (3.6).

## 9. Grammar, naming and argv syntax

9.1. **Shape.** A command path is a group noun followed by a verb (`finding close`, `page label`), or one word for a
root command (`schema`, `status`, `init`). Paths SHOULD NOT be longer than two words. Words are lower kebab-case,
`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. [Appendix A D4, D11.14]

9.2. **Groups only group.** A group MUST NOT be runnable. Run bare, it refuses with `COMMAND_REQUIRED` listing its
commands in `expected`. A node is either a group or a command, never both.

9.3. **Actions and modes.** Actions are verbs. Read-only views MAY be nouns (`status`, `context`) and MUST then have
effect `read`. An option MUST NOT change a command's effect class or turn it into a different action with its own
arguments (`report --check` beside `report` that writes); such a mode is its own command. These options are not
modes in this sense and are allowed: output selection (`--json`, `--format` for alternative text formats), views of
the same data (`--fields`, `--full`, paging, `schema --errors`), waiting (`--wait`, `--timeout`), preview and commit
(`--commit`, `--plan-digest`, `--dry-run`), and an output variant the command declares (`compile --stream`, 10.9
`when`).

9.4. **The primary object is an operand.** When a command acts on or shows one kind of object, that object is the
operand: `finding close <CHANGE_ID>`, `run status <RUN_ID>`. A command has at most one operand kind; several
objects of that kind are a variadic operand. Two operands of one kind in a meaningful order are allowed
(`diff <BEFORE> <AFTER>`). Context (repository, project, run being worked on) is never an operand. Values that
modify the object (labels to add, a new status) are options. [Appendix A D4]

9.5. **Other identifiers are bare-noun options.** `--change`, `--run`, `--actor`, never `--change-id`. An option
name MUST NOT end in `-id`. [Appendix A D4]

9.6. **One spelling, one meaning.** Within a tool, an option name has one value name, one value type and one
meaning on every command that takes it; only `required`, the default and a subset of a shared enum may differ. Two
meanings need two names.

9.7. **Option names** are lower kebab-case long names. A tool SHOULD NOT define short options other than `-h` and
`-V`; an existing short option is listed in the self-description (10.7). Prefix abbreviation of options or
commands MUST NOT be accepted. [Appendix A D11.18]

9.8. **Reserved option names.** These names have one meaning in every tool and MUST NOT be used for anything else.
A tool need not offer them; where it offers the behaviour, it uses the name.

| Option | Meaning | Section |
|---|---|---|
| `--json` | Select the envelope or stream protocol. Flag-only. | 4.2 |
| `--input <JSON\|FILE\|->` | The arguments as a JSON document. Flag-only. | 11 |
| `--commit`, `--plan-digest <DIGEST>` | Carry out a previewed destructive plan. Flag-only. | 12 |
| `--dry-run` | Validate fully, report what would change, change nothing. | 12.10 |
| `--limit <N>`, `--cursor <CURSOR>`, `--all` | Paging; `--all` asks for every remaining item, a `--limit` without a bound. Flag-only since 1.2 (11.6). | 6.9 |
| `--fields <FIELDS>` | Field selection. Flag-only since 1.2 (11.6). | 6.10 |
| `--operation <KEY>` | Caller-chosen operation key. | 13.4 |
| `--help`, `--version` | | 4.6 |

No option may authorise a destructive act except `--commit --plan-digest`; in particular `--yes` and `--force`
MUST NOT (12.8). [Appendix A D7, D11.5, D11.10, D11.11, D31]

9.9. **Unknown is an error.** An unknown command, option or enum value refuses before any effect, with `expected`
and `suggestions`; nothing is auto-corrected. An option a command cannot honour with the others refuses by name
rather than being ignored.

9.10. **Clean cutover.** A renamed or removed command or option is not kept as an alias. A tool MAY recognise a
removed spelling only to refuse it with `UNKNOWN_COMMAND` or `USAGE` whose `hint` is the replacement. [Appendix A D4]

9.11. **Values.** Times are RFC 3339; a bare `YYYY-MM-DD` MAY mean UTC midnight. A `<DURATION>` is one or more
`<integer><unit>` pairs, units `ms`, `s`, `m`, `h`, `d` in decreasing order (`90s`, `1h30m`); a bare integer means
seconds. Paths are relative to the working directory, on the command line and inside `--input`.

### 9.12. Argv syntax

9.12.1. Every conforming parser accepts at least this syntax, and callers (examples, `next`, guides, the
conversion of 11.9) use only this syntax. The grammar is RFC 5234 ABNF over the **sequence of argv elements**:
`SEP` stands for the boundary between two elements, and a rule whose name ends in `-word` matches one whole
element. It is not shell syntax; quoting is the shell's business.

```abnf
invocation    = *( global SEP ) path *( SEP argument ) [ SEP "--" *( SEP operand-word ) ]
path          = command-word *( SEP command-word )
command-word  = name
argument      = option / free-operand
option        = long-switch / long-joined / long-separate / short-form
long-switch   = "--" name                         ; a switch, or one occurrence of a count
long-joined   = "--" name "=" value               ; value: the rest of the element, possibly empty
long-separate = "--" name SEP plain-word          ; the next element is the value; it does not start with "-"
short-form    = "-" ALPHA [ SEP plain-word ]      ; only for declared short options (10.7)
global        = option                            ; options accepted before the path, e.g. --json
free-operand  = plain-word                        ; before "--"
plain-word    = "-" / ( first-char *CHAR )        ; a non-empty element not starting with "-", or exactly "-"
operand-word  = *CHAR                             ; after "--", any element is an operand
value         = *CHAR
name          = lower *( lower / DIGIT ) *( "-" 1*( lower / DIGIT ) )
lower         = %x61-7A
first-char    = %x01-2C / %x2E-10FFFF             ; any character except "-"
CHAR          = %x01-10FFFF                       ; any Unicode scalar value except NUL
```

9.12.2. Semantics:

- A repeatable option is given once per value (`--label a --label b`); its values keep their order. A comma list
  is a single value whose syntax the option documents (`--fields a,b`).
- A count is given once per occurrence (`--verbose --verbose`).
- `--name=value` and `--name value` are equivalent when both are in the grammar. A value that is empty or starts
  with `-` (including `--`), other than exactly `-`, can only be written `--name=value`; the value `-` (stdin, as in
  `--input -`) may be written either way. A tool MUST accept the joined form for every valued option, and MAY also
  accept other values starting with `-` in the separate form (clap's `allow_hyphen_values`), which callers do not
  rely on.
- The first element that is exactly `--` ends the options (no value is ever a separate `--` element): every later
  element is an operand (or a passthrough word, 8.7), never an option, even when it starts with `-`. A tool MUST
  accept operands after `--`.
- Options and operands may be interleaved before `--`; their relative order does not matter except among operands.
- A declared short option is equivalent to its long name (`-o x` is `--output x`); short options have no joined
  forms in this grammar (no `-ox`, no `-o=x`, no bundling).

9.12.3. Conversion of an `--input` document to argv (11.9) produces only the forms above: `--name=value` for every
valued option, `--name` for a switch that is `true`, the count's name repeated, and every operand after one `--`.

### 9.13. Tool-wide options

9.13.1. A tool-wide option is one that every command of the tool accepts with the same meaning (`--json`, and
options such as `--repo` or `--actor` that select context for every command). A tool SHOULD accept its tool-wide
options wherever it accepts `--json`: after a group word as well as after a command, so that
`canon finding --repo . --json` is answered with `COMMAND_REQUIRED` in JSON mode rather than with `USAGE` for an
option the group "does not take". Such an option does nothing on a group but is not an error there. Where it is
accepted before the path (4.5), the same holds. [Appendix A D25]

## 10. Self-description: `schema`

Normative shapes: `schema/schema-doc.schema.json`, plus the semantic rules of 10.13.

### 10.1. Invocation

```
<tool> schema --json                       the tree (10.3)
<tool> schema <PATH>... --json             one group (10.4) or one command (10.5)
<tool> schema --errors --json              the error registry (7.3.4)
<tool> schema --error <CODE> --json        one error registry entry
<tool> schema --warnings --json            the warning registry (7.5.2, since 1.1)
<tool> schema --warning <CODE> --json      one warning registry entry (since 1.1)
<tool> schema --search "<TASK>" --json     ranked commands (10.11, OPTIONAL)
```

10.1.1. Path words MAY be given as separate words or as one quoted string (`schema "finding close"`); both MUST be
accepted.

10.1.2. A path, `--errors`, `--error`, `--warnings`, `--warning` and `--search` are mutually exclusive (`USAGE`). An unknown path refuses
with `UNKNOWN_COMMAND` and `expected` the valid words at the first unknown position, omitted when no word is valid
there (a word after a leaf command, as in `schema finding close nosuch`); when it carries `field`, that is
`command` (7.1.1). The exclusion is an `atMostOne` rule of `schema`'s own command document (10.8.1); when its
`USAGE` carries `field` (7.1.3), it names the argument as for any `atMostOne` (10.8.1), as 7.1.1 names arguments:
`PATH` for the path, an option as written (`--errors`). A tool MAY give
`schema` further options of its own (canon's `--as`). [Appendix A D30]

10.1.3. Without `--json`, `schema` prints text that is not part of the contract; that text MAY be the JSON
document itself. [Appendix A D11.2]

10.1.4. The answer is a success envelope whose `meta.command` is `"schema"`, `meta.contract` is `"atip/1"` and
`meta.schemaVersion` is the version of the self-description format, which is the contract version the tool
implements: `"1.0"`, or `"1.1"` or `"1.2"` with the same `meta.contractVersion` (15.7). `data.kind` is one of
`tree`, `group`, `command`, `errors`, `error`, and since 1.1 `warnings` and `warning`. [Appendix A D20, D22]

### 10.2. Works without state

10.2.1. `schema` MUST answer with no repository, no configuration file, no network, no running service, no login
and no environment variables set. It MUST NOT refuse because context is missing.

10.2.2. The answer MUST NOT depend on the environment. A tool MAY filter it by an explicit option (canon's `--as`);
an environment variable MUST NOT filter it.

10.2.3. `schema` has effect `read` and writes nothing (12.2 applies to it as to a refusal).

10.2.4. For one build, the answer SHOULD be byte-identical across runs and machines.

### 10.3. `tree`

```json
{"kind": "tree", "level": "L2", "commands": [{"command": "finding", "path": ["finding"], "kind": "group", "summary": "…"},
                                             {"command": "finding close", "path": ["finding", "close"], "kind": "command", "summary": "…", "effect": "write"}]}
```

10.3.1. `commands` lists every group and every command of the tool exactly once, a group before its commands, in a
stable order. `schema` is listed like any other command. An entry has `command`, `path`, `kind` (`group` or
`command`), `summary` and, for a command, `effect`.

10.3.2. A command meant only for the tool's own use MAY be left out of the tree; `schema <PATH>` still describes it.

10.3.3. `level` is the conformance level the tool claims (3.4).

### 10.4. `group`

`{kind: "group", command, path, summary, commands}`, where `commands` are the tree entries of the group's direct
children.

### 10.5. `command`

The full description of one command. Example: `examples/schema-command-canon-finding-close.json`.

| Member | | Meaning |
|---|---|---|
| `kind` | REQUIRED | `"command"` |
| `command`, `path` | REQUIRED | Id and path words; `command` equals `path` joined by one space. |
| `summary` | REQUIRED | One line. |
| `effect` | REQUIRED | `read`, `write` or `destructive` (12.1). |
| `idempotency` | REQUIRED for `write` and `destructive`, absent for `read` | 12.3. |
| `effectNote` | OPTIONAL | Every effect the effect class does not say: a read that appends an audit line or writes a cache; a passthrough exit (8.7). It describes successful runs only; it never permits a refusal or a preview to make an effect (12.2). |
| `async` | OPTIONAL, default `false` | `true`: exit 0 means the work was accepted, not done (13.2). |
| `operands` | REQUIRED | 10.6. |
| `options` | REQUIRED | 10.7. Every option the command accepts, including inherited ones (`--as`) and the shared ones (`--json`, `--input`), except `--help` and `--version`, which every command accepts (4.6) and no document lists. |
| `constraints` | OPTIONAL | 10.8. Requirements that `required` on one argument cannot express. |
| `validators` | OPTIONAL | 10.8.3. Stateless checks that neither a `domain` nor a constraint can express. |
| `errors` | REQUIRED | Every error code the command can emit, reserved codes included. Exits are in the registry. |
| `outputs` | REQUIRED | 10.9. At least one. |
| `input` | REQUIRED when the command accepts `--input`, absent otherwise | 10.10. |
| `examples` | REQUIRED | At least one complete invocation in the syntax of 9.12, starting with the tool name, with `--json` after the path when given; no placeholder, no ellipsis; it satisfies the command's requirements and constraints, counting what an inline `--input '<JSON>'` word in it supplies (11.7). An example MUST NOT read a file or stdin (`--input -`, `--input FILE`), since a reader cannot reproduce it. |
| `schemas` | REQUIRED | Every JSON Schema the command's refs name, keyed by name. Each is a JSON Schema resource (an object or a boolean schema such as `false`) that compiles under draft 2020-12. |
| `x-<tool>` | OPTIONAL | 10.12. |

[Appendix A D5]

### 10.6. Operands

`{name, valueName, valueType, required, variadic, default, help}`, plus `possibleValues` when `valueType` is
`enum`, and OPTIONAL `defaultNote` and `domain` (10.7.1, 10.7.4). `name` is a kebab-case word naming the operand in
`constraints`; `valueName` is the placeholder shown in help (`CHANGE_ID`). An operand's `valueType` is one of
`string`, `integer`, `number`, `path`, `enum`, `json` (10.7.2); its `default` is typed the same way as an
option's (10.7.3).

### 10.7. Options

10.7.1. `{name, valueType, required, repeatable, default, help}`, plus:

- `valueName`: REQUIRED unless `valueType` is `switch` or `count`, where it is absent.
- `possibleValues`: REQUIRED when `valueType` is `enum`, absent otherwise.
- `defaultNote`: OPTIONAL; how a computed default is found.
- `env`: OPTIONAL; the environment variable the parser reads when the option is absent (11.7 step 5).
- `flagOnly`: OPTIONAL, default `false`; `true` when the option cannot be given in an `--input` document (11.6).
  `json`, `input`, `commit` and `plan-digest` always have `flagOnly: true`.
- `short`: OPTIONAL; one letter (9.7).
- `domain`: OPTIONAL; the restrictions of the argument's own value beyond its valueType, as a JSON Schema in the
  profile of 10.7.4: `{"minimum": 1}`, `{"maxLength": 200}`, `{"pattern": "^[a-z][a-z0-9-]*$"}`. Every normalised
  value of the argument (each element of a repeatable option or variadic operand) MUST satisfy it. A default other
  than `null` satisfies it.

`name` is the long name without `--`. It MUST NOT end in `-id` (9.5).

10.7.2. **valueType** is one of:

| valueType | Command line (9.12) | `default` | `--input` value (11.5) |
|---|---|---|---|
| `switch` | `--name` | `false` | `true` or `false`; `false` is the same as absent |
| `count` | `--name`, once per occurrence | integer ≥ 0, normally `0` | a non-negative integer, the number of occurrences; `0` is the same as absent |
| `string` | `--name=<V>` | string or `null` | string |
| `integer` | `--name=<N>` | integer or `null` | JSON integer, or a string matching `-?(0\|[1-9][0-9]*)`; in either form within ±(2^53-1) (10.7.5) |
| `number` | `--name=<X>` | number or `null` | JSON number, or a string in JSON number syntax |
| `path` | `--name=<PATH>` | string or `null` | string, relative to the working directory |
| `enum` | `--name=<V>` | a member of `possibleValues`, or `null` | a member of `possibleValues` |
| `json` | `--name=<JSON>` | any JSON value, or `null` for none | any JSON value except a top-level `null` |

A repeatable option's `default` is an array of its element type, or `null`; in `--input` it is an array of
element values. `count` is the one exception: it is `repeatable: true` (given once per occurrence) but its default
and its input value are a single integer. A `switch` is never required or repeatable. [Appendix A D11.3]

10.7.3. **Defaults are typed.** `default` is REQUIRED and is the value used when the option is absent, typed as
above; `null` means there is none. A default computed when the command runs (the current commit, the nearest
configuration) is `null` with a `defaultNote`. A `switch` is the exception: its `default` is always `false`, which
means "not given" (10.7.2); when absence can still turn the behaviour on (a configuration setting), `defaultNote`
says so. A default the help text promises MUST appear here. A required
option's `default` is `null`. An `enum` default (or each element of a repeatable one) is a member of
`possibleValues`.

10.7.4. **Domains.** A `domain` states every restriction of the argument's own value, beyond its valueType, that the
command enforces without reading state (10.8.1). It is not used for relations between arguments, which are
constraints. It is written in a fixed profile of JSON Schema draft 2020-12 that both clap-based and Effect-based
tools can turn into parser checks and back, and that a checker can generate boundary values for:

| valueType | Keywords |
|---|---|
| `integer`, `number`, `count` | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (positive) |
| `string`, `path` | `minLength`, `maxLength`, `pattern` |
| `json` | the keywords of both rows above, and `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`; inside `properties`, `items` and `additionalProperties` the same profile applies again |
| `switch`, `enum` | none: a switch has two values and an enum lists its values in `possibleValues` |

Besides these, a domain MAY carry the annotations `title`, `description`, `$comment` and `format`. No other keyword
is allowed. In particular `$ref`, `$dynamicRef`, `anyOf`, `oneOf`, `allOf`, `not` and `if` are outside the profile.
The check is structural: a keyword is what appears in a schema position, so a `properties` member *named* `$ref`
(a JSON value with a `"$ref"` key) is allowed.

- **json values.** The structural keywords cover the local restrictions real `json` arguments have: a JSON type or
  a list of types (`{"type": ["object", "boolean"]}`), the members of an object and which are required, the
  elements of an array, and literal values. `type` with a list of types already expresses a union across JSON
  types, because `properties`, `items` and the numeric and string keywords apply only to values of their own type.
  `anyOf` is left out: a union of two shapes of the same JSON type is a check a generator cannot reliably turn into
  parser checks or boundary values. A command that needs it declares a validator (10.8.3). `enum` and `const` take
  scalar values only (`null`, booleans, numbers, strings).
- **pattern.** The value is `^`, then a body, then `$`. The body is an I-Regexp (RFC 9485) with these restrictions:
  no `|` outside parentheses (write `^(core|lead)$`), no `.`, no `^` and no `$` outside a character class, no `\-`
  outside a character class, and no `&&` or `~~` inside a character class. A value satisfies the pattern when the
  body matches the whole value, as I-Regexp defines. The whole pattern MUST also compile with the Rust `regex`
  crate's default limits (a compiled size of 10 MiB, a nesting depth of 250). A counted repetition of a large class
  can exceed the size limit: `^\p{L}{1,500}$` does, and so do three `\p{L}{1,100}` in a row. A length limit is
  better written as `maxLength`.

  Each restriction removes a spelling that the two engines read differently. I-Regexp treats `^` and `$` as
  ordinary characters. `.` excludes CR in ECMAScript but only LF in Rust. ECMAScript refuses `\-` outside a class
  under `u`. Inside a class, Rust reads `&&` as intersection and `~~` as symmetric difference, where ECMAScript
  reads them as literal characters: `a` matches `^[a&&b]+$` in ECMAScript and not in Rust. `--` and a nested `[`
  (Rust's difference and nested sets, `[[:alpha:]]`) are already not I-Regexp. `\d`, `\w`, back-references,
  lookaround and lazy quantifiers are not I-Regexp either.

  The claim this profile makes is narrow: for a pattern of this form that both engines compile, the ECMAScript
  reading of the whole pattern with the `u` flag (what JSON Schema validators such as Ajv use) and the Rust `regex`
  crate's reading accept the same values, up to the Unicode version of each engine's `\p{…}` tables. Such a
  difference is one code point whose general category differs between the two engines' Unicode versions (U+11DB0
  is a letter in Unicode 17 and unassigned in Unicode 16, so `^\p{L}$` accepts it in one engine only). Any other
  disagreement breaks the claim. An agent therefore does not assume that its own engine proves a tool accepts a
  recently assigned character. The evidence is `scripts/regex-cases.json`, a record of patterns and values run
  through both engines, with the Unicode version of each. `scripts/validate.sh` checks the ECMAScript side and,
  with `scripts/regex-parity`, the Rust side. A disagreement is accepted only for a case marked as a Unicode-version
  difference, and each engine verifies the recorded category of that code point in its own tables. The record covers
  every construct the form admits (literals, escapes, classes with ranges, leading and trailing `-`, single `&` and
  `~`, negation, categories, groups, alternation, every quantifier, non-BMP characters), each spelling removed
  above, the size and nesting limits, and every pattern an example in this repository uses.
- **format** is an annotation only, as draft 2020-12 makes it by default. It asserts nothing, and a value is never
  refused because of it. A command that refuses values that do not follow a format declares that check as a
  validator (10.8.3).

A stateless check outside this profile is not a precondition (10.8.1): it reads no state. It is a validator.
[Appendix A D17]

10.7.5. **Numbers.** `integer` and `count` values, integer defaults, and the numeric keywords of an integer or count
domain lie within ±(2^53-1), the integers that IEEE 754 binary64 represents exactly. That is the range in which a
JSON parser, JavaScript and a Rust `i64` agree. A value outside it, on argv or in a document, is invalid: `USAGE`
(or the command's code for that argument) on argv, `INPUT_INVALID` in a document. A tool MUST NOT round it into
range. A JSON integer literal beyond the range is refused like the same digits in a string. An identifier that can
exceed the range is a `string` with a `pattern`.

`number` values, number defaults and the numeric keywords of a `number` domain are finite binary64 values, with no
other limit (`{"maximum": 1e20}` is a valid domain). A numeric string denotes the nearest binary64 value, as RFC 8259
parsers and Rust's `f64` parsing both compute it, and comparisons with domain bounds use that value. A number too
large for binary64 is invalid like an unsafe integer.

Numbers inside a `json` value are not normalised. They follow I-JSON (RFC 7493 §2.2): a caller SHOULD NOT send an
integer beyond ±(2^53-1) or a number beyond binary64 inside one, because the two runtimes may read it differently,
and a tool MAY refuse such a value as invalid. The numeric keywords of a `json` domain are finite binary64 values.

### 10.8. Constraints

10.8.1. Relations between arguments are listed in `constraints`, an array of rules. Each rule names operands and
options by their `name` (10.6, 10.7). Every relation between arguments (which must, may or must not be given
together, possibly depending on another argument's value) that the parser or the command enforces without reading
state MUST be listed here or in an argument's `required`. Two other kinds of check are not constraints:

- a **domain** restricts one argument's own value beyond its valueType (a minimum, a length, a pattern). It is
  stated in that argument's `domain` member (10.7.4) and checked at 11.7 step 6 with the command's code for it
  (canon's `FINDING_INVALID_ARGUMENT`) or `USAGE`;
- a **validator** is any other check that reads no state: a calendar date that must exist, an order between two
  timestamps, a union of two object shapes. A check that depends on an environment variable (an option's `env`
  value, 11.7 step 5) reads no state either, so it is a validator, never a constraint (whose "given" ignores
  environment values) nor a precondition; a role or setting read from configuration is state, and its check is a
  precondition. It is declared in `validators` (10.8.3) and also checked at step 6;
- a **precondition** reads state (an id exists, a file exists, a run is in the right phase); it is checked when the
  work starts (8.3) with its own code.

[Appendix A D12.4]

| `rule` | Members | Holds when |
|---|---|---|
| `atLeastOne` | `names` | at least one of `names` is given |
| `exactlyOne` | `names` | exactly one of `names` is given |
| `atMostOne` | `names` | at most one of `names` is given (pairwise conflicts are `atMostOne` of two) |
| `requires` | `if`, `then` | when `if` holds, every name in `then` is given |
| `forbids` | `if`, `then` | when `if` holds, no name in `then` is given |

`if` is `{name}` (holds when that argument is given) or `{name, in: [values]}` (holds when it is given and its
value is one of `in`; for a repeatable option or a variadic operand, when any of its values is one of `in`).
Values are compared after normalisation (11.5); every value in `in` is a valid value of the argument
(10.13 rule 3), and `in` is not allowed on a switch or a count. "Given" means supplied explicitly on argv or in an
`--input` document; a default or environment value does not count. A rule MAY carry `code`, the registered code
its violation produces; otherwise it is `USAGE`. A violation's `field` names the first argument of the rule that
is at fault, "first" in the rule's own order, never in the order of argv. Since 1.2, in a document that declares
1.2, the argument at fault is defined per rule; a document that declares 1.1 or 1.0 is held only to the sentence
before:

| `rule` | `field` names |
|---|---|
| `requires` | the first name in `then` that is not given (`--disposition rejected` without `--reason` names `--reason`) |
| `forbids` | the first name in `then` that is given, the one the caller removes |
| `atMostOne`, and `exactlyOne` with more than one given | the first given name in `names` |
| `atLeastOne`, and `exactlyOne` with none given | the first name in `names` |

[Appendix A D34]

10.8.2. `requires` and `conflictsWith` on single options do not exist in this revision; they are `requires` and
`atMostOne` rules. The five rules are the whole vocabulary; a new rule is added only when a real command needs a
relation they cannot express (Appendix A D12.4). A command lists each relation once: two rules with the same `rule`,
the same names, the same `if` and the same values, in any order, are one relation stated twice, whatever their
codes, and that is invalid (10.13 rule 4). A rule that is implied by other declarations without being the same
relation (`--a` requires `--b` when `--b` is required) is allowed.

10.8.3. **Validators.** `validators` lists the stateless checks of the command that neither a `domain` (10.7.4) nor a
constraint can express. Each is `{arguments, code, description, rejects}`, plus `x-<tool>` members:

- `arguments`: the names of the operands and options it reads (at least one);
- `code`: the registered code its failure produces, with exit 2, listed in `errors`; `USAGE` is allowed;
- `description`: what it checks, in one or two plain sentences, so that an agent can construct a valid value;
- `rejects`: at least one complete invocation in the syntax of `examples` that parses and satisfies every
  requirement, constraint and domain, and that this validator refuses. It is the checker's witness (17) and the
  agent's counterexample. None of them appears in `examples`. It is not checked against `argumentsRef`, which may
  state the same validator in JSON Schema and would then refuse it.

A validator runs for every invocation, with or without `--input`: after parsing (and, with `--input`, after the
merge of 11.7), at step 6 of 11.7 after domains and constraints, and before any precondition or state read. It
reads no state, so in a batch it is part of preflight (11.11). canon's `--before` is an example: its domain pattern
admits `2026-02-30`, and a validator refuses it. [Appendix A D17, D30]

### 10.9. Outputs and schemas

10.9.1. `outputs` lists every form the command can print. Every entry has `kind`, `schemaRef` and `schemaVersion`;
`schemaRef` names the JSON Schema of `data` in JSON mode.

| `kind` | Also REQUIRED | Meaning |
|---|---|---|
| `report` | | An enveloped report. |
| `artifact` | `mediaType` | Bytes as they are in text mode (`text/markdown`). With `--json`, an envelope whose `data` follows `schemaRef` (for example `{name, text}`); `mediaType` describes the text-mode bytes, not the JSON. |
| `stream` | `mediaType`, `eventRef` | In JSON mode, the stream protocol of 13.5; `eventRef` names the schema of an event line's `data`, `schemaRef` the schema of the final result's `data`. `mediaType` is `application/x-ndjson`. |

OPTIONAL members: `batch: true` for the report a batch input returns (11.11); `when`, which invocation selects this
output when there are several; `fields` (6.10): `{records, paths, keep?, default?}`, where `records` is the JSON
pointer of the record array inside `data` (`""` when `data` is the record), `paths` the selectable field paths
(a declared map also makes its keys selectable, 6.10), `keep` the paths always kept (not selectable themselves),
`default` the selection without `--fields` (a subset of `paths`). [Appendix A D11.13, D23]

10.9.2. `schemaRef`, `eventRef`, `input.schemaRef` and `input.argumentsRef` have the form `#/schemas/<Name>`: a
JSON pointer resolved against the command document (`data`). References between schemas in `schemas` use the same
form. A schema MAY reference the contract's schemas by their absolute `$id`. Each output has its own `schemaRef`:
two outputs of one command never share one, so `meta.output` (6.6) names exactly one output.

10.9.3. A report schema MUST describe the whole report the command prints, not a subset. A failure's partial
`data` follows the schema `meta.output` names (6.4, 6.6). The cut nodes of an output with `fields` are projectable
(6.10). A batch output's schema describes `items[].data`; the batch report's own shape is
`schema/batch-report.schema.json` whatever the command's schema says (11.11).

### 10.10. Input

`{option: "--input", schemaRef, batch, maxBytes, example}`, `maxItems` when `batch` is `true`, and OPTIONAL
`argumentsRef`.

- `schemaRef` names the **fragment schema** of one document (11.7 step 2): every key the command accepts with its
  accepted encoded values (10.7.2), `additionalProperties: false`, no `required`, flag-only options absent.
- `argumentsRef`, when present, names a schema of the **argument object** of 11.7 step 6: what the command validates
  after merging, normalising and applying defaults. It has `required`, the domains and, as far as JSON Schema can,
  the constraints and validators. It is informative; `required`, `domain`, `constraints`, `validators` and the
  command's own validation are authoritative, and it MUST NOT be stricter than they are. When present, the argument
  object of `example` validates against it.
- `example` is one complete, valid document: it satisfies the fragment schema, `required`, every `domain`,
  `constraints` and `validators` on its own.

### 10.11. Search (OPTIONAL)

`<tool> schema --search "<TASK>" --json` returns a `tree` with `query` set and `commands` ranked best first; it
MAY return fewer entries than the tree, including none. Search MUST work offline. Tools with more than about fifty
commands SHOULD offer it. How well a search ranks is not part of the contract.

### 10.12. Extensions

Members whose name matches `^x-[a-z][a-z0-9-]*$` MAY appear on tree entries, `tree`, `group`, `command`,
operands, options, constraints, outputs, the error object, registry entries (error and warning registries, and
reasons), `next` entries and `meta`. By convention the name is `x-<tool>` (`"x-canon": {"roles": ["reviewer"]}`).
Callers MUST ignore extensions they do not know. A tool emits no member that neither this document, for the
minor the tool implements (15.7), nor this convention defines; a caller ignores every member it does not know
(15.6).

### 10.13. Rules beyond JSON Schema

These rules are normative, are not expressible in standard JSON Schema, and are checked by `scripts/check.ts` in
this repository and by the conformance checker (17). Every rule has at least one invalid example in
`examples/invalid/` that breaks it alone.

1. A tree, group or command `command` equals its `path` joined by one space; a group's own `command` and `path`
   agree, and its children extend its path by one word.
2. Every `schemaRef`, `eventRef`, `input.schemaRef` and `input.argumentsRef` names a member of `schemas`
   (membership, not truthiness: `false` is a valid schema), every member of `schemas` compiles, and no two outputs
   share a `schemaRef`.
3. An `enum` default (and each element of a repeatable one) is in `possibleValues`; every value in a constraint's
   `in` is a valid value of the argument it names (10.7.2: a member of `possibleValues`, an integer, a number, a
   string, after normalisation by 11.5) and satisfies its `domain`; `in` is absent on switches and counts; every
   `domain` uses only the profile of its valueType (10.7.4, checked structurally, with integer and count bounds
   within ±(2^53-1), number and json bounds finite, and every `pattern` of the restricted I-Regexp form and
   compiling in both engines), compiles, and is satisfied by the argument's non-null default, a count's default
   included (a count's default is one integer, 10.7.2).
4. Every name in `constraints` names an operand or option of the command, and every `code` is in `errors`; no
   relation is stated twice (10.8.2). A command lists the reserved code of each feature it offers (7.2.1):
   `INPUT_INVALID`, `INPUT_CONFLICT` and `INPUT_TOO_LARGE` with `input`, `BATCH_INCOMPLETE` with `input.batch`,
   `PLAN_STALE` with `--commit`, `OPERATION_REUSED` with `--operation`, `CURSOR_INVALID` with `--cursor`.
5. A command with `input.batch: true` declares an output with `batch: true`, and only then.
6. A command with more than one output distinguishes every pair of them by `when` or `batch`; at most one output
   has neither.
7. `input.example` validates against the fragment schema, satisfies `required`, every `domain` and `constraints`,
   and, when `argumentsRef` is present, its argument object (11.7 step 6) validates against that schema.
8. The reserved options of 9.8, where present, have their reserved shape: `json`, `commit`, `all` switches;
   `input`, `plan-digest`, `cursor`, `fields`, `operation` strings; `limit` an integer; and the four flag-only ones
   `flagOnly: true`. In a document that declares 1.2, `limit`, `cursor`, `all` and `fields` are `flagOnly: true` too
   (11.6).
9. Option names are unique within a command, operand names are unique and distinct from option names, and short
   letters are unique within a command.
10. The fragment schema at `input.schemaRef` has no `required` at its root, `additionalProperties: false`, and no
    property for a flag-only option; its properties are `operands` and the camelCase names of the command's other
    options.
11. Every output with `fields` has projectable cut nodes (6.10), from the root schema down; `fields.records` is
    `""` or an RFC 6901 pointer that, decoded, leads through declared object members to the records;
    `fields.default` ⊆ `fields.paths`; `fields.keep` and `fields.paths` are disjoint; every path names a member
    that the record schema declares and goes through arrays only with `[]`.
12. Every example parses by the grammar of 9.12 against the command's operands and options (declared short
    letters included), with typed values (10.7.2) satisfying their domains (a count's number of occurrences
    included), and satisfies `required` and `constraints`; when `argumentsRef` is present, its argument object
    validates against it. An inline `--input` word in an example is framed and validated as 11.2-11.7 say: a batch
    only when `input.batch` is true and within `maxItems`, each document against the fragment schema, then merged
    with the argv arguments (conflicts refused) and validated as a complete invocation.
13. Every validator (10.8.3) names arguments of the command; its `code` is in `errors` and registered with exit 2;
    each of its `rejects` invocations parses and satisfies `required`, `constraints` and every `domain` (so that
    only a validator can refuse it), without being checked against `argumentsRef`, and none of them is in
    `examples`.
14. In an `errors` answer every code appears once, a reserved code has its reserved exit and retryability (in a
    document that declares 1.2, `STOPPED_MIDWAY` included), and
    within one entry every `reason` appears once; in a `warnings` answer every code appears once. A code may appear
    in both registries (7.5.3).
15. A field path, in `fields` and in `meta.fields`, writes a member in brackets exactly when its name is not an
    identifier (6.10); a path that names a map key extends a declared path whose schema is a map, by one key.
16. A document declares its minor by `meta.contractVersion` (a stream by its start line), absent meaning `"1.0"`;
    the value is never `"1.0"` written out and is a minor this document describes, and a stream's end result
    declares the same as its start. A document that declares 1.0 carries no member, document kind or path syntax
    that this document marks "since 1.1" (`meta.contractVersion` itself, also on a start line; `error.reason`, at
    the top, in `details` and in batch items; registry `reasons`; the `warnings` and `warning` kinds; bracketed
    field paths in `fields` and `meta.fields`; map-key selections). The rules that are meanings rather than shapes
    apply only to a document that declares 1.1 or later: a declared map's keys are selectable and its schema is a
    cut node (6.10); a hint that starts with the tool name is a command line (7.1.2). 1.2 adds no member, document
    kind or syntax; its rules apply only to a document that declares 1.2: four more flag-only options (rule 8),
    `STOPPED_MIDWAY` as a reserved code (rule 14), and, as behaviour the checker tests rather than shape, the cursor
    binding and the next-page entry of 6.9, `--fields` without `--json` (6.10), the argument at fault of a
    constraint (10.8.1), the order of 11.7 step 6 and the meaning of `STOPPED_MIDWAY` (8.3.2). A document that
    declares 1.1 or 1.0 is held to none of them. In a document that declares 1.0 a declared map is kept whole and is
    no cut node, and a hint may be prose that starts with the tool name. A `schema` answer's `meta.schemaVersion`
    equals the contract version it declares (10.1.4). This rule applies to every document a tool prints, `schema`
    answers, reports, failures, batch reports and streams alike.

## 11. JSON input: `--input`

Normative shapes: `schema/input-document.schema.json` (generic), and per command the fragment schema at
`input.schemaRef`.

11.1. At L2, every command with effect `write` or `destructive` MUST accept `--input <JSON|FILE|->`. A `read`
command MAY. The option carries the command's arguments as a JSON document. [Appendix A D6]

11.2. **The value.** After leading whitespace, a value starting with `{` or `[` is inline JSON; `-` reads stdin;
anything else is a file path relative to the working directory (a file whose name starts with `{` or `[` is passed
as `./{name}`). An empty value, a file that cannot be read, and an empty source refuse with `INPUT_INVALID`, `field`
`--input`. `--input` given twice, or as the last word with no value, is a malformed command line, not a bad value. A
tool that declares 1.1 or later refuses it with `USAGE` (or the finer parse code it registers for that situation
instead of `USAGE`, 7.2.2), `field` `--input`; `INPUT_INVALID` is then only for a value that was given (steps 1-2 of
11.7). A tool that declares 1.0 SHOULD do the same. [Appendix A D26]

11.3. `--input -` with stdin attached to a terminal refuses with `INPUT_INVALID`, `field` `--input`.

11.4. **Framing.** The whole source is parsed as one JSON value first. An object is one invocation; an array is a
batch, even with one element (11.11). Only when that parse fails and the source is a file or stdin are its
non-blank lines parsed as NDJSON, one document per line, and that is a batch. Any other JSON value, and invalid
JSON, refuse with `INPUT_INVALID`. A batch on a command whose `input.batch` is not `true` refuses with
`INPUT_INVALID`.

11.5. **Document keys and values.** A document is one JSON object. Its keys are the command's option names in
camelCase (`resolution-rev` → `resolutionRev`, `no-promote` → `noPromote`) and `operands`. Values are typed and
normalised by valueType as in 10.7.2:

- `operands` is a non-empty array of the operands in order; each element has its operand's valueType (a `json`
  operand takes any JSON value except a top-level `null`, booleans included). An empty array is refused; omit the
  key.
- A numeric string for an `integer` or `number` argument is normalised to the number it denotes before any
  comparison or validation. The string must match the JSON number grammar (RFC 8259 §6) and, for an integer,
  `-?(0|[1-9][0-9]*)`; no other forms (hexadecimal, `+1`, `1e3` for an integer, surrounding spaces) are numbers.
  An integer, in either form, lies within ±(2^53-1) and is never rounded (10.7.5). No other coercion happens (a
  number is not accepted for a `string` option).
- A switch takes `true` or `false` and a count a non-negative integer; `false` and `0` are the same as an absent
  key. A boolean for a `json` argument is a value like any other: `false` is not "absent" there.
- `null` is refused as a key's value and as an element of `operands` or of a repeatable option's array. `null`
  nested inside a `json` value is part of that value.
- `{}` is a valid document with no arguments.

[Appendix A D11.17]

11.6. **Flag-only options.** `json`, `input`, `commit` and `planDigest` are never document keys, so a document
cannot select output or commit a destructive plan. Since 1.2, in a tool that declares 1.2, `limit`, `cursor`, `all`
and `fields` are flag-only too: they choose how much of the answer to print and where to continue it, not what the
command does, and a page's `next` carries them on argv (6.9). A tool MAY make other options flag-only (canon's
`repo` and `as`); it marks them `flagOnly: true` (10.7.1) and leaves them out of the fragment schema.

11.7. **Processing order.** A tool processes an invocation with `--input` in exactly this order; a failure stops
it, with nothing changed. Steps 1-6 read no state: they depend only on argv, the document, the environment and
the command's self-description, so they give the same answer whatever the tool's state.

1. **Read and frame** (11.2-11.4, 11.10). Failures: `INPUT_INVALID` or `INPUT_TOO_LARGE`, `field` `--input`.
2. **Fragment validation.** Each document is validated against the fragment schema: known keys, flag-only keys
   absent, types and enum membership of each value, `null` (11.5). Every problem in a document is reported:
   `INPUT_INVALID`, `field` the pointer of the key (`/reasn`), and `details` when there are several.
3. **Conflict check.** The explicit argv arguments are extracted **without** enforcing requirements, constraints,
   environment or defaults: an argv that lacks a required argument, because the document supplies it, is not an
   error at this step. For each argument given both on argv and in the document, the two normalised values are
   compared structurally: a scalar argument as one value, a repeatable option or the operands as one ordered
   array; arrays are equal when they have equal elements in the same order, objects when they have the same
   members with equal values whatever their order, and a scalar never equals an array (a `json` value `[1]` differs
   from `1`). Different values refuse with `INPUT_CONFLICT`, `field` the document pointer. Malformed argv (an
   unknown option, a value of the wrong type) refuses here with the usual argv code.
4. **Merge.** The explicit arguments are the union of argv and the document; each remembers its source.
5. **Environment and defaults.** For each option absent from the merged arguments, its `env` variable applies if
   set, otherwise its `default`. These values are not explicit: they never conflict with anything and do not make
   an argument "given" for constraints (10.8).
6. **Invocation validation.** Requirements (`required`), domains (10.7.4), constraints (10.8) and validators
   (10.8.3) are checked on the merged arguments, with the same codes as for an invocation without `--input`
   (`USAGE`, or the constraint's, validator's or command's code). No state is read. In a tool that declares 1.2,
   with or without `--input`, the first failure is the answer and the order is fixed, so that two tools give one
   invocation the same code and `field`: a failure to parse argv (an unknown option or command word, a missing
   option value, a value that is not of its valueType or not one of its `possibleValues`) comes before step 6 (with
   `--input`, at step 3); step 6 then checks `required`, then domains, then constraints, then validators; within
   `required` and within domains, operands in their order and then options in their declaration order; constraints
   and validators each in their declaration order. 10.8.3 puts validators last for every minor. What is validated
   is the **argument object**: `operands` (normalised; when the explicit operands end before an operand that has a
   non-null default, that default is appended, and for a variadic operand the elements of its default array, in
   order), and for every option that is not flag-only, under its camelCase name, its normalised explicit value,
   else its `env` value, else its default when that is not `null`. Integers and numbers are JSON numbers there,
   whatever their spelling in argv or the document; a repeatable option is an array; a count is one integer. It is
   what `argumentsRef` describes (10.10).
7. **Execution.** The command resolves the objects it names, checks its state-dependent preconditions (8.3) and
   does its work. A precondition that fails here, before the work started, is a refusal (exit 2) of a single
   invocation; in a batch it is the failure of that item (11.11).

11.8. **Error fields for input.** When the value at fault came from a document, `field` is its JSON pointer:
`/round`, `/operands/0`, `/label/2`; inside a batch, prefixed with the item index: `/1/round`. When a required
argument is missing from both sources and the invocation used `--input`, `field` is the pointer the key would have
(`/round`). Otherwise `field` names the argv argument (7.1.1). A tool that converts the document to argv (11.9)
MUST translate parser fields back to these pointers.

11.9. **Conversion to argv.** A tool MAY implement steps 4-6 by converting the merged document to argv and running
its ordinary parser. The conversion MUST follow 9.12.3: every operand after one `--`, every valued option in the
`--name=value` form (so no value is read as an option or as an inline-JSON/file/stdin selector), a `json` value as
its compact JSON text in one word. The result MUST be the same as validating the document directly, including codes
and the pointers of 11.8.

11.10. **Size.** `input.maxBytes` is declared per command and enforced before parsing (`INPUT_TOO_LARGE`).

11.11. **Batches** (OPTIONAL per command). A command MAY accept several documents in one invocation; it then
declares `input.batch: true`, `input.maxItems`, and an output with `batch: true`. Destructive commands MUST NOT
accept batches. A batch runs in two phases:

- **Preflight**: steps 1-6 of 11.7 for every item, before any item executes. Preflight reads no state, so it never
  depends on what an earlier item will do; an item may name an object an earlier item creates.
- **Execution**: items run one at a time, in order (step 7 for each), and the batch stops at the first item that
  fails, including an item whose state-dependent precondition fails (the named object does not exist).

| Case | Exit | `error.code` | `data` | Item statuses |
|---|---|---|---|---|
| A preflight failure in any item | the failing item's code's exit (2) | the first failing item's code, `field` prefixed `/<index>` | absent | none (nothing executed) |
| Every item executed without failure | 0 | — | the batch report | each `written` or `unchanged` |
| An item failed during execution, at any index (including 0) | 1 | `BATCH_INCOMPLETE`, `field` `/<index>` | the batch report | earlier items `written`/`unchanged`; that item `failed` with its own `error`; later items `skipped` |

The batch report is `{items: [...]}` with exactly one entry per submitted item, in order:
`{index, status, data?, error?}`: `written` and `unchanged` items carry `data` and no `error`; a `failed` item
carries its own `error` (with the code's registry `retryable`) and no `data`; a `skipped` item carries neither.
Its normative shape is `schema/batch-report.schema.json`; a batch output's `data` MUST validate against it in
addition to the command's own batch schema, which only adds the type of `items[].data`.
`failed` does not mean rolled back: the failed item's own error code tells whether it may have made effects (its
registry exit is 1) or refused to run (exit 2). A batch is not a transaction. `BATCH_INCOMPLETE` is used exactly
when one item is `failed`, and its `field` is that item's index.

## 12. Effects and destructive safety

12.1. **Effect.** Every command declares one effect:

- `read`: makes no effect except what `effectNote` names (an audit line, a cache).
- `write`: records or changes state.
- `destructive`: deletes or rewrites data others depend on, or is hard to undo.

12.2. **Refusals and previews write nothing.** A refusal (exit 2), a destructive preview (12.4), a `--dry-run`
(12.10), `--help`, `--version` and `schema` MUST NOT make any effect: no file, record, cache, log file, telemetry
record or remote change, whatever `effectNote` says. A preview or `--dry-run` makes none whatever its exit, a
failure (exit 1) included. `effectNote` describes what a successful run does; it never
permits these. Writing to the process's own stdout and stderr is output, not an effect. [Appendix A D12.3, D30]

12.3. **Idempotency** of `write` and `destructive` commands:

| Value | A repeat of the same invocation |
|---|---|
| `replay-safe` | changes nothing more and reports `unchanged` (or the same result). |
| `content-keyed` | with identical content is a no-op; different content under the same key refuses. |
| `appends` | adds another record. |
| `once` | refuses (exit 2) and changes nothing. |

12.4. **Preview by default** (L2). A `destructive` command takes `--commit` and `--plan-digest <DIGEST>`. Run
without `--commit` it is a preview: it computes the plan, makes no effect, and succeeds (exit 0) with a report
whose `data` carries at least:

| Member | Meaning |
|---|---|
| `planDigest` | The digest of the plan (12.6). |
| `effects` | Every effect the commit would make, including the ones `effectNote` names (an audit line), as objects naming the action and its target (canon: `{action, path?, record?, detail?}`), precise enough that a caller can decide from them alone. |
| `committed` | `false` for a preview, `true` after the commit. |

[Appendix A D7]

12.5. **The commit step.** The preview's `meta.next` MUST lead with the exact commit invocation, digest included.
It is built from the normalised arguments the preview used, not from how they were given: an invocation that read
`--input -` or `--input <FILE>` gets a `next` entry with the arguments as argv options or as one inline
`--input '<compact JSON>'` word, never `--input -`. A destructive command MUST NOT take a secret as an argument
(secrets come from the environment or a credential store), so this never discloses one (16.1). When the plan
depends on a file's contents, the digest covers them (12.6), so a changed file makes the commit refuse.

12.6. **Digest.** The digest covers the plan: the effects and every input that determines them (arguments,
the state and file contents read). It is opaque to callers. It SHOULD be `sha256:` followed by the lower-case hex
SHA-256 of the plan's RFC 8785 (JCS) canonical JSON. It does not expire; it is bound to state, not to time. When
another system makes the effects and computes the digest (a remote service the tool sends the plan to), the tool
passes the digest through unchanged and the check of 12.7 happens there. [Appendix A D30]

12.7. **Commit.** `--commit` and `--plan-digest` require each other: one without the other refuses with `USAGE`, its
registered finer replacement (7.2.2), or the `code` of the `requires` rule that states the relation (10.8.1). With
both, the command recomputes the plan; if its digest differs it refuses with `PLAN_STALE` (exit 2, nothing changed,
`meta.next` the preview invocation); otherwise it carries out exactly that plan and reports `committed: true`. A
commit is not a lock: a tool whose plan can be invalidated between the check and the effects MUST detect it per
effect or hold a lock; a change it detects after some of the effects is a stop part-way (8.3.2). Because a commit
acts only after the recomputed digest matches, a tool whose digest only the system that makes the effects can
recompute, when that system cannot (a remote service too old to do it), refuses the commit and never acts unchecked;
that refusal is a code of the tool's own with exit 2, not `PLAN_STALE`, whose `next`, the preview, cannot help. A
tool that recomputes the plan itself is not affected: it detects changes per effect or holds a lock as above, or
needs neither when its plan cannot be invalidated between the check and the effects. [Appendix A D30, D31]

12.8. **Nothing else authorises.** `--commit` and `--plan-digest` are flag-only (11.6). No other option,
environment variable or prompt authorises a destructive command: no `--yes`, no `--force`. This holds for
destructive acts on a single named target too. [Appendix A D7, D11.11]

12.9. A command that a person must run (approving, accepting a risk) SHOULD refuse agents with `retryable: false`
and a `hint` addressed to the person, naming the command to run. No flag grants it. How a tool tells a person
from an agent is out of scope.

12.10. **`--dry-run`** on a `write` command is OPTIONAL. Where offered, it runs every check the real run would
(refusing with the same codes), makes no effect (12.2), and reports what would change.

## 13. Long-running work and streams

13.1. By default a command finishes its work before it exits; exit 0 means done as asked.

13.2. **Accepted is not done.** A command that starts work it does not finish (a detached worker, a remote job)
declares `async: true` (10.5). Its exit 0 means "accepted"; its report names the identifier to follow and MUST NOT
present the work as complete; `meta.next` MUST lead with the command that reads or waits for the outcome.

13.3. **Waiting.** A command that waits SHOULD take `--wait` and `--timeout <DURATION>` (9.11). It exits 0 when the
work is done as asked; when the work ended otherwise it exits 1 with a registered code; when the timeout passes it
exits 1 with a retryable code and puts the same wait in `meta.next`.

13.4. **Operation keys.** A command that starts work another process completes, or whose reply can be lost after
its effect, SHOULD accept `--operation <KEY>` (input key `operation`): a caller-chosen key that names this
request. Then:

- **Namespace.** Keys are scoped to the tool, the command and the resolved context (6.7): the same key used with
  another command or another repository names another request.
- **Payload.** The tool binds the key to the request's payload: the normalised explicit arguments (11.7 step 4)
  plus the resolved context, excluding `--json` and `--operation`. Environment and default values are part of the
  payload only through the context they resolve.
- **Reservation.** Binding the key is atomic and is a precondition (8.3): of several concurrent requests with one
  key, exactly one performs the work; the others behave as the repeats below, waiting for the reservation to exist
  if needed. No interleaving starts the work twice.
- **Repeat, same payload.** A repeat makes no new effect and returns the result of the first request: the same
  report if it finished, or, if it is still running, an accepted report for the same work (13.2) with the same
  identifier and `meta.next` leading to the wait.
- **Uncertain outcome.** If the first request stopped and the tool cannot tell whether its effect happened (a
  remote call whose reply was lost), the repeat MUST first reconcile against the system that holds the effect. If
  the effect is known to have happened, the repeat returns its result; if it is known not to have happened, the
  repeat performs it once. If the tool still cannot tell, it refuses with a code of its own registry (exit 2,
  `retryable: false`; no reserved code, Appendix A D16.3) and:
  - the `hint` names a command that inspects the work durably (it reads the system that holds the effect, not a
    local cache), and `meta.next` leads with that command when it is literal;
  - the key stays reserved and bound to its payload; every later repeat gives the same refusal until the outcome
    is known, and never starts the work;
  - the guide says how a person or agent resolves the case (inspect, then either accept the found effect or
    release the key with a documented command) and that a new key MUST NOT be used to start the same work while
    the outcome is unknown.
- **Repeat, other payload.** The same key with a different payload refuses with `OPERATION_REUSED` (exit 2),
  `field` `--operation`, `hint` the command that shows the first request.
- **Retention.** Keys are kept at least until the work they name is over; the retention is documented in the
  guide. After a key expires it names a new request; callers MUST NOT reuse a key after its retention.

A command that takes `--operation` has idempotency `replay-safe`. [Appendix A D11.10, D12.2]

### 13.5. Streams

13.5.1. A command whose output kind is `stream` prints, in JSON mode, NDJSON on stdout: one JSON object per line,
each with a `type`:

| Line | Shape | When |
|---|---|---|
| start | `{"type": "start", "contract": "atip/1", "contractVersion"?, "tool", "toolVersion", "command", "schemaVersion", "output"?}` | first line, exactly once; `contractVersion` as on every envelope (15.7, since 1.1) |
| event | `{"type": "event", "data": <follows eventRef>}` | zero or more times |
| end | `{"type": "end", "result": <an ordinary envelope (6)>}` | last line, exactly once |

`schemaVersion` on the start line is the stream output's; `command` is the command's id. When the command declares
more than one output, `output` is REQUIRED on the start line and names the stream output that runs (the key of its
`schemaRef` in `schemas`), so a caller can choose the event decoder before the first event and still knows it if
the stream is cut off. Every event's `data` validates against that output's `eventRef` schema. The `end` line's
`result` is an ordinary envelope (6) with every rule of sections 6-8: its `meta.command` and `meta.tool` equal the
start line's, its `meta.output` equals the start line's `output` when that is present, a success's `data`
validates against the stream output's `schemaRef` and its `meta.schemaVersion` equals the start line's, and a
failure follows the registry. Normative shape: `schema/stream-line.schema.json`. [Appendix A D11.7]

13.5.2. The exit status is the exit of the `end` line's envelope (0 exactly when `result.ok`). A stream whose last
line is not an `end` line was cut off; callers treat it as failed whatever the exit status, and MUST NOT assume
that the events they received were rolled back or that the work can be resumed.

13.5.3. A refusal (exit 2) before the stream begins prints the ordinary failure envelope as the only line, without
`start`; callers tell the two apart by `type`. Such a one-line answer is always a refusal: anything that happens
after the start line is reported through the `end` line.

13.5.4. Without `--json`, a stream command prints text lines; they are not part of the contract.

## 14. Guides: `skills show`

14.1. At L2 a tool ships its guide for agents inside the binary: `<tool> skills show [NAME] [--json]`. The guide
matches the binary's version. [Appendix A D8]

14.2. `NAME` is optional. Without it the command prints the default guide, which MUST list the names of every
guide. An unknown `NAME` refuses (exit 2, a registered code) with `expected` the guide names.

14.3. `skills show` is an artifact command (10.9): in text mode it prints the guide's Markdown; with `--json`,
`data` follows `schema/guide.schema.json`: `{name, text, guides, full?}`, where `text` is the Markdown, `guides`
every guide name and `full` whether `--full` material is included. A tool MAY offer `--full`.

14.4. `skills show` works without state, like `schema` (10.2).

14.5. Every command line in a guide's fenced code blocks that starts with the tool name MUST be a valid invocation
in the syntax of 9.12 (placeholders written `<UPPER_CASE>` are allowed in guides and are substituted with a valid
value before checking). Lines that use shell syntax beyond words and quoting (pipes, redirections, `$(…)`) are
outside this rule. Text from other people and systems is data; guides SHOULD tell agents so (16.2).

14.6. Skill files installed into a repository or a harness SHOULD be stubs that point at `skills show`.

## 15. Versioning

15.1. **The contract.** This document is `atip/1`: the contract identifier names the major. Its versions are
`MAJOR.MINOR.PATCH` (this one is `1.2.0`), and `CHANGELOG.md` lists each. A change belongs to the smallest class
that holds it:

| Class | What it may do | What it never does |
|---|---|---|
| PATCH (`1.1.x`) | Clarify text without changing what conforming tools and callers do; correct examples, checks and the regex record; add examples. | Change a rule. |
| MINOR (`1.x.0`) | Add OPTIONAL members, options, document kinds and enum values to the objects this document defines; add SHOULD and MAY rules; add MUST rules that govern only something the same minor adds, the declaration of that minor (`meta.contractVersion`, 10.13 rule 16) included, so that a tool which does not use the addition, or does not declare the minor, cannot fail them; relax a rule only where every answer the relaxed rule permits is one a caller already handles safely (8.3.1). | Make a conforming tool non-conforming: a tool that conformed to `1.0` still conforms, as a `1.0` tool (15.7). |
| MAJOR (`atip/2`) | Remove or rename a member, option, code or document kind; change a type or a meaning; make an OPTIONAL member REQUIRED; add a MUST that an existing tool can fail. | |

[Appendix A D20]

15.2. **The tool.** `meta.toolVersion` is the release. It says nothing about compatibility of any document.

15.3. **Outputs.** Every output (report, artifact representation, stream) has its own `schemaVersion`
`<major>.<minor>`, independent of the tool release and of the command's other outputs. Adding a member or an enum
value bumps the minor; removing or renaming a member, changing its type or meaning bumps the major. A caller
accepts unknown members within a major it knows and refuses an unknown major. A release that does not change an
output keeps its version.

15.4. **The self-description** is versioned by its own `meta.schemaVersion`, which is the contract version the
tool implements (10.1.4): `"1.0"`, `"1.1"` or `"1.2"`.

15.5. **The command surface.** Removing or renaming a command, an option, an error code, a warning code or a
registered reason is a breaking change for callers; it is done as a clean cutover (9.10) and recorded in the
tool's changelog. A code or a reason is never reused with another meaning.

15.6. **Unknown members and values.** A caller MUST ignore a member it does not know in every object this document
defines, as 15.3 says for reports: the envelope and `meta` with every object inside it (`next` entries, `page`,
`truncated`, `warnings` items), `error` and its `details` items, error and warning registry entries and their
reasons, every `schema` document and everything inside it, stream lines, batch reports and guides.

A caller MUST NOT fail a whole document because a member whose values this document lists has a string value it
does not know. The table below is every such member, read from the schemas in `schema/`; for each it says what the
caller does with an unknown string. It never infers that something it did not understand is satisfied, done or
safe, and what it left out is not absent: a view with no outputs, entries or arguments left does not say the
command has none, only that the caller cannot use them. Only an unknown *string* is an unknown value: a listed member whose value is not a string, or a required
listed member that is missing, is a known member of the wrong shape, and the caller rejects the document. A later
minor that adds a listed member adds its row here; `scripts/check.ts` fails when a schema in `schema/` lists string
values for a member that has no row, and its caller view applies every row. [Appendix A D20, D28, D29]

| Member (schema) | An unknown string means |
|---|---|
| `meta.contract` (envelope, stream start line) | Another major: the caller refuses the whole document. |
| `data.kind` of a `schema` answer (schema-doc) | The answer is unusable; `ok` and `meta` are still read. |
| A tree entry's `kind` (schema-doc `treeEntry`) | The entry is left out. |
| `effect` of a command or a tree entry (schema-doc `effect`) | The command is treated as `destructive`. |
| `idempotency` (schema-doc `idempotency`) | The command is treated as `once`: never repeated after an unknown outcome. Also when `effect` was unknown and `idempotency` is absent. |
| A tree's `level` (schema-doc `tree`) | The tool is treated as claiming `L1`, the lowest level a tree can claim. |
| An operand's or an option's `valueType` (schema-doc `operand`, `option`; each has its own list) | The argument is left out: the caller cannot give it, and when it is required the caller cannot run the command. |
| A constraint's `rule` (schema-doc `constraint`) | The constraint is left out of the caller's own checks. The caller does not assume it holds: the tool checks it before acting, and a violation is a refusal that changes nothing (8.2, 11.7 step 6). |
| `input.option` (schema-doc `input`) | `input` is left out: the caller builds invocations from argv only. |
| A keyword of a `domain`, or a JSON type name in a domain's `type` (schema-doc `domainNode`, `jsonType`) | The whole `domain` of that argument is left out of the caller's own checks; the tool still enforces it, as for a constraint. |
| An output's `kind` (schema-doc `output`) | The output is left out. |
| A batch item's `status` (batch-report) | The item is left out of what the caller counts as written, unchanged, failed or skipped: its outcome is unknown, and the caller reads its state before repeating it. |
| A stream line's `type` (stream-line) | The line is left out; the stream still ends with its `end` line. |

Listed values that are not strings are fixed by this major and have no unknown values: `ok` is a boolean, a
registry entry's `exit` is `1` or `2` (8.6), and `batch` and `async` are booleans; any other value is a wrong shape.
Tools are held to the opposite rule: a tool emits only what its minor defines, plus `x-<tool>` members (10.12,
15.7). [Appendix A D20]

15.7. **Declaring the minor** (since 1.1). `meta.contractVersion` (6.6) is the contract version a tool implements,
`<major>.<minor>`; absent, it is `"1.0"`, and it is never written as `"1.0"`. A tool that implements 1.1 or later
MUST set `meta.contract` and `meta.contractVersion` on every envelope (the `result` of a stream's `end` line
included) and `contract` and `contractVersion` on every stream start line, so that a document without the marker
is always a 1.0 document. It is the same on every document one build of the tool prints. A tool emits no member,
document kind or syntax
added in a later minor than the one it declares (10.13 rule 16). Conformance is stated with the minor:
"ATIP 1.1 L1 conformant". The checker (17) reads the claimed minor from the fixture, as it reads an L0 tool's
level, and checks that the tool's documents declare it. [Appendix A D20]

15.8. **The published schemas.** The JSON Schemas in `schema/` describe what a tool of the current minor may emit,
and they are closed (`additionalProperties: false`): the checker validates tool output against them. Every member,
document kind and pattern added after 1.0 carries the annotation `"x-atip-since"` naming the minor that added it,
`"1.1"` for all of them, since 1.2 added none (a widened pattern keeps its 1.0 form as a separate branch, and the
annotation marks the added branch), which tells a checker what a tool that declares an earlier minor must not emit.
Some additions are meanings, not shapes, and no annotation can carry them: in 1.1 map-key selection (6.10), the hint
forms of 7.1.2 and 11.2's `USAGE`, and every rule 1.2 adds; 10.13 rule 16 lists every such rule and
`scripts/check.ts` applies each by the declared minor. A caller MUST NOT reject a document only because it fails
these schemas by an unknown member (15.6). A caller that validates uses them *open*: with `additionalProperties:
false` read as absent, every other keyword unchanged. A value outside a listed set still fails the schemas read
open, so a caller that validates first builds its *view* of the document: every unknown string handled as the table
of 15.6 says. The view can no longer meet the producer's completeness rules (at least one output or entry, a batch
output when `input.batch` is `true`, and the other `minItems`, `contains` and `if`/`then`/`else` rules), so a caller
reading open also drops those keywords: they are the producer's obligations, which the checker enforces on the
tool's own documents. Types, `required` members and listed values stay. The caller validates its view against the
schemas read that way, and rejects the document only when the view fails; it never rejects a document because of
what it left out. `scripts/check.ts` validates `examples/caller-*.json` that way: documents of a later minor that a
caller of this one must read. The `$id`s stay under `https://atip.dev/1/` for every `1.x`; a release tag holds the
schemas of its version. [Appendix A D20]

15.9. **The change from 1.0 to 1.1.** 1.0.0's 15.1 said that a later 1.x would never change what a 1.0 caller must
accept. 1.1.0 breaks that promise once. A 1.0 caller that validated tool output against the closed 1.0 schemas
rejects the members 1.1 adds (`meta.contractVersion`, also on stream start lines, `error.reason`, registry
`reasons`) and the `warnings` and `warning` document kinds; it rejects the bracketed field paths of 6.10
(`attributes["http.status-code"]`) in `fields` and `meta.fields`, and reads a map-key selection
(`attributes.region`) as a path its command does not declare; a 1.1 tool may keep a warning code only in its
warning registry, where a 1.0 caller looking in `schema --errors` does not find it; and in text mode, a tool
(of either minor) may print the result of a command that exits 1 on stdout (5.3), where a 1.0 script may have
relied on empty stdout for every failure. This was accepted because, when it was decided, no conforming
caller existed outside the two early adopters of 1.0, and both moved to 1.1. Nothing a 1.0 tool emits changes
meaning, and a 1.0 tool stays conforming without a change. From 1.1.0 on, 15.1 and 15.6 hold for every later 1.x,
and this exception is not repeated. [Appendix A D20]

15.10. **From 1.1 to 1.2.** 1.2.0 changes nothing that a 1.1 caller which reads the tool's self-description relied
on, so 15.9's exception is not repeated. Its one relaxation is the cursor binding of 6.9: a tool that declares 1.2
continues a page when `--all` or `--json` changed, where a 1.1 tool may refuse with `CURSOR_INVALID`. The answer is
the same result set, so it is one a caller already handles safely (15.1), and a caller tells which rule applies from
the `meta.contractVersion` of the answer that issued the cursor. Every other 1.2 rule binds the tool only, and where
it refuses what a 1.1 tool may have accepted, the refusal changes nothing and uses a code a 1.1 caller already
handles: a cursor given with an argument added at its default value, or after its `env` variable changed, refuses
with `CURSOR_INVALID`; a document with the key `limit`, `cursor`, `all` or `fields` (`{"limit": 10}`) refuses with
`INPUT_INVALID`, and the command document marks those options `flagOnly` beforehand (11.6), so a caller that reads
it does not send them. `--fields` without `--json` is accepted where a 1.1 tool may refuse. `STOPPED_MIDWAY` is an
exit-1 code; a caller that does not know it reads it as 8.3 says (the command ran, and effects may exist), and a
caller that knows it reads its reserved meaning only in a document that declares 1.2 (8.3.2). [Appendix A D32,
D33]

## 16. Security

16.1. **No secrets in output.** Tokens, passwords, keys and credentials MUST NOT appear in `error` (including
`received`), in `meta`, in `next`, or in a report unless the report exists to show them. A `received` value that
may be a secret is redacted (`"<redacted>"`). Destructive commands take no secret arguments (12.5).

16.2. **Untrusted data.** Reports carry text from other people and systems. A tool MUST NOT interpret such text as
instructions, and SHOULD NOT place it in `hint` or `next`.

16.3. **No hidden switches.** Environment variables MAY supply an option's value only where the option declares
`env`; they MUST NOT change the output kind (4.3), filter `schema` (10.2.2), or authorise anything (12.8).

16.4. **Paths.** Paths a tool prints about the caller's workspace SHOULD be relative to the working directory.

16.5. **Input.** `--input` is bounded (11.10); `-` refuses a terminal (11.3); documents never carry flag-only
options (11.6).

## 17. Checking conformance

17.1. The shared checker (`approaches/checker.md`) runs a built binary and checks the rules of the level the tool
claims. Each check is either a MUST check (a failure fails the level) or a SHOULD advisory (reported, never
failing). A tool claiming a level MUST pass every MUST check of that level in its CI.

17.2. Rules the checker cannot see from outside (remote effects, that no call site overrides an exit, that
`effects` are complete, operation-key atomicity) are obligations of the tool's own test suite;
`approaches/checker.md` §8 lists them, and a level claim includes them.

17.3. Whenever a tool offers `schema --errors` (and `schema --warnings`), at any level, the checker compares those
registries with the one in its fixture and with the codes and reasons the tool emits during the run (7.3.4, 7.6).
A fixture that takes its registry from the tool's own `schema --errors` (`approaches/checker.md` §5) pins nothing,
so only the comparison with what the tool emits remains; a fixture that lists the registry pins it. [Appendix A D30]

## 18. Open questions

Every open question so far has been decided (Appendix A: D11, D12, D16, D17, D18, D20-D29 for 1.1.0, D30 for 1.1.1,
D31 for 1.1.2 and D32-D34 for 1.2.0). None is open in 1.2.0.
The two that revision 5 raised are kept here with their decisions, so that earlier references still resolve.

**18.1. More structure in `json` domains.** Decided (D18): the `json` profile of 10.7.4 gets no `anyOf` and no
array length keywords (`minItems`, `maxItems`, `uniqueItems`). No command the contract was written for needs them: the one
structured argument restriction found (acme's filter, object or boolean) is a list of types. Such a check is a
validator (10.8.3) until a real command needs a keyword and both frameworks generate it.

**18.2. A validator without a witness.** Decided (D18): `rejects` stays required (10.8.3). A check that cannot show
one failing input cannot be tested from outside, and an agent cannot learn what it refuses.

---

## Appendix A. Decisions

Decisions taken by the owner. A reason to change one goes through 15.1: a change that breaks a conforming tool or
caller is `atip/2`.

| # | Decision | Where |
|---|---|---|
| D1 | Nested envelope `{ok, data, meta}` / `{ok, error, meta}`, camelCase keys; stored records embedded verbatim keep their case. | 6 |
| D2 | Errors: required `code` (UPPER_SNAKE), `message`, `retryable`; optional `hint`, `field`, `expected`, `received`, `suggestions`; `details[]` only when one input yields several errors. One registry per tool `{code, exit, retryable, meaning, fix}`. | 7 |
| D3 | Exits 0 success, 1 ran and negative/incomplete, 2 usage/refusal/not found/invalid input; signals 128+n outside the table. Restated by D15. | 8 |
| D4 | Noun-verb groups, no runnable groups, primary object an operand, other ids bare-noun options, no aliases across a cutover. | 9 |
| D5 | `<tool> schema [path...] --json`, working with no repo, config or running app; `data.kind` tree, group, command, errors, error; exits only in the registry; `x-<tool>` extensions. | 10 |
| D6 | `--input <JSON\|FILE\|->`: one object required; batches optional and declared per command. | 11 |
| D7 | Destructive commands preview by default and act with `--commit --plan-digest <DIGEST>`. | 12 |
| D8 | The guide ships in the binary: `<tool> skills show [NAME]`. | 14 |
| D9 | Spec style: normative prose with BCP 14 keywords and conformance levels; JSON Schema 2020-12 normative for shapes. | 1.3, 2.1 |
| D10 | Rust tools generate the self-description from clap; TypeScript tools are spec-first (`defineCommand`); a shared checker runs every built binary in CI. | `approaches/` |
| D11 | Owner decisions 2026-10-28 on the revision-1 open questions, listed below as D11.1-D11.18. | |

| Decision | Owner decision 2026-10-28 | Where |
|---|---|---|
| D11.1 (revision-1 question 18.1): lute exit 3 | No exit 3. An incomplete walk is exit 1 with a registered code; an accepted patch is exit 0 with its changes in `data`. | 8.6 |
| D11.2 (revision-1 question 18.2): `schema` text mode | Text-mode `schema` exists and is not part of the contract; it MAY print the JSON document. | 10.1.3 |
| D11.3 (revision-1 question 18.3): `count` | Kept; new count options SHOULD NOT be added; its scalar input and occurrence-based default are the exception to "repeatable = array". | 10.7.2 |
| D11.4 (revision-1 question 18.4): `meta.context` | Keys are the context option names, values the resolved values, relative paths, absent keys omitted; explicit > env > discovered/default. | 6.7, 11.7 |
| D11.5 (revision-1 question 18.5): paging and fields | Reserve `--limit`, `--cursor`, `--all`, `--fields`; `meta.page {returned, nextCursor?, total?}`; `meta.truncated`; `meta.fields` and projection with a reduced `required` set. | 6.9, 6.10, 9.8 |
| D11.6 (revision-1 question 18.6): `next` | `{command, argv, reason?}`, `argv` without the executable; allowed on success and failure; transport keys under `x-<tool>`. | 6.8 |
| D11.7 (revision-1 question 18.7): streams | NDJSON lines with `type`: `start`, `event`, `end` with the ordinary envelope as `result`; no `end` means cut off. | 13.5 |
| D11.8 (revision-1 question 18.8): failures while working | Before any effect 2; after work began 1; `INTERNAL` 1; distinct codes when a category occurs at both stages; no call-site overrides. Restated by D15: the boundary is whether the command ran, not whether it made an effect. | 8.3, 7.3.2 |
| D11.9 (revision-1 question 18.9): reserved codes | Keep the reserved codes, including `UNKNOWN_COMMAND` and `COMMAND_REQUIRED`. | 7.2 |
| D11.10 (revision-1 question 18.10): operation key | Reserve `--operation <KEY>` (input key `operation`); same key with a different payload refuses; in-flight work is recovered, not restarted. | 13.4 |
| D11.11 (revision-1 question 18.11): `--yes` | No `--yes`; preview + `--commit --plan-digest` only. | 12.8 |
| D11.12 (revision-1 question 18.12): `meta.contract` | REQUIRED on `schema` answers, SHOULD on every envelope. | 6.6 |
| D11.13 (revision-1 question 18.13): output schemas at L1 | Required at L1, including the JSON representation of artifacts. | 10.9 |
| D11.14 (revision-1 question 18.14): depth | SHOULD NOT exceed two words; the checker warns. | 9.1 |
| D11.15 (revision-1 question 18.15): `--json` position | Required after the path, allowed before it. | 4.5 |
| D11.16 (revision-1 question 18.16): warnings | `{code, message, field?}` with registered codes. | 7.5 |
| D11.17 (revision-1 question 18.17): typed operands | Operands take their operand's valueType in `--input`, numeric strings normalised, `json` operands any JSON value. | 11.5 |
| D11.18 (revision-1 question 18.18): short options | Allowed and listed; new ones discouraged. | 9.7 |

| # | Owner decision 2026-10-28, revision 3 | Where |
|---|---|---|
| D12.1 (revision-2 question 18.1) | Keep `meta.output`. | 6.6, 6.11 |
| D12.2 (revision-2 question 18.2) | Reserve `OPERATION_REUSED`: eleven reserved codes (twelve with D16.1). | 7.2.1, 13.4 |
| D12.3 (revision-2 question 18.3) | Refusal and preview purity is strict, including log files and telemetry. | 12.2 |
| D12.4 (revision-2 question 18.4) | Keep the five constraint rules; extend only on evidence. | 10.8 |
| D13 | The contract is named **ATIP, Agent Terminal Invocation Protocol**; contract id `atip/1`; conformance stated as "ATIP L1 conformant"; checker command `atip check`; TypeScript package `@journeykit/atip`, Rust crate `atip`. It was called `agent-cli/1` through revision 2. | title, 1.5, `approaches/` |
| D14 | OpenCLI is ignored: no alignment and no exporter, because nothing consumes OpenCLI documents for these tools. | 1.6 |
| D15 | The exit rule is stated as: 1 = the command ran and its answer is negative or incomplete; 2 = the command refused to run. Every example and table follows it. | 8.1, 8.3 |

| # | Owner decision 2026-10-29, revision 4 | Where |
|---|---|---|
| D16.1 (revision-3 question 18.1) | Reserve `CURSOR_INVALID` (exit 2, not retryable): twelve reserved codes. | 6.9, 7.2.1 |
| D16.2 (revision-3 question 18.2) | Keep projection by restriction, made sound: only the cut nodes are restricted, with no `const`, `enum` or other keyword that can reject a projection of a valid value. | 6.10, 10.13 rule 11 |
| D16.3 (revision-3 question 18.3) | No reserved code for an uncertain operation outcome; the refusal is tool-specific, not retryable, names a durable inspection command, keeps the key reserved, and the guide says how to resolve it. | 13.4 |

| # | Owner decision 2026-10-29, revision 5 | Where |
|---|---|---|
| D17 (revision-4 question 18.1) | `domain` is a fixed interoperable profile: numeric `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`; string `minLength`, `maxLength`, `pattern` in an I-Regexp (RFC 9485) form both Rust and ECMAScript honour; for `json` arguments a minimal set of structural keywords. `format` is an annotation only. A stateless check outside the profile is not a precondition: it stays in step 6 with a registered code, declared as a validator in the self-description. | 10.7.4, 10.8.3, 11.7 |

| # | Owner decision 2026-10-29, revision 6 | Where |
|---|---|---|
| D18 (revision-5 questions 18.1, 18.2) | No `anyOf` and no array length keywords in `json` domains: validators cover such checks until a real command needs them. `rejects` stays required on validators. | 10.7.4, 10.8.3, 18 |

| # | Owner decision 2026-10-30, release | Where |
|---|---|---|
| D19 | 1.0.0 adopted 2026-10-30 after six rounds of independent review. | status, 15.1 |

| # | Owner decision 2026-10-31 to 2026-11-01, version 1.1.0, from implementer feedback from two early adopters | Where |
|---|---|---|
| D20 | Versions are `MAJOR.MINOR.PATCH` of `atip/1`, with the change classes of 15.1. Callers ignore unknown members of every object the contract defines, not only of reports. A tool declares its minor in `meta.contractVersion` and emits only what that minor defines. The published schemas stay closed for tools; callers read them open; members added after 1.0 carry `x-atip-since`. 1.1.0 changes 1.0.0's 15.1 once, stated in 15.9, because no conforming caller outside the two early adopters existed. | 6.6, 10.1.4, 10.12, 10.13 rule 16, 15 |
| D21 | `error.reason`: an optional UPPER_SNAKE sub-reason registered under its code (`reasons: [{reason, meaning, fix}]` on registry entries), unique within the code, never emitted unregistered, sharing the code's exit. Callers may branch on code and reason. Reserved reason names for the reserved codes that cover several situations. Finer codes stay allowed only instead of `USAGE`. | 7.1, 7.2.2, 7.2.3, 7.6 |
| D22 | A warning registry of its own: `schema --warnings` and `schema --warning <CODE>`, entries `{code, meaning, fix}`. A 1.1 tool SHOULD register warning codes there; a warning in the error registry with exit 1 stays valid. A situation reported both ways is registered in both. `--error` given a warning-only code refuses with a hint to `--warning`. | 7.3.4, 7.5, 10.1 |
| D23 | Field paths write a member whose name is not an identifier as a bracketed JSON string (`attributes["http.status-code"]`); a declared map makes its keys selectable. Paths without brackets are unchanged. | 6.10, 10.13 rules 11 and 15 |
| D24 | No per-command member saying whether a command accepts `--json`. The command document already lists `json` in `options`, and 4.2 requires it on every command with a report or artifact output, so the member would repeat `options` and could disagree with it. A tool that builds `next` knows its own parser; a caller gets `argv` ready-made. To be revisited if a tool shows a case that `options` does not answer. | 4.2, 6.8, 10.5 |
| D25 | New SHOULD and MAY rules: an L0 tool SHOULD offer `schema --errors` and the checker compares it with the fixture; tool-wide options SHOULD be accepted wherever `--json` is, groups included; a write whose failure point cannot be shown to be before the work MAY report it as during-the-work (exit 1), while exit 2 still means nothing changed. | 7.3.4, 8.3.1, 9.13, 17.3 |
| D26 | Clarifications: `USAGE` SHOULD carry `field`, and without one its hint names the command's `schema`; in text mode a refusal prints nothing on stdout and exit 1 may print its result; `--input` given twice or without a value is `USAGE`; precondition and during-the-work code names; a code with two exits is split; a batch report is its own output; a signal shows as a wait status or as a launcher's 128+n; a `hint` is exactly one of its three forms; a report may keep its own paging members, `meta.page` is authoritative. | 5.3, 6.6, 6.9, 7.1.2, 7.1.3, 7.3.2, 8.3, 8.4, 11.2 |
| D27 | A minor never makes a 1.0-conforming tool non-conforming: a 1.1 rule that would (map cut nodes, command-line hints, `--input` twice as `USAGE`) applies only to a document that declares 1.1, and a 1.0 tool keeps 1.0's behaviour; dual warning/error registration applies only to a tool that keeps a warning registry. A 1.1 tool sets `contract` and `contractVersion` everywhere, so an unmarked document is always 1.0. Callers build a view of a document with unknown listed values before validating it. | 6.10, 7.1.2, 7.5.3, 11.2, 10.13 rule 16, 15.7, 15.8 |
| D28 | A caller's view leaves out every unknown variant (argument, output, tree entry, batch item) and drops the producer's completeness rules it can no longer meet (`minItems`, `contains`, `if`/`then`/`else`), so it never rejects a document for what it left out; a listed member that is not a string is a wrong type and is rejected. A map key containing U+0000 is not selectable. A 1.1 tool's markers are a MUST of the checker's L0.contract-version. | 6.10, 15.6, 15.8 |
| D29 | Every string member whose values the contract lists has an explicit caller treatment for an unknown value, in one table (15.6): refuse the document (another major), the document part is unusable, the entry is left out, or the most cautious known value. The table is read from the schemas, and a later minor that adds a listed member adds its row. | 15.6, 15.8 |

| # | Owner decision 2026-11-01, version 1.1.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D30 | Wording, the schema and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. The `meta.contractVersion` pattern no longer admits `"1.0"`, which 6.6 already never emits. Stated where implementers missed them: validators run for every invocation, before any precondition; selection is per output, and a union-shaped output offers no `--fields`; a switch's `default` is always `false`, with `defaultNote` for a configured effect; the `field` and `expected` of `schema`'s own refusals; previews and `--dry-run` make no effect whatever their exit; when a remote system that makes the effects also computes the digest, the tool passes it through, and a commit whose digest only that system can recompute, when it cannot, is refused with the tool's own exit-2 code (a tool that recomputes the plan itself and detects changes per effect is unaffected); `USAGE` in 12.7 includes its registered finer replacement. Checker: the `paged` fixture key and the non-paging observation, `"registry": "from-schema"`, L1.hint-command, and the scope of several L0 rows. | 6.10, 10.1.2, 10.7.3, 10.8.3, 12.2, 12.6, 12.7, 17.3, schema/envelope.schema.json, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-01, version 1.1.2, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D31 | Wording and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. Stated where it could be read two ways: a caller pages with the `next` entry's arguments, changing at most `--limit` and `--fields` (cursor binding itself is unchanged; which arguments bind a cursor is for 1.2.0); `--all` asks for every remaining item, a `--limit` without a bound; a batch input reads `--fields` against the batch output, whose paths are paths into the batch report, and a batch schema written as `allOf` the batch-report schema declares no `fields`; a lone `--commit` or `--plan-digest` may also refuse with the `code` of the `requires` rule that states the pair; 12.7's closing sentence no longer reads as if a tool that recomputes its plan had to detect changes per effect rather than hold a lock. Checker: the fixture key `prepare` (programs that prepare the world before `setup`; a step running the tool's binary is refused, the report lists every step, and the tool's state is still made by `setup`), a failing `prepare` or `setup` step is a fixture error, L1.validators without `prepare` either, an L0 answer to `--cursor x` that shows neither absence nor `CURSOR_INVALID` counts as paging, an advisory without a subject in the run is `unsupported`, `from-schema` without `schema --errors` leaves only L0.ok-exit `unprovided`, and L2.destructive-half accepts the rule's `code`. | 6.9, 6.10, 9.8, 12.7, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-02, version 1.2.0, a minor (15.1) from implementer feedback | Where |
|---|---|---|
| D32 | Paging, field selection and the stateless checks, for a document that declares 1.2 only (the D27 pattern, now named in 15.1's MINOR row: a tool that declares 1.1 or 1.0 keeps its behaviour and stays conforming). A cursor is bound to every argument except the reserved options that never change the result set (`--json`, `--limit`, `--all`, `--cursor`, `--fields`); an argument given explicitly with its default value is given, except a switch given `false` or a count given `0`, which are absent (10.7.2); a value taken from an `env` variable is bound though not given. The next-page entry carries exactly the arguments the invocation gave explicitly, never a default or an `env` value, so it continues in the same environment. This relaxes 1.1's binding of `--json` and `--all` only where the result set is the same (15.1, 15.10). `--fields` is parsed and validated with or without `--json`; what it does to text is the tool's. `limit`, `cursor`, `all` and `fields` are flag-only. Argv parse failures come before step 6 of 11.7, which checks `required`, domains, constraints and validators in that order (operands then options in declaration order for the first two, declaration order for the last two), and the first failure answers. A constraint's argument at fault is defined per rule. Declined: per-item batch `--fields`, since 1.1.2 already gives one answer (`USAGE` when the batch output declares no `fields`). | 6.9, 6.10, 9.8, 10.8.1, 10.13 rules 8 and 16, 11.6, 11.7, 15.1, 15.10 |
| D33 | `STOPPED_MIDWAY` (exit 1, not retryable) is reserved since 1.2: a command that works in steps and stops after a step made effects, because a later step meets what the command refuses before its work, reports it with that refusal's code as `reason` (the refusal's own reason is not carried), instead of a during-the-work twin of every refusal code. SHOULD for a tool that declares 1.2, so a tool with a code of its own stays conforming; a 1.2 tool that registers the name gives it this exit, retryability and meaning. The reserved meaning holds only in a document that declares 1.2: in an earlier document the code is the tool's own, read by its registry entry. The name is the one the first adopter already uses and says what happened and when; an `*_INCOMPLETE` name was not chosen because exit 1 already covers incomplete answers that made no effect (8.1, 8.5), and `BATCH_INCOMPLETE` stays the code of a batch, under which a stopped item is `failed` with `STOPPED_MIDWAY`. Reserved reason `PLAN_STALE`, for a commit that detects a changed plan between its effects (12.7). | 7.2.1, 7.2.3, 8.1, 8.3.2, 10.13 rule 14, 12.7, 15.10 |
| D34 | Wording and checker rows that a patch could carry, released with 1.2.0: a check that reads an option's `env` value is a validator; a constraint's `field` follows the rule's own order, never argv's; rules said of a document that declares 1.1 hold for every later minor. Approaches: report schemas compare by meaning, not bytes; defaults are decoded at definition; the 1.2 cursor digest. Checker: the `in` check on switches and counts named; `--input` rows for environment values and spelling variants; a fixture invocation listed to succeed and refused with a precondition code is `unprovided`, never a pass, while a refusal from a stateless step is `fail`; the 1.2 rows for paging, `--fields` without `--json`, flag-only document keys, the check order and `STOPPED_MIDWAY`. | 7.1.2, 7.5.2, 6.10, 10.8.1, 11.2, approaches/typescript.md, approaches/checker.md |

## Appendix B. Prior art

Public tools and documents the contract learned from. They are cited for the problems they solve, not as
conformant tools.

| Source | What ATIP took from it |
|---|---|
| canon (`https://github.com/journeyWorker/canon`, npm `@journeykit/canon`) and lute (`https://github.com/journeyWorker/lute`), Rust and clap | The first tools the contract was written for: a generated command spec, error registries, exit rules, `--input`, preview and plan digests, skills shipped in the binary. canon is the source of the translated examples. |
| cf, Cloudflare's agent-facing CLI (`https://github.com/cloudflare/cf`) | One line in `--help` pointing agents at a machine-readable description; dry runs that print the exact effect; agent context detection, which ATIP declines (4.3). |
| Orca's CLI reference (`https://www.onorca.dev/docs/cli/reference`) | Searching the command tree by task (10.11); selectors as explicit options. |
| Google Workspace CLI (`https://github.com/googleworkspace/cli`) | One JSON document carrying a whole request, beside ordinary flags (11). |
| gh, kubectl, cargo, docker, wrangler, oclif | Noun-verb grammars, `--json` output, field selection and paging, generated reference documentation, deprecation policies. |
| Effect 4 (`https://effect.website`) | Schema-first command declarations from which argv parsing, help and JSON Schema are derived (`approaches/typescript.md`). |
| RFC 2119, RFC 8174, RFC 5234, RFC 6901, RFC 7493, RFC 8259, RFC 9485, JSON Schema 2020-12 | Keywords, the argv ABNF, pointers, I-JSON numbers, JSON, I-Regexp patterns, wire shapes. |
| `../scripts/regex-cases.json`, `../scripts/regex-parity/` | Patterns and values run through ECMAScript and the Rust `regex` crate (10.7.4). |
