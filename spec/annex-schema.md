# Annex S: command design and self-description rules (`atip/1`, 1.4.0)

Normative at L1, where `spec/atip-1.md` 4.6 and 9 refer to it. S1 constrains the command surface a tool exposes;
S2 lists the rules every `schema` answer satisfies beyond `schema/schema-doc.schema.json`.

## S1. Command design

1. Actions are verbs; read-only views MAY be nouns with effect `read`. No option changes a command's effect class or
   makes it another action with its own arguments; such a mode is its own command. Output selection, views of the
   same data (`--fields`, paging), waiting, preview and commit, and a declared output variant are not modes.
   [Appendix A D4]
2. The one kind of object a command acts on or shows is its operand (variadic for several; two in a meaningful order
   are allowed). Context (repository, project, run) is never an operand; values that modify the object are options.
3. Other identifiers are bare-noun options (`--change`, `--run`); no option name ends in `-id`.
4. Within a tool an option name has one value name, value type and meaning on every command; only `required`, the
   default and a subset of a shared enum may differ.
5. Options are lower kebab-case long names. A tool SHOULD NOT add short options other than `-h` and `-V`, and declares
   every short option it has (spec 9.7.1). Prefix abbreviation of options or commands MUST NOT be accepted.
   [Appendix A D11.18]
6. An unknown command, option or enum value refuses before any effect, with `expected` and `suggestions`; nothing is
   auto-corrected. An option a command cannot honour with the others refuses by name rather than being ignored.
7. A renamed or removed command or option is not kept as an alias; a removed spelling MAY be recognised only to
   refuse it (`UNKNOWN_COMMAND` or `USAGE`) with the replacement as `hint`. [Appendix A D4]
8. Times are RFC 3339 (a bare `YYYY-MM-DD` MAY mean UTC midnight). A `<DURATION>` is one or more `<integer><unit>`
   pairs, units `ms`, `s`, `m`, `h`, `d` in decreasing order (`90s`, `1h30m`); a bare integer means seconds. Paths
   are relative to the working directory, on argv and inside `--input`.
9. A tool-wide option (one every command accepts with one meaning: `--json`, a context option such as `--repo`)
   SHOULD be accepted wherever `--json` is, after a group word as well, where it does nothing, so that
   `<tool> <group> --repo . --json` is answered with `COMMAND_REQUIRED` rather than `USAGE`. [Appendix A D25]

## S2. Self-description rules

Every `schema` answer satisfies the rules below. A command's arguments are its operands and its full option set: in a
1.4 document its own options, the tree and reserved options it names and the reserved options it implies (spec 9.5).

1. A group's children extend its `command` by one word; before 1.4, `command` also equals `path` joined by one space.
2. Every `schemaRef`, `eventRef`, `input.schemaRef` and `input.argumentsRef` names a member of `schemas` (by
   membership: `false` is a valid schema): in a 1.4 document the schemas answer's, which holds exactly the schemas the
   refs reach, the derived `Input` when the command has `input`, and one `rejects` list per validator (spec 9.9.3);
   before 1.4 the command document's. Every member compiles under draft 2020-12; no two
   outputs share a `schemaRef`.
3. Defaults, `in` values and domains are valid: an `enum` default is in `possibleValues`; an `in` value is a valid,
   normalised value of its argument within its `domain`, never on a switch or a count; a `domain` keeps to its
   valueType's profile and bounds (Annex V) and holds for the non-null default.
4. Every name and `code` of a constraint resolves (`code` in `errors` or implied); no relation is stated twice; a
   command lists the core code of each feature it offers (spec 7.3.1), except in a 1.4 document, which lists neither
   an implied code nor an implied option (spec 9.5).
5. A command has an output with `batch: true` exactly when `input.batch` is `true`; `idempotency` is present exactly
   for `write` and `destructive`; `input` is present exactly when the command accepts `--input`.
6. Outputs are told apart pairwise by `when` or `batch`; at most one has neither.
7. `input.example` satisfies the fragment schema, `required`, the domains, `constraints` and `validators`, and its
   argument object (spec 10.7 step 6) validates against `argumentsRef` when present.
8. A listed reserved option (spec 4.5) has its shape (`json`, `commit`, `all` switches; `input`, `plan-digest`,
   `cursor`, `fields`, `operation` strings; `limit` an integer), and a flag-only one `flagOnly: true`.
9. Option names, operand names and short letters are unique within a command, and no operand has an option's name.
10. Before 1.4, the declared fragment schema has no root `required`, has `additionalProperties: false`, and its
    properties are `operands` and the camelCase names of the options that are not flag-only; in 1.4 it is derived
    (spec 9.9.2).
11. An output's `fields` is consistent: its cut nodes are projectable (Annex F5); `records` is `""` or leads through
    declared object members; `default` ⊆ `paths`; `keep` and `paths` are disjoint; every path names a declared member
    and goes through arrays only with `[]`.
12. Every example parses by spec 4.2 against the command's arguments, with typed values in their domains, and
    satisfies `required`, `constraints` and `argumentsRef`; an inline `--input` word is framed, validated and merged
    as spec 10.7 says.
13. A validator names arguments of the command; its `code` is in `errors` (or implied) with exit 2; each `rejects`
    invocation (in a 1.4 document, from the schemas answer) satisfies `required`, `constraints` and the domains, and
    is not in `examples`.
14. In an `errors` answer a code appears once, a core code has its exit and retryability (spec 7.3.1), a reason
    appears once within its code, and in a document that declares 1.3 or later every code follows spec 7.2.3; in a
    `warnings` answer a code appears once.
15. A field path writes a member in brackets exactly when its name is not an identifier; a map-key path extends a
    declared map path by one key (Annex F1, F3).
16. A document carries only what its declared minor defines (spec 15.5).
17. In a 1.4 document no member has its default value (spec 9.5); every option name in a command's `options` names
    a tree option or a reserved one that the document does not imply, every tree option is named by at least one
    command, and a name and an object never give the same
    option twice.
