//! approaches/checker.md 7.2 for the rows of atip/1 1.3 and 1.4: a check that never fails proves nothing, so each new or changed row is run against a
//! fake tool with one planted violation of one of its conditions. The tests require that the check that owns the condition fails (with a finding of the
//! condition's kind) and that no other does, with the exit the owner's strength says. One case per condition runs by default; every knob runs under
//! `ATIP_CHECK_ALL_SEEDS=1` (`just test-all-seeds`).

mod support;

use std::collections::BTreeSet;

use serde_json::{json, Value};
use support::l1::{l1_case_of, l1_cases_1_3, l1_cases_1_4, relaxed_in_1_3};
use support::l2::{check_of, in_parallel, l2_config_of, not_passing, patch, remove, verdict};
use support::{all_seeds, kind_verdict, Case, Harness, Output};

/// The check that owns the condition of a case: `L0.compact`, `L2.destructive-safety`, `L2.input-refusals`, or an `L1.` one.
fn owner_of(case: &Case) -> String {
    let check = case.condition.split('/').next().unwrap_or_default();
    match check {
        "compact" => "L0.compact".to_string(),
        "destructive-safety" | "input-refusals" => format!("L2.{check}"),
        _ => format!("L1.{check}"),
    }
}

/// The level a case is run at: L2 for the L2 rows (the L2 fake, which is the L1 one with the write commands), else L1.
fn run_level(case: &Case) -> &'static str {
    if owner_of(case).starts_with("L2.") {
        "L2"
    } else {
        "L1"
    }
}

/// `atip check --level <level> --deep --json` of the case's fake tool, with its fixture.
fn run_case(case: &Case, level: &str) -> Output {
    let harness = Harness::new();
    let mut fixture = if level == "L2" {
        harness.l2_fixture(&case.config)
    } else {
        harness.l1_fixture(&case.config)
    };
    if let Some(tweak) = case.tweak {
        tweak(&mut fixture);
    }
    harness.check_l2_at(&case.config, &fixture, level)
}

/// The cases to run: the first of each condition, or every case with `ATIP_CHECK_ALL_SEEDS=1`.
fn chosen(cases: Vec<Case>) -> Vec<Case> {
    if all_seeds() {
        return cases;
    }
    let mut seen = BTreeSet::new();
    cases
        .into_iter()
        .filter(|case| seen.insert(case.condition))
        .collect()
}

/// One seeded violation: the owner fails with a finding of the kind of its condition and no other check fails, and the exit is the strength's.
fn prove(case: &Case) -> Result<(), String> {
    let owner = owner_of(case);
    let output = run_case(case, run_level(case));
    let document = output.envelope();
    if !document["data"]["checks"].is_array() {
        return Err(format!(
            "{}: no report: {}",
            case.condition,
            output.stdout.chars().take(600).collect::<String>()
        ));
    }
    verdict(&document["data"], &owner).map_err(|why| {
        format!(
            "{}: {why}\n{}",
            case.condition,
            not_passing(&document["data"])
        )
    })?;
    kind_verdict(
        &document["data"],
        &owner,
        case.condition.split('/').nth(1).unwrap_or_default(),
    )
    .map_err(|why| format!("{}: {why}", case.condition))?;
    let must = check_of(&document["data"], &owner)["strength"] == "MUST";
    let expected = if must { Some(1) } else { Some(0) };
    if output.code != expected {
        return Err(format!(
            "{}: exit {:?}, expected {expected:?} ({owner} is {})",
            case.condition,
            output.code,
            check_of(&document["data"], &owner)["strength"]
        ));
    }
    if must && document["error"]["code"] != "LEVEL_NOT_MET" {
        return Err(format!(
            "{}: a MUST failure is LEVEL_NOT_MET",
            case.condition
        ));
    }
    Ok(())
}

