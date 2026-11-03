# Examples

Documents that `scripts/validate.sh` checks: everything here must pass, everything in `invalid/` must be
rejected (by a JSON Schema or by a rule of `scripts/check.ts`), and the validator prints the first reason for each
rejection. The file name says what a file is (`schema-*`, `input-*`, `stream-*`, `caller-*`, otherwise an envelope); see the
header of `scripts/check.ts`.

Every positive file is a complete conformance fixture: its schemas describe the whole output, previews list every
effect, and `meta.context` holds only context option names. Translations from canon mark what canon would have to
change to print them (the "Proposed" column below).

`scripts/check.ts` also tests the repository against the spec, beyond the examples. The rules it applies come from the
spec and its annexes (`spec/annex-fields.md`, `spec/annex-domains.md`, `spec/annex-schema.md`); the self-description
rules are those of Annex S2. It fails when a schema in `schema/` lists string values for a member that has no row in
the caller table (spec 15.4), it validates `examples/caller-*` read open (spec 15.6), and every rule of Annex S2 has at
least one invalid example that breaks it alone. It also checks that every section reference in the spec, and every
`spec <N.N>` and `Annex <X><n>` reference in the annexes, `approaches/` and the READMEs, names something that exists.
The checker is a non-normative tool that tests documents; conformance is defined by the spec (3.7).

## Two kinds of example

