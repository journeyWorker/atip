# Implementation guidance: recommendations beyond the protocol

Not normative. Section numbers ("spec 10.7") refer to `spec/atip-1.md`, version 1.4.0.

The protocol fixes what a caller can rely on. Some behaviour lies below that line: two answers are both correct for
the caller, but tools that choose the same one behave alike, and a conformance checker can then test one answer
instead of a set. Up to 1.2 several of these choices were rules of the spec; 1.3 keeps them here as recommendations
(Appendix A D36). A tool that declares 1.2 is still held to them where 1.2 made them MUSTs (it is held to the 1.2.1
text, spec 15.7); the section of each says which.

## 1. The order of the stateless checks

Spec 10.7 requires that the stateless checks (argv parsing, `--input` steps 1-6) all happen before any state is read
and that the first failure is the answer. Which failure comes first, when one invocation breaks several rules, is the
tool's. The recommended order, a MUST for a tool that declares 1.2:

1. A failure to parse argv (an unknown option or command word, a missing option value, a value that is not of its
   valueType or not one of its `possibleValues`) comes before step 6; with `--input`, at step 3. Among several parse
   failures, the one at the earliest argv position answers.
2. Step 6 then checks `required`, then domains, then constraints, then validators.
3. Within `required` and within domains: operands in their order, then options in their declaration order.
   Constraints and validators: each in their declaration order.

With this order, two tools give one invocation the same code and `field`, and a caller that fixes one problem and
repeats meets the next problem in a predictable place. For a document with several problems at step 2 (spec 10.7),
list `details` in document order where the parser keeps member order, and put the first of them at the top level; a
parser that sorts members (default `serde_json`) uses its own order, which spec 10.7 allows.

## 2. Which argument a constraint violation names

Spec 9.8.1 requires that a violation's `field` name an argument of the rule that the caller can add or remove to
satisfy it. When several qualify, name the first in the rule's own order, never in argv's order (a MUST for a tool
that declares 1.2):

| `rule` | `field` names |
|---|---|
| `requires` | the first name in `then` that is not given (`--disposition rejected` without `--reason` names `--reason`) |
| `forbids` | the first name in `then` that is given, the one the caller removes |
| `atMostOne`, and `exactlyOne` with more than one given | the first given name in `names` |
| `atLeastOne`, and `exactlyOne` with none given | the first name in `names` |

## 3. Cursor binding details and the next-page entry

Spec 6.9 binds a cursor to every argument except `--json`, `--limit`, `--all`, `--cursor` and `--fields`, including
values taken from an option's `env` variable. Two details are recommendations (MUSTs for a tool that declares 1.2):

- **An argument given explicitly with its default value is given.** Adding or removing it changes the arguments, as
  changing its value does, so a cursor issued without it refuses with `CURSOR_INVALID`. A switch given `false` and a
  count given `0` are not given, since they are the same as absent (spec 9.7.2). This keeps the binding a comparison
  of what was written, without the tool having to know which explicit values equal a default. A tool that treats an
  explicit default as absent instead continues the same result set, which a caller handles as well.
- **The next-page entry carries exactly the arguments the invocation gave explicitly**, normalised, plus
  `--cursor <nextCursor>`: as argv options, or as one inline `--input` word when they came from `--input -` or a file
  (as spec 11.5 builds a commit invocation), never a value filled in from a default or an environment variable. Run
  in the same environment it continues; it does not pin environment values the caller did not write.

`approaches/typescript.md` §3.8 shows a cursor digest over these arguments.

## 4. Converting an `--input` document to argv

A tool MAY implement steps 4-6 of spec 10.7 by converting the merged document to argv and running its ordinary
parser; the answer must equal validating the document directly, codes and the pointers of spec 10.8 included
(spec 10.9). To get there:

- Produce only the portable forms of spec 4.2: `--name=value` for every valued option, `--name` for a switch that is
  `true`, the count's name repeated, and every operand after one `--`. The joined form keeps a value that starts with
  `-`, `{` or `[`, or is `-`, from being read as an option or as an inline-JSON, file or stdin selector.
