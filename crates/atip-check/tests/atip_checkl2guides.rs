//! `atip check --level L2`, the rows that are the entry of an agent into the tool (approaches/checker.md 6, 7.1, 7.2): `L2.skills`,
//! `L2.guide-commands`, `L2.help-guide`, `L2.stream` and `L2.search`. The conforming L2 fake passes, and every pass condition of
//! the rows, planted alone in the fake tool, fails the check that owns it and no other. Each test carries the id of the scenario it
//! proves (`atip.checkl2guides.NN`).
//!
//! A full L2 run is about a thousand launches of the fake tool, so a test makes one only for what it proves: the conforming run is
//! made once (01), the seeds that are planted alone are one per check (the others with `ATIP_CHECK_ALL_SEEDS=1`), and a test that
//! says more of a seed's run says it of that run.

mod support;

use serde_json::{json, Value};

use support::l2::{
    check_of, covers_together, guide_cases, l2_config, not_passing, prove_case, proves,
};
use support::{all_seeds, kind_verdict, Case, Harness};

fn case_of(condition: &str) -> Case {
    guide_cases()
        .into_iter()
        .find(|case| case.condition == condition)
        .unwrap_or_else(|| panic!("no case {condition}"))
}

fn argvs(check: &Value) -> Vec<String> {
    check["observed"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|call| {
            call["argv"].as_array().map_or(String::new(), |argv| {
                argv.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        })
        .collect()
}

/// The one conforming L2 run of this file, and what it says of each row: `skills show` of each guide and of an unknown name (01), the guide lines (05, 06), the stream (08) and the search (11).
/// The same run judges every condition of the rows (13): each has a case, and a case's seed, planted with the others of its group, fails its owner and
/// stops failing it when its condition is switched off or the owner is forced to pass.
#[test]
fn atip_checkl2guides_01_a_conforming_tool_passes_every_guide_row_and_every_condition_of_the_rows_has_a_case(
) {
    let data = covers_together(
        guide_cases(),
        &["stream", "skills", "guide-commands", "search", "help-guide"],
        &[],
    );
    // 01: `skills show` runs for the default, each guide and a name that is no guide.
    let skills = check_of(&data, "L2.skills");
    assert_eq!(skills["result"], "pass", "{skills}");
    let observed = argvs(skills);
    for call in [
        "skills show --json",
        "skills show overview --json",
        "skills show safety --json",
        "skills show nosuch-xyz --json",
    ] {
        assert!(
            observed.iter().any(|argv| argv == call),
            "{call} is run: {observed:?}"
        );
    }
    assert_eq!(check_of(&data, "L2.help-guide")["result"], "pass");
    // 05: a line with a pipe is skipped and reported (`<SORT>` is an enumeration: its first value; `<MEMBER>` an integer: 1; the line `member list --team <TEAM> --sort <SORT>` parsed).
    let check = check_of(&data, "L2.guide-commands");
    assert_eq!(check["result"], "pass", "{check}");
    let notes = check["notes"].to_string();
    assert!(
        notes.contains("guide overview line") && notes.contains("unsupported"),
        "the pipe line is reported: {check}"
    );
    // 06: the guide has prose that names the tool and a line that does not start with it: neither is judged.
    assert!(!check.to_string().contains("prose"), "{check}");
    assert_eq!(
        atip_check::l2::guide::lines(
            "```\nother status --json\n  fake status --json\n```\nfake status --json\n",
            "fake"
        )
        .len(),
        1
    );
    // 08: the stream is judged for every declared output.
    let stream = check_of(&data, "L2.stream");
    assert_eq!(stream["result"], "pass", "{stream}");
    let observed = argvs(stream);
    for call in [
        "build --json",
        "build --quiet --json",
        "build --target broken --json",
    ] {
        assert!(
            observed.iter().any(|argv| argv == call),
            "{call} is run: {observed:?}"
        );
    }
    // 11: the question of the fixture is answered, and a miss is an advisory.
    let search = check_of(&data, "L2.search");
    assert_eq!(
        (search["result"].as_str(), search["strength"].as_str()),
        (Some("pass"), Some("SHOULD")),
        "{search}"
    );
}

/// 02, 03 and 01 (the second): a guide name left out of the list, a `skills show` that needs state or writes, an unknown name that is accepted: each fails `L2.skills`
/// and no other row. The fixture lists `skills show` under `ok` and the tool, run with the fixture's environment, writes a file, and accepts an unknown name: the
/// one run has both findings, and `L2.effects` leaves the write to `L2.skills`.
#[test]
fn atip_checkl2guides_02_a_skills_show_that_writes_or_accepts_an_unknown_name_fails_l2_skills_alone_and_l2_effects_leaves_the_write_to_it(
) {
    let case = Case {
        condition: "skills/writes-nothing",
        config: l2_config(&json!({
            "skillsPutsFile": true,
            "binAlias": "atip-fake-tool-claims12-l2-skillsputsfile-skillsunknownok"
        })),
        tweak: None,
    }
    .with_tweak(|fixture| {
        fixture["commands"]["skills show"] = json!({"ok": [["skills", "show", "--json"]]});
    });
    let output = prove_case(&case).unwrap_or_else(|why| panic!("{why}"));
    let document = output.envelope();
    let data = &document["data"];
    kind_verdict(data, "L2.skills", "unknown-refused").unwrap_or_else(|why| panic!("{why}"));
    let skills = check_of(data, "L2.skills");
    assert!(
        skills["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("skills show"),
        "{skills}"
    );
    assert!(
        !argvs(check_of(data, "L2.effects"))
            .iter()
            .any(|argv| argv == "skills show --json"),
        "L2.effects does not run the fixture's skills show"
    );
    if all_seeds() {
        proves(guide_cases(), &["skills"]);
    }
}

#[test]
fn atip_checkl2guides_04_a_guide_line_with_a_wrong_option_fails_only_l2_guide_commands_naming_the_guide_and_the_line(
) {
    let output =
        prove_case(&case_of("guide-commands/line-parses")).unwrap_or_else(|why| panic!("{why}"));
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.guide-commands");
    let findings = check["findings"].as_array().cloned().unwrap_or_default();
    assert!(
        findings.iter().any(|finding| finding["message"]
            .as_str()
            .is_some_and(|message| message.contains("guide overview line")
                && message.contains("bogus-option"))),
        "{check}"
    );
}

#[test]
fn atip_checkl2guides_07_a_root_help_first_line_without_skills_show_fails_only_l2_help_guide() {
    proves(guide_cases(), &["help-guide"]);
}

#[test]
fn atip_checkl2guides_09_a_stream_without_an_end_line_an_event_that_breaks_its_schema_and_a_start_before_the_usage_error_fail_only_l2_stream(
) {
    proves(guide_cases(), &["stream"]);
}

/// 11: the question of the fixture finds the expected command in the first five, and the sixth is an advisory: the seed that ranks it last fails `L2.search`,
/// which is a SHOULD, so the level is met.
#[test]
fn atip_checkl2guides_11_the_question_of_the_fixture_finds_the_expected_command_in_the_first_five_and_the_sixth_is_an_advisory(
) {
    let cases: Vec<Case> = guide_cases()
        .into_iter()
        .filter(|case| all_seeds() || case.condition == "search/expected-in-the-first-five")
        .collect();
    proves(cases, &["search"]);
}

/// 10 and 12: a tool without a stream command has `L2.stream` unsupported, and one without `schema --search` has `L2.search` unsupported.
#[test]
fn atip_checkl2guides_10_a_tool_without_a_stream_command_or_schema_search_has_l2_stream_and_l2_search_unsupported(
) {
    let harness = Harness::new();
    let config = support::l1::l1_standard_config();
    let fixture = harness.l1_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L2");
    let document = output.envelope();
    assert_eq!(
        check_of(&document["data"], "L2.stream")["result"],
        "unsupported",
        "{}",
        check_of(&document["data"], "L2.stream")
    );
    assert_eq!(
        check_of(&document["data"], "L2.search")["result"],
        "unsupported"
    );
}

/// 10 and 12: a command the fixture names under `notRun` (it says in its document that it does not end on its own) is run once by the L0 part, and never by an L2
/// row; and a tool that has `schema --search` and a fixture with no question has `L2.search` unprovided, which, a SHOULD, does not decide the level.
#[test]
fn atip_checkl2guides_12_a_server_command_is_left_out_of_the_l2_rows_and_a_search_with_no_question_is_unprovided(
) {
    let config = l2_config(&json!({"serveMode": "serve"}));
    let harness = Harness::new();
    let mut fixture = harness.l2_fixture(&config);
    fixture["notRun"] = json!(["serve"]);
    fixture.as_object_mut().expect("fixture").remove("search");
    let output = harness.check_l2(&config, &fixture);
    let document = output.envelope();
    assert_eq!(
        (output.code, document["ok"].as_bool()),
        (Some(0), Some(true)),
        "a SHOULD row does not decide the level: {}\n{}",
        not_passing(&document["data"]),
        output.stdout
    );
    assert_eq!(
        check_of(&document["data"], "L2.search")["result"],
        "unprovided",
        "{}",
        check_of(&document["data"], "L2.search")
    );
    for row in [
        "L2.stream",
        "L2.effects",
        "L2.skills",
        "L2.guide-commands",
        "L2.idempotency",
        "L2.operation-key",
    ] {
        assert!(
            !argvs(check_of(&document["data"], row))
                .iter()
                .any(|argv| argv.starts_with("serve")),
            "{row} never runs a notRun command"
        );
    }
}

#[test]
fn atip_checkl2guides_14_the_checker_itself_passes() {
    let harness = Harness::new();
    let fixture = harness.path("fixture-copy.json");
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("atip.fixture.json");
    std::fs::copy(&source, &fixture).expect("copy the fixture");
    let work = harness.path("cwd");
    std::fs::create_dir_all(&work).expect("cwd");
    std::fs::copy(&source, work.join("atip.fixture.json")).expect("copy next to the invocations");
    let tmp = harness.path("tmp");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let output = support::atip_in(
        &work,
        &tmp,
        &[
            "check",
            "--bin",
            support::ATIP,
            "--level",
            "L0",
            "--fixture",
            fixture.to_str().expect("utf8"),
            "--json",
        ],
    );
    assert_eq!(
        (output.code, output.envelope()["data"]["passed"].as_bool()),
        (Some(0), Some(true)),
        "{}",
        output.stdout
    );
}
