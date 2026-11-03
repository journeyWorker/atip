#!/usr/bin/env bash
# Validate every example against the atip/1 JSON Schemas and the rules JSON Schema cannot express
# (Annex S2 of the spec and the other semantic rules listed in scripts/check.ts), and the cross-engine pattern record
# scripts/regex-cases.json (Annex V2), and recomputes the plan digest test vectors in examples/plan-digest/
# (spec 11.6) with scripts/plan-digest.ts.
#
#   examples/*            must pass
#   examples/invalid/*    must be rejected
#
# A document that declares 1.4 is also checked for compact JSON (spec 5.1), the 1.4 form of the self-description (no
# member at its default, implied options and codes not listed, tree options named, Annex S2 rules 16 and 17) and, for a
# command, against the schemas answer next to it (examples/schema-schemas-<tool>-<command words joined by ->.json).
#
# Needs bun. ajv 8 is installed into a scratch directory under $TMPDIR, never into the repository; point
# TMPDIR at a scratch volume if the default temporary directory is not where it belongs.
# With cargo on PATH it also builds scripts/regex-parity through the Cargo workspace (build output where CARGO_TARGET_DIR
# points, default ./target; crates from the lock file) and checks the Rust column of scripts/regex-cases.json; without cargo
# that half is reported as skipped.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$work/bun-cache}"

cp "$repo/scripts/check.ts" "$work/check.ts"
printf '{"name":"atip-check","private":true}\n' > "$work/package.json"
(cd "$work" && bun add --silent ajv@8.17.1 >/dev/null)
bun run "$work/check.ts" "$repo"

echo
bun run "$repo/scripts/plan-digest.ts" "$repo"

echo
if command -v cargo >/dev/null 2>&1; then
  cargo run --quiet --locked --manifest-path "$repo/Cargo.toml" -p regex-parity -- "$repo/scripts/regex-cases.json" | grep -v '^ok  '
else
  echo "skipped: no cargo, so the rust column of scripts/regex-cases.json was not checked"
fi
