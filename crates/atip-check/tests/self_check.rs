//! The checker follows the contract it checks: `atip check` passes on `atip`, which claims ATIP 1.6 at L1.
//!
//! The fixture is `tests/self/atip.fixture.json`, generated from the code here, and a test fails when the two differ
//! (`ATIP_CHECK_BLESS_FIXTURE=1 cargo test -p atip-check --test self_check` rewrites it). It claims the checker's own minor, its
//! `probe` is `check`, its `registry` and `warnings` are the checker's own ([`atip_check::output::REGISTRY`] and
//! [`atip_check::output::WARNINGS`]), and its calls are cheap and stateless: the `ok` call of `check` checks `atip` itself (the
//! one on `PATH`) at L0 in the default mode, against a small fixture its `prepare` step writes into the template, with the
//! scratch copies of that inner run under the copy it runs in (`TMPDIR` `.`). CI runs the whole of L1 (`--deep`) on the
//! release binary; the tests here run the interface checks of L1 and the whole of L0.

mod support;

use serde_json::{json, Value};

use atip_check::output::{DECLARED_MINOR, REGISTRY, WARNINGS};
use support::{atip_self_check, self_fixture, Harness};

/// The fixture the `ok` call of `check` reads: `atip` at L0 in the default mode, its registry taken from its own `schema`.
fn inner_fixture() -> Value {
    json!({
        "contractVersion": DECLARED_MINOR,
        "probe": "check",
        "registry": "from-schema",
        "globalOptions": [],
        "commands": {
            "check": {"missingValue": [["check", "--level", "L0", "--fixture", "atip.fixture.json", "--json"]]}
        }
    })
}

fn generated() -> Value {
    let rows: Vec<Value> = REGISTRY
        .iter()
        .map(|row| {
            let mut entry = json!({"code": row.code, "exit": row.exit, "retryable": row.retryable});
            if !row.reasons.is_empty() {
                entry["reasons"] = json!(row
                    .reasons
                    .iter()
                    .map(|reason| reason.reason)
                    .collect::<Vec<_>>());
            }
            entry
        })
        .collect();
    let warnings: Vec<&str> = WARNINGS.iter().map(|warning| warning.code).collect();
    // The inner fixture holds no `'`, so one single-quoted shell word carries it.
    let inner = serde_json::to_string(&inner_fixture()).expect("json");
    json!({
        "contractVersion": DECLARED_MINOR,
        "prepare": [["sh", "-c", format!("printf '%s\\n' '{inner}' > atip.fixture.json")]],
        "env": {"TMPDIR": "."},
        "probe": "check",
        "globalOptions": [],
        "registry": rows,
        "warnings": warnings,
        "commands": {
            "check": {
                "ok": [["check", "--bin", "atip", "--fixture", "atip.fixture.json", "--level", "L0", "--json"]],
                "refused": [["check", "--json"]],
                "missingValue": [["check", "--level", "L0", "--fixture", "atip.fixture.json", "--json"]]
            },
            "schema": {
                "ok": [["schema", "--json"]],
                "refused": [["schema", "nosuch-xyz", "--json"]]
            }
        }
    })
}

#[test]
fn atip_check_37_the_committed_fixture_of_atip_is_generated_from_its_registry() {
    let text = serde_json::to_string_pretty(&generated()).expect("json") + "\n";
    if std::env::var_os("ATIP_CHECK_BLESS_FIXTURE").is_some() {
        std::fs::write(self_fixture(), &text).expect("write the fixture");
    }
    let committed = std::fs::read_to_string(self_fixture()).expect("tests/self/atip.fixture.json");
    assert_eq!(committed, text, "tests/self/atip.fixture.json is out of date; run ATIP_CHECK_BLESS_FIXTURE=1 cargo test -p atip-check --test self_check and commit");
}

#[test]
fn atip_check_37_atip_passes_the_interface_checks_of_l1_on_itself() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let text = atip_self_check(&cwd, &tmp, &["--level", "L1"], false);
    assert_eq!(text.code, Some(0), "{}{}", text.stdout, text.stderr);
    let summary = text.stdout.lines().last().expect("summary");
    assert!(
        summary.starts_with("L1 interface checks passed (--deep for the rest): ")
            && summary.contains(" 0 MUST failed, 0 MUST unprovided,")
            && summary.ends_with(" 0 SHOULD advisories"),
        "{}",
        text.stdout
    );
    let output = atip_self_check(&cwd, &tmp, &["--level", "L1", "--json"], false);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    let document = output.envelope();
    assert_eq!(document["data"]["passed"], true);
    assert_eq!(document["data"]["contractVersion"], DECLARED_MINOR);
    for (id, result) in output.results() {
        assert!(
            ["pass", "unsupported"].contains(&result.as_str()),
            "{id}: {result}"
        );
    }
    assert!(
        std::fs::read_dir(&cwd).expect("cwd").next().is_none()
            && std::fs::read_dir(&tmp).expect("tmp").next().is_none(),
        "the run leaves the working directory and the scratch space as it found them"
    );
}

#[test]
fn atip_check_37_atip_meets_l0_on_itself() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let output = atip_self_check(&cwd, &tmp, &["--level", "L0", "--json"], true);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    assert_eq!(output.envelope()["data"]["mode"], "deep");
    for (id, result) in output.results() {
        assert!(
            ["pass", "unsupported"].contains(&result.as_str()),
            "{id}: {result}"
        );
    }
}

#[test]
fn atip_check16_60_json_mode_refuses_help_and_version_after_resolving_the_path() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let refused = |args: &[&str]| {
        let output = support::atip_as_given(&cwd, &tmp, args);
        assert_eq!(output.code, Some(2), "{args:?}: {}", output.stdout);
        // One document and one newline (L0.compact judges the whitespace).
        assert_eq!(output.stdout.matches('\n').count(), 1, "{}", output.stdout);
        let document = output.envelope();
        assert_eq!(document["meta"]["contractVersion"], DECLARED_MINOR);
        document
    };
    for (args, field, hint, command) in [
        (
            &["--help", "--json"][..],
            "--help",
            "atip schema --json",
            None,
        ),
        (
            &["check", "--help", "--json"][..],
            "--help",
            "atip schema check --json",
            Some("check"),
        ),
        (
            &["schema", "-h", "--json"][..],
            "--help",
            "atip schema schema --json",
            Some("schema"),
        ),
        (
            &["--version", "--json"][..],
            "--version",
            "atip --version",
            None,
        ),
        (&["-V", "--json"][..], "--version", "atip --version", None),
    ] {
        let document = refused(args);
        let error = &document["error"];
        assert_eq!(
            (
                error["code"].as_str(),
                error["field"].as_str(),
                error["hint"].as_str(),
                document["meta"]["command"].as_str()
            ),
            (Some("USAGE"), Some(field), Some(hint), command),
            "{args:?}"
        );
    }
    for args in [
        &["nosuch", "--help", "--json"][..],
        &["nosuch", "--version", "--json"][..],
        &["--version", "nosuch", "--json"][..],
    ] {
        assert_eq!(
            refused(args)["error"]["code"],
            "UNKNOWN_COMMAND",
            "{args:?}"
        );
    }
    // Text mode is unchanged.
    let version = support::atip_as_given(&cwd, &tmp, &["--version"]);
    assert_eq!(
        (version.code, version.stdout),
        (Some(0), format!("atip {}\n", env!("CARGO_PKG_VERSION")))
    );
}
