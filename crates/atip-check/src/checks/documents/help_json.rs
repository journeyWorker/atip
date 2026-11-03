//! `L1.help-json`: the refusals of `--help --json` and `--version --json` in a 1.4 document (spec 4.4.1).
//!
//! The machine-readable self-description is `schema`, never `--help`: a 1.4 tool answers `--help` with `--json` with
//! `USAGE` (or its registered finer replacement, spec 7.3.2), `field` `--help` and the hint that names the `schema` call for the path
//! the call named (`<tool> schema <PATH> --json`, `<tool> schema --json` at the root), after resolving the path, so that an unknown word
//! still answers `UNKNOWN_COMMAND`; `--version` with `--json` refuses the same way with `field` `--version` and the hint
//! `<tool> --version`, the version being in every envelope's `meta.toolVersion` (1.4.2: the path is resolved first for it too).
//!
//! The function judges the answers of the calls a run made and launches nothing.

use serde_json::Value;

use super::Finding;

/// What one call printed: the process exit and the JSON document on its stdout, when it held one.
#[derive(Debug, Clone, Copy)]
pub struct Answer<'a> {
    pub exit: Option<i64>,
    pub document: Option<&'a Value>,
}

/// The answers of the calls `L1.help-json` makes.
#[derive(Debug, Clone, Copy)]
pub struct HelpJsonAnswers<'a> {
    /// `<tool> --help --json`.
    pub root: Answer<'a>,
    /// `<tool> <command> --help --json`.
    pub command: Answer<'a>,
    /// `<tool> nosuch-xyz --help --json`.
    pub unknown: Answer<'a>,
    /// `<tool> --version --json`.
    pub version: Answer<'a>,
    /// `<tool> nosuch-xyz --version --json` (1.4.2: the path is resolved first), when the run made the call.
    pub version_unknown: Option<Answer<'a>>,
}

/// What `answer` must be: a refusal with exit 2, one of `codes`, and, when `field` is given, that `field` and one of the
/// `hints`. The problem, when it is not.
fn refusal_problem(
    answer: &Answer<'_>,
    codes: &[&str],
    field: Option<&str>,
    hints: &[String],
) -> Option<String> {
    let Some(document) = answer.document else {
        return Some("it printed no JSON document".to_string());
    };
    if answer.exit != Some(2) {
        return Some(format!(
            "it exited {}, expected 2",
            answer
                .exit
                .map_or("without an exit status".to_string(), |exit| exit
                    .to_string())
        ));
    }
    if document.get("ok") != Some(&Value::Bool(false)) {
        return Some("it did not refuse: the envelope is not `ok: false`".to_string());
    }
    if let Some(kind) = document.pointer("/data/kind").and_then(Value::as_str) {
        return Some(format!("it printed a `{kind}` document with its refusal"));
    }
    let code = document
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !codes.contains(&code) {
        return Some(format!(
            "its error code is {code:?}, expected {}",
            codes.join(" or ")
        ));
    }
    let field = field?;
    let found = document.pointer("/error/field").and_then(Value::as_str);
    if found != Some(field) {
        return Some(format!(
            "its error field is {}, expected {field:?}",
            found.map_or("absent".to_string(), |found| format!("{found:?}"))
        ));
    }
    let hint = document.pointer("/error/hint").and_then(Value::as_str);
    if !hint.is_some_and(|hint| hints.iter().any(|wanted| wanted == hint)) {
        return Some(format!(
            "its hint is {}, expected {}",
            hint.map_or("absent".to_string(), |hint| format!("{hint:?}")),
            hints
                .iter()
                .map(|wanted| format!("{wanted:?}"))
                .collect::<Vec<_>>()
                .join(" or ")
        ));
    }
    None
}

/// Whether a string of `document`, other than `meta.toolVersion`, is the tool's version (`1.0.0`, `acme 1.0.0`).
fn prints_version(document: &Value, tool: &str) -> Option<String> {
    let version = document
        .pointer("/meta/toolVersion")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())?;
    let own = format!("{tool} {version}");
    fn leaves<'a>(value: &'a Value, at: &str, found: &mut Vec<(String, &'a str)>) {
        match value {
            Value::String(text) => found.push((at.to_string(), text)),
            Value::Object(object) => {
                for (key, member) in object {
                    leaves(member, &format!("{at}/{key}"), found);
                }
            }
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    leaves(item, &format!("{at}/{index}"), found);
                }
            }
            _ => {}
        }
    }
    let mut found = Vec::new();
    leaves(document, "", &mut found);
    found
        .into_iter()
        .find(|(at, text)| at != "/meta/toolVersion" && (*text == version || *text == own))
        .map(|(at, text)| format!("the version {text:?} is printed at {at}"))
}