**Translations of canon 0.31.0** (`*-canon-*`, and the unprefixed `report-*` and `schema-*` files, which are
canon's): what canon prints today, read from its read-only `schema` output (`canon schema finding close --json`)
and its checked-in `docs/cli/canon.cli.json`, rewritten into ATIP's shape. Each difference from canon is one of
three kinds:

- **contract shape**: what ATIP renames or restructures (`about` → `summary`, `kind` → `valueType`, typed
  defaults, `constraints` instead of `requiredOneOf`/`conflictsWith`, `x-canon.roles`, core codes
  `INPUT_*`/`BATCH_INCOMPLETE`/`PLAN_STALE` in place of canon's `INPUT_INVALID_TYPE`, `INPUT_ELEMENT_FAILED`,
  `PLAN_CHANGED`, …). These are the adoption items in `approaches/migration.md`.
- **proposed**: a behaviour change the contract requires of canon, not just a rename.
- **not verified**: shown for completeness; nothing here establishes it.

**A synthetic reference tool, `acme`** (`*-acme-*`), which declares contract 1.4 (`meta.contractVersion`, spec 15.5)
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
that `argumentsRef` also states (`TAG_INVALID`, reason `RESERVED`), argument `domain`s of each profile row (numeric, string
`pattern`, `json` structure with a data member named `$ref`, a `format` annotation, a count with a bound), a batch
command whose own batch schema is deliberately permissive, a stream command with two stream outputs (one whose
event schema is the boolean schema `false`), a failed stream, and a stream refused before it began. Its `-v` count
option goes against the advice not to add new counts (Appendix A D11.3); it exists only to witness a count with a
domain. Nothing in it describes a real tool.

| File | Proposed | Not verified |
|---|---|---|
| `schema-command-canon-finding-close.json` | `unchanged` moves from canon's `meta.unchanged` into the report (so the report is `1.1`); the two value-conditional `constraints` with canon's codes (canon enforces them, its spec does not publish them); the `domain` `{minimum: 1}` on `--round` and `--seq` (canon enforces it with `FINDING_INVALID_ARGUMENT`); the examples completed by an inline `--input`, one of them a one-item batch | — |
| `schema-command-canon-finding-list.json` | `--fields` paths in camelCase only and an unknown one refused with `USAGE` (canon: `UNKNOWN_FIELD`); `limit` default `100` typed (canon publishes `[]`) with `domain` `{minimum: 1}`; `CURSOR_INVALID` instead of canon's `INVALID_CURSOR` | which fields canon always keeps; `keep: [round, seq]` is illustrative |
| `schema-command-canon-purge.json` | the `requires` constraints between `--commit` and `--plan-digest` (enforced, not published); the `planDigest` description, superseded by spec 11.6; the `--before` domain (a pattern) and the validator for calendar dates (spec 9.8.2), whose code `USAGE` is a guess: canon checks `<TIMESTAMP>` values, but which code it refuses them with is not recorded here | — (`PurgeReport` and its definitions are canon's own schema, with their `$id` removed, see approaches/rust.md §5) |
| `schema-command-canon-skills-show.json` | `NAME` optional (required today); data `{name, text, guides, full?}` instead of `{name, version, markdown}`, so `2.0` | — |
| `schema-tree.json`, `schema-group.json`, `schema-tree-search.json` | — | the tree is shortened to the commands the other examples use; a real tree lists every node |
| `schema-errors.json` | `WRITE_FAILED` exit 1 (canon: 2) per spec 8.3; `CURSOR_INVALID` replaces `INVALID_CURSOR`; meanings and fixes reworded | the registry lists the codes the examples use plus the reserved ones, not all 175 of canon's |
| `report-preview.json` | the `append` effect for the audit line a commit writes (canon does not list it, spec 11.4); `sha256:` digest prefix (canon prints bare hex) | file names, counts, `sourceScope` and `rungs` values and the digest are invented |
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
| the same `atMostOne` rule twice | `invalid/schema-constraint-duplicate.json` | rejected (spec 9.8.1) |
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
| a `format: email` domain and the value `not-an-email` | `input-acme-member-tag-format-annotation.json` | accepted: `format` is an annotation (Annex V1) |
| a numeric string in a document against an integer `argumentsRef` | `input-acme-member-tag-numeric.json` | accepted (the argument object has numbers) |
| a validator that `argumentsRef` also states; a validator witness that is also an example | `schema-command-acme-member-tag.json` (`TAG_INVALID`, its `rejects` in `schema-schemas-acme-member-tag.json`); `invalid/schema-validator-rejects-is-example.json` | accepted; rejected |
| an optional variadic operand defaulting to an array, absent; the same without the default | `schema-command-acme-lint.json`, `input-acme-lint-empty.json`; `invalid/schema-example-variadic-without-default.json` | accepted; rejected |
| the argv example `acme filter test 7`; `acme member tag 0` | `invalid/schema-example-outside-domain-json.json`, `invalid/schema-example-member-tag-zero.json` | rejected by the domain |
| patterns outside the form (`.`, lookahead, `\w`, top-level `|`, no anchors, `&&` or `~~` in a class), refused by Rust's size limit, or not recorded | `invalid/schema-domain-pattern-*.json` | rejected |
| keywords outside a valueType's domain profile | `invalid/schema-domain-numeric-keyword-on-string.json`, `-outside-profile.json`, `-structural-enum.json` | rejected |
| a command offering `--cursor` without `CURSOR_INVALID` | `invalid/schema-command-missing-reserved-code.json` | rejected |

Cross-engine pattern behaviour (a trailing LF or CRLF, `&&` and `~~` in a class, `\p{Cs}` and `\p{Cn}`, a category
that differs between Unicode versions) is recorded in `scripts/regex-cases.json`.

## Contract 1.1

acme declares 1.4, which includes what 1.1 adds; canon's translations declare 1.0, and every 1.1 addition in a
document that declares 1.0 is rejected (spec Annex S2 rule 16).

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

**A synthetic tool that stays on 1.0, `ledger`** (`*-ledger-*`): it declares nothing, so every document is a 1.0
document, and it shows what 1.1 must leave alone. Its `entry list` declares a whole map with `minProperties`
(allowed: in 1.0 a map is kept whole and is no cut node), its failure has a prose hint that starts with the tool
name, and its warning code lives in the error registry with exit 1, as 1.0 allowed. Selecting a map key, a
bracketed path in its `meta`, or an unregistered warning in its schema answer is rejected.

| Case | File | Result |
|---|---|---|
| a 1.0 whole map with `minProperties`; the same map in a 1.1 document | `schema-command-ledger-entry-list.json`; `invalid/schema-fields-map-cut-node-min-properties.json` | accepted; rejected |
| a 1.0 prose hint that starts with the tool name; the same in a 1.1 document | `report-failure-ledger-prose-hint.json`; `invalid/report-acme-hint-prose-starting-with-tool.json` | accepted; rejected |
| a 1.0 warning registered only in the error registry | `report-ledger-entry-list-fields.json`, `schema-errors-ledger.json` | accepted |
| a map-key selection in 1.0 | `invalid/report-ledger-entry-list-map-key.json` | rejected |
| a 1.0 schema answer with a bracketed `meta.fields`, or an unregistered warning | `invalid/schema-ledger-meta-bracket-field.json`, `invalid/schema-ledger-meta-warning-unregistered.json` | rejected |
| a 1.0 batch item whose `details` carry reasons; a 1.1 batch item whose reason, or whose detail's reason, is not registered; a registered one | `invalid/report-batch-item-details-reason-in-1-0.json`, `invalid/report-acme-member-tag-batch-item-reason-unregistered.json`, `invalid/report-acme-member-tag-batch-item-details-reason-unregistered.json`; `report-acme-member-tag-batch.json` | rejected; accepted |
| `contractVersion` written as `"1.0"`, on an envelope or a stream start line (the schema pattern admits only `1.1` and later, spec 6.6); a stream that declares an unknown minor | `invalid/report-contract-version-explicit-1-0.json`, `invalid/stream-acme-build-start-contract-version-1-0.ndjson`, `invalid/stream-acme-build-start-contract-version-unknown.ndjson` | rejected |
| the empty map key `attributes[""]`, a map under `labels[]`, a map written with `properties: {}` | `report-acme-member-list-fields-map-keys.json` | accepted |
| `labels.region` where `labels` is an array of maps; the empty key left in unselected | `invalid/report-acme-member-list-fields-map-key-without-descent.json`, `invalid/report-acme-member-list-fields-empty-key-leak.json` | rejected |

**Caller documents** (`caller-*.json`) are what a tool of a later minor might print: `contractVersion` `1.5` (they
model a minor later than the 1.4 this repository describes) and
members this repository does not define (`meta.costMs`, `page.exact`, `error.severity`, a registry entry's `docs`).
A caller of this minor must read them (spec 15.4): each passes the contract schemas read open and fails them
closed. `invalid/caller-report-nothing-unknown.json` carries nothing unknown, and `invalid/caller-report-wrong-type.json`
gives a known member the wrong type, so a caller reading open still rejects it. Values outside a listed set go
through the caller's view of spec 15.6 first (`schemaAnswerView` in `scripts/check.ts`): an unknown `data.kind`
(`caller-schema-acme-unknown-kind.json`), `valueType`, `effect`, output `kind` and tree entry `kind`
(`caller-schema-command-acme-unknown-*.json`, `caller-schema-tree-acme-unknown-entry-kind.json`) are accepted that
way, while an unknown major (`invalid/caller-report-unknown-major.json`) and a known member of the wrong type
(`invalid/caller-schema-command-wrong-known-type.json`) stay rejected. A view that has left out every output
(`caller-schema-command-acme-all-outputs-unknown.json`), every tree entry
(`caller-schema-tree-acme-all-entries-unknown.json`), the batch output (`caller-schema-command-acme-batch-output-unknown.json`)
or an argument with no value name (`caller-schema-command-acme-unknown-flag-without-value-name.json`) is still
read: the completeness rules it can no longer meet are dropped. A discriminator that is not a string is a wrong
type, not an unknown value: `invalid/caller-schema-command-effect-wrong-type.json` (`effect: {"bad": true}`) and
`invalid/caller-schema-command-value-type-wrong-type.json` (`valueType: 77`) are rejected.

Every row of the caller table of spec 15.4 has a fixture: `meta.contract` (`invalid/caller-report-unknown-major.json`),
`data.kind` (`caller-schema-acme-unknown-kind.json`), a tree entry's `kind` and `effect` and the tree's `level`
(`caller-schema-tree-acme-unknown-entry-kind.json`, `-unknown-entry-effect.json`, `-unknown-level.json`), a command's
`effect` and `idempotency`, an operand's and an option's `valueType`, a constraint's `rule`, `input.option`, a
domain keyword and a domain type name, an output's `kind` (`caller-schema-command-acme-unknown-*.json`), a batch
item's `status` (`caller-batch-acme-member-tag-unknown-status.json`, whose data is also checked against the batch
report read open) and a stream line's `type` (`caller-stream-acme-build-unknown-line-type.ndjson`). Wrong shapes stay
rejected: a constraint `rule` of `77` or missing, a batch `status` of `5`, a stream line `type` of `3`, and an exit
outside `1` and `2` (`invalid/caller-*`).

A 1.1 or later tool marks every document: `invalid/report-acme-markers-missing.json`, `invalid/schema-tree-acme-markers-missing.json`
and `invalid/stream-acme-build-markers-missing.ndjson` omit `contract` and `contractVersion` and are rejected. A
map key containing U+0000 cannot be selected (`invalid/report-acme-member-list-fields-map-key-nul.json`).

## Contract 1.2

1.2 adds no member, so its rules are checked by the declared minor (spec Annex S2 rule 16): in a document that declares
1.2 or later the paging and field-selection options are flag-only (spec 10.6), and in a document that declares exactly
1.2 `STOPPED_MIDWAY` is a core code (spec 15.7). acme declares 1.4 and keeps the flag-only options; the two
1.2-only rules have their witnesses in documents that declare 1.2. A third synthetic tool, **`tally`** (`*-tally-*`),
stays on 1.1: its `entry list` is `ledger`'s with the map's `minProperties` removed (a 1.1 map is a cut node), and it
shows that neither 1.2 rule applies below 1.2.

| Case | File | Result |
|---|---|---|
| a command document whose `--limit`, `--cursor`, `--all` and `--fields` are flag-only, at 1.4 | `schema-command-acme-member-list.json` | accepted |
| the same at 1.2 with `--limit` not flag-only; a 1.1 document with none of them flag-only | `invalid/schema-command-acme-member-list-limit-not-flag-only.json`; `schema-command-tally-entry-list.json` | rejected; accepted |
| `STOPPED_MIDWAY` at exit 2 in a 1.2 registry; a 1.1 tool's own `STOPPED_MIDWAY` that is retryable, read by its registry entry (spec 8.3.2) | `invalid/schema-errors-acme-stopped-midway-exit-2.json`; `schema-errors-tally.json` | rejected; accepted |

The other 1.2 rules (which arguments bind a cursor, `--fields` without `--json`, the order of the stateless checks)
are behaviour, not documents; the checker tests them (approaches/checker.md).

## Contract 1.3

1.3 adds no member, document kind or enum value either; its rules bind a document that declares 1.3 or later (spec
15.1, 15.5). acme declares 1.4, which includes 1.3, and its codes are renamed to follow the convention of spec 7.2:
`DEPLOY_FAILED` is `DEPLOYMENT_FAILED`, `DEPLOY_WAIT_TIMEOUT` is `DEPLOYMENT_TIMEOUT` (exit 1, retryable),
`ENVIRONMENT_FROZEN` is the reason of `DEPLOYMENT_DENIED` (exit 2), `TAG_RESERVED` is `TAG_INVALID` with the reason
`RESERVED`, and `STOPPED_MIDWAY` is acme's own `DEPLOYMENT_INCOMPLETE` (exit 1, not retryable) whose reason is the
refused code, `DEPLOYMENT_DENIED` (spec 8.3.2). canon (1.0), ledger (1.0) and tally (1.1) are unchanged, so earlier
minors keep passing and failing as before.

| Case | File | Result |
|---|---|---|
| a registry of codes that are core codes or follow `<SUBJECT>_<CONDITION>`, with the exit and retryability of their conditions; a stop part-way reported with an `INCOMPLETE` code whose reason is the refused code | `schema-errors-acme.json`, `report-failure-acme-deploy-start-incomplete.json` | accepted |
| a `FAILED` or `INCOMPLETE` code registered `retryable: true`: repeating resumes the work without repeating an effect (spec 7.2.3) | `schema-error-acme-incomplete-retryable.json` | accepted |
| a code that does not follow the grammar (`PROMOTE_REFUSED`) | `invalid/schema-error-acme-code-grammar.json` | rejected (spec 7.2.3) |
| a `*_NOT_FOUND` code registered with exit 1 | `invalid/schema-error-acme-not-found-exit-1.json` | rejected |
| a `*_UNAVAILABLE` code registered not retryable | `invalid/schema-error-acme-unavailable-not-retryable.json` | rejected |
| `STOPPED_MIDWAY` registered in a 1.3 document (a core code only at 1.2) | `invalid/schema-error-acme-stopped-midway-in-1-3.json` | rejected |
| a `*_INCOMPLETE` code registered at exit 2 | `invalid/schema-error-acme-incomplete-exit-2.json` | rejected |
| a 1.3 report whose `meta.warnings` code is only in the error registry; the same code in the warning registry | `invalid/report-acme-warning-error-registry-only.json`; `report-acme-member-list-warning.json` | rejected; accepted (spec 7.5.2) |
| a warning code registered nowhere | `invalid/report-acme-warning-unregistered.json` | rejected |

Documents of an earlier minor keep the earlier rules: ledger's warning code lives in its error registry only
(`schema-errors-ledger.json`, accepted at 1.0), and tally's own `STOPPED_MIDWAY` is accepted at 1.1.

## Contract 1.4

1.4 changes the form of the self-description (spec 9, 15.7) and makes every document compact (spec 5.1); its rules bind
a document that declares 1.4. acme declares 1.4 and every acme file that declares a minor is stored compact, the way a
1.4 tool prints it. canon and ledger (1.0) and tally (1.1) stay as they were, and so do the acme witnesses of the
rules of 1.0-1.3 that declare 1.3 (`invalid/*-acme-*`): they are held to their own minor, against the 1.4 command
documents, trees and schemas answers of acme, which `scripts/check.ts` reads in whatever minor they are.

**Pairing.** A tool's tree is `schema-tree-<tool>.json`; it states the tool's `level` (spec 11.4) and the options its commands
share. A command's document is
`schema-command-<tool>-<command words joined by ->.json`, and the JSON Schemas its refs name are in
`schema-schemas-<tool>-<command words joined by ->.json` (`schema <PATH> --schemas --json`, spec 9.9.3): exactly the
schemas the refs reach, directly and through `#/schemas/<Name>`, the derived fragment schema of `--input` as `Input` when
the command has `input`, and `rejects`, one list per validator in the command document's order (the invocations a
validator refuses, no longer in the command document). Refs resolve there; the report and stream examples of a 1.4 tool
are validated against that answer, and so are the `rejects` (Annex S2 rule 13). The checker derives the fragment schema
from the command's full option set (the implied reserved options, the tree and reserved options it names and its own,
defaults applied; `deriveFragment` in `scripts/check.ts`, spec 9.9.2), requires `Input` to equal it, and runs every rule
of Annex S2 against that set. A command that names a reserved option (`"dry-run"` in `acme page label`) needs no tree
entry: its shape is fixed (Annex S2 rule 8). acme is L1 and has no destructive command, so nothing here lists `commit`
or `plan-digest`; a 1.4 document lists them whenever the command offers them (spec 9.5).

