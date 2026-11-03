# ATIP: Agent Terminal Invocation Protocol (`atip/1`)

A protocol for command-line tools whose main callers are coding agents: how output is selected, the JSON envelope,
errors and their registry, exit codes, the command grammar and argv syntax, the `schema` self-description, whole-command
JSON input, preview/commit for destructive commands, long-running work and streams, and the guide shipped in the binary.
It is written for tools built with Rust/clap and with TypeScript/Effect 4, but nothing in it depends on either.
Conformance is defined by the spec alone: a tool is "ATIP 1.4 L1 conformant" (contract minor, then level L0, L1 or L2)
for a release when it follows the rules of that minor at that level (spec 3). The checker, `atip check`
(`approaches/checker.md`), is a tool that tests a built binary against the spec; what it finds is evidence for or
against a claim, not the definition of one (spec 3.7).

**Status: 1.4.1** (2026-11-04). 1.0.0 was adopted 2026-10-30 after six rounds of independent review; 1.1.0 (2026-11-01),
after four more, adds optional members and SHOULD/MAY rules from implementer feedback; 1.1.1 and 1.1.2 (2026-11-01) are
patches that clarify wording and checks. 1.2.0 (2026-11-02) is a minor whose new rules bind only a tool that declares
1.2: which arguments bind a paging cursor, `--fields` without `--json`, flag-only paging and selection options, the
order of the stateless checks, and the reserved code `STOPPED_MIDWAY`; 1.2.1 (2026-11-02) is a patch that adds plan
digest test vectors and approaches notes. 1.3.0 (2026-11-03), after two rounds of review and three implementer reviews,
restates the contract as a protocol, organised around the exchanges between caller and tool; adds the code-name
convention (`<SUBJECT>_<CONDITION>`, where the condition fixes the exit and the default retryability) with fifteen
conditions and twelve core codes; keeps warning codes in the warning registry; and moves the rules that only a checker
needs to `approaches/implementation.md`. It adds no member, document kind or enum value, and changes no schema shape.
1.3.1 (2026-11-03), after one round of review, is a patch that aligns the checker's description with the reference
checker and says what the caller of an `INVALID` without `field` changes. 1.4.0 (2026-11-04), after two rounds of
review, makes the self-description small and compact for agents: a command document is the call surface without JSON
Schemas (`schema <PATH> --schemas` returns them), shared options are defined once in the tree, implied options and codes
and default-valued members are left out (`--commit` and `--plan-digest` stay listed), every JSON document is compact,
and `--help` stays text while `--help --json` refuses and points at `schema`; the `--schemas` answer also carries the
derived input schema and the validators' counterexamples; its rules bind only documents that declare 1.4. 1.4.1
(2026-11-04), after one round of review, is a patch: compactness forbids only whitespace outside strings. The decisions
behind all of the versions are in Appendix A of the spec; no question is open. `CHANGELOG.md` lists the versions; spec
15 says how versions work, 15.7 lists what differs in the earlier minors, and 15.8 says what 1.4 means for callers.
Until its second revision the contract was called `agent-cli/1`.

**Names.** Contract id `atip/1` (`meta.contract`); schema `$id`s under `https://atip.dev/1/` (placeholders); the
checker command `atip check`; the TypeScript package `@journeykit/atip` and the Rust crate `atip`. OpenCLI is out of
scope (spec 1.4).

## Layout

