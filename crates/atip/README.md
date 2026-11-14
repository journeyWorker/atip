# atip

The Rust pieces a command-line tool shares to speak [ATIP](https://github.com/journeyWorker/atip), the Agent Terminal
Invocation Protocol (`atip/1`): the projection of a clap tree onto the `schema` self-description documents and their
serializer for the minor a tool declares, the error value and its redaction, the error-code row type and the code-name
convention, JSON-mode detection and the one-line envelope, the shell quoting of next-step commands, field projection,
domains, cursors, plan digests, and the contract's own JSON Schemas.

```toml
[dependencies]
atip = "0.3"

[dev-dependencies]
# The JSON Schema validators (`atip::schema::envelope_problems` and the others), for the tool's tests.
atip = { version = "0.3", features = ["validate"] }
```

`atip::CONTRACT_VERSION` is the newest minor of the contract the crate implements (0.3: 1.6); a tool declares its own
minor in a constant of its own. The feature `validate` (off by default) links `jsonschema`; a tool that only builds
documents and refuses arguments leaves it off.

The spec, the approaches (`approaches/rust.md` for clap tools) and the changelog are in the
[repository](https://github.com/journeyWorker/atip). The checker that tests a built binary against the contract is
[`atip-check`](https://crates.io/crates/atip-check) (`atip check`).

MIT.
