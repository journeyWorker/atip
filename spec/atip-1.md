# ATIP: Agent Terminal Invocation Protocol (`atip/1`)

Status: **1.5.0, release candidate**: a minor (15.1) that lets a domain pattern of a document that declares 1.5 use
`\p{White_Space}` and `\P{White_Space}`, the Unicode `White_Space` property, which Rust `regex` and ECMAScript read
alike (Annex V2, Appendix A D41). Version 1.4.2, adopted 2026-11-04 after one round of independent review, is a patch
that says how a caller writes none for a repeatable option in `--input` and that `--version --json` resolves its path
first (D40). Version 1.4.1, adopted 2026-11-04 after one round of independent review, is a patch that states the
compactness rule as whitespace outside strings only, applies 7.3.2's naming to every minor from 1.3, and words the
MINOR row for replaced members (D39). Version 1.4.0, adopted 2026-11-04 after two rounds of independent review, is a
minor (15.1) that makes the self-description small and compact for agents and separates `--help` from `schema` (D38);
1.3.1 and 1.3.0 are described in D37 and D36.
`CHANGELOG.md` lists every version. Annexes: `spec/annex-fields.md` (F, field selection), `spec/annex-domains.md`
(V, argument domains and numbers), `spec/annex-schema.md` (S, self-description rules).

Contents: 1 Introduction · 2 Terms · 3 Conformance · 4 Invocation · 5 Output channels · 6 Envelope · 7 Errors ·
8 Exit status · 9 Self-description · 10 Input documents · 11 Effects and the destructive exchange · 12 Long-running
work · 13 Streams · 14 Guides · 15 Versioning · 16 Security · Appendix A Decisions · Appendix B Prior art.

---

## 1. Introduction

1.1. **Purpose.** ATIP is a protocol between a command-line tool and its caller, usually a coding agent or a script,
so that a caller that knows it can use any conforming tool without reading its source.

1.2. **Scope.** What a conforming tool exposes (argv, stdout, stderr, exit status and its JSON documents) and what a
caller may rely on, for invocations that print a report, an artifact or a stream and exit. A server a command starts
is out of scope beyond that command's declared output and `effectNote`; how a tool is built is out of scope
(`approaches/` is not normative).

1.3. **The exchanges.**

| Exchange | The caller sends | The tool answers | Sections |
|---|---|---|---|
| Run | argv | in JSON mode one envelope on stdout; exit 0, 1 or 2 | 4-8 |
| Discover | `schema` invocations | the command tree, command documents, the registries | 9 |
| Arguments as a document | `--input <JSON\|FILE\|->` | as for a run | 10 |
| Destructive act | the command, then the commit its preview put in `meta.next` | a plan and its digest; then the effects or `PLAN_STALE` | 11 |
| Page | the next-page entry of `meta.next` | the next page | 6.9 |
| Accepted work | the start, then the wait in `meta.next` | "accepted", then the outcome | 12 |
| Stream | the command with `--json` | NDJSON start, events, end | 13 |
| Guide | `skills show` | the guide for agents | 14 |

Every answer tells the caller what to do next: the exit status whether the command refused (nothing changed), ran
with a negative answer, or succeeded (8); the code's condition what went wrong (7.2); `retryable` whether repeating
it can succeed; `meta.next` the runnable follow-ups (6.8).

1.4. **Normative sources.** The JSON Schemas in `schema/` are normative for shapes, and this document does not restate
them; the annexes are normative where this document refers to them. Where prose and a schema disagree, the schema
wins for shape and the prose for behaviour. ATIP is not a general CLI description format (D14).

## 2. Terms and notation

2.1. MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL
are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

2.2. A **tool** is the executable that claims conformance; a **caller** runs it. A **command** is a runnable node of
the command tree, named by its **path** (`["finding","close"]`) and **id** (`finding close`); a **group** only groups.
An **argument** is an **operand** (positional) or an **option** (`--name [<VALUE>]`; a **switch** takes no value),
however given. **JSON mode** is an invocation with `--json` (4.3.4). The **envelope** is the document printed in JSON
mode (6); a **report** is its `data`; an **artifact** is bytes printed as they are in text mode; a **stream** is output
over time (13). An **effect** is a change to state the tool or its user owns. A **refusal** is a failure with exit 2.
A code's **condition** fixes its exit and retryability (7.2); a **core code** is one every tool shares (7.3).

2.3. JSON members are written `like.this`, placeholders `<LIKE_THIS>`; JSON pointers are RFC 6901. `[Appendix A D<n>]`
cites an owner decision.

## 3. Conformance

3.1. A tool conforms when every invocation, document and exit status follows this document for the minor it declares
(15.5) and the level it claims. A caller conforms when it reads documents as 15.4 and 15.6 say and acts only on what
the protocol defines, never on `message`, text output or stderr.

3.2. **Levels**, cumulative:

| Level | Adds | Sections |
|---|---|---|
| **L0** | output selection and channels, the envelope, errors and the registry, exit status, versioning, security | 4.3, 4.4.1, 5-8, 15, 16 |
| **L1** | the command tree, argv syntax, reserved options, command design, the `schema` self-description | 4.1, 4.2, 4.4.2, 4.5, 4.6, 9 |
| **L2** | `--input`, the destructive exchange, long-running work, streams, the guide | 4.4.3, 10-14 |

3.3. A rule never requires a feature of a higher level; a mention of one applies only to a tool that offers it.

3.4. A tool MAY offer higher-level features; what it offers MUST follow this document.

3.5. **Claims.** An L1 or L2 tool declares its level as the tree's `level` (9.3); every tool declares its minor in
`meta.contractVersion`. A claim names both for a release ("ATIP 1.3 L1 conformant"); a tool MUST NOT claim a level
whose rules it does not follow.

3.6. **Exceptions** (a passthrough, a hook whose stdin another program owns) MUST be declared through the output kind
(9.9) and `effectNote` (9.5); there is no other mechanism.

3.7. **Testing** (informative). Conformance is defined by this document alone; `approaches/checker.md` describes a
tool whose findings against a built binary are evidence, and the tool's own tests show what it cannot observe.

## 4. Invocation

### 4.1. The command tree

4.1.1. A path is a group noun and a verb (`finding close`) or one root word (`schema`); it SHOULD be at most two
words, each `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. [Appendix A D4, D11.14]

4.1.2. A node is a group or a command, never both; a group run bare refuses with `COMMAND_REQUIRED`, `expected` its
commands.

### 4.2. Argv syntax

4.2.1. Every conforming parser accepts at least this grammar, and callers (examples, `next`, guides) use only it. It
is RFC 5234 ABNF over argv elements: `SEP` separates elements; a `-word` rule matches one whole element.

```abnf
invocation    = *( global SEP ) path *( SEP argument ) [ SEP "--" *( SEP operand-word ) ]
path          = command-word *( SEP command-word )
command-word  = name
argument      = option / free-operand
option        = long-switch / long-joined / long-separate / short-form
long-switch   = "--" name                         ; a switch, or one occurrence of a count
long-joined   = "--" name "=" value               ; value: the rest of the element, possibly empty
long-separate = "--" name SEP plain-word          ; the next element is the value; it does not start with "-"
short-form    = "-" ALPHA [ SEP plain-word ]      ; only for declared short options
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

4.2.2. A repeatable option is given once per value, in order; a count once per occurrence. `--name=value` equals
`--name value`; a value that is empty or starts with `-` (other than `-`) is written joined, and a tool MUST accept
the joined form for every valued option. The first `--` ends the options, and a tool MUST accept operands after it.
A short option equals its long name and is never joined or bundled.

### 4.3. Output selection

4.3.1. Without `--json` a command prints text for a person, which is not part of the protocol.

4.3.2. A command whose outputs (9.9) include a report or an artifact MUST accept `--json` and then print exactly one
envelope (6); a stream command prints the lines of 13.

4.3.3. The output kind and the JSON shape MUST NOT depend on a terminal, environment variables or configuration;
content MAY follow declared inputs (`env` values, context, state), and text styling MAY follow `NO_COLOR` and `TERM`.

4.3.4. An invocation is in JSON mode when the element `--json` appears before the first `--`, even when parsing then
fails, so that every parse failure is a JSON failure envelope.

4.3.5. `--json` MUST be accepted anywhere after the path and before `--`, and MAY be before the path; examples and
`next` put it after the path. [Appendix A D11.15]

### 4.4. Help and version

