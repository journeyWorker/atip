//! The claim of atip/1 1.6 (approaches/checker.md 6 and 7.2): a conforming tool of 1.5 and of 1.6 passes `atip check`, and each condition the
//! 1.6 rows add (`L1.comma-list`, `L1.depth` with `pathShape`, Annex S2 rule 16 for the members since 1.6, rule 18, `L1.one-meaning` per
//! group) fails the row that owns it, and no other, against a fake tool with one planted violation.

mod support;

use serde_json::{json, Value};
use support::l1::{l1_bin, l1_config_of};
use support::l2::{add, check_of, in_parallel, not_passing, patch, verdict};
use support::{kind_verdict, Case, Harness, Output};

/// The configuration of the conforming fake of `claims` (`1.5` or `1.6`), the members of `extra` set.
fn config(claims: &str, extra: &Value) -> Value {
    l1_config_of(
        claims,
        &format!("atip-fake-tool-claims{}", claims.replace('.', "")),
        extra,
    )
}

/// `atip check --level L1 --deep --json` of the fake tool of `config`, or the same in the interface mode.
fn run(config: &Value, deep: bool) -> Output {
    let harness = Harness::new();
    let fixture = harness.l1_fixture(config);
    let fixture_path = harness.write("fixture.json", &fixture);
    let bin = l1_bin(&harness, config);
    let work = harness.path("cwd");
    std::fs::create_dir_all(&work).expect("cwd");
    let tmp = harness.path("tmp");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let mut args = vec![
        "check",
        "--bin",
        bin.to_str().expect("utf8"),
        "--level",
        "L1",
        "--fixture",
        fixture_path.to_str().expect("utf8"),
        "--json",
    ];
    if deep {
        args.push("--deep");
    }
    support::atip_as_given(&work, &tmp, &args)
}

/// A run that conforms: exit 0, and every check passes or does not apply.
fn assert_conforms(output: &Output, what: &str) {
    assert_eq!(output.code, Some(0), "{what}: {}", output.stdout);
    let data = &output.envelope()["data"];
    assert_eq!(data["passed"], true, "{what}: {}", output.stdout);
    assert_eq!(not_passing(data), "", "{what}");
}

#[test]
fn atip_check16_40_a_conforming_1_5_and_1_6_tool_passes_and_only_1_6_has_the_comma_list_row() {
    for claims in ["1.5", "1.6"] {
        for deep in [false, true] {
            let output = run(&config(claims, &json!({})), deep);
            let what = format!("{claims} deep={deep}");
            assert_conforms(&output, &what);
            let ids: Vec<String> = output.results().into_iter().map(|(id, _)| id).collect();
            let has = ids.iter().any(|id| id == "L1.comma-list");
            // The row is a 1.6 one and deep only: an interface run lists it among the checks `--deep` adds.
            assert_eq!(has, claims == "1.6" && deep, "{what}: {ids:?}");
            if claims == "1.6" && deep {
                assert_eq!(output.check("L1.comma-list")["result"], "pass", "{what}");
                assert_eq!(output.check("L1.comma-list")["strength"], "MUST");
            }
            if claims == "1.6" && !deep {
                let listed = output.envelope()["data"]["deepChecks"].to_string();
                assert!(listed.contains("L1.comma-list"), "{listed}");
            }
        }
    }
}

/// The case of a seeded violation: `condition` is `<check>/<condition>` at the claim `claims`.
fn case(claims: &str, condition: &'static str, extra: Value) -> Case {
    Case {
        condition,
        config: config(claims, &extra),
        tweak: None,
    }
}

/// `patch` with the members of `extra` set.
fn patched(entries: &[(&str, Vec<Value>)], extra: &Value) -> Value {
    let mut config = patch(entries);
    for (key, value) in extra.as_object().into_iter().flatten() {
        config[key] = value.clone();
    }
    config
}

/// One member of `options` of the compact form: no `valueName` (its default is the upper-case name).
fn option(name: &str, extra: &Value) -> Value {
    let mut option = json!({"name": name, "help": "h"});
    for (key, value) in extra.as_object().into_iter().flatten() {
        option[key] = value.clone();
    }
    option
}

