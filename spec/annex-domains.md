# Annex V: argument domains and numbers (`atip/1`, 1.5.0)

Normative where `spec/atip-1.md` 9.7.4 and 9.7.5 refer to it. A `domain` (spec 9.7.1) states every restriction of an
argument's own value, beyond its valueType, that the command enforces without reading state. It is a subset of JSON
Schema draft 2020-12 that clap-based and Effect-based tools can turn into parser checks and back and that a caller
can check locally. Why each restriction exists, and the cross-engine evidence: `approaches/implementation.md` §5,
`scripts/regex-cases.json`. [Appendix A D17, D18, D41]

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
inside a class. In a document that declares 1.5 or later the body MAY also use `\p{White_Space}` and
`\P{White_Space}`, outside and inside a class: a code point that has, or does not have, the Unicode binary property
`White_Space`. A value satisfies the pattern when the body matches the whole value. The pattern MUST compile with the
Rust `regex` crate's default limits (compiled size 10 MiB, nesting depth 250); a length limit is written as
`maxLength`.

`White_Space` is the one addition to I-Regexp, whose `\p{…}` names only general categories. White space is not a set
of general categories (it takes code points from Zs, Zl, Zp and Cc), and the shorthand that means it in one engine
means something else in another: Rust's `\s` is `White_Space`, while ECMAScript's adds U+FEFF and leaves out U+0085.
Rust `regex` and ECMAScript with the `u` flag both read the name `White_Space`, so a caller hands the pattern to its
engine unchanged. Only this spelling is in the profile, not an alias (`WSpace`, `space`) or a loosely matched name.
`\s`, `\S` and the other multi-character escapes stay outside it: a JSON Schema validator would read them with its own
engine's meaning, without any sign that the meaning differs. A document that declares 1.0 to 1.4 keeps the profile
without `White_Space`; a caller of 1.4 that checks the profile may refuse the escape or skip that check (spec 15.4,
15.9), and a caller of any minor skips the check of a pattern outside its own profile while the tool still enforces it.

The common intent "one non-empty line with no leading or trailing white space" is, in JSON,
`"pattern": "^\\P{White_Space}([\\P{White_Space}\\p{Zs}\\t]*\\P{White_Space})?$"`. The first and the last character
are not white space; each character between them is not white space, or is a space separator (Zs) or a tab.
`White_Space` is Zs, the tab, and the line terminators LF, VT, FF, CR, U+0085, U+2028 and U+2029 (the mandatory line
breaks of UAX #14), so the class admits every character except those seven. U+FEFF is not white space and may stand
at either end. A length bound is added as `maxLength`.

Under these restrictions ECMAScript with the `u` flag (as JSON Schema validators read it) and the Rust `regex` crate
accept the same values, up to the Unicode version of each engine's `\p{…}` tables (its general categories and its
`White_Space`). A caller does not assume that its own engine proves a tool accepts a recently assigned character.

## V3. Numbers

`integer` and `count` values, integer defaults and the numeric keywords of an integer or count domain lie within
±(2^53-1), where a JSON parser, JavaScript and a Rust `i64` agree. A value outside it, on argv or in a document, is
invalid (`USAGE` or the command's code for that argument on argv, `INPUT_INVALID` in a document) and is never rounded
into range; an identifier that can exceed it is a `string` with a `pattern`.

`number` values, defaults and domain bounds are finite binary64 values; a numeric string denotes the nearest binary64
value, and a number too large for binary64 is invalid. Numbers inside a `json` value are not normalised: they follow
I-JSON (RFC 7493 §2.2), and a tool MAY refuse an integer beyond ±(2^53-1) or a number beyond binary64 inside one.