/// Proves every case of `cases` (six at a time) and fails with all the reasons.
fn prove_all(cases: Vec<Case>) {
    let jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> = cases
        .into_iter()
        .map(|case| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
            Box::new(move || prove(&case))
        })
        .collect();
    let failures: Vec<String> = in_parallel(jobs)
        .into_iter()
        .filter_map(Result::err)
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn atip_check14_44_each_violation_of_a_1_3_row_fails_the_row_that_owns_it_and_no_other_at_a_claim_of_1_3(
) {
    let cases = l1_cases_1_3();
    let owners: BTreeSet<String> = cases.iter().map(owner_of).collect();
    assert_eq!(
        owners.iter().map(String::as_str).collect::<Vec<_>>(),
        [
            "L0.compact",
            "L1.code-names",
            "L1.constraints",
            "L1.registry",
            "L1.tree",
            "L1.walk",
            "L1.warnings"
        ],
        "every row of 1.3 has a violation"
    );
    let conditions: BTreeSet<&str> = cases.iter().map(|case| case.condition).collect();
    for condition in [
        "code-names/grammar",
        "code-names/exit",
        "code-names/retryable",
    ] {
        assert!(
            conditions.contains(condition),
            "{condition} has a violation"
        );
    }
    // `STOPPED_MIDWAY` is a core code in a 1.2 registry only: from 1.3 it ends in no condition, so a registry that has it fails `L1.code-names` (always run: the
    // by-condition choice would drop it as a second case of `code-names/grammar`).
    let (stopped, others): (Vec<Case>, Vec<Case>) = cases
        .into_iter()
        .partition(|case| case.config["stoppedMidway"] == true);
    let mut run = chosen(others);
    run.extend(stopped);
    prove_all(run);
}

#[test]
fn atip_check14_45_each_violation_of_a_1_4_row_fails_the_row_that_owns_it_and_no_other_at_a_claim_of_1_4(
) {
    let cases = l1_cases_1_4();
    let conditions: BTreeSet<&str> = cases.iter().map(|case| case.condition).collect();
    for condition in [
        "compact/no-whitespace",
        "help-json/help-root",
        "help-json/help-unknown",
        "help-json/version",
        "schemas/members",
        "schemas/input",
        "schemas/rejects",
        "schemas/refusals",
        "schemas/kind",
        "schemas/compile",
        "tree/entry-form",
        "walk/no-default-members",
        "reserved-applicable/implied-option",
        "reserved-applicable/implied-code",
    ] {
        assert!(
            conditions.contains(condition),
            "{condition} has a violation"
        );
    }
    prove_all(chosen(cases));
}

/// The L2 rows of 1.4: a destructive command that lists neither `--commit` nor `--plan-digest` fails `L2.destructive-safety` (they are not implied, spec 9.5).
fn l2_case_1_4(condition: &'static str, extra: &Value) -> Case {
    Case {
        condition,
        config: l2_config_of("1.4", extra),
        tweak: None,
    }
}

#[test]
fn atip_check14_46_a_1_4_destructive_command_that_lists_neither_commit_nor_plan_digest_fails_l2_destructive_safety(
) {
    // `--commit` and `--plan-digest` are named in `options` (reserved names); the document that names neither loses the implied `PLAN_STALE`, which the stale-plan runs
    // still get, so the tool lists it as its own code.
    let neither = patch(&[(
        "purge",
        vec![
            json!({"op": "remove-value", "path": "/options", "value": "commit"}),
            json!({"op": "remove-value", "path": "/options", "value": "plan-digest"}),
            remove("/constraints"),
            support::l2::add("/errors/-", json!("PLAN_STALE")),
        ],
    )]);
    let case = l2_case_1_4("destructive-safety/option-present", &neither);
    prove_all(vec![case]);
}

