//! `atip check` without `--deep`: the interface mode (approaches/checker.md 3.1). A few launches of the binary on one shared copy of the
//! fixture state, the checks that judge what the tool prints for ordinary calls, and a report that says it is not the level's verdict.
//!
//! Every run here is a handful of launches of the fake tool: these tests are cheap by nature.

mod support;

use std::collections::BTreeSet;

use atip_check::checks::{deep_part, every_id, mode_of};
use atip_check::report::Mode;
use serde_json::{json, Value};
use support::l1::{l1_bin, l1_cases, l1_config};
use support::{atip_as_given, atip_in, cases, Case, Harness, Output, FAKE_TOOL};

/// The most launches of the binary an interface run may make after the fixture's `setup` ("about 15" in the author's words, with the setup of a
/// small fixture; the three calls of the probe's argument grammar are in it).
const MOST_CALLS: usize = 13;

/// The calls of an interface run: the launches from `--version` on, after the fixture's `setup`.
fn calls_of(launches: &[String]) -> usize {
    launches
        .iter()
        .skip_while(|line| line.as_str() != "--version")
        .count()
}

fn lines(path: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

fn failing(output: &Output) -> Vec<String> {
    output
        .results()
        .into_iter()
        .filter(|(_, result)| result == "fail")
        .map(|(id, _)| id)
        .collect()
}

fn ids_of(output: &Output) -> Vec<String> {
    output.results().into_iter().map(|(id, _)| id).collect()
}

/// The rows that 1.3 and 1.4 added (`L1.code-names` from a claim of 1.3, `L1.schemas` and `L1.help-json` from 1.4): all three are interface
/// checks, each judging the document of one call (`schema --errors --json`; `schema <probe> --schemas --json` and the root refusal;
/// `--help --json` and `--version --json`). The Modes table of approaches/checker.md 3.1 does not list them yet (the author rewrites that
/// section), so the table is compared with the checker's INTERFACE table without them; when the document catches up, delete this constant.
const ROWS_OF_1_3_AND_1_4: [&str; 3] = ["L1.code-names", "L1.schemas", "L1.help-json"];

/// What `--deep` adds to each of the three rows, as the author decided (the lead's table of the pull request).
const DEEP_PARTS_OF_1_3_AND_1_4: [(&str, &str); 3] = [
    ("L1.code-names", ""),
    (
        "L1.schemas",
        "`schema <path> --schemas --json` for every other command, and for a group",
    ),
    (
        "L1.help-json",
        "`<command> --help --json`, `nosuch-xyz --help --json` and `nosuch-xyz --version --json`",
    ),
];

/// The ids of the checks of `level` and the levels below it that run in `mode`, for a claim of 1.1, in table order.
fn ids_in(mode: Mode, level: &str) -> Vec<String> {
    let levels: &[&str] = match level {
        "L0" => &["L0."],
        "L1" => &["L0.", "L1."],
        _ => &["L0.", "L1.", "L2."],
    };
    every_id()
        .into_iter()
        // `L1.check-order` is a claim of 1.2's and `L2.effects` is reported at every level (an advisory below L2).
        .filter(|id| *id != "L1.check-order" && !ROWS_OF_1_3_AND_1_4.contains(id))
        .filter(|id| levels.iter().any(|prefix| id.starts_with(prefix)) || *id == "L2.effects")
        .filter(|id| mode == Mode::Deep || mode_of(id) == Mode::Interface)
        .map(str::to_string)
        .collect()
}

/// `atip check` in the default mode against the L1 fake of `config` (`--json`), at `level`.
fn run_default_l1(harness: &Harness, config: &Value, fixture: &Value, level: &str) -> Output {
    let fixture_path = harness.write("fixture.json", fixture);
    let bin = l1_bin(harness, config);
    let work = harness.path("cwd");
    std::fs::create_dir_all(&work).expect("cwd");
    let tmp = harness.path("tmp");
    std::fs::create_dir_all(&tmp).expect("tmp");
    atip_as_given(
        &work,
        &tmp,
        &[
            "check",
            "--bin",
            bin.to_str().expect("utf8"),
            "--level",
            level,
            "--fixture",
            fixture_path.to_str().expect("utf8"),
            "--json",
        ],
    )
}

#[test]
fn atip_check_deep_10_a_conforming_tool_passes_the_interface_checks_of_l0_in_ten_launches() {
    let harness = Harness::new();
    let log = harness.path("runs.log");
    let output = harness.check_default(&harness.fixture(&json!({"invocationLog": log})), true);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    let document = output.envelope();
    let data = &document["data"];
    assert_eq!(
        (data["mode"].as_str(), data["passed"].as_bool()),
        (Some("interface"), Some(true))
    );
    // The checks it ran are the interface ones of L0, and the report lists the others as `deepChecks`.
    assert_eq!(ids_of(&output), ids_in(Mode::Interface, "L0"));
    let deep: Vec<String> = data["deepChecks"]
        .as_array()
        .expect("deepChecks")
        .iter()
        .map(|id| id.as_str().expect("id").to_string())
        .collect();
    let expected_deep: Vec<String> = ids_in(Mode::Deep, "L0")
        .into_iter()
        .filter(|id| mode_of(id) == Mode::Deep)
        .collect();
    assert_eq!(deep, expected_deep);
    assert!(
        deep.contains(&"L0.no-env-switch".to_string()) && deep.contains(&"L2.effects".to_string())
    );
    // The launches, in order: the fixture's `setup`, then the calls of the interface run, the `missingValue` control run last.
    let launches = lines(&log);
    assert_eq!(
        launches,
        [
            "init",
            "--version",
            "nosuch-xyz --json",
            "nosuch-xyz",
            "--json",
            "schema --errors --json",
            "schema --warnings --json",
            "schema --json",
            "status --json",
            "status --bogus-xyz --json",
            "status --json --bogus-xyz",
            "status -- --json",
            "touch --json",
        ]
    );
    assert!(calls_of(&launches) <= MOST_CALLS);
    // The text report says which mode ran and what `--deep` adds, and never says the level is met.
    let text = harness.check_default(&harness.fixture(&json!({})), false);
    assert_eq!(text.code, Some(0), "{}", text.stderr);
    let summary = text.stdout.lines().last().expect("summary");
    assert!(
        summary.starts_with("L0 interface checks passed (--deep for the rest): "),
        "{summary}"
    );
    assert!(!text.stdout.contains(" met:"), "{}", text.stdout);
    assert!(
        text.stdout
            .contains("not run without --deep: L0.no-env-switch, "),
        "{}",
        text.stdout
    );
    assert!(
        text.stdout
            .contains("L0.no-prompt (spec 5.5) [--deep adds the run on a terminal"),
        "a check that judges part of its rule says what --deep adds: {}",
        text.stdout
    );
}

#[test]
fn atip_check_deep_11_the_interface_run_of_l1_and_l2_adds_the_tree_and_help_in_two_launches() {
    let harness = Harness::new();
    let log = harness.path("runs.log");
    let config = l1_config(&json!({"invocationLog": log}));
    let fixture = harness.l1_fixture(&config);
    let output = run_default_l1(&harness, &config, &fixture, "L1");
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    assert_eq!(ids_of(&output), ids_in(Mode::Interface, "L1"));
    assert_eq!(output.envelope()["data"]["mode"], "interface");
    let launches = lines(&log);
    // `schema --json` serves L0.* and L1.tree alike; `--help` comes before the control run, which is last.
    let after_setup: Vec<&str> = launches.iter().skip(1).map(String::as_str).collect();
    assert_eq!(after_setup.last(), Some(&"touch --json"), "{launches:?}");
    assert_eq!(
        after_setup
            .iter()
            .filter(|line| **line == "schema --json")
            .count(),
        1
    );
    assert_eq!(
        after_setup.iter().filter(|line| **line == "--help").count(),
        1
    );
    assert!(calls_of(&launches) <= MOST_CALLS, "{launches:?}");
    // L2: the tree's `level` is L1 and the claim L2, which L1.tree reports, and `--help` says nothing of `skills show`: L2.help-guide fails.
    let harness = Harness::new();
    let log = harness.path("runs.log");
    let config = l1_config(&json!({"invocationLog": log}));
    let fixture = harness.l1_fixture(&config);
    let output = run_default_l1(&harness, &config, &fixture, "L2");
    assert_eq!(output.code, Some(1), "{}", output.stdout);
    assert_eq!(ids_of(&output), ids_in(Mode::Interface, "L2"));
    assert_eq!(failing(&output), ["L1.tree", "L2.help-guide"]);
    assert_eq!(
        lines(&log).len(),
        launches.len(),
        "L2 makes no launch that L1 does not"
    );
    let error = &output.envelope()["error"];
    assert_eq!(error["code"], "LEVEL_FAILED");
    assert!(
        error["message"].as_str().is_some_and(
            |message| message.starts_with("the interface checks of L2 failed: 2 MUST checks")
        ),
        "{error}"
    );
}

#[test]
fn atip_check_deep_20_a_partial_check_says_how_far_it_ran_and_a_run_without_level_takes_the_trees()
{
    // `ran` is on the checks that judge only part of their rule without `--deep`: `interface` in a default run, `all` in a deep one.
    let harness = Harness::new();
    let default = harness.check_default(&harness.fixture(&json!({})), true);
    let ran = |output: &Output, id: &str| output.check(id).get("ran").cloned();
    assert_eq!(ran(&default, "L0.no-prompt"), Some(json!("interface")));
    assert_eq!(ran(&default, "L0.registry"), Some(json!("interface")));
    assert_eq!(ran(&default, "L0.version"), None);
    let harness = Harness::new();
    let deep = harness.check(&harness.fixture(&json!({})), true);
    assert_eq!(ran(&deep, "L0.no-prompt"), Some(json!("all")));
    assert_eq!(ran(&deep, "L0.version"), None);
    // Without `--level` the level is the one the tool's `schema --json` declares (the L1 fake says L1).
    let harness = Harness::new();
    let config = l1_config(&json!({}));
    let fixture = harness.l1_fixture(&config);
    let bin = l1_bin(&harness, &config);
    let fixture_path = harness.write("fixture.json", &fixture);
    let (work, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&work).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let output = atip_as_given(
        &work,
        &tmp,
        &[
            "check",
            "--bin",
            bin.to_str().expect("utf8"),
            "--fixture",
            fixture_path.to_str().expect("utf8"),
            "--json",
        ],
    );
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    assert_eq!(output.envelope()["data"]["level"], "L1");
    assert_eq!(ids_of(&output), ids_in(Mode::Interface, "L1"));
    // A tool that prints no `schema --json` claims nothing above L0.
    let harness = Harness::new();
    let fixture_path = harness.write("plain.json", &harness.fixture(&json!({"noSchema": true})));
    let (work, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&work).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let output = atip_as_given(
        &work,
        &tmp,
        &[
            "check",
            "--bin",
            FAKE_TOOL,
            "--fixture",
            fixture_path.to_str().expect("utf8"),
            "--json",
        ],
    );
    assert_eq!(
        output.envelope()["data"]["level"],
        "L0",
        "{}",
        output.stdout
    );
}

#[test]
fn atip_check_deep_12_the_calls_of_an_interface_run_share_one_copy_of_the_state_and_a_deep_run_does_not(
) {
    let harness = Harness::new();
    // `dirtyMarker`: the first call but `init` that runs leaves a file, and a later call in the same directory fails ("state leaked").
    let fixture = harness.fixture(&json!({"dirtyMarker": true}));
    let default = harness.check_default(&fixture, true);
    assert_eq!(
        default.code,
        Some(1),
        "one shared copy: a later call saw what an earlier one left: {}",
        default.stdout
    );
    assert!(
        default
            .stdout
            .contains("state leaked in from an earlier invocation"),
        "{}",
        default.stdout
    );
    // Each call of a deep run starts from a fresh copy of the state: the same tool passes (atip_check_24 shows the setup runs once).
    let deep = harness.check_with(&fixture, true, &[]);
    assert_eq!(deep.code, Some(0), "{}", deep.stdout);
}

/// The seeded violations of the L0 interface checks a default run shows: one per owner, the conditions the calls of the interface run reach.
const L0_SEEDS: [&str; 19] = [
    "version/exit-0",
    "version-format/tool-version-line",
    "unknown-command/code",
    "unknown-command-text/exit-2",
    "text-error-form/prefix",
    "bare/code",
    "unknown-option/code-is-a-refusal",
    "json-mode-preparse/json-first",
    "after-dashdash/not-an-envelope",
    "ok-exit/ok-iff-exit-0",
    "no-null/no-null",
    "envelope/valid-envelope",
    "compact/no-indentation",
    "contract-version/markers-present",
    "stderr-result/stderr-carries-no-result",
    "stderr-quiet/stderr-empty",
    "registry/kind",
    "registry/warnings-kind",
    "next/entries-valid",
];

#[test]
fn atip_check_deep_13_a_seeded_violation_of_each_interface_check_family_fails_its_owner_and_no_other(
) {
    let seeds = cases();
    for condition in L0_SEEDS {
        let case = seeds
            .iter()
            .find(|case| case.condition == condition)
            .unwrap_or_else(|| panic!("{condition} is no seeded condition"));
        let harness = Harness::new();
        let output = harness.check_default(&case.fixture(&harness), true);
        assert_eq!(
            failing(&output),
            [case.owner()],
            "{condition}: a default run must fail the owner and no other: {}",
            output.stdout.chars().take(1200).collect::<String>()
        );
        assert_eq!(output.envelope()["data"]["mode"], "interface");
        assert!(
            mode_of(&case.owner()) == Mode::Interface,
            "{condition} belongs to an interface check"
        );
    }
}

#[test]
fn atip_check_deep_14_the_interface_checks_of_l1_fail_on_their_seeded_violations_one_owner_each() {
    let seeds = l1_cases();
    for condition in [
        "tree/valid",
        "tree/groups-first",
        "depth/at-most-two-words",
        "help-line/mentions-schema",
        "registry/reserved-exit",
        "warnings/meaning-agrees",
        "next/names-a-command",
    ] {
        let case: &Case = seeds
            .iter()
            .find(|case| case.condition == condition)
            .unwrap_or_else(|| panic!("{condition} is no seeded condition"));
        let harness = Harness::new();
        let fixture = support::l1::l1_fixture_of(&harness, case);
        let output = run_default_l1(&harness, &case.config, &fixture, "L1");
        let owner = case.owner().replacen("L0.", "L1.", 1);
        assert_eq!(
            failing(&output),
            [owner],
            "{condition}: {}",
            output.stdout.chars().take(1200).collect::<String>()
        );
    }
}

#[test]
fn atip_check_deep_15_no_prompt_without_deep_judges_the_control_run_refusing_and_not_hanging() {
    let harness = Harness::new();
    // The control run of the `missingValue` invocation hangs: it fails the check, which a deep run reports as unprovided only after the run on a terminal.
    let mut fixture = harness.fixture(&json!({"hangCommand": "touch"}));
    fixture["timeoutSeconds"] = json!(2);
    let hanging = harness.check_default(&fixture, true);
    assert_eq!(
        failing(&hanging),
        ["L0.no-prompt"],
        "{}",
        hanging.stdout.chars().take(800).collect::<String>()
    );
    let finding = &hanging.check("L0.no-prompt")["findings"][0];
    assert_eq!(finding["kind"], "ran-over-time-limit", "{finding}");
    // A `missingValue` invocation the tool does not refuse cannot show a prompt: unprovided, as in a deep run.
    let mut fixture = harness.fixture(&json!({}));
    fixture["commands"]["touch"]["missingValue"] = json!([["items", "--json"]]);
    let unrefused = harness.check_default(&fixture, true);
    assert_eq!(
        unrefused.check("L0.no-prompt")["result"],
        "unprovided",
        "{}",
        unrefused.stdout
    );
    // Without a `missingValue` invocation the check is unprovided too.
    let mut fixture = harness.fixture(&json!({}));
    fixture["commands"]["touch"] = json!({"refused": [["touch", "--input", "nope", "--json"]]});
    let missing = harness.check_default(&fixture, true);
    assert_eq!(missing.check("L0.no-prompt")["result"], "unprovided");
}

#[test]
fn atip_check_deep_16_deep_is_the_full_run_and_reports_mode_deep_without_deep_checks() {
    let harness = Harness::new();
    let output = harness.check_with(&harness.fixture(&json!({})), true, &[]);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    let data = &output.envelope()["data"];
    assert_eq!(
        (data["mode"].as_str(), data["passed"].as_bool()),
        (Some("deep"), Some(true))
    );
    assert!(data.get("deepChecks").is_none());
    assert_eq!(ids_of(&output), ids_in(Mode::Deep, "L0"));
    assert_eq!(ids_of(&output).len(), support::CHECKS);
    let text = harness.check_with(&harness.fixture(&json!({})), false, &[]);
    let last = text.stdout.lines().last().expect("summary");
    assert!(last.starts_with("L0 met: "), "{last}");
    assert!(!text.stdout.contains("--deep"), "{}", text.stdout);
    // A seeded violation fails its owner in the deep run as it did before the modes.
    let seeds = cases();
    let case = seeds
        .iter()
        .find(|case| case.condition == "unknown-option/field")
        .expect("seed");
    let output = harness.check_with(&case.fixture(&harness), true, &[]);
    assert_eq!(failing(&output), [case.owner()]);
}

#[test]
fn atip_check_deep_17_a_failed_interface_run_exits_1_with_the_interface_checks_as_the_failure() {
    let harness = Harness::new();
    let fixture = harness.fixture(&json!({"bareCode": "UNKNOWN_COMMAND"}));
    let output = harness.check_default(&fixture, true);
    assert_eq!(output.code, Some(1));
    let document = output.envelope();
    assert_eq!(document["error"]["code"], "LEVEL_FAILED");
    assert_eq!(
        document["error"]["message"],
        "the interface checks of L0 failed: 1 MUST checks fail or are unprovided (L0.bare)"
    );
    assert_eq!(document["data"]["mode"], "interface");
    // In text mode the same list follows the error line on stderr, and the summary line says the interface checks failed.
    let text = harness.check_default(&fixture, false);
    assert_eq!(text.code, Some(1));
    assert!(text.stdout.is_empty());
    assert!(
        text.stderr.contains("the interface checks of L0 failed"),
        "{}",
        text.stderr
    );
    assert!(
        text.stderr.contains("L0 interface checks failed: "),
        "{}",
        text.stderr
    );
}

/// The ids of a row of a markdown table whose first cell is a check id.
fn table_rows(section: &str) -> Vec<(String, String)> {
    section
        .lines()
        .filter(|line| line.starts_with("| L"))
        .map(|line| {
            let mut cells = line.trim_matches('|').split('|').map(str::trim);
            (
                cells.next().unwrap_or_default().to_string(),
                cells.next().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

fn check_ids_in(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
        .map(|word| word.trim_end_matches('.'))
        .filter(|word| {
            word.strip_prefix('L')
                .and_then(|rest| rest.split_once('.'))
                .is_some_and(|(level, name)| matches!(level, "0" | "1" | "2") && !name.is_empty())
        })
        .map(str::to_string)
        .collect()
}

#[test]
fn atip_check_deep_18_every_check_is_interface_or_deep_exactly_once_and_the_checker_md_table_says_the_same(
) {
    let every = every_id();
    let unique: BTreeSet<&str> = every.iter().copied().collect();
    assert_eq!(
        unique.len(),
        every.len(),
        "an id is in two tables: {every:?}"
    );
    assert_eq!(
        every.len(),
        28 + 32 + 3 + 30,
        "the 28 of L0, the 31 of L1 and L1.check-order, the 3 rows of 1.3 and 1.4, the 30 of L2"
    );
    let interface: Vec<&str> = every
        .iter()
        .copied()
        .filter(|id| mode_of(id) == Mode::Interface)
        .collect();
    let deep: Vec<&str> = every
        .iter()
        .copied()
        .filter(|id| mode_of(id) == Mode::Deep)
        .collect();
    assert_eq!(
        interface.len() + deep.len(),
        every.len(),
        "every check has one mode"
    );
    assert_eq!((interface.len(), deep.len()), (32 + 3, 58));
    // The three rows of 1.3 and 1.4 are interface checks, with the deep parts above.
    for (id, part) in DEEP_PARTS_OF_1_3_AND_1_4 {
        assert_eq!(mode_of(id), Mode::Interface, "{id} is an interface check");
        assert_eq!(deep_part(id), part, "what --deep adds to {id}");
    }
    // An id that is not a check is deep by default, and says nothing of `--deep`.
    assert_eq!(
        (mode_of("L9.nosuch"), deep_part("L9.nosuch")),
        (Mode::Deep, "")
    );

    // The Modes section of approaches/checker.md lists the same checks, with the same account of what `--deep` adds.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../approaches/checker.md");
    let document = std::fs::read_to_string(&path).expect("approaches/checker.md");
    let start = document.find("### 3.1 Modes").expect("the Modes section");
    let section = &document[start..];
    let section = &section[..section.find("\n## 4.").expect("the next section")];
    let rows = table_rows(section);
    let interface: Vec<&str> = interface
        .into_iter()
        .filter(|id| !ROWS_OF_1_3_AND_1_4.contains(id))
        .collect();
    assert_eq!(
        rows.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        interface,
        "the interface table of checker.md is the checker's, in table order"
    );
    for (id, deep_part_in_doc) in &rows {
        assert_eq!(deep_part_in_doc, deep_part(id), "what --deep adds to {id}");
    }
    let paragraph = section
        .split("\n\n")
        .find(|paragraph| paragraph.starts_with("Every other check is deep"))
        .expect("the paragraph that lists the deep checks");
    let mut listed = check_ids_in(paragraph);
    listed.sort();
    let mut expected: Vec<String> = deep.iter().map(|id| (*id).to_string()).collect();
    expected.sort();
    assert_eq!(
        listed, expected,
        "the deep checks of checker.md are the checker's"
    );
}

#[test]
fn atip_check_deep_19_the_command_line_has_deep_and_says_what_it_is_in_help() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let help = atip_as_given(&cwd, &tmp, &["check", "--help"]);
    assert_eq!(help.code, Some(0));
    assert!(help.stdout.contains("[--deep] [--json]"), "{}", help.stdout);
    assert!(
        help.stdout
            .contains("--deep             Run every check of the level"),
        "{}",
        help.stdout
    );
    assert!(
        help.stdout
            .contains("\nModes:\n  default  The interface checks"),
        "{}",
        help.stdout
    );
    let root = atip_as_given(&cwd, &tmp, &["--help"]);
    assert!(root.stdout.contains("[--deep] [--json]"), "{}", root.stdout);
    // `--deep` takes no value, and is not mistaken for another option.
    let fixture = harness.write("fixture.json", &harness.fixture(&json!({})));
    let fixture = fixture.to_str().expect("utf8");
    let base = [
        "check",
        "--bin",
        FAKE_TOOL,
        "--level",
        "L0",
        "--fixture",
        fixture,
        "--json",
    ];
    let mut valued = base.to_vec();
    valued.push("--deep=1");
    let refused = atip_as_given(&cwd, &tmp, &valued);
    assert_eq!(refused.code, Some(2));
    let error = &refused.envelope()["error"];
    assert_eq!(
        (error["code"].as_str(), error["field"].as_str()),
        (Some("USAGE"), Some("--deep"))
    );
    let mut typo = base.to_vec();
    typo.push("--deeep");
    let refused = atip_as_given(&cwd, &tmp, &typo);
    let error = &refused.envelope()["error"];
    assert_eq!(error["field"], "--deeep");
    assert_eq!(error["suggestions"], json!(["--deep"]));
    // `--deep` anywhere on the line (and twice) is accepted, and `atip_in` adds it for the checker's own tests.
    let mut twice = base.to_vec();
    twice.insert(1, "--deep");
    twice.push("--deep");
    let deep = atip_as_given(&cwd, &tmp, &twice);
    assert_eq!(
        (deep.code, deep.envelope()["data"]["mode"].as_str()),
        (Some(0), Some("deep"))
    );
    assert_eq!(
        atip_in(&cwd, &tmp, &base).envelope()["data"]["mode"],
        "deep"
    );
    assert_eq!(
        atip_as_given(&cwd, &tmp, &base).envelope()["data"]["mode"],
        "interface"
    );
}