| Case | File | Result |
|---|---|---|
| the tree defines `team` once (`short`, `required`, help; no `path`, no `kind` on commands, `options`); the commands that share it name it, `"options":["team"]`; the one whose help differs declares its own | `schema-tree-acme.json`; `schema-command-acme-member-export.json`, `schema-command-acme-member-roster.json`; `schema-command-acme-member-list.json` | accepted |
| a command document without `path`, `schemas`, `input.option`, `input.schemaRef`, the implied `--json`, `--input`, `--fields`, and the implied codes (`USAGE`, `INTERNAL`, `INPUT_*`, `BATCH_INCOMPLETE`, `OPERATION_REUSED`, `CURSOR_INVALID`), and with every default left out | every `schema-command-acme-*.json` | accepted |
| the schemas answer of each command; a ref resolved there; a report and a stream validated against it | `schema-schemas-acme-*.json`; `report-acme-*.json`, `stream-acme-*.ndjson` | accepted |
| `--input` examples and documents against the derived fragment, a batch among them | `input-acme-*.json` and the `input.example` of every acme command with input | accepted |
| a pretty-printed 1.4 document; a stream line with whitespace | `invalid/schema-command-acme-member-show-not-compact.json`, `invalid/stream-acme-build-not-compact.ndjson` | rejected (spec 5.1) |
| a member at its default: `"required":false`; `"repeatable":true` on a count; `"kind":"command"` on a tree entry | `invalid/schema-command-acme-member-tag-option-required-false.json`, `invalid/schema-command-acme-build-count-repeatable.json`, `invalid/schema-tree-acme-entry-kind-command.json` | rejected (Annex S2 rule 17) |
| a member only 1.0-1.3 carry: `schemas` or `path` in a command document, `path` on a tree entry | `invalid/schema-command-acme-member-show-embeds-schemas.json`, `invalid/schema-command-acme-member-show-has-path.json`, `invalid/schema-tree-acme-entry-path.json` | rejected (Annex S2 rule 16) |
| an implied option listed, as an object or as a name (`json`); an implied code listed (`USAGE`) | `invalid/schema-command-acme-member-show-lists-json.json`, `invalid/schema-command-acme-member-show-names-json.json`, `invalid/schema-command-acme-member-show-lists-usage.json` | rejected (spec 9.5, Annex S2 rule 4) |
| a reserved option named, not listed in full (`"dry-run"`, its shape fixed), and its `dryRun` key in the derived `Input` | `schema-command-acme-page-label.json`, `schema-schemas-acme-page-label.json` | accepted |
| an option name that is neither a tree option nor a reserved one (`region`); an option given as a name and in full; a tree option no command names | `invalid/schema-command-acme-member-show-unknown-option-name.json`, `invalid/schema-command-acme-member-roster-option-twice.json`, `invalid/schema-tree-acme-option-unused.json` | rejected (Annex S2 rule 17) |
| an `input.example` with a key the derived fragment does not allow | `invalid/schema-command-acme-member-tag-input-example-unknown-key.json` | rejected (spec 9.9.2, Annex S2 rule 7) |
| a schemas answer missing a schema a ref reaches (`Owner`, through `MemberRow`); one holding a schema no ref reaches | `invalid/schema-schemas-acme-member-show-missing-schema.json`, `invalid/schema-schemas-acme-member-show-extra-schema.json` | rejected (spec 9.9.3, Annex S2 rule 2) |
| a 1.4 command document whose validator still carries `rejects` | `invalid/schema-command-acme-member-tag-validator-rejects.json` | rejected (spec 9.8.2, Annex S2 rule 16) |
| a schemas answer without `Input` for a command with `input`; one whose `Input` differs from the derived fragment schema | `invalid/schema-schemas-acme-member-tag-without-input.json`, `invalid/schema-schemas-acme-member-tag-input-differs.json` | rejected (spec 9.9.2, 9.9.3, Annex S2 rule 2) |
| a schemas answer without the `rejects` of a command's validator; one whose `rejects` line is also an example | `invalid/schema-schemas-acme-member-tag-without-rejects.json`, `invalid/schema-schemas-acme-member-tag-rejects-is-example.json` | rejected (spec 9.9.3, Annex S2 rules 2 and 13) |
| a schemas answer, or an option name, in a document that declares 1.3 | `invalid/schema-schemas-acme-member-show-in-1-3.json`, `invalid/schema-command-acme-member-roster-1-3-option-name.json` | rejected (Annex S2 rule 16) |
| a 1.3 command document without `path`, or in the 1.4 form (an operand with its defaults left out) | `invalid/schema-command-acme-member-show-1-3-no-path.json`, `invalid/schema-command-acme-member-show-1-3-operand-defaults-left-out.json` | rejected: the schema no longer requires them, the checker does (spec 15.7) |

