# Rust coding rules

The Rust rules of this workspace (`crates/atip`, `crates/atip-check`, `crates/atip-probe`, `scripts/regex-parity`): one
toolchain, lint levels in configuration, panics only for bugs, a checked dependency graph and OS-specific code in one
module per crate, with what enforces each. Measured on Rust 1.100.0 with `cargo clippy --workspace --all-targets`.

## Toolchain

One development toolchain: `rust-toolchain.toml` `channel = "1.100.0"`, `rust-version = "1.100.0"` in
`[workspace.package]`, and every CI job installs that file's toolchain through `.github/actions/setup-rust`, which fails a
job whose `rustc --version` differs. `atip-check` (a binary), `atip-probe` and `scripts/regex-parity` inherit that
`rust-version`. Moving the pin is one pull request that moves `channel` and the workspace `rust-version` together and
re-checks the lint lists below in that same pull request.

**The exception: the published library keeps its own floor.** A repository that publishes a library may give it a floor
below the development toolchain, and this one publishes `atip`, which tools (canon among them) link on toolchains of
their own. So `crates/atip/Cargo.toml` declares `rust-version = "1.99"`, below the development toolchain, and the
`msrv` CI job (`just msrv`) reads that value and, on that release, builds `-p atip` with its default features and with
`validate`, then runs its tests. The library uses no API newer than its floor: the `map(f).unwrap_or_default()` that
clippy 1.100 asks to write as `map_or_default` (1.100) stays, under `#[expect(clippy::map_unwrap_or, reason = "MSRV
1.99: map_or_default is 1.100")]` (`judge.rs`, `project::Relations::from_json`, two helpers of `tests/describe_acme.rs`).
Raising the floor is a deliberate change of its own, recorded in the changelog, never a side effect of moving the
development toolchain.

## Lints

Levels live once in the root `Cargo.toml` (`[workspace.lints.rust]`, `[workspace.lints.clippy]`), every crate sets
`[lints] workspace = true`, and CI runs `cargo clippy --workspace --all-targets --locked -- -D warnings` and
`cargo clippy -p atip --lib --locked -- -D warnings` (the `atip` library without its `validate` feature, the build a tool
that only describes itself links). Code carries no `#![deny]`; a local exception is `#[expect(lint, reason = "…")]` on the
narrowest item, enforced by `allow_attributes` and `allow_attributes_without_reason`. `#[allow]` stays only in generated
code and macros (none today).

One trade-off is accepted: the shared helpers of the integration tests (`crates/atip-check/tests/support/{mod,l1,l2}.rs`)
carry `#![expect(dead_code, reason)]`, since each test file includes them and uses a part. A test file that came to use
every helper would leave the expectation unfulfilled and fail clippy there; today none does, and the fix then is to move
that helper set into a module of its own, not to switch back to `#[allow]`.

A common starting lint set against this code, and what is kept:

| Lint or group | Warnings | Decision |
|---|---|---|
| the rust lints and the restriction block (`allow_attributes`, `clone_on_ref_ptr`, `map_err_ignore`, `undocumented_unsafe_blocks`, …) | 0 | on (already) |
| pedantic, selected (`cast_*`, `map_unwrap_or`, `manual_let_else`, `uninlined_format_args`, …) | 0 on 1.99.1 | on (already); see the bump below |
| `unwrap_used` | 16, all in `#[cfg(test)]` modules | on, with `allow-unwrap-in-tests`: no `unwrap()` outside tests |
| `redundant_clone` (nursery, performance) | 21 | on; fixed |
| `cargo` group | 2 | on; `multiple_crate_versions` allowed (cargo-deny's `bans` denies duplicates, with each known one listed and explained in `deny.toml`), `redundant_feature_names` allowed (the published feature `test-support` keeps its name) |
| the whole `pedantic` group | 277 `must_use_candidate`, 68 `too_many_lines`, 58 `missing_errors_doc`, … about 500 | off: the selected pedantic lints are on; the rest would be a sweep of documentation and attributes with no defect behind it |
| `too_long_first_doc_paragraph` (nursery) | 102 | off: the crates' doc comments open with one full paragraph on purpose |
| `expect_used` | 969 | off: `expect("why it cannot fail")` is how a deliberate panic says it is a bug |
| `panic` | 106 | off: the same, and almost all in tests and the fake tool |
| `print_stdout`, `exit` | 40, 10 | off: one printing site, `app::main`, held by `tests/grammar.rs`; the fake tool is a test binary |
| `unsafe_code` | — | `deny`: each FFI block (`libc::signal`, `waitid`, `clonefile`) has `#[expect(unsafe_code, reason)]` and a `SAFETY:` comment |

The 1.99.1 → 1.100.0 bump added 65 warnings with no code change: `map_unwrap_or` now covers
`map(f).unwrap_or_default()` (64: the 59 outside `atip` rewritten as `map_or_default`; the 5 in `atip`
kept, under `#[expect(clippy::map_unwrap_or, reason = "MSRV 1.99: …")]`, because of the library's floor above), and
`unused_must_use` now covers `ExitCode` (1, in the fake tool's `serve`, now bound to a named `_serving`).

## clippy.toml

`disallowed-methods` forbids `Iterator::for_each` and `try_for_each` (side effects belong in a `for` loop), and
`allow-unwrap-in-tests` is the one test allowance, matching the one panic lint that is on. There is no crate-level
`clippy.toml`; one that is ever added repeats every entry of the root file.

## Panics and casts

A panic is a bug: library and binary code returns `Result`/`Option` and never calls `unwrap()` (the lint above). A panic
inside `atip check` is caught once at the entry and reported as `INTERNAL` (exit 1) with a way to report it; nothing
else catches a panic. The integration-test helpers under `crates/*/tests/support/` use `expect` with the reason.
Narrowing casts are `cast_possible_truncation`, `cast_possible_wrap` and `cast_sign_loss` warnings. The four left (in
`atip::judge`, `atip_check::l1::witness` and the fake tool's input) carry `#[expect(clippy::cast_…, reason)]` naming the
range that makes them exact; the other `as` casts widen (an enum's discriminant as an index, `usize` as `u64`) and pass
the lints. A count from the command line goes through `usize::try_from` (`--jobs`).

## Dependencies

`deny.toml` holds the floor: RustSec advisories fail (none ignored), licenses from an allow list (`Apache-2.0`, `MIT`,
`Unicode-3.0`) plus one exception per crate (`borrow-or-share`: `MIT-0`; `foldhash`: `Zlib`; both reached through
`jsonschema`), a second version of a crate denied except the two listed with their reason (`getrandom` 0.3 and its
`r-efi` 5, which `jsonschema` 0.47 pulls in beside `tempfile`'s getrandom 0.4), wildcard versions denied (workspace path
dependencies allowed), and only the crates.io registry and no git sources. CI's `deny` job runs `cargo deny --locked
check` with a pinned, checksum-verified cargo-deny. `Cargo.lock` is committed, and every cargo call in CI, the release
workflows, `justfile` and `scripts/` passes `--locked`.

## Platform code

`atip check` runs on macOS and Linux. Everything specific to the operating system sits in one module per crate:
`crates/atip-check/src/platform.rs` (signal dispositions, process groups and `killpg`, `waitid` without reaping,
pseudo-terminals, `poll`, file times and permission bits, links, `clonefile(2)` on macOS) and
`crates/atip-check/fake-tool/platform.rs` for the test binary (raw terminal mode, ignoring or raising SIGTERM, the
`HOME` it writes to). The rest of the code is portable `std` without `cfg`. `crates/atip` and `scripts/regex-parity` have
no OS-specific code. Test code is exempt.
