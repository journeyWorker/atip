# atip-check

`atip check`: the conformance checker of [ATIP](https://github.com/journeyWorker/atip) (`atip/1`). It runs a built
binary and checks the contract from outside: argv in; stdout, stderr, exit status and file-system changes out. It
knows nothing about the tool's source or framework. What it reports is evidence for or against a conformance claim,
never the definition of one (spec 3.7). `atip` itself is ATIP 1.6 L2, and CI checks that claim with `atip check`.

## Install

The binary is `atip`. It runs on macOS and Linux (it needs a pseudo-terminal and process groups).

```sh
bunx @journeykit/atip-check check --help   # npm: prebuilt for macOS arm64, Linux x64 and arm64 (static, any libc)
bun add -g @journeykit/atip-check          # npm, installed: the command atip
cargo install atip-check                   # from source, any unix
```

## Use

```sh
atip check --bin target/release/<tool> --fixture atip.fixture.json --level L2
atip check --bin target/release/<tool> --fixture atip.fixture.json --level L2 --deep --json
```

`--level` is the claimed level (L0, L1, L2), `--fixture` the tool's fixture file (the state and invocations the stateful
checks need), `--contract` the minor to judge by (`1.0` to `1.6`, default the fixture's `contractVersion`), and
`--deep` runs every check of the level instead of the interface checks only. `--jobs N` lets a deep run have up to N
independent invocations running at once, each in its own copy of the state (default: half the processors, at most 4;
`--jobs 1` runs one at a time); the calls that continue another call's state, the timed and terminal runs and the
`notRun` commands still run alone, and the report is the same whatever N is. A run that does not meet the level exits 1
with `LEVEL_FAILED`. The checks, their strengths and the fixture format are in
[`approaches/checker.md`](https://github.com/journeyWorker/atip/blob/main/approaches/checker.md).

## Describe

```sh
atip schema --json                    # the tree: check, schema, skills show; level L2
atip schema check --json              # the call surface of check: options, errors, output, example
atip schema check --schemas --json    # the JSON Schema of the check report
atip schema --errors --json           # the error registry; --error <CODE>, --warnings, --warning <CODE>
atip skills show                      # the guide for agents, built into the binary (--json for guide.schema.json)
```

0.4.0 renamed one code: a scratch space that cannot be used was `INTERNAL`; it is `SCRATCH_UNAVAILABLE` (exit 2, retryable)
before the checks run and `SCRATCH_FAILED` (exit 1, retryable) after. Every other code keeps its name.

MIT.
