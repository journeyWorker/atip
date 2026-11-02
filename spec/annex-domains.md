# Annex V: argument domains and numbers (`atip/1`, 1.3.0)

Normative where `spec/atip-1.md` 9.7.4 and 9.7.5 refer to it. A `domain` (spec 9.7.1) states every restriction of an
argument's own value, beyond its valueType, that the command enforces without reading state. It is a subset of JSON
Schema draft 2020-12 that clap-based and Effect-based tools can turn into parser checks and back and that a caller
can check locally. Why each restriction exists, and the cross-engine evidence: `approaches/implementation.md` §5,
`scripts/regex-cases.json`. [Appendix A D17, D18]

## V1. Keywords

| valueType | Keywords |
|---|---|
| `integer`, `number`, `count` | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (positive) |
| `string`, `path` | `minLength`, `maxLength`, `pattern` |
| `json` | the keywords of both rows above, and `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`; inside `properties`, `items` and `additionalProperties` the same profile applies again; `enum` and `const` take scalar values only |
| `switch`, `enum` | none |

Besides these, a domain MAY carry the annotations `title`, `description`, `$comment` and `format`. No other keyword is
allowed (no `$ref`, `anyOf`, `oneOf`, `allOf`, `not`, `if`). The check is structural: a `properties` member *named*
`$ref` is allowed. `format` asserts nothing; a command that refuses values not in a format declares a validator. A
stateless check outside this profile is a validator (spec 9.8.2), never a precondition.

## V2. Patterns

A `pattern` is `^`, a body, then `$`. The body is an I-Regexp (RFC 9485) with no `|` outside parentheses (write
`^(core|lead)$`), no `.`, no `^` or `$` outside a character class, no `\-` outside a class, and no `&&` or `~~`
inside a class. A value satisfies it when the body matches the whole value. The pattern MUST compile with the Rust
`regex` crate's default limits (compiled size 10 MiB, nesting depth 250); a length limit is written as `maxLength`.

Under these restrictions ECMAScript with the `u` flag (as JSON Schema validators read it) and the Rust `regex` crate
accept the same values, up to the Unicode version of each engine's `\p{…}` tables. A caller does not assume that its
own engine proves a tool accepts a recently assigned character.

## V3. Numbers

`integer` and `count` values, integer defaults and the numeric keywords of an integer or count domain lie within
±(2^53-1), where a JSON parser, JavaScript and a Rust `i64` agree. A value outside it, on argv or in a document, is
invalid (`USAGE` or the command's code for that argument on argv, `INPUT_INVALID` in a document) and is never rounded
into range; an identifier that can exceed it is a `string` with a `pattern`.

`number` values, defaults and domain bounds are finite binary64 values; a numeric string denotes the nearest binary64
value, and a number too large for binary64 is invalid. Numbers inside a `json` value are not normalised: they follow
I-JSON (RFC 7493 §2.2), and a tool MAY refuse an integer beyond ±(2^53-1) or a number beyond binary64 inside one.