The caller table of spec 15.4 reads an absent member as its default in a 1.4 self-description: a tree entry without
`kind` is a command, an argument without `valueType` a string. The caller examples are therefore stated at 1.5, a minor
later than the one this repository describes, and a caller of this minor reads them open (spec 15.6). Those that
carry a command document or a tree are written in the 1.4 form too (compact, no `path`, no embedded `schemas`, no
implied options or codes, no member at its default), because that is the form a later minor prints; only
`caller-schema-command-acme-unknown-input-option.json` keeps the 1.3 form, since its purpose is an `input.option` value
and a 1.4 document has no `input.option`.

## Plan digests

`plan-digest/*.json` are test vectors for the digest form spec 11.6 recommends: `sha256:` followed by the lower-case
hex SHA-256 of the plan's RFC 8785 (JCS) canonical JSON, as UTF-8. Each file has a `description`, the `plan` as a
tool might build it (written with the spellings under test, so read the file as JSON, not as text), the expected
`canonical` text and the expected `digest`. A tool that follows the recommendation canonicalizes `plan` and must get
both. The plans are shaped `{effects, inputs}` for illustration; the digest covers whatever plan document a tool
builds, and a tool that computes its digest another way (11.6 is a SHOULD) is not bound by them.

What goes into a plan is the tool's choice, within what JCS can canonicalize the same everywhere. An integer beyond
±(2^53-1) is written as a string, as Annex V3 makes it for argument values (an identifier that can exceed the
range is a `string`): as a JSON number it would be rounded by some parsers, and its digest would depend on the
implementation, so no vector holds one. A plan holds only valid Unicode, as I-JSON requires: a value that may not be
(a file name that is not UTF-8, which can decode to a lone surrogate) is escaped or encoded by the tool before it
enters the plan, since RFC 8785 refuses a lone surrogate; no vector holds one either.