4.4.1. `--help`/`-h` and `--version`/`-V` print text for people and exit 0; that text is not part of the protocol, and
`--version` SHOULD print `<tool> <version>`. The machine-readable self-description is `schema` (9), never `--help`: in a
1.4 document `--help` with `--json` refuses with `USAGE`, `field` `--help`, `hint` `<tool> schema <PATH> --json` for the
path it named (`<tool> schema --json` at the root), after the path is resolved, so an unknown word still answers
`UNKNOWN_COMMAND`; `--version` with `--json` refuses the same way, after the path is resolved, with `field` `--version`,
`hint` `<tool> --version` (every envelope's `meta.toolVersion` carries the version). (Earlier minors MAY answer `--help
--json` with the `schema` document.)

4.4.2. (L1) The first line of the root `--help` MUST point agents at `<tool> schema --json` (every `--help` SHOULD),
never at a `schema` the tool lacks.

4.4.3. (L2) That line MUST also name `<tool> skills show`.

### 4.5. Reserved options

These names mean the same in every tool, and a tool that offers the behaviour uses them: `--json` (4.3), `--input`
(10), `--commit` and `--plan-digest` (11), `--dry-run` (11.10), `--limit`, `--cursor` and `--all` (paging, `--all`
being a `--limit` without a bound, 6.9), `--fields` (6.10), `--operation` (12.4), `--help` and `--version` (4.4). The
**flag-only** ones, never `--input` document keys (10.6), are `json`, `input`, `commit`, `plan-digest`, `limit`,
`cursor`, `all` and `fields`. Only `--commit --plan-digest` authorises a destructive act (11.8).
[Appendix A D7, D11.5, D11.10, D11.11, D32]

### 4.6. Command design

The command tree and its options follow the design rules of Annex S1 (normative at L1): verbs under noun groups, one
operand kind, bare-noun identifier options, one meaning per option name, no abbreviations or aliases, unknown words
refused, and tool-wide options accepted after a group word. [Appendix A D4, D11.18, D25]

## 5. Output channels

5.1. In JSON mode stdout MUST hold exactly one UTF-8 JSON document and a newline, on success and on failure; a stream
(13) prints one document per line. Every document is compact, without whitespace (space, tab, CR, LF) outside
strings: MUST in a document that declares 1.4, SHOULD before. Number spellings and string escapes are the tool's.

5.2. In JSON mode stderr MUST NOT carry the result or the error and SHOULD be empty except for progress; callers MUST
NOT parse it.

5.3. In text mode errors and progress go to stderr; a refusal prints nothing on stdout, and a command that ran and
exits 1 MAY print its result there. [Appendix A D26]

5.4. A tool MUST NOT prompt; a missing value refuses. Only `--input -` and options that declare `-` read stdin, once.

5.5. A failure that reaches the tool's code MUST be enveloped in JSON mode; one before it (a runtime that cannot
load) MUST exit non-zero and SHOULD leave stdout empty.

## 6. Response envelope

Shape: `schema/envelope.schema.json`. [Appendix A D1]

6.1. Success is `{ok: true, data, meta}`, failure `{ok: false, error, meta}`.

6.2. `ok` is `true` exactly when the exit status is 0.

6.3. Keys are camelCase, except inside a stored record embedded verbatim, as its schema shows.

6.4. A failure of a command that ran MAY carry its partial report in `data`; a refusal never does.

6.5. Absent optional members of the envelope, `meta` and `error` are omitted, never `null`.

6.6. **`meta`** carries only these members and `x-<tool>` (9.10.2):

| Member | Present | Meaning |
|---|---|---|
| `schemaVersion` | always | the version of the output `data` follows (6.11); on a `schema` answer, the declared minor |
| `tool`, `toolVersion` | always | the executable name and its release |
| `command` | once a path resolved | the command id, or the longest path resolved before the failure |
| `contract`, `contractVersion` | as 15.5 says (from 1.1, always) | `"atip/1"` and the declared minor |
| `output` | with `data`, when the command has several outputs | which output schema `data` follows |
| `context`, `next`, `warnings`, `coverage` | OPTIONAL | 6.7, 6.8, 7.5, what a check examined (8.5) |
| `page`, `truncated`, `fields` | on a paged, cut or projected answer | 6.9, 6.10 |

6.7. **Context.** `meta.context` holds, under each context option's camelCase name, the value the command used,
given or resolved (paths relative), so a caller can repeat it. An explicit value beats its `env` variable, which
beats discovery or the default. [Appendix A D11.4]

6.8. **Next steps.** `meta.next` lists runnable follow-ups, best first, on success and failure. `argv` is the
invocation without the executable, every word literal (no placeholder; a step that needs a value the tool lacks is
a `hint`, 7.1.2). `command` is the same invocation as one string that splits, as a POSIX shell would, into the tool
name and `argv`; a tool SHOULD single-quote the words that need it. In JSON mode an entry whose command accepts
`--json` includes it. [Appendix A D11.6]

6.9. **Paging and truncation.** A paged answer carries `meta.page` (`returned`, `nextCursor` exactly when more items
follow, `total` when known), and with `nextCursor` a next-page entry in `meta.next`: the same invocation with
`--cursor <nextCursor>`, which continues the listing in the same environment. A cursor is bound to every value that
decides the result set (every argument except `--json`, `--limit`, `--all`, `--cursor` and `--fields`, values taken
from an `env` variable included); given with other values, or not issued by this command, it refuses with
`CURSOR_INVALID`, `field` `--cursor`. Whether giving an argument at its default value rebinds a cursor is the tool's
choice (`approaches/implementation.md` §3), so a caller continues with the next-page entry's arguments, changing at
most `--limit` (or `--all`, a `--limit` without a bound) and `--fields`. `meta.page` is authoritative over any paging
members a report keeps. An answer cut by size carries `meta.truncated` and a `next` entry that reaches the rest.
[Appendix A D11.5, D16.1, D32]

6.10. **Field selection.** A command whose output declares `fields` (9.9.1) takes `--fields`, a comma-separated list
of the paths that declaration makes selectable, and parses it the same way with or without `--json`. The answer keeps
the selected and the declared `keep` paths, lists them in `meta.fields`, and validates against the projected schema.
Paths, projection and the projected schema are defined in Annex F, which is normative. An unknown path refuses with
`USAGE`, `field` `--fields`.

6.11. **Version of `data`.** `meta.schemaVersion` is the version of the output `data` follows; on a failure without
`data`, of the output the invocation would have produced (the batch output for a batch, else the first output
without `batch`); `"1.0"` before a command resolves.

## 7. Errors

Shapes: `schema/error.schema.json`, `schema/registry-entry.schema.json`, `schema/warning-entry.schema.json`.

### 7.1. The error object

7.1.1. `code` (registered, named as 7.2 says) is what callers branch on; `reason` refines it (7.6) and may be
ignored; `message` is for a person and MUST NOT be parsed; `retryable` is `true` only when repeating the same
invocation unchanged can succeed and equals the registry's; `field` names the argument at fault (`--option`, an
operand's value name, `command`, `--input`, or a document pointer, 10.8); `expected`, `suggestions` and `received`
(redacted if secret) give the valid set, close matches and what was given; `details` lists several errors of one
input. [Appendix A D2, D21]

7.1.2. A `hint` is a runnable invocation, a template with `<UPPER_CASE>` placeholders, or one sentence of prose; one
that starts with the tool name and a space is a command line that splits like `next[].command`. Callers MUST NOT run
a hint that has placeholders. [Appendix A D26]

7.1.3. A `USAGE` error SHOULD carry `field`; without one, its `hint` SHOULD be `<tool> schema <command> --json`
(`<tool> schema --json` when no command resolved).

### 7.2. Code names

A code a tool defines names a subject and a condition. The condition fixes the exit and the kind of step the caller
takes, and gives the default retryability (7.2.3), as an HTTP client acts on 404, 409 or 503 without knowing the
server; the subject and `hint` name the step, and the error's `retryable` stays authoritative. Conditions apply only
to `error.code`: a warning code that shares an error's name (7.5.2) implies no exit. [Appendix A D36]

7.2.1. **Grammar.** The subject is a noun phrase naming the object or area the condition is about (an object kind, an
argument, a resource, a unit of work as a noun: `PROMOTION`, not `PROMOTE`), never empty (a bare `NOT_FOUND` is not a
code; the core codes are the only names outside the grammar), and spelt the same in every code of a tool.

```abnf
code      = subject "_" condition
subject   = UPPER *( UPPER / DIGIT ) *( "_" 1*( UPPER / DIGIT ) )
condition = "INVALID" / "REQUIRED" / "NOT_FOUND" / "EXISTS" / "CONFLICT" / "STALE" / "EXPIRED" / "DENIED"
          / "UNSUPPORTED" / "TOO_LARGE" / "CORRUPT" / "UNAVAILABLE" / "FAILED" / "INCOMPLETE" / "TIMEOUT"
UPPER     = %x41-5A
```

7.2.2. **Conditions.**

| Condition | Exit | Retryable | The command | The caller |
|---|---|---|---|---|
| `INVALID` | 2 | no | refused a value the caller or its user supplied (an argument, a document, a file it named, a configuration the user edits) | changes the value `field` names (with no `field`, as `hint` says) |
| `REQUIRED` | 2 | no | needs something not given or not set up (an argument, a choice, a configuration, a login, an outcome to reconcile, 12.4) | supplies it, as `hint` or `next` says |
| `NOT_FOUND` | 2 | no | was named an object that does not exist | checks the name, or lists |
| `EXISTS` | 2 | no | would create an object that exists | uses it or another name |
| `CONFLICT` | 2 | no | met a request that contradicts itself or its target's state | reads the state, changes the request |
| `STALE` | 2 | no | was given a value from an earlier answer that no longer matches | rereads, repeats with the fresh value |
| `EXPIRED` | 2 | no | was given something time-limited that lapsed (a login, a token, a lease) | obtains a new one |
| `DENIED` | 2 | no | does not permit this caller (a role, a policy, a person-only act) | hands it over (`hint`) |
| `UNSUPPORTED` | 2 | no | cannot do a well-formed request here (build, platform, remote version) | uses another way |
| `TOO_LARGE` | 2 | no | met a request whose size, count or cost exceeds a declared limit (a value outside its domain is `INVALID`) | splits or narrows it |
| `CORRUPT` | 2 | no | found state the tool itself keeps or wrote damaged or inconsistent (a manifest, a pack, a stored row) | repairs or rebuilds it, as `hint` says |
| `UNAVAILABLE` | 2 | yes | lacks something now (an unreachable backend, a held lock, a rate or quota limit that clears with time) | repeats later |
| `FAILED` | 1 | no | ran, and the outcome is negative (a check found problems, an operation or step failed) | reads `data` and `next` |
| `INCOMPLETE` | 1 | no | ran and stopped with work left undone (a batch item or a later step stopped it, 8.3.2; a scope it could not reach whole); what was done stays done | reads what was done first |
| `TIMEOUT` | 1 | yes | waited (12.3) and ran out of time; the work may still finish | repeats the wait (`next`) |

When two seem to fit, the one whose caller action resolves the situation is right. A file that exists but cannot be
read is `DENIED` when the system refuses access, `UNAVAILABLE` only when a repeat can succeed, and for content it
cannot parse `INVALID` (a file the user supplies or edits) or `CORRUPT` (state the tool keeps). A verdict the command
must pass before its work (a gate, an approval, a check of its input or state) is a precondition (8.3) and refuses
with exit 2 and a refusal condition (`BRIEF_APPROVAL_REQUIRED`, `EVIDENCE_INVALID`), whatever the command calls it; a
check whose negative answer is its ordinary result reports it in `data`, with exit 0 or a `FAILED` code.

7.2.3. **Rules**, for a document that declares 1.3: every error code is a core code (7.3) or follows 7.2.1 and never
takes a core code's name; its registered `exit` is its condition's, and so is its `retryable`, except that a
`FAILED`, `INCOMPLETE` or `TIMEOUT` code MAY be registered either way: retryable when repeating the same invocation is
safe (it resumes, or an operation key reconciles it, 12.4), else not. A command that does not wait and runs out of time
uses a `FAILED` or `INCOMPLETE` code; when a remote outcome is unknown after the work began, `meta.next` leads with a
command that reads the state. A category with its own during-the-work code (`WRITE_FAILED`) keeps it. Another
condition or stage is another code. Situations under one subject and condition whose next steps differ are reasons
of one code (7.6); since a reason changes neither exit nor retryability (7.4.2), situations that differ in
retryability are different codes. Warning codes SHOULD have the same shape and MAY end in another state word
(`MEMBER_ARCHIVED`).

### 7.3. Core codes

7.3.1. Every tool uses these codes for these situations and registers those it can produce; a command lists the codes
of the features it offers in `errors` (`--input`: `INPUT_*`; batches: `BATCH_INCOMPLETE`; `--commit`: `PLAN_STALE`;
`--operation`: `OPERATION_REUSED`; `--cursor`: `CURSOR_INVALID`), except in a 1.4 document, where they are implied
(9.5). Five names predate 7.2 and keep them, since renaming a core code is a major change.
[Appendix A D11.9, D12.2, D16.1, D36]

| Code | Exit | Retryable | Condition | When |
|---|---|---|---|---|
| `USAGE` | 2 | no | — | the command line does not parse or breaks a declared requirement, constraint or domain |
| `UNKNOWN_COMMAND` | 2 | no | — | a command word is not in the tree; `expected` the valid words there |
| `COMMAND_REQUIRED` | 2 | no | `REQUIRED` | a group or the bare tool ran without a command; `expected` its commands |
| `INTERNAL` | 1 | no | — | a bug in the tool |
| `UNVERIFIABLE` | 1 | no | — | a check ran but could examine nothing (8.5) |
| `INPUT_INVALID` | 2 | no | `INVALID` | `--input` cannot be read or framed, or fails its fragment schema |
| `INPUT_CONFLICT` | 2 | no | `CONFLICT` | a document value and an argv argument differ |
| `INPUT_TOO_LARGE` | 2 | no | `TOO_LARGE` | over `input.maxBytes` or `input.maxItems` |
| `BATCH_INCOMPLETE` | 1 | no | `INCOMPLETE` | a batch stopped during execution (10.11) |
| `PLAN_STALE` | 2 | no | `STALE` | the recomputed plan no longer has the given digest (11.7) |
| `OPERATION_REUSED` | 2 | no | — | an operation key reused with another payload (12.4) |
| `CURSOR_INVALID` | 2 | no | `INVALID` | a cursor not issued by this command, or for other arguments (6.9) |

7.3.2. Finer parse codes MAY replace `USAGE` for a situation the tool never reports as `USAGE`; in a document that
declares 1.3 or later they follow 7.2 (`OPTION_INVALID` for an unknown or malformed option, `OPTION_REQUIRED` for a
missing one). A caller treats any exit-2 code whose `field` names an argument as a usage problem. Under any other core
code, situations are told apart by reasons.

7.3.3. **Reserved reasons**, SHOULD names for these situations: `INPUT_INVALID` `UNREADABLE`, `STDIN_TTY`, `EMPTY`,
`NOT_JSON`, `NOT_OBJECT`, `BATCH_UNSUPPORTED`, `UNKNOWN_KEY`, `FLAG_ONLY_KEY`, `INVALID_VALUE`; `INPUT_TOO_LARGE`
`TOO_MANY_BYTES`, `TOO_MANY_ITEMS`; `CURSOR_INVALID` `FOREIGN`, `ARGUMENTS_CHANGED`, `EXPIRED`. [Appendix A D21]

### 7.4. The registry

7.4.1. A tool has one error registry, holding every code it can emit as an error; a code is never reused with another
meaning. [Appendix A D2]

7.4.2. A failure's exit is its code's registered `exit`, never overridden at a call site, and an error's `retryable`
equals the entry's; a reason changes neither. [Appendix A D11.8, D15]

7.4.3. (L1) `schema --errors --json` prints the registry, `schema --error <CODE> --json` one entry; an unknown code,
or one only the warning registry has (`hint` its `schema --warning`), refuses with `USAGE`, `field` `--error`. An L0
tool SHOULD offer both. [Appendix A D25]

### 7.5. Warnings

7.5.1. `meta.warnings` items carry registered codes.

7.5.2. The warning registry is printed by `schema --warnings --json` and `schema --warning <CODE> --json`. A tool that
declares 1.3 MUST register every warning code there, and in the error registry only a code also reported as an error,
with the same meaning. A caller reading an earlier minor falls back to the error registry (15.7).
[Appendix A D22, D36]

### 7.6. Reasons

A registry entry MAY list `reasons`, the situations under its code that need different next actions, unique within
the code. Reason names are a namespace of their own per code: a reason may equal a condition word (`CURSOR_INVALID`
`EXPIRED`) and implies no exit or retryability. An error or `details` item carries only a reason registered under its
code; a reason never replaces its code, and adding one is compatible, removing one is not (15.3). [Appendix A D21]

## 8. Exit status

8.1. **The rule.** [Appendix A D3, D15]

| Exit | Meaning | Examples |
|---|---|---|
| 0 | success: the command did what was asked | a preview; a clean check; accepted async work; an empty listing of a scope that was read |
| 1 | **the command ran, and its answer is negative or incomplete** | findings; `UNVERIFIABLE`; a failed or timed-out wait; a stopped batch; a write that could not finish; a bug |
| 2 | **the command refused to run; nothing changed** | usage; invalid input; a missing context or prerequisite; an unknown object; a stale plan; a backend unavailable at start |

8.2. Exits 1 and 2 come with a failure envelope, 0 with a success envelope. A refusal makes no effect (11.2). No other
exit code is used, except a signal's. [Appendix A D11.1]

8.3. **When a command has run.** A command has run once its preconditions passed and its work started.
Preconditions: parsing argv and `--input` (10.7 steps 1-6), resolving context and configuration, prerequisites (a
reachable backend, a login), the objects the invocation names, a verdict it must pass before its work (7.2.2), an
operation key's reservation. A precondition failure is a refusal; a failure after the work started is exit 1, so a
category that can fail at both stages has a code for each (`STORE_UNAVAILABLE`, `STORE_FAILED`). Callers branch on
`code` and `retryable`, not the exit alone. [Appendix A D11.8, D15, D26]

8.3.1. A `write` or `destructive` command that cannot show a failure came before its work MAY report it with its
exit-1 code; it uses exit 2 only for a failure known to precede the work. [Appendix A D25]

8.3.2. **Stopped part-way.** A command that works in steps and, after a step made effects, meets a situation it
refuses before its work (a lease held elsewhere, a plan changed between effects) SHOULD report it with a code of its
own, one `<SUBJECT>_INCOMPLETE` per subject (the unit of work that stopped; a stop that spans the tool rather than one
object uses the command's own noun, `RUN_INCOMPLETE`, `SYNC_INCOMPLETE`), whose `reason` is the refused code alone,
and lead `meta.next` with a command that reads what was done. [Appendix A D33, D36]

8.4. **Signals.** A signal ends a run without an envelope, shown as a wait status or as 128+n from a launcher, which
SHOULD re-raise or exit 128+n. A tool SHOULD release what it claimed and keep the default SIGPIPE behaviour.
[Appendix A D26]

8.5. A check that ran but examined nothing in its scope MUST NOT exit 0: it fails with `UNVERIFIABLE` and SHOULD say
in `meta.coverage` what it looked for. A scope that does not exist, or a configuration the command needs that is
absent, is a refusal with its own code; a scope that was read and holds nothing is an empty success.

8.6. A passthrough command (`exec -- …`) declares its exit exception in `effectNote` (3.6).

## 9. Self-description: `schema`

Shape: `schema/schema-doc.schema.json`; rules beyond it: Annex S2 (normative). `schema` is the machine-readable
self-description, read by agents; `--help` is text for people (4.4.1). This section gives the 1.4 form; 15.7 lists how
a document of an earlier minor differs. [Appendix A D5, D38]

### 9.1. Invocation

```
<tool> schema --json                                  the tree (9.3)
<tool> schema <PATH>... --json                        a group (9.4) or a command (9.5)
<tool> schema <PATH>... --schemas --json              the JSON Schemas a command refers to (9.9.3)
<tool> schema --errors | --error <CODE> --json        the error registry or one entry (7.4)
<tool> schema --warnings | --warning <CODE> --json    the warning registry or one entry (7.5)
<tool> schema --search "<TASK>" --json                ranked commands (9.10.1, OPTIONAL)
```

9.1.1. Path words MUST be accepted as separate words or one quoted string. A path, `--errors`, `--error`, `--warnings`,
`--warning` and `--search` exclude each other (`USAGE`), and `--schemas` needs a command path and none of the others
(`USAGE`, `field` `--schemas`); an unknown path refuses with `UNKNOWN_COMMAND`, `expected` the valid words at that
position. Without `--json`, `schema` prints text, which MAY be the JSON document. [Appendix A D11.2, D30]

9.1.2. The answer's `meta.command` is `"schema"` and its `meta.schemaVersion` the declared minor. [Appendix A D20, D22]

### 9.2. Works without state

`schema` MUST answer with no repository, configuration, network, service, login or environment variable, MUST NOT
refuse for missing context, MUST NOT depend on the environment (an explicit option MAY filter it), and writes
nothing (11.2). For one build it SHOULD be byte-identical across runs.

### 9.3. `tree`

The tree lists every group and command once, in a stable order, a group before its commands, `schema` included (a
command for the tool's own use MAY be left out). An entry has `command` and `summary`, and `effect` for a command; a
group's entry has `kind: "group"`. `level` is the claimed level (3.5). `options` defines once the options that commands
share (9.5); a caller reads the tree once per tool.

### 9.4. `group`

`schema <GROUP>` answers with the group and the tree entries of its direct children.

### 9.5. `command`

A command document is the call surface of one command: `summary`, `effect`, `idempotency` (11.3; exactly for `write`
and `destructive`), `effectNote`, `async`, `operands`, `options`, `constraints`, `validators`, `errors`, `outputs`,
`input` and `examples`. It embeds no JSON Schema (9.9.3). `effectNote` names every effect the effect class does not say
(an audit line, a cache, a passthrough exit, serving until signalled), for successful runs only (11.2). `examples` are
complete invocations in the syntax of 4.2, from the tool name, `--json` after the path, without placeholders,
satisfying the command's requirements; none reads a file or stdin.

- **Options.** The command accepts the options it lists, each an option object (its own) or a name: of a tree option
  (9.3), or of a reserved option (4.5), whose shape is fixed (Annex S2 rule 8). It also accepts the reserved options
  its document implies, which it does not list: `--json` always; `--input` when it has `input`; `--fields` when an
  output declares `fields`. Every other reserved option is listed when offered, `--commit` and `--plan-digest`
  included, so that the document alone says whether a bare run of a destructive command acts or previews (11.4);
  `--help` and `--version` never are. A command that needs another `required`, default or enum subset of a shared
  option (Annex S1 item 4) declares it in full.
- **Errors.** `errors` lists every code the command can emit except the implied ones: `USAGE`, its registered finer
  replacements (7.3.2) and `INTERNAL`; the `INPUT_*` codes with `input`; `BATCH_INCOMPLETE` with `input.batch`;
  `PLAN_STALE` with `--commit`; `OPERATION_REUSED` with `--operation`; `CURSOR_INVALID` with `--cursor`.
- **Defaults.** A member whose value is its default is absent; `schema/schema-doc.schema.json` gives each default:
  `required`, `repeatable` (a count is always repeatable and does not say so), `variadic`, `flagOnly` and `async`
  false; an argument's `default` null (`false` for a switch, `0` for a count); `valueType` `string`; `valueName` the
  name in upper case with `_` for `-`; an output's `kind` `report` and `schemaVersion` `1.0`; `input.batch` false; a
  list, empty. The tree's entries and its `options` follow the same rule.

### 9.6. Operands

An operand's `name` names it in `constraints` and is never an option's name; its `valueType` is not `switch` or
`count`.

### 9.7. Options

9.7.1. An option's `name` is its long name without `--`; `defaultNote` says how a computed default is found; `env`
names the variable read when the option is absent; `flagOnly` marks an option no document may carry (the flag-only
reserved options are, whether implied or listed); `short` is a declared letter; `domain` restricts the value (9.7.4).

9.7.2. **valueType:**

| valueType | argv | `default` | `--input` value (10.5) |
|---|---|---|---|
| `switch` | `--name` | `false` | `true`/`false`; `false` is absent |
| `count` | `--name` per occurrence | integer ≥ 0 | non-negative integer; `0` is absent |
| `string`, `path` | `--name=<V>` | string or `null` | string |
| `integer` | `--name=<N>` | integer or `null` | integer, or a string `-?(0\|[1-9][0-9]*)` |
| `number` | `--name=<X>` | number or `null` | number, or a string in JSON number syntax |
| `enum` | `--name=<V>` | a member of `possibleValues` or `null` | a member of `possibleValues` |
| `json` | `--name=<JSON>` | any JSON value, or `null` for none | any JSON value but a top-level `null` |

A repeatable option's default and document value are arrays, a `count`'s one integer; a `switch` is never required
or repeatable. [Appendix A D11.3]

9.7.3. `default` is used when the option is absent: `null` for none or for a value computed at run time (with
`defaultNote`); `false` for a switch; `null` for a required option. A default the help promises appears here.

9.7.4. A `domain` states every restriction of the value beyond its valueType that the command enforces without
reading state, in the JSON Schema subset of Annex V (normative); every normalised value and non-null default
satisfies it.

9.7.5. Integers lie within ±(2^53-1) and are never rounded; a value outside it, as a JSON number literal or as a
string, is refused like any invalid value. Numbers are finite binary64 (Annex V3).

### 9.8. Constraints and validators

9.8.1. Every stateless relation between arguments MUST be in `constraints` or `required`. One value's restriction is
a `domain`; any other stateless check, `env`-dependent ones included, is a validator; a check that reads state is a
precondition (8.3). [Appendix A D12.4]

| `rule` | Members | Holds when |
|---|---|---|
| `atLeastOne`, `exactlyOne`, `atMostOne` | `names` | at least one, exactly one, at most one of `names` is given |
| `requires`, `forbids` | `if`, `then` | when `if` holds, every / no name in `then` is given |

`if` is `{name}` (it is given) or `{name, in}` (given with a listed value, any value of a repeatable one, after
normalisation; not on a switch or count). "Given" means explicit on argv or in a document. A violation answers the
rule's `code`, else `USAGE`, and its `field` names an argument the caller can add or remove to satisfy the rule
(`approaches/implementation.md` §2 picks one). The five rules are the vocabulary, extended only on evidence, and a
relation is stated once. [Appendix A D34, D36]

9.8.2. **Validators** declare the other stateless checks: `arguments` read, `code` (exit 2, in `errors` or implied),
a plain `description` from which an agent can build a valid value, and `rejects`, invocations that pass every
requirement, constraint and domain and that it refuses (none an example); in a 1.4 document `rejects` is in the
schemas answer (9.9.3), not the command document. Validators run at 10.7 step 6, for every invocation, before any
state is read. [Appendix A D17, D18, D30]

### 9.9. Outputs and input

9.9.1. `outputs` lists every form a command prints: `report`; `artifact` (`mediaType` of the text-mode bytes, an
envelope with `--json`); `stream` (13; `eventRef` the event schema, `schemaRef` the end result's). `batch: true` marks
a batch's output (10.11), `when` which invocation selects an output, `fields` the selectable paths (Annex F). Refs
are `#/schemas/<Name>`, resolved in the schemas answer (9.9.3); two outputs never share one. A report schema
describes the whole report; a batch output's describes `items[].data`, and the batch report also follows
`schema/batch-report.schema.json`. [Appendix A D11.13, D23]

9.9.2. `input` declares `--input`: `maxBytes`, `batch` and `maxItems` (10.10, 10.11), `example` one complete valid
document, and optionally `argumentsRef`, an informative schema of the argument object of 10.7 step 6, never stricter
than the declarations. The **fragment schema** of one document is derived from the command's options, not declared:
an object with no `required` and `additionalProperties: false` whose properties are `operands` (an array of operand
values, at least one, at most one per operand unless the last is variadic) and the camelCase name of every option that
is not flag-only, each admitting the `--input` values of 9.7.2 (an array of them when repeatable). Domains are not part
of it (10.7 step 6). A declared copy could only disagree with the options.

9.9.3. `schema <PATH> --schemas` answers with `kind: "schemas"`, `command`, and `schemas`: exactly the JSON Schemas
the command document's refs name and the ones they refer to through `#/schemas/<Name>`, each compiling under draft
2020-12, and, when the command has `input`, its derived fragment schema (9.9.2) under the name `Input`, which no ref
and no other schema of the command takes. It also holds `rejects`, one list per validator in the command document's
order (9.8.2). A caller calls a command from its command document and asks for this answer when it validates `data`
or a document, or tests a validator.

### 9.10. Search and extensions

9.10.1. `schema --search` (OPTIONAL) returns a `tree` with `query` and commands ranked best first (possibly none),
offline; tools with more than about fifty commands SHOULD offer it.

9.10.2. Members named `^x-[a-z][a-z0-9-]*$` (by convention `x-<tool>`) MAY appear in `meta`, errors, registries and
self-description documents; a tool emits no other member its minor does not define, and callers ignore unknown ones.

## 10. Input documents: `--input`

Shapes: `schema/input-document.schema.json` and the command's fragment schema (9.9.2). [Appendix A D6]

10.1. At L2 every `write` and `destructive` command MUST accept `--input <JSON|FILE|->`; a `read` command MAY.

10.2. A value starting with `{` or `[` is inline JSON, `-` is stdin, anything else a path (`./{x}` for a file named
`{x}`). An empty value or source, or an unreadable file, refuses with `INPUT_INVALID`, `field` `--input`; `--input`
twice or without a value is `USAGE`. [Appendix A D26]

10.3. `--input -` with stdin on a terminal refuses with `INPUT_INVALID`.

10.4. An object is one invocation, an array a batch (10.11); only a file or stdin that is not one JSON value is read
as NDJSON (a batch). Anything else, and a batch the command does not accept, refuses with `INPUT_INVALID`.

10.5. Keys are the options' camelCase names and `operands` (a non-empty array, in order); values follow 9.7.2. A caller
writes none for a repeatable option by omitting the key, as for `operands`; a 1.4 tool may read `[]` as absent or refuse
it with `INPUT_INVALID`, `field` the key's pointer. A numeric string for an `integer` or `number` is normalised to its
number; nothing else is coerced; `null` is refused except inside a `json` value. [Appendix A D11.17]

10.6. Flag-only options (4.5, and any the tool marks) are never keys, so a document cannot select output, page or
commit a plan.

10.7. **Processing.** Steps 1-6 read no state; the first failure answers, with nothing changed.

1. Read and frame (10.2-10.4, 10.10): `INPUT_INVALID` or `INPUT_TOO_LARGE`, `field` `--input`.
2. Validate each document against the fragment schema: `INPUT_INVALID`, `field` the pointer of one of the problems
   (the first of `details`), `details` listing every problem when several.
3. Compare argv's explicit arguments with the document's after normalisation (arrays in order, objects by members);
   a difference refuses with `INPUT_CONFLICT`. Argv is read alone here, without `required`, constraints or defaults,
   so a document may supply a required argument. Malformed argv refuses here with its usual code.
4. Merge them.
5. Fill absent options from `env`, then defaults; these are never explicit.
6. Check `required`, domains, constraints and validators on the **argument object** (`operands` with trailing operand
   defaults; each non-flag-only option under its camelCase name with its explicit, `env` or non-null default value),
   with the codes used without `--input`. `argumentsRef` describes this object.
7. Resolve objects, check preconditions (8.3), do the work.

Without `--input` the same stateless checks run, argv first, before any state is read.

10.8. A value at fault from a document, or a required key missing when `--input` was used, is named by its pointer
(`/round`, `/operands/0`; in a batch `/1/round`).

10.9. A tool that converts the document to argv for steps 4-6 MUST give the answers direct validation gives, codes
and pointers included (`approaches/implementation.md` §4).

10.10. `input.maxBytes` is enforced before parsing (`INPUT_TOO_LARGE`).

10.11. **Batches** (OPTIONAL; never on a `destructive` command) declare `input.batch`, `input.maxItems` and a `batch`
output. Preflight runs steps 1-6 for every item first; execution runs items in order and stops at the first failure.

| Case | Exit | `error.code` | `data` |
|---|---|---|---|
| a preflight failure | 2 | the first failing item's code, `field` `/<index>/…` | none |
| every item executed | 0 | — | the batch report, each item `written` or `unchanged` |
| an item failed during execution | 1 | `BATCH_INCOMPLETE`, `field` `/<index>` | earlier items done, that item `failed` with its own `error`, later ones `skipped` |

The batch report has one entry per submitted item, in order. `failed` does not mean rolled back: the failed item's own
code's exit tells whether it may have made effects (1) or refused (2). A batch is not a transaction.

## 11. Effects and the destructive exchange

11.1. Every command declares an **effect**: `read` (none, beyond what `effectNote` names), `write`, or `destructive`
(deletes or rewrites data others depend on, or is hard to undo).

11.2. A refusal, a preview, a `--dry-run`, `--help`, `--version` and `schema` MUST NOT make any effect (no file,
record, cache, log, telemetry or remote change), whatever their exit and whatever `effectNote` says. Output on the
process's own stdout and stderr is not an effect. [Appendix A D12.3, D30]

11.3. **Idempotency** of a repeat of the same invocation: `replay-safe` (nothing more; `unchanged` or the same
result), `content-keyed` (same content a no-op, different content refused), `appends` (another record), `once`
(refused, nothing changed).

11.4. **Preview by default** (L2). A `destructive` command takes `--commit` and `--plan-digest`. Without `--commit` it
computes the plan, changes nothing and succeeds with `data.planDigest` (11.6), `data.effects` (every effect the
commit would make, precise enough to decide on) and `data.committed: false`. [Appendix A D7]

11.5. The preview's `meta.next` MUST lead with the exact commit invocation, built from the normalised arguments
(argv options or one inline `--input` word, never `--input -`). A destructive command takes no secret argument.

11.6. **Digest.** It covers the effects and every input that determines them (arguments, state, file contents), is
opaque and bound to state, not time. It SHOULD be `sha256:` and the lower-case hex SHA-256 of the plan's RFC 8785
canonical JSON (test vectors: `examples/plan-digest/`). When a remote system makes the effects and computes the
digest, the tool passes it through. [Appendix A D30, D35]

11.7. **Commit.** `--commit` and `--plan-digest` require each other (`USAGE`, its finer replacement, or the code of
the `requires` rule stating it). The command recomputes the plan: a different digest refuses with `PLAN_STALE`,
`meta.next` the preview; otherwise it carries out exactly that plan and reports `committed: true`. A tool whose plan
can change between the check and the effects MUST detect it per effect or hold a lock; a change detected after some
effects is a stop part-way (8.3.2, reason `PLAN_STALE`). A commit never acts unchecked: when the system that must
recompute cannot, the tool refuses with an exit-2 code of its own. [Appendix A D30, D31]

11.8. Nothing else authorises a destructive act: no other option, environment variable or prompt.
[Appendix A D7, D11.11]

11.9. A command only a person may run SHOULD refuse agents with a `DENIED` code and a `hint` for the person.

11.10. `--dry-run` (OPTIONAL on a `write`) runs every check the real run would, refuses with the same codes, changes
nothing, and reports what would change.

## 12. Long-running work

12.1. A command finishes its work before it exits, unless it declares `async`.

12.2. A command that starts work it does not finish declares `async: true`; its exit 0 means accepted, its report
names the identifier and MUST NOT present the work as done, and `meta.next` MUST lead with the command that reads or
waits for the outcome.

12.3. A command that waits SHOULD take `--wait` and `--timeout <DURATION>`; it exits 0 when the work is done, 1 with
a registered code when it ended otherwise, and 1 with a `TIMEOUT` code and the same wait in `meta.next` when time ran
out.

12.4. **Operation keys.** A command whose work another process completes, or whose reply can be lost after its effect,
SHOULD accept `--operation <KEY>`; it is then `replay-safe`. The key is scoped to tool, command and resolved context,
bound to the payload (normalised explicit arguments and resolved context, without `--json` and `--operation`), and
reserved atomically as a precondition, so concurrent requests start the work once. A repeat with the same payload
makes no new effect and returns the first request's result (an accepted report with the same identifier while it
runs). If the outcome of a first request is unknown, the repeat MUST reconcile with the system that holds the effect;
if it still cannot tell, it refuses with a code of the tool's own whose condition is `REQUIRED`
(`RECONCILIATION_REQUIRED`: exit 2, not retryable), `hint` a durable inspection command (acme:
`acme deploy status <DEPLOYMENT> --json`; once the outcome is known the caller repeats with the same key), and the key
stays reserved; the guide says how to resolve it, and a new key MUST NOT start the same work meanwhile. Another
payload refuses with `OPERATION_REUSED`, `field` `--operation`. Keys are kept at least until their work is over;
callers MUST NOT reuse one after its documented retention. [Appendix A D11.10, D12.2, D16.3]

