# Examples

Documents that `scripts/validate.sh` checks: everything here must pass, everything in `invalid/` must be
rejected (by a JSON Schema or by a rule of `scripts/check.ts`), and the validator prints the first reason for each
rejection. The file name says what a file is (`schema-*`, `input-*`, `stream-*`, `caller-*`, otherwise an envelope); see the
header of `scripts/check.ts`.

Every positive file is a complete conformance fixture: its schemas describe the whole output, previews list every
effect, and `meta.context` holds only context option names. Translations from canon mark what canon would have to
change to print them (the "Proposed" column below).

## Two kinds of example

**Translations of canon 0.31.0** (`*-canon-*`, and the unprefixed `report-*` and `schema-*` files, which are
canon's): what canon prints today, read from its read-only `schema` output (`canon schema finding close --json`)
and its checked-in `docs/cli/canon.cli.json`, rewritten into ATIP's shape. Each difference from canon is one of
three kinds:

- **contract shape**: what ATIP renames or restructures (`about` → `summary`, `kind` → `valueType`, typed
  defaults, `constraints` instead of `requiredOneOf`/`conflictsWith`, `x-canon.roles`, reserved codes
  `INPUT_*`/`BATCH_INCOMPLETE`/`PLAN_STALE` in place of canon's `INPUT_INVALID_TYPE`, `INPUT_ELEMENT_FAILED`,
  `PLAN_CHANGED`, …). These are the adoption items in `approaches/migration.md`.
- **proposed**: a behaviour change the contract requires of canon, not just a rename.
- **not verified**: shown for completeness; nothing here establishes it.

**A synthetic reference tool, `acme`** (`*-acme-*`), which declares contract 1.1 (`meta.contractVersion`, spec 15.7)
while canon's translations declare 1.0: an invented tool that exercises what neither translation does,
so that every rule has a positive witness: a declared short option (`-t`), a required repeatable option and an
`x-acme` extension member (`acme page label`), an `async` command with an operation key and the command that
waits for it (`acme deploy start`, `acme deploy status`, `report-acme-deploy-start-accepted.json`), nested field projection with `[]`
paths through a nullable member, records under an escaped pointer (`/member~1list`) and under a pointer with a
repeated segment (`/items/items`), a nullable report root, an `enum` of objects on a member selected whole, a leaf
whose schema refers to a cut node's definition (`note`, never a whole `Profile`), an integer operand with values at
the edge of the safe range, a `json` operand and option that take `true`, `false`, arrays and objects, a `number`
option with a domain bound of `1e20`, an optional variadic operand with a default (`acme lint`), an informative
`argumentsRef` over the normalised argument object (numeric strings in documents, defaults applied), a validator
that `argumentsRef` also states (`TAG_RESERVED`), argument `domain`s of each profile row (numeric, string
`pattern`, `json` structure with a data member named `$ref`, a `format` annotation, a count with a bound), a batch
command whose own batch schema is deliberately permissive, a stream command with two stream outputs (one whose
event schema is the boolean schema `false`), a failed stream, and a stream refused before it began. Its `-v` count
option goes against the advice not to add new counts (Appendix A D11.3); it exists only to witness a count with a
domain. Nothing in it describes a real tool.

| File | Proposed | Not verified |
|---|---|---|
| `schema-command-canon-finding-close.json` | `unchanged` moves from canon's `meta.unchanged` into the report (so the report is `1.1`); the two value-conditional `constraints` with canon's codes (canon enforces them, its spec does not publish them); the `domain` `{minimum: 1}` on `--round` and `--seq` (canon enforces it with `FINDING_INVALID_ARGUMENT`); the examples completed by an inline `--input`, one of them a one-item batch | — |
| `schema-command-canon-finding-list.json` | `--fields` paths in camelCase only and an unknown one refused with `USAGE` (canon: `UNKNOWN_FIELD`); `limit` default `100` typed (canon publishes `[]`) with `domain` `{minimum: 1}`; `CURSOR_INVALID` instead of canon's `INVALID_CURSOR` | which fields canon always keeps; `keep: [round, seq]` is illustrative |
| `schema-command-canon-purge.json` | the `requires` constraints between `--commit` and `--plan-digest` (enforced, not published); the `planDigest` description, superseded by spec 12.6; the `--before` domain (a pattern) and the validator for calendar dates (spec 10.8.3), whose code `USAGE` is a guess: canon checks `<TIMESTAMP>` values, but which code it refuses them with is not recorded here | — (`PurgeReport` and its definitions are canon's own schema, with their `$id` removed, see approaches/rust.md §5) |
| `schema-command-canon-skills-show.json` | `NAME` optional (required today); data `{name, text, guides, full?}` instead of `{name, version, markdown}`, so `2.0` | — |
| `schema-tree.json`, `schema-group.json`, `schema-tree-search.json` | — | the tree is shortened to the commands the other examples use; a real tree lists every node |
| `schema-errors.json` | `WRITE_FAILED` exit 1 (canon: 2) per spec 8.3; `CURSOR_INVALID` replaces `INVALID_CURSOR`; meanings and fixes reworded | the registry lists the codes the examples use plus the reserved ones, not all 175 of canon's |
| `report-preview.json` | the `append` effect for the audit line a commit writes (canon does not list it, spec 12.4); `sha256:` digest prefix (canon prints bare hex) | file names, counts, `sourceScope` and `rungs` values and the digest are invented |
| `report-failure-stale-plan.json` | `sha256:` digest prefix | the digest is invented |
| `report-*.json` (others) | `next` entries include `--json` | ids, commit hashes and texts are invented |

All ids, digests, cursors, timestamps and free text in reports are invented and only need to be well-formed.

**Patterns** are also recorded outside the examples: `scripts/regex-cases.json` lists each pattern a valid example
uses, every construct the pattern form admits and each spelling it removes, with the answer of ECMAScript (`u`)
and of the Rust `regex` crate for a value. `scripts/validate.sh` checks the ECMAScript column, and with cargo the
Rust column through `scripts/regex-parity`.

## Invalid examples

Each file in `invalid/` breaks one rule, and the name says which. Together with the positive files they pin down
`scripts/check.ts`: every false acceptance and false rejection found in it has a file, so it stays fixed. The
ones that are easiest to miss:

| Case | File | Result |
|---|---|---|
| a group's own `command` differs from its path | `invalid/schema-group-id-mismatch.json` | rejected |
| a constraint `in` value outside an integer argument's domain; `in: ["1"]` not matching `--round 1` | `invalid/schema-constraint-in-wrong-type.json`, `invalid/schema-constraint-in-numeric-string.json` | rejected |
| the same `atMostOne` rule twice | `invalid/schema-constraint-duplicate.json` | rejected (spec 10.8.2) |
| a fragment schema with a root `required` | `invalid/schema-fragment-required.json` | rejected |
| a `next` display string that does not match its argv | `invalid/report-next-command-mismatch.json` | rejected |
| a failed batch item without its error, also under a permissive tool batch schema; a nested item error with the wrong `retryable` | `invalid/report-batch-failed-without-error.json`, `invalid/report-acme-member-tag-batch-failed-without-error.json`, `invalid/report-batch-nested-retryable.json` | rejected |
| a data-less failure with the wrong `retryable`, or a version no output has | `invalid/report-failure-retryable-mismatch.json`, `invalid/report-failure-version-mismatch.json` | rejected |
| invalid stream internals (event payload, end retryable, end version, end refusal with data, start/end output mismatch) | `invalid/stream-acme-build-*.ndjson` | rejected |
| a declared short option in an example | `schema-command-acme-member-list.json` | accepted |
| an example completed by an inline `--input`, one of them a one-item batch | `schema-command-canon-finding-close.json`, `schema-command-acme-member-tag.json` | accepted |
| a scalar for a repeatable option inside an inline `--input` example | `invalid/schema-example-input-scalar-repeatable.json` | rejected |
| a `json` value `[1]` on argv and `1` in the document; equal objects with reordered members | `invalid/schema-example-input-json-shape-conflict.json`; `schema-command-acme-filter-test.json` (third example) | rejected; accepted |
| a referenced `false` schema | `schema-command-acme-build.json`, `stream-acme-build-quiet.ndjson` | accepted |
| a boolean `json` operand | `input-acme-filter-test-boolean.json`, `input-acme-filter-test-false.json` | accepted |
| projection: a correct nested projection; a nullable projected member; parent and child selected together; a missing child; an unselected member left in | `report-acme-member-list-fields-nested.json`, `-null-profile.json`, `-parent-child.json`; `invalid/report-acme-member-list-fields-missing-child.json`, `-leak.json`, `-parent-child-leak.json` | accepted; rejected |
| records under an escaped pointer (`/member~1list`) and a repeated segment (`/items/items`); a nullable report root | `schema-command-acme-member-roster.json`, `schema-command-acme-member-export.json`, `report-acme-member-export-null.json` | accepted |
| cut nodes: an object `const`, `enum` or `uniqueItems`; a `const` or `allOf` on the root above `fields.records`; a boolean or untyped cut node | `invalid/schema-fields-cut-node-*.json` | rejected |
| an `enum` of objects on a member selected whole; a leaf that is `not` a `Profile` beside the projected `profile` | `report-acme-member-list-fields-structural-enum.json`, `-note-not-profile.json` | accepted |
| `owners.email` declared although `owners` is an array | `invalid/schema-fields-path-array-without-brackets.json` | rejected |
| a count default outside its domain; `-v -v -v` beyond it | `invalid/schema-domain-count-default-outside.json`, `invalid/schema-example-count-outside-domain.json` | rejected |
| a domain property *named* `$ref`; a real `$ref` keyword | `schema-command-acme-filter-test.json` (`--scope`); `invalid/schema-domain-ref.json` | accepted; rejected |
| integers: ±9007199254740991; ±9007199254740992; `9007199254740993` against an unsafe bound; unsafe literal and string in a document | `schema-command-acme-member-show.json`; `invalid/schema-example-integer-max-plus-one.json`, `-min-minus-one.json`, `-unsafe.json`, `invalid/schema-domain-bound-unsafe.json`, `invalid/input-acme-member-tag-unsafe-*.json` | accepted; rejected, never rounded |
| a `number` domain bound of `1e20`; a bound that is not finite | `schema-command-acme-filter-test.json` (`--weight`); `invalid/schema-domain-number-bound-not-finite.json` | accepted; rejected |
| a `format: email` domain and the value `not-an-email` | `input-acme-member-tag-format-annotation.json` | accepted: `format` is an annotation (spec 10.7.4) |
| a numeric string in a document against an integer `argumentsRef` | `input-acme-member-tag-numeric.json` | accepted (the argument object has numbers) |
| a validator that `argumentsRef` also states; a validator witness that is also an example | `schema-command-acme-member-tag.json` (`TAG_RESERVED`); `invalid/schema-validator-rejects-is-example.json` | accepted; rejected |
| an optional variadic operand defaulting to an array, absent; the same without the default | `schema-command-acme-lint.json`, `input-acme-lint-empty.json`; `invalid/schema-example-variadic-without-default.json` | accepted; rejected |
| the argv example `acme filter test 7`; `acme member tag 0` | `invalid/schema-example-outside-domain-json.json`, `invalid/schema-example-member-tag-zero.json` | rejected by the domain |
| patterns outside the form (`.`, lookahead, `\w`, top-level `|`, no anchors, `&&` or `~~` in a class), refused by Rust's size limit, or not recorded | `invalid/schema-domain-pattern-*.json` | rejected |
| keywords outside a valueType's domain profile | `invalid/schema-domain-numeric-keyword-on-string.json`, `-outside-profile.json`, `-structural-enum.json` | rejected |
| a command offering `--cursor` without `CURSOR_INVALID` | `invalid/schema-command-missing-reserved-code.json` | rejected |

Cross-engine pattern behaviour (a trailing LF or CRLF, `&&` and `~~` in a class, `\p{Cs}` and `\p{Cn}`, a category
that differs between Unicode versions) is recorded in `scripts/regex-cases.json`.

## Contract 1.1

acme declares 1.1 and uses what 1.1 adds; canon's translations declare 1.0, and every 1.1 addition in a document
that declares 1.0 is rejected (spec 10.13 rule 16).

| Case | File | Result |
|---|---|---|
| registry reasons under `INPUT_INVALID` and `CURSOR_INVALID`; one entry | `schema-errors-acme.json`, `schema-error-acme-input-invalid.json` | accepted |
| an error with a registered reason; `details` items with reasons | `report-failure-acme-input-reason.json`, `report-failure-acme-input-details-reason.json` | accepted |
| a reason not registered under its code, at the top or in `details` | `invalid/report-acme-reason-unregistered.json`, `invalid/report-acme-details-reason-unregistered.json` | rejected |
| a reason, reasons, a warning registry or a bracketed path in a document that declares 1.0 | `invalid/report-acme-reason-in-1-0.json`, `invalid/schema-errors-acme-reasons-in-1-0.json`, `invalid/schema-warnings-acme-in-1-0.json`, `invalid/schema-fields-bracket-in-1-0.json`, `invalid/report-acme-member-list-fields-map-key-in-1-0.json` | rejected |
| a reason twice under one code; a code twice; a lower-case reason | `invalid/schema-errors-acme-duplicate-reason.json`, `invalid/schema-errors-acme-duplicate-code.json`, `invalid/schema-error-acme-reason-lowercase.json` | rejected |
| the warning registry and one entry; a report whose warning is only in it | `schema-warnings-acme.json`, `schema-warning-acme-member-archived.json`, `report-acme-member-list-warning.json` | accepted |
| a warning registered nowhere; a warning twice; a warning entry with an exit | `invalid/report-acme-warning-unregistered.json`, `invalid/schema-warnings-acme-duplicate.json`, `invalid/schema-warnings-acme-with-exit.json` | rejected |
| `schema --error` given a warning-only code, with and without the `--warning` hint | `report-failure-acme-schema-error-warning-only.json`; `invalid/report-acme-schema-error-warning-only-no-hint.json` | accepted; rejected |
| a hint that starts with the tool name but does not split | `invalid/report-acme-hint-not-a-command-line.json` | rejected |
| a bracketed key (`["display-name"]`) and map keys (`attributes.region`, `attributes["http.status-code"]`) | `report-acme-member-list-fields-map-keys.json` | accepted |
| a map key left in that was not selected; a path that is neither declared nor a map key | `invalid/report-acme-member-list-fields-map-key-leak.json`, `invalid/report-acme-member-list-fields-not-a-map-key.json` | rejected |
| an identifier in brackets; a malformed path | `invalid/schema-fields-bracket-identifier.json`, `invalid/schema-fields-path-malformed.json` | rejected |
| a schema answer whose `schemaVersion` is not its contract version; `contractVersion` without `contract`; a minor this repository does not describe; a stream whose end declares another minor than its start | `invalid/schema-version-not-contract-version.json`, `invalid/envelope-contract-version-without-contract.json`, `invalid/report-acme-contract-version-unknown.json`, `invalid/stream-acme-build-start-contract-version-mismatch.ndjson` | rejected |

**Caller documents** (`caller-*.json`) are what a tool of a later minor might print: `contractVersion` `1.2` and
members this repository does not define (`meta.costMs`, `page.exact`, `error.severity`, a registry entry's `docs`).
A caller of this minor must read them (spec 15.6): each passes the contract schemas read open and fails them
closed. `invalid/caller-report-nothing-unknown.json` carries nothing unknown, and `invalid/caller-report-wrong-type.json`
gives a known member the wrong type, so a caller reading open still rejects it.