/// The seeded violations of the rows of 1.6, one per condition.
fn cases_1_6() -> Vec<Case> {
    let path_shape = |entries: &[(&str, Vec<Value>)], extra: &Value| patched(entries, extra);
    vec![
        // L1.comma-list: the comma list is not split, and an empty piece is accepted.
        case(
            "1.6",
            "comma-list/split-same-answer",
            json!({"commaListUnsplit": true}),
        ),
        case(
            "1.6",
            "comma-list/empty-piece-refused",
            json!({"commaListEmptyAccepted": true}),
        ),
        case(
            "1.6",
            "comma-list/env-split",
            json!({"commaListEnvUnsplit": true}),
        ),
        // Annex S2 rule 18: `commaList` on a command the checker does not run, on an option that is not repeatable.
        case(
            "1.6",
            "walk/rule-18",
            patch(&[(
                "reject",
                vec![add(
                    "/options/-",
                    option("pieces", &json!({"commaList": true})),
                )],
            )]),
        ),
        // Annex S2 rule 16: `commaList` in a document of 1.5, `pathShape` in a tree of 1.5.
        case(
            "1.5",
            "walk/minor-form",
            patch(&[(
                "member search",
                vec![add("/options/name=tag/commaList", json!(true))],
            )]),
        ),
        case(
            "1.5",
            "tree/minor-form",
            patch(&[("<tree>", vec![add("/pathShape", json!(["noun", "verb"]))])]),
        ),
        // Annex S2 rule 19: a path longer than the tree's `pathShape`.
        Case {
            condition: "tree/path-shape",
            config: config(
                "1.6",
                &path_shape(
                    &[("<tree>", vec![add("/pathShape", json!(["noun", "verb"]))])],
                    &json!({"deepTree": true}),
                ),
            ),
            tweak: None,
        },
        case(
            "1.6",
            "depth/within-path-shape",
            json!({"deepTree": true, "deeperTree": true}),
        ),
        // L1.one-meaning per group (Annex S1 item 4): one value name, two types; and two value names in one group.
        case(
            "1.6",
            "one-meaning/value-type",
            patch(&[(
                "team add",
                vec![add(
                    "/options/-",
                    option("name", &json!({"valueType": "integer"})),
                )],
            )]),
        ),
        case(
            "1.6",
            "one-meaning/value-name",
            patch(&[(
                "member tag",
                vec![add(
                    "/options/-",
                    option(
                        "filter",
                        &json!({"valueType": "json", "valueName": "OTHER_FILTER"}),
                    ),
                )],
            )]),
        ),
    ]
}

/// One seeded violation: the owner fails with a finding of the kind of its condition, no other check fails, and the exit is the strength's.
fn prove(case: &Case) -> Result<(), String> {
    let owner = format!(
        "L1.{}",
        case.condition.split('/').next().unwrap_or_default()
    );
    let output = run(&case.config, true);
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
    let expected = if check_of(&document["data"], &owner)["strength"] == "MUST" {
        Some(1)
    } else {
        Some(0)
    };
    if output.code != expected {
        return Err(format!(
            "{}: exit {:?}, expected {expected:?}",
            case.condition, output.code
        ));
    }
    Ok(())
}

