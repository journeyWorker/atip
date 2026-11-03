//! A conforming tool of atip/1 1.3 and of 1.4 (the fake tool with no seeded violation) passes `atip check` at L0, L1 and L2, in the default
//! (interface) mode and with `--deep`, with nothing unprovided; and the launches of the runs are counted (approaches/checker.md 3.1).

mod support;

use std::collections::BTreeSet;

use serde_json::{json, Value};
use support::l1::{l1_bin, l1_config_1_3, l1_config_1_4};
use support::l2::l2_config_of;
use support::{atip_as_given, Harness, Output};

/// The most launches of the binary an interface run of 1.4 may make after the fixture's `setup`: the thirteen calls of an interface run at L1, and five
/// of 1.4: `--help --json`, `--version --json`, `schema --schemas --json` (the refusal), `schema <probe> --schemas --json` and `schema <probe> --json`
/// (the probe's command view, which L1.schemas needs to judge its answer).
const MOST_CALLS_1_4: usize = 18;

/// The most launches of an interface run below 1.4 (approaches/checker.md 3.1: "at most thirteen").
const MOST_CALLS: usize = 13;

/// How a run is made.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Interface,
    Deep,
}

/// The configuration of the conforming fake of `claims` at `level`, with a log of its launches.
fn config_for(claims: &str, level: &str, log: &std::path::Path) -> Value {
    let extra = json!({"invocationLog": log});
    match (claims, level) {
        ("1.3" | "1.4", "L2") => l2_config_of(claims, &extra),
        ("1.3", _) => l1_config_1_3(&extra),
        _ => l1_config_1_4(&extra),
    }
}

/// `atip check --level <level> --json` of the fake tool of `config` and the fixture, in `mode`.
fn run(harness: &Harness, config: &Value, level: &str, mode: Mode) -> Output {
    let mut fixture = if level == "L2" {
        harness.l2_fixture(config)
    } else {
        harness.l1_fixture(config)
    };
    if level == "L0" {
        fixture["commands"] = harness.fixture(config)["commands"].clone();
    }
    let fixture_path = harness.write("fixture.json", &fixture);
    let bin = l1_bin(harness, config);
    let work = harness.path("cwd");
    std::fs::create_dir_all(&work).expect("cwd");
    let tmp = harness.path("tmp");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let mut args = vec![
        "check",
        "--bin",
        bin.to_str().expect("utf8"),
        "--level",
        level,
        "--fixture",
        fixture_path.to_str().expect("utf8"),
        "--json",
    ];
    if mode == Mode::Deep {
        args.push("--deep");
    }
    atip_as_given(&work, &tmp, &args)
}

