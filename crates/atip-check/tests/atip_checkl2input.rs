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
    check_of, in_parallel, input_cases, l2_config, l2_standard_config, mutations_hold, not_passing,
    owner_of, planted_together, prove_case, proves, run_case, run_config, Planted,
};
use support::{all_seeds, kind_verdict, representatives, Case, Harness, Output};

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

/// The seeds of the rows planted together in one fake: the groups `planted_together` makes, and the groups that differ only in the `docPatch` of other
/// commands made one (`planted_together` keeps two `docPatch` apart, though they change two documents).
fn planted_in_few_runs(seeds: Vec<Case>) -> Vec<Planted> {
    let mut merged: Vec<Planted> = Vec::new();
    for group in planted_together(seeds, |case| owner_of(case.condition)) {
        match merged.iter_mut().find(|held| joins(held, &group)) {
            Some(held) => absorb(held, group),
            None => merged.push(group),
        }
    }
    merged
}

fn doc_patches(group: &Planted) -> Option<&serde_json::Map<String, Value>> {
    group.config.get("docPatch").and_then(Value::as_object)
}

/// Whether `other` can be planted with `held`: other owners, and every member of the configuration the same or only in one, but for the `docPatch` of
/// commands that only one of them changes.
fn joins(held: &Planted, other: &Planted) -> bool {
    let (Some(config), Some(extra)) = (held.config.as_object(), other.config.as_object()) else {
        return false;
    };
    other
        .owners
        .iter()
        .all(|owner| !held.owners.contains(owner))
        && extra.iter().all(|(key, value)| match config.get(key) {
            None => true,
            Some(_) if key == "docPatch" => doc_patches(held)
                .zip(value.as_object())
                .is_some_and(|(a, b)| b.keys().all(|command| !a.contains_key(command))),
            Some(held_value) => held_value == value,
        })
}

fn absorb(held: &mut Planted, other: Planted) {
    let held_patches = doc_patches(held).cloned().unwrap_or_default();
    for (key, value) in other.config.as_object().into_iter().flatten() {
        if key == "docPatch" {
            let mut patches = held_patches.clone();
            patches.extend(
                value
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(k, v)| (k.clone(), v.clone())),
            );
            held.config[key.as_str()] = Value::Object(patches);
        } else {
            held.config[key.as_str()] = value.clone();
        }
    }
    held.tweaks.extend(other.tweaks);
    held.owners.extend(other.owners);
    held.conditions.extend(other.conditions);
}

/// The first seed of each owner.
fn first_of_each_owner(cases: Vec<Case>) -> Vec<Case> {
    let mut seen = BTreeSet::new();
    cases
        .into_iter()
        .filter(|case| seen.insert(owner_of(case.condition)))
        .collect()
}

/// Every owner fails with a reason and rule numbers, and every other check passes or does not apply.
fn fails_only(data: &Value, owners: &[String]) -> Result<(), String> {
    let checks = data["checks"].as_array().ok_or("data.checks is missing")?;
    for check in checks {
        let id = check["id"].as_str().unwrap_or_default();
        let result = check["result"].as_str().unwrap_or_default();
        if owners.iter().any(|owner| owner == id) {
            if result != "fail" {
                return Err(format!("{id} is {result}, expected fail"));
            }
            if check["reason"].as_str().is_none_or(str::is_empty)
                || check["rules"].as_array().is_none_or(Vec::is_empty)
            {
                return Err(format!("{id} fails without a reason and rule numbers"));
            }
        } else if !matches!(result, "pass" | "unsupported") {
            return Err(format!("{id} is {result}, but it was not seeded"));
        }
    }
    Ok(())
}

