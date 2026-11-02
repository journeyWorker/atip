# Implementation guidance: recommendations beyond the protocol

Not normative. Section numbers ("spec 10.7") refer to `spec/atip-1.md`, version 1.3.0.

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
repeats meets the next problem in a predictable place.

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
and `~`, negation, categories, groups, alternation, every quantifier, non-BMP characters), each spelling removed
above, the size and nesting limits, and every pattern an example in this repository uses.

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
   (`REQUIRED`), find the right name (`NOT_FOUND`), reread and retry with a fresh value (`STALE`), wait and repeat
   (`UNAVAILABLE`), hand over to a person (`DENIED`), read what was done (`FAILED`, `INCOMPLETE`), repeat the wait
   (`TIMEOUT`). Two situations with the same action and the same subject are one code with two reasons.
3. **Name the subject with a noun the tool already uses**, preferably a group of its command tree (`FINDING`,
   `MEMBER`, `DEPLOYMENT`) or the resource at fault (`STORE`, `CONFIG`, `LOCK`). A verb becomes its noun
   (`PROMOTE` → `PROMOTION`, `DEPLOY` → `DEPLOYMENT`). Keep the subject short: the condition carries the meaning.
4. **Never reuse a retired name with another meaning** (spec 15.3). When a rename would land on a name the tool used
   for something else (`PLUGIN_SYNC_FAILED` was exit 2 "could not start"; the exit-1 failure cannot take it), pick
   another subject (`PLUGIN_WRITE_FAILED`).
5. **Words that hide the stage are gone**: `REFUSED` (exit 2 in some tools, exit 1 in others), `ERRORS`, `ABORTED`,
   `MISMATCH`, `VIOLATIONS`, `DRIFT`. Their situations map to a condition plus, where the caller acts differently, a
   reason: a check that found drift is `<CHECK>_FAILED` with reason `DRIFT`; a digest that no longer matches is
   `<SUBJECT>_STALE`; two arguments that disagree are `<SUBJECT>_CONFLICT`.

A shared crate or `defineError` helper can take the condition as the input and derive `exit` and `retryable`, and
refuse at definition time a name that does not end in a condition (`approaches/rust.md`, `approaches/typescript.md`).