/// The note `L2.input-refusals` makes of the probe of `[]` for a repeatable option (spec 10.5): which of the two answers it observed.
fn empty_array_note(extra: &Value) -> (Output, Vec<String>) {
    let config = l2_config_of("1.4", extra);
    let harness = Harness::new();
    let fixture = harness.l2_fixture(&config);
    let output = harness.check_l2(&config, &fixture);
    let notes = check_of(&output.envelope()["data"], "L2.input-refusals")["notes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|note| note.as_str().map(str::to_string))
        .collect();
    (output, notes)
}

#[test]
fn atip_check14_47_a_tool_that_reads_an_empty_array_as_none_or_refuses_it_passes_and_the_note_names_the_answer_observed(
) {
    let (reads, note_reads) = empty_array_note(&json!({}));
    assert_eq!(
        reads.code,
        Some(0),
        "{}",
        not_passing(&reads.envelope()["data"])
    );
    let (refuses, note_refuses) = empty_array_note(&json!({"emptyArrayRefused": true}));
    assert_eq!(
        refuses.code,
        Some(0),
        "{}",
        not_passing(&refuses.envelope()["data"])
    );
    for (notes, what) in [(&note_reads, "reads"), (&note_refuses, "refuses")] {
        assert!(
            notes.iter().any(|note| note.contains("[]")),
            "the tool that {what} `[]` is told so: {notes:?}"
        );
    }
    assert_ne!(
        note_reads, note_refuses,
        "the note names which answer was observed"
    );
}

/// The advisory a relaxed 1.2 rule leaves at 1.3: the owner is not a MUST failure, the level is met, and a SHOULD failure or an advisory says it.
fn relaxed(owner: &str, config: &Value) -> Result<(), String> {
    let harness = Harness::new();
    let fixture = harness.l1_fixture(config);
    let output = harness.check_l1(config, &fixture);
    let document = output.envelope();
    let data = &document["data"];
    if output.code != Some(0) || data["passed"] != true {
        return Err(format!(
            "{owner} {config}: exit {:?}, the level is not met\n{}",
            output.code,
            not_passing(data)
        ));
    }
    let check = check_of(data, owner);
    let advisory = check["advisories"]
        .as_array()
        .is_some_and(|advisories| !advisories.is_empty())
        || (check["result"] == "fail" && check["strength"] == "SHOULD");
    if !advisory {
        return Err(format!("{owner} {config}: no advisory: {check}"));
    }
    Ok(())
}

#[test]
fn atip_check14_48_the_1_2_violations_of_check_order_and_paging_that_1_3_relaxed_are_advisories_at_a_claim_of_1_3_and_failures_at_1_2(
) {
    let seeds = relaxed_in_1_3();
    let owners: BTreeSet<&str> = seeds.iter().map(|(owner, _)| *owner).collect();
    assert_eq!(
        owners.into_iter().collect::<Vec<_>>(),
        ["L1.check-order", "L1.constraints", "L1.paging"]
    );
    let mut chosen_seeds: Vec<(&str, Value)> = Vec::new();
    let mut seen = BTreeSet::new();
    for (owner, knob) in seeds {
        if all_seeds() || seen.insert(owner) {
            chosen_seeds.push((owner, knob));
        }
    }
    let jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> = chosen_seeds
        .into_iter()
        .map(
            |(owner, knob)| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
                Box::new(move || {
                    let case = l1_case_of("1.3", "relaxed/advisory", knob.clone());
                    relaxed(owner, &case.config)?;
                    // The same violation at a claim of 1.2 fails the row (the `field` of a constraint refusal is judged from 1.3 only).
                    if owner == "L1.constraints" {
                        return Ok(());
                    }
                    let strict = support::l1::l1_config_1_2(&knob);
                    let harness = Harness::new();
                    let fixture = harness.l1_fixture(&strict);
                    let output = harness.check_l1(&strict, &fixture);
                    let failed = output
                        .results()
                        .into_iter()
                        .any(|(id, result)| id == owner && result == "fail");
                    if failed && output.code == Some(1) {
                        Ok(())
                    } else {
                        Err(format!("{owner} {knob}: at 1.2 exit {:?}", output.code))
                    }
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
fn atip_check14_49_the_strength_of_a_row_follows_the_claim() {
    // `L0.compact` and `L1.check-order` are MUST at exactly one claim each (1.4 and 1.2), SHOULD from 1.3 and below 1.4; `L1.code-names` is not run below 1.3,
    // `L1.schemas` and `L1.help-json` not below 1.4.
    let strength = |claims: &str, id: &str| -> Option<String> {
        let harness = Harness::new();
        let config = match claims {
            "1.2" => support::l1::l1_config_1_2(&json!({})),
            "1.3" => support::l1::l1_config_1_3(&json!({})),
            _ => support::l1::l1_config_1_4(&json!({})),
        };
        let fixture = harness.l1_fixture(&config);
        let output = harness.check_l1(&config, &fixture);
        assert_eq!(output.code, Some(0), "{claims}: {}", output.stdout);
        output.envelope()["data"]["checks"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|check| check["id"] == id)
            .and_then(|check| check["strength"].as_str().map(str::to_string))
    };
    assert_eq!(strength("1.2", "L0.compact").as_deref(), Some("SHOULD"));
    assert_eq!(strength("1.3", "L0.compact").as_deref(), Some("SHOULD"));
    assert_eq!(strength("1.4", "L0.compact").as_deref(), Some("MUST"));
    assert_eq!(strength("1.2", "L1.check-order").as_deref(), Some("MUST"));
    assert_eq!(strength("1.3", "L1.check-order").as_deref(), Some("SHOULD"));
    assert_eq!(strength("1.4", "L1.check-order").as_deref(), Some("SHOULD"));
    assert_eq!(strength("1.2", "L1.code-names"), None);
    assert_eq!(strength("1.3", "L1.code-names").as_deref(), Some("MUST"));
    assert_eq!(strength("1.3", "L1.schemas"), None);
    assert_eq!(strength("1.4", "L1.schemas").as_deref(), Some("MUST"));
    assert_eq!(strength("1.4", "L1.help-json").as_deref(), Some("MUST"));
}
