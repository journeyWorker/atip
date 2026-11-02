# ATIP: Agent Terminal Invocation Protocol (`atip/1`)

Status: **1.3.0, release candidate.** 1.3.0 is a minor (15.1) that restates the contract as a protocol: the
messages that cross the boundary between a caller and a tool, defined by this document alone; a naming convention
for error codes with a small set of core codes every tool shares; and the rules whose only purpose was an exact
checker verdict moved to non-normative guidance (Appendix A D36). Earlier versions: 1.0.0 (2026-10-30), 1.1.0 to
1.1.2 (2026-11-01), 1.2.0 and 1.2.1 (2026-11-02); `CHANGELOG.md` lists each. Until revision 2 the contract was called
`agent-cli/1` (D13).

## Abstract

ATIP (contract identifier `atip/1`) is a protocol between a command-line tool and its caller, usually a coding agent
or a script, with a person at a terminal as the second audience. It fixes what crosses that boundary: the
invocation (argv), the response (one JSON document on stdout and an exit status), the error object and how error
codes are named, the tool's self-description, JSON input documents, the preview, digest and commit exchange of a
destructive command, paging, field selection, long-running work and streams. A caller that knows the protocol can
use any conforming tool without reading its source, and act on any of its errors by condition and exit class. It
was written for tools built with Rust and clap and with TypeScript and Effect 4, but nothing in it depends on
either.

## Contents

1 Introduction · 2 Terms and notation · 3 Conformance · 4 Invocation · 5 Output channels · 6 Response envelope ·
7 Errors · 8 Exit status · 9 Self-description: `schema` · 10 Input documents: `--input` · 11 Effects and the
destructive exchange · 12 Long-running work · 13 Streams · 14 Guides: `skills show` · 15 Versioning and
compatibility · 16 Security · Appendix A: decisions · Appendix B: prior art.

---

## 1. Introduction

1.1. **Purpose.** Agent-facing command-line tools, and the general-purpose CLIs agents already call, solve the same
problems in different ways: envelope and error shapes, default output formats, ways to authorise a destructive act,
self-description formats or none. An agent that learns one tool learns nothing reusable about the next, spends
context relearning, and retries what cannot succeed. ATIP makes many tools behave identically for the caller: one
response shape, one error model whose code names say what went wrong, one exit rule, one way to discover commands
and one way to authorise destruction.

1.2. **Scope.** This document specifies the externally observable behaviour of a conforming tool (its argv,
stdout, stderr and exit status, and the JSON documents it prints) and what a caller may rely on and must accept. It
covers invocations that print a report, an artifact or a stream and exit. A server started by a command (`serve`,
an MCP server) is out of scope, except that the starting command declares its output (9.9) and its effects (9.5
`effectNote`). How a tool is built is out of scope; `approaches/` describes implementations and is not normative.

1.3. **The exchanges.** Every interaction is one of these:

| Exchange | The caller sends | The tool answers | Sections |
|---|---|---|---|
| Run a command | argv | in JSON mode one envelope on stdout; an exit status 0, 1 or 2 | 4-8 |
| Discover | `schema` invocations | the command tree, command documents, the error registry | 9 |
| Arguments as a document | `--input <JSON\|FILE\|->` | as for a run | 10 |
| Destructive act | the command, then the commit invocation its preview put in `meta.next` | a plan and its digest; then the effects, or `PLAN_STALE` | 11 |
| Page | the next-page entry of `meta.next` | the next page | 6.9 |
| Accepted work | the start, then the wait in `meta.next` | "accepted", then the outcome | 12 |
| Stream | the command with `--json` | NDJSON lines: start, events, end | 13 |
| Guide | `skills show` | the guide for agents | 14 |

Every answer tells the caller what to do without knowing the tool: the exit status says whether the command
refused (nothing changed), ran with a negative or incomplete answer, or succeeded (8); the error code's condition
says what went wrong (7.2); `retryable` says whether repeating the same invocation can succeed; `meta.next` lists
the runnable follow-ups (6.8).

1.4. **Normative sources.** The JSON Schemas in `schema/` are normative for wire shapes. Rules that JSON Schema
cannot express (a value that must equal another member, a reference that must resolve) are listed in 9.13 and are
equally normative. Where prose and a schema disagree, the schema wins for shape and the prose for behaviour; a
disagreement is a bug in this document.

1.5. **Non-goals.** ATIP is not a general CLI description format and does not align with or export to OpenCLI: no
consumer of OpenCLI documents exists for these tools, and OpenCLI has none of ATIP's execution semantics (D14).

## 2. Terms and notation

2.1. The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED,
MAY and OPTIONAL are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they
appear in all capitals.

2.2. Terms.

| Term | Meaning |
|---|---|
| tool | One executable that claims conformance (`canon`, `lute`). |
| caller | The agent, script or person running the tool. |
| command | A runnable node of the command tree, named by its **path** (`["finding","close"]`) and its **id**, the path words joined by one space (`finding close`). |
| group | A node that only groups commands (`finding`). |
| operand | A positional argument. |
| option | A named argument, `--name` or `--name <VALUE>`. |
| switch | An option that takes no value. |
| argument | An operand or an option, however given (argv, `--input`). |
| JSON mode | The invocation contains `--json` (4.3.4). |
| envelope | The JSON document a command prints in JSON mode (6). |
| report | A JSON document printed inside the envelope (`data`). |
| artifact | Bytes printed as they are (Markdown, CSV) in text mode. |
| stream | Output produced over time (13). |
| effect | A change the command makes to state the tool or its user owns: files, records, remote objects, processes. |
| refusal | A failure with exit 2: the command did not run and changed nothing (8). |
| registry | The tool's table of error codes with their exit, retryability, meaning and fix (7.4). |
| condition | The last part of an error code's name, from the fixed vocabulary of 7.2.2; it fixes the code's exit and retryability. |
| core code | An error code this document defines and every tool shares (7.3). |

2.3. JSON member names in prose are written `like.this`; `data.kind` means the member `kind` of the member `data`.
Placeholders are written `<LIKE_THIS>`. JSON pointers are RFC 6901.

2.4. A rule fixed by an owner decision cites it as `[Appendix A D<n>]`. Appendix B lists the prior art.

## 3. Conformance

3.1. **Roles.** A tool conforms when every invocation, every document it prints and every exit status follows the
rules of this document for the minor it declares (15.7) and the level it claims. A caller conforms when it reads
documents as 15.6 and 15.8 say and acts only on what the protocol defines (it never parses `message`, text output or
stderr).

3.2. **Levels.** A tool conforms at one of three cumulative levels.

| Level | Adds | Sections |
|---|---|---|
| **L0** | Output selection, output channels, the envelope, errors and the registry, exit status, versioning, security | 4.3, 4.4.1, 5, 6, 7, 8, 15, 16 |
| **L1** | The command tree, argv syntax, reserved options and command design, and the `schema` self-description with report schemas | 4.1, 4.2, 4.4.2, 4.5, 4.6, 4.7, 9 (9.11 OPTIONAL) |
| **L2** | `--input`, the destructive exchange, long-running work and streams, the embedded guide | 4.4.3, 10, 11, 12, 13, 14 |

3.3. **No upward requirements.** A rule of a level never requires a feature of a higher level. Where a section of a
lower level mentions a higher-level feature, the mention applies only to a tool that offers it: an L0 tool need not
have `schema`; an L1 tool need not have `--input`, the destructive exchange or `skills show`; the self-description
schema accepts a destructive command without `--commit` (that requirement is L2, 11.4).

3.4. A tool MAY offer features of a higher level than it claims. A feature it offers MUST follow this document (an
L1 tool with `--input` follows section 10).

3.5. **Declaration and claims.** A tool at L1 or L2 declares its level as `data.level` of its `schema` tree (9.3);
an L0 tool has no machine declaration of its level. Every tool declares the minor it implements in
`meta.contractVersion` (15.7). A claim names both, for a release: "ATIP 1.3 L1 conformant". A tool MUST NOT claim a
level whose rules it does not follow.

3.6. **Exceptions are declared, not silent.** A command that cannot follow a rule (a passthrough to a child process,
a hook whose stdin format another program owns) MUST declare the exception in its self-description: its output kind
(9.9) and its `effectNote` (9.5). There is no other exception mechanism.

3.7. **Testing conformance** (informative). Conformance is defined by this document alone. `approaches/checker.md`
describes a conformance tool that runs a built binary and tests it against the rules above. Its findings are
evidence, not the definition: a failed check points at the rule it tests, and a passing run cannot observe every
rule (remote effects, that a preview lists every effect, that no call site overrides an exit, operation-key
atomicity), which the tool's own tests cover. The examples and `scripts/check.ts` in this repository test documents,
not tools.

## 4. Invocation

### 4.1. The command tree

4.1.1. **Shape.** A command path is a group noun followed by a verb (`finding close`, `page label`), or one word for a
root command (`schema`, `status`, `init`). Paths SHOULD NOT be longer than two words. Words are lower kebab-case,
`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. [Appendix A D4, D11.14]

4.1.2. **Groups only group.** A group MUST NOT be runnable; run bare, it refuses with `COMMAND_REQUIRED` listing its
commands in `expected`. A node is either a group or a command, never both.

### 4.2. Argv syntax

4.2.1. Every conforming parser accepts at least this syntax, and callers (examples, `next`, guides) use only this
syntax. The grammar is RFC 5234 ABNF over the **sequence of argv elements**: `SEP` stands for the boundary between
two elements, and a rule whose name ends in `-word` matches one whole element. It is not shell syntax; quoting is
the shell's business.

```abnf
invocation    = *( global SEP ) path *( SEP argument ) [ SEP "--" *( SEP operand-word ) ]
path          = command-word *( SEP command-word )
command-word  = name
argument      = option / free-operand
option        = long-switch / long-joined / long-separate / short-form
long-switch   = "--" name                         ; a switch, or one occurrence of a count
long-joined   = "--" name "=" value               ; value: the rest of the element, possibly empty
long-separate = "--" name SEP plain-word          ; the next element is the value; it does not start with "-"
short-form    = "-" ALPHA [ SEP plain-word ]      ; only for declared short options (9.7)
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

4.2.2. Semantics:

- A repeatable option is given once per value (`--label a --label b`); its values keep their order. A comma list is
  a single value whose syntax the option documents (`--fields a,b`).
- A count is given once per occurrence (`--verbose --verbose`).
- `--name=value` and `--name value` are equivalent when both are in the grammar. A value that is empty or starts
  with `-` (including `--`), other than exactly `-`, can only be written `--name=value`; the value `-` may be written
  either way. A tool MUST accept the joined form for every valued option, and MAY accept other `-`-leading values in
  the separate form, which callers do not rely on.
- The first element that is exactly `--` ends the options: every later element is an operand (or a passthrough
  word, 8.7), even when it starts with `-`. A tool MUST accept operands after `--`.
- Options and operands may be interleaved before `--`; their relative order does not matter except among operands.
- A declared short option is equivalent to its long name (`-o x` is `--output x`); short options have no joined or
  bundled forms.

### 4.3. Output selection

4.3.1. **Text is the default.** Without `--json`, a command prints text meant for a person. The text is not part of
the protocol and MAY change in any release.

4.3.2. **`--json` selects the protocol.** Every command whose outputs (9.9) include a report or an artifact MUST
accept `--json`; with it the command prints exactly one envelope (6) on stdout. For an artifact, `data` is the
artifact's JSON representation, described by that output's `schemaRef`. A stream command with `--json` prints the
stream lines of 13.

4.3.3. **Nothing else switches the output.** The output kind (text, envelope, stream) and the shape of the JSON
document MUST NOT depend on whether stdout or stdin is a terminal, on environment variables (`CI`, `CLAUDECODE`,
`OUTPUT_FORMAT`) or on configuration files. This governs presentation only: what a command reports MAY change with
its declared inputs, including an option's declared `env` variable, its context discovery and the configuration and
state it reads (6.7, 10.7). Text styling MAY follow `NO_COLOR`, `TERM` and whether stdout is a terminal; the JSON
document MUST NOT. Environment variables never authorise anything (11.8) and never filter `schema` (9.2.2).

4.3.4. **JSON mode is decided from argv before parsing.** A tool MUST treat an invocation as JSON mode when the
element `--json` appears before the first `--`, even when parsing then fails, so that an unknown command, an
unknown option or a missing value is reported as a JSON failure envelope.

4.3.5. `--json` MUST be accepted after the command path, anywhere before `--`. A tool MAY also accept it before the
path. Examples and `next` entries use the post-path form. [Appendix A D11.15]

### 4.4. Help and version

4.4.1. `--help`/`-h` and `--version`/`-V` print text and exit 0. A tool MAY answer `--help --json` with the `schema`
document of the same path (L1). `--version` SHOULD print `<tool> <version>` on one line.

4.4.2. (L1) The first line of the root `--help` MUST point agents at the self-description, for example
`Agents: "canon schema --json" describes every command as JSON.` Every other `--help` SHOULD carry the same line. A
tool MUST NOT point at a `schema` command it does not have.

4.4.3. (L2) The same line MUST also name the guide (`"canon skills show" is the guide.`).

### 4.5. Reserved options

These names have one meaning in every tool and MUST NOT be used for anything else. A tool need not offer them; where
it offers the behaviour, it uses the name. A **flag-only** option is never a key of an `--input` document (10.6).

| Option | Meaning | Flag-only | Section |
|---|---|---|---|
| `--json` | Select the envelope or the stream lines. | yes | 4.3 |
| `--input <JSON\|FILE\|->` | The arguments as a JSON document. | yes | 10 |
| `--commit`, `--plan-digest <DIGEST>` | Carry out a previewed destructive plan. | yes | 11 |
| `--dry-run` | Validate fully, report what would change, change nothing. | | 11.10 |
| `--limit <N>`, `--cursor <CURSOR>`, `--all` | Paging; `--all` asks for every remaining item, a `--limit` without a bound. | yes | 6.9 |
| `--fields <FIELDS>` | Field selection. | yes | 6.10 |
| `--operation <KEY>` | A caller-chosen operation key. | | 12.4 |
| `--help`, `--version` | | | 4.4 |

No option may authorise a destructive act except `--commit --plan-digest`; in particular `--yes` and `--force` MUST
NOT (11.8). [Appendix A D7, D11.5, D11.10, D11.11, D32]

### 4.6. Command design

4.6.1. **Actions and modes.** Actions are verbs. Read-only views MAY be nouns (`status`, `context`) and then have
effect `read`. An option MUST NOT change a command's effect class or turn it into a different action with its own
arguments (`report --check` beside a `report` that writes); such a mode is its own command. Not modes in this sense:
output selection (`--json`, `--format` for alternative text formats), views of the same data (`--fields`, `--full`,
paging, `schema --errors`), waiting (`--wait`, `--timeout`), preview and commit (`--commit`, `--plan-digest`,
`--dry-run`), and an output variant the command declares (`compile --stream`, 9.9.1 `when`).

