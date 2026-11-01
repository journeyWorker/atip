# ATIP: Agent Terminal Invocation Protocol (`atip/1`)

A contract for command-line tools whose main callers are coding agents: how output is selected, the JSON
envelope, errors and their registry, exit codes, the command grammar and argv syntax, the `schema`
self-description, whole-command JSON input, preview/commit for destructive commands, long-running work and
streams, and the guide shipped in the binary. It is written for tools built with Rust/clap and with
TypeScript/Effect 4, but nothing in it depends on either, and it is checked against built binaries. A tool that
passes is "ATIP 1.1 L1 conformant" (contract minor, then level L0, L1 or L2) for a release.

**Status: 1.1.1, release candidate.** 1.0.0 was adopted 2026-10-30 after six rounds of independent review; 1.1.0
(2026-11-01), after four more, adds optional members and SHOULD/MAY rules from implementer feedback; 1.1.1 is a patch
that clarifies wording and checks and tightens the schema pattern of `meta.contractVersion` to exclude `"1.0"`, which
was never written. The decisions behind all three are in Appendix A of
the spec; no question is open. `CHANGELOG.md` lists the versions; spec 15 says how versions work, and 15.9 states
the one place where 1.1.0 changes what 1.0.0 promised callers. Until its second revision the contract was called `agent-cli/1`.

**Names.** Contract id `atip/1` (`meta.contract`); schema `$id`s under `https://atip.dev/1/` (placeholders); the
checker command `atip check`; the TypeScript package `@journeykit/atip` and the Rust crate `atip`. OpenCLI is out of
scope (spec 1.6).

## Layout

| Path | What |
|---|---|
| `spec/atip-1.md` | The normative specification (BCP 14 keywords, conformance levels L0/L1/L2). |
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
| `examples/` | Documents that must pass (canon's and the synthetic `ledger`'s as 1.0 tools, acme's as a 1.1 tool): canon `finding close`, `finding list`, `purge` and `skills show` command documents translated from canon; a synthetic reference tool `acme` (`member list`, `member show`, `member tag`, `member roster`, `member export`, `page label`, `deploy start`, `deploy status`, `filter test`, `lint`, `build`) for what the translations do not exercise; tree, search, group, error and warning registries with reasons, one entry; reports (success, failures, input error, preview, stale plan, three batch cases, projected pages, guide); `--input` documents; streams. `examples/README.md` says where every translated field comes from and which are proposed or unverified. |
| `examples/caller-*.json` | Documents of a later minor, with members this one does not define, that a caller must read: they pass the schemas read open and fail them closed (spec 15.6, 15.8). |
| `examples/invalid/` | Documents that must be rejected, one broken rule each (shape, every rule of spec 10.13, projection, domains, patterns, validators, batch, stream, input). |
| `scripts/validate.sh` | Runs `scripts/check.ts`: every example against its JSON Schema and the rules beyond JSON Schema (spec 10.13, 6.x, 7.3, 11.x, 13.5), report and stream data against the output and event schemas of the example command documents, the spec's section cross-references, and the ECMAScript side of `scripts/regex-cases.json`. With cargo it also runs `scripts/regex-parity`, which checks the Rust side of that record. |
| `scripts/regex-cases.json` | Patterns and values with the answers of ECMAScript (`u`) and the Rust `regex` crate: the evidence that the pattern form of spec 10.7.4 reads the same in both. |
| `approaches/` | Not normative. `rust.md` (clap → spec, the shared crate, constraints, `--input` in Rust, canon and lute), `typescript.md` (spec-first `defineCommand` for Effect 4, fragment schemas and numeric codecs, an `effect/cli` interim), `checker.md` (the black-box conformance checker: strengths, coverage, fixtures, tool-owned obligations), `migration.md` (adopting ATIP level by level, canon and lute as worked examples, and the costs the contract does not soften). |
| `CHANGELOG.md` | What each version of the contract is. |
| `LICENSE` | MIT. |

## Validate

Needs `bun`. ajv is installed into a scratch directory under `TMPDIR`, never into the repository. With `cargo`, the
Rust regex check is built under `TMPDIR` too, from the locked crates in `scripts/regex-parity/Cargo.lock`; without
it, that half is reported as skipped.

```sh
export TMPDIR=<a scratch directory>
scripts/validate.sh
```

It prints one line per document (with the reason an invalid one was rejected) and exits non-zero if a valid
document fails, an invalid one is accepted, the spec cites a section that does not exist, or a recorded regex
answer differs from what an engine does.

The ECMAScript half of `scripts/regex-cases.json` is recorded with Bun 1.4.4 (Unicode 17.0). A runtime with another
Unicode version fails with "record the cases again"; re-run the cases through both engines and update the record.

## Related

ATIP was written for [canon](https://github.com/journeyWorker/canon) (npm `@journeykit/canon`) and
[lute](https://github.com/journeyWorker/lute), both Rust and clap; canon is the source of the translated examples
and the reference implementation (`approaches/migration.md`).

## License

MIT; see `LICENSE`.
