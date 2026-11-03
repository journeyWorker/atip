//! The claim of atip/1 1.3 and 1.4 (approaches/checker.md 2): `--contract 1.3` and `--contract 1.4`, the fixture's `contractVersion`, and what
//! the checker says about the minors it knows. Nothing here runs a binary: the command line and the fixture are parsed.

use std::ffi::OsString;

use serde_json::json;

use atip_check::claim::{Claim, MINORS};
use atip_check::cli::{parse, Command, CHECK_HELP};
use atip_check::fixture;

fn args(words: &[&str]) -> Vec<OsString> {
    words.iter().map(OsString::from).collect()
}

#[test]
fn atip_check14_30_the_checker_knows_five_minors_and_names_them_when_it_refuses_another() {
    assert_eq!(MINORS, ["1.0", "1.1", "1.2", "1.3", "1.4"]);
    for minor in ["1.3", "1.4"] {
        let parsed = parse(&args(&[
            "check",
            "--bin",
            "b",
            "--fixture",
            "f",
            "--contract",
            minor,
        ]));
        match parsed {
            Ok(Command::Check(check, _, _)) => assert_eq!(check.contract.as_deref(), Some(minor)),
            other => panic!("{minor}: not a check: {other:?}"),
        }
    }
    let refused = parse(&args(&[
        "check",
        "--bin",
        "b",
        "--fixture",
        "f",
        "--contract",
        "1.5",
    ]))
    .expect_err("a minor later than 1.4 is not known");
    assert_eq!(refused.field.as_deref(), Some("--contract"));
    assert_eq!(refused.expected, MINORS);
    assert_eq!(refused.received.as_deref(), Some("1.5"));
    assert!(
        CHECK_HELP.contains("1.0, 1.1, 1.2, 1.3 or 1.4"),
        "{CHECK_HELP}"
    );
}

#[test]
fn atip_check14_31_a_fixture_claims_1_3_or_1_4_and_nothing_later() {
    for (minor, claim) in [("1.3", Claim::V1_3), ("1.4", Claim::V1_4)] {
        let fixture = fixture::parse(&json!({"contractVersion": minor})).expect("a fixture");
        assert_eq!(fixture.claim(), claim);
    }
    let refused = fixture::parse(&json!({"contractVersion": "1.5"})).expect_err("unknown minor");
    assert!(refused.contains("1.3, 1.4"), "{refused}");
    assert_eq!(
        fixture::parse(&json!({})).expect("a fixture").claim(),
        Claim::V1_0,
        "a fixture with no contractVersion claims 1.0"
    );
}

#[test]
fn atip_check14_32_the_rows_that_1_3_relaxed_are_told_apart_from_the_rows_that_stay() {
    // `L1.check-order` is a MUST for exactly 1.2 and a SHOULD from 1.3; a row that tested "1.2 or later" keeps its meaning for 1.3 and 1.4
    // through `at_least`, and a row that relaxed asks `is_1_2`.
    for claim in [Claim::V1_3, Claim::V1_4] {
        assert!(claim.at_least(Claim::V1_2) && !claim.is_1_2());
        assert!(claim.declares_1_3());
    }
    assert!(Claim::V1_2.is_1_2() && !Claim::V1_2.declares_1_3());
    assert!(Claim::V1_4.declares_1_4() && !Claim::V1_3.declares_1_4());
}
