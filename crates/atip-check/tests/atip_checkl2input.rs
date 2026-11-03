//! `atip check --level L2`, the `--input` and batch rows (approaches/checker.md 6, 7.2): the conforming L2 fake passes, and
//! every pass condition of the 15 rows, planted alone in the fake tool, fails the check that owns it and no other. Each test
//! carries the id of the scenario it proves (`atip.checkl2input.NN`).
//!
//! A full run of the checker launches the fake tool about a thousand times, so a scenario that judges one row lists only the
//! commands of the fixture that row runs (`RECORD`, `ENV_WRITES`, `BATCH`), and a scenario that asserts every other check
//! (`verdict`, `not_passing`) keeps the whole fixture. The conforming tool is run once, by scenario 01.

mod support;

use std::collections::BTreeSet;

use atip_check::app::check_binary_mutated;
use atip_check::cli::{CheckArgs, Level};
use serde_json::{json, Value};

use support::l2::{
    check_of, in_parallel, input_cases, l2_config, l2_standard_config, not_passing, owner_of,
    proves, run_case, run_config,
};
use support::{all_seeds, representatives, Case, Harness, Output};

const INPUT_ROWS: [&str; 15] = [
    "L2.input-present",
    "L2.input-example",
    "L2.input-refusals",
    "L2.input-tty",
    "L2.input-usage",
    "L2.input-reasons",
    "L2.input-fragment",
    "L2.input-normalise",
    "L2.input-conflict",
    "L2.input-env",
    "L2.input-pointer",
    "L2.input-dash-values",
    "L2.batch-preflight",
    "L2.batch-incomplete",
    "L2.batch-ok",
];

const BATCH_ROWS: [&str; 3] = ["L2.batch-preflight", "L2.batch-incomplete", "L2.batch-ok"];

/// The commands of the fixture the single-row scenarios below run: the merge of one command's document and argv.
const RECORD: [&str; 1] = ["record put"];
/// The three write commands that read an environment variable (`FAKE_NOTE`, `FAKE_TEAM`, `FAKE_LABEL`).
const ENV_WRITES: [&str; 3] = ["member tag", "team add", "record put"];
/// The write that takes a batch, and the command the batch probes read its page from.
const BATCH: [&str; 2] = ["member tag", "member list"];

/// The owners whose cases `covers_the_conditions` also runs with their condition switched off and their owner forced to pass (every
/// owner under `ATIP_CHECK_ALL_SEEDS=1`), each with the commands of the fixture its case needs.
const MUTATED: [(&str, &[&str]); 2] = [("input-refusals", &ENV_WRITES), ("batch-ok", &BATCH)];