/// The seeds of `group` planted in one fake: exactly their owners fail, each with the finding kind of its condition, and as they are all MUSTs the run is
/// `LEVEL_FAILED`, exit 1, and the error names every owner.
fn prove_group(group: &Planted) -> Result<(), String> {
    let harness = Harness::new();
    let mut fixture = harness.l2_fixture(&group.config);
    for tweak in &group.tweaks {
        tweak(&mut fixture);
    }
    let output = harness.check_l2(&group.config, &fixture);
    let document = output.envelope();
    let data = &document["data"];
    fails_only(data, &group.owners).map_err(|why| format!("{why}\n{}", not_passing(data)))?;
    for condition in &group.conditions {
        let owner = owner_of(condition);
        kind_verdict(
            data,
            &owner,
            condition.split('/').nth(1).unwrap_or_default(),
        )
        .map_err(|why| format!("{condition}: {why}"))?;
        if check_of(data, &owner)["strength"] != "MUST" {
            return Err(format!("{condition}: {owner} is not a MUST"));
        }
    }
    let got = (output.code, document["ok"].as_bool());
    if got != (Some(1), Some(false)) || document["error"]["code"] != "LEVEL_FAILED" {
        return Err(format!(
            "exit {got:?}, expected LEVEL_FAILED\n{}",
            output.stdout
        ));
    }
    let message = document["error"]["message"].as_str().unwrap_or_default();
    for owner in &group.owners {
        if !message.contains(owner.as_str()) {
            return Err(format!("the error does not name {owner}: {message}"));
        }
    }
    Ok(())
}

/// A conforming L2 run judges every condition of the rows `checks` that no L1 run judges and each of them has a case; the representative seeds, planted
/// together, stop failing when their owners are forced to pass and when their conditions are switched off (`mutations_hold`).
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
    let groups = planted_in_few_runs(representatives(planted, |case| owner_of(case.condition)));
    let failures = mutations_hold(groups, Level::L2, |harness, config| {
        harness.l2_fixture(config)
    });
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
        (Some(1), Some("LEVEL_FAILED")),
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

/// 03, 04 (the refusals), 06 to 14 and 16: a seed of each row, planted together in one fake, fails exactly its own rows, each with the finding kind of its
/// condition, and the error names them (03 `input-present` and `input-example`, which judge the documents alone; 04 `input-refusals`; 06 `input-tty`;
/// 07 `input-usage`; 09 `input-fragment` and `input-normalise`; 10 `input-conflict`; 11 `input-env`; 12 `input-pointer`; 13 `input-dash-values`; 14 `numbers`,
/// which `L1.numbers` owns; 16 the three batch rows). 08: `input-reasons` is advisory, so its seed alone is a failure and the level is met. With
/// `ATIP_CHECK_ALL_SEEDS=1` every seed of every row is run alone as well, each failing its owner and no other.
#[test]
fn atip_checkl2input_03_a_seed_of_each_input_and_batch_row_planted_together_fails_its_own_row_with_its_own_finding_and_nothing_else(
) {
    let seeds = first_of_each_owner(input_cases());
    let owners: BTreeSet<String> = seeds.iter().map(|case| owner_of(case.condition)).collect();
    for row in INPUT_ROWS {
        assert!(owners.contains(row), "{row} has a seeded violation");
    }
    assert!(
        owners.contains("L1.numbers"),
        "numbers has a seeded violation"
    );
    let (advisory, binding): (Vec<Case>, Vec<Case>) = seeds
        .into_iter()
        .partition(|case| check_name(case.condition) == "input-reasons");
    let mut jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> =
        planted_in_few_runs(binding)
            .into_iter()
            .map(|group| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
                Box::new(move || prove_group(&group))
            })
            .collect();
    // The advisory row is planted alone: its failure is no failure of the level.
    jobs.extend(advisory.into_iter().map(
        |case| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
            Box::new(move || prove_case(&case).map(drop))
        },
    ));
    let failures: Vec<String> = in_parallel(jobs)
        .into_iter()
        .filter_map(Result::err)
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    if all_seeds() {
        let names: Vec<&str> = owners
            .iter()
            .map(|owner| {
                owner
                    .split_once('.')
                    .map_or(owner.as_str(), |(_, name)| name)
            })
            .collect();
        proves(input_cases(), &names);
    }
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
        (Some(1), Some("LEVEL_FAILED")),
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
fn atip_checkl2input_07b_a_code_a_constraint_or_a_validator_declares_replaces_usage_when_its_field_names_an_argument(
) {
    // The replacement of `USAGE` is any registered exit-2 code with an argument `field`: the codes a command document declares on a constraint
    // (`SORT_CONFLICT`) or a validator (`DATE_INVALID`) are not excluded.
    for code in ["SORT_CONFLICT", "DATE_INVALID"] {
        let output = run_with(&l2_config(&json!({"inputUsageCode": code})), &ENV_WRITES);
        let document = output.envelope();
        assert_eq!(
            check_of(&document["data"], "L2.input-usage")["result"],
            "pass",
            "{code}: {}",
            not_passing(&document["data"])
        );
    }
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
