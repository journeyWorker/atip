//! Every code `atip` emits is registered, and every registered code is emitted (spec 7.3, 10.5): one
//! invocation of the built binary per code, the exit and `retryable` of each failure its row's, each command's failures listed
//! in its document, and every code a document lists seen. `INTERNAL` (a bug) and `SCRATCH_FAILED` (the scratch space failing
//! once the checks run) have no invocation that provokes them on demand; their witnesses are the unit tests of `app.rs`
//! (`a_panic_is_an_internal_failure…`, `a_scratch_failure_has_a_code_for_each_stage`), named here so that the two lists meet.

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::process::Command;

use serde_json::json;

use atip_check::output::{REGISTRY, WARNINGS};
use support::{Harness, Output, ATIP, FAKE_TOOL};

/// The codes witnessed by a unit test instead of an invocation.
const UNIT_WITNESSED: [&str; 2] = ["INTERNAL", "SCRATCH_FAILED"];

fn run(cwd: &std::path::Path, tmp: &std::path::Path, args: &[&str]) -> Output {
    let output = Command::new(ATIP)
        .args(args)
        .current_dir(cwd)
        .env("TMPDIR", tmp)
        .output()
        .expect("run atip");
    Output {
        code: output.status.code(),
        signal: None,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

#[test]
fn atip_check_codes_01_every_emitted_code_is_registered_and_every_registered_code_is_emitted() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let empty = harness.write("empty.json", &json!({}));
    let empty = empty.to_str().expect("utf8");
    // One fake tool configuration for the two runs that need one: it fails L0.no-null, and the scratch run stops before any check.
    let failing = harness.write("failing.json", &harness.fixture(&json!({"hintNull": true})));
    let failing = failing.to_str().expect("utf8");
    let missing = harness.path("missing.json");
    let missing = missing.to_str().expect("utf8");
    let no_binary = harness.path("no-such-binary");
    let no_binary = no_binary.to_str().expect("utf8");
    let no_scratch = harness.path("no-such-dir");
    let calls: Vec<(Vec<&str>, &std::path::Path, &str)> = vec![
        (vec!["--json"], &tmp, "COMMAND_REQUIRED"),
        (vec!["nosuch-xyz", "--json"], &tmp, "UNKNOWN_COMMAND"),
        (
            vec!["schema", "nosuch-xyz", "--json"],
            &tmp,
            "UNKNOWN_COMMAND",
        ),
        (vec!["check", "--json"], &tmp, "USAGE"),
        (
            vec!["schema", "--error", "NOSUCH_XYZ", "--json"],
            &tmp,
            "USAGE",
        ),
        (vec!["schema", "--schemas", "--json"], &tmp, "USAGE"),
        (vec!["skills", "--json"], &tmp, "COMMAND_REQUIRED"),
        (
            vec!["skills", "nosuch-xyz", "--json"],
            &tmp,
            "UNKNOWN_COMMAND",
        ),
        (
            vec!["skills", "show", "nosuch-xyz", "--json"],
            &tmp,
            "USAGE",
        ),
        (
            vec!["check", "--bin", no_binary, "--fixture", empty, "--json"],
            &tmp,
            "BINARY_INVALID",
        ),
        (
            vec!["check", "--bin", ATIP, "--fixture", missing, "--json"],
            &tmp,
            "FIXTURE_INVALID",
        ),
        (
            vec![
                "check",
                "--bin",
                FAKE_TOOL,
                "--level",
                "L0",
                "--fixture",
                failing,
                "--json",
            ],
            &tmp,
            "LEVEL_FAILED",
        ),
        (
            vec![
                "check",
                "--bin",
                FAKE_TOOL,
                "--level",
                "L0",
                "--fixture",
                failing,
                "--json",
            ],
            &no_scratch,
            "SCRATCH_UNAVAILABLE",
        ),
    ];
    let rows: BTreeMap<&str, (u8, bool)> = REGISTRY
        .iter()
        .map(|row| (row.code, (row.exit, row.retryable)))
        .collect();
    let documents: BTreeMap<String, BTreeSet<String>> = atip_check::spec::documents()
        .expect("documents")
        .into_iter()
        .map(|document| (document.command, document.errors.into_iter().collect()))
        .collect();
    let mut emitted: BTreeSet<String> = UNIT_WITNESSED.iter().map(ToString::to_string).collect();
    let mut by_command: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (args, scratch, code) in &calls {
        let output = run(&cwd, scratch, args);
        let document = output.envelope();
        let error = &document["error"];
        assert_eq!(error["code"], *code, "{args:?}: {document}");
        let (exit, retryable) = rows[code];
        assert_eq!(output.code, Some(i32::from(exit)), "{args:?}");
        assert_eq!(error["retryable"], retryable, "{args:?}");
        assert!(atip::envelope_problems(&document).is_empty(), "{args:?}");
        // A hint is a runnable command line or prose, never a template with placeholders (spec 7.1.2).
        if let Some(hint) = error["hint"].as_str() {
            assert!(!atip::has_placeholder(hint), "{args:?}: {hint}");
            if let Some(words) = hint.strip_prefix("atip ") {
                let argv: Vec<std::ffi::OsString> = atip::split_argv(words)
                    .into_iter()
                    .map(Into::into)
                    .collect();
                assert!(atip_check::cli::parse(&argv).is_ok(), "{args:?}: {hint}");
            }
        }
        emitted.insert((*code).to_string());
        if let Some(command) = document["meta"]["command"].as_str() {
            by_command
                .entry(command.to_string())
                .or_default()
                .insert((*code).to_string());
        }
    }
    // A fake tool that fails only SHOULD checks: the level is met with the warning (as in atip_check_run.rs, atip_check_23).
    let warned = harness.check_config(&json!({"claims": "1.0", "versionFormat": "bare", "textErrorPrefix": "error", "pretty": true, "omitContract": true, "noiseStderrFor": ["status"], "usageNoHint": true, "groupRejectsGlobal": true}));
    assert_eq!(warned.code, Some(0), "{}", warned.stdout);
    let warnings: BTreeSet<String> = warned.envelope()["meta"]["warnings"]
        .as_array()
        .expect("meta.warnings")
        .iter()
        .map(|warning| warning["code"].as_str().unwrap_or_default().to_string())
        .collect();
    let registered: BTreeSet<String> = rows.keys().map(ToString::to_string).collect();
    assert_eq!(emitted, registered, "emitted codes and the error registry");
    assert_eq!(
        warnings,
        WARNINGS
            .iter()
            .map(|row| row.code.to_string())
            .collect::<BTreeSet<_>>(),
        "emitted warnings and the warning registry"
    );
    // Each command's failures are in its document's errors, and each code a document lists was seen in it (or has a unit witness).
    for (command, listed) in &documents {
        let seen = by_command.get(command).cloned().unwrap_or_default();
        assert!(seen.is_subset(listed), "{command}: {seen:?} ⊄ {listed:?}");
        let unseen: Vec<&String> = listed
            .iter()
            .filter(|code| !seen.contains(*code) && !UNIT_WITNESSED.contains(&code.as_str()))
            .collect();
        assert!(
            unseen.is_empty(),
            "{command} lists {unseen:?}, which no call made it emit"
        );
    }
}