fn results(data: &Value, ids: &[&str]) -> Vec<(String, String)> {
    ids.iter()
        .map(|id| {
            (
                (*id).to_string(),
                check_of(data, id)["result"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            )
        })
        .collect()
}

/// `atip check --level L2` of the fake tool of `config`, with the fixture of the L2 fake cut to the commands in `commands` and then changed by `edit`.
fn run_listing(config: &Value, commands: &[&str], edit: impl FnOnce(&mut Value)) -> Output {
    let harness = Harness::new();
    let mut fixture = harness.l2_fixture(config);
    fixture["commands"]
        .as_object_mut()
        .expect("commands")
        .retain(|id, _| commands.contains(&id.as_str()));
    edit(&mut fixture);
    harness.check_l2(config, &fixture)
}

fn run_with(config: &Value, commands: &[&str]) -> Output {
    run_listing(config, commands, |_| {})
}

/// The argv of every call a check observed.
fn calls(check: &Value) -> Vec<String> {
    check["observed"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|call| call["argv"].to_string())
        .collect()
}

/// Takes the keys `keys` out of the fixture's entry for `member tag`.
fn remove_from_member_tag(fixture: &mut Value, keys: &[&str]) {
    let entry = fixture["commands"]["member tag"]
        .as_object_mut()
        .expect("entry");
    for key in keys {
        entry.remove(*key);
    }
}

fn check_name(condition: &str) -> &str {
    condition.split('/').next().unwrap_or_default()
}

/// A conforming L2 run judges every condition of the rows `checks` that no L1 run judges, each of them has a case, and the cases of `MUTATED` alone:
/// with the condition switched off their owner stops failing, and with the owner forced to pass it stops failing too. (`support::l2::covers` does this
/// for every owner, with about two full runs each.)
fn covers_the_conditions(cases: Vec<Case>, checks: &[&str]) {
    let harness = Harness::new();
    let config = l2_standard_config();
    let fixture = harness.l2_fixture(&config);
    let args = CheckArgs {
        bin: support::l1::l1_bin(&harness, &config).into(),
        level: Level::L2,
        fixture: harness.write("fixture.json", &fixture).into(),
        contract: None,
    };
    let (report, judged) = check_binary_mutated(&args, &[], &[]).expect("a report");
    assert!(report.passed, "{}", report.text());
    let l1_args = CheckArgs {
        level: Level::L1,
        ..args.clone()
    };
    let (_, judged_l1) = check_binary_mutated(&l1_args, &[], &[]).expect("a report");
    let judged: BTreeSet<String> = judged
        .difference(&judged_l1)
        .filter(|condition| checks.contains(&check_name(condition)))
        .cloned()
        .collect();
    let planted: Vec<Case> = cases
        .into_iter()
        .filter(|case| checks.contains(&check_name(case.condition)))
        .collect();
    let named: BTreeSet<String> = planted
        .iter()
        .map(|case| case.condition.to_string())
        .collect();
    let unplanted: Vec<&String> = judged.difference(&named).collect();
    let unjudged: Vec<&String> = named.difference(&judged).collect();
    assert!(
        unplanted.is_empty(),
        "judged by a conforming run and not planted by any case: {unplanted:?}"
    );
    assert!(
        unjudged.is_empty(),
        "planted, never judged by a conforming run: {unjudged:?}"
    );
    let sampled: Vec<Case> = if all_seeds() {
        planted
    } else {
        representatives(planted, |case| owner_of(case.condition))
            .into_iter()
            .filter(|case| {
                MUTATED
                    .iter()
                    .any(|(name, _)| *name == check_name(case.condition))
            })
            .collect()
    };
    let mut seen = BTreeSet::new();
    let sampled: Vec<(Case, bool)> = sampled
        .into_iter()
        .map(|case| {
            let first = seen.insert(owner_of(case.condition));
            (case, first)
        })
        .collect();
    let jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> = sampled
        .into_iter()
        .map(
            |(case, first)| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
                Box::new(move || {
                    let harness = Harness::new();
                    let mut fixture = harness.l2_fixture(&case.config);
                    if let Some(tweak) = case.tweak {
                        tweak(&mut fixture);
                    }
                    if !all_seeds() {
                        let keep = MUTATED
                            .iter()
                            .find(|(name, _)| *name == check_name(case.condition))
                            .map_or(&[][..], |(_, keep)| *keep);
                        fixture["commands"]
                            .as_object_mut()
                            .expect("commands")
                            .retain(|id, _| keep.contains(&id.as_str()));
                    }
                    let args = CheckArgs {
                        bin: support::l1::l1_bin(&harness, &case.config).into(),
                        level: Level::L2,
                        fixture: harness.write("fixture.json", &fixture).into(),
                        contract: None,
                    };
                    let owner = owner_of(case.condition);
                    let failed = |report: &atip_check::report::Report| {
                        report.find(&owner).map(|check| check.result)
                            == Some(atip_check::report::CheckResult::Fail)
                    };
                    if first {
                        let (forced, _) = check_binary_mutated(&args, &[owner.as_str()], &[])
                            .map_err(|failure| {
                                format!("{}: {}", case.condition, failure.message)
                            })?;
                        if failed(&forced) {
                            return Err(format!(
                                "{}: forced to pass, {owner} still fails",
                                case.condition
                            ));
                        }
                    }
                    let (skipped, _) = check_binary_mutated(&args, &[], &[case.condition])
                        .map_err(|failure| format!("{}: {}", case.condition, failure.message))?;
                    if failed(&skipped) {
                        return Err(format!(
                            "{}: with the condition switched off {owner} still fails",
                            case.condition
                        ));
                    }
                    Ok(())
                })
            },
        )
        .collect();
    let failures: Vec<String> = in_parallel(jobs)
        .into_iter()
        .filter_map(Result::err)
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn atip_checkl2input_01_level_l2_runs_the_input_and_batch_rows_and_a_conforming_tool_meets_the_level(
) {
    let output = run_config(&l2_standard_config());
    let document = output.envelope();
    assert_eq!(
        (output.code, document["ok"].as_bool()),
        (Some(0), Some(true)),
        "{}\n{}",
        not_passing(&document["data"]),
        output.stdout
    );
    assert_eq!(document["data"]["level"], "L2");
    for row in INPUT_ROWS {
        assert_eq!(
            check_of(&document["data"], row)["result"],
            "pass",
            "{row}: {}",
            not_passing(&document["data"])
        );
    }
    // The refusal probes are observed.
    let refusals = check_of(&document["data"], "L2.input-refusals");
    assert!(
        refusals["observed"].as_array().map_or(0, Vec::len) > 5,
        "the refusal probes are observed: {refusals}"
    );
    // The three batch rows observed their invocations.
    for row in BATCH_ROWS {
        assert!(
            !calls(check_of(&document["data"], row)).is_empty(),
            "{row} observed its invocations"
        );
    }
    // `L2.input-reasons` is advisory.
    assert_eq!(
        check_of(&document["data"], "L2.input-reasons")["strength"],
        "SHOULD"
    );
    let harness = Harness::new();
    let config = l2_standard_config();
    let fixture = harness.l2_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L3");
    assert_eq!(
        (output.code, output.envelope()["error"]["code"].as_str()),
        (Some(2), Some("USAGE")),
        "{}",
        output.stdout
    );
}

#[test]
fn atip_checkl2input_02_a_tree_whose_level_is_l1_fails_l1_tree_at_l2_and_a_write_without_input_fails_l2_input_present(
) {
    // The L1 fake prints a tree whose level is L1: at L2 its level is not met. Its writes have no `--input`: `L2.input-present` fails too.
    let harness = Harness::new();
    let config = support::l1::l1_standard_config();
    let fixture = harness.l1_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L2");
    let document = output.envelope();
    assert_eq!(
        (output.code, document["error"]["code"].as_str()),
        (Some(1), Some("LEVEL_NOT_MET")),
        "{}",
        output.stdout
    );
    assert_eq!(
        check_of(&document["data"], "L1.tree")["result"],
        "fail",
        "{}",
        not_passing(&document["data"])
    );
    assert_eq!(
        check_of(&document["data"], "L2.input-present")["result"],
        "fail"
    );
}

#[test]
fn atip_checkl2input_03_input_present_and_input_example_judge_the_documents_alone_and_each_condition_fails_only_its_owner(
) {
    proves(input_cases(), &["input-present", "input-example"]);
}

#[test]
fn atip_checkl2input_04_every_refusal_document_is_refused_with_exit_2_and_a_pointer_the_two_key_document_with_two_details(
) {
    proves(input_cases(), &["input-refusals"]);
}

#[test]
fn atip_checkl2input_05_a_tool_that_accepts_a_flag_only_key_in_a_document_fails_only_l2_input_refusals(
) {
    // `commit` and `limit` are both flag-only keys that the checker puts in a document: one proves the rule, the other only under `ATIP_CHECK_ALL_SEEDS=1`.
    let keys: &[&str] = if all_seeds() {
        &["commit", "limit"]
    } else {
        &["commit"]
    };
    for key in keys {
        let case = Case {
            condition: "input-refusals/refused",
            config: l2_config(&json!({"inputAccepts": [key]})),
            tweak: None,
        };
        let output = run_case(&case, "L2");
        support::l2::verdict(&output.envelope()["data"], "L2.input-refusals").unwrap_or_else(
            |why| panic!("{key}: {why}\n{}", not_passing(&output.envelope()["data"])),
        );
    }
}

#[test]
fn atip_checkl2input_06_stdin_on_a_terminal_is_refused_on_input_and_each_condition_of_input_tty_fails_only_it(
) {
    proves(input_cases(), &["input-tty"]);
}

#[test]
fn atip_checkl2input_07_input_usage_is_a_must_for_a_1_1_claim_and_a_malformed_command_line_is_never_input_invalid(
) {
    proves(input_cases(), &["input-usage"]);
}

#[test]
fn atip_checkl2input_08_input_reasons_is_advisory_and_the_level_is_met() {
    // `proves` expects exit 0 and `ok` for a check that is not a MUST; scenario 01 asserts that `L2.input-reasons` is a SHOULD.
    proves(input_cases(), &["input-reasons"]);
}

#[test]
fn atip_checkl2input_09_a_document_and_argv_split_three_ways_and_numeric_strings_give_the_argv_result(
) {
    proves(input_cases(), &["input-fragment", "input-normalise"]);
}

#[test]
fn atip_checkl2input_10_a_different_value_conflicts_with_the_pointer_and_the_same_value_written_another_way_succeeds(
) {
    proves(input_cases(), &["input-conflict"]);
}

#[test]
fn atip_checkl2input_11_an_env_value_applies_after_the_merge_only() {
    proves(input_cases(), &["input-env"]);
}

#[test]
fn atip_checkl2input_12_a_broken_constraint_or_a_missing_key_is_refused_with_the_right_code_and_a_document_pointer(
) {
    proves(input_cases(), &["input-pointer"]);
}

#[test]
fn atip_checkl2input_13_a_value_that_starts_with_a_dash_a_brace_or_a_bracket_is_a_value() {
    proves(input_cases(), &["input-dash-values"]);
}

#[test]
fn atip_checkl2input_14_a_number_beyond_the_safe_range_in_a_document_is_refused_and_l1_numbers_owns_it(
) {
    proves(input_cases(), &["numbers"]);
}

#[test]
fn atip_checkl2input_16_a_first_item_failure_with_exit_2_and_a_preflight_refusal_as_batch_incomplete_each_fail_only_their_row(
) {
    proves(
        input_cases(),
        &["batch-preflight", "batch-incomplete", "batch-ok"],
    );
}

#[test]
fn atip_checkl2input_17_a_tool_with_no_batch_command_has_the_three_batch_rows_unsupported() {
    let case = Case {
        condition: "batch-ok/succeeded",
        config: l2_config(&json!({"noBatch": true})),
        tweak: None,
    };
    let output = run_case(&case, "L2");
    let document = output.envelope();
    assert_eq!(
        output.code,
        Some(0),
        "{}\n{}",
        not_passing(&document["data"]),
        output.stdout
    );
    for row in BATCH_ROWS {
        assert_eq!(
            check_of(&document["data"], row)["result"],
            "unsupported",
            "{row}"
        );
    }
}

#[test]
fn atip_checkl2input_18_a_fixture_without_batch_fails_at_or_first_makes_batch_incomplete_unprovided_and_exits_1(
) {
    // Only the batch rows are judged: the fixture lists `member tag` and the command its probes read a page from.
    let output = run_listing(&l2_standard_config(), &BATCH, |fixture| {
        remove_from_member_tag(fixture, &["batchFailsAt", "batchFailsFirst"]);
    });
    let document = output.envelope();
    assert_eq!(
        (output.code, document["error"]["code"].as_str()),
        (Some(1), Some("LEVEL_NOT_MET")),
        "{}",
        output.stdout
    );
    assert_eq!(
        check_of(&document["data"], "L2.batch-incomplete")["result"],
        "unprovided",
        "{}",
        not_passing(&document["data"])
    );
    assert!(
        results(&document["data"], &["L2.batch-preflight", "L2.batch-ok"])
            .iter()
            .all(|(_, result)| result == "pass")
    );
    // An observed violation is still a failure, not unprovided.
    let output = run_listing(
        &l2_config(&json!({"batchFirstFailPlain": true})),
        &BATCH,
        |fixture| remove_from_member_tag(fixture, &["batchFailsAt"]),
    );
    assert_eq!(
        check_of(&output.envelope()["data"], "L2.batch-incomplete")["result"],
        "fail",
        "{}",
        output.stdout
    );
}

#[test]
fn atip_checkl2input_19_a_malformed_batch_fails_at_or_first_is_fixture_invalid_with_exit_2() {
    for (key, entry) in [
        (
            "batchFailsAt",
            json!([{"input": [{"operands": [3]}], "index": 4}]),
        ),
        ("batchFailsAt", json!([{"input": [], "index": 0}])),
        (
            "batchFailsFirst",
            json!([{"input": [{"operands": [3]}, {"operands": [4]}], "index": 1}]),
        ),
        ("batchFailsFirst", json!({"input": [{}], "index": 0})),
        (
            "batchFailsAt",
            json!([{"input": [{}], "index": 0, "bogus": 1}]),
        ),
    ] {
        let config = l2_standard_config();
        let harness = Harness::new();
        let mut fixture = harness.l2_fixture(&config);
        fixture["commands"]["member tag"][key] = entry.clone();
        let output = harness.check_l2(&config, &fixture);
        let document = output.envelope();
        assert_eq!(
            (
                output.code,
                document["error"]["code"].as_str(),
                document["error"]["reason"].as_str()
            ),
            (Some(2), Some("FIXTURE_INVALID"), Some("WRONG_SHAPE")),
            "{key} {entry}: {}",
            output.stdout
        );
        assert!(
            document["error"]["message"]
                .as_str()
                .unwrap_or_default()
                .contains(key),
            "{}",
            output.stdout
        );
    }
}

#[test]
fn atip_checkl2input_20_a_write_the_fixture_does_not_list_is_named_unlisted_and_never_run_by_an_input_row(
) {
    // The fixture lists neither `record put` nor `member tag`: the rows that need them are `unprovided` and name them, and no input row runs them.
    let listed = ["team add", "member list"];
    let output = run_with(&l2_standard_config(), &listed);
    let data = &output.envelope()["data"];
    assert_eq!(output.code, Some(1), "{}", output.stdout);
    for row in BATCH_ROWS {
        let check = check_of(data, row);
        assert_eq!(check["result"], "unprovided", "{row}: {check}");
        assert!(
            check.to_string().contains("member tag"),
            "{row} names the write: {check}"
        );
    }
    let refusals = check_of(data, "L2.input-refusals");
    assert!(
        refusals["unlisted"]
            .as_array()
            .is_some_and(|names| names.iter().any(|name| name == "record put")),
        "{refusals}"
    );
    let argvs = calls(refusals);
    assert!(
        argvs.iter().all(|argv| !argv.contains("record")),
        "a command the fixture does not list is never run: {argvs:?}"
    );
    // An unlisted write never decides `unsupported`: the rows of the writes that are left out are `unprovided`, as the batch ones above.
    assert_ne!(
        check_of(data, "L2.input-normalise")["result"],
        "unsupported"
    );
    // The same fixture for a tool with no batch at all: nothing to probe, and that is `unsupported`.
    let output = run_with(&l2_config(&json!({"noBatch": true})), &listed);
    for row in BATCH_ROWS {
        assert_eq!(
            check_of(&output.envelope()["data"], row)["result"],
            "unsupported",
            "{row}"
        );
    }
}

#[test]
fn atip_checkl2input_21_every_condition_of_the_input_and_batch_rows_has_a_case_and_the_conforming_tool_judges_each(
) {
    covers_the_conditions(
        input_cases(),
        &[
            "input-present",
            "input-example",
            "input-refusals",
            "input-tty",
            "input-usage",
            "input-reasons",
            "input-fragment",
            "input-normalise",
            "input-conflict",
            "input-env",
            "input-pointer",
            "input-dash-values",
            "batch-preflight",
            "batch-incomplete",
            "batch-ok",
            "numbers",
        ],
    );
}

#[test]
fn atip_checkl2input_15_a_rule_on_flag_only_arguments_is_never_broken_by_a_batch_item() {
    // `member tag` has --keep and --drop, flag-only, at most one: a document cannot carry either, so no item breaks the rule, and the
    // batch is not asked to refuse what the item does not break (canon's `export` with --limit and --all).
    let config = l2_config(&json!({"tagFlagOnlyRule": true}));
    let output = run_config(&config);
    let document = output.envelope();
    assert_eq!(
        (output.code, document["ok"].as_bool()),
        (Some(0), Some(true)),
        "{}\n{}",
        not_passing(&document["data"]),
        output.stdout
    );
    let check = check_of(&document["data"], "L2.batch-preflight");
    assert_eq!(check["result"], "pass", "{check}");
    let argvs = calls(check);
    assert!(
        argvs
            .iter()
            .all(|argv| !argv.contains("--keep") && !argv.contains("--drop")),
        "{argvs:?}"
    );
}

#[test]
fn atip_checkl2input_04_the_exit_number_of_an_input_refusal_is_l0_ok_exits_alone() {
    // INPUT_INVALID answered with exit 1 where the registry says 2, the envelope right: only the owner of the exit fails.
    let output = run_config(&l2_config(&json!({"inputInvalidExit1": true})));
    let data = &output.envelope()["data"];
    support::l2::verdict(data, "L0.ok-exit")
        .unwrap_or_else(|why| panic!("{why}\n{}", not_passing(data)));
}

#[test]
fn atip_checkl2input_04_input_too_large_is_refused_on_input_and_a_pointer_fails_only_l2_input_refusals(
) {
    let output = run_case(
        &Case {
            condition: "input-refusals/field",
            config: l2_config(&json!({"tooLargeField": "/0"})),
            tweak: None,
        },
        "L2",
    );
    let data = &output.envelope()["data"];
    support::l2::verdict(data, "L2.input-refusals")
        .unwrap_or_else(|why| panic!("{why}\n{}", not_passing(data)));
    assert!(
        check_of(data, "L2.input-refusals")["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("INPUT_TOO_LARGE")
            || check_of(data, "L2.input-refusals")["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("maxBytes"),
        "{}",
        check_of(data, "L2.input-refusals")
    );
}

#[test]
fn atip_checkl2input_07_a_finer_replacement_of_usage_names_an_argument_and_a_field_that_names_none_fails_l2_input_usage(
) {
    // Any registered exit-2 code of the tool's own whose field names an argument stands for `USAGE`; a reserved code (`PLAN_STALE`) has a situation of its own.
    let output = run_with(
        &l2_config(&json!({"inputUsageCode": "DEPLOYMENT_NOT_FOUND"})),
        &ENV_WRITES,
    );
    let document = output.envelope();
    assert_eq!(
        check_of(&document["data"], "L2.input-usage")["result"],
        "pass",
        "{}",
        not_passing(&document["data"])
    );
    let output = run_with(
        &l2_config(&json!({"inputUsageCode": "PLAN_STALE"})),
        &ENV_WRITES,
    );
    assert_eq!(
        check_of(&output.envelope()["data"], "L2.input-usage")["result"],
        "fail",
        "{}",
        not_passing(&output.envelope()["data"])
    );
    let output = run_with(
        &l2_config(&json!({"inputUsageCode": "DEPLOYMENT_NOT_FOUND", "inputUsageField": "stdin"})),
        &ENV_WRITES,
    );
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.input-usage");
    assert_eq!(check["result"], "fail", "{check}");
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("registered finer replacement"),
        "{check}"
    );
}

#[test]
fn atip_checkl2input_09_a_value_that_varies_between_two_runs_of_the_reference_is_not_compared_and_the_rest_of_data_still_is(
) {
    // `record put` prints a label with the nanoseconds of the run: the reference run twice on fresh state differs there, so /data/label is varying.
    let output = run_with(&l2_config(&json!({"dataStamp": true})), &RECORD);
    let document = output.envelope();
    for row in ["L2.input-fragment", "L2.input-normalise", "L2.input-env"] {
        assert_eq!(
            check_of(&document["data"], row)["result"],
            "pass",
            "{row}: {}",
            not_passing(&document["data"])
        );
    }
    // A difference in `data` alone, in a member that does not vary between two runs of the argv form (the label of the document form), fails the rows that
    // compare as L2.input-fragment does, on `/data`: the exit, `ok` and the code are the same, so only the comparison of `data` finds it, and removing
    // `/data` from the compared members lets it pass.
    let output = run_with(&l2_config(&json!({"dataFormDiffers": true})), &RECORD);
    let document = output.envelope();
    for row in ["L2.input-fragment", "L2.input-normalise"] {
        let check = check_of(&document["data"], row);
        assert_eq!(check["result"], "fail", "{row}: {check}");
        let reason = check["reason"].as_str().unwrap_or_default();
        assert!(
            reason.contains("/data:")
                && reason.contains("-from-document")
                && !reason.contains("exit ")
                && !reason.contains("/ok:")
                && !reason.contains("/error/code:"),
            "{row}: {reason}"
        );
    }
}

#[test]
fn atip_checkl2input_11_only_an_option_that_is_the_sole_declarer_of_its_env_variable_is_probed_and_with_none_the_row_is_unsupported(
) {
    // Every option that reads the environment reads FAKE_SHARED: none is the sole declarer of its own, whatever its command. (The conforming
    // fake declares three distinct variables and the row judges them: scenario 01.)
    let output = run_with(&l2_config(&json!({"sharedEnv": true})), &ENV_WRITES);
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.input-env");
    assert_eq!(check["result"], "unsupported", "{check}");
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("sole declarer"),
        "{check}"
    );
}

#[test]
fn atip_checkl2input_13_a_candidate_refused_by_a_precondition_cannot_tell_and_the_next_is_tried_and_a_refusal_naming_the_value_is_a_pass(
) {
    // `record put --label` refuses a dash value by a precondition (ALREADY_SEALED, exit 2): the first candidate cannot tell, `--note` decides.
    // (A value read as an option is still found: the case of scenario 13 above.)
    let output = run_with(&l2_config(&json!({"dashPrecondition": true})), &RECORD);
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.input-dash-values");
    assert_eq!(check["result"], "pass", "{check}");
    let argvs = calls(check);
    assert!(
        argvs
            .iter()
            .any(|argv| argv.contains("record") && argv.contains("note")),
        "the next candidate was run: {argvs:?}"
    );
    // Refused with the argument as `field` and the value as `received`: the value was read as a value, a pass for that candidate.
    let output = run_with(
        &l2_config(&json!({"dashPrecondition": true, "dashPreconditionNamed": true})),
        &RECORD,
    );
    assert_eq!(
        check_of(&output.envelope()["data"], "L2.input-dash-values")["result"],
        "pass"
    );
}

#[test]
fn atip_checkl2input_13_a_pointer_into_operands_names_an_operand_candidate_only() {
    // Both option candidates are refused by a precondition naming `/operands` and the value: for an option that is not its pointer, so neither
    // candidate decides and the row is unprovided (it was a pass when any `/operands` field counted).
    let config = l2_config(
        &json!({"dashPrecondition": true, "dashPreconditionNamed": true, "dashPreconditionBoth": true, "dashPreconditionField": "/operands"}),
    );
    let output = run_with(&config, &RECORD);
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.input-dash-values");
    assert_eq!(check["result"], "unprovided", "{check}");
    assert!(check.to_string().contains("ALREADY_SEALED"), "{check}");
    let named = run_with(
        &l2_config(
            &json!({"dashPrecondition": true, "dashPreconditionNamed": true, "dashPreconditionBoth": true}),
        ),
        &RECORD,
    );
    assert_eq!(
        check_of(&named.envelope()["data"], "L2.input-dash-values")["result"],
        "pass"
    );
}

#[test]
fn atip_checkl2input_13_a_framing_refusal_naming_the_value_is_not_a_value_read_as_a_value() {
    // A tool that reads `-x` as an option or `{x` as a document refuses with INPUT_INVALID, the field and the value as `received`: that is the failure.
    let config = l2_config(
        &json!({"dashPrecondition": true, "dashPreconditionNamed": true, "dashPreconditionCode": "INPUT_INVALID"}),
    );
    let output = run_with(&config, &RECORD);
    let document = output.envelope();
    assert_eq!(
        check_of(&document["data"], "L2.input-dash-values")["result"],
        "fail",
        "{}",
        not_passing(&document["data"])
    );
}
