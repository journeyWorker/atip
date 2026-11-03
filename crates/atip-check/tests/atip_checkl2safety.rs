//! `atip check --level L2`, the safety rows (approaches/checker.md 4, 6, 7.2): the repeat of a write, the rules of a destructive
//! command and its plan, work that is accepted and not done, operation keys, and the effects of what must change nothing. The
//! conforming L2 fake passes, and a seeded violation of each row fails the check that owns it. Each test carries the id of the
//! scenario it proves (`atip.checkl2safety.NN`).
//!
//! A full run of `atip check --level L2` is some hundreds of launches of the fake tool, so the file spends few of them:
//!
//! - The conforming tool runs once (01); every assertion about what its probes ran is made on that run.
//! - The rows' seeds touch different parts of the fake, so one seed of each row is planted in one fake and the one run shows
//!   each row failing with the finding of its own condition and every other check holding (02, 03). `ATIP_CHECK_ALL_SEEDS=1`
//!   (`just test-all-seeds`) also plants every seed of every row alone, as `support::proves` and `support::covers` do.
//! - The variants that pass are planted together too, in two runs (04, 05).
//! - A scenario about one command lists only that command in its fixture (the fixture names what the checker runs): fewer
//!   commands, fewer launches. Such a run asserts the row it is about; the other rows are not judged by it.

mod support;

use std::collections::BTreeSet;

use atip_check::app::check_binary_mutated;
use atip_check::cli::{CheckArgs, Level};
use atip_check::report::{CheckResult, Report};
use serde_json::{json, Value};

use support::l2::{
    check_of, covers, l2_config, l2_standard_config, not_passing, owner_of, proves, run_case,
    run_config, safety_cases,
};
use support::{all_seeds, kind_verdict, Case, Harness, Output};

const SAFETY_ROWS: [&str; 10] = [
    "L2.idempotency",
    "L2.destructive-safety",
    "L2.destructive-preview",
    "L2.destructive-preview-stdin",
    "L2.destructive-stale",
    "L2.destructive-half",
    "L2.destructive-commit",
    "L2.async",
    "L2.operation-key",
    "L2.effects",
];

/// One seed (`<check>/<condition>`) of each row, planted together in `planted_seeds`.
const SEEDS: [&str; 10] = [
    "idempotency/second-run-no-new-effect",
    "destructive-safety/no-batch",
    "destructive-preview/preview-changes-nothing",
    "destructive-preview-stdin/stdin-preview-succeeds",
    "destructive-stale/stale-refused",
    "destructive-half/half-refused",
    "destructive-commit/commit-committed",
    "async/start-is-not-complete",
    "operation-key/repeat-succeeds",
    "effects/read-changes-only-allowed",
];

fn check_names() -> Vec<&'static str> {
    SAFETY_ROWS
        .iter()
        .map(|row| row.strip_prefix("L2.").unwrap_or(row))
        .collect()
}

