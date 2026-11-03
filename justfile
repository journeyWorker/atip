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

# The tests of the whole workspace: the `atip` crate and the checker with its fake tool.
test:
    cargo test --workspace --locked

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

# Run the checker on its own fake tool at L0: the fake tool with no configuration is a conforming one.
check:
    cargo build --locked -p atip-check --features test-support
    {{ target }}/debug/atip check --bin {{ target }}/debug/atip-fake-tool --level L0 --fixture crates/atip-check/fake-tool/fixture.json

# Everything CI does.
ci: validate fmt-check lint test