4.6.2. **The primary object is an operand.** When a command acts on or shows one kind of object, that object is the
operand: `finding close <CHANGE_ID>`. A command has at most one operand kind; several objects of that kind are a
variadic operand; two in a meaningful order are allowed (`diff <BEFORE> <AFTER>`). Context (repository, project,
run) is never an operand. Values that modify the object are options. [Appendix A D4]

4.6.3. **Other identifiers are bare-noun options**: `--change`, `--run`, never `--change-id`. An option name MUST
NOT end in `-id`. [Appendix A D4]

4.6.4. **One spelling, one meaning.** Within a tool, an option name has one value name, one value type and one
meaning on every command that takes it; only `required`, the default and a subset of a shared enum may differ.

4.6.5. **Option names** are lower kebab-case long names. A tool SHOULD NOT define short options other than `-h` and
`-V`; an existing short option is listed in the self-description (9.7). Prefix abbreviation of options or commands
MUST NOT be accepted. [Appendix A D11.18]

4.6.6. **Unknown is an error.** An unknown command, option or enum value refuses before any effect, with `expected`
and `suggestions`; nothing is auto-corrected. An option a command cannot honour with the others refuses by name
rather than being ignored.

4.6.7. **Clean cutover.** A renamed or removed command or option is not kept as an alias. A tool MAY recognise a
removed spelling only to refuse it with `UNKNOWN_COMMAND` or `USAGE` whose `hint` is the replacement. [Appendix A D4]

4.6.8. **Values.** Times are RFC 3339; a bare `YYYY-MM-DD` MAY mean UTC midnight. A `<DURATION>` is one or more
`<integer><unit>` pairs, units `ms`, `s`, `m`, `h`, `d` in decreasing order (`90s`, `1h30m`); a bare integer means
seconds. Paths are relative to the working directory, on argv and inside `--input`.

### 4.7. Tool-wide options

A tool-wide option is one every command accepts with the same meaning (`--json`, and context options such as
`--repo`). A tool SHOULD accept its tool-wide options wherever it accepts `--json`, after a group word as well as
after a command, so that `canon finding --repo . --json` is answered with `COMMAND_REQUIRED` in JSON mode rather
than with `USAGE`. Such an option does nothing on a group but is not an error there. [Appendix A D25]

## 5. Output channels

5.1. In JSON mode, stdout MUST hold exactly one JSON document followed by one newline, and nothing else, for success
and for failure. The only exception is a stream (13), whose lines are each one JSON document.

5.2. In JSON mode, stderr MUST NOT carry the result or the error, and SHOULD be empty. A long-running command MAY
write progress or heartbeat lines to stderr. Callers MUST NOT parse stderr.

5.3. In text mode, stdout holds only the result; errors, warnings and progress go to stderr. A refusal (exit 2)
prints nothing on stdout. A command that ran and exits 1 MAY print its result, partial or negative (the findings of
a check), on stdout, with the error on stderr. [Appendix A D26]

5.4. The JSON document SHOULD be compact (no indentation). It MUST be UTF-8.

5.5. A tool MUST NOT prompt. If a value is missing the command refuses. Nothing reads stdin except `--input -`
(10.2) and options that declare `-` as a value; stdin is read at most once.

5.6. Failures before the tool's own code runs (a runtime that cannot load a module, an out-of-memory kill) cannot
always be enveloped. A tool MUST make them exit non-zero and SHOULD keep stdout empty. A failure that reaches the
tool's code MUST be enveloped in JSON mode.

## 6. Response envelope

Normative shape: `schema/envelope.schema.json`.

6.1. Success is `{"ok": true, "data": <report>, "meta": {…}}`. Failure is `{"ok": false, "error": {…}, "meta": {…}}`,
with `data` OPTIONAL (6.4). No other top-level members are allowed. [Appendix A D1]

6.2. `ok` MUST be `true` exactly when the exit status is 0.

6.3. Keys of the envelope, of `meta`, of `error` and of reports are camelCase. A report MAY embed a stored record
verbatim with that record's own key case; the report's JSON Schema shows where, and callers MUST NOT assume keys are
camelCase below such a record. [Appendix A D1]

6.4. On failure, `data` MAY carry the partial report of a command that ran: the findings of a failed check, the
batch report of a batch that stopped (10.11). A refusal (exit 2) MUST NOT carry `data`. When present, `data` follows
one of the command's output schemas, named by `meta.output`.

6.5. Optional members of the envelope, of `meta` and of `error` are omitted when absent, never `null`. Inside `data`,
the report's schema decides.

6.6. **`meta`.** No members other than these are allowed; tool-specific metadata goes under `x-<tool>` (9.12).