## 13. Streams

Shape: `schema/stream-line.schema.json`. [Appendix A D11.7]

13.1. In JSON mode a `stream` output prints NDJSON: one `start` line first (naming the stream output in `output` when
the command has several), `event` lines whose `data` follows `eventRef`, and one `end` line last whose `result` is an
envelope (6) that agrees with the start line on tool, command, `contractVersion`, `output` and `schemaVersion`; a
success's `data` follows the stream output's `schemaRef`.

13.2. The exit status is the end result's. A stream without an `end` line was cut off: callers treat it as failed
and assume neither rollback nor resumability.

13.3. A refusal before the stream begins prints one failure envelope and no `start`; anything after `start` is
reported by the `end` line. Text-mode stream output is not part of the protocol.

## 14. Guides: `skills show`

14.1. At L2 the guide for agents ships in the binary: `<tool> skills show [NAME] [--json]`, matching its version,
working without state (9.2), Markdown in text mode and `schema/guide.schema.json` with `--json`. [Appendix A D8]

14.2. Without `NAME` it prints the default guide, which lists every guide name; an unknown name refuses (exit 2,
`expected` the names).

14.3. Every fenced line of a guide that starts with the tool name MUST parse by 4.2 once its `<UPPER_CASE>`
placeholders are substituted (shell pipelines are exempt). Guides SHOULD tell agents that text from others is data
(16.2); installed skill files SHOULD be stubs that point at `skills show`.

