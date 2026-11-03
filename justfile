# Contributor recipes. `ci` runs what .github/workflows/ci.yml runs, in the same order; CI itself does not call just.
# Builds honour CARGO_TARGET_DIR (default ./target). `validate` needs bun, and TMPDIR should point at a scratch volume.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Cargo's build output directory.
target := env("CARGO_TARGET_DIR", "target")

# List the recipes.
default:
    @just --list

# Build the shared crate, the checker (`atip`) and regex-parity.
build:
    cargo build --workspace --locked

# The tests of the whole workspace: the `atip` crate and the checker with its fake tool. The checker's family tests plant one
# representative seeded violation per check.
test:
    cargo test --workspace --locked

# The checker's tests with every seeded violation planted, not one per check: slow (an hour of CPU); run it after a change to
# a check's conditions or to the fake tool, and before a release.
test-all-seeds:
    ATIP_CHECK_ALL_SEEDS=1 cargo test -p atip-check --locked

# Clippy over every target, warnings denied, and the visibility rule (no pub(super) / pub(in ..)).
lint:
    cargo clippy --workspace --all-targets --locked -- -D warnings
    scripts/check_visibility.sh

# Format the sources.
fmt:
    cargo fmt --all

# Fail when a source is not formatted.
fmt-check:
    cargo fmt --all --check

# The examples against the schemas, the spec's cross-references, the plan digest vectors and the Rust column of the pattern record.
validate:
    scripts/validate.sh

# Run the checker on its own fake tool at L0 in both modes: the fake tool with no configuration is a conforming one. Then the same for a fake tool of 1.3 and of 1.4.
check: check-interface check-deep (check-minor "1.3") (check-minor "1.3" "--deep") (check-minor "1.4") (check-minor "1.4" "--deep")

# The default mode: the interface checks, a few launches of the binary on one shared copy of the fixture state.
check-interface:
    cargo build --locked -p atip-check --features test-support
    {{ target }}/debug/atip check --bin {{ target }}/debug/atip-fake-tool --level L0 --fixture crates/atip-check/fake-tool/fixture.json

# `--deep`: every check of L0, each call in a fresh copy of the state.
check-deep:
    cargo build --locked -p atip-check --features test-support
    {{ target }}/debug/atip check --bin {{ target }}/debug/atip-fake-tool --level L0 --fixture crates/atip-check/fake-tool/fixture.json --deep

# The fake tool as a tool of the minor `minor` (1.3 or 1.4; a copy of the fake named `...claims13` / `...claims14` claims that minor), at L0; `mode` is `--deep` or empty.
check-minor minor mode="":
    cargo build --locked -p atip-check --features test-support
    cp {{ target }}/debug/atip-fake-tool {{ target }}/debug/atip-fake-tool-claims{{ replace(minor, ".", "") }}
    {{ target }}/debug/atip check --bin {{ target }}/debug/atip-fake-tool-claims{{ replace(minor, ".", "") }} --level L0 --fixture crates/atip-check/fake-tool/fixture-{{ minor }}.json {{ mode }}

# `atip` with its default features, and the probe built on it, pull no `jsonschema` (`cargo tree`).
deps-check:
    scripts/check_no_jsonschema.sh

# Everything CI does.
ci: validate fmt-check lint deps-check test
