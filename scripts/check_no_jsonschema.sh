#!/usr/bin/env bash
# Fails when `jsonschema` is in the dependency tree of the `atip` crate with its default features, or of `atip-probe`, a tool
# that depends on `atip` with the default features. Only the feature `validate` may bring the validator in; the last step
# checks that it does, so this script cannot pass by listing nothing. `cargo tree` resolves features per package, so the
# workspace's `atip-check`, which turns `validate` on, does not change the answer.
set -euo pipefail

cd "$(dirname "$0")/.."

tree() { cargo tree --locked --prefix none --color never "$@"; }

status=0
for args in "-p atip -e normal" "-p atip-probe"; do
  # shellcheck disable=SC2086
  if tree $args | grep -q '^jsonschema '; then
    echo "check_no_jsonschema: jsonschema is in the tree of 'cargo tree $args'" >&2
    status=1
  fi
done

if ! tree -p atip -e normal --features validate | grep -q '^jsonschema '; then
  echo "check_no_jsonschema: the feature validate no longer brings jsonschema in" >&2
  status=1
fi
exit "$status"
