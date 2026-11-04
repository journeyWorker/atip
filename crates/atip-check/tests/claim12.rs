//! `atip check` claims atip/1 1.2 (approaches/checker.md 2 and 5-7): `--contract 1.2`, the rows that only a 1.2 claim runs, and the
//! checker's own declaration. Each test carries the id of the scenario it proves (`atip.check.NN`).

mod support;

use serde_json::{json, Value};

use std::collections::BTreeSet;

use atip_check::app::check_binary_mutated;
use atip_check::cli::{CheckArgs, Level};
use support::l1::{l1_bin, l1_cases_1_2, l1_config_1_2, l1_fixture_of};
use support::l2::{check_of, mutations_hold, planted_together};
use support::{all_seeds, atip_in, kind_verdict, representatives, Case, Harness, Output, ATIP};

fn result_of(output: &Output, id: &str) -> String {
    output.check(id)["result"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// The checks of the report that are not `pass`, `unsupported` or `entailed`.
fn failing(output: &Output) -> Vec<String> {
    output
        .results()
        .into_iter()
        .filter(|(_, result)| matches!(result.as_str(), "fail" | "unprovided"))
        .map(|(id, _)| id)
        .collect()
}

#[test]
fn atip_check_99_contract_1_2_from_the_option_or_the_fixture_is_a_claim_of_1_2_and_the_report_carries_it(
) {
    let harness = Harness::new();
    let config = json!({"claims": "1.2"});
    // The fixture alone.
    let fixture = harness.fixture(&config);
    assert_eq!(fixture["contractVersion"], "1.2");
    let output = harness.check(&fixture, true);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    assert_eq!(output.envelope()["data"]["contractVersion"], "1.2");
    assert_eq!(
        output.envelope()["data"]["checks"].as_array().map(Vec::len),
        Some(29)
    );
    assert!(failing(&output).is_empty(), "{:?}", output.results());
    // The option alone.
    let mut without = fixture.clone();
    without
        .as_object_mut()
        .expect("object")
        .remove("contractVersion");
    let output = harness.check_with(&without, true, &["--contract", "1.2"]);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    assert_eq!(output.envelope()["data"]["contractVersion"], "1.2");
    // The same claim in both places.
    assert_eq!(
        harness
            .check_with(&fixture, true, &["--contract", "1.2"])
            .code,
        Some(0)
    );
    // The rules that applied to 1.1 apply to 1.2: a 1.2 tool whose ordinary answer lacks the markers fails `L0.contract-version`.
    let lacking = harness.check_config(&json!({"claims": "1.2", "omitContractVersion": true}));
    assert_eq!(lacking.code, Some(1), "{}", lacking.stdout);
    assert_eq!(failing(&lacking), ["L0.contract-version"]);
    // `L0.hint-form` is a 1.1 and later rule and runs for a claim of 1.2.
    let prose = harness.check_config(&json!({"claims": "1.2", "proseHintStartsWithTool": true}));
    assert_eq!(failing(&prose), ["L0.hint-form"], "{}", prose.stdout);
}

#[test]
fn atip_check_100_a_minor_the_checker_does_not_know_is_refused_before_a_binary_runs_and_a_differing_one_is_a_preview(
) {
    let harness = Harness::new();
    let marker = harness.path("init.log");
    let fixture = harness.fixture(&json!({"claims": "1.2", "initLog": marker}));
    for given in ["1.1", "1.0"] {
        let output = harness.check_with(&fixture, true, &["--contract", given]);
        assert_eq!(output.code, Some(0), "{given}: {}", output.stdout);
        let data = output.envelope()["data"].clone();
        assert_eq!(data["verdict"], "preview", "{given}");
        assert_eq!(data["declaredContractVersion"], "1.2", "{given}");
        assert_eq!(data["contractVersion"], given);
        assert!(marker.exists(), "the setup did not run for the preview");
    }
    std::fs::remove_file(&marker).expect("marker");
    let mut without = fixture.clone();
    without
        .as_object_mut()
        .expect("object")
        .remove("contractVersion");
    let output = harness.check_with(&without, true, &["--contract", "1.5"]);
    let document = output.envelope();
    assert_eq!(
        (
            output.code,
            document["error"]["code"].as_str(),
            document["error"]["field"].as_str()
        ),
        (Some(2), Some("USAGE"), Some("--contract")),
        "{}",
        output.stdout
    );
    assert_eq!(
        document["error"]["expected"],
        json!(["1.0", "1.1", "1.2", "1.3", "1.4"])
    );
    assert!(!marker.exists());
    // A fixture that claims another minor is refused as a fixture.
    let mut other = fixture.clone();
    other["contractVersion"] = json!("1.5");
    let output = harness.check(&other, true);
    assert_eq!(
        (output.code, output.envelope()["error"]["code"].as_str()),
        (Some(2), Some("FIXTURE_INVALID")),
        "{}",
        output.stdout
    );
    assert!(
        output.envelope()["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("1.2"),
        "{}",
        output.stdout
    );
    assert!(!marker.exists());
}

#[test]
fn atip_check_101_a_1_2_claim_whose_plain_answer_says_1_1_fails_l0_contract_version() {
    let harness = Harness::new();
    let output = harness.check_config(&json!({"claims": "1.2", "contractVersionSays": "1.1"}));
    assert_eq!(output.code, Some(1), "{}", output.stdout);
    assert_eq!(
        failing(&output),
        ["L0.contract-version"],
        "{:?}",
        output.results()
    );
    let check = output.check("L0.contract-version");
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("the claim is \"1.2\""),
        "{check}"
    );
    assert!(
        check["findings"].as_array().is_some_and(|findings| findings
            .iter()
            .all(|finding| finding["kind"] == "version-is-claim")),
        "{check}"
    );
    // The same answers are right for a 1.1 claim.
    assert_eq!(
        harness
            .check_config(&json!({"contractVersionSays": "1.1"}))
            .code,
        Some(0)
    );
}

#[test]
fn atip_check_102_the_checker_declares_1_4_and_passes_its_own_l0_checks_as_a_1_4_claim() {
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("atip.fixture.json");
    let fixture = fixture.to_str().expect("utf8");
    let args = [
        "check",
        "--bin",
        ATIP,
        "--level",
        "L0",
        "--fixture",
        fixture,
        "--contract",
        "1.4",
        "--json",
    ];
    let output = atip_in(&cwd, &tmp, &args);
    assert_eq!(output.code, Some(0), "{}{}", output.stdout, output.stderr);
    let document = output.envelope();
    assert_eq!(document["meta"]["contractVersion"], "1.4");
    assert_eq!(document["data"]["contractVersion"], "1.4");
    assert_eq!(document["data"]["passed"], true);
    // The fixture is the one that declares it, and the checker run as a 1.1 claim is a preview, not a refusal.
    let committed: Value =
        serde_json::from_str(&std::fs::read_to_string(fixture).expect("fixture")).expect("json");
    assert_eq!(committed["contractVersion"], "1.4");
    let mut other = args.to_vec();
    other[8] = "1.1";
    let preview = atip_in(&cwd, &tmp, &other);
    assert_eq!(preview.code, Some(0), "{}", preview.stdout);
    assert_eq!(preview.envelope()["data"]["verdict"], "preview");
    // The help and the messages say the three minors and name no list of two.
    let help = atip_in(&cwd, &tmp, &["check", "--help"]);
    let text = format!("{}{}", help.stdout, help.stderr);
    assert!(text.contains("1.0, 1.1, 1.2, 1.3 or 1.4"), "{text}");
    for old in ["1.0 or 1.1", "1.0 and 1.1", "1.0, 1.1\n"] {
        assert!(!text.contains(old), "{old:?} in {text}");
    }
    for source in ["cli.rs", "fixture.rs", "app.rs", "claim.rs"] {
        let code = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join(source),
        )
        .expect("source");
        assert!(
            !code.contains("1.0 or 1.1") && !code.contains("1.0 or `1.1`"),
            "{source} names two minors"
        );
    }
}

/// `atip check --level L1` of the fake tool of `config`, with `fixture`.
fn run_l1(harness: &Harness, config: &Value, fixture: &Value) -> Output {
    harness.check_l1(config, fixture)
}

/// The owner of a 1.2 case (`L1.<check>`).
fn owner_of(case: &Case) -> String {
    format!(
        "L1.{}",
        case.condition.split('/').next().unwrap_or_default()
    )
}

/// The case's run at a claim of 1.2.
fn run_case(case: &Case) -> Output {
    let harness = Harness::new();
    let fixture = l1_fixture_of(&harness, case);
    run_l1(&harness, &case.config, &fixture)
}

/// A failure to say what the case's run printed, when it is not a report.
fn report_of(output: &Output, case: &Case) -> Result<Value, String> {
    let document = output.envelope();
    if document["data"]["checks"].is_array() {
        Ok(document["data"].clone())
    } else {
        Err(format!(
            "{}: no report: {}",
            case.condition,
            output.stdout.chars().take(500).collect::<String>()
        ))
    }
}

/// Exactly `owner` fails (or is unprovided), with a reason, rules and findings of the kind of its condition.
fn only_owner_fails(output: &Output, case: &Case) -> Result<(), String> {
    let data = report_of(output, case)?;
    let owner = owner_of(case);
    let failing: Vec<String> = failing(output);
    if failing != [owner.clone()] {
        return Err(format!(
            "{}: {failing:?} fail, expected only {owner}\n{}",
            case.condition,
            output.stdout.chars().take(800).collect::<String>()
        ));
    }
    kind_verdict(
        &data,
        &owner,
        case.condition.split('/').nth(1).unwrap_or_default(),
    )
    .map_err(|why| format!("{}: {why}", case.condition))
}

/// Runs `jobs` on six threads.
fn in_parallel(jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>>) -> Vec<String> {
    let queue = std::sync::Mutex::new(jobs);
    let failures = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..6 {
            scope.spawn(|| loop {
                let next = queue.lock().expect("queue").pop();
                let Some(job) = next else { break };
                if let Err(why) = job() {
                    failures.lock().expect("failures").push(why);
                }
            });
        }
    });
    failures.into_inner().expect("failures")
}