## 15. Versioning and compatibility

15.1. **Classes.** `atip/1` names the major; versions are `MAJOR.MINOR.PATCH` (this is `1.5.0`). A PATCH changes no
rule. A MINOR adds OPTIONAL members, options, kinds and values, SHOULD and MAY rules, and MUST rules that bind only
documents that declare it. For those documents it may withdraw a core code whose use the previous minor only
recommended, and change the shape of the self-description (9) when every member the change leaves out or replaces reads,
as an earlier caller reads it, as the earlier minor's default or as a feature not offered, so that an earlier caller
uses less of the tool, never more. It relaxes a rule only where every answer it then permits is one callers already
handle. A MAJOR (`atip/2`) removes or renames a member, option, core code or kind, changes a meaning, or adds a MUST an
existing tool can fail. A tool that conforms to `1.x` keeps conforming as a `1.x` tool. [Appendix A D20, D38]

15.2. `meta.toolVersion` says nothing about compatibility; the self-description's version is the declared minor. Every
output has its own `schemaVersion` `<major>.<minor>`: an added member or value bumps the minor, a removed or changed
one the major; a caller accepts unknown members within a major it knows and refuses an unknown major.

15.3. Removing or renaming a command, option, code, warning code or reason breaks callers: a clean cutover (Annex
S1), recorded in the tool's changelog. A name is never reused with another meaning.