/// `L1.help-json`, for a tool named `tool` of a 1.4 claim and one of its commands `command` (its id, `member tag`): the
/// four conditions `help-root`, `help-command`, `help-unknown` and `version`. `usage_codes` are the registered finer
/// replacements of `USAGE` (`usage_replacements` of the registry): a refusal may use one of them in place of `USAGE`.
pub fn help_json_findings(
    tool: &str,
    command: &str,
    answers: &HelpJsonAnswers<'_>,
    usage_codes: &[String],
) -> Vec<Finding> {
    let mut usage: Vec<&str> = vec!["USAGE"];
    usage.extend(usage_codes.iter().map(String::as_str));
    let root_hint = vec![format!("{tool} schema --json")];
    // Path words are accepted separately or as one quoted string (spec 9.1.1): the hint may name the path either way.
    let command_hint = vec![
        format!("{tool} schema {command} --json"),
        format!("{tool} schema \"{command}\" --json"),
    ];
    let version_hint = vec![format!("{tool} --version")];
    let explain = |what: &str, problem: Option<String>| {
        problem.map(|problem| format!("`{what}`: {problem} (spec 4.4.1)"))
    };

    let version = explain(
        &format!("{tool} --version --json"),
        refusal_problem(&answers.version, &usage, Some("--version"), &version_hint).or_else(|| {
            answers
                .version
                .document
                .and_then(|document| prints_version(document, tool))
        }),
    )
    .or_else(|| {
        answers.version_unknown.and_then(|answer| {
            explain(
                &format!("{tool} nosuch-xyz --version --json"),
                refusal_problem(&answer, &["UNKNOWN_COMMAND"], None, &[]),
            )
        })
    });
    vec![
        (
            "help-root",
            explain(
                &format!("{tool} --help --json"),
                refusal_problem(&answers.root, &usage, Some("--help"), &root_hint),
            ),
        ),
        (
            "help-command",
            explain(
                &format!("{tool} {command} --help --json"),
                refusal_problem(&answers.command, &usage, Some("--help"), &command_hint),
            ),
        ),
        (
            "help-unknown",
            explain(
                &format!("{tool} nosuch-xyz --help --json"),
                refusal_problem(&answers.unknown, &["UNKNOWN_COMMAND"], None, &[]),
            ),
        ),
        ("version", version),
    ]
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn refusal(code: &str, field: Option<&str>, hint: Option<&str>) -> Value {
        let mut error = json!({"code": code, "message": "m", "retryable": false});
        if let Some(field) = field {
            error["field"] = json!(field);
        }
        if let Some(hint) = hint {
            error["hint"] = json!(hint);
        }
        json!({"ok": false, "error": error, "meta": {"toolVersion": "1.0.0"}})
    }

    fn answer(document: &Value) -> Answer<'_> {
        Answer {
            exit: Some(2),
            document: Some(document),
        }
    }

    fn failing(findings: &[Finding]) -> Vec<&'static str> {
        findings
            .iter()
            .filter(|(_, problem)| problem.is_some())
            .map(|(condition, _)| *condition)
            .collect()
    }

    #[test]
    fn atip_check14_10_help_and_version_refuse_and_an_unknown_word_is_still_unknown() {
        let root = refusal("USAGE", Some("--help"), Some("acme schema --json"));
        let command = refusal(
            "USAGE",
            Some("--help"),
            Some("acme schema member show --json"),
        );
        let unknown = refusal("UNKNOWN_COMMAND", None, None);
        let version = refusal("USAGE", Some("--version"), Some("acme --version"));
        let version_unknown = refusal("UNKNOWN_COMMAND", None, None);
        let answers = HelpJsonAnswers {
            root: answer(&root),
            command: answer(&command),
            unknown: answer(&unknown),
            version: answer(&version),
            version_unknown: Some(answer(&version_unknown)),
        };
        assert!(failing(&help_json_findings("acme", "member show", &answers, &[])).is_empty());

        // The tree printed for `--help --json`, the hint of another path, USAGE for an unknown word, a version printed.
        let tree = json!({"ok": true, "data": {"kind": "tree", "commands": []}, "meta": {}});
        let wrong_hint = refusal("USAGE", Some("--help"), Some("acme schema --json"));
        let usage_for_unknown = refusal("USAGE", Some("--help"), Some("acme schema --json"));
        let printed = json!({"ok": false, "error": {"code": "USAGE", "message": "acme 1.0.0", "field": "--version", "hint": "acme --version", "retryable": false}, "meta": {"toolVersion": "1.0.0"}});
        let cases = [
            (
                HelpJsonAnswers {
                    root: Answer {
                        exit: Some(0),
                        document: Some(&tree),
                    },
                    ..answers
                },
                "help-root",
            ),
            (
                HelpJsonAnswers {
                    command: answer(&wrong_hint),
                    ..answers
                },
                "help-command",
            ),
            (
                HelpJsonAnswers {
                    unknown: answer(&usage_for_unknown),
                    ..answers
                },
                "help-unknown",
            ),
            (
                HelpJsonAnswers {
                    version: Answer {
                        exit: Some(2),
                        document: Some(&printed),
                    },
                    ..answers
                },
                "version",
            ),
            (
                HelpJsonAnswers {
                    version_unknown: Some(answer(&version)),
                    ..answers
                },
                "version",
            ),
        ];
        for (answers, condition) in cases {
            assert_eq!(
                failing(&help_json_findings("acme", "member show", &answers, &[])),
                [condition],
                "{answers:?}"
            );
        }
        // A registered finer replacement of USAGE stands for it.
        let finer = refusal("OPTION_INVALID", Some("--help"), Some("acme schema --json"));
        let replaced = HelpJsonAnswers {
            root: answer(&finer),
            ..answers
        };
        assert_eq!(
            failing(&help_json_findings("acme", "member show", &replaced, &[])),
            ["help-root"]
        );
        assert!(failing(&help_json_findings(
            "acme",
            "member show",
            &replaced,
            &["OPTION_INVALID".to_string()]
        ))
        .is_empty());
    }
}
