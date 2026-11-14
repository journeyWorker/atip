# @journeykit/atip-check

`atip check`: the conformance checker of [ATIP](https://github.com/journeyWorker/atip) (`atip/1`), the Agent Terminal
Invocation Protocol. It runs a built binary and checks the contract from outside: argv in; stdout, stderr, exit status
and file-system changes out. What it reports is evidence for or against a conformance claim, never the definition of
one.

```sh
bunx @journeykit/atip-check check --bin target/release/<tool> --fixture atip.fixture.json --level L2
bun add -g @journeykit/atip-check     # or npm install -g; then: atip check ...
```

The package's command is `atip`. It installs a prebuilt binary for macOS arm64, Linux x64 or Linux arm64 (glibc 2.35
or later) as an optional dependency, and `atip` runs it with your arguments and exit status. On another unix, build it
from source with `cargo install atip-check`. Its version is the version of the Rust crate
[`atip-check`](https://crates.io/crates/atip-check).

The checks, their strengths and the fixture format are in
[`approaches/checker.md`](https://github.com/journeyWorker/atip/blob/main/approaches/checker.md).

MIT.