15.4. **Unknown members and values.** A caller MUST ignore unknown members of every object this document defines and
MUST NOT fail a document for an unknown *string* in a member with listed values; it never infers that what it did not
understand is satisfied, done or safe. A non-string listed value, or a missing required member, is a wrong shape.
An unknown error code is read by its exit, `retryable`, registry entry and, in a 1.3 document, its condition; a
condition word the caller does not know (a later minor's) leaves it with the exit and `retryable`. In a 1.4
self-description an absent member has its default (9.5), and an option name that names no tree or reserved option
leaves that option out. [Appendix A D20, D28, D29]

| Unknown string in | The caller |
|---|---|
| `meta.contract` | refuses the document (another major) |
| a `schema` answer's `data.kind` | reads only `ok` and `meta` |
| a tree entry's or an output's `kind`, a stream line's `type` | leaves it out |
| `effect`; `idempotency` (or absent with an unknown `effect`) | treats the command as `destructive`; as `once` |
| a tree's `level` | assumes `L1` |
| an argument's `valueType` | leaves the argument out; a required one makes the command unusable |
| a constraint's `rule`, a domain keyword or JSON type | skips that check; the tool still enforces it |
| `input.option` | builds invocations from argv only |
| a batch item's `status` | treats the outcome as unknown and reads the state before repeating |

15.5. **Declaring the minor.** `meta.contractVersion` is the minor a tool implements; absent means `"1.0"`, which is
never written. A tool that declares 1.1 or later sets `contract` and `contractVersion` on every envelope and stream
start line. One build declares one minor and emits nothing a later one added. [Appendix A D20, D27]

15.6. **Published schemas** are closed and cover every minor of this major; members added after 1.0 carry
`x-atip-since`, and members a 1.4 document no longer carries carry `x-atip-until: "1.3"`. A member a 1.4 document
omits at its default is not `required` and states its `default`, although a document of an earlier minor carries it
(15.7). A caller that validates reads them open (`additionalProperties: false` dropped) against its view of the
document (unknown strings handled as 15.4, the completeness keywords `minItems`, `contains`, `if`/`then`/`else`
dropped) and rejects only a view that fails. A caller validates against the schemas of the release it was built for
(15.7 names the tags): the current files cover every minor and are looser. `$id`s stay under `https://atip.dev/1/`.
[Appendix A D20, D28, D38]

15.7. **Earlier minors.** A tool that declares 1.0, 1.1, 1.2, 1.3 or 1.4 is held to that minor's last release text
(tags `v1.0.0`, `v1.1.2`, `v1.2.1`, `v1.3.1`, `v1.4.2`). A caller reads every minor; for it, a document of an earlier
minor differs thus:

| Declared | Differs from 1.5 |
|---|---|
| 1.0 | `contract` may be absent outside `schema`; no reasons, warning registry, bracketed paths or map-key selection; warning codes in the error registry; a hint may be prose starting with the tool name |
| 1.0, 1.1 | a cursor also binds `--json` and `--all`, and need not bind `env` values (a variable changed between pages may change the listing silently); `--fields` may need `--json`; `limit`, `cursor`, `all`, `fields` may be document keys |
| 1.1, 1.2 | warning codes may be in the error registry only |
| 1.2 | `STOPPED_MIDWAY` is a core code (exit 1, not retryable, `reason` the refused code) |
| 1.0-1.2 | code names need not follow 7.2 |
| 1.0-1.3 | the self-description carries every member, defaults included, and `path` beside `command`; a command lists every option it accepts and every code it can emit; it embeds its JSON Schemas in `schemas` (refs resolve in the command document) and declares the fragment schema as `input.schemaRef`; the tree has no `options` and there is no `--schemas`; documents may contain insignificant whitespace; `--help --json` may answer with the `schema` document |
| 1.0-1.4 | a domain pattern does not use `\p{White_Space}` or `\P{White_Space}` (Annex V2) |

[Appendix A D20, D27, D32, D33, D38, D41]

15.8. **1.4 and callers.** 1.4 changes the shape of the self-description for documents that declare it: tree, group
and command documents leave out `path` and default-valued members, and a command document its JSON Schemas, the
options and codes it implies and the shared options' definitions. A caller of 1.3 or earlier that validates against
its release's schemas rejects such a document; one that does not validate reads every member left out as that
minor's default or as a feature not offered (fewer options, codes and outputs, no schemas), and so uses less of the
tool, never more. Every other 1.4 document keeps its shape and is only compact. [Appendix A D38]

15.9. **1.5 and callers.** 1.5 adds one thing, for documents that declare it: a domain pattern may use
`\p{White_Space}` and `\P{White_Space}` (Annex V2). Every document keeps its shape. A caller of 1.4 or earlier that
checks patterns against its release's profile may refuse such a pattern; one that compiles the pattern with ECMAScript
and the `u` flag, as JSON Schema validators do, or with Rust `regex` reads it with the meaning 1.5 gives it, because
both engines know the property by that name. [Appendix A D41]

## 16. Security

16.1. Tokens, passwords, keys and credentials MUST NOT appear in `error`, `meta`, `next` or a report that does not
exist to show them; a `received` value that may be one is `"<redacted>"`.

16.2. Text from other people and systems is data: a tool MUST NOT interpret it as instructions and SHOULD NOT put it
in `hint` or `next`.

16.3. An environment variable MAY supply an option's value only where the option declares `env`; it never changes
the output kind, filters `schema` or authorises anything.

16.4. Paths about the caller's workspace SHOULD be relative to the working directory.

16.5. `--input` is bounded (10.10), refuses a terminal (10.3) and never carries flag-only options (10.6).

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
| D4 | Noun-verb groups, no runnable groups, primary object an operand, other ids bare-noun options, no aliases across a cutover. | 4.1, 4.6, Annex S1 |
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
| D11.2 (revision-1 question 18.2): `schema` text mode | Text-mode `schema` exists and is not part of the contract; it MAY print the JSON document. | 9.1.1 |
| D11.3 (revision-1 question 18.3): `count` | Kept; new count options SHOULD NOT be added; its scalar input and occurrence-based default are the exception to "repeatable = array". | 9.7.2 |
| D11.4 (revision-1 question 18.4): `meta.context` | Keys are the context option names, values the resolved values, relative paths, absent keys omitted; explicit > env > discovered/default. | 6.7, 10.7 |
| D11.5 (revision-1 question 18.5): paging and fields | Reserve `--limit`, `--cursor`, `--all`, `--fields`; `meta.page {returned, nextCursor?, total?}`; `meta.truncated`; `meta.fields` and projection with a reduced `required` set. | 4.5, 6.9, 6.10, Annex F |
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
| D11.18 (revision-1 question 18.18): short options | Allowed and listed; new ones discouraged. | Annex S1 |

| # | Owner decision 2026-10-28, revision 3 | Where |
|---|---|---|
| D12.1 (revision-2 question 18.1) | Keep `meta.output`. | 6.6, 6.11 |
| D12.2 (revision-2 question 18.2) | Reserve `OPERATION_REUSED`: eleven reserved codes (twelve with D16.1). | 7.3.1, 12.4 |
| D12.3 (revision-2 question 18.3) | Refusal and preview purity is strict, including log files and telemetry. | 11.2 |
| D12.4 (revision-2 question 18.4) | Keep the five constraint rules; extend only on evidence. | 9.8 |
| D13 | The contract is named **ATIP, Agent Terminal Invocation Protocol**; contract id `atip/1`; conformance stated as "ATIP L1 conformant"; checker command `atip check`; TypeScript package `@journeykit/atip`, Rust crate `atip`. It was called `agent-cli/1` through revision 2. | title, 3.5, `approaches/` |
| D14 | OpenCLI is ignored: no alignment and no exporter, because nothing consumes OpenCLI documents for these tools. | 1.4 |
| D15 | The exit rule is stated as: 1 = the command ran and its answer is negative or incomplete; 2 = the command refused to run. Every example and table follows it. | 8.1, 8.3 |

| # | Owner decision 2026-10-29, revision 4 | Where |
|---|---|---|
| D16.1 (revision-3 question 18.1) | Reserve `CURSOR_INVALID` (exit 2, not retryable): twelve reserved codes. | 6.9, 7.3.1 |
| D16.2 (revision-3 question 18.2) | Keep projection by restriction, made sound: only the cut nodes are restricted, with no `const`, `enum` or other keyword that can reject a projection of a valid value. | 6.10, Annex F, Annex S2 rule 11 |
| D16.3 (revision-3 question 18.3) | No reserved code for an uncertain operation outcome; the refusal is tool-specific, not retryable, names a durable inspection command, keeps the key reserved, and the guide says how to resolve it. | 12.4 |

| # | Owner decision 2026-10-29, revision 5 | Where |
|---|---|---|
| D17 (revision-4 question 18.1) | `domain` is a fixed interoperable profile: numeric `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`; string `minLength`, `maxLength`, `pattern` in an I-Regexp (RFC 9485) form both Rust and ECMAScript honour; for `json` arguments a minimal set of structural keywords. `format` is an annotation only. A stateless check outside the profile is not a precondition: it stays in step 6 with a registered code, declared as a validator in the self-description. | Annex V, 9.8.2, 10.7 |

| # | Owner decision 2026-10-29, revision 6 | Where |
|---|---|---|
| D18 (revision-5 questions 18.1, 18.2) | No `anyOf` and no array length keywords in `json` domains: validators cover such checks until a real command needs them. `rejects` stays required on validators. | Annex V, 9.8.2 |

| # | Owner decision 2026-10-30, release | Where |
|---|---|---|
| D19 | 1.0.0 adopted 2026-10-30 after six rounds of independent review. | status, 15.1 |

| # | Owner decision 2026-10-31 to 2026-11-01, version 1.1.0, from implementer feedback from two early adopters | Where |
|---|---|---|
| D20 | Versions are `MAJOR.MINOR.PATCH` of `atip/1`, with the change classes of 15.1. Callers ignore unknown members of every object the contract defines, not only of reports. A tool declares its minor in `meta.contractVersion` and emits only what that minor defines. The published schemas stay closed for tools; callers read them open; members added after 1.0 carry `x-atip-since`. 1.1.0 changes 1.0.0's 15.1 once, stated in 15.9, because no conforming caller outside the two early adopters existed. | 6.6, 9.1.2, 9.10.2, 15 |
| D21 | `error.reason`: an optional UPPER_SNAKE sub-reason registered under its code (`reasons: [{reason, meaning, fix}]` on registry entries), unique within the code, never emitted unregistered, sharing the code's exit. Callers may branch on code and reason. Reserved reason names for the reserved codes that cover several situations. Finer codes stay allowed only instead of `USAGE`. | 7.1, 7.3.2, 7.3.3, 7.6 |
| D22 | A warning registry of its own: `schema --warnings` and `schema --warning <CODE>`, entries `{code, meaning, fix}`. A 1.1 tool SHOULD register warning codes there; a warning in the error registry with exit 1 stays valid. A situation reported both ways is registered in both. `--error` given a warning-only code refuses with a hint to `--warning`. | 7.4.3, 7.5, 9.1 |
| D23 | Field paths write a member whose name is not an identifier as a bracketed JSON string (`attributes["http.status-code"]`); a declared map makes its keys selectable. Paths without brackets are unchanged. | 6.10, Annex F, Annex S2 rules 11 and 15 |
| D24 | No per-command member saying whether a command accepts `--json`. The command document already lists `json` in `options`, and 4.2 requires it on every command with a report or artifact output, so the member would repeat `options` and could disagree with it. A tool that builds `next` knows its own parser; a caller gets `argv` ready-made. To be revisited if a tool shows a case that `options` does not answer. | 4.3.2, 6.8, 9.5 |
| D25 | New SHOULD and MAY rules: an L0 tool SHOULD offer `schema --errors` and the checker compares it with the fixture; tool-wide options SHOULD be accepted wherever `--json` is, groups included; a write whose failure point cannot be shown to be before the work MAY report it as during-the-work (exit 1), while exit 2 still means nothing changed. | Annex S1, 7.4.3, 8.3.1, `approaches/checker.md` |
| D26 | Clarifications: `USAGE` SHOULD carry `field`, and without one its hint names the command's `schema`; in text mode a refusal prints nothing on stdout and exit 1 may print its result; `--input` given twice or without a value is `USAGE`; precondition and during-the-work code names; a code with two exits is split; a batch report is its own output; a signal shows as a wait status or as a launcher's 128+n; a `hint` is exactly one of its three forms; a report may keep its own paging members, `meta.page` is authoritative. | 5.3, 6.6, 6.9, 7.1.2, 7.1.3, 7.4.2, 8.3, 8.4, 10.2 |
| D27 | A minor never makes a 1.0-conforming tool non-conforming: a 1.1 rule that would (map cut nodes, command-line hints, `--input` twice as `USAGE`) applies only to a document that declares 1.1, and a 1.0 tool keeps 1.0's behaviour; dual warning/error registration applies only to a tool that keeps a warning registry. A 1.1 tool sets `contract` and `contractVersion` everywhere, so an unmarked document is always 1.0. Callers build a view of a document with unknown listed values before validating it. | 6.10, Annex F, 7.1.2, 7.5.2, 10.2, 15.5, 15.6, 15.7 |
| D28 | A caller's view leaves out every unknown variant (argument, output, tree entry, batch item) and drops the producer's completeness rules it can no longer meet (`minItems`, `contains`, `if`/`then`/`else`), so it never rejects a document for what it left out; a listed member that is not a string is a wrong type and is rejected. A map key containing U+0000 is not selectable. A 1.1 tool's markers are a MUST of the checker's L0.contract-version. | 6.10, Annex F, 15.4, 15.6 |
| D29 | Every string member whose values the contract lists has an explicit caller treatment for an unknown value, in one table (15.6): refuse the document (another major), the document part is unusable, the entry is left out, or the most cautious known value. The table is read from the schemas, and a later minor that adds a listed member adds its row. | 15.4, 15.6 |

| # | Owner decision 2026-11-01, version 1.1.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D30 | Wording, the schema and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. The `meta.contractVersion` pattern no longer admits `"1.0"`, which 6.6 already never emits. Stated where implementers missed them: validators run for every invocation, before any precondition; selection is per output, and a union-shaped output offers no `--fields`; a switch's `default` is always `false`, with `defaultNote` for a configured effect; the `field` and `expected` of `schema`'s own refusals; previews and `--dry-run` make no effect whatever their exit; when a remote system that makes the effects also computes the digest, the tool passes it through, and a commit whose digest only that system can recompute, when it cannot, is refused with the tool's own exit-2 code (a tool that recomputes the plan itself and detects changes per effect is unaffected); `USAGE` in 12.7 includes its registered finer replacement. Checker: the `paged` fixture key and the non-paging observation, `"registry": "from-schema"`, L1.hint-command, and the scope of several L0 rows. | 6.10, Annex F, 9.1.1, 9.7.3, 9.8.2, 11.2, 11.6, 11.7, schema/envelope.schema.json, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-01, version 1.1.2, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D31 | Wording and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.1"`. Stated where it could be read two ways: a caller pages with the `next` entry's arguments, changing at most `--limit` and `--fields` (cursor binding itself is unchanged; which arguments bind a cursor is for 1.2.0); `--all` asks for every remaining item, a `--limit` without a bound; a batch input reads `--fields` against the batch output, whose paths are paths into the batch report, and a batch schema written as `allOf` the batch-report schema declares no `fields`; a lone `--commit` or `--plan-digest` may also refuse with the `code` of the `requires` rule that states the pair; 12.7's closing sentence no longer reads as if a tool that recomputes its plan had to detect changes per effect rather than hold a lock. Checker: the fixture key `prepare` (programs that prepare the world before `setup`; a step running the tool's binary is refused, the report lists every step, and the tool's state is still made by `setup`), a failing `prepare` or `setup` step is a fixture error, L1.validators without `prepare` either, an L0 answer to `--cursor x` that shows neither absence nor `CURSOR_INVALID` counts as paging, an advisory without a subject in the run is `unsupported`, `from-schema` without `schema --errors` leaves only L0.ok-exit `unprovided`, and L2.destructive-half accepts the rule's `code`. | 4.5, 6.9, 6.10, Annex F, 11.7, approaches/checker.md, approaches/typescript.md |

| # | Owner decision 2026-11-02, version 1.2.0, a minor (15.1) from implementer feedback | Where |
|---|---|---|
| D32 | Paging, field selection and the stateless checks, for a document that declares 1.2 only (the D27 pattern, now named in 15.1's MINOR row: a tool that declares 1.1 or 1.0 keeps its behaviour and stays conforming). A cursor is bound to every argument except the reserved options that never change the result set (`--json`, `--limit`, `--all`, `--cursor`, `--fields`); an argument given explicitly with its default value is given, except a switch given `false` or a count given `0`, which are absent (10.7.2); a value taken from an `env` variable is bound though not given. The next-page entry carries exactly the arguments the invocation gave explicitly, never a default or an `env` value, so it continues in the same environment. This relaxes 1.1's binding of `--json` and `--all` only where the result set is the same (15.1, 15.10). `--fields` is parsed and validated with or without `--json`; what it does to text is the tool's. `limit`, `cursor`, `all` and `fields` are flag-only. Argv parse failures come before step 6 of 11.7 (the one at the earliest argv position first), which checks `required`, domains, constraints and validators in that order (operands then options in declaration order for the first two, declaration order for the last two), and the first failure answers. A constraint's argument at fault is defined per rule. Declined: per-item batch `--fields`, since 1.1.2 already gives one answer (`USAGE` when the batch output declares no `fields`). | 4.5, 6.9, 6.10, Annex F, 9.8.1, 10.6, 10.7, 15.1, 15.7 (changed for 1.3 by D36) |
| D33 | `STOPPED_MIDWAY` (exit 1, not retryable) is reserved since 1.2: a command that works in steps and stops after a step made effects, because a later step meets what the command refuses before its work, reports it with that refusal's code as `reason` (the refusal's own reason is not carried), instead of a during-the-work twin of every refusal code. SHOULD for a tool that declares 1.2, so a tool with a code of its own stays conforming; a 1.2 tool that registers the name gives it this exit, retryability and meaning. The reserved meaning holds only in a document that declares 1.2: in an earlier document the code is the tool's own, read by its registry entry. The name is the one the first adopter already uses and says what happened and when; an `*_INCOMPLETE` name was not chosen because exit 1 already covers incomplete answers that made no effect (8.1, 8.5), and `BATCH_INCOMPLETE` stays the code of a batch, under which a stopped item is `failed` with `STOPPED_MIDWAY`. Reserved reason `PLAN_STALE`, for a commit that detects a changed plan between its effects (12.7). | 8.3.2, 11.7, 15.7 (changed for 1.3 by D36) |
| D34 | Wording and checker rows that a patch could carry, released with 1.2.0: a check that reads an option's `env` value is a validator; a constraint's `field` follows the rule's own order, never argv's; rules said of a document that declares 1.1 hold for every later minor. Approaches: report schemas compare by meaning, not bytes; defaults are decoded at definition; the 1.2 cursor digest. Checker: the `in` check on switches and counts named; `--input` rows for environment values and spelling variants; a fixture invocation listed to succeed and refused with a precondition code is `unprovided`, never a pass, while a refusal from a stateless step is `fail`; the 1.2 rows for paging, `--fields` without `--json`, flag-only document keys, the check order and `STOPPED_MIDWAY`. | 6.10, Annex F, 7.1.2, 7.5.2, 9.8.1, 10.2, approaches/typescript.md, approaches/checker.md |

| # | Owner decision 2026-11-02, version 1.2.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D35 | Examples, approaches and the checker only; no member, option, rule strength or document kind is added, and `meta.contractVersion` stays `"1.2"`. Plan digest test vectors for 12.6's recommended form (`sha256:` over RFC 8785 canonical JSON), recomputed by `scripts/validate.sh`; they bind no tool that computes its digest another way, and they are the reference for every tool that follows the SHOULD. Approaches: which schemars view generates an output schema; a `read` command keeps the cache its `effectNote` names. Checker: the fixture key `notRun`, for a command that does not end on its own: it runs once until its first JSON document, which the envelope and output checks read, and is then signalled; its other runs that would succeed are skipped and reported, and a check left with no run is `unprovided`. A plan holds integers beyond ±(2^53-1) as strings and only valid Unicode (examples/README.md). | 11.6, examples/plan-digest/, approaches/rust.md, approaches/migration.md, approaches/checker.md |

| # | Owner decision 2026-11-03, version 1.3.0, a minor (15.1) | Where |
|---|---|---|
| D36 | ATIP is a protocol: this document defines conformance, and a conformance checker is a tool that tests it, not its definition. The spec is restated as the messages that cross the boundary (invocation, envelope and stream lines, the error object, exit status, `next`, the self-description, input documents, the destructive exchange, paging and field selection, versioning), each as shape, meaning and exchange rules, pointing to the JSON Schemas rather than restating them; algorithms, profiles and long rule lists are normative annexes: field selection and projection (Annex F), argument domains, the pattern dialect and numbers (Annex V), command design and the self-description rules (Annex S). Rationale, examples and history moved to Appendix A and `approaches/`. Rules whose only purpose was an exact checker verdict are recommendations in `approaches/implementation.md`: the order among the stateless checks of step 6 (stateless checks still precede every state read), which argument a constraint's `field` names when several qualify (it still names one the caller can add or remove), whether an argument given at its default value changes a cursor's binding (an `env` value still binds it) and what the next-page entry carries exactly, and the argv conversion of an `--input` document (its answer must still equal direct validation). Error codes: a tool's own code is `<SUBJECT>_<CONDITION>`, the subject a noun phrase, the condition one of fifteen (`INVALID`, `REQUIRED`, `NOT_FOUND`, `EXISTS`, `CONFLICT`, `STALE`, `EXPIRED`, `DENIED`, `UNSUPPORTED`, `TOO_LARGE`, `CORRUPT`, `UNAVAILABLE` exit 2; `FAILED`, `INCOMPLETE`, `TIMEOUT` exit 1), and the condition fixes the exit and the caller's action and gives the default retryability (`UNAVAILABLE` and `TIMEOUT` retryable; a `FAILED`, `INCOMPLETE` or `TIMEOUT` code registered either way by whether repeating it is safe), the error's `retryable` staying authoritative; conditions bind `error.code` only, never a warning that shares the name; a verdict the command must pass before its work (a gate, an approval, a check of its input or state) is a precondition (8.3) and refuses with exit 2 whatever the command calls it, keeping D11.8 and D15's boundary (whether the command ran, not whether it made an effect), and a check's ordinary negative answer is `data`, not a refusal; `CORRUPT` (added after the implementer reviews) is state the tool itself keeps or wrote, where `INVALID` is a value the caller or its user supplied (configuration the user edits included), because the caller repairs one and changes the other; a file that cannot be read is `DENIED`, `UNAVAILABLE` (a repeat can succeed), or by its content `INVALID` or `CORRUPT`; an unknown remote outcome after the work began is a `FAILED` or `INCOMPLETE` code whose `next` reads the state, and 12.4's refusal of a repeat it cannot reconcile is a `REQUIRED` code, so no condition was added for uncertain outcomes; a rate or quota that clears with time is `UNAVAILABLE`, a request too big or too costly `TOO_LARGE`; situations that differ in retryability are different codes, and reason names are a namespace of their own per code; `TIMEOUT` is only for a command that waits, so that a write whose backend ran out of time is never forced retryable; `TOO_LARGE` is the size or count of a request, a value outside its domain `INVALID`; a finer parse code is `OPTION_INVALID`/`OPTION_REQUIRED`; MUST for a document that declares 1.3, SHOULD-shape for warning codes. The twelve core codes keep their names, five of which predate the grammar, because renaming a core code is `atip/2`. `STOPPED_MIDWAY` leaves the core set for 1.3, which 15.1's MINOR row allows because 1.2 only recommended its use: a stop part-way is the tool's own `INCOMPLETE` code with the refused code as `reason`. D33 declined an `*_INCOMPLETE` name because exit 1 also covers incomplete answers that made no effect; under the convention the effect class says whether a stop left effects, and the caller action (read what was done before repeating) is the same, so the condition carries it. A 1.3 tool keeps its warning codes in the warning registry, so that its error registry holds only codes that follow the convention. 1.3 adds no member, document kind or enum value; a tool that declares 1.0, 1.1 or 1.2 is held to that minor's release text. | 3, 4.6, 6.10, 7.2, 7.3, 7.5.2, 8.3.2, 9.8.1, 10.7, 15.7, 15.8, Annex F, Annex V, Annex S, approaches/implementation.md, approaches/checker.md |

| # | Owner decision 2026-11-03, version 1.3.1, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D37 | The conformance checker's description follows the reference checker (canon's `atip-check`), answering its L2 questions; `approaches/checker.md` is not normative (3.7), so none of this changes what a tool or caller must do. The async fixture's `worker` names the environment variable the test build reads and the checker sets it to the outcome word; an outcome `outcomes` leaves out makes L2.async unprovided; L2.async always checks the start and that `next[0]` is a read command, and checks the outcomes only when `next[0]` carries `--wait` (without one, only that part is unsupported). A size refusal's `field` is `--input`. Snapshots count files, not directories; the `allowedEffects` glob is defined (`*` one segment, `**` many, `~/` for `HOME`). L2.skills owns "`skills show` writes nothing". A finer replacement of `USAGE` is a registered exit-2 code whose `field` names an argument. A batch constraint on a flag-only argument is given on argv, and one no item can break is skipped. A `notRun` command refused at its start with a registered precondition code is unprovided, any other refusal a fixture error. An unlisted write never makes a check unsupported. L1.tree passes a tree at or above the claimed level and reports that the higher level went unchecked. L2.idempotency leaves out of the repeat comparison only `allowedEffects` paths for a side effect the command's `effectNote` names, and lists them; `appends` never describes an audit line. L2.input-env probes only an option that alone declares its variable. L2.input-fragment, -normalise and -env compare exit, `ok`, `error.code` and `field` and `data` without the paths that differ between two runs of the argv form. L2.input-dash-values tries the next string argument when a precondition refusal leaves a candidate undecided, and passes a refusal that names the argument and echoes the value. The checker reads `--plan-digest=<digest>` as one word. In the spec, one clause: the caller of an `INVALID` with no `field` (a configuration file) changes what `hint` says. | 7.2.2, approaches/checker.md |

| # | Owner decision 2026-11-04, version 1.4.0, a minor (15.1) | Where |
|---|---|---|
| D38 | The self-description is read by agents, so it is small and compact, and `--help` and `schema` have distinct roles. For a document that declares 1.4: every JSON document is compact (no whitespace outside strings). A command document is the call surface only: it embeds no JSON Schema; `schema <PATH> --schemas` returns exactly the schemas its refs reach, resolved there. The input fragment schema is no longer declared but derived from the options and 9.7.2, because it is fully determined by them and a declared copy could only disagree (1.3's Annex S2 rule 10 existed to keep the two equal). Options that commands share are defined once in the tree's `options` and a command names them; a name may also be a reserved option's, whose shape is fixed. A command does not list the reserved options its document implies (`--json`; `--input` with `input`; `--fields` with an output's `fields`) nor the codes its features imply (`USAGE` and its registered finer replacements, `INTERNAL`, `INPUT_*`, `BATCH_INCOMPLETE`, `PLAN_STALE`, `OPERATION_REUSED`, `CURSOR_INVALID`). `--commit` and `--plan-digest` are always listed when offered (a review found that implying them from the tree's level left the command document silent on whether a bare run acts or previews). The schemas answer also carries the derived fragment schema as `Input`, so a caller need not derive it, and the validators' `rejects`, which are test material rather than the call surface. Paging options stay listed: `--limit` has a per-command default and bound and `--all` is optional, so the list is the declaration. Members at their default are absent (`required`, `repeatable`, `variadic`, `flagOnly`, `async` false; `default` null, false or 0; `valueType` string; `valueName` the upper-cased name; an output's `kind` report and `schemaVersion` 1.0; empty lists), and `path` (the words of `command`) is gone. A shared option is named rather than left implicit so that a command document alone says which options it accepts. `--help` is text for people; `--help --json` refuses with `USAGE` and a hint to `schema` (after the path is resolved, so an unknown word still answers `UNKNOWN_COMMAND`), and `--version --json` refuses with a hint to `--version`, so that JSON mode always prints an envelope and no command has two machine descriptions. Compatibility: these MUSTs bind only 1.4 documents. Every member 1.4 leaves out reads, when absent, as the earlier minor's default or as a feature not offered, so a caller of 1.3 or earlier uses less of the tool, never more: one that validates against its release's schemas rejects the document, one that does not sees fewer options, codes and outputs and the same defaults. 15.1's MINOR row now allows exactly that, 15.6 tells callers to validate against the schemas of their release, and every other document keeps its shape. Measured on canon's `finding close` answer: 10,876 bytes pretty and 6,732 compact in its 1.0 form, 3,088 in the 1.4 form, its JSON Schemas and derived `Input` (1,831 bytes) moved to `--schemas`. | 4.4.1, 5.1, 7.3.1, 9, 15.1, 15.4, 15.6, 15.7, 15.8, Annex S2 |

| # | Owner decision 2026-11-04, version 1.4.1, a patch (15.1) | Where |
|---|---|---|
| D39 | Three clarifications, no rule strength changed; `meta.contractVersion` stays `"1.4"`. (1) 5.1's compactness forbids whitespace (space, tab, CR, LF) outside strings and nothing else: any valid number spelling (`60.0`, `1e3`) and any escape form (`\u00e9`) is compact. The repository checker had compared the file with `JSON.stringify(JSON.parse(line))`, which also normalised numbers and escapes and so rejected compact documents a Rust serializer prints; an implementer found it. (2) 7.3.2's naming of finer parse codes applies to documents that declare 1.3 or later, not only 1.3. The set of finer replacements a 1.4 command document implies stays open, as in 1.4.0: a review found that closing it to named codes in a patch could fail a conforming 1.4.0 document either way (a replacement left out under another name, or an `OPERAND_*` domain refusal listed), so closing it is left to a minor. (3) 15.1's MINOR row covers members a change replaces (an option object replaced by a name) as well as members it leaves out. | 5.1, 7.3.2, 9.5, 15.1, approaches/checker.md |

| # | Owner decision 2026-11-04, version 1.4.2, a patch (15.1) from implementer feedback | Where |
|---|---|---|
| D40 | Two gaps two implementers met on 1.4, closed without changing a rule's strength; `meta.contractVersion` stays `"1.4"`. (1) A caller writes none for a repeatable option by omitting the key, as for `operands`; a 1.4 tool may read `"tag": []` as absent or refuse it with `INPUT_INVALID` and the key's pointer. 1.4.1 admitted `[]` (9.7.2 says "arrays", and the derived fragment has no `minItems`) but gave it no meaning, so either reading is allowed and the derivation of 9.9.2 is unchanged. A review of the 1.4.2 candidate found that making `[]` invalid, with `"minItems": 1` in the derivation, would fail a conforming 1.4.1 tool; that rule, a MUST and `minItems: 1` binding documents that declare 1.5, is a 1.5 candidate. (2) `--version --json` with a path resolves the path first, as `--help --json` does, so an unknown word answers `UNKNOWN_COMMAND`. `approaches/checker.md` L2.input-refusals sends `[]` for a repeatable option at a 1.4 claim and accepts either answer. | 4.4.1, 10.5, approaches/checker.md |

| # | Owner decision 2026-11-05, version 1.5.0, a minor (15.1) from implementer feedback | Where |
|---|---|---|
| D41 | A domain pattern needs a way to say "white space": a tool that wants "one non-empty line with no leading or trailing white space" had to list every white-space code point by hand in each pattern, about sixty characters a reader could not check. In a document that declares 1.5, a pattern may use `\p{White_Space}` and `\P{White_Space}`, in and outside a class, with one meaning in every engine: the Unicode binary property, which Rust `regex` and ECMAScript with the `u` flag both read by that name, so a caller translates nothing. It is the one addition to the profile beyond I-Regexp, whose `\p{…}` has only general categories; only the spelling `White_Space` is admitted. `\s` and `\S` stay out: their meaning differs between the engines (U+0085, U+FEFF), and redefining them in the contract would leave a generic JSON Schema validator reading its own meaning without any sign. A named "trimmed single line" domain was not added: the pattern says it, and Annex V2 gives it as the example, with line terminators excluded as the white space that is neither Zs nor a tab. A 1.4 caller that checks patterns against its release's profile may refuse the escape, so only a document that declares 1.5 may use it (15.1); a document of 1.0 to 1.4 keeps the old profile. D40's candidate (`minItems: 1` for a repeatable option) is not part of 1.5.0. | Annex V2, 15.1, 15.7, 15.9 |

## Appendix B. Prior art

Public tools and documents the contract learned from. They are cited for the problems they solve, not as
conformant tools.

| Source | What ATIP took from it |
|---|---|
| canon (`https://github.com/journeyWorker/canon`, npm `@journeykit/canon`) and lute (`https://github.com/journeyWorker/lute`), Rust and clap | The first tools the contract was written for: a generated command spec, error registries, exit rules, `--input`, preview and plan digests, skills shipped in the binary. canon is the source of the translated examples. |
| cf, Cloudflare's agent-facing CLI (`https://github.com/cloudflare/cf`) | One line in `--help` pointing agents at a machine-readable description; dry runs that print the exact effect; agent context detection, which ATIP declines (4.3.3). |
| Orca's CLI reference (`https://www.onorca.dev/docs/cli/reference`) | Searching the command tree by task (9.10.1); selectors as explicit options. |
| Google Workspace CLI (`https://github.com/googleworkspace/cli`) | One JSON document carrying a whole request, beside ordinary flags (10). |
| gh, kubectl, cargo, docker, wrangler, oclif | Noun-verb grammars, `--json` output, field selection and paging, generated reference documentation, deprecation policies. |
| Effect 4 (`https://effect.website`) | Schema-first command declarations from which argv parsing, help and JSON Schema are derived (`approaches/typescript.md`). |
| HTTP semantics (RFC 9110) | Status classes and a small set of status codes a client acts on without knowing the server (404, 409, 503): the model for the conditions of 7.2 and the core codes of 7.3. |
| gRPC status codes (`https://grpc.github.io/grpc/core/md_doc_statuscodes.html`) | A fixed vocabulary of canonical error conditions shared by every service, each with retry guidance (`NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `UNAVAILABLE`). |
| A2A (Agent2Agent protocol) and ACP (Agent Client Protocol) | Agent-facing protocols written as message shapes and interaction rules, which 1.3 adopted as the form of this document. |
| RFC 2119, RFC 8174, RFC 5234, RFC 6901, RFC 7493, RFC 8259, RFC 8785, RFC 9485, JSON Schema 2020-12 | Keywords, the argv and code-name ABNF, pointers, I-JSON numbers, JSON, canonical JSON for plan digests, I-Regexp patterns, wire shapes. |
| `../scripts/regex-cases.json`, `../scripts/regex-parity/` | Patterns and values run through ECMAScript and the Rust `regex` crate (Annex V2). |