| File | What it pins |
|---|---|
| `empty-effects.json` | Empty array and empty object. |
| `key-order.json` | Keys sorted at every depth; array order kept. |
| `key-order-utf16.json` | Keys sorted by UTF-16 code units, not code points (RFC 8785 section 3.2.3's keys). |
| `numbers-integral.json` | `1.0`, `1e0`, `1e2`, `100.000`, negative zero and the safe-integer bounds. |
| `numbers-other.json` | Fractions, exponent forms from `1e21` up and below `1e-6`, the largest and smallest doubles. |
| `strings.json` | Escapes: only `"`, `\` and controls below U+0020; non-ASCII, DEL, U+2028 and surrogate pairs as UTF-8; RFC 8785 section 3.2.2's string. |
| `nested.json` | Nested arrays and objects, empty containers, literals. |
| `preview.json` | A plan shaped like a destructive preview's: deletes, an audit append, arguments and digests of the files read. |
| `large-integers-as-strings.json` | Integers beyond ±(2^53-1) written as strings, next to one within the range written as a number. |

The expected values were computed with two independent RFC 8785 implementations, the `canonicalize` npm package
(5.1.0) and a separate implementation in Python, each first checked against RFC 8785's own examples (Appendix B and
sections 3.2.2 and 3.2.3); both agree on every vector. `scripts/plan-digest.ts`, run by `scripts/validate.sh`,
recomputes them with a third, self-contained canonicalizer, which it checks against Appendix B first.
