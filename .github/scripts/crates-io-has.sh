#!/usr/bin/env bash
# crates-io-has.sh <crate> <version>: whether that version of the crate is on the crates.io index (the sparse index
# cargo reads, so "present" means a `cargo publish` of a crate that depends on it resolves it).
#
# Exit 0: present. Exit 1: absent (the crate has no such version, or was never published: the index answers 404).
# Exit 2: the index could not be read (network, outage, an unexpected status): never taken as "absent", so a release
# step that skips or waits on this answer fails instead of guessing.
set -euo pipefail

crate="${1:?usage: crates-io-has.sh <crate> <version>}"
version="${2:?usage: crates-io-has.sh <crate> <version>}"

# The index path of a name (https://doc.rust-lang.org/cargo/reference/registry-index.html#index-files).
name=$(printf '%s' "$crate" | tr '[:upper:]' '[:lower:]')
case ${#name} in
  1) path="1/$name" ;;
  2) path="2/$name" ;;
  3) path="3/${name:0:1}/$name" ;;
  *) path="${name:0:2}/${name:2:2}/$name" ;;
esac

body=$(mktemp)
trap 'rm -f "$body"' EXIT
status=$(curl --silent --show-error --location --output "$body" --write-out '%{http_code}' \
  "https://index.crates.io/$path") || {
  echo "crates-io-has: could not reach the crates.io index for $crate" >&2
  exit 2
}
case "$status" in
  200)
    # --exit-status: 0 when the version is listed, 1 when it is not; anything else is an index line jq cannot read.
    found=0
    jq --slurp --exit-status --arg v "$version" 'any(.[]; .vers == $v)' "$body" >/dev/null || found=$?
    case "$found" in
      0) exit 0 ;;
      1) exit 1 ;;
      *)
        echo "crates-io-has: could not read the crates.io index file of $crate" >&2
        exit 2
        ;;
    esac
    ;;
  404)
    exit 1
    ;;
  *)
    echo "crates-io-has: the crates.io index answered HTTP $status for $crate" >&2
    exit 2
    ;;
esac
