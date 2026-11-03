//! What the crate does by the minor a tool declares, for the minors 1.3 and 1.4: they keep the behaviour of 1.2 where the
//! contract only relaxed or kept it (paging, flag-only options, field rules), and the code names, rows and stops that start at 1.3.

use atip::error::{CodeInfo, ReasonInfo};
use atip::fields::Rules;
use atip::plan::{stopped_by_changed_plan, stopped_by_stale, stopped_part_way, Next};
use atip::{
    code_name_problem, flag_only_options, registration_problem, reserved_code, reserved_codes,
    Condition, Cursors, Given, Minor, EXIT_FAILED, EXIT_REFUSED,
};

#[test]
fn atip_crate14_28_a_tool_that_declares_1_3_or_1_4_pages_like_one_that_declares_1_2() {
    let call = [
        Given::option("status", "active"),
        Given::option("limit", 10),
        Given::switch("json", true),
        Given::option("role", "member").from_env(),
    ];
    let at = |minor| Cursors::new(minor);
    assert_eq!(at(Minor::V1_2), at(Minor::V1_3));
    assert_eq!(at(Minor::V1_2), at(Minor::V1_4));
    assert_ne!(at(Minor::V1_1), at(Minor::V1_3));
    for minor in [Minor::V1_3, Minor::V1_4] {
        assert_eq!(
            at(minor).binding(&call).expect("a binding"),
            at(Minor::V1_2).binding(&call).expect("a binding"),
            "{minor} binds as 1.2 does"
        );
        // `--json` and the environment value: a 1.1 tool binds one and not the other, 1.3 and 1.4 follow 1.2.
        let without_json = &call[0..2];
        let with_env = [&call[..2], &call[3..]].concat();
        assert_eq!(
            at(minor).binding(&call[..2]).expect("a binding"),
            at(minor).binding(&call[..3]).expect("a binding"),
            "{minor}: --json does not bind"
        );
        assert_ne!(
            at(minor).binding(without_json).expect("a binding"),
            at(minor).binding(&with_env).expect("a binding"),
            "{minor}: a value an env variable supplied binds"
        );
        assert_eq!(
            Cursors::for_declared(minor.as_str()).expect("known"),
            at(minor)
        );
    }
}

#[test]
fn atip_crate14_29_the_flag_only_options_of_1_3_and_1_4_are_those_of_1_2() {
    let at_12 = flag_only_options(Minor::V1_2);
    assert_eq!(flag_only_options(Minor::V1_3), at_12);
    assert_eq!(flag_only_options(Minor::V1_4), at_12);
    assert_eq!(
        at_12,
        [
            "json",
            "input",
            "commit",
            "plan-digest",
            "limit",
            "cursor",
            "all",
            "fields"
        ]
    );
    assert_eq!(flag_only_options(Minor::V1_1).len(), 4);
}

#[test]
fn atip_crate14_30_the_field_rules_of_1_3_and_1_4_are_those_of_1_1() {
    assert_eq!(Rules::at(Minor::V1_3), Rules::at(Minor::V1_1));
    assert_eq!(Rules::at(Minor::V1_4), Rules::at(Minor::V1_2));
    assert_ne!(Rules::at(Minor::V1_4), Rules::at(Minor::V1_0));
    assert_eq!(Rules::for_minor("1.4"), Ok(Rules::at(Minor::V1_4)));
}

#[test]
fn atip_crate14_31_stopped_midway_is_a_core_code_in_a_1_2_document_only() {
    for minor in Minor::ALL {
        let reserved = reserved_code("STOPPED_MIDWAY", minor).is_some();
        assert_eq!(reserved, minor == Minor::V1_2, "{minor}");
        assert_eq!(
            reserved_codes(minor).count(),
            if minor == Minor::V1_2 { 13 } else { 12 },
            "{minor}"
        );
        assert_eq!(
            registration_problem(minor, "STOPPED_MIDWAY", Some(1), Some(false)),
            None,
            "{minor}: a row of the tool's own, or one the 1.3 name check judges"
        );
        let named = code_name_problem(minor, "STOPPED_MIDWAY", Some(1), Some(false));
        assert_eq!(named.is_some(), minor.at_least(Minor::V1_3), "{minor}");
    }
}

/// A tool's table: every row built from its code and its condition.
const STALE_REASON: ReasonInfo = ReasonInfo {
    reason: "PLAN_STALE",
    meaning: "The plan changed between two effects.",
    fix: "Read what was done, then preview again.",
};
static REASONS: [ReasonInfo; 1] = [STALE_REASON];
static ROWS: [CodeInfo; 6] = [
    CodeInfo::of(
        "FINDING_NOT_FOUND",
        Condition::NotFound,
        "No such finding.",
        "List the findings.",
        &[],
    ),
    CodeInfo::of(
        "STORE_UNAVAILABLE",
        Condition::Unavailable,
        "The store is busy.",
        "Repeat later.",
        &[],
    ),
    CodeInfo::of(
        "STORE_FAILED",
        Condition::Failed,
        "The store failed.",
        "Read the data.",
        &[],
    ),
    CodeInfo::of_retryable(
        "SYNC_TIMEOUT",
        Condition::Timeout,
        true,
        "The wait ran out.",
        "Wait again.",
        &[],
    ),
    CodeInfo::of_retryable(
        "RUN_INCOMPLETE",
        Condition::Incomplete,
        false,
        "The run stopped part-way.",
        "Read what was done.",
        &REASONS,
    ),
    CodeInfo::of_retryable(
        "DEPLOYMENT_INCOMPLETE",
        Condition::Incomplete,
        true,
        "The deployment stopped; repeating it resumes.",
        "Repeat it.",
        &REASONS,
    ),
];