/// The launches the log records, one line per launch of the fake tool.
fn launches(log: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// The launches of the run from `--version` on: the calls after the fixture's `setup`.
fn calls_of(launches: &[String]) -> usize {
    launches
        .iter()
        .skip_while(|line| line.as_str() != "--version")
        .count()
}

/// The check ids of the report that are not `pass` (or `unsupported`, a level the tool does not claim), with their reasons.
fn not_passing(output: &Output) -> Vec<String> {
    output.envelope()["data"]["checks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|check| !matches!(check["result"].as_str(), Some("pass" | "unsupported")))
        .map(|check| {
            format!(
                "{} {}: {}",
                check["id"],
                check["result"],
                check["reason"].as_str().unwrap_or_default()
            )
        })
        .collect()
}

/// A conforming run: exit 0, a report that passed, every check passes (nothing failed, nothing unprovided, no advisory).
fn assert_conforms(output: &Output, what: &str) {
    assert_eq!(output.code, Some(0), "{what}: {}", output.stdout);
    let document = output.envelope();
    assert_eq!(
        document["data"]["passed"], true,
        "{what}: {}",
        output.stdout
    );
    let problems = not_passing(output);
    assert!(problems.is_empty(), "{what}: {problems:#?}");
    for check in document["data"]["checks"].as_array().expect("checks") {
        assert!(
            check["advisories"].as_array().is_none_or(Vec::is_empty),
            "{what}: {} has advisories {}",
            check["id"],
            check["advisories"]
        );
    }
}

/// The ids of the checks of the report.
fn ids(output: &Output) -> BTreeSet<String> {
    output.results().into_iter().map(|(id, _)| id).collect()
}

#[test]
fn atip_check14_40_a_conforming_1_3_tool_passes_l0_l1_and_l2_in_both_modes() {
    for level in ["L0", "L1", "L2"] {
        for mode in [Mode::Interface, Mode::Deep] {
            let harness = Harness::new();
            let log = harness.path("runs.log");
            let config = config_for("1.3", level, &log);
            let output = run(&harness, &config, level, mode);
            let what = format!("1.3 {level} {mode:?}");
            assert_conforms(&output, &what);
            let document = output.envelope();
            assert_eq!(
                document["data"]["mode"],
                if mode == Mode::Deep {
                    "deep"
                } else {
                    "interface"
                },
                "{what}"
            );
            let present = ids(&output);
            if level != "L0" {
                // From 1.3 the code names are judged; the rows of 1.4 are not a 1.3 tool's.
                assert!(present.contains("L1.code-names"), "{what}: {present:?}");
                assert_eq!(
                    present.contains("L1.check-order"),
                    mode == Mode::Deep,
                    "{what}"
                );
                for absent in ["L1.schemas", "L1.help-json"] {
                    assert!(
                        !present.contains(absent),
                        "{what}: {absent} is a row of 1.4"
                    );
                }
            }
            if mode == Mode::Interface {
                let launched = launches(&log);
                assert!(calls_of(&launched) <= MOST_CALLS, "{what}: {launched:?}");
            }
        }
    }
}

#[test]
fn atip_check14_41_a_conforming_1_4_tool_passes_l0_l1_and_l2_in_both_modes() {
    for level in ["L0", "L1", "L2"] {
        for mode in [Mode::Interface, Mode::Deep] {
            let harness = Harness::new();
            let log = harness.path("runs.log");
            let config = config_for("1.4", level, &log);
            let output = run(&harness, &config, level, mode);
            let what = format!("1.4 {level} {mode:?}");
            assert_conforms(&output, &what);
            let present = ids(&output);
            if level != "L0" {
                for row in ["L1.code-names", "L1.schemas", "L1.help-json"] {
                    assert!(present.contains(row), "{what}: {row} is not in {present:?}");
                    assert_eq!(output.check(row)["result"], "pass", "{what}: {row}");
                }
            }
            if mode == Mode::Interface {
                let launched = launches(&log);
                assert!(
                    calls_of(&launched) <= MOST_CALLS_1_4,
                    "{what}: {launched:?}"
                );
            }
        }
    }
}

/// The launches of one run: the calls after the fixture's `setup`.
fn calls(claims: &str, level: &str, mode: Mode) -> Vec<String> {
    let harness = Harness::new();
    let log = harness.path("runs.log");
    let config = config_for(claims, level, &log);
    let output = run(&harness, &config, level, mode);
    assert_conforms(&output, &format!("{claims} {level} {mode:?}"));
    let launched = launches(&log);
    launched
        .into_iter()
        .skip_while(|line| line != "--version")
        .collect()
}

#[test]
fn atip_check14_42_the_launches_of_a_1_4_interface_run_and_of_a_default_and_a_deep_run_are_counted()
{
    // An interface run of a 1.4 tool makes the calls of a 1.2 one and four more, each on the one shared copy of the state.
    let l1 = calls("1.4", "L1", Mode::Interface);
    let old = calls("1.3", "L1", Mode::Interface);
    println!("1.4 L1 interface launches: {} ({l1:?})", l1.len());
    println!("1.3 L1 interface launches: {}", old.len());
    // The four calls of 1.4, and the probe's command view that L1.schemas judges the probe's answer against.
    for call in [
        "--help --json",
        "--version --json",
        "schema --schemas --json",
        "schema status --schemas --json",
    ] {
        assert!(
            l1.iter().any(|line| line == call),
            "{call} is not called: {l1:?}"
        );
        assert!(
            !old.iter().any(|line| line == call),
            "a 1.3 run calls {call}"
        );
    }
    assert!(l1.len() <= MOST_CALLS_1_4 && l1.len() > old.len(), "{l1:?}");
    // The deep run asks for the schemas of every command, and the interface run does not.
    let deep = calls("1.4", "L1", Mode::Deep);
    println!("1.4 L1 deep launches: {}", deep.len());
    let schemas = |calls: &[String]| {
        calls
            .iter()
            .filter(|line| line.starts_with("schema ") && line.contains("--schemas"))
            .count()
    };
    assert!(schemas(&l1) <= 2, "{l1:?}");
    assert!(schemas(&deep) > 10, "{deep:?}");
    for call in ["nosuch-xyz --help --json", "nosuch-xyz --version --json"] {
        assert!(
            deep.iter().any(|line| line == call),
            "{call} is a deep call"
        );
        assert!(
            !l1.iter().any(|line| line == call),
            "{call} is not an interface call"
        );
    }
    assert!(
        deep.len() > 4 * l1.len(),
        "deep {} vs interface {}",
        deep.len(),
        l1.len()
    );
    // The same at L2, and at both levels for a 1.3 tool.
    for (claims, level) in [("1.4", "L2"), ("1.3", "L1"), ("1.3", "L2")] {
        let interface = calls(claims, level, Mode::Interface);
        let deep = calls(claims, level, Mode::Deep);
        println!(
            "{claims} {level} launches: interface {}, deep {}",
            interface.len(),
            deep.len()
        );
        assert!(deep.len() > 4 * interface.len(), "{claims} {level}");
    }
}

#[test]
fn atip_check14_43_the_fixtures_of_the_fake_tool_as_a_1_3_and_a_1_4_tool_pass_l0_in_both_modes() {
    // `fake-tool/fixture-1.3.json` and `fixture-1.4.json` are what `just check-minor` runs: the claim, and the registry of a tool whose own code is `STATE_FAILED`.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fake-tool");
    for minor in ["1.3", "1.4"] {
        let text =
            std::fs::read_to_string(dir.join(format!("fixture-{minor}.json"))).expect("fixture");
        let fixture: Value = serde_json::from_str(&text).expect("JSON");
        assert_eq!(fixture["contractVersion"], minor);
        assert!(!text.contains("STATE_ODD") && text.contains("STATE_FAILED"));
        let harness = Harness::new();
        let alias = harness.path(&format!("atip-fake-tool-claims{}", minor.replace('.', "")));
        std::fs::copy(support::FAKE_TOOL, &alias).expect("copy the fake tool");
        let fixture_path = harness.write("fixture.json", &fixture);
        let work = harness.path("cwd");
        std::fs::create_dir_all(&work).expect("cwd");
        let tmp = harness.path("tmp");
        std::fs::create_dir_all(&tmp).expect("tmp");
        for deep in [false, true] {
            let mut args = vec![
                "check",
                "--bin",
                alias.to_str().expect("utf8"),
                "--level",
                "L0",
                "--fixture",
                fixture_path.to_str().expect("utf8"),
                "--json",
            ];
            if deep {
                args.push("--deep");
            }
            let output = atip_as_given(&work, &tmp, &args);
            assert_conforms(&output, &format!("{minor} fixture, deep {deep}"));
            assert_eq!(output.envelope()["data"]["contractVersion"], minor);
        }
    }
}
