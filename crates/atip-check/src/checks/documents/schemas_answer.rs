//! `L1.schemas`: the `schema <path> --schemas --json` answer of a 1.4 command (spec 9.9.3, Annex S2 rules 2 and 13).
//!
//! A 1.4 command document embeds no JSON Schema: the schemas answer holds exactly the schemas the document's refs name and
//! the ones they refer to through `#/schemas/<Name>`, each compiling under draft 2020-12, the derived fragment schema of
//! `--input` (spec 9.9.2) under the name `Input` when the command has `input` (and no other schema takes that name), and
//! `rejects`, one list per validator in the document's order. `--schemas` needs a command path: with no path or with a group it
//! refuses with `USAGE` and `field` `--schemas` (spec 9.1.1).
//!
//! The functions read the answers and the command's view ([`crate::l1::view::command_view`]) and launch nothing. What the
//! `rejects` invocations say (they satisfy `required`, `constraints` and the domains, and none is an example) is rule 13 of
//! `L1.walk`, which reads them from the view.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use super::{schema_doc_problems, Finding};
use crate::claim::Claim;
use crate::l1::model::{ref_name, CommandDoc};
use crate::l1::view::derive_fragment;

/// The refs of the command document: every output's `schemaRef` and `eventRef`, and `input.argumentsRef`. (`input.schemaRef` is
/// the view's own name for the derived `Input`, which no document ref takes.)
fn refs_of(doc: &CommandDoc) -> Vec<&str> {
    let mut refs: Vec<&str> = Vec::new();
    for output in &doc.outputs {
        refs.push(&output.schema_ref);
        if let Some(event) = &output.event_ref {
            refs.push(event);
        }
    }
    if let Some(arguments) = doc
        .input
        .as_ref()
        .and_then(|input| input.arguments_ref.as_deref())
    {
        refs.push(arguments);
    }
    refs.retain(|reference| !reference.is_empty());
    refs
}

