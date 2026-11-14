//! `atip check --deep --jobs N` (approaches/checker.md 3.2): the invocations a plan made independent run alongside each
//! other, and the report is the one of a run one call at a time. Each test carries the id of the scenario it proves
//! (`atip.check.jobs.NN`).

mod support;

use serde_json::json;
use support::l2::l2_standard_config;
use support::Harness;

#[test]
fn atip_check_jobs_03_the_conforming_l2_fake_gets_the_same_report_with_one_job_and_with_four() {
    let harness = Harness::new();
    let config = l2_standard_config();
    let fixture = harness.l2_fixture(&config);
    let one = harness.check_l2_with(&config, &fixture, &["--jobs", "1"]);
    let four = harness.check_l2_with(&config, &fixture, &["--jobs", "4"]);
    assert_eq!(one.code, four.code);
    assert!(
        one.stdout == four.stdout,
        "the reports differ:\n--jobs 1: {}\n--jobs 4: {}",
        one.stdout,
        four.stdout
    );
}

#[test]
fn atip_check_jobs_04_a_seeded_violation_gets_the_same_report_with_one_job_and_with_four() {
    // Every refusal writes a file: L0.refusal-effects fails, with a finding at each refusal of the run, in the order of the plan.
    let harness = Harness::new();
    let fixture = harness.fixture(&json!({"refusalWrites": true}));
    let one = harness.check_with(&fixture, true, &["--jobs", "1"]);
    let four = harness.check_with(&fixture, true, &["--jobs", "4"]);
    assert_eq!((one.code, four.code), (Some(1), Some(1)), "{}", one.stdout);
    assert!(
        one.stdout == four.stdout,
        "the reports differ:\n--jobs 1: {}\n--jobs 4: {}",
        one.stdout,
        four.stdout
    );
}