fn case_of(condition: &str) -> Case {
    safety_cases()
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

/// The standard configuration with the members of the seeds' configurations that differ from it, the `docPatch` of one
/// command joined with the other's: every seed of `conditions` planted in one fake.
fn planted_seeds(conditions: &[&str]) -> Value {
    let standard = l2_standard_config();
    let mut merged = standard.clone();
    for condition in conditions {
        let case = case_of(condition);
        assert!(
            case.tweak.is_none(),
            "{condition} changes the fixture, not only the fake"
        );
        for (key, value) in case.config.as_object().into_iter().flatten() {
            if standard.get(key) == Some(value) {
                continue;
            }
            if key == "docPatch" {
                for (command, ops) in value.as_object().into_iter().flatten() {
                    let target = &mut merged["docPatch"][command];
                    if target.is_null() {
                        *target = json!([]);
                    }
                    if let (Some(target), Some(ops)) = (target.as_array_mut(), ops.as_array()) {
                        target.extend(ops.iter().cloned());
                    }
                }
            } else {
                merged[key.as_str()] = value.clone();
            }
        }
    }
    merged
}

/// `atip check --level L2 --json` with the fixture of the L2 fake changed by `tweak`.
fn run_tweaked(config: &Value, tweak: impl FnOnce(&mut Value)) -> Output {
    let harness = Harness::new();
    let mut fixture = harness.l2_fixture(config);
    tweak(&mut fixture);
    harness.check_l2(config, &fixture)
}

/// The same with a fixture that lists only the commands `keep`.
fn run_listing(config: &Value, keep: &[&str], tweak: impl FnOnce(&mut Value)) -> Output {
    run_tweaked(config, |fixture| {
        if let Some(commands) = fixture["commands"].as_object_mut() {
            commands.retain(|name, _| keep.contains(&name.as_str()));
        }
        tweak(fixture);
    })
}

/// The report of the checker run in process (`forced` checks pass whatever they find, `skipped` conditions hold) against the fake of `config`.
fn mutated(config: &Value, forced: &[&str], skipped: &[&str]) -> Report {
    let harness = Harness::new();
    let fixture = harness.l2_fixture(config);
    let args = CheckArgs {
        bin: support::l1::l1_bin(&harness, config).into(),
        level: Level::L2,
        fixture: harness.write("fixture.json", &fixture).into(),
        contract: None,
    };
    check_binary_mutated(&args, forced, skipped)
        .expect("a report")
        .0
}

/// Every owner fails with a reason and rule numbers, and every other check passes or does not apply.
fn only_these_fail(data: &Value, owners: &[&str]) -> Result<(), String> {
    let checks = data["checks"].as_array().ok_or("data.checks is missing")?;
    for check in checks {
        let id = check["id"].as_str().unwrap_or_default();
        let result = check["result"].as_str().unwrap_or_default();
        if owners.contains(&id) {
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

#[test]
fn atip_checkl2safety_01_the_conforming_fake_and_the_checker_itself_pass_and_each_safety_row_runs_the_probes_it_describes(
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
    let data = &document["data"];
    for row in SAFETY_ROWS {
        let check = check_of(data, row);
        assert_eq!(check["result"], "pass", "{row}: {check}");
    }
    // The preview names the plan; the preview from stdin replays.
    let preview = argvs(check_of(data, "L2.destructive-preview"));
    assert!(
        preview
            .iter()
            .any(|argv| argv == "purge --kind session --before 2030-01-01 --json"),
        "{preview:?}"
    );
    let stdin = argvs(check_of(data, "L2.destructive-preview-stdin"));
    assert!(
        stdin.iter().any(|argv| argv.contains("--input=-"))
            && stdin
                .iter()
                .any(|argv| argv.contains("--commit --plan-digest sha256:")),
        "{stdin:?}"
    );
    // The stale digest is the preview's `next` with one character changed; the right commit commits.
    let stale = argvs(check_of(data, "L2.destructive-stale"));
    assert!(
        stale.iter().any(|argv| argv.starts_with(
            "purge --kind session --before 2030-01-01 --commit --plan-digest sha256:"
        )),
        "{stale:?}"
    );
    let commit = check_of(data, "L2.destructive-commit");
    assert!(
        argvs(commit)
            .iter()
            .any(|argv| argv.contains("--commit --plan-digest")),
        "{commit}"
    );
    // The three idempotency values are tested, `appends` is not.
    let observed = argvs(check_of(data, "L2.idempotency"));
    for command in ["init", "seal", "stamp hello", "record put"] {
        assert!(
            observed.iter().any(|argv| argv.starts_with(command)),
            "{command} is run twice: {observed:?}"
        );
    }
    assert!(
        !observed.iter().any(|argv| argv.starts_with("log ")),
        "`appends` is not tested: {observed:?}"
    );
    // The effects of a read with an allowed change.
    let effects = check_of(data, "L2.effects");
    assert!(
        argvs(effects).iter().any(|argv| argv == "peek --json"),
        "the read with an allowed change is run: {effects}"
    );
    assert_eq!(effects["strength"], "MUST");
    // The worker is driven to done, failed and timeout, and a wait that hangs is given a short time.
    let observed = argvs(check_of(data, "L2.async"));
    assert!(
        observed
            .iter()
            .any(|argv| argv.starts_with("deploy start staging")),
        "{observed:?}"
    );
    assert!(
        observed
            .iter()
            .filter(|argv| argv.starts_with("deploy status") && argv.contains("--wait"))
            .count()
            >= 3,
        "{observed:?}"
    );
    assert!(
        observed.iter().any(|argv| argv.contains("--timeout 1s")),
        "a wait that hangs is given a short time: {observed:?}"
    );
    // The same key is run more than once.
    let observed = argvs(check_of(data, "L2.operation-key"));
    assert!(
        observed
            .iter()
            .filter(|argv| argv.contains("--operation chk-one"))
            .count()
            >= 3,
        "{observed:?}"
    );
    // The checker checks itself.
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

#[test]
fn atip_checkl2safety_02_a_seed_of_each_row_planted_together_fails_its_own_row_with_its_own_finding_and_nothing_else(
) {
    let output = run_config(&planted_seeds(&SEEDS));
    let document = output.envelope();
    let data = &document["data"];
    only_these_fail(data, &SAFETY_ROWS).unwrap_or_else(|why| {
        panic!("{why}\n{}", not_passing(data));
    });
    for condition in SEEDS {
        let owner = owner_of(condition);
        kind_verdict(
            data,
            &owner,
            condition.split('/').nth(1).unwrap_or_default(),
        )
        .unwrap_or_else(|why| panic!("{condition}: {why}"));
        assert_eq!(check_of(data, &owner)["strength"], "MUST", "{condition}");
    }
    // A MUST failure is `LEVEL_FAILED`, exit 1, and the error names the failing checks.
    assert_eq!(
        (output.code, document["ok"].as_bool()),
        (Some(1), Some(false)),
        "{}",
        output.stdout
    );
    assert_eq!(document["error"]["code"], "LEVEL_FAILED");
    let message = document["error"]["message"].as_str().unwrap_or_default();
    for row in SAFETY_ROWS {
        assert!(message.contains(row), "the error names {row}: {message}");
    }
    // The change a preview made is not a refusal's, and the report names the changed path.
    assert_eq!(
        check_of(data, "L0.refusal-effects")["result"],
        "pass",
        "{}",
        not_passing(data)
    );
    let reason = check_of(data, "L2.destructive-preview")["reason"]
        .as_str()
        .unwrap_or_default();
    assert!(
        reason.contains(".purge-preview-cache"),
        "the report names the changed path: {reason}"
    );
    // A read that changes a file outside its allowance is named.
    let reason = check_of(data, "L2.effects")["reason"]
        .as_str()
        .unwrap_or_default();
    assert!(reason.contains("peek-cache.txt"), "{reason}");
    if all_seeds() {
        proves(safety_cases(), &check_names());
    }
}

#[test]
fn atip_checkl2safety_03_every_condition_a_conforming_run_judges_has_a_seed_and_a_seeded_row_stops_failing_when_forced_or_its_condition_is_skipped(
) {
    // A conforming run judges the conditions of the safety rows (those of the L1 run apart) and every one of them has a seed.
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
    // No check of the L1 run carries the name of a safety row, so the conditions of the rows are the ones this run judges.
    let names = check_names();
    let of_the_rows =
        |condition: &str| names.contains(&condition.split('/').next().unwrap_or_default());
    let judged: BTreeSet<String> = judged
        .into_iter()
        .filter(|condition| of_the_rows(condition))
        .collect();
    let seeded: BTreeSet<String> = safety_cases()
        .iter()
        .filter(|case| of_the_rows(case.condition))
        .map(|case| case.condition.to_string())
        .collect();
    let unplanted: Vec<&String> = judged.difference(&seeded).collect();
    let unjudged: Vec<&String> = seeded.difference(&judged).collect();
    assert!(
        unplanted.is_empty(),
        "judged by a conforming run and not planted by any case: {unplanted:?}"
    );
    assert!(
        unjudged.is_empty(),
        "planted and never judged by a conforming run: {unjudged:?}"
    );
    // With the seeded rows forced to pass, and with the seeded conditions switched off, the seeds are no failure: each is
    // noticed by the check and the condition it names.
    let config = planted_seeds(&SEEDS);
    let forced = mutated(&config, &SAFETY_ROWS, &[]);
    for row in SAFETY_ROWS {
        assert_ne!(
            forced.find(row).map(|check| check.result),
            Some(CheckResult::Fail),
            "forced to pass, {row} still fails"
        );
    }
    assert!(forced.passed, "{}", forced.text());
    let skipped = mutated(&config, &[], &SEEDS);
    for row in SAFETY_ROWS {
        assert_ne!(
            skipped.find(row).map(|check| check.result),
            Some(CheckResult::Fail),
            "with the conditions switched off {row} still fails"
        );
    }
    assert!(skipped.passed, "{}", skipped.text());
    if all_seeds() {
        covers(safety_cases(), &names, &[]);
    }
}

#[test]
fn atip_checkl2safety_04_the_variants_that_pass_are_no_failure_a_one_word_digest_a_pairs_own_code_a_start_whose_next_only_reads_an_allowed_audit_line_and_directories_that_are_no_effect(
) {
    // Planted together: `next[0]` writes the digest as `--plan-digest=<hex>` (spec 9.12.1); the half `--commit` alone is refused
    // with the pair's own code; `stamp` appends an audit line the fixture allows and its note names, and makes an empty directory
    // on every run; `peek` makes the directory that holds its allowed file and another that holds nothing; and the fixture lists
    // no `seal`, a write that is named and never run; the start of the worker has a `next[0]` that only reads.
    let config = l2_config(&json!({
        "digestOneWord": true,
        "pairCode": true,
        "startStatusOnly": true,
        "stampAudit": true,
        "stampBareDir": true,
        "peekAuditDir": true,
        "peekBareDir": true
    }));
    let output = run_tweaked(&config, |fixture| {
        fixture["commands"]
            .as_object_mut()
            .expect("commands")
            .remove("seal");
        fixture["commands"]["stamp"]["allowedEffects"] = json!([".stamp-audit.log"]);
        fixture["commands"]["peek"]["allowedEffects"] = json!([".audit/access.log"]);
    });
    let document = output.envelope();
    let data = &document["data"];
    assert_eq!(
        (output.code, document["ok"].as_bool()),
        (Some(0), Some(true)),
        "{}\n{}",
        not_passing(data),
        output.stdout
    );
    for row in SAFETY_ROWS {
        assert_eq!(
            check_of(data, row)["result"],
            "pass",
            "{row}: {}",
            not_passing(data)
        );
    }
    let stale = check_of(data, "L2.destructive-stale");
    assert!(
        argvs(stale)
            .iter()
            .any(|argv| argv.contains("--plan-digest=")),
        "the stale probe keeps the one-word form: {stale}"
    );
    // A start whose `next[0]` only reads the status (no `--wait`): the start, `next[0]` and its being a read are checked; the
    // outcomes are not.
    let asynchronous = check_of(data, "L2.async");
    assert!(
        asynchronous["notes"].to_string().contains("not checked"),
        "{asynchronous}"
    );
    assert!(
        !argvs(asynchronous)
            .iter()
            .any(|argv| argv.contains("--wait")),
        "{asynchronous}"
    );
    // The audit line is named in the report, and a directory made by a write or a read is no effect.
    let idempotency = check_of(data, "L2.idempotency");
    assert!(
        idempotency["notes"]
            .to_string()
            .contains(".stamp-audit.log"),
        "the report names the excluded path: {idempotency}"
    );
    assert_eq!(
        check_of(data, "L0.refusal-effects")["result"],
        "pass",
        "{}",
        not_passing(data)
    );
    // A write the fixture does not list is named and never run.
    assert!(
        idempotency["unlisted"]
            .as_array()
            .is_some_and(|names| names.iter().any(|name| name == "seal")),
        "{idempotency}"
    );
    assert!(
        !argvs(idempotency)
            .iter()
            .any(|argv| argv.starts_with("seal")),
        "{idempotency}"
    );
}

#[test]
fn atip_checkl2safety_05_a_code_registered_for_usage_stands_for_usage_in_the_registry_and_in_the_halves_and_only_with_a_field_and_exit_2(
) {
    // checker.md 1.3.1 section 2: a tool that registers `OPTION_INVALID` and never emits `USAGE` passes. The fake has no `USAGE` and answers every usage problem
    // with it. Other rows may not judge it as a whole (an operand is named by its value name, which no `--` or pointer says); the rows of the rule do.
    let output = run_listing(
        &l2_config(&json!({"usageRenamed": true})),
        &["purge", "seal"],
        |_| (),
    );
    let document = output.envelope();
    for row in ["L1.registry", "L2.destructive-half", "L2.input-usage"] {
        assert_eq!(
            check_of(&document["data"], row)["result"],
            "pass",
            "{row}: {}",
            not_passing(&document["data"])
        );
    }
    let halves = argvs(check_of(&document["data"], "L2.destructive-half"));
    assert!(
        halves
            .iter()
            .any(|argv| argv.starts_with("purge") && argv.contains("--commit")),
        "the half is run: {halves:?}"
    );
    // The same code without a field that names an argument is no replacement of `USAGE`.
    let output = run_listing(
        &l2_config(&json!({"usageRenamed": true, "usageNoField": true})),
        &["purge"],
        |_| (),
    );
    let data = &output.envelope()["data"];
    assert_eq!(
        check_of(data, "L2.destructive-half")["result"],
        "fail",
        "{}",
        not_passing(data)
    );
    // A code registered with another exit than 2 is none either: the registry has no `USAGE` and the half is not refused with one.
    let output = run_listing(
        &l2_config(&json!({"usageRenamed": true, "reservedExit": {"OPTION_INVALID": 1}})),
        &["purge"],
        |_| (),
    );
    let data = &output.envelope()["data"];
    assert_eq!(
        check_of(data, "L2.destructive-half")["result"],
        "fail",
        "{}",
        not_passing(data)
    );
    assert_eq!(
        check_of(data, "L1.registry")["result"],
        "fail",
        "{}",
        not_passing(data)
    );
}

#[test]
fn atip_checkl2safety_06_an_allowance_hides_a_repeats_effect_only_when_the_note_names_the_file_and_never_a_duplicating_write(
) {
    // `stamp` appends an audit line on every run. Allowed by the fixture and named by the note it is no new effect (04 plants
    // that); without the allowance the line is a new effect:
    let output = run_listing(&l2_config(&json!({"stampAudit": true})), &["stamp"], |_| ());
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.idempotency");
    assert_eq!(check["result"], "fail", "{check}");
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains(".stamp-audit.log"),
        "{check}"
    );
    // checker.md 1.3.1 section 7.2: the same allowance, with an `effectNote` that exists and does not name the file, fails too.
    let output = run_listing(
        &l2_config(&json!({
            "stampAudit": true,
            "docPatch": {"stamp": [support::l2::set("/effectNote", json!("writes one stamp file under stamps/"))]}
        })),
        &["stamp"],
        |fixture| {
            fixture["commands"]["stamp"]["allowedEffects"] = json!([".stamp-audit.log"]);
        },
    );
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.idempotency");
    assert_eq!(check["result"], "fail", "{check}");
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains(".stamp-audit.log"),
        "{check}"
    );
    // A glob does not let a duplicating write pass (`**`), and checker.md 1.3.1 section 4: snapshots count files only, so
    // the empty directory every run makes is not what is named.
    let output = run_listing(
        &l2_config(&json!({"stampBareDir": true, "stampDuplicates": true})),
        &["stamp"],
        |fixture| {
            fixture["commands"]["stamp"]["allowedEffects"] = json!(["**"]);
        },
    );
    let check = check_of(&output.envelope()["data"], "L2.idempotency").clone();
    assert_eq!(check["result"], "fail", "{check}");
    let reason = check["reason"].as_str().unwrap_or_default();
    assert!(
        reason.contains("-again.txt") && !reason.contains("bare-"),
        "{reason}"
    );
}

#[test]
fn atip_checkl2safety_07_at_l0_and_l1_l2_effects_is_an_advisory_and_a_failure_leaves_the_level_met()
{
    for (level, knob) in [("L0", "helpWrites"), ("L1", "versionWrites")] {
        let case = Case {
            condition: "effects/help-changes-nothing",
            config: l2_config(&json!({ knob: true, "treeLevel": level })),
            tweak: None,
        };
        let output = run_case(&case, level);
        let document = output.envelope();
        let check = check_of(&document["data"], "L2.effects");
        assert_eq!(
            (check["result"].as_str(), check["strength"].as_str()),
            (Some("fail"), Some("SHOULD")),
            "{level} {knob}: {check}"
        );
        assert_eq!(
            (output.code, document["ok"].as_bool()),
            (Some(0), Some(true)),
            "{level} {knob}: {}\n{}",
            not_passing(&document["data"]),
            output.stdout
        );
        assert_eq!(
            document["data"]["checks"].as_array().map(Vec::len),
            Some(if level == "L0" { 29 } else { 61 }),
            "{level}"
        );
    }
}

#[test]
fn atip_checkl2safety_08_a_read_is_judged_by_its_allowance_its_note_and_files_only_a_directory_is_no_change(
) {
    // A note is needed: with no `effectNote` even the listed path is a failure.
    let output = run_listing(
        &l2_config(&support::l2::patch(&[(
            "peek",
            vec![support::l2::remove("/effectNote")],
        )])),
        &["peek"],
        |_| (),
    );
    let reason = check_of(&output.envelope()["data"], "L2.effects")["reason"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        reason.contains(".peek-access.log") && reason.contains("no `effectNote`"),
        "{reason}"
    );
    // checker.md 1.3.1 section 4: snapshots count files only. The read makes `.audit` for its log and `.peek-empty` and
    // nothing under it, and writes a file it has no allowance for: only the file is named, the directories are not.
    let output = run_listing(
        &l2_config(&json!({"peekAuditDir": true, "peekBareDir": true, "peekWritesOther": true})),
        &["peek"],
        |fixture| {
            fixture["commands"]["peek"]["allowedEffects"] = json!([]);
        },
    );
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.effects");
    let reason = check["reason"].as_str().unwrap_or_default();
    assert_eq!(check["result"], "fail", "{check}");
    assert!(
        reason.contains("./.audit/access.log")
            && !reason.contains("./.audit,")
            && !reason.contains("./.audit ")
            && reason.contains("peek-cache.txt")
            && !reason.contains(".peek-empty"),
        "{reason}"
    );
}

#[test]
fn atip_checkl2safety_09_an_async_outcome_the_fixture_leaves_out_is_unprovided_and_a_start_needs_a_next_that_reads(
) {
    let output = run_listing(&l2_standard_config(), &["deploy start"], |fixture| {
        fixture["commands"]["deploy start"]["async"]["outcomes"] = json!(["done"]);
    });
    let document = output.envelope();
    let check = check_of(&document["data"], "L2.async");
    assert_eq!(check["result"], "unprovided", "{check}");
    assert!(
        check
            .to_string()
            .contains("commands.deploy start.async.outcomes"),
        "{check}"
    );
    assert!(
        check["reason"]
            .as_str()
            .unwrap_or_default()
            .contains("failed, timeout"),
        "{check}"
    );
    // No next at all, and a next that starts more work: each fails L2.async and nothing else the run judges.
    for condition in ["async/start-next-exists", "async/start-next-reads"] {
        let output = run_listing(&case_of(condition).config, &["deploy start"], |_| ());
        let data = &output.envelope()["data"];
        let check = check_of(data, "L2.async");
        assert_eq!(check["result"], "fail", "{condition}: {check}");
        for other in data["checks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|other| other["id"] != "L2.async")
        {
            assert_ne!(
                other["result"], "fail",
                "{condition}: only L2.async was seeded: {other}"
            );
        }
    }
}

#[test]
fn atip_checkl2safety_10_a_tool_without_destructive_or_async_commands_has_those_rows_unsupported() {
    let harness = Harness::new();
    let config = support::l1::l1_standard_config();
    let fixture = harness.l1_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L2");
    let data = &output.envelope()["data"];
    for row in [
        "L2.destructive-safety",
        "L2.destructive-preview",
        "L2.destructive-preview-stdin",
        "L2.destructive-stale",
        "L2.destructive-half",
        "L2.destructive-commit",
        "L2.async",
        "L2.operation-key",
    ] {
        assert_eq!(
            check_of(data, row)["result"],
            "unsupported",
            "{row}: {}",
            check_of(data, row)
        );
    }
}