/// The members of `schemas` the `refs` reach, directly and through `#/schemas/<Name>` references, and the names they reach that
/// `schemas` lacks.
fn reached(schemas: &Map<String, Value>, refs: &[&str]) -> (BTreeSet<String>, BTreeSet<String>) {
    fn visit(
        node: &Value,
        schemas: &Map<String, Value>,
        reached: &mut BTreeSet<String>,
        missing: &mut BTreeSet<String>,
    ) {
        match node {
            Value::Object(object) => {
                for (key, member) in object {
                    match (key.as_str(), member) {
                        ("$ref", Value::String(reference))
                            if reference.starts_with("#/schemas/") =>
                        {
                            enter(
                                ref_name(reference).unwrap_or_default(),
                                schemas,
                                reached,
                                missing,
                            );
                        }
                        _ => visit(member, schemas, reached, missing),
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    visit(item, schemas, reached, missing);
                }
            }
            _ => {}
        }
    }
    fn enter(
        name: &str,
        schemas: &Map<String, Value>,
        reached: &mut BTreeSet<String>,
        missing: &mut BTreeSet<String>,
    ) {
        if reached.contains(name) || missing.contains(name) {
            return;
        }
        match schemas.get(name) {
            None => {
                missing.insert(name.to_string());
            }
            Some(schema) => {
                reached.insert(name.to_string());
                visit(schema, schemas, reached, missing);
            }
        }
    }
    let mut found = BTreeSet::new();
    let mut missing = BTreeSet::new();
    for reference in refs {
        enter(
            ref_name(reference).unwrap_or(reference),
            schemas,
            &mut found,
            &mut missing,
        );
    }
    (found, missing)
}

fn joined(problems: &[String]) -> Option<String> {
    (!problems.is_empty()).then(|| problems.join("; "))
}

/// `L1.schemas`, for the answer of `schema <path> --schemas --json` of one command: `answer` is the whole envelope, `doc` the
/// command's view. The conditions are `kind` (the answer validates against `schema-doc.schema.json`, is `data.kind` `schemas`
/// and names the command), `members` (exactly the schemas the refs reach, and `Input` for a command with `input`, every ref
/// resolving), `compile` (every member compiles under draft 2020-12), `input` (`Input` equals the fragment schema derived
/// from the command's full option set; no ref names `Input`) and `rejects` (present exactly when the command has validators,
/// one list per validator). A claim below 1.4 has the one condition `kind`: a schemas answer is since 1.4.
pub fn schemas_answer_findings(answer: &Value, doc: &CommandDoc, claim: Claim) -> Vec<Finding> {
    if !claim.declares_1_4() {
        return vec![(
            "kind",
            Some(format!(
                "the answer of {} is a schemas answer (data.kind schemas), which is since 1.4, but the claim is {} (Annex S2 rule 16)",
                doc.command,
                claim.as_str()
            )),
        )];
    }
    let data = answer.get("data").unwrap_or(&Value::Null);
    let command = &doc.command;

    let mut kind: Vec<String> = schema_doc_problems(answer, claim);
    if data.get("kind").and_then(Value::as_str) != Some("schemas") {
        kind.push(format!(
            "data.kind is {}, expected \"schemas\" (spec 9.9.3)",
            data.get("kind")
                .map_or("absent".to_string(), Value::to_string)
        ));
    }
    if data.get("command").and_then(Value::as_str) != Some(command.as_str()) {
        kind.push(format!(
            "data.command is {}, expected {command:?}",
            data.get("command")
                .map_or("absent".to_string(), Value::to_string)
        ));
    }

    let schemas: Map<String, Value> = data
        .get("schemas")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let refs = refs_of(doc);
    let (found, missing) = reached(&schemas, &refs);
    let mut members: Vec<String> = refs
        .iter()
        .filter(|reference| ref_name(reference).is_none())
        .map(|reference| {
            format!(
                "the ref {reference} of {command} is not of the form #/schemas/<Name> (spec 9.9.1)"
            )
        })
        .collect();
    members.extend(missing.iter().map(|name| {
        format!("schema {name}, which the refs of {command} reach, is not in its schemas answer (spec 9.9.3, Annex S2 rule 2)")
    }));
    members.extend(
        schemas
            .keys()
            .filter(|name| !found.contains(*name) && !(*name == "Input" && doc.input.is_some()))
            .map(|name| format!("schemas.{name} is reached by no ref of {command} (spec 9.9.3)")),
    );

    let mut compile: Vec<String> = Vec::new();
    for name in schemas.keys() {
        let reference = format!("#/schemas/{name}");
        // A member that reaches a schema the answer lacks cannot be built without it: that is `members`'.
        if !reached(&schemas, &[&reference]).1.is_empty() {
            continue;
        }
        if let Err(error) = doc.compile_ref_in(&reference, &schemas) {
            let first = error.lines().next().unwrap_or(&error);
            compile.push(format!("schemas.{name} does not compile: {first}"));
        }
    }

    let mut input: Vec<String> = Vec::new();
    if refs
        .iter()
        .any(|reference| ref_name(reference) == Some("Input"))
    {
        input.push(format!(
            "a ref of {command} names Input, which the schemas answer keeps for the derived fragment schema (spec 9.9.3)"
        ));
    }
    if doc.input.is_some() {
        let derived = derive_fragment(&doc.operands, &doc.options);
        match schemas.get("Input") {
            None => input.push(format!(
                "the schemas answer of {command} lacks Input, the derived fragment schema of its input (spec 9.9.3, Annex S2 rule 2)"
            )),
            Some(given) if *given != derived => input.push(format!(
                "schemas.Input of {command} differs from the fragment schema derived from its operands and options (spec 9.9.2, Annex S2 rule 10): derived {derived}"
            )),
            Some(_) => {}
        }
    }

    let mut rejects: Vec<String> = Vec::new();
    let validators = doc.validators.len();
    match (validators, data.get("rejects")) {
        (0, Some(_)) => rejects.push(format!(
            "the schemas answer of {command} holds rejects, but the command has no validators (spec 9.9.3)"
        )),
        (0, None) => {}
        (_, Some(Value::Array(lists))) if lists.len() == validators => {}
        (_, _) => rejects.push(format!(
            "the schemas answer of {command} must hold one rejects list per validator ({validators}), in order (spec 9.9.3, Annex S2 rule 2)"
        )),
    }

    vec![
        ("kind", joined(&kind)),
        ("members", joined(&members)),
        ("compile", joined(&compile)),
        ("input", joined(&input)),
        ("rejects", joined(&rejects)),
    ]
}

/// `L1.schemas`, for the answers that must refuse: `schema --schemas --json` (no path) and `schema <a group> --schemas --json`,
/// each a `(call, answer)` with the whole envelope; the condition is `refusals`. A refusal is `ok: false` with `USAGE` (or one of
/// `usage_codes`, its registered finer replacements) and `field` `--schemas` (spec 9.1.1).
pub fn schemas_refusal_findings(
    answers: &[(&str, &Value)],
    usage_codes: &[String],
) -> Vec<Finding> {
    let problems: Vec<String> = answers
        .iter()
        .filter_map(|(call, answer)| {
            if answer.get("ok") != Some(&Value::Bool(false)) {
                return Some(format!(
                    "`{call}` did not refuse: the envelope is not `ok: false`"
                ));
            }
            let code = answer
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if code != "USAGE" && !usage_codes.iter().any(|known| known == code) {
                return Some(format!("`{call}` refused with {code:?}, expected USAGE"));
            }
            let field = answer.pointer("/error/field").and_then(Value::as_str);
            (field != Some("--schemas")).then(|| {
                format!(
                    "`{call}` refused with field {}, expected \"--schemas\"",
                    field.map_or("absent".to_string(), |field| format!("{field:?}"))
                )
            })
        })
        .collect();
    vec![("refusals", joined(&problems))]
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::l1::view::{command_view, ViewContext};

    fn view(schemas: &Value) -> CommandDoc {
        let data = json!({
            "kind": "command", "command": "member tag", "summary": "s", "effect": "write",
            "idempotency": "replay-safe",
            "operands": [{"name": "number", "valueType": "integer", "required": true, "help": "n"}],
            "options": [{"name": "tag", "required": true, "help": "t"}],
            "errors": ["TAG_INVALID"],
            "outputs": [{"schemaRef": "#/schemas/Report"}],
            "input": {"maxBytes": 1000, "example": {"operands": [7], "tag": "x"}},
            "validators": [{"arguments": ["tag"], "code": "TAG_INVALID", "description": "d"}],
            "examples": ["acme member tag 7 --tag x --json"]
        });
        let context = ViewContext {
            schemas_answer: Some(&schemas["data"]),
            ..ViewContext::default()
        };
        command_view(&data, &context).expect("a command")
    }

    fn answer(doc: &CommandDoc, edit: impl FnOnce(&mut Value)) -> Value {
        let derived = derive_fragment(&doc.operands, &doc.options);
        let mut document = json!({
            "ok": true,
            "data": {
                "kind": "schemas", "command": "member tag",
                "schemas": {
                    "Report": {"type": "object", "properties": {"owner": {"$ref": "#/schemas/Owner"}}},
                    "Owner": {"type": "string"},
                    "Input": derived
                },
                "rejects": [["acme member tag 7 --tag admin --json"]]
            },
            "meta": {"command": "schema", "contract": "atip/1", "contractVersion": "1.4", "schemaVersion": "1.4", "tool": "acme", "toolVersion": "1.0.0"}
        });
        edit(&mut document);
        document
    }

    fn failing(findings: &[Finding]) -> Vec<&'static str> {
        findings
            .iter()
            .filter(|(_, problem)| problem.is_some())
            .map(|(condition, _)| *condition)
            .collect()
    }

    #[test]
    fn atip_check14_11_a_schemas_answer_holds_what_the_refs_reach_the_derived_input_and_the_rejects(
    ) {
        let empty = json!({"data": {}});
        let doc = view(&empty);
        let good = answer(&doc, |_| {});
        let findings = schemas_answer_findings(&good, &doc, Claim::V1_4);
        assert!(failing(&findings).is_empty(), "{findings:#?}");
        let doc = view(&good);

        type Edit = fn(&mut Value);
        let cases: [(&str, Edit, &str); 7] = [
            (
                "an extra schema",
                |a| a["data"]["schemas"]["Spare"] = json!({"type": "string"}),
                "members",
            ),
            (
                "a missing schema",
                |a| {
                    a["data"]["schemas"]
                        .as_object_mut()
                        .expect("o")
                        .remove("Owner");
                },
                "members",
            ),
            (
                "a schema that does not compile",
                |a| a["data"]["schemas"]["Owner"] = json!({"type": 7}),
                "compile",
            ),
            (
                "an Input that differs",
                |a| a["data"]["schemas"]["Input"]["additionalProperties"] = json!(true),
                "input",
            ),
            (
                "no Input",
                |a| {
                    a["data"]["schemas"]
                        .as_object_mut()
                        .expect("o")
                        .remove("Input");
                },
                "input",
            ),
            (
                "no rejects",
                |a| {
                    a["data"].as_object_mut().expect("o").remove("rejects");
                },
                "rejects",
            ),
            (
                "another command",
                |a| a["data"]["command"] = json!("member show"),
                "kind",
            ),
        ];
        for (what, edit, condition) in cases {
            let edited = answer(&doc, edit);
            assert_eq!(
                failing(&schemas_answer_findings(&edited, &doc, Claim::V1_4)),
                [condition],
                "{what}"
            );
        }
        let before = schemas_answer_findings(&good, &doc, Claim::V1_3);
        assert_eq!(failing(&before), ["kind"]);
    }

    #[test]
    fn atip_check14_12_schemas_without_a_command_path_refuses_on_the_field_schemas() {
        let refusal = |code: &str, field: Option<&str>| {
            let mut error = json!({"code": code, "message": "m", "retryable": false});
            if let Some(field) = field {
                error["field"] = json!(field);
            }
            json!({"ok": false, "error": error, "meta": {}})
        };
        let good = refusal("USAGE", Some("--schemas"));
        let tree = json!({"ok": true, "data": {"kind": "tree"}, "meta": {}});
        assert!(failing(&schemas_refusal_findings(
            &[("acme schema --schemas --json", &good)],
            &[]
        ))
        .is_empty());
        for bad in [
            &tree,
            &refusal("USAGE", None),
            &refusal("UNKNOWN_COMMAND", Some("--schemas")),
        ] {
            assert_eq!(
                failing(&schemas_refusal_findings(
                    &[("acme schema --schemas --json", bad)],
                    &[]
                )),
                ["refusals"]
            );
        }
    }
}