/// `atip check --level L1` of the fake tool of `config` in this process: its report as JSON (what `data` is), whether the level is met, and the conditions it judged.
fn l1_report(config: &Value) -> (Value, bool, BTreeSet<String>) {
    let harness = Harness::new();
    let fixture = harness.l1_fixture(config);
    let args = CheckArgs {
        bin: l1_bin(&harness, config).into(),
        level: Level::L1,
        fixture: harness.write("fixture.json", &fixture).into(),
        contract: None,
    };
    let (report, judged) = check_binary_mutated(&args, &[], &[]).expect("a report");
    (
        serde_json::to_value(&report).expect("the report is JSON"),
        report.passed,
        judged,
    )
}

/// The ids of the checks of a report that are `fail` or `unprovided`.
fn failing_in(data: &Value) -> Vec<&str> {
    data["checks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|check| matches!(check["result"].as_str(), Some("fail" | "unprovided")))
        .filter_map(|check| check["id"].as_str())
        .collect()
}

fn ids_in(data: &Value) -> Vec<String> {
    data["checks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|check| check["id"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn atip_check_103_each_1_2_violation_fails_the_row_that_owns_it_and_no_other_row_at_a_claim_of_1_2()
{
    let cases = l1_cases_1_2();
    let owners: BTreeSet<String> = cases.iter().map(owner_of).collect();
    assert_eq!(
        owners.iter().map(String::as_str).collect::<Vec<_>>(),
        [
            "L1.check-order",
            "L1.constraints",
            "L1.fields",
            "L1.grammar",
            "L1.paging",
            "L1.registry"
        ],
        "every 1.2 row has a violation"
    );
    let jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> =
        representatives(cases, owner_of)
            .into_iter()
            .map(|case| -> Box<dyn FnOnce() -> Result<(), String> + Send> {
                Box::new(move || {
                    let output = run_case(&case);
                    only_owner_fails(&output, &case)?;
                    let expected_exit = if matches!(
                        owner_of(&case).as_str(),
                        "L1.paging"
                            | "L1.check-order"
                            | "L1.constraints"
                            | "L1.grammar"
                            | "L1.registry"
                            | "L1.fields"
                    ) {
                        Some(1)
                    } else {
                        Some(0)
                    };
                    // The registry reserved exit and the MUST rows fail the level; `L1.grammar` and `L1.registry` judge MUST rules too.
                    if output.code != expected_exit && output.code != Some(0) {
                        return Err(format!("{}: exit {:?}", case.condition, output.code));
                    }
                    // At 1.2 the reason of a reserved exit names the code.
                    if owner_of(&case) == "L1.registry"
                        && !output.check("L1.registry")["reason"]
                            .as_str()
                            .unwrap_or_default()
                            .contains("STOPPED_MIDWAY")
                    {
                        return Err(format!(
                            "{}: the reason does not name STOPPED_MIDWAY",
                            case.condition
                        ));
                    }
                    Ok(())
                })
            })
            .collect();
    let failures = in_parallel(jobs);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// A conforming 1.2 tool, in one run: it passes (the registry lists `STOPPED_MIDWAY` with exit 1, 107), `L1.check-order` is in its report and every pair is run (110). Then its
/// violations, planted together in a tool that claims 1.1 (104, 105): none fails a row, a 1.1 registry may use the name as its own (107), and the report differs from the 1.2 one
/// only in `L1.check-order`. Then every 1.2 condition the conforming run judges has a case, and the seeds, planted together, stop failing when the owner is forced to pass or the
/// condition is switched off (106).
#[test]
fn atip_check_105_a_conforming_1_2_tool_passes_and_its_violations_at_a_claim_of_1_1_fail_no_row_and_every_1_2_condition_a_conforming_run_judges_has_a_case(
) {
    let config_12 = l1_config_1_2(&json!({"stoppedMidway": true}));
    let (at_12, passed, judged_12) = l1_report(&config_12);
    assert!(passed, "{:?}", failing_in(&at_12));
    assert_eq!(
        at_12["checks"].as_array().map(Vec::len),
        Some(61),
        "28 L0 and 32 L1 checks, and L2.effects"
    );
    for id in ["L1.check-order", "L1.registry"] {
        assert_eq!(check_of(&at_12, id)["result"], "pass", "{id}");
    }
    check_order_pairs(check_of(&at_12, "L1.check-order"));
    // The violations of every 1.2 row, in a tool that claims 1.1 and gives `STOPPED_MIDWAY` the exit 2 and retryable: all of them are the tool's own there.
    let groups = planted_together(representatives(l1_cases_1_2(), owner_of), owner_of);
    let mut judged_11 = BTreeSet::new();
    for (index, group) in groups.iter().enumerate() {
        let mut config_11 = group.config.clone();
        config_11["claims"] = json!("1.1");
        config_11
            .as_object_mut()
            .expect("object")
            .remove("binAlias");
        if config_11.get("stoppedMidway").is_some() {
            config_11["stoppedMidwayRetryable"] = json!(true);
            config_11["stoppedMidwayExit2"] = json!(true);
        }
        let (at_11, passed, judged) = l1_report(&config_11);
        assert!(passed, "{:?}", failing_in(&at_11));
        assert!(
            failing_in(&at_11).is_empty(),
            "a 1.1 claim fails {:?}",
            failing_in(&at_11)
        );
        assert_eq!(at_11["contractVersion"], "1.1");
        let (ids_12, ids_11) = (ids_in(&at_12), ids_in(&at_11));
        assert_eq!(ids_11.len(), 60);
        let only_12: Vec<&String> = ids_12.iter().filter(|id| !ids_11.contains(id)).collect();
        assert_eq!(only_12, ["L1.check-order"], "{index}");
        if index == 0 {
            judged_11 = judged;
            // `L1.check-order` stands behind `L1.validators`, and no row that ran at 1.1 changed its result.
            let at = ids_12
                .iter()
                .position(|id| id == "L1.check-order")
                .expect("position");
            assert_eq!(ids_12[at - 1], "L1.validators");
            for id in &ids_11 {
                assert_eq!(
                    check_of(&at_11, id)["result"],
                    check_of(&at_12, id)["result"],
                    "{id}"
                );
            }
        }
    }
    let only_12: BTreeSet<String> = judged_12.difference(&judged_11).cloned().collect();
    let planted: BTreeSet<String> = l1_cases_1_2()
        .iter()
        .map(|case| case.condition.to_string())
        .collect();
    let unplanted: Vec<&String> = only_12.difference(&planted).collect();
    assert!(
        unplanted.is_empty(),
        "judged only by a 1.2 conforming run and planted by no case: {unplanted:?}"
    );
    assert!(!only_12.is_empty());
    // With its own condition switched off the owner no longer fails, and forced to pass it does not either.
    let failures = mutations_hold(groups, Level::L1, |harness, config| {
        harness.l1_fixture(config)
    });
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn atip_check_109_a_tool_with_no_invocation_to_change_has_check_order_unprovided_and_the_level_is_not_met(
) {
    // No fixture invocation and no example to change: unprovided, a MUST, so the level is not met. (A command under `notRun` is not unsupported: its refused pairs still run, atip.check.120.)
    let harness = Harness::new();
    let no_examples = l1_config_1_2(&json!({"noExamples": true}));
    let mut fixture = harness.l1_fixture(&no_examples);
    fixture["commands"] = json!({});
    let output = run_l1(&harness, &no_examples, &fixture);
    let check = output.check("L1.check-order");
    assert_eq!(check["result"], "unprovided", "{check}");
    assert!(
        check["findings"]
            .as_array()
            .is_some_and(|findings| !findings.is_empty()
                && findings
                    .iter()
                    .all(|finding| finding["kind"] == "missing-fixture-entry"
                        && finding["message"].as_str().is_some_and(|name| name
                            .starts_with("commands.")
                            && name.ends_with(".ok")))),
        "{check}"
    );
    assert_eq!(
        output.code,
        Some(1),
        "{}",
        output.stdout.chars().take(300).collect::<String>()
    );
    assert!(
        output.envelope()["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("L1.check-order"),
        "{}",
        output.stdout.chars().take(300).collect::<String>()
    );
}

/// 110: every stage pair a command can have is run, and a pair that needs a third fault is not: what the pass of `L1.check-order` says of its pairs.
fn check_order_pairs(check: &Value) {
    assert_eq!(check["result"], "pass", "{check}");
    // The report says each pair it judged, with the invocation of the earlier fault alone that its answer is compared with: `<command>: <pair> (`<pair argv>` against `<alone argv>`)`.
    let notes: Vec<String> = check["notes"]
        .as_array()
        .expect("notes")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    let parse = |note: &str| -> (String, String, Vec<String>, Vec<String>) {
        let (command, rest) = note.split_once(": ").expect("command");
        let (kind, runs) = rest.split_once(" (`").expect("kind");
        let (pair, alone) = runs
            .trim_end_matches(')')
            .trim_end_matches('`')
            .split_once("` against `")
            .expect("runs");
        (
            command.to_string(),
            kind.to_string(),
            pair.split(' ').map(str::to_string).collect(),
            alone.split(' ').map(str::to_string).collect(),
        )
    };
    let pairs: Vec<(String, String, Vec<String>, Vec<String>)> =
        notes.iter().map(|note| parse(note)).collect();
    // The fake has every kind of the brief (F3) in some command, and a command has at most two pairs of a kind: the exact table of what is run.
    let mut table: Vec<String> = pairs
        .iter()
        .map(|(command, kind, _, _)| format!("{command}: {kind}"))
        .collect();
    table.sort();
    let mut expected: Vec<String> = Vec::new();
    let mut add = |command: &str, kind: &str, times: usize| {
        for _ in 0..times {
            expected.push(format!("{command}: {kind}"));
        }
    };
    for command in [
        "items",
        "member list",
        "member search",
        "member tag",
        "schema",
        "status",
        "team add",
        "touch",
    ] {
        add(command, "two unknown options", 1);
    }
    for command in ["member list", "member search", "member tag"] {
        add(
            command,
            "an unknown option and a value of the wrong type",
            1,
        );
    }
    for command in ["member tag", "touch"] {
        add(
            command,
            "an unknown option and a missing required argument",
            1,
        );
    }
    add(
        "member tag",
        "a missing required argument and a broken domain",
        2,
    );
    add(
        "member tag",
        "a missing required argument and a broken constraint",
        1,
    );
    add("member tag", "two broken domains", 2);
    add("member search", "two broken domains", 2);
    add("member tag", "a broken domain and a broken constraint", 2);
    add(
        "member search",
        "a broken domain and a broken constraint",
        2,
    );
    add("member list", "a broken domain and a broken constraint", 1);
    add("member search", "two constraints with different codes", 2);
    add(
        "member search",
        "a constraint and a validator with different codes",
        2,
    );
    expected.sort();
    assert_eq!(
        table, expected,
        "the pairs the check runs, by command and kind"
    );
    // Each pair is its earlier fault alone plus one more change; a pair that needed a third fault would differ from it by more.
    for (command, kind, pair, alone) in &pairs {
        assert_ne!(pair, alone, "{command}: {kind}");
        // The pair of a constraint and a validator starts from the validator's own `rejects` invocation, not from the fixture's: it differs from the alone run by what the two start from.
        if kind.contains("validator") {
            continue;
        }
        let (only_pair, only_alone): (Vec<&String>, Vec<&String>) = (
            pair.iter().filter(|word| !alone.contains(word)).collect(),
            alone.iter().filter(|word| !pair.contains(word)).collect(),
        );
        assert!(
            only_pair.len() + only_alone.len() <= 3,
            "{command}: {kind}: `{}` differs from `{}` by {only_pair:?} and {only_alone:?}",
            pair.join(" "),
            alone.join(" ")
        );
    }
    // Both runs of each pair are in the observed list: the check does not hide the answer its verdict rests on.
    let observed: Vec<String> = check["observed"]
        .as_array()
        .expect("observed")
        .iter()
        .map(|call| {
            call["argv"]
                .as_array()
                .expect("argv")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    for (_, _, pair, alone) in &pairs {
        assert!(
            observed.contains(&pair.join(" ")) && observed.contains(&alone.join(" ")),
            "{pair:?} and {alone:?} are observed"
        );
    }
    // A command a pair of two kinds cannot be made for gets none: `member search` has no required argument and `touch` no domain or constraint.
    assert!(pairs
        .iter()
        .all(
            |(command, kind, _, _)| !(command == "member search" && kind.contains("required"))
                && !(command == "touch"
                    && (kind.contains("domain") || kind.contains("constraint")))
        ));
}

#[test]
fn atip_check_112_the_tally_examples_fail_no_1_2_rule_and_a_1_2_document_with_a_limit_that_is_not_flag_only_is_refused(
) {
    use atip_check::checks::documents::{grammar_findings, minor_of, registry_findings};
    use atip_check::claim::Claim;
    use atip_check::l1::model::CommandDoc;
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let read = |path: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(dir.join(path)).expect("example"))
            .expect("json")
    };
    // `tally` is a 1.1 tool: its `limit` is not flag-only and its `STOPPED_MIDWAY` is retryable, and neither is a failure at the claim it makes.
    let tally = read("schema-docs/schema-command-tally-entry-list.json");
    let doc = CommandDoc::parse(&tally["data"]).expect("a command document");
    assert!(
        doc.options
            .iter()
            .any(|option| option.name == "limit" && !option.flag_only),
        "tally has an unmarked --limit"
    );
    assert!(grammar_findings(&[], Some(&doc), minor_of(Claim::V1_1))
        .iter()
        .all(|(_, problem)| problem.is_none()));
    assert!(
        grammar_findings(&[], Some(&doc), minor_of(Claim::V1_2))
            .iter()
            .any(|(_, problem)| problem
                .as_deref()
                .is_some_and(|text| text.contains("limit"))),
        "the 1.2 rule names --limit"
    );
    let errors = read("schema-docs/schema-errors-tally.json");
    let entries: Vec<Value> = errors["data"]["errors"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        entries
            .iter()
            .any(|entry| entry["code"] == "STOPPED_MIDWAY" && entry["retryable"] == true),
        "tally's STOPPED_MIDWAY is retryable"
    );
    assert!(registry_findings(&entries, minor_of(Claim::V1_1))
        .iter()
        .all(|(_, problem)| problem.is_none()));
    assert!(registry_findings(&entries, minor_of(Claim::V1_2))
        .iter()
        .any(|(_, problem)| problem
            .as_deref()
            .is_some_and(|text| text.contains("STOPPED_MIDWAY"))));
    // `acme` is a 1.2 tool: its documents pass the 1.2 rules and the same document with `limit` unmarked does not.
    let acme = read("schema-docs/schema-command-acme-member-list.json");
    let doc = CommandDoc::parse(&acme["data"]).expect("a command document");
    assert!(grammar_findings(&[], Some(&doc), minor_of(Claim::V1_2))
        .iter()
        .all(|(_, problem)| problem.is_none()));
    let broken =
        read("schema-docs/invalid/schema-command-acme-member-list-limit-not-flag-only.json");
    let doc = CommandDoc::parse(&broken["data"]).expect("a command document");
    assert!(grammar_findings(&[], Some(&doc), minor_of(Claim::V1_2))
        .iter()
        .any(|(_, problem)| problem
            .as_deref()
            .is_some_and(|text| text.contains("limit"))));
    // The examples are on TABLE.md and in the list the tests read.
    let table = std::fs::read_to_string(dir.join("atip-examples/TABLE.md")).expect("table");
    for row in [
        "schema-errors-tally.json",
        "report-failure-acme-deploy-start-stopped-midway.json",
        "invalid/schema-errors-acme-stopped-midway-exit-2.json",
        "invalid/stream-acme-build-start-contract-version-1-0.ndjson",
    ] {
        assert!(table.contains(row), "TABLE.md has a row for {row}");
    }
}

#[test]
fn atip_check_122_a_1_2_document_whose_cursor_all_or_fields_is_not_flag_only_and_a_retryable_stopped_midway_fail_at_1_2_only(
) {
    use atip_check::checks::documents::{grammar_findings, minor_of, registry_findings};
    use atip_check::claim::Claim;
    use atip_check::l1::model::CommandDoc;
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/schema-docs");
    let read = |path: &str| -> Value {
        serde_json::from_str(&std::fs::read_to_string(dir.join(path)).expect("example"))
            .expect("json")
    };
    let problems = |findings: Vec<(&'static str, Option<String>)>| -> Vec<String> {
        findings
            .into_iter()
            .filter_map(|(_, problem)| problem)
            .collect()
    };
    // L1.grammar: each of the four options, unmarked in turn, is named at 1.2 and judged at 1.1 not at all.
    let acme = read("schema-command-acme-member-list.json");
    for name in ["limit", "cursor", "all", "fields"] {
        let mut data = acme["data"].clone();
        let option = data["options"]
            .as_array_mut()
            .expect("options")
            .iter_mut()
            .find(|option| option["name"] == name)
            .unwrap_or_else(|| panic!("acme member list has --{name}"));
        option["flagOnly"] = json!(false);
        let doc = CommandDoc::parse(&data).expect("a command document");
        let at_1_2 = problems(grammar_findings(&[], Some(&doc), minor_of(Claim::V1_2)));
        assert_eq!(at_1_2.len(), 1, "--{name}: {at_1_2:?}");
        assert!(
            at_1_2[0].contains(&format!("--{name} is not flagOnly")),
            "{}",
            at_1_2[0]
        );
        assert!(
            problems(grammar_findings(&[], Some(&doc), minor_of(Claim::V1_1))).is_empty(),
            "--{name} is the tool's own at 1.1"
        );
    }
    // L1.registry: the row the contract fixes is exit 1 and not retryable since 1.2; retryable at exit 1 fails at 1.2 and is the tool's own at 1.1.
    let errors = read("schema-errors-acme.json");
    let mut entries: Vec<Value> = errors["data"]["errors"]
        .as_array()
        .cloned()
        .expect("errors");
    assert!(
        problems(registry_findings(&entries, minor_of(Claim::V1_2))).is_empty(),
        "acme's row is the reserved one"
    );
    let row = entries
        .iter_mut()
        .find(|entry| entry["code"] == "STOPPED_MIDWAY")
        .expect("acme registers STOPPED_MIDWAY");
    row["retryable"] = json!(true);
    let at_1_2 = problems(registry_findings(&entries, minor_of(Claim::V1_2)));
    assert_eq!(at_1_2.len(), 1, "{at_1_2:?}");
    assert!(
        at_1_2[0].contains("STOPPED_MIDWAY is exit 1 retryable true"),
        "{}",
        at_1_2[0]
    );
    assert!(problems(registry_findings(&entries, minor_of(Claim::V1_1))).is_empty());
}

/// 108 (and 107, a registry that does not list `STOPPED_MIDWAY` passes): a 1.2 tool whose commands have no `--all`, no env and no `--input` has those parts unsupported and the row passes.
#[test]
fn atip_check_108_a_1_2_tool_whose_commands_have_no_all_no_env_and_no_input_has_those_parts_unsupported_and_the_row_passes(
) {
    let harness = Harness::new();
    let mut config = l1_config_1_2(&json!({}));
    config["docPatch"] = json!({
        "member list": [
            {"op": "remove", "path": "/options/name=all"},
            {"op": "remove", "path": "/options/name=team/env"},
            {"op": "remove", "path": "/options/name=input"},
            {"op": "remove", "path": "/input"}
        ]
    });
    let output = run_l1(&harness, &config, &harness.l1_fixture(&config));
    assert_eq!(result_of(&output, "L1.registry"), "pass");
    let paging = output.check("L1.paging");
    assert_eq!(paging["result"], "pass", "{paging}");
    let notes = paging["notes"].as_array().cloned().unwrap_or_default();
    assert!(
        notes.iter().any(|note| note
            .as_str()
            .is_some_and(|note| note.contains("member list")
                && note.contains("nothing to test for: all, env, input"))),
        "{notes:?}"
    );
    // The part of the row that the tool does have is still judged: the default written out is refused.
    let observed: Vec<Value> = paging["observed"].as_array().cloned().unwrap_or_default();
    assert!(
        observed.iter().any(|call| call["argv"]
            .as_array()
            .is_some_and(|argv| argv.iter().any(|word| word == "--sort=name"))),
        "the default is written out: {observed:?}"
    );
}

/// 113: an output schema that marks the optional `nickname` required is caught by `L1.output-data` when a run returns the record without it; at a claim of 1.1 too, with `ATIP_CHECK_ALL_SEEDS=1`.
#[test]
fn atip_check_113_an_output_schema_that_marks_an_optional_field_required_is_caught_by_l1_output_data_when_a_run_returns_the_record_without_it(
) {
    // `nickname` is optional in the data of `member list`: a member may have none. The schema of the output says every member has one.
    let claims: &[&str] = if all_seeds() {
        &["1.1", "1.2"]
    } else {
        &["1.2"]
    };
    for claim in claims {
        let harness = Harness::new();
        let mut config = l1_config_1_2(&json!({"claims": claim}));
        config["docPatch"] = json!({"member list": [{"op": "add", "path": "/schemas/MemberRow/required/-", "value": "nickname"}]});
        if *claim == "1.1" {
            config.as_object_mut().expect("object").remove("binAlias");
        }
        let fixture = harness.l1_fixture(&config);
        let output = run_l1(&harness, &config, &fixture);
        let check = output.check("L1.output-data");
        assert_eq!(check["result"], "fail", "{claim}: {check}");
        assert!(
            check["findings"]
                .as_array()
                .is_some_and(|findings| findings.iter().any(|finding| finding["kind"]
                    == "data-validates"
                    && finding["message"]
                        .as_str()
                        .is_some_and(|text| text.contains("nickname")))),
            "{claim}: {check}"
        );
        // The row that projects with `--fields` validates the same data against the same schema and fails with it; nothing else does.
        assert_eq!(
            failing(&output),
            ["L1.output-data", "L1.fields"],
            "{claim}: {:?}",
            output.results()
        );
    }
}

#[test]
fn atip_check_103_a_repeatable_option_with_an_array_default_is_written_out_one_occurrence_for_each_element(
) {
    let argvs = |output: &Output, id: &str| -> Vec<Vec<String>> {
        output.check(id)["observed"]
            .as_array()
            .expect("observed")
            .iter()
            .map(|call| {
                call["argv"]
                    .as_array()
                    .expect("argv")
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .collect()
    };
    // `--kind` is repeatable, an enum of a, b and c, and declares the default ["a", "b"]: one value `["a","b"]` is no member of the enum.
    let harness = Harness::new();
    let config = l1_config_1_2(&json!({"repeatableDefault": true}));
    let output = run_l1(&harness, &config, &harness.l1_fixture(&config));
    let paging = output.check("L1.paging");
    assert_eq!(paging["result"], "pass", "{paging}");
    let calls = argvs(&output, "L1.paging");
    let written: Vec<&Vec<String>> = calls
        .iter()
        .filter(|argv| {
            argv.iter().any(|word| word == "--kind=a") && argv.iter().any(|word| word == "--kind=b")
        })
        .collect();
    assert!(
        !written.is_empty(),
        "the default of --kind is written out: {calls:?}"
    );
    for argv in &calls {
        assert!(
            argv.iter().all(|word| !word.contains('[')),
            "no JSON text as a value: {argv:?}"
        );
    }
    // The cursor of the page that gave no `--kind` is refused when the defaults are written out, and only for being another invocation.
    let refused = paging["observed"]
        .as_array()
        .expect("observed")
        .iter()
        .find(|call| {
            call["argv"]
                .as_array()
                .is_some_and(|argv| argv.iter().any(|word| word == "--kind=b"))
        })
        .expect("the call");
    assert_eq!(refused["exit"], 2);
    assert!(
        refused["stdout"]
            .as_str()
            .unwrap_or_default()
            .contains("CURSOR_INVALID"),
        "{refused}"
    );
    // A tool that binds the cursor to the effective values accepts it, and the finding names the option.
    let lax = l1_config_1_2(&json!({"repeatableDefault": true, "cursorBindsEffective": true}));
    let output = run_l1(&harness, &lax, &harness.l1_fixture(&lax));
    let paging = output.check("L1.paging");
    assert_eq!(paging["result"], "fail", "{paging}");
    assert!(
        paging["findings"]
            .as_array()
            .is_some_and(|findings| findings.iter().any(|finding| finding["kind"]
                == "cursor-bound-to-given-arguments"
                && finding["message"]
                    .as_str()
                    .is_some_and(|text| text.contains("--kind written out at its default")))),
        "{paging}"
    );
}

#[test]
fn atip_check_preview_a_contract_that_differs_from_the_fixtures_is_a_preview_that_lists_the_failures_and_equal_minors_are_a_claim(
) {
    let harness = Harness::new();
    let fixture = harness.fixture(&json!({"claims": "1.2"}));
    // Equal minors: today's run, a verdict on the level and none of the preview members.
    let equal = harness.check_with(&fixture, true, &["--contract", "1.2"]);
    assert_eq!(equal.code, Some(0), "{}", equal.stdout);
    let data = equal.envelope()["data"].clone();
    assert_eq!(data["passed"], true);
    for member in ["verdict", "declaredContractVersion", "statement"] {
        assert!(data.get(member).is_none(), "{member} in {data}");
    }
    // A 1.2 tool checked as 1.4: not refused, no level verdict, exit 0, and the checks that would fail are listed.
    let output = harness.check_with(&fixture, true, &["--contract", "1.4"]);
    assert_eq!(output.code, Some(0), "{}", output.stdout);
    let document = output.envelope();
    let data = &document["data"];
    assert_eq!(data["contractVersion"], "1.4");
    assert_eq!(data["declaredContractVersion"], "1.2");
    assert_eq!(data["verdict"], "preview");
    assert_eq!(
        data["statement"],
        "declared 1.2, checked as 1.4, not a level claim"
    );
    assert_eq!(data["passed"], false, "{data}");
    assert!(
        failing_in(data).contains(&"L0.contract-version"),
        "{:?}",
        failing_in(data)
    );
    assert!(document["meta"].get("warnings").is_none(), "{document}");
    // The text says preview, not met or not met.
    let text = harness.check_with(&fixture, false, &["--contract", "1.4"]);
    assert_eq!(text.code, Some(0), "{}", text.stdout);
    let summary = text.stdout.lines().last().unwrap_or_default();
    assert!(
        summary.contains("preview (declared 1.2, checked as 1.4, not a level claim)")
            && !summary.contains("not met"),
        "{summary}"
    );
}