| Member | | Meaning |
|---|---|---|
| `schemaVersion` | REQUIRED | `<major>.<minor>` of the output `data` follows (6.11); on a `schema` answer, the version of the self-description format (9.1.4). |
| `tool` | REQUIRED | The executable name. |
| `toolVersion` | REQUIRED | The tool release. Never part of `schemaVersion`. |
| `command` | REQUIRED when resolved | The id of the command, or the longest path resolved before the failure (`finding` when the verb is unknown). Omitted when not even the first word resolved. |
| `contract` | REQUIRED (15.7) | `"atip/1"`. [Appendix A D11.12, D20] |
| `contractVersion` | REQUIRED (15.7) | The minor the tool implements, `<major>.<minor>` (`"1.3"`). Absent means `"1.0"`. [Appendix A D20] |
| `output` | REQUIRED when `data` is present and the command declares more than one output; OPTIONAL otherwise | The name of the output schema `data` follows (the key in the command's `schemas`, 9.9), so a caller can pick the decoder without inferring it. The batch report of a batch input is an output of its own (10.11). [Appendix A D12.1, D26] |
| `context` | OPTIONAL | 6.7. |
| `next` | OPTIONAL | 6.8. |
| `warnings` | OPTIONAL | 7.5. |
| `coverage` | OPTIONAL | What a check or listing examined (8.5). |
| `page` | REQUIRED on a paged answer | `{returned, nextCursor?, total?}` (6.9). |
| `fields` | REQUIRED on a projected answer | The field paths `data` was projected to (6.10). |
| `truncated` | REQUIRED on a cut answer | `{path, kept, total?, bytes?, maxBytes?}` (6.9). |
| `x-<tool>` | OPTIONAL | Tool-specific. |

6.7. **Context.** `meta.context` reports the context the command resolved, so a caller can repeat it explicitly.
Its keys are the camelCase names of the options that select context (`repo`, `project`, `run`); each value is the
value the command used, whether given or resolved; paths are relative to the working directory; a key whose context
was not used is omitted. Precedence, as for every option (10.7 step 5): an explicit value (argv or `--input`) wins
over its environment variable, which wins over discovery or the default; an explicit value is never replaced by a
discovered one. [Appendix A D11.4]

6.8. **Next steps.** `meta.next` lists runnable follow-up commands, best first, on success and on failure:
`[{command, argv, reason?, x-<tool>?}]`.

- `argv` is the invocation as argument words **without** the executable. Every word is literal: no placeholder, no
  ellipsis, nothing the caller fills in. A step that needs a value the tool does not have is not a `next` entry (see
  `hint`, 7.1.2).
- `command` is the same invocation as one display string: splitting it as a POSIX shell would (without expansion)
  MUST give back exactly the tool name followed by `argv`. A tool SHOULD write it as the tool name and the words of
  `argv` joined by single spaces, each word that is empty or contains whitespace, a quote, a backslash or a shell
  metacharacter in single quotes (a single quote inside as `'\''`).
- When the current invocation is in JSON mode and the next command accepts `--json`, its `argv` MUST include
  `--json`.
- Transport-specific members (an RPC transport's own keys) go under `x-<tool>`. [Appendix A D11.6]

6.9. **Paging and truncation.** A command that pages takes the reserved options `--limit <N>`, `--cursor <CURSOR>`
and `--all` (4.5). A paged answer carries `meta.page`: `returned` (items in this answer), `nextCursor` (opaque,
present exactly when more items follow) and `total` (when known). When `nextCursor` is present, `meta.next` MUST
contain a **next-page entry**, at any position: the same invocation with `--cursor <nextCursor>`, carrying the
arguments the invocation gave, so that run in the same environment it continues the listing.

A cursor is bound to the values that decide the result set: every argument except `--json`, `--limit`, `--all`,
`--cursor` and `--fields`, whether given or taken from its option's `env` variable. A cursor given with other bound
values, or not produced by this command, refuses with `CURSOR_INVALID` (`field` `--cursor`), so that changing a
filter never skips or repeats records silently. A caller pages with the next-page entry's arguments, in the same
environment, changing at most `--limit`, `--all` and `--fields`. (Whether an argument given at its default value
counts as a change, and what the next-page entry carries exactly: `approaches/implementation.md`.)

A report MAY keep paging members of its own in `data`; `meta.page` is the protocol's and is authoritative when the
two differ. An answer cut by size (not by paging) carries `meta.truncated`: `path` (JSON pointer of the list or
value cut), `kept`, and `total`, `bytes`, `maxBytes` when known, plus a `next` entry that reaches the rest.
[Appendix A D11.5, D16.1, D26, D32]

6.10. **Field selection.** A command whose output declares `fields` (9.9) takes the reserved option
`--fields <FIELDS>`: a comma-separated list of field paths from that declaration. It parses and validates
`--fields` the same way with or without `--json` (an unknown path refuses in both modes); what the selection does to
text is the tool's.

**Paths.** A field path is a dot path into a record (`profile.name`); `name[]` descends into each element of the
array `name` (`tags[]`, `owners[].email`). A path goes through an array only with `[]` (`owners.email` is not a path
when `owners` is an array); a last segment without `[]` may name a whole array. A member whose name is not an
identifier (`[A-Za-z_][A-Za-z0-9_]*`) is written as a bracketed JSON-like string instead of `.name`:
`attributes["http.status-code"]`, `["x.y"].value`. Inside the quotes only `\"` and `\\` are escapes; every other
character except U+0000 stands for itself, and the quotes may enclose nothing. A member whose name is an identifier
is always written with a dot, so each member has exactly one spelling and `meta.fields` compares as text. In the
`--fields` value, commas inside a bracketed key do not separate paths.

**Records.** The records are the values at `fields.records`, an RFC 6901 pointer into `data` through object members
only; when the value there is an array, each element is a record.

**Map keys.** A declared path whose schema is a *map* (an object schema whose `additionalProperties` is a schema,
`true` included, and whose `properties` is absent or empty) also makes each of its keys selectable, one key deep,
except a key that contains U+0000: `attributes.region`, `attributes["http.status-code"]`. The map is the schema the
declared path names: `labels` declared as an array of maps selects keys through `labels[]` (`labels[].region`). A
key the record does not have is absent from the projection.

**Projection.** For each record:

1. The kept paths are the selected paths plus the declaration's `keep` paths.
2. A kept path *covers* a member when the member's path equals or extends it. A member is present exactly when a
   kept path covers it or when it is a proper ancestor of a kept path. A covered member is kept whole.
3. An ancestor that is not covered keeps only its members present by rule 2; an array on the way keeps every element,
   each projected the same way; a `null` ancestor stays `null`.
4. A present member appears whenever the unprojected record has it; a member that is not present is absent.
5. `meta.fields` lists the kept paths.
6. An unknown path refuses with `USAGE`, `field` `--fields`, `expected` the selectable paths.

**Projected schema.** The projected `data` validates against the output schema with one change: in every object cut
node at or below the record, `required` is reduced to the members present by rule 2. The *cut nodes* are the schemas
from the output's root schema to every selectable field: the root, the schemas `fields.records` goes through and
the one it reaches, the record schema, every schema of a proper ancestor of a declared path, and a declared map,
each reached through `$ref`, a null-admitting union and, for an array, `items`. Every cut node MUST be
**projectable**, so that a projection of a valid value is always valid:

- an object schema with `type` `"object"` (or `["object","null"]`), using only `properties`, `required`,
  `additionalProperties` and annotations (`title`, `description`, `default`, `examples`, `deprecated`, `readOnly`,
  `writeOnly`, `$comment`); or an array schema with `type` `"array"` (or with `"null"`), using only `items`,
  `minItems`, `maxItems` and annotations; never a boolean schema;
- or only a `$ref` to a schema in `schemas`, itself a cut node; or only an `anyOf` of exactly two branches, one of
  them `{"type": "null"}`, the other a cut node; each with annotations.

In particular no cut node has `const`, `enum`, `uniqueItems`, `minProperties`, `maxProperties`, `dependentRequired`,
`dependentSchemas`, `patternProperties`, `propertyNames`, `unevaluatedProperties`, `if`/`then`/`else`, `oneOf`,
`allOf`, `not` or `contains`. Every other schema (a leaf, a member kept whole, a member outside every declared path)
is unrestricted.

**Several shapes.** Selection is declared per output (9.9.1): a command whose answer takes one of two shapes can
declare two report outputs, each with its own `fields`, and `--fields` is read against the output the invocation
selects. An output whose root or record schema is a union other than the nullable form above declares no `fields`.
A batch input selects the batch output (10.11): `--fields` is read against that output's `fields`, as paths into
the batch report, and refuses with `USAGE` when it declares none. [Appendix A D11.5, D16.2, D23, D30, D31, D32]

6.11. **Version of `data`.** `meta.schemaVersion` is the version of the output `data` follows (the one `meta.output`
names when there are several). On a failure without `data`, it is the version of the output the invocation would
have produced: the batch output for a batch input, otherwise the command's first output without `batch`. Before a
command is resolved it is `"1.0"`.

## 7. Errors

Normative shapes: `schema/error.schema.json`, `schema/registry-entry.schema.json`, `schema/warning-entry.schema.json`.

### 7.1. The error object

7.1.1. `error` has REQUIRED `code`, `message`, `retryable`, and OPTIONAL `reason`, `hint`, `field`, `expected`,
`received`, `suggestions`, `details`, `x-<tool>`. [Appendix A D2, D21]

| Member | Meaning |
|---|---|
| `code` | UPPER_SNAKE_CASE, registered (7.4), named as 7.2 says. Callers branch on it. |
| `reason` | UPPER_SNAKE_CASE: which of the situations registered under `code` this is (7.6). A caller that does not know the reason treats the error by its code alone. |
| `message` | One sentence for a person. Not stable; callers MUST NOT parse it. |
| `retryable` | `true` only when repeating the same invocation unchanged can succeed. Equal to the registry's (7.4.3). |
| `hint` | Advice for the next attempt (7.1.2). A literal runnable command belongs in `meta.next`. |
| `field` | The argument at fault: the option as written on argv (`--round`), an operand's value name (`CHANGE_ID`), `command` for a command word, `--input` for the input value as a whole, or a JSON pointer into the `--input` document when the value came from it (10.8). |
| `expected` | The valid set, when there is one. |
| `received` | What was given, redacted when it may hold a secret (16.1). Never null. |
| `suggestions` | Close matches from `expected`, best first. Omitted when empty. |
| `details` | Only when one input yields several errors. Each item has `code`, `message` and the optional members above except `retryable` and `details`; the top-level `code` summarises. |

7.1.2. **Hint forms.** A `hint` is exactly one of: a runnable invocation; a command template whose missing values are
`<UPPER_CASE>` placeholders; or one sentence of prose. A hint that starts with the tool name followed by a space is
an invocation or a template: it splits as a POSIX shell would, like `meta.next[].command`, and holds nothing but that
command line. Prose is worded so that it does not start with the tool name and a space. Callers MUST NOT run a hint
without checking it for placeholders. [Appendix A D26]

7.1.3. **`USAGE` names the argument.** A `USAGE` error SHOULD carry `field`. When the tool cannot map the problem to
an argument (a backend rejects a request built from several arguments), it omits `field`, and its `hint` SHOULD be
`<tool> schema <command> --json` for the command that was run (its `--help` when the tool has no `schema`), or
`<tool> schema --json` (`<tool> --help`) when no command was resolved. [Appendix A D26]

### 7.2. Code names

A caller meets codes from many tools. So that it can act on a code it has never seen, every code a tool defines
follows one convention: the code names a subject and a condition, and the condition alone fixes the exit status, the
retryability and what the caller does, as an HTTP client acts on 404, 409 or 503 without knowing the server. Codes
this document defines for every tool are listed in 7.3. [Appendix A D36]

7.2.1. **Grammar.**

```abnf
code      = subject "_" condition
subject   = UPPER *( UPPER / DIGIT ) *( "_" 1*( UPPER / DIGIT ) )
condition = "INVALID" / "REQUIRED" / "NOT_FOUND" / "EXISTS" / "CONFLICT" / "STALE" / "EXPIRED"
          / "DENIED" / "UNSUPPORTED" / "TOO_LARGE" / "UNAVAILABLE" / "FAILED" / "INCOMPLETE" / "TIMEOUT"
UPPER     = %x41-5A
```

The condition is the vocabulary entry the code ends with (`FINDING_NOT_FOUND`: subject
`FINDING`, condition `NOT_FOUND`). The **subject** is a noun phrase naming what the condition is about: an object
kind (`FINDING`, `MEMBER`), an argument or input (`ROUND`, `INPUT`), a resource or dependency (`STORE`, `LOGIN`,
`LOCK`), or a unit of work named as a noun (`PROMOTION`, `DEPLOYMENT`, `SYNC`, never the verb `PROMOTE`). A tool
spells one subject the same way in every code and SHOULD use the nouns of its command tree.

7.2.2. **Conditions.** Exit 2 conditions are refusals: the command did not run and changed nothing (8.2). Exit 1
conditions say the command ran (8.3).

| Condition | Exit | Retryable | The command | The caller |
|---|---|---|---|---|
| `INVALID` | 2 | no | refused a value it was given: malformed, out of range or not allowed (an argument, a document, the content of a file it names) | changes the value `field` names |
| `REQUIRED` | 2 | no | refused because something it needs was not given or not set up: an argument, a choice among several candidates, a configuration, a login | supplies it, as `hint` or `next` says |
| `NOT_FOUND` | 2 | no | refused because an object the invocation names does not exist | checks the name (`expected`, `suggestions`) or lists the objects |
| `EXISTS` | 2 | no | refused because the object it would create already exists | uses that object or chooses another name |
| `CONFLICT` | 2 | no | refused because the request contradicts itself or its target's state: two given values disagree; the target is in a state that does not allow the action (closed, ended, still staged) | reads the target's state and changes the request |
| `STALE` | 2 | no | refused a value the caller took from an earlier answer that no longer matches the state (a plan digest, a revision) | reads again (`next`), then repeats with the fresh value |
| `EXPIRED` | 2 | no | refused something valid for a limited time that has lapsed: a login, a token, a lease, a cursor | obtains a new one |
| `DENIED` | 2 | no | refused because the caller is not permitted: a role, a permission, a policy, an act only a person may take (11.9) | does not repeat it; hands it to whoever may (`hint`) |
| `UNSUPPORTED` | 2 | no | refused a well-formed request that this tool, build, platform or remote system cannot do | does not repeat it; uses another way |
| `TOO_LARGE` | 2 | no | refused a request beyond a declared limit (bytes, items, a range) | splits or narrows it |
| `UNAVAILABLE` | 2 | yes | refused because something it needs is not available now: a backend that cannot be reached, a lock or lease another run holds, a port in use, a rate limit | repeats it unchanged later |
| `FAILED` | 1 | no | ran and its outcome is negative: a check found problems, or the work or a step of it did not succeed; `data` carries the result when there is one | reads `data` and `next`; a `write` or `destructive` command may have made effects |
| `INCOMPLETE` | 1 | no | ran and stopped before it covered all it was asked: a batch stopped at an item, a command that works in steps stopped after earlier steps (8.3.2), a walk could not reach its whole scope; what was done stays done | reads what was done (`data`, `next`) before repeating, since a blind repeat may repeat the steps that ran |
| `TIMEOUT` | 1 | yes | ran out of time while waiting or working under a time limit; the work may still finish (12.3) | repeats the wait (`next`) |

When two conditions seem to fit, the one whose caller action resolves the situation is right: a malformed id is
`INVALID`, a well-formed id that names nothing `NOT_FOUND`; a missing login is `REQUIRED`, a lapsed one `EXPIRED`, a
login without the needed role `DENIED`; a lock another run holds is `UNAVAILABLE`, an object whose state forbids the
act `CONFLICT`.

7.2.3. **Rules.** In a document that declares 1.3 (15.7):

- Every error code is a core code (7.3) or follows 7.2.1. A tool's own code never takes a core code's name.
- A code's registered `exit` is its condition's. Its `retryable` is its condition's, except that a `FAILED` or
  `INCOMPLETE` code MAY be registered `retryable: true` when repeating the same invocation unchanged resumes or
  completes the work without repeating any effect (a replay-safe command, 11.3).
- A situation that needs another condition needs another code (7.4.2): a code never covers a precondition failure
  and a failure during the work (8.3). Situations that share a condition and a caller action share one code and are
  told apart by reasons (7.6).

Callers MAY derive a code's exit and retryability from its condition in a 1.3 document; the error's `retryable` and
the exit status remain authoritative.

7.2.4. **Warning codes** (7.5) SHOULD follow the same shape, `<SUBJECT>_<STATE>`, with a condition of 7.2.2 where
one fits; a warning has no exit, so it MAY end in another state word (`MEMBER_ARCHIVED`, `TOTAL_ESTIMATED`,
`OPTION_DEPRECATED`).

7.2.5. **Examples.** Codes canon registered before the convention, and their names under it:

| Before | Exit | What happened | Under 7.2 |
|---|---|---|---|
| `PROMOTE_REFUSED` | 1 | a gate ran over staged records and refused some; `data` names each | `PROMOTION_FAILED` (a negative outcome of work that ran; "refused" is the word of exit 2) |
| `INVENTORY_ABORTED` | 1 | a sync aborted the spec roots that held violations or duplicate scenarios; `data` names each | `INVENTORY_INCOMPLETE`, with reasons naming why a root was aborted |
| `PLUGIN_SYNC_ERRORS` | 1 | a sync could not write some candidates; `data` names each error | `PLUGIN_WRITE_FAILED` (`PLUGIN_SYNC_FAILED` is taken: canon already uses it, with exit 2, for "could not start", which splits by cause into `CONFIG_INVALID`, `PLUGIN_REQUIRED` and the like; a code name is never reused with another meaning, 15.5) |
| `INVENTORY_REFUSED` | 2 | could not start: the configuration is unusable, or another process holds the index lock | two codes, `CONFIG_INVALID` (not retryable) and `INDEX_UNAVAILABLE` (retryable): one name hid two caller actions |

### 7.3. Core codes

7.3.1. These situations occur in every tool, and callers branch on them across tools. A tool MUST use these codes
for them and MUST register each one whose situation it can produce (a tool without `--input` does not register the
`INPUT_*` codes). A command that offers a feature lists that feature's codes in its `errors` (9.5): `--input` gives
the three `INPUT_*` codes, `input.batch` gives `BATCH_INCOMPLETE`, `--commit` gives `PLAN_STALE`, `--operation`
gives `OPERATION_REUSED`, and `--cursor` gives `CURSOR_INVALID`. Seven names follow 7.2; five (`USAGE`,
`UNKNOWN_COMMAND`, `INTERNAL`, `UNVERIFIABLE`, `OPERATION_REUSED`) are older than the convention and keep their names,
since renaming a core code is a major change (15.1). [Appendix A D11.9, D12.2, D16.1, D36]

| Code | Exit | Retryable | Condition | When | Applies |
|---|---|---|---|---|---|
| `USAGE` | 2 | no | — | The command line does not parse or does not satisfy the command's requirements: unknown option, missing or invalid value, unexpected operand, a violated constraint (9.8) without a more specific code. `field` names the argument. | L0 |
| `UNKNOWN_COMMAND` | 2 | no | — | A command word is not in the tree. `expected` lists the valid words at that level. | L0 |
| `COMMAND_REQUIRED` | 2 | no | `REQUIRED` | A group (or the bare tool) was run without a command. `expected` lists its commands. | L0 |
| `INTERNAL` | 1 | no | — | A bug in the tool. The message says how to report it. | L0 |
| `UNVERIFIABLE` | 1 | no | — | A check ran but could examine nothing in its scope, so it cannot report a clean result (8.5). | tools with checks |
| `INPUT_INVALID` | 2 | no | `INVALID` | `--input` cannot be read or framed, or a document fails its fragment schema (10.7 steps 1-2). | tools with `--input` |
| `INPUT_CONFLICT` | 2 | no | `CONFLICT` | A document value and an explicit argv argument differ (10.7 step 3). | tools with `--input` |
| `INPUT_TOO_LARGE` | 2 | no | `TOO_LARGE` | `--input` exceeds `input.maxBytes`, or a batch exceeds `input.maxItems`. | tools with `--input` |
| `BATCH_INCOMPLETE` | 1 | no | `INCOMPLETE` | A batch stopped during execution (10.11). | tools with batches |
| `PLAN_STALE` | 2 | no | `STALE` | `--plan-digest` no longer matches the recomputed plan (11.7). | tools with destructive commands |
| `OPERATION_REUSED` | 2 | no | — | An operation key (12.4) was used before with a different payload. | tools with `--operation` |
| `CURSOR_INVALID` | 2 | no | `INVALID` | A `--cursor` was not produced by this command, or was produced with other arguments (6.9). `field` is `--cursor`. | tools with `--cursor` |

7.3.2. **Finer parse codes.** A tool MAY register finer codes for parse failures in place of `USAGE`
(`OPTION_REQUIRED`, `VALUE_INVALID`) only if it never emits `USAGE` for the same situation; one situation has one
code within a tool. Callers treat any exit-2 code whose `field` names an argument as a usage problem. Under every
other core code a tool tells situations apart with registered reasons (7.6), never with finer codes, so that a
caller branching on the core code still sees it.

7.3.3. **Reserved reasons.** When a tool registers a reason for one of these situations under a core code, it SHOULD
use the name given here, so that callers can branch on it across tools. A tool MAY register other reasons under a
core code. [Appendix A D21]

| Code | Reason | Situation |
|---|---|---|
| `INPUT_INVALID` | `UNREADABLE` | The file named by `--input` cannot be read. |
| `INPUT_INVALID` | `STDIN_TTY` | `--input -` with stdin attached to a terminal (10.3). |
| `INPUT_INVALID` | `EMPTY` | The value or the source is empty (10.2). |
| `INPUT_INVALID` | `NOT_JSON` | The source is not JSON, nor NDJSON where that is allowed (10.4). |
| `INPUT_INVALID` | `NOT_OBJECT` | A document, or an item of a batch, is not a JSON object (10.4, 10.5). |
| `INPUT_INVALID` | `BATCH_UNSUPPORTED` | A batch for a command whose `input.batch` is not `true` (10.4). |
| `INPUT_INVALID` | `UNKNOWN_KEY` | A document key that is not a document key of the command (10.5). |
| `INPUT_INVALID` | `FLAG_ONLY_KEY` | A document key that names a flag-only option (10.6). |
| `INPUT_INVALID` | `INVALID_VALUE` | A value of the wrong type, outside its enum, or `null` (10.5, 10.7 step 2). |
| `INPUT_TOO_LARGE` | `TOO_MANY_BYTES` | The source exceeds `input.maxBytes`. |
| `INPUT_TOO_LARGE` | `TOO_MANY_ITEMS` | A batch exceeds `input.maxItems`. |
| `CURSOR_INVALID` | `FOREIGN` | The cursor was not produced by this command, or is not a cursor. |
| `CURSOR_INVALID` | `ARGUMENTS_CHANGED` | The cursor was produced with other arguments (6.9). |
| `CURSOR_INVALID` | `EXPIRED` | The cursor was produced by this command with these arguments but is no longer valid. |

### 7.4. The registry

7.4.1. Every tool has one error registry: entries `{code, exit, retryable, meaning, fix}`, plus OPTIONAL `reasons`
(7.6). Every code the tool can emit as an error MUST be in it. A code MUST NOT be reused with another meaning.
`fix` is prose and MAY contain `<PLACEHOLDER>`s. [Appendix A D2]

7.4.2. The exit status of a failure is the `exit` of its code. It MUST NOT be overridden at a call site. A situation
that needs another exit needs another code: a code that would need two exits is split into two, and a reason never
changes the exit. [Appendix A D11.8, D15, D26]

7.4.3. `retryable` in an error MUST equal the registry entry's.

7.4.4. (L1) The registry is printed by `<tool> schema --errors --json` (`data.kind: "errors"`) and one entry by
`<tool> schema --error <CODE> --json` (`data.kind: "error"`). An unknown code refuses with `USAGE`, `field`
`--error`; a code that only the warning registry has refuses the same way, with the `hint`
`<tool> schema --warning <CODE> --json`. An L0 tool SHOULD offer both (3.4): they let a caller see the registry the
tool really uses. [Appendix A D25]

### 7.5. Warnings

7.5.1. `meta.warnings` is `[{code, message, field?}]`. Every code emitted as a warning MUST be registered (7.5.2).

7.5.2. **The warning registry**: entries `{code, meaning, fix}`, with no `exit` and no `retryable`, printed by
`<tool> schema --warnings --json` (`data.kind: "warnings"`) and one entry by `<tool> schema --warning <CODE> --json`
(`data.kind: "warning"`); an unknown code refuses with `USAGE`, `field` `--warning`. A tool that declares 1.3 MUST
register every warning code there, and in the error registry only a code that is also reported as an error. A
situation reported as a warning in some invocations and as an error in others is registered in both registries,
under the same code, with the same meaning. [Appendix A D22, D36]

7.5.3. A caller looks a warning code up in the warning registry; for a document of an earlier minor, which may keep
warning codes in the error registry (15.9), it falls back to the error registry.

### 7.6. Reasons

7.6.1. A registry entry MAY list `reasons`: `[{reason, meaning, fix}]`, the situations under its code that need
different next actions (the source is not JSON, or the shell removed the document's quotes). A reason is
UPPER_SNAKE_CASE and unique within its code; the same name under another code is another reason.

7.6.2. An error carries `reason` only when that reason is registered under the error's `code`; the same holds for
each item of `details`. A reason shares its code's `exit` and `retryable`. An error without `reason` is still
complete: a reason refines a code and never replaces it.

7.6.3. Reasons are part of the command surface (15.5): adding one is compatible, removing or renaming one is not.
[Appendix A D21]

## 8. Exit status

8.1. **The rule.** A command's exit status is one of:

| Exit | Meaning | Examples |
|---|---|---|
| 0 | Success: the command did what was asked. | A destructive preview (11.4); a check that found nothing wrong; accepted asynchronous work (12.2); an empty listing of a scope that was read (8.5). |
| 1 | **The command ran, and its answer is negative or incomplete.** | A check with findings; an `UNVERIFIABLE` check; a wait that timed out or work that ended in failure (12.3); a batch that stopped during execution (10.11); a write that began and could not finish; a command stopped part-way (8.3.2); an internal error. |
| 2 | **The command refused to run.** Nothing changed. | Usage; an unknown command; invalid or conflicting input; a missing context, configuration or prerequisite; a named object that does not exist; a stale plan; a backend or login unavailable when the command was to start; a reused operation key. |

[Appendix A D3, D15]

8.2. Exits 1 and 2 always come with a failure envelope in JSON mode; exit 0 always with a success envelope. A refusal
makes no effect at any level (11.2).

8.3. **When a command has run.** A command has *run* once it has passed its preconditions and started its work. Its
preconditions are: parsing argv and `--input` (10.7 steps 1-6), resolving the context and configuration it needs
(6.7), checking its prerequisites (a backend reachable, a login present), resolving every object the invocation
names (an id, a file, a plan digest), and reserving an operation key (12.4). A failure of a precondition is a refusal
(exit 2) whatever the command's effect class, except as 8.3.1 allows. Anything that goes wrong after the work
started is exit 1. Hence:

- A failure category that can happen both as a precondition and during the work (I/O, an unavailable backend) has
  two codes, one per stage, each with its own condition (7.2.2): `STORE_UNAVAILABLE` (exit 2), `STORE_FAILED` or
  `WRITE_FAILED` (exit 1). [Appendix A D26]
- A `read` command can exit 1 (a check with findings, an `UNVERIFIABLE` check, a wait that timed out): exit 1 says
  the answer is negative or incomplete, not that something changed.
- A batch's preconditions are its preflight (10.11). Once preflight passed, the batch has run: an item's
  state-dependent precondition is checked when that item's turn comes, and its failure, at any index including 0,
  makes the batch exit 1 with `BATCH_INCOMPLETE` while the item carries its own exit-2 code.
- `INTERNAL` is 1.

Callers branch on `code` and `retryable`, never on the exit alone. [Appendix A D11.8, D15]

8.3.1. **Conservative staging.** A `write` or `destructive` command whose failure point the tool cannot show to be
before the work started (the work is a sequence of calls to backends, any of which may be the first to change
something) MAY report that failure with its during-the-work code (exit 1). The reverse is never allowed: exit 2
means that nothing changed (8.2), so a tool reports exit 2 only for a failure it knows came before the work. A
`read` command reports its precondition failures as refusals. [Appendix A D25]

8.3.2. **Stopped part-way.** A command that does its work in steps (an orchestration of phases, a commit that makes
its effects one at a time) can meet, after an earlier step made effects, a situation it refuses with an exit-2 code
when it meets it before the work: a lease another run holds, a plan that changed between effects (11.7). It can no
longer exit 2. It SHOULD report it with one code of its own whose condition is `INCOMPLETE` (`DEPLOYMENT_INCOMPLETE`)
and whose `reason` is the code of that refusal, registered under it (7.6), rather than a during-the-work twin of each
refusal code. The reason is that code alone, never a compound name; the refused step's own reason is not carried.
`meta.next` SHOULD lead with a command that reads what was done. A failure category that has its own
during-the-work code (`WRITE_FAILED`) keeps it. A batch item that stops this way is `failed` with that code as its own
error, and the batch is `BATCH_INCOMPLETE` (10.11). [Appendix A D33, D36]

8.4. **Signals.** Termination by a signal is outside this table: no envelope is promised, and signal exits are not
registry entries. It shows either as a wait status that names the signal, or as exit 128+n (130 for SIGINT, 143 for
SIGTERM) when a launcher or wrapper ran the tool and exits on its behalf; a caller treats both the same. A launcher
SHOULD re-raise the signal or exit 128+n, never another code. A tool SHOULD release what it claimed before exiting,
and SHOULD restore the default SIGPIPE behaviour. [Appendix A D26]

8.5. **A check that examined nothing is not clean.** A check or listing that ran but could examine nothing in its
scope (the scope holds nothing of the kind it examines; every target it was to read was unreachable) MUST NOT exit 0;
it fails with `UNVERIFIABLE` (exit 1) and SHOULD say in `meta.coverage` what it looked for. A scope that does not
exist, or a configuration the command needs that is absent, is a precondition failure: a refusal with its own code
(`CONFIG_REQUIRED`). A scope that was read and holds zero items is a valid empty answer (exit 0).

8.6. **No other exits.** Exit codes other than 0, 1, 2 and signal exits MUST NOT be used. An incomplete walk is exit
1 with a registered code; a command that applied what was asked and reports what changed is exit 0 with the changes
in `data`. [Appendix A D11.1]

8.7. A passthrough command (one that runs a child process and returns its status, such as `exec -- …`) is an
exception and MUST declare it in `effectNote` (3.6).

## 9. Self-description: `schema`

Normative shapes: `schema/schema-doc.schema.json`, plus the rules of 9.13.

### 9.1. Invocation

```
<tool> schema --json                       the tree (9.3)
<tool> schema <PATH>... --json             one group (9.4) or one command (9.5)
<tool> schema --errors --json              the error registry (7.4.4)
<tool> schema --error <CODE> --json        one error registry entry
<tool> schema --warnings --json            the warning registry (7.5.2)
<tool> schema --warning <CODE> --json      one warning registry entry
<tool> schema --search "<TASK>" --json     ranked commands (9.11, OPTIONAL)
```

9.1.1. Path words MAY be given as separate words or as one quoted string (`schema "finding close"`); both MUST be
accepted.

9.1.2. A path, `--errors`, `--error`, `--warnings`, `--warning` and `--search` are mutually exclusive (`USAGE`). An
unknown path refuses with `UNKNOWN_COMMAND`, `expected` the valid words at the first unknown position (omitted when
no word is valid there, as after a leaf command) and, when it carries `field`, `command`. A tool MAY give `schema`
further options of its own (canon's `--as`). [Appendix A D30]

9.1.3. Without `--json`, `schema` prints text that is not part of the protocol; that text MAY be the JSON document
itself. [Appendix A D11.2]

9.1.4. The answer is a success envelope whose `meta.command` is `"schema"`, `meta.contract` `"atip/1"` and
`meta.schemaVersion` the version of the self-description format, which is the contract minor the tool declares
(`"1.3"`, equal to `meta.contractVersion`). `data.kind` is one of `tree`, `group`, `command`, `errors`, `error`,
`warnings`, `warning`. [Appendix A D20, D22]

### 9.2. Works without state

9.2.1. `schema` MUST answer with no repository, no configuration file, no network, no running service, no login and
no environment variables set. It MUST NOT refuse because context is missing.

9.2.2. The answer MUST NOT depend on the environment. A tool MAY filter it by an explicit option (canon's `--as`);
an environment variable MUST NOT filter it.

9.2.3. `schema` has effect `read` and writes nothing (11.2).

9.2.4. For one build, the answer SHOULD be byte-identical across runs and machines.

### 9.3. `tree`

```json
{"kind": "tree", "level": "L2", "commands": [{"command": "finding", "path": ["finding"], "kind": "group", "summary": "…"},
                                             {"command": "finding close", "path": ["finding", "close"], "kind": "command", "summary": "…", "effect": "write"}]}
```

`commands` lists every group and every command exactly once, a group before its commands, in a stable order;
`schema` is listed like any other command. An entry has `command`, `path`, `kind` (`group` or `command`), `summary`
and, for a command, `effect`. A command meant only for the tool's own use MAY be left out; `schema <PATH>` still
describes it. `level` is the level the tool claims (3.5).

### 9.4. `group`

`{kind: "group", command, path, summary, commands}`, where `commands` are the tree entries of the group's direct
children.

### 9.5. `command`

The full description of one command. Example: `examples/schema-command-canon-finding-close.json`.

| Member | | Meaning |
|---|---|---|
| `kind` | REQUIRED | `"command"` |
| `command`, `path` | REQUIRED | Id and path words. |
| `summary` | REQUIRED | One line. |
| `effect` | REQUIRED | `read`, `write` or `destructive` (11.1). |
| `idempotency` | REQUIRED for `write` and `destructive`, absent for `read` | 11.3. |
| `effectNote` | OPTIONAL | Every effect the effect class does not say: a read that appends an audit line or writes a cache; a passthrough exit (8.7); a command that serves until signalled. It describes successful runs only; it never permits a refusal or a preview to make an effect (11.2). |
| `async` | OPTIONAL, default `false` | `true`: exit 0 means the work was accepted, not done (12.2). |
| `operands` | REQUIRED | 9.6. |
| `options` | REQUIRED | 9.7. Every option the command accepts, including inherited and shared ones (`--json`, `--input`), except `--help` and `--version`. |
| `constraints` | OPTIONAL | 9.8. Requirements that `required` on one argument cannot express. |
| `validators` | OPTIONAL | 9.8.3. Stateless checks that neither a `domain` nor a constraint can express. |
| `errors` | REQUIRED | Every error code the command can emit, core codes included. |
| `outputs` | REQUIRED | 9.9. At least one. |
| `input` | REQUIRED when the command accepts `--input`, absent otherwise | 9.10. |
| `examples` | REQUIRED | At least one complete invocation in the syntax of 4.2, starting with the tool name, `--json` after the path when given, no placeholder or ellipsis, satisfying the command's requirements and constraints (counting what an inline `--input '<JSON>'` word supplies). An example MUST NOT read a file or stdin, since a reader cannot reproduce it. |
| `schemas` | REQUIRED | Every JSON Schema the command's refs name, keyed by name; each a JSON Schema resource (an object or a boolean schema) that compiles under draft 2020-12. |
| `x-<tool>` | OPTIONAL | 9.12. |

[Appendix A D5]

### 9.6. Operands

`{name, valueName, valueType, required, variadic, default, help}`, plus `possibleValues` when `valueType` is `enum`,
and OPTIONAL `defaultNote` and `domain` (9.7). `name` is a kebab-case word naming the operand in `constraints`, never
the name of an option of the same command; `valueName` is the placeholder shown in help (`CHANGE_ID`). An operand's
`valueType` is one of `string`, `integer`, `number`, `path`, `enum`, `json`; its `default` is typed as an option's.

### 9.7. Options

9.7.1. `{name, valueType, required, repeatable, default, help}`, plus:

- `valueName`: REQUIRED unless `valueType` is `switch` or `count`, where it is absent.
- `possibleValues`: REQUIRED when `valueType` is `enum`, absent otherwise.
- `defaultNote`: OPTIONAL; how a computed default is found.
- `env`: OPTIONAL; the environment variable the parser reads when the option is absent (10.7 step 5).
- `flagOnly`: OPTIONAL, default `false`; `true` when the option cannot be given in an `--input` document (10.6). The
  flag-only reserved options (4.5) always have `flagOnly: true`.
- `short`: OPTIONAL; one letter (4.6.5).
- `domain`: OPTIONAL; the restrictions of the argument's own value beyond its valueType (9.7.4). Every normalised
  value (each element of a repeatable option or variadic operand) MUST satisfy it, and so does a non-null default.

`name` is the long name without `--`.

9.7.2. **valueType** is one of:

| valueType | Command line (4.2) | `default` | `--input` value (10.5) |
|---|---|---|---|
| `switch` | `--name` | `false` | `true` or `false`; `false` is the same as absent |
| `count` | `--name`, once per occurrence | integer ≥ 0, normally `0` | a non-negative integer, the number of occurrences; `0` is the same as absent |
| `string` | `--name=<V>` | string or `null` | string |
| `integer` | `--name=<N>` | integer or `null` | JSON integer, or a string matching `-?(0\|[1-9][0-9]*)`, within ±(2^53-1) (9.7.5) |
| `number` | `--name=<X>` | number or `null` | JSON number, or a string in JSON number syntax |
| `path` | `--name=<PATH>` | string or `null` | string, relative to the working directory |
| `enum` | `--name=<V>` | a member of `possibleValues`, or `null` | a member of `possibleValues` |
| `json` | `--name=<JSON>` | any JSON value, or `null` for none | any JSON value except a top-level `null` |

A repeatable option's `default` is an array of its element type, or `null`; in `--input` it is an array of element
values. A `count` is `repeatable: true` (given once per occurrence) but its default and input value are one integer.
A `switch` is never required or repeatable. [Appendix A D11.3]

9.7.3. **Defaults are typed.** `default` is REQUIRED and is the value used when the option is absent; `null` means
there is none. A default computed when the command runs (the current commit, the nearest configuration) is `null`
with a `defaultNote`. A `switch`'s `default` is always `false` ("not given"); when absence can still turn the
behaviour on (a configuration setting), `defaultNote` says so. A default the help text promises MUST appear here. A
required option's `default` is `null`. An `enum` default (or each element of a repeatable one) is a member of
`possibleValues`.

9.7.4. **Domains.** A `domain` states every restriction of the argument's own value, beyond its valueType, that the
command enforces without reading state. Relations between arguments are constraints (9.8). It is written in a fixed
profile of JSON Schema draft 2020-12 that clap-based and Effect-based tools can turn into parser checks and back, and
that a caller can check locally:

| valueType | Keywords |
|---|---|
| `integer`, `number`, `count` | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (positive) |
| `string`, `path` | `minLength`, `maxLength`, `pattern` |
| `json` | the keywords of both rows above, and `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`; inside `properties`, `items` and `additionalProperties` the same profile applies again; `enum` and `const` take scalar values only |
| `switch`, `enum` | none |

Besides these, a domain MAY carry the annotations `title`, `description`, `$comment` and `format`; no other keyword
is allowed (no `$ref`, `anyOf`, `oneOf`, `allOf`, `not`, `if`). The check is structural: a `properties` member
*named* `$ref` is allowed. `format` asserts nothing; a command that refuses values not in a format declares a
validator (9.8.3).

A `pattern` is `^`, a body, then `$`. The body is an I-Regexp (RFC 9485) with no `|` outside parentheses (write
`^(core|lead)$`), no `.`, no `^` or `$` outside a character class, no `\-` outside a class, and no `&&` or `~~` inside
a class. A value satisfies it when the body matches the whole value. The pattern MUST compile with the Rust `regex`
crate's default limits (compiled size 10 MiB, nesting 250); a length limit is better written as `maxLength`
(`^\p{L}{1,500}$` exceeds the size limit). Under these restrictions ECMAScript with the `u` flag (as JSON Schema
validators read it) and the Rust `regex` crate accept the same values, up to the Unicode version of each engine's
`\p{…}` tables; a caller does not assume that its own engine proves a tool accepts a recently assigned character.
(The reason for each restriction and the cross-engine record: `approaches/implementation.md`,
`scripts/regex-cases.json`.)

A stateless check outside this profile is a validator, never a precondition. [Appendix A D17, D18]

9.7.5. **Numbers.** `integer` and `count` values, integer defaults and the numeric keywords of an integer or count
domain lie within ±(2^53-1), where a JSON parser, JavaScript and a Rust `i64` agree. A value outside it, on argv or in
a document, is invalid (`USAGE` or the command's code for that argument on argv, `INPUT_INVALID` in a document) and
is never rounded into range; an identifier that can exceed it is a `string` with a `pattern`. `number` values,
defaults and domain bounds are finite binary64 values; a numeric string denotes the nearest binary64 value, and a
number too large for binary64 is invalid. Numbers inside a `json` value are not normalised; they follow I-JSON (RFC
7493 §2.2), and a tool MAY refuse an integer beyond ±(2^53-1) or a number beyond binary64 inside one.

### 9.8. Constraints and validators

9.8.1. Every relation between arguments (which must, may or must not be given together, possibly depending on
another argument's value) that the tool enforces without reading state MUST be listed in `constraints`, an array of
rules naming operands and options by `name`, or in an argument's `required`. Three other kinds of check are not
constraints:

- a **domain** restricts one argument's own value (9.7.4) and is checked with `USAGE` or the command's code for that
  argument (`FINDING_ARGUMENT_INVALID`);
- a **validator** is any other check that reads no state: a calendar date that must exist, an order between two
  timestamps, a union of two object shapes, a check of an option's `env` value. It is declared in `validators`
  (9.8.3);
- a **precondition** reads state (an id exists, a run is in the right phase, a role in configuration); it is checked
  when the work starts (8.3) with its own code. [Appendix A D12.4]

| `rule` | Members | Holds when |
|---|---|---|
| `atLeastOne` | `names` | at least one of `names` is given |
| `exactlyOne` | `names` | exactly one of `names` is given |
| `atMostOne` | `names` | at most one of `names` is given |
| `requires` | `if`, `then` | when `if` holds, every name in `then` is given |
| `forbids` | `if`, `then` | when `if` holds, no name in `then` is given |

`if` is `{name}` (holds when that argument is given) or `{name, in: [values]}` (holds when it is given and its value,
or any value of a repeatable one, is one of `in`); values are compared after normalisation (10.5), every value in
`in` is a valid value of the argument, and `in` is not allowed on a switch or a count. "Given" means supplied
explicitly on argv or in an `--input` document; a default or environment value does not count. A rule MAY carry
`code`, the registered code its violation produces; otherwise it is `USAGE`. A violation's `field` names an argument
of the rule that the caller can add or remove to satisfy it: one that is missing when the rule is broken by absence
(`requires`, `atLeastOne`, `exactlyOne` with none given), one that is given when it is broken by presence (`forbids`,
`atMostOne`, `exactlyOne` with several given). Which one, when several qualify, is the tool's
(`approaches/implementation.md` recommends one). [Appendix A D34, D36]

9.8.2. The five rules are the whole vocabulary; a new rule is added only when a real command needs a relation they
cannot express (D12.4). A command lists each relation once: two rules with the same `rule`, names, `if` and values, in
any order, are invalid whatever their codes. A rule implied by other declarations without being the same relation is
allowed.

9.8.3. **Validators.** `validators` lists the stateless checks that neither a `domain` nor a constraint can express.
Each is `{arguments, code, description, rejects}`, plus `x-<tool>` members:

- `arguments`: the names of the operands and options it reads (at least one);
- `code`: the registered code its failure produces, with exit 2, listed in `errors`; `USAGE` is allowed;
- `description`: what it checks, in one or two plain sentences, so that an agent can construct a valid value;
- `rejects`: at least one complete invocation in the syntax of `examples`, satisfying every requirement, constraint
  and domain, that this validator refuses: the caller's counterexample. None is in `examples`; it is not checked
  against `argumentsRef`.

A validator runs for every invocation, with or without `--input`, at step 6 of 10.7, and before any state is read; in
a batch it is part of preflight (10.11). [Appendix A D17, D18, D30]

### 9.9. Outputs and schemas

9.9.1. `outputs` lists every form the command can print. Every entry has `kind`, `schemaRef` and `schemaVersion`;
`schemaRef` names the JSON Schema of `data` in JSON mode.

| `kind` | Also REQUIRED | Meaning |
|---|---|---|
| `report` | | An enveloped report. |
| `artifact` | `mediaType` | Bytes as they are in text mode (`text/markdown`); with `--json`, an envelope whose `data` follows `schemaRef`. |
| `stream` | `mediaType`, `eventRef` | In JSON mode, the stream lines of 13; `eventRef` names the schema of an event's `data`, `schemaRef` the schema of the final result's `data`; `mediaType` is `application/x-ndjson`. |

OPTIONAL members: `batch: true` for the report a batch input returns (10.11); `when`, which invocation selects this
output when there are several; `fields` (6.10): `{records, paths, keep?, default?}`, where `records` is the JSON
pointer of the records inside `data` (`""` when `data` is the record), `paths` the selectable paths, `keep` the paths
always kept (not selectable), `default` the selection without `--fields` (a subset of `paths`). [Appendix A D11.13,
D23]

9.9.2. `schemaRef`, `eventRef`, `input.schemaRef` and `input.argumentsRef` have the form `#/schemas/<Name>`, resolved
against the command document (`data`); references between schemas in `schemas` use the same form, and a schema MAY
reference the contract's schemas by their absolute `$id`. Two outputs never share a `schemaRef`, so `meta.output`
names exactly one output.

9.9.3. A report schema MUST describe the whole report, not a subset. A failure's partial `data` follows the schema
`meta.output` names. A batch output's schema describes `items[].data`; the batch report's own shape is
`schema/batch-report.schema.json` (10.11).

### 9.10. Input

`{option: "--input", schemaRef, batch, maxBytes, example}`, `maxItems` when `batch` is `true`, and OPTIONAL
`argumentsRef`.

- `schemaRef` names the **fragment schema** of one document (10.7 step 2): every key the command accepts with its
  accepted encoded values (9.7.2), `additionalProperties: false`, no `required`, flag-only options absent.
- `argumentsRef` names a schema of the **argument object** of 10.7 step 6. It is informative: `required`, `domain`,
  `constraints`, `validators` and the command's own validation are authoritative, and it MUST NOT be stricter than
  they are.
- `example` is one complete, valid document on its own.

### 9.11. Search (OPTIONAL)

`<tool> schema --search "<TASK>" --json` returns a `tree` with `query` set and `commands` ranked best first; it MAY
return fewer entries than the tree, including none. Search MUST work offline. Tools with more than about fifty
commands SHOULD offer it. Ranking quality is not part of the protocol.

### 9.12. Extensions

Members whose name matches `^x-[a-z][a-z0-9-]*$` MAY appear on tree entries, `tree`, `group`, `command`, operands,
options, constraints, validators, outputs, the error object, registry entries and reasons, `next` entries and `meta`.
By convention the name is `x-<tool>` (`"x-canon": {"roles": ["reviewer"]}`). A tool emits no member that neither
this document, for the minor the tool declares, nor this convention defines; callers ignore members they do not know
(15.6).

### 9.13. Document rules

These rules hold for every `schema` answer; JSON Schema cannot express them.

1. `command` equals `path` joined by one space; a group's children extend its path by one word (9.3, 9.4).
2. Every `schemaRef`, `eventRef`, `input.schemaRef` and `input.argumentsRef` names a member of `schemas` (by
   membership: `false` is a valid schema); every member compiles; no two outputs share a `schemaRef` (9.9.2).
3. Defaults, `in` values and domains are valid: an `enum` default is in `possibleValues`; an `in` value is a valid,
   normalised value of its argument within its `domain`, never on a switch or a count; a `domain` keeps to its
   valueType's profile and bounds (9.7.4, 9.7.5) and holds for the non-null default.
4. Every name and `code` of a constraint resolves (`code` in `errors`); no relation is stated twice (9.8.2); a
   command lists the core code of each feature it offers (7.3.1).
5. A command has an output with `batch: true` exactly when `input.batch` is `true`.
6. Outputs are told apart pairwise by `when` or `batch`; at most one has neither.
7. `input.example` satisfies the fragment schema, `required`, the domains, `constraints` and `validators`, and its
   argument object validates against `argumentsRef` when present (9.10).
8. A reserved option (4.5) has its shape (`json`, `commit`, `all` switches; `input`, `plan-digest`, `cursor`,
   `fields`, `operation` strings; `limit` an integer), and a flag-only one `flagOnly: true`.
9. Option names, operand names and short letters are unique within a command, and no operand has an option's name.
10. The fragment schema has no root `required`, has `additionalProperties: false`, and its properties are
    `operands` and the camelCase names of the options that are not flag-only.
11. An output's `fields` is consistent: its cut nodes are projectable (6.10); `records` is `""` or leads through
    declared object members; `default` ⊆ `paths`; `keep` and `paths` are disjoint; every path names a declared
    member and goes through arrays only with `[]`.
12. Every example parses by 4.2 against the command's arguments, with typed values in their domains, and satisfies
    `required`, `constraints` and `argumentsRef`; an inline `--input` word is framed, validated and merged as 10.7.
13. A validator names arguments of the command; its `code` is in `errors` with exit 2; each `rejects` invocation
    satisfies `required`, `constraints` and the domains, and is not in `examples` (9.8.3).
14. In an `errors` answer a code appears once, a core code has its exit and retryability (7.3.1), a reason appears
    once within its code, and in a document that declares 1.3 every code follows 7.2.3; in a `warnings` answer a
    code appears once.
15. A field path writes a member in brackets exactly when its name is not an identifier; a map-key path extends a
    declared map path by one key (6.10).
16. A document carries only what its declared minor defines (15.7).

## 10. Input documents: `--input`

Normative shapes: `schema/input-document.schema.json` (generic), and per command the fragment schema at
`input.schemaRef`.

10.1. At L2, every command with effect `write` or `destructive` MUST accept `--input <JSON|FILE|->`. A `read`
command MAY. The option carries the command's arguments as a JSON document. [Appendix A D6]

10.2. **The value.** After leading whitespace, a value starting with `{` or `[` is inline JSON; `-` reads stdin;
anything else is a file path relative to the working directory (a file whose name starts with `{` or `[` is passed as
`./{name}`). An empty value, a file that cannot be read and an empty source refuse with `INPUT_INVALID`, `field`
`--input`. `--input` given twice, or as the last element with no value, is a malformed command line: `USAGE` (or its
finer replacement, 7.3.2), `field` `--input`. A value that starts with `-` other than `-` itself is written
`--input=<VALUE>` (4.2.2), so `--input --json` lacks a value and stays in JSON mode. [Appendix A D26]

10.3. `--input -` with stdin attached to a terminal refuses with `INPUT_INVALID`, `field` `--input`.

10.4. **Framing.** The whole source is parsed as one JSON value first. An object is one invocation; an array is a
batch, even with one element (10.11). Only when that parse fails and the source is a file or stdin are its non-blank
lines parsed as NDJSON, one document per line, and that is a batch. Any other JSON value, and invalid JSON, refuse
with `INPUT_INVALID`, and so does a batch on a command whose `input.batch` is not `true`.

10.5. **Document keys and values.** A document is one JSON object. Its keys are the command's option names in
camelCase (`resolution-rev` → `resolutionRev`) and `operands`. Values are typed and normalised by valueType (9.7.2):

- `operands` is a non-empty array of the operands in order, each of its operand's valueType (a `json` operand takes
  any JSON value except a top-level `null`). An empty array is refused; omit the key.
- A numeric string for an `integer` or `number` argument is normalised to the number it denotes before any
  comparison or validation. It matches the JSON number grammar (RFC 8259 §6) and, for an integer,
  `-?(0|[1-9][0-9]*)`; no other forms (hexadecimal, `+1`, `1e3` for an integer, surrounding spaces) are numbers. No
  other coercion happens.
- A switch takes `true` or `false` and a count a non-negative integer; `false` and `0` are the same as an absent key.
  A boolean for a `json` argument is a value like any other.
- `null` is refused as a key's value and as an element of `operands` or of a repeatable option's array; `null`
  nested inside a `json` value is part of that value.
- `{}` is a valid document with no arguments. [Appendix A D11.17]

10.6. **Flag-only options** (4.5: `json`, `input`, `commit`, `planDigest`, `limit`, `cursor`, `all`, `fields`) are never
document keys, so a document cannot select output, commit a destructive plan or page. A tool MAY make other options
flag-only (canon's `repo` and `as`); it marks them `flagOnly: true` and leaves them out of the fragment schema.

10.7. **Processing.** A tool processes an invocation with `--input` in this order; a failure stops it, with nothing
changed. Steps 1-6 read no state: they depend only on argv, the document, the environment and the self-description,
so they give the same answer whatever the tool's state.

1. **Read and frame** (10.2-10.4, 10.10). Failures: `INPUT_INVALID` or `INPUT_TOO_LARGE`, `field` `--input`.
2. **Fragment validation.** Each document is validated against the fragment schema: known keys, flag-only keys
   absent, types and enum membership, `null` (10.5). Every problem in a document is reported: `INPUT_INVALID`,
   `field` the pointer of the key (`/reasn`), `details` when there are several.
3. **Conflict check.** The explicit argv arguments are extracted without enforcing requirements, constraints,
   environment or defaults. For each argument given on both, the two normalised values are compared structurally: a
   scalar as one value, a repeatable option or the operands as one ordered array; objects are equal when they have
   the same members with equal values in any order; a scalar never equals an array. Different values refuse with
   `INPUT_CONFLICT`, `field` the document pointer. Malformed argv (an unknown option, a value of the wrong type)
   refuses here with its usual code.
4. **Merge.** The explicit arguments are the union of argv and the document; each remembers its source.
5. **Environment and defaults.** For each option absent from the merged arguments, its `env` variable applies if
   set, otherwise its `default`. These values are not explicit: they never conflict and do not make an argument
   "given" (9.8.1).
6. **Invocation validation.** `required`, domains, constraints and validators are checked on the merged arguments,
   with the same codes as without `--input`; the first failure is the answer. (A recommended order among them:
   `approaches/implementation.md`.) What is validated is the **argument object**: `operands` (normalised; when the
   explicit operands end before an operand with a non-null default, that default is appended, element by element for
   a variadic one), and for every option that is not flag-only, under its camelCase name, its normalised explicit
   value, else its `env` value, else its non-null default. Integers and numbers are JSON numbers there; a repeatable
   option is an array; a count is one integer. It is what `argumentsRef` describes (9.10).
7. **Execution.** The command resolves the objects it names, checks its state-dependent preconditions (8.3) and does
   its work. A precondition that fails here is a refusal (exit 2) of a single invocation; in a batch it is the
   failure of that item (10.11).

An invocation without `--input` passes the same stateless checks, argv parsing first, before any state is read.

10.8. **Error fields.** When the value at fault came from a document, `field` is its JSON pointer (`/round`,
`/operands/0`, `/label/2`); inside a batch, prefixed with the item index (`/1/round`). When a required argument is
missing from both sources and the invocation used `--input`, `field` is the pointer the key would have. Otherwise
`field` names the argv argument (7.1.1).

10.9. **Conversion.** A tool MAY implement steps 4-6 by converting the merged document to argv and running its
ordinary parser (`approaches/implementation.md`); the answer MUST be the one validating the document directly gives,
codes and the pointers of 10.8 included.

10.10. **Size.** `input.maxBytes` is declared per command and enforced before parsing (`INPUT_TOO_LARGE`).

10.11. **Batches** (OPTIONAL per command). A command MAY accept several documents in one invocation; it then declares
`input.batch: true`, `input.maxItems`, and an output with `batch: true`. Destructive commands MUST NOT accept
batches. A batch runs in two phases:

- **Preflight**: steps 1-6 for every item, before any item executes. Preflight reads no state, so an item may name an
  object an earlier item creates.
- **Execution**: items run one at a time, in order (step 7 each), and the batch stops at the first item that fails,
  including one whose state-dependent precondition fails.

| Case | Exit | `error.code` | `data` | Item statuses |
|---|---|---|---|---|
| A preflight failure in any item | 2 | the first failing item's code, `field` prefixed `/<index>` | absent | none |
| Every item executed | 0 | — | the batch report | each `written` or `unchanged` |
| An item failed during execution, at any index | 1 | `BATCH_INCOMPLETE`, `field` `/<index>` | the batch report | earlier `written`/`unchanged`; that item `failed` with its own `error`; later `skipped` |

The batch report is `{items: [...]}` with one entry per submitted item, in order: `{index, status, data?, error?}`.
`written` and `unchanged` items carry `data` and no `error`; a `failed` item carries its own `error` (with its code's
registry `retryable`) and no `data`; a `skipped` item carries neither. Its normative shape is
`schema/batch-report.schema.json`, which a batch output's `data` MUST validate against besides the command's own batch
schema. `failed` does not mean rolled back: the item's own code tells whether it may have made effects (exit 1) or
refused (exit 2). A batch is not a transaction. `BATCH_INCOMPLETE` is used exactly when one item is `failed`.

## 11. Effects and the destructive exchange

11.1. **Effect.** Every command declares one effect:

- `read`: makes no effect except what `effectNote` names (an audit line, a cache).
- `write`: records or changes state.
- `destructive`: deletes or rewrites data others depend on, or is hard to undo.

11.2. **Refusals and previews write nothing.** A refusal (exit 2), a destructive preview (11.4), a `--dry-run`
(11.10), `--help`, `--version` and `schema` MUST NOT make any effect: no file, record, cache, log file, telemetry
record or remote change, whatever `effectNote` says. A preview or `--dry-run` makes none whatever its exit. Writing to
the process's own stdout and stderr is output, not an effect. [Appendix A D12.3, D30]

11.3. **Idempotency** of `write` and `destructive` commands:

| Value | A repeat of the same invocation |
|---|---|
| `replay-safe` | changes nothing more and reports `unchanged` (or the same result). |
| `content-keyed` | with identical content is a no-op; different content under the same key refuses. |
| `appends` | adds another record. |
| `once` | refuses (exit 2) and changes nothing. |

11.4. **Preview by default** (L2). A `destructive` command takes `--commit` and `--plan-digest <DIGEST>`. Run without
`--commit` it is a preview: it computes the plan, makes no effect, and succeeds (exit 0) with a report whose `data`
carries at least:

| Member | Meaning |
|---|---|
| `planDigest` | The digest of the plan (11.6). |
| `effects` | Every effect the commit would make, including the ones `effectNote` names, as objects naming the action and its target (canon: `{action, path?, record?, detail?}`), precise enough that a caller can decide from them alone. |
| `committed` | `false` for a preview, `true` after the commit. |

[Appendix A D7]

11.5. **The commit invocation.** The preview's `meta.next` MUST lead with the exact commit invocation, digest
included, built from the normalised arguments the preview used: an invocation that read `--input -` or a file gets
the arguments as argv options or as one inline `--input '<compact JSON>'` word, never `--input -`. A destructive
command MUST NOT take a secret as an argument (16.1).

11.6. **Digest.** The digest covers the plan: the effects and every input that determines them (arguments, the state
and file contents read), so a changed file makes the commit refuse. It is opaque to callers and bound to state, not
time; it does not expire. It SHOULD be `sha256:` followed by the lower-case hex SHA-256 of the plan's RFC 8785 (JCS)
canonical JSON; `examples/plan-digest/` holds test vectors for that form. When another system makes the effects and
computes the digest (a remote service), the tool passes the digest through and the check of 11.7 happens there.
[Appendix A D30, D35]

11.7. **Commit.** `--commit` and `--plan-digest` require each other: one without the other refuses with `USAGE`, its
finer replacement (7.3.2), or the `code` of the `requires` rule that states the pair. With both, the command
recomputes the plan; if its digest differs it refuses with `PLAN_STALE` (exit 2, nothing changed, `meta.next` the
preview invocation); otherwise it carries out exactly that plan and reports `committed: true`. A commit is not a
lock: a tool whose plan can be invalidated between the check and the effects MUST detect it per effect or hold a
lock, and a change it detects after some of the effects is a stop part-way (8.3.2, reason `PLAN_STALE`). A commit
never acts unchecked: when the system that must recompute the digest cannot (a remote service too old), the tool
refuses with an exit-2 code of its own (`REMOTE_UNSUPPORTED`), not `PLAN_STALE`, whose `next` cannot help.
[Appendix A D30, D31]

11.8. **Nothing else authorises.** `--commit` and `--plan-digest` are flag-only. No other option, environment
variable or prompt authorises a destructive command, on a single named target too. [Appendix A D7, D11.11]

11.9. A command that a person must run (approving, accepting a risk) SHOULD refuse agents with a `DENIED` code
(`retryable: false`) and a `hint` addressed to the person, naming the command to run. No flag grants it. How a tool
tells a person from an agent is out of scope.

11.10. **`--dry-run`** on a `write` command is OPTIONAL. Where offered, it runs every check the real run would
(refusing with the same codes), makes no effect, and reports what would change.

## 12. Long-running work

12.1. By default a command finishes its work before it exits; exit 0 means done as asked.

12.2. **Accepted is not done.** A command that starts work it does not finish (a detached worker, a remote job)
declares `async: true` (9.5). Its exit 0 means "accepted"; its report names the identifier to follow and MUST NOT
present the work as complete; `meta.next` MUST lead with the command that reads or waits for the outcome.

12.3. **Waiting.** A command that waits SHOULD take `--wait` and `--timeout <DURATION>` (4.6.8). It exits 0 when the
work is done as asked; when the work ended otherwise it exits 1 with a registered code; when the timeout passes it
exits 1 with a retryable code (a `TIMEOUT` code, 7.2.2) and puts the same wait in `meta.next`.

12.4. **Operation keys.** A command that starts work another process completes, or whose reply can be lost after its
effect, SHOULD accept `--operation <KEY>` (input key `operation`): a caller-chosen key naming this request. Its
idempotency is `replay-safe`. Then:

- **Namespace.** Keys are scoped to the tool, the command and the resolved context (6.7).
- **Payload.** The key is bound to the request's payload: the normalised explicit arguments plus the resolved
  context, excluding `--json` and `--operation`; environment and default values count only through the context
  they resolve.
- **Reservation.** Binding the key is atomic and is a precondition (8.3): of several concurrent requests with one
  key, exactly one performs the work and the others behave as repeats; no interleaving starts the work twice.
- **Repeat, same payload.** A repeat makes no new effect and returns the first request's result: its report if it
  finished, or, if it is still running, an accepted report for the same work with the same identifier and
  `meta.next` leading to the wait.
- **Uncertain outcome.** If the first request stopped and the tool cannot tell whether its effect happened, the
  repeat MUST first reconcile against the system that holds the effect: it returns the result if the effect
  happened, and performs it once if it did not. If the tool still cannot tell, it refuses with a code of its own
  (exit 2, not retryable; no core code, D16.3) whose `hint` names a command that inspects the work durably
  (`meta.next` leads with it when literal); the key stays reserved and bound, every repeat refuses the same way until
  the outcome is known, and the guide says how to resolve it and that a new key MUST NOT start the same work
  meanwhile.
- **Repeat, other payload.** The same key with another payload refuses with `OPERATION_REUSED` (exit 2), `field`
  `--operation`, `hint` the command that shows the first request.
- **Retention.** Keys are kept at least until the work they name is over; the guide documents the retention. After it
  a key names a new request; callers MUST NOT reuse a key after its retention. [Appendix A D11.10, D12.2, D16.3]

## 13. Streams

Normative shape: `schema/stream-line.schema.json`.

13.1. A command whose output kind is `stream` prints, in JSON mode, NDJSON on stdout: one JSON object per line, each
with a `type`:

| Line | Shape | When |
|---|---|---|
| start | `{"type": "start", "contract": "atip/1", "contractVersion", "tool", "toolVersion", "command", "schemaVersion", "output"?}` | first line, exactly once |
| event | `{"type": "event", "data": <follows eventRef>}` | zero or more times |
| end | `{"type": "end", "result": <an envelope (6)>}` | last line, exactly once |

`schemaVersion` on the start line is the stream output's; `command` is the command's id. When the command declares
more than one output, `output` is REQUIRED on the start line and names the stream output that runs, so a caller can
choose the event decoder before the first event. Every event's `data` validates against that output's `eventRef`.
The `end` line's `result` is an envelope with every rule of sections 6-8: its `meta.command`, `meta.tool` and
`meta.contractVersion` equal the start line's, its `meta.output` equals the start line's `output` when present, a
success's `data` validates against the stream output's `schemaRef` with the start line's `schemaVersion`, and a
failure follows the registry. [Appendix A D11.7]

13.2. The exit status is the exit of the `end` line's envelope (0 exactly when `result.ok`). A stream whose last line
is not an `end` line was cut off; callers treat it as failed whatever the exit status, and MUST NOT assume that the
events they received were rolled back or that the work can be resumed.

13.3. A refusal (exit 2) before the stream begins prints the ordinary failure envelope as the only line, without
`start`; callers tell the two apart by `type`. Anything that happens after the start line is reported through the
`end` line.

13.4. Without `--json`, a stream command prints text lines that are not part of the protocol.

## 14. Guides: `skills show`

14.1. At L2 a tool ships its guide for agents inside the binary: `<tool> skills show [NAME] [--json]`. The guide
matches the binary's version. [Appendix A D8]

14.2. `NAME` is optional. Without it the command prints the default guide, which MUST list the names of every guide.
An unknown `NAME` refuses (exit 2, a registered code) with `expected` the guide names.

14.3. `skills show` is an artifact command (9.9): in text mode it prints the guide's Markdown; with `--json`, `data`
follows `schema/guide.schema.json`: `{name, text, guides, full?}`, where `text` is the Markdown, `guides` every guide
name and `full` whether `--full` material is included. A tool MAY offer `--full`.

14.4. `skills show` works without state, like `schema` (9.2).

14.5. Every command line in a guide's fenced code blocks that starts with the tool name MUST be a valid invocation in
the syntax of 4.2 once its `<UPPER_CASE>` placeholders are substituted with valid values. Lines that use shell syntax
beyond words and quoting (pipes, redirections, `$(…)`) are outside this rule. Text from other people and systems is
data; guides SHOULD tell agents so (16.2).

14.6. Skill files installed into a repository or a harness SHOULD be stubs that point at `skills show`.

## 15. Versioning and compatibility

15.1. **The contract.** This document is `atip/1`: the identifier names the major. Its versions are
`MAJOR.MINOR.PATCH` (this one is `1.3.0`), and `CHANGELOG.md` lists each. A change belongs to the smallest class that
holds it:

| Class | What it may do | What it never does |
|---|---|---|
| PATCH (`1.x.y`) | Clarify text without changing what conforming tools and callers do; correct examples and the regex record; add examples. | Change a rule. |
| MINOR (`1.x.0`) | Add OPTIONAL members, options, document kinds and enum values; add SHOULD and MAY rules; add MUST rules that bind only a document that declares the new minor (15.7), so that a tool which does not declare it cannot fail them; relax a rule only where every answer the relaxed rule permits is one a caller already handles safely. | Make a conforming tool non-conforming: a tool that conforms to `1.x` still conforms, as a `1.x` tool (15.9). |
| MAJOR (`atip/2`) | Remove or rename a member, option, core code or document kind; change a type or a meaning; make an OPTIONAL member REQUIRED; add a MUST that an existing tool can fail. | |

[Appendix A D20]

15.2. **The tool.** `meta.toolVersion` is the release. It says nothing about the compatibility of any document.

15.3. **Outputs.** Every output (report, artifact representation, stream) has its own `schemaVersion`
`<major>.<minor>`, independent of the tool release and of the command's other outputs. Adding a member or an enum
value bumps the minor; removing or renaming a member, or changing its type or meaning, bumps the major. A caller
accepts unknown members within a major it knows and refuses an unknown major. A release that does not change an
output keeps its version.

15.4. **The self-description** is versioned by its `meta.schemaVersion`, the minor the tool declares (9.1.4).

15.5. **The command surface.** Removing or renaming a command, an option, an error code, a warning code or a
registered reason is a breaking change for callers; it is done as a clean cutover (4.6.7) and recorded in the tool's
changelog. A code or a reason is never reused with another meaning.

15.6. **Unknown members and values.** A caller MUST ignore a member it does not know in every object this document
defines: the envelope and `meta` with everything inside it, `error` and its `details`, registry entries and reasons,
every `schema` document, stream lines, batch reports and guides. A caller MUST NOT fail a whole document because a
member whose values this document lists has a string value it does not know; the table below, read from the schemas
in `schema/`, is every such member and what the caller does. It never infers that something it did not understand is
satisfied, done or safe, and what it left out is not absent: a view with no outputs, entries or arguments left does
not say the command has none, only that the caller cannot use them. Only an unknown *string* is an unknown value: a
listed member whose value is not a string, or a missing required one, is a wrong shape, and the caller rejects the
document. A minor that adds a listed member adds its row. [Appendix A D20, D28, D29]

| Member (schema) | An unknown string means |
|---|---|
| `meta.contract` (envelope, stream start line) | Another major: the caller refuses the whole document. |
| `data.kind` of a `schema` answer (schema-doc) | The answer is unusable; `ok` and `meta` are still read. |
| A tree entry's `kind` (schema-doc `treeEntry`) | The entry is left out. |
| `effect` of a command or a tree entry (schema-doc `effect`) | The command is treated as `destructive`. |
| `idempotency` (schema-doc `idempotency`) | The command is treated as `once`: never repeated after an unknown outcome. Also when `effect` was unknown and `idempotency` is absent. |
| A tree's `level` (schema-doc `tree`) | The tool is treated as claiming `L1`, the lowest level a tree can claim. |
| An operand's or an option's `valueType` (schema-doc `operand`, `option`) | The argument is left out: the caller cannot give it, and when it is required the caller cannot run the command. |
| A constraint's `rule` (schema-doc `constraint`) | The constraint is left out of the caller's own checks; the tool still checks it before acting (8.2, 10.7 step 6). |
| `input.option` (schema-doc `input`) | `input` is left out: the caller builds invocations from argv only. |
| A keyword of a `domain`, or a JSON type name in a domain's `type` (schema-doc `domainNode`, `jsonType`) | The whole `domain` of that argument is left out of the caller's own checks; the tool still enforces it. |
| An output's `kind` (schema-doc `output`) | The output is left out. |
| A batch item's `status` (batch-report) | The item's outcome is unknown: it is counted as none of written, unchanged, failed or skipped, and the caller reads its state before repeating it. |
| A stream line's `type` (stream-line) | The line is left out; the stream still ends with its `end` line. |

An unknown error code is not in this table: a caller reads its exit, `retryable` and registry entry, and in a 1.3
document its condition (7.2). Listed values that are not strings are fixed by this major: `ok` is a boolean, a
registry entry's `exit` is `1` or `2`, `batch` and `async` are booleans; any other value is a wrong shape.

15.7. **Declaring the minor.** `meta.contractVersion` is the minor a tool implements, `<major>.<minor>`; absent, it
is `"1.0"`, and it is never written as `"1.0"`. A tool that declares 1.1 or later MUST set `meta.contract` and
`meta.contractVersion` on every envelope (the `result` of a stream's `end` line included) and `contract` and
`contractVersion` on every stream start line, so that a document without the marker is always a 1.0 document. Every
document one build prints declares the same minor. A tool emits no member, document kind or syntax added in a later
minor than the one it declares, and the rules a minor adds bind only documents that declare it or a later minor.
[Appendix A D20, D27]

15.8. **The published schemas.** The JSON Schemas in `schema/` describe what a tool of the current minor may emit and
are closed (`additionalProperties: false`). Every member, document kind and pattern added after 1.0 carries the
annotation `"x-atip-since"` naming the minor that added it (`"1.1"` for all of them: 1.2 and 1.3 added none), which
tells what a document of an earlier minor must not carry. A caller MUST NOT reject a document only because it fails
these schemas by an unknown member (15.6): a caller that validates reads them *open*, with `additionalProperties:
false` taken as absent and every other keyword unchanged, after building its *view* of the document (every unknown
string handled as 15.6 says). Its view can no longer meet the producer's completeness rules (`minItems`, `contains`,
`if`/`then`/`else`), so the caller drops those keywords too; types, `required` members and listed values stay. It
rejects a document only when its view fails, never for what it left out. The `$id`s stay under
`https://atip.dev/1/` for every `1.x`; a release tag holds the schemas of its version. [Appendix A D20, D28]

15.9. **Earlier minors.** A tool that declares 1.0, 1.1 or 1.2 stays conforming as that minor: it is held to the
text of that minor's last release (tags `v1.0.0`, `v1.1.2`, `v1.2.1`), and nothing in 1.3 binds it. A caller reads
documents of every minor of this major. What differs for a caller, by the minor a document declares:

| A document that declares | differs from 1.3 in that |
|---|---|
| 1.0 (no `contractVersion`) | `meta.contract` may be absent outside `schema` answers; it has no `error.reason`, no registry `reasons`, no `warnings`/`warning` kinds and no bracketed field paths; a declared map is kept whole, its keys not selectable; warning codes are in the error registry (exit 1); a hint may be prose that starts with the tool name; the cursor binding, `--fields` and flag-only options are as for 1.1 below. |
| 1.0 or 1.1 | A cursor is also bound to `--json` and `--all` (changing them while paging may refuse with `CURSOR_INVALID`); `--fields` may be refused without `--json`; `limit`, `cursor`, `all` and `fields` may be document keys. |
| 1.1 or 1.2 | Warning codes may still be in the error registry only (7.5.3). |
| 1.2 | `STOPPED_MIDWAY` is a core code (exit 1, not retryable): a command stopped part-way after effects, `reason` the code of the refusal it met. In a document of 1.0 or 1.1 it is a code of the tool's own, read by its registry entry. |
| 1.0, 1.1 or 1.2 | Error codes need not follow 7.2: a caller takes exit and retryability from the error and the registry, never from the name. |

1.1.0 broke one promise of 1.0.0 once (a 1.0 caller that validated against the closed 1.0 schemas rejects 1.1
members; `CHANGELOG.md` and `approaches/migration.md` record it); from 1.1.0 on, 15.1 and 15.6 hold for every later
`1.x`. [Appendix A D20, D27, D32, D33]

15.10. **1.3 and callers.** 1.3 adds no member, document kind or enum value, so a caller of 1.2 reads every 1.3
document. Its new MUSTs (7.2.3, 7.5.2's single warning registry) bind only documents that declare 1.3. It relaxes
three 1.2 rules whose every permitted answer a caller already handles: a cursor given with an argument added at its
default value may continue instead of refusing (the result set is the same); the order among the stateless checks
of 10.7 step 6 is the tool's (every answer is a correct refusal); a constraint's `field` is any argument whose
change satisfies the rule (9.8.1). `STOPPED_MIDWAY` is no longer a core code: a 1.3 tool reports a stop part-way
with its own `INCOMPLETE` code (8.3.2), which a 1.2 caller reads as any exit-1 code after effects, as 1.2's own text
tells it to; 1.2 made `STOPPED_MIDWAY` a SHOULD, so no caller could rely on meeting it. [Appendix A D36]

## 16. Security

16.1. **No secrets in output.** Tokens, passwords, keys and credentials MUST NOT appear in `error` (including
`received`), in `meta`, in `next`, or in a report unless the report exists to show them. A `received` value that may
be a secret is redacted (`"<redacted>"`). Destructive commands take no secret arguments (11.5).

16.2. **Untrusted data.** Reports carry text from other people and systems. A tool MUST NOT interpret such text as
instructions, and SHOULD NOT place it in `hint` or `next`.

16.3. **No hidden switches.** Environment variables MAY supply an option's value only where the option declares
`env`; they MUST NOT change the output kind (4.3.3), filter `schema` (9.2.2), or authorise anything (11.8).

16.4. **Paths.** Paths a tool prints about the caller's workspace SHOULD be relative to the working directory.

16.5. **Input.** `--input` is bounded (10.10); `-` refuses a terminal (10.3); documents never carry flag-only options
(10.6).

---

## Appendix A. Decisions

Decisions taken by the owner. A reason to change one goes through 15.1: a change that breaks a conforming tool or
caller is `atip/2`. The decision texts are kept as taken: a section number inside one is that of the release that took
it, and `approaches/migration.md` (From 1.2 to 1.3) maps the 1.2 sections to these. The Where column names the
sections of this version.

| # | Decision | Where |
|---|---|---|
| D1 | Nested envelope `{ok, data, meta}` / `{ok, error, meta}`, camelCase keys; stored records embedded verbatim keep their case. | 6 |
| D2 | Errors: required `code` (UPPER_SNAKE), `message`, `retryable`; optional `hint`, `field`, `expected`, `received`, `suggestions`; `details[]` only when one input yields several errors. One registry per tool `{code, exit, retryable, meaning, fix}`. | 7 |
| D3 | Exits 0 success, 1 ran and negative/incomplete, 2 usage/refusal/not found/invalid input; signals 128+n outside the table. Restated by D15. | 8 |
| D4 | Noun-verb groups, no runnable groups, primary object an operand, other ids bare-noun options, no aliases across a cutover. | 4.1, 4.6 |
| D5 | `<tool> schema [path...] --json`, working with no repo, config or running app; `data.kind` tree, group, command, errors, error; exits only in the registry; `x-<tool>` extensions. | 9 |
| D6 | `--input <JSON\|FILE\|->`: one object required; batches optional and declared per command. | 10 |
| D7 | Destructive commands preview by default and act with `--commit --plan-digest <DIGEST>`. | 11 |
| D8 | The guide ships in the binary: `<tool> skills show [NAME]`. | 14 |
| D9 | Spec style: normative prose with BCP 14 keywords and conformance levels; JSON Schema 2020-12 normative for shapes. | 1.4, 2.1 |
| D10 | Rust tools generate the self-description from clap; TypeScript tools are spec-first (`defineCommand`); a shared checker runs every built binary in CI. | `approaches/` |
| D11 | Owner decisions 2026-10-28 on the revision-1 open questions, listed below as D11.1-D11.18. | |

| Decision | Owner decision 2026-10-28 | Where |
|---|---|---|
| D11.1 (revision-1 question 18.1): lute exit 3 | No exit 3. An incomplete walk is exit 1 with a registered code; an accepted patch is exit 0 with its changes in `data`. | 8.6 |
| D11.2 (revision-1 question 18.2): `schema` text mode | Text-mode `schema` exists and is not part of the contract; it MAY print the JSON document. | 9.1.3 |
| D11.3 (revision-1 question 18.3): `count` | Kept; new count options SHOULD NOT be added; its scalar input and occurrence-based default are the exception to "repeatable = array". | 9.7.2 |
| D11.4 (revision-1 question 18.4): `meta.context` | Keys are the context option names, values the resolved values, relative paths, absent keys omitted; explicit > env > discovered/default. | 6.7, 10.7 |
| D11.5 (revision-1 question 18.5): paging and fields | Reserve `--limit`, `--cursor`, `--all`, `--fields`; `meta.page {returned, nextCursor?, total?}`; `meta.truncated`; `meta.fields` and projection with a reduced `required` set. | 4.5, 6.9, 6.10 |
| D11.6 (revision-1 question 18.6): `next` | `{command, argv, reason?}`, `argv` without the executable; allowed on success and failure; transport keys under `x-<tool>`. | 6.8 |
| D11.7 (revision-1 question 18.7): streams | NDJSON lines with `type`: `start`, `event`, `end` with the ordinary envelope as `result`; no `end` means cut off. | 13 |
| D11.8 (revision-1 question 18.8): failures while working | Before any effect 2; after work began 1; `INTERNAL` 1; distinct codes when a category occurs at both stages; no call-site overrides. Restated by D15: the boundary is whether the command ran, not whether it made an effect. | 7.4.2, 8.3 |
| D11.9 (revision-1 question 18.9): reserved codes | Keep the reserved codes, including `UNKNOWN_COMMAND` and `COMMAND_REQUIRED`. | 7.3 |
| D11.10 (revision-1 question 18.10): operation key | Reserve `--operation <KEY>` (input key `operation`); same key with a different payload refuses; in-flight work is recovered, not restarted. | 12.4 |
| D11.11 (revision-1 question 18.11): `--yes` | No `--yes`; preview + `--commit --plan-digest` only. | 11.8 |
| D11.12 (revision-1 question 18.12): `meta.contract` | REQUIRED on `schema` answers, SHOULD on every envelope. | 6.6 |
| D11.13 (revision-1 question 18.13): output schemas at L1 | Required at L1, including the JSON representation of artifacts. | 9.9 |
| D11.14 (revision-1 question 18.14): depth | SHOULD NOT exceed two words; the checker warns. | 4.1.1 |
| D11.15 (revision-1 question 18.15): `--json` position | Required after the path, allowed before it. | 4.3.5 |
| D11.16 (revision-1 question 18.16): warnings | `{code, message, field?}` with registered codes. | 7.5 |
| D11.17 (revision-1 question 18.17): typed operands | Operands take their operand's valueType in `--input`, numeric strings normalised, `json` operands any JSON value. | 10.5 |
| D11.18 (revision-1 question 18.18): short options | Allowed and listed; new ones discouraged. | 4.6.5 |

| # | Owner decision 2026-10-28, revision 3 | Where |
|---|---|---|
| D12.1 (revision-2 question 18.1) | Keep `meta.output`. | 6.6, 6.11 |
| D12.2 (revision-2 question 18.2) | Reserve `OPERATION_REUSED`: eleven reserved codes (twelve with D16.1). | 7.3.1, 12.4 |
| D12.3 (revision-2 question 18.3) | Refusal and preview purity is strict, including log files and telemetry. | 11.2 |
| D12.4 (revision-2 question 18.4) | Keep the five constraint rules; extend only on evidence. | 9.8 |
| D13 | The contract is named **ATIP, Agent Terminal Invocation Protocol**; contract id `atip/1`; conformance stated as "ATIP L1 conformant"; checker command `atip check`; TypeScript package `@journeykit/atip`, Rust crate `atip`. It was called `agent-cli/1` through revision 2. | title, 3.5, `approaches/` |
| D14 | OpenCLI is ignored: no alignment and no exporter, because nothing consumes OpenCLI documents for these tools. | 1.5 |
| D15 | The exit rule is stated as: 1 = the command ran and its answer is negative or incomplete; 2 = the command refused to run. Every example and table follows it. | 8.1, 8.3 |

| # | Owner decision 2026-10-29, revision 4 | Where |
|---|---|---|
| D16.1 (revision-3 question 18.1) | Reserve `CURSOR_INVALID` (exit 2, not retryable): twelve reserved codes. | 6.9, 7.3.1 |
| D16.2 (revision-3 question 18.2) | Keep projection by restriction, made sound: only the cut nodes are restricted, with no `const`, `enum` or other keyword that can reject a projection of a valid value. | 6.10, 9.13 rule 11 |
| D16.3 (revision-3 question 18.3) | No reserved code for an uncertain operation outcome; the refusal is tool-specific, not retryable, names a durable inspection command, keeps the key reserved, and the guide says how to resolve it. | 12.4 |

| # | Owner decision 2026-10-29, revision 5 | Where |
|---|---|---|
| D17 (revision-4 question 18.1) | `domain` is a fixed interoperable profile: numeric `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`; string `minLength`, `maxLength`, `pattern` in an I-Regexp (RFC 9485) form both Rust and ECMAScript honour; for `json` arguments a minimal set of structural keywords. `format` is an annotation only. A stateless check outside the profile is not a precondition: it stays in step 6 with a registered code, declared as a validator in the self-description. | 9.7.4, 9.8.3, 10.7 |

| # | Owner decision 2026-10-29, revision 6 | Where |
|---|---|---|
| D18 (revision-5 questions 18.1, 18.2) | No `anyOf` and no array length keywords in `json` domains: validators cover such checks until a real command needs them. `rejects` stays required on validators. | 9.7.4, 9.8.3 |

| # | Owner decision 2026-10-30, release | Where |
|---|---|---|
| D19 | 1.0.0 adopted 2026-10-30 after six rounds of independent review. | status, 15.1 |

| # | Owner decision 2026-10-31 to 2026-11-01, version 1.1.0, from implementer feedback from two early adopters | Where |
|---|---|---|
| D20 | Versions are `MAJOR.MINOR.PATCH` of `atip/1`, with the change classes of 15.1. Callers ignore unknown members of every object the contract defines, not only of reports. A tool declares its minor in `meta.contractVersion` and emits only what that minor defines. The published schemas stay closed for tools; callers read them open; members added after 1.0 carry `x-atip-since`. 1.1.0 changes 1.0.0's 15.1 once, stated in 15.9, because no conforming caller outside the two early adopters existed. | 6.6, 9.1.4, 9.12, 15 |
| D21 | `error.reason`: an optional UPPER_SNAKE sub-reason registered under its code (`reasons: [{reason, meaning, fix}]` on registry entries), unique within the code, never emitted unregistered, sharing the code's exit. Callers may branch on code and reason. Reserved reason names for the reserved codes that cover several situations. Finer codes stay allowed only instead of `USAGE`. | 7.1, 7.3.2, 7.3.3, 7.6 |
| D22 | A warning registry of its own: `schema --warnings` and `schema --warning <CODE>`, entries `{code, meaning, fix}`. A 1.1 tool SHOULD register warning codes there; a warning in the error registry with exit 1 stays valid. A situation reported both ways is registered in both. `--error` given a warning-only code refuses with a hint to `--warning`. | 7.4.4, 7.5, 9.1 |
| D23 | Field paths write a member whose name is not an identifier as a bracketed JSON string (`attributes["http.status-code"]`); a declared map makes its keys selectable. Paths without brackets are unchanged. | 6.10, 9.13 rules 11 and 15 |
| D24 | No per-command member saying whether a command accepts `--json`. The command document already lists `json` in `options`, and 4.2 requires it on every command with a report or artifact output, so the member would repeat `options` and could disagree with it. A tool that builds `next` knows its own parser; a caller gets `argv` ready-made. To be revisited if a tool shows a case that `options` does not answer. | 4.3.2, 6.8, 9.5 |
| D25 | New SHOULD and MAY rules: an L0 tool SHOULD offer `schema --errors` and the checker compares it with the fixture; tool-wide options SHOULD be accepted wherever `--json` is, groups included; a write whose failure point cannot be shown to be before the work MAY report it as during-the-work (exit 1), while exit 2 still means nothing changed. | 4.7, 7.4.4, 8.3.1, `approaches/checker.md` |
| D26 | Clarifications: `USAGE` SHOULD carry `field`, and without one its hint names the command's `schema`; in text mode a refusal prints nothing on stdout and exit 1 may print its result; `--input` given twice or without a value is `USAGE`; precondition and during-the-work code names; a code with two exits is split; a batch report is its own output; a signal shows as a wait status or as a launcher's 128+n; a `hint` is exactly one of its three forms; a report may keep its own paging members, `meta.page` is authoritative. | 5.3, 6.6, 6.9, 7.1.2, 7.1.3, 7.4.2, 8.3, 8.4, 10.2 |
| D27 | A minor never makes a 1.0-conforming tool non-conforming: a 1.1 rule that would (map cut nodes, command-line hints, `--input` twice as `USAGE`) applies only to a document that declares 1.1, and a 1.0 tool keeps 1.0's behaviour; dual warning/error registration applies only to a tool that keeps a warning registry. A 1.1 tool sets `contract` and `contractVersion` everywhere, so an unmarked document is always 1.0. Callers build a view of a document with unknown listed values before validating it. | 6.10, 7.1.2, 7.5.3, 10.2, 15.7, 15.8, 15.9 |
| D28 | A caller's view leaves out every unknown variant (argument, output, tree entry, batch item) and drops the producer's completeness rules it can no longer meet (`minItems`, `contains`, `if`/`then`/`else`), so it never rejects a document for what it left out; a listed member that is not a string is a wrong type and is rejected. A map key containing U+0000 is not selectable. A 1.1 tool's markers are a MUST of the checker's L0.contract-version. | 6.10, 15.6, 15.8 |
| D29 | Every string member whose values the contract lists has an explicit caller treatment for an unknown value, in one table (15.6): refuse the document (another major), the document part is unusable, the entry is left out, or the most cautious known value. The table is read from the schemas, and a later minor that adds a listed member adds its row. | 15.6, 15.8 |

| # | Owner decision 2026-11-01, version 1.1.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D30 | Wording, the schema and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. The `meta.contractVersion` pattern no longer admits `"1.0"`, which 6.6 already never emits. Stated where implementers missed them: validators run for every invocation, before any precondition; selection is per output, and a union-shaped output offers no `--fields`; a switch's `default` is always `false`, with `defaultNote` for a configured effect; the `field` and `expected` of `schema`'s own refusals; previews and `--dry-run` make no effect whatever their exit; when a remote system that makes the effects also computes the digest, the tool passes it through, and a commit whose digest only that system can recompute, when it cannot, is refused with the tool's own exit-2 code (a tool that recomputes the plan itself and detects changes per effect is unaffected); `USAGE` in 12.7 includes its registered finer replacement. Checker: the `paged` fixture key and the non-paging observation, `"registry": "from-schema"`, L1.hint-command, and the scope of several L0 rows. | 6.10, 9.1.2, 9.7.3, 9.8.3, 11.2, 11.6, 11.7, schema/envelope.schema.json, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-01, version 1.1.2, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D31 | Wording and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. Stated where it could be read two ways: a caller pages with the `next` entry's arguments, changing at most `--limit` and `--fields` (cursor binding itself is unchanged; which arguments bind a cursor is for 1.2.0); `--all` asks for every remaining item, a `--limit` without a bound; a batch input reads `--fields` against the batch output, whose paths are paths into the batch report, and a batch schema written as `allOf` the batch-report schema declares no `fields`; a lone `--commit` or `--plan-digest` may also refuse with the `code` of the `requires` rule that states the pair; 12.7's closing sentence no longer reads as if a tool that recomputes its plan had to detect changes per effect rather than hold a lock. Checker: the fixture key `prepare` (programs that prepare the world before `setup`; a step running the tool's binary is refused, the report lists every step, and the tool's state is still made by `setup`), a failing `prepare` or `setup` step is a fixture error, L1.validators without `prepare` either, an L0 answer to `--cursor x` that shows neither absence nor `CURSOR_INVALID` counts as paging, an advisory without a subject in the run is `unsupported`, `from-schema` without `schema --errors` leaves only L0.ok-exit `unprovided`, and L2.destructive-half accepts the rule's `code`. | 4.5, 6.9, 6.10, 11.7, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-02, version 1.2.0, a minor (15.1) from implementer feedback | Where |
|---|---|---|
| D32 | Paging, field selection and the stateless checks, for a document that declares 1.2 only (the D27 pattern, now named in 15.1's MINOR row: a tool that declares 1.1 or 1.0 keeps its behaviour and stays conforming). A cursor is bound to every argument except the reserved options that never change the result set (`--json`, `--limit`, `--all`, `--cursor`, `--fields`); an argument given explicitly with its default value is given, except a switch given `false` or a count given `0`, which are absent (10.7.2); a value taken from an `env` variable is bound though not given. The next-page entry carries exactly the arguments the invocation gave explicitly, never a default or an `env` value, so it continues in the same environment. This relaxes 1.1's binding of `--json` and `--all` only where the result set is the same (15.1, 15.10). `--fields` is parsed and validated with or without `--json`; what it does to text is the tool's. `limit`, `cursor`, `all` and `fields` are flag-only. Argv parse failures come before step 6 of 11.7 (the one at the earliest argv position first), which checks `required`, domains, constraints and validators in that order (operands then options in declaration order for the first two, declaration order for the last two), and the first failure answers. A constraint's argument at fault is defined per rule. Declined: per-item batch `--fields`, since 1.1.2 already gives one answer (`USAGE` when the batch output declares no `fields`). | 4.5, 6.9, 6.10, 9.8.1, 10.6, 10.7, 15.1, 15.9 (changed for 1.3 by D36) |
| D33 | `STOPPED_MIDWAY` (exit 1, not retryable) is reserved since 1.2: a command that works in steps and stops after a step made effects, because a later step meets what the command refuses before its work, reports it with that refusal's code as `reason` (the refusal's own reason is not carried), instead of a during-the-work twin of every refusal code. SHOULD for a tool that declares 1.2, so a tool with a code of its own stays conforming; a 1.2 tool that registers the name gives it this exit, retryability and meaning. The reserved meaning holds only in a document that declares 1.2: in an earlier document the code is the tool's own, read by its registry entry. The name is the one the first adopter already uses and says what happened and when; an `*_INCOMPLETE` name was not chosen because exit 1 already covers incomplete answers that made no effect (8.1, 8.5), and `BATCH_INCOMPLETE` stays the code of a batch, under which a stopped item is `failed` with `STOPPED_MIDWAY`. Reserved reason `PLAN_STALE`, for a commit that detects a changed plan between its effects (12.7). | 8.3.2, 11.7, 15.9 (changed for 1.3 by D36) |
| D34 | Wording and checker rows that a patch could carry, released with 1.2.0: a check that reads an option's `env` value is a validator; a constraint's `field` follows the rule's own order, never argv's; rules said of a document that declares 1.1 hold for every later minor. Approaches: report schemas compare by meaning, not bytes; defaults are decoded at definition; the 1.2 cursor digest. Checker: the `in` check on switches and counts named; `--input` rows for environment values and spelling variants; a fixture invocation listed to succeed and refused with a precondition code is `unprovided`, never a pass, while a refusal from a stateless step is `fail`; the 1.2 rows for paging, `--fields` without `--json`, flag-only document keys, the check order and `STOPPED_MIDWAY`. | 6.10, 7.1.2, 7.5.2, 9.8.1, 10.2, approaches/typescript.md, approaches/checker.md |

| # | Owner decision 2026-11-02, version 1.2.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D35 | Examples, approaches and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.2"`. Plan digest test vectors for 12.6's recommended form (`sha256:` over RFC 8785 canonical JSON), recomputed by `scripts/validate.sh`; they bind no tool that computes its digest another way, and they are the reference for every tool that follows the SHOULD. Approaches: which schemars view generates an output schema; a `read` command keeps the cache its `effectNote` names. Checker: the fixture key `notRun`, for a command that does not end on its own: it runs once until its first JSON document, which the envelope and output checks read, and is then signalled; its other runs that would succeed are skipped and reported, and a check left with no run is `unprovided`. A plan holds integers beyond ±(2^53-1) as strings and only valid Unicode (examples/README.md). | 11.6, examples/plan-digest/, approaches/rust.md, approaches/migration.md, approaches/checker.md |

| # | Owner decision 2026-11-03, version 1.3.0, a minor (15.1) | Where |
|---|---|---|
| D36 | ATIP is a protocol: this document defines conformance, and a conformance checker is a tool that tests it, not its definition. The spec is restated as the messages that cross the boundary (invocation, envelope and stream lines, the error object, exit status, `next`, the self-description, input documents, the destructive exchange, paging and field selection, versioning), each as shape, semantics and interaction rules. Rules whose only purpose was an exact checker verdict are recommendations in `approaches/implementation.md`: the order among the stateless checks of step 6 (stateless checks still precede every state read), which argument a constraint's `field` names when several qualify (it still names one the caller can add or remove), whether an argument given at its default value changes a cursor's binding (an `env` value still binds it) and what the next-page entry carries exactly, and the argv conversion of an `--input` document (its answer must still equal direct validation). Error codes: a tool's own code is `<SUBJECT>_<CONDITION>`, the subject a noun phrase, the condition one of fourteen (`INVALID`, `REQUIRED`, `NOT_FOUND`, `EXISTS`, `CONFLICT`, `STALE`, `EXPIRED`, `DENIED`, `UNSUPPORTED`, `TOO_LARGE`, `UNAVAILABLE` exit 2; `FAILED`, `INCOMPLETE`, `TIMEOUT` exit 1), and the condition fixes exit and retryability (`UNAVAILABLE` and `TIMEOUT` retryable; `FAILED` and `INCOMPLETE` may be when a repeat resumes without repeating effects); MUST for a document that declares 1.3, SHOULD-shape for warning codes. The twelve core codes keep their names, five of which predate the grammar, because renaming a core code is `atip/2`. `STOPPED_MIDWAY` leaves the core set for 1.3: a stop part-way is the tool's own `INCOMPLETE` code with the refused code as `reason`. D33 declined an `*_INCOMPLETE` name because exit 1 also covers incomplete answers that made no effect; under the convention the effect class says whether a stop left effects, and the caller action (read what was done before repeating) is the same, so the condition carries it. A 1.3 tool keeps its warning codes in the warning registry, so that its error registry holds only codes that follow the convention. 1.3 adds no member, document kind or enum value; a tool that declares 1.0, 1.1 or 1.2 is held to that minor's release text. | 3, 7.2, 7.3, 7.5.2, 8.3.2, 9.8.1, 10.7, 15.9, 15.10, approaches/implementation.md, approaches/checker.md |

## Appendix B. Prior art

Public tools and documents the contract learned from. They are cited for the problems they solve, not as
conformant tools.

| Source | What ATIP took from it |
|---|---|
| canon (`https://github.com/journeyWorker/canon`, npm `@journeykit/canon`) and lute (`https://github.com/journeyWorker/lute`), Rust and clap | The first tools the contract was written for: a generated command spec, error registries, exit rules, `--input`, preview and plan digests, skills shipped in the binary. canon is the source of the translated examples. |
| cf, Cloudflare's agent-facing CLI (`https://github.com/cloudflare/cf`) | One line in `--help` pointing agents at a machine-readable description; dry runs that print the exact effect; agent context detection, which ATIP declines (4.3.3). |
| Orca's CLI reference (`https://www.onorca.dev/docs/cli/reference`) | Searching the command tree by task (9.11); selectors as explicit options. |
| Google Workspace CLI (`https://github.com/googleworkspace/cli`) | One JSON document carrying a whole request, beside ordinary flags (10). |
| gh, kubectl, cargo, docker, wrangler, oclif | Noun-verb grammars, `--json` output, field selection and paging, generated reference documentation, deprecation policies. |
| Effect 4 (`https://effect.website`) | Schema-first command declarations from which argv parsing, help and JSON Schema are derived (`approaches/typescript.md`). |
| HTTP semantics (RFC 9110) | Status classes and a small set of status codes a client acts on without knowing the server (404, 409, 503): the model for the conditions of 7.2 and the core codes of 7.3. |
| gRPC status codes (`https://grpc.github.io/grpc/core/md_doc_statuscodes.html`) | A fixed vocabulary of canonical error conditions shared by every service, each with retry guidance (`NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `UNAVAILABLE`). |
| A2A (Agent2Agent protocol) and ACP (Agent Client Protocol) | Agent-facing protocols written as message shapes and interaction rules, which 1.3 adopted as the form of this document. |
| RFC 2119, RFC 8174, RFC 5234, RFC 6901, RFC 7493, RFC 8259, RFC 8785, RFC 9485, JSON Schema 2020-12 | Keywords, the argv and code-name ABNF, pointers, I-JSON numbers, JSON, canonical JSON for plan digests, I-Regexp patterns, wire shapes. |
| `../scripts/regex-cases.json`, `../scripts/regex-parity/` | Patterns and values run through ECMAScript and the Rust `regex` crate (9.7.4). |