- Write a `json` value as its compact JSON text in one word.
- Translate the parser's `field` back to the document pointer (`/round`, `/operands/0`, `/1/round` in a batch), and
  for a required argument missing from both sources, to the pointer its key would have.

## 5. Patterns: why each restriction, and the cross-engine record

Annex V2 restricts a domain `pattern` to a form that ECMAScript (with the `u` flag, as JSON Schema validators such
as Ajv read it) and the Rust `regex` crate read the same way. Each restriction removes a spelling the two engines
read differently:

- I-Regexp treats `^` and `$` as ordinary characters; the anchors are therefore only the outer ones.
- `.` excludes CR in ECMAScript but only LF in Rust.
- ECMAScript refuses `\-` outside a class under `u`.
- Inside a class, Rust reads `&&` as intersection and `~~` as symmetric difference, where ECMAScript reads them as
  literal characters: `a` matches `^[a&&b]+$` in ECMAScript and not in Rust.
- `--` and a nested `[` (Rust's difference and nested sets, `[[:alpha:]]`) are already not I-Regexp; nor are `\d`,
  `\w`, back-references, lookaround and lazy quantifiers.
- `\s` and `\S` are not I-Regexp either, and they are where the engines disagree on white space: Rust's `\s` is the
  Unicode `White_Space` property, so it has U+0085 and not U+FEFF; ECMAScript's `\s` has U+FEFF and not U+0085. From
  1.5 a pattern says white space as `\p{White_Space}` (or `\P{White_Space}`), a name both engines read as the
  property: the one addition to I-Regexp, and only in that spelling (ECMAScript also knows `space`, Rust also matches
  `white_space` loosely; neither is admitted). Because `White_Space` is Zs, the tab and the seven line terminators,
  `[\P{White_Space}\p{Zs}\t]` is "any character but a line terminator" without naming one.
- A counted repetition of a large class can exceed Rust's compiled-size limit: `^\p{L}{1,500}$` does, and so do three
  `\p{L}{1,100}` in a row. A length limit is better written as `maxLength`.

The claim is narrow: for a pattern of this form that both engines compile, they accept the same values up to the
Unicode version of each engine's `\p{…}` tables. Such a difference is one code point whose general category differs
between the two Unicode versions (U+11DB0 is a letter in Unicode 17 and unassigned in Unicode 16, so `^\p{L}$`
accepts it in one engine only). Any other disagreement breaks the claim. The evidence is `scripts/regex-cases.json`,
a record of patterns and values run through both engines with the Unicode version of each; `scripts/validate.sh`
checks the ECMAScript side and, with `scripts/regex-parity`, the Rust side. A disagreement is accepted only for a case
marked as a Unicode-version difference whose recorded category each engine verifies in its own tables. The record
covers every construct the form admits (literals, escapes, classes with ranges, leading and trailing `-`, single `&`
and `~`, negation, categories, `White_Space` in and outside a class, groups, alternation, every quantifier, non-BMP
characters), each spelling removed above, the size and nesting limits, and every pattern an example in this repository
uses. A case that is of the form only from a minor on (the `White_Space` escapes, from 1.5) carries `formSince`.

## 6. Errors in text mode

Text is outside the protocol (spec 4.3.1), and in text mode an error goes to stderr (spec 5.3). The recommended form,
so that a person reads the same shape from every tool:

```
<tool>: <CODE>: <message>
  field: <field>
  expected: <a>, <b>, <c>
  hint: <hint>
```

with absent members left out.

## 7. Naming error codes in practice

Spec 7.2 fixes the grammar and the conditions; choosing a name is still a judgement. A procedure that gives the same
answer in different hands:

1. **Decide the stage first.** Did the command refuse before its work (exit 2) or did it run (exit 1)? That rules out
   half of the conditions. A failure category that happens at both stages gets two codes (`STORE_UNAVAILABLE`,
   `STORE_FAILED`); conservative staging (spec 8.3.1) uses the exit-1 code.
2. **Pick the condition by the caller's next action** (spec 7.2.2): fix a value (`INVALID`), supply something
   (`REQUIRED`), find the right name (`NOT_FOUND`), reread and retry with a fresh value (`STALE`), repair stored state
   (`CORRUPT`), wait and repeat (`UNAVAILABLE`), hand over to a person (`DENIED`), read what was done (`FAILED`,
   `INCOMPLETE`), repeat the wait (`TIMEOUT`, only for a command that waits, spec 12.3; a write whose backend call ran
   out of time is `FAILED` or `INCOMPLETE`, so that no agent repeats it blindly). A value above its domain maximum is
   `INVALID`; `TOO_LARGE` is a request too big, too many or too costly, refused before it runs (a query whose cost is
   estimated up front: `QUERY_TOO_LARGE`); a read that ran and was stopped at the backend's time limit has run, so it
   is exit 1: `TIMEOUT` if the command waits, otherwise `FAILED` or `INCOMPLETE`, with a `hint` to narrow it. A
   live-run or rate quota that frees up with time is `UNAVAILABLE`; a missing configuration is `REQUIRED`, never
   `UNAVAILABLE`. A verdict the command must pass before its work (a gate, an approval, a check of its input or
   state) is a precondition, exit 2 with a refusal condition, whatever the command calls it (spec 7.2.2, 8.3). Two
   situations with the same subject and condition whose next steps differ are one code with two reasons, unless they
   differ in retryability.
3. **Name the subject with a noun the tool already uses**, preferably a group of its command tree (`FINDING`,
   `MEMBER`, `DEPLOYMENT`) or the resource at fault (`STORE`, `CONFIG`, `LOCK`). A verb becomes its noun
   (`PROMOTE` → `PROMOTION`, `DEPLOY` → `DEPLOYMENT`). Keep the subject short: the condition carries the meaning.
4. **Never reuse a retired name with another meaning** (spec 15.3). When a rename would land on a name the tool used
   for something else (canon's `PLUGIN_SYNC_FAILED` meant exit 2 "could not start"), the new meaning takes another
   name: the old one is retired, never reassigned.
5. **Words that hide the stage are gone**: `REFUSED` (exit 2 in some tools, exit 1 in others), `ERRORS`, `ABORTED`,
   `MISMATCH`, `VIOLATIONS`, `DRIFT`. Their situations map to a condition plus, where the caller acts differently, a
   reason: a check that found drift is `<CHECK>_FAILED` with reason `DRIFT`; a digest that no longer matches is
   `<SUBJECT>_STALE`; two arguments that disagree are `<SUBJECT>_CONFLICT`.

A shared crate or `defineError` helper can take the condition as the input and derive `exit` and `retryable`, and
refuse at definition time a name that does not end in a condition (`approaches/rust.md`, `approaches/typescript.md`).

## 8. Producing the 1.4 self-description

A tool that declares 1.4 writes the self-description in the form of spec 9, from a typed model, through one serializer
that owns the rules below; no command writes an omission by hand. What a 1.3 tool writes (every member, `path`, the
schemas inside the command document) is held to 1.3.1 and is not described here (spec 15.7).

**Omit a member that equals its default** (spec 9.5; Annex S2 rule 17). The defaults, each compared at the point of
writing:

| Where | Absent means |
|---|---|
| operand, option | `required`, `repeatable`, `variadic`, `flagOnly` false; `default` null (`false` for a switch, `0` for a count); `valueType` `string`; `valueName` the name in upper case with `_` for `-` (a switch and a count have none); a count does not say `repeatable` |
| output | `kind` `report`; `schemaVersion` `1.0` |
| `input` | `batch` false |
| command | `async` false; an empty `operands`, `options`, `errors`, `constraints` or `validators` |
| tree entry | `kind` `command` (a group's entry says `group`); `path` is never written (the words of `command`) |

The same serializer omits what the document implies (spec 9.5): the options `--json`, `--input` (with `input`) and
`--fields` (when an output declares `fields`), and the codes `USAGE`, the finer replacements of `USAGE` the tool
registers (spec 7.3.2, such as `OPTION_INVALID`), `INTERNAL`, the `INPUT_*` codes with `input`, `BATCH_INCOMPLETE`,
`PLAN_STALE`, `OPERATION_REUSED` and `CURSOR_INVALID` with the feature that raises them. `--commit` and
`--plan-digest` are not implied: a destructive command lists them, so that the document alone says whether a bare run
acts or previews. The tool still registers every code and still enforces every option; only the document leaves out
what it implies.

**Compact serialization.** Print the document with no whitespace outside strings, members in the order the model
declares, then one newline (spec 5.1). Do it for every envelope and stream line, not only for `schema`, and compare
with `JSON.stringify(JSON.parse(text))` in a test.

**Decide shared options by identical definitions.** After the defaults are omitted, serialize each option of each
command. An option whose serialization is the same on two or more commands is defined once in the tree's `options`,
in the order of its first appearance, and each of those commands names it, at the place its option stood. An option
whose `required`, default or enum subset differs on a command is a different definition (Annex S1 item 4 allows the
difference), so that command keeps it in full. An option on one command stays on that command. Every tree option must
be named by some command (Annex S2 rule 17), which holds by construction when the tree is built from the commands.

**Why paging options stay listed.** `--limit` carries a default and a bound that differ per command, and `--all`,
`--cursor` are offered or not per command, so the list is what declares which commands page and how far. A caller finds
the paging surface in the command document alone, and `CURSOR_INVALID` is implied by the listed `--cursor`. A
`--limit` that is identical on several commands is shared like any other option.

**Shared names and reserved names.** A string in `options` names a tree option or a reserved option (spec 4.5). A
reserved option's shape is fixed (Annex S2 rule 8), so a command lists `--commit`, `--plan-digest`, `--limit`,
`--cursor`, `--all` and the like by their bare names, with no tree entry; each reserved option has one standard
help text in the crate (`atip::describe::standard_help`). The serializer writes the name when the option is the reserved one
unchanged and its help equals the standard text after whitespace normalisation; with another help, or for a command's own
option, it writes an object (for a reserved option, its fixed shape plus that `help`, as `member list` does for `--cursor` and
`--all` in the acme example). A tool that wants another standard text defines the option once in the tree's `options`; a name
resolves there first. Never list an option the document
implies, neither as an object nor as a name (Annex S2 rule 17).

**How a caller rebuilds the full option set and the fragment schema** (spec 9.5, 9.9.2):

1. Read the tree once per tool (`<tool> schema --json`) and keep its `options` by name.
2. Read the command document (`<tool> schema <PATH> --json`) and give every absent member its default.
3. Start the option set with the implied reserved options, each with its shape from spec 4.5. Then, for each entry of
   `options` in order: a string is the tree option of that name, else the reserved option of that name with its fixed
   shape (a name that is neither leaves the option out, spec 15.4), an object is that option. The errors of the
   command are `errors` plus the implied codes.
4. For the input fragment schema (or read `Input` from the schemas answer, item 5), build an object with
   `additionalProperties: false` and no `required`. `operands` is
   an array of the operand values, at least one, at most one per operand unless the last is variadic. For every
   option of the set that is not flag-only, add a property with the camelCase name that admits the `--input` values
   of its valueType (spec 9.7.2); an array of them for a repeatable option. Domains are checked later, at step 6 of
   spec 10.7.
5. Ask `<tool> schema <PATH> --schemas --json` to validate or decode `data`, to test a validator, or to take the
   input fragment schema without deriving it: when the command has `input`, the answer's `schemas` holds it under the
   name `Input` (spec 9.9.3). Resolve each `#/schemas/<Name>` in `schemas`. The answer's `rejects` has one list per
   validator, in the command document's `validators` order; the command document itself has no `rejects`. A caller that
   only builds invocations never needs the answer.