#[test]
fn atip_check16_41_each_violation_of_a_1_6_row_fails_the_row_that_owns_it_and_no_other() {
    let jobs: Vec<Box<dyn FnOnce() -> Result<(), String> + Send>> = cases_1_6()
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
fn atip_check16_42_the_depth_problem_names_the_limit_and_a_path_shape_is_the_trees_to_judge() {
    let seeded = |claims: &str, extra: &Value| {
        let output = run(&config(claims, extra), true);
        let depth = output.check("L1.depth").clone();
        assert_eq!(depth["result"], "fail", "{}", output.stdout);
        // A SHOULD: the level is met.
        assert_eq!(output.code, Some(0), "{}", output.stdout);
        depth["reason"].as_str().unwrap_or_default().to_string()
    };
    let default = seeded("1.6", &json!({"deepTree": true, "deeperTree": true}));
    assert!(
        default.contains("team roster item list has 4 words")
            && default.contains("the default of 3 words")
            && default.contains("4.1.1"),
        "{default}"
    );
    // Below 1.6 the default is two words.
    let below = seeded("1.5", &json!({"deepTree": true}));
    assert!(
        below.contains("team roster list has 3 words")
            && below.contains("the default of 2 words for a 1.5 claim"),
        "{below}"
    );
    // Three words are within the default of a 1.6 tree: the conforming tool with a three-word path passes `L1.depth`.
    let three = run(&config("1.6", &json!({"deepTree": true})), true);
    assert_eq!(
        three.check("L1.depth")["result"],
        "pass",
        "{}",
        three.stdout
    );
    // A tree that declares a `pathShape` has its limit from it, judged by rule 19 in `L1.tree`; `L1.depth` has nothing to add.
    let shaped = run(
        &config(
            "1.6",
            &patched(
                &[("<tree>", vec![add("/pathShape", json!(["noun", "verb"]))])],
                &json!({"deepTree": true}),
            ),
        ),
        true,
    );
    assert_eq!(shaped.check("L1.depth")["result"], "unsupported");
    let tree = shaped.check("L1.tree");
    assert_eq!(tree["result"], "fail", "{}", shaped.stdout);
    let reason = tree["reason"].as_str().unwrap_or_default();
    assert!(
        reason.contains("team roster list has 3 words") && reason.contains("2 labels"),
        "{reason}"
    );
    // A `pathShape` of three labels lets the three-word path through.
    let wide = run(
        &config(
            "1.6",
            &patched(
                &[(
                    "<tree>",
                    vec![add("/pathShape", json!(["product", "noun", "verb"]))],
                )],
                &json!({"deepTree": true}),
            ),
        ),
        true,
    );
    assert_eq!(wide.check("L1.tree")["result"], "pass", "{}", wide.stdout);
}

#[test]
fn atip_check16_43_an_option_name_may_mean_two_things_in_two_groups_when_the_value_names_differ() {
    // `team add` (group `team`) and `touch` (the root) have a `--name`: another value name across groups is allowed.
    let allowed = config(
        "1.6",
        &patch(&[(
            "team add",
            vec![add(
                "/options/-",
                option("name", &json!({"valueName": "TEAM_NAME"})),
            )],
        )]),
    );
    let output = run(&allowed, true);
    assert_eq!(
        output.check("L1.one-meaning")["result"],
        "pass",
        "{}",
        output.stdout
    );
    // The same tool read under a claim below 1.6 keeps the tool-wide rule.
    let mut below = config("1.5", &json!({}));
    below["docPatch"] = allowed["docPatch"].clone();
    let output = run(&below, true);
    assert_eq!(
        output.check("L1.one-meaning")["result"],
        "fail",
        "{}",
        output.stdout
    );
}

#[test]
fn atip_check16_44_a_comma_in_an_item_of_a_document_is_refused_for_a_comma_list() {
    // The conforming L2 fake of 1.6: `member tag --tag` is a comma list, and `["a,b"]` in a document is no value of it (spec 9.7.6).
    let harness = Harness::new();
    let config = support::l2::l2_config_of("1.6", &json!({}));
    let fixture = harness.l2_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L2");
    let data = output.envelope()["data"].clone();
    assert_eq!(not_passing(&data), "", "{}", output.stdout);
    let refusals = check_of(&data, "L2.input-refusals");
    assert_eq!(refusals["result"], "pass", "{}", output.stdout);
    let observed = refusals["observed"].to_string();
    assert!(
        observed.contains("member") && observed.contains("tag") && observed.contains("x,x"),
        "{observed}"
    );

    // Seeded: the tool leaves the domain of the comma list unchecked, so the item is kept as one value: `L2.input-refusals` fails `refused`.
    let config = support::l2::l2_config_of("1.6", &json!({"commaItemAccepted": true}));
    let fixture = harness.l2_fixture(&config);
    let output = harness.check_l2_at(&config, &fixture, "L2");
    let data = output.envelope()["data"].clone();
    verdict(&data, "L2.input-refusals").expect("the owner fails");
    kind_verdict(&data, "L2.input-refusals", "refused").expect("the condition refused");
}
