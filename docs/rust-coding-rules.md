# Rust coding rules

The decisions this workspace (`crates/atip`, `crates/atip-check`, `crates/atip-probe`, `scripts/regex-parity`) takes on
the always-rules of the house Rust guide, and what each one is enforced by. A rule is cited by its id (`LINT-1`,
`PANIC-2`, …). Measured on Rust 1.100.0 with `cargo clippy --workspace --all-targets`.

## Toolchain (LINT-5)

One release everywhere: `rust-toolchain.toml` `channel = "1.100.0"`, `rust-version = "1.100.0"` in `[workspace.package]`
(every crate inherits it), and every CI job installs that file's toolchain through `.github/actions/setup-rust`, which
fails a job whose `rustc --version` differs. The two published crates (`atip`, `atip-check`) declare the same
`rust-version`: one toolchain, no separate MSRV job. A tool that depends on `atip` needs Rust 1.100 or later from the
release that carries this note. The code uses `Option::map_or_default` (1.100), so the floor is real. Moving the pin is
one pull request that moves `channel` and `rust-version` together and re-checks the lint lists below in that same pull
request.

## Lints (LINT-1, LINT-2, LINT-4)

Levels live once in the root `Cargo.toml` (`[workspace.lints.rust]`, `[workspace.lints.clippy]`), every crate sets
`[lints] workspace = true`, and CI runs `cargo clippy --workspace --all-targets --locked -- -D warnings` and
`cargo clippy -p atip --lib --locked -- -D warnings` (the `atip` library without its `validate` feature, the build a tool
that only describes itself links). Code carries no `#![deny]`; a local exception is `#[expect(lint, reason = "…")]` on the
narrowest item, enforced by `allow_attributes` and `allow_attributes_without_reason`. `#[allow]` stays only in generated
code and macros (none today).

The guide's starting point (`workspace-lints.toml`) against this code, and what is kept:

| Lint or group | Warnings | Decision |
|---|---|---|
| the rust lints and the restriction block (`allow_attributes`, `clone_on_ref_ptr`, `map_err_ignore`, `undocumented_unsafe_blocks`, …) | 0 | on (already) |
| pedantic, selected (`cast_*`, `map_unwrap_or`, `manual_let_else`, `uninlined_format_args`, …) | 0 on 1.99.1 | on (already); see the bump below |
| `unwrap_used` (PANIC-2) | 16, all in `#[cfg(test)]` modules | on, with `allow-unwrap-in-tests` |
| `redundant_clone` (nursery, performance) | 21 | on; fixed |
| `cargo` group | 2 | on; `multiple_crate_versions` allowed (cargo-deny's `bans` reports duplicates), `redundant_feature_names` allowed (the published feature `test-support` keeps its name) |
| the whole `pedantic` group | 277 `must_use_candidate`, 68 `too_many_lines`, 58 `missing_errors_doc`, … about 500 | off: the selected pedantic lints are on; the rest would be a sweep of documentation and attributes with no defect behind it |
| `too_long_first_doc_paragraph` (nursery) | 102 | off: the crates' doc comments open with one full paragraph on purpose |
| `expect_used` | 969 | off: `expect("why it cannot fail")` is how PANIC-1 says a panic is a bug |
| `panic` | 106 | off: the same, and almost all in tests and the fake tool |
| `print_stdout`, `exit` | 40, 10 | off: one printing site, `app::main`, held by `tests/grammar.rs` (SPEC-2); the fake tool is a test binary |
| `unsafe_code` | — | `deny`: each FFI block (`libc::signal`, `waitid`, `clonefile`) has `#[expect(unsafe_code, reason)]` and a `SAFETY:` comment |

The 1.99.1 → 1.100.0 bump added 65 warnings with no code change: `map_unwrap_or` now covers
`map(f).unwrap_or_default()` (64, rewritten as `map_or_default`), and `unused_must_use` now covers `ExitCode` (1, in the
fake tool's `serve`, now bound to a named `_serving`).

## clippy.toml (LINT-3, SIDE-1)

`disallowed-methods` forbids `Iterator::for_each` and `try_for_each` (side effects belong in a `for` loop), and
`allow-unwrap-in-tests` is the one test allowance, matching the one panic lint that is on. There is no crate-level
`clippy.toml`; one that is ever added repeats every entry of the root file.

## Panics and casts (PANIC-1, PANIC-2, PANIC-3)

A panic is a bug: library and binary code returns `Result`/`Option` and never calls `unwrap()` (the lint above). A panic
inside `atip check` is caught once at the entry and reported as `INTERNAL` (exit 1) with a way to report it; nothing
else catches a panic. The integration-test helpers under `crates/*/tests/support/` use `expect` with the reason.
Narrowing casts are `cast_possible_truncation`, `cast_possible_wrap` and `cast_sign_loss` warnings. The four left (in
`atip::judge`, `atip_check::l1::witness` and the fake tool's input) carry `#[expect(clippy::cast_…, reason)]` naming the
range that makes them exact; the other `as` casts widen (an enum's discriminant as an index, `usize` as `u64`) and pass
the lints. A count from the command line goes through `usize::try_from` (`--jobs`).

## Dependencies (DEP-1, DEP-2, DEP-3)

`deny.toml` holds the floor: RustSec advisories fail (none ignored), licenses from an allow list (`Apache-2.0`,
`BSD-3-Clause`, `MIT`, `Unicode-3.0`) plus one exception per crate (`borrow-or-share`: `MIT-0`; `foldhash`: `Zlib`; both
reached through `jsonschema`), wildcard versions denied (workspace path dependencies allowed), and only the crates.io
registry and no git sources. CI's `deny` job runs `cargo deny --locked check` with a pinned, checksum-verified
cargo-deny. `Cargo.lock` is committed, and every cargo call in CI, the release workflows, `justfile` and `scripts/`
passes `--locked`.

## Platform code (PLAT-1)

`atip check` runs on macOS and Linux. Everything specific to the operating system sits in one module per crate:
`crates/atip-check/src/platform.rs` (signal dispositions, process groups and `killpg`, `waitid` without reaping,
pseudo-terminals, `poll`, file times and permission bits, links, `clonefile(2)` on macOS) and
`crates/atip-check/fake-tool/platform.rs` for the test binary (raw terminal mode, ignoring or raising SIGTERM, the
`HOME` it writes to). The rest of the code is portable `std` without `cfg`. `crates/atip` and `scripts/regex-parity` have
no OS-specific code. Test code is exempt.