| Path | What |
|---|---|
| `spec/atip-1.md` | The normative specification, written as a protocol document (BCP 14 keywords, conformance levels L0/L1/L2); its annexes are normative where it refers to them. |
| `spec/annex-fields.md` | Annex F, normative: field selection and projection (paths, records, map keys, projection, the projected schema, outputs of several shapes). |
| `spec/annex-domains.md` | Annex V, normative: argument domains (the keyword profile), the pattern dialect and numbers. |
| `spec/annex-schema.md` | Annex S, normative: command design and the self-description rules. |
| `schema/` | JSON Schemas, draft 2020-12, normative for wire shapes. `$id`s under `https://atip.dev/1/` are placeholders. |
| `schema/envelope.schema.json` | Success and failure envelope, `meta` (incl. `output`, `page`, `fields`, `truncated`). |
| `schema/error.schema.json` | The `error` object. |
| `schema/registry-entry.schema.json` | One error registry row, with its reasons (since 1.1). |
| `schema/warning-entry.schema.json` | One warning registry row (since 1.1). |
| `schema/schema-doc.schema.json` | A `<tool> schema --json` answer: `tree`, `group`, `command`, `errors`, `error`, and since 1.1 `warnings`, `warning`. |
| `schema/input-document.schema.json` | The generic fragment shape of an `--input` document or batch. |
| `schema/batch-report.schema.json` | The shape every batch output's `data` has, whatever the command's own batch schema says. |
| `schema/stream-line.schema.json` | One line of a stream command's NDJSON protocol. |
| `schema/guide.schema.json` | The JSON data of `skills show --json`. |
| `examples/` | Documents that must pass (canon's and the synthetic `ledger`'s as 1.0 tools, `tally`'s as a 1.1 tool, acme's as a 1.4 tool, stored compact, with one `--schemas` answer per command): canon `finding close`, `finding list`, `purge` and `skills show` command documents translated from canon; a synthetic reference tool `acme` (`member list`, `member show`, `member tag`, `member roster`, `member export`, `page label`, `deploy start`, `deploy status`, `filter test`, `lint`, `build`) for what the translations do not exercise; tree, search, group, error and warning registries with reasons, one entry; reports (success, failures, input error, preview, stale plan, three batch cases, projected pages, guide); `--input` documents; streams. `examples/README.md` says where every translated field comes from and which are proposed or unverified. |
| `examples/caller-*.json` | Documents of a later minor, with members this one does not define, that a caller must read: they pass the schemas read open and fail them closed (spec 15.4, 15.6). |
| `examples/plan-digest/` | Plan digest test vectors (spec 11.6): a plan document, its RFC 8785 canonical text and its `sha256:` digest, for number forms, string escapes, key order and nesting. |
| `examples/invalid/` | Documents that must be rejected, one broken rule each (shape, every rule of Annex S2, projection, domains, patterns, validators, batch, stream, input). |
| `scripts/validate.sh` | Runs `scripts/check.ts`: every example against its JSON Schema and the rules beyond JSON Schema (Annex S2, 6.x, 7.4, 10.x, 13), report and stream data against the output and event schemas of the example command documents, the spec's section cross-references, and the ECMAScript side of `scripts/regex-cases.json`; then `scripts/plan-digest.ts`, which recomputes the plan digest test vectors. With cargo it also runs `scripts/regex-parity`, which checks the Rust side of that record. |
| `scripts/regex-cases.json` | Patterns and values with the answers of ECMAScript (`u`) and the Rust `regex` crate: the evidence that the pattern form of Annex V2 reads the same in both. |
| `crates/atip/` | The Rust crate `atip`: what a clap tool shares to speak the contract (projection of a clap tree onto the `schema` documents, the error value and its redaction, field projection, domains and constraints, cursors, plan digests, the envelope line, validators for the schemas). It embeds `schema/*.json` from this repository, so the schemas have one copy. |
| `crates/atip-check/` | The Rust crate `atip-check`: the checker, `atip check`, and its test subject, a fake tool whose behaviour is a JSON configuration (`fake-tool/`). Tags `atip-crate-v0.x.y` and `atip-check-v0.x.y` version the two crates independently of the spec; `atip::CONTRACT_VERSION` is the spec minor a crate release supports. |
| `Cargo.toml`, `rust-toolchain.toml`, `clippy.toml` | The Cargo workspace (`crates/atip`, `crates/atip-check`, `scripts/regex-parity`; one `Cargo.lock`), its lint set, the pinned toolchain and the clippy configuration. |
| `justfile`, `.github/workflows/ci.yml` | Contributor recipes and the CI job that runs the same steps. |
| `approaches/` | Not normative. `rust.md` (clap → spec, the shared crate, constraints, `--input` in Rust, canon and lute), `typescript.md` (spec-first `defineCommand` for Effect 4, fragment schemas and numeric codecs, an `effect/cli` interim), `checker.md` (the black-box conformance checker: strengths, coverage, fixtures, tool-owned obligations; a tool that tests the spec, not its definition), `migration.md` (adopting ATIP level by level, canon and lute as worked examples, and the costs the contract does not soften). |
| `approaches/implementation.md` | Not normative. Recommendations beyond the protocol: the order of the stateless checks, which argument a constraint violation names, cursor binding details and the next-page entry, converting an `--input` document to argv, why each pattern restriction and the cross-engine record, the text-mode error form, and naming error codes in practice. Rules a tool that declares 1.2 must still follow, and that 1.3 recommends. |
| `CHANGELOG.md` | What each version of the contract is. |
| `LICENSE` | MIT. |

## Validate

Needs `bun`. ajv is installed into a scratch directory under `TMPDIR`, never into the repository. With `cargo`, the
Rust regex check is built through the Cargo workspace (build output where `CARGO_TARGET_DIR` points, crates from the
root `Cargo.lock`); without it, that half is reported as skipped.

```sh
export TMPDIR=<a scratch directory>
scripts/validate.sh
```

It prints one line per document (with the reason an invalid one was rejected) and exits non-zero if a valid
document fails, an invalid one is accepted, the spec cites a section that does not exist, or a recorded regex
answer differs from what an engine does.

The ECMAScript half of `scripts/regex-cases.json` is recorded with Bun 1.4.4 (Unicode 17.0). A runtime with another
Unicode version fails with "record the cases again"; re-run the cases through both engines and update the record.

## Contributing to the Rust crates

Needs the toolchain `rust-toolchain.toml` pins (rustup installs it on the first `cargo` call), [just](https://just.systems)
and, for `validate`, `bun`. Builds honour `CARGO_TARGET_DIR`; point it and `TMPDIR` at a scratch volume if the
checkout's disk is not where build output belongs.

```sh
just            # list the recipes
just build      # cargo build --workspace
just test       # cargo test --workspace
just lint       # cargo clippy --workspace --all-targets -D warnings, and scripts/check_visibility.sh
just fmt        # cargo fmt (just fmt-check fails instead of rewriting)
just validate   # scripts/validate.sh: examples, schemas, spec references, plan digest vectors, regex parity
just check      # the checker, `atip check` at L0, on its own fake tool
just ci         # everything .github/workflows/ci.yml runs
```

The lints are `[workspace.lints]` in the root `Cargo.toml`; every crate has `[lints] workspace = true`. Lint levels are set
there and in CI, never in code: a suppression is `#[expect(lint, reason = "...")]`. Crate sources do not use `pub(super)`
or `pub(in ..)` (`scripts/check_visibility.sh`). The schemas in `schema/` are the only copy: the crates read them with
`include_str!`, so a schema edit is one change here and the crates' tests run against it.

## Related

ATIP was written for [canon](https://github.com/journeyWorker/canon) (npm `@journeykit/canon`) and
[lute](https://github.com/journeyWorker/lute), both Rust and clap; canon is the source of the translated examples
and the reference implementation (`approaches/migration.md`).

## License

MIT; see `LICENSE`.
