# Annex F: field selection (`atip/1`, 1.3.0)

Normative where `spec/atip-1.md` 6.10 refers to it. It defines the field paths a command declares in
`outputs[].fields` (spec 9.9.1), how a selection projects `data`, and the schema the projected `data` validates
against. [Appendix A D11.5, D16.2, D23]

## F1. Paths

A field path is a dot path into a record (`profile.name`); `name[]` descends into each element of the array `name`
(`tags[]`, `owners[].email`). A path goes through an array only with `[]` (`owners.email` is not a path when `owners`
is an array); a last segment without `[]` may name a whole array.

A member whose name is not an identifier (`[A-Za-z_][A-Za-z0-9_]*`) is written as a bracketed string instead of
`.name`: `attributes["http.status-code"]`, `["x.y"].value`. Inside the quotes only `\"` and `\\` are escapes; every
other character except U+0000 stands for itself, and the quotes may enclose nothing (`attributes[""]`). A member
whose name is an identifier is always written with a dot, so each member has exactly one spelling and `meta.fields`
compares as text. In a `--fields` value, commas inside a bracketed key do not separate paths.

## F2. Records

The records are the values at `fields.records`, an RFC 6901 pointer into `data` (decoded as RFC 6901 says) through
object members only; `""` when `data` is the record. When the value there is an array, each element is a record.

## F3. Map keys

A declared path whose schema is a *map* (an object schema whose `additionalProperties` is a schema, `true` included,
and whose `properties` is absent or empty) also makes each of its keys selectable, one key deep, except a key that
contains U+0000: `attributes.region`, `attributes["http.status-code"]`. The map is the schema the declared path
names: `labels` declared as an array of maps selects keys through `labels[]` (`labels[].region`). A key the record
does not have is absent from the projection. The map's schema is a cut node (F5).

## F4. Projection

For each record:

1. The kept paths are the selected paths plus the declaration's `keep` paths.
2. A kept path *covers* a member when the member's path equals or extends it. A member is present exactly when a kept
   path covers it or when it is a proper ancestor of a kept path. A covered member is kept whole.
3. An ancestor that is not covered keeps only its members present by rule 2; an array on the way keeps every element,
   each projected the same way; a `null` ancestor stays `null`.
4. A present member appears whenever the unprojected record has it; a member that is not present is absent.
5. `meta.fields` lists the kept paths.
6. An unknown path refuses with `USAGE`, `field` `--fields`, `expected` the selectable paths.

## F5. The projected schema

The projected `data` validates against the output schema with one change: in every object cut node at or below the
record, `required` is reduced to the members present by F4 rule 2. Above the record nothing is removed.

The *cut nodes* of an output are the schemas from its root schema to every selectable field: the root; the schemas
`fields.records` goes through and the one it reaches; the record schema; every schema of a proper ancestor of a
declared path; a declared map. Each is reached through `$ref`, a null-admitting union and, for an array, `items`.

Every cut node MUST be **projectable**, so that a projection of a valid value is always valid:

- an object schema with `type` `"object"` (or `["object","null"]`), using only `properties`, `required`,
  `additionalProperties` and annotations (`title`, `description`, `default`, `examples`, `deprecated`, `readOnly`,
  `writeOnly`, `$comment`); or an array schema with `type` `"array"` (or with `"null"`), using only `items`,
  `minItems`, `maxItems` and annotations; never a boolean schema;
- or only a `$ref` to a schema in `schemas`, itself a cut node; or only an `anyOf` of exactly two branches, one of
  them `{"type": "null"}` and the other a cut node; each with annotations.

Every other schema (a leaf, a member kept whole, a member outside every declared path) is unrestricted.

## F6. Outputs of several shapes

Selection is declared per output: a command whose answer takes one of two shapes declares two report outputs, each
with its own `fields`, and `--fields` is read against the output the invocation selects. An output whose root or
record schema is a union other than the nullable form of F5 declares no `fields`. A batch input selects the batch
output (spec 10.11): `--fields` is read against that output's `fields`, as paths into the batch report, and refuses
with `USAGE` when it declares none.