#[test]
fn atip_crate14_32_a_row_built_from_its_condition_has_the_conditions_exit_and_retryability() {
    let row = |code| ROWS.iter().find(|row| row.code == code).expect("a row");
    for (code, exit, retryable) in [
        ("FINDING_NOT_FOUND", EXIT_REFUSED, false),
        ("STORE_UNAVAILABLE", EXIT_REFUSED, true),
        ("STORE_FAILED", EXIT_FAILED, false),
        ("SYNC_TIMEOUT", EXIT_FAILED, true),
        ("RUN_INCOMPLETE", EXIT_FAILED, false),
        ("DEPLOYMENT_INCOMPLETE", EXIT_FAILED, true),
    ] {
        let found = row(code);
        assert_eq!((found.exit, found.retryable), (exit, retryable), "{code}");
        for minor in [Minor::V1_3, Minor::V1_4] {
            assert_eq!(
                code_name_problem(
                    minor,
                    code,
                    Some(i64::from(found.exit)),
                    Some(found.retryable)
                ),
                None,
                "{code} at {minor} is what the name check expects"
            );
        }
    }
}

#[test]
#[should_panic(expected = "not <SUBJECT>_<CONDITION>")]
fn atip_crate14_33_a_code_that_does_not_end_in_the_condition_given_does_not_build() {
    let _ = CodeInfo::of("FINDING_NOT_FOUND", Condition::Invalid, "m", "f", &[]);
}

#[test]
#[should_panic(expected = "not <SUBJECT>_<CONDITION>")]
fn atip_crate14_34_a_code_without_a_subject_does_not_build() {
    let _ = CodeInfo::of("NOT_FOUND", Condition::NotFound, "m", "f", &[]);
}

#[test]
#[should_panic(expected = "not <SUBJECT>_<CONDITION>")]
fn atip_crate14_35_a_subject_that_breaks_the_grammar_does_not_build() {
    let _ = CodeInfo::of("find__ing_NOT_FOUND", Condition::NotFound, "m", "f", &[]);
}

#[test]
#[should_panic(expected = "core code's name")]
fn atip_crate14_36_a_code_never_takes_a_core_codes_name() {
    let _ = CodeInfo::of("COMMAND_REQUIRED", Condition::Required, "m", "f", &[]);
}

#[test]
#[should_panic(expected = "only a FAILED, INCOMPLETE or TIMEOUT code")]
fn atip_crate14_37_only_three_conditions_may_leave_the_default_retryability() {
    let _ = CodeInfo::of_retryable(
        "STORE_UNAVAILABLE",
        Condition::Unavailable,
        false,
        "m",
        "f",
        &[],
    );
}

fn read_what_was_done() -> Next {
    Next::new(
        "acme",
        vec!["run".into(), "status".into(), "--json".into()],
        "What was done",
    )
}

#[test]
fn atip_crate14_38_a_1_3_stop_part_way_is_the_tools_incomplete_code_with_the_refused_code_as_reason(
) {
    let incomplete = &ROWS[4];
    let stopped = stopped_by_changed_plan(incomplete, 2, 5, read_what_was_done());
    let error = &stopped.error;
    assert_eq!(
        (error.code, error.exit, error.retryable),
        ("RUN_INCOMPLETE", EXIT_FAILED, false)
    );
    assert_eq!(error.reason_name(), Some("PLAN_STALE"));
    assert!(error.message.contains("after 2 of 5 effects"));
    assert_eq!(
        error.hint_text(),
        Some("read what was done with `acme run status --json` before running anything again")
    );
    assert_eq!(
        stopped.next,
        vec![read_what_was_done()],
        "meta.next leads with the read command"
    );
    // The retryability is the row's, never the call site's.
    let resumable = stopped_part_way(&ROWS[5], "PLAN_STALE", "stopped", read_what_was_done());
    assert!(resumable.error.retryable);
    assert_eq!(resumable.error.exit, EXIT_FAILED);
    assert_eq!(resumable.error.code, "DEPLOYMENT_INCOMPLETE");
}

#[test]
fn atip_crate14_39_the_1_2_stop_is_still_stopped_midway() {
    let stopped = stopped_by_stale(1, 3, read_what_was_done());
    assert_eq!(
        (
            stopped.error.code,
            stopped.error.exit,
            stopped.error.retryable
        ),
        ("STOPPED_MIDWAY", EXIT_FAILED, false)
    );
    assert_eq!(stopped.error.reason_name(), Some("PLAN_STALE"));
}

#[test]
#[should_panic(expected = "not a <SUBJECT>_INCOMPLETE code")]
fn atip_crate14_40_a_stop_needs_an_incomplete_row() {
    let _ = stopped_part_way(&ROWS[2], "PLAN_STALE", "stopped", read_what_was_done());
}

#[test]
#[should_panic(expected = "not a reason registered under")]
fn atip_crate14_41_a_stop_needs_the_refused_code_registered_as_a_reason() {
    let _ = stopped_part_way(&ROWS[4], "RUN_STALE", "stopped", read_what_was_done());
}

#[test]
#[should_panic(expected = "core code of exit 1")]
fn atip_crate14_42_a_stop_is_never_for_a_refusal_that_exits_1() {
    static ROW: CodeInfo = CodeInfo::of(
        "SYNC_INCOMPLETE",
        Condition::Incomplete,
        "m",
        "f",
        &[ReasonInfo {
            reason: "INTERNAL",
            meaning: "m",
            fix: "f",
        }],
    );
    let _ = stopped_part_way(&ROW, "INTERNAL", "stopped", read_what_was_done());
}
