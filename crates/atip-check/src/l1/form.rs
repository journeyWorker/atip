//! The form of a self-description of the declared minor: Annex S2 rules 16 and 17 (spec 9.5, 15.5, 15.7).
//!
//! A document of 1.0-1.3 keeps every member it carried before 1.4 and uses nothing that is since 1.4; a document of 1.4
//! carries no member that `x-atip-until` retires and no member whose value is its default. JSON Schema cannot say either
//! (the schema marks both and states the defaults, and a document of every minor must validate against it), so the
//! functions here read the marks and the defaults from `schema/schema-doc.schema.json` itself, the same text the schema
//! check validates against, and judge the document as it was printed (`CommandDoc::raw` for a command).
//!
//! Each function returns [`Findings`]: for a claim of 1.4 or later the conditions that judge the 1.4 form, for an earlier
//! claim the one condition `minor-form`. The names of a command's `options` are read by [`super::view::command_view`],
//! which keeps what it found in `CommandDoc::v14`; the condition `option-names` reports it.

use std::sync::LazyLock;

use serde_json::{Map, Value};

use super::model::CommandDoc;
use super::rules::Findings;
use crate::claim::Claim;

/// The `$defs` of `schema-doc.schema.json`, parsed once.
static DEFINITIONS: LazyLock<Value> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(atip::schema::SCHEMA_DOC_SCHEMA)
        .expect("the embedded schema-doc.schema.json is JSON");
    schema
        .get("$defs")
        .cloned()
        .expect("schema-doc.schema.json has $defs")
});

/// The properties of the definition `def` of `schema-doc.schema.json`.
fn members(def: &str) -> Option<&'static Map<String, Value>> {
    DEFINITIONS.get(def)?.get("properties")?.as_object()
}

/// What a 1.4 document carries that its minor does not allow, by rule.
#[derive(Debug, Default)]
struct Form {
    /// Members only 1.0-1.3 carry (Annex S2 rule 16).
    retired: Vec<String>,
    /// Members at their default (Annex S2 rule 17).
    defaults: Vec<String>,
}

impl Form {
    /// The retired members and the members at their default of one object of the definition `def`; `overrides` are the
    /// defaults the definition does not state (an argument's depend on its `valueType` and `name`).
    fn node(&mut self, def: &str, node: &Value, at: &str, overrides: &[(&str, Value)]) {
        let (Some(known), Some(object)) = (members(def), node.as_object()) else {
            return;
        };
        for (key, value) in object {
            let schema = known.get(key);
            if schema.is_some_and(|schema| schema.get("x-atip-until").is_some()) {
                self.retired.push(format!(
                    "{at}: {key} is only in documents of 1.0-1.3, and a 1.4 document does not carry it (spec 15.7, Annex S2 rule 16)"
                ));
                continue;
            }
            let default = overrides
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, default)| default)
                .or_else(|| schema.and_then(|schema| schema.get("default")));
            if default == Some(value) {
                self.defaults.push(format!(
                    "{at}: {key} is {value}, its default, so a 1.4 document leaves it out (spec 9.5, Annex S2 rule 17)"
                ));
            }
        }
    }

    /// An operand or option (`def` is `operand` or `option`): its `default`, `valueName` and, on a count, `repeatable`
    /// have their own defaults (spec 9.5).
    fn argument(&mut self, def: &str, node: &Value, at: &str) {
        let value_type = node
            .get("valueType")
            .and_then(Value::as_str)
            .unwrap_or("string");
        let name = node.get("name").and_then(Value::as_str).unwrap_or_default();
        let default = match value_type {
            "switch" => Value::Bool(false),
            "count" => Value::from(0),
            _ => Value::Null,
        };
        self.node(
            def,
            node,
            at,
            &[
                ("default", default),
                (
                    "valueName",
                    Value::String(name.to_ascii_uppercase().replace('-', "_")),
                ),
            ],
        );
        if value_type == "count" && node.get("repeatable").is_some() {
            self.defaults.push(format!(
                "{at}: a count is repeatable by definition, and a 1.4 document does not say so (spec 9.5, Annex S2 rule 17)"
            ));
        }
    }

    fn entries(&mut self, entries: &Value, owner: &str) {
        for entry in entries.as_array().into_iter().flatten() {
            let command = entry
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            self.node("treeEntry", entry, &format!("{owner}entry {command}"), &[]);
        }
    }
}

fn joined(problems: &[String]) -> Option<String> {
    (!problems.is_empty()).then(|| problems.join("; "))
}

/// `L1.tree`, for the `data` of a tree answer: a 1.4 claim has `entry-form` (no entry has a `path`, nor `kind:
/// "command"`, nor any member at its default) and `options-form` (the shared options, when the tree has any: no member at
/// its default, each defined once); an earlier claim has `minor-form`.
pub fn tree_form_findings(data: &Value, claim: Claim) -> Findings {
    if !claim.declares_1_4() {
        return vec![("minor-form", joined(&legacy_problems(data)))];
    }
    let mut form = Form::default();
    form.entries(data.get("commands").unwrap_or(&Value::Null), "tree ");
    let mut options = Form::default();
    let mut defined: Vec<&str> = Vec::new();
    let mut twice: Vec<String> = Vec::new();
    for option in data
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = option
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if defined.contains(&name) && !twice.iter().any(|earlier| earlier == name) {
            twice.push(name.to_string());
        }
        defined.push(name);
        options.argument("option", option, &format!("tree option {name}"));
    }
    let mut problems: Vec<String> = options.retired;
    problems.extend(options.defaults);
    problems.extend(
        twice
            .iter()
            .map(|name| format!("tree option {name} is defined twice (spec 9.3)")),
    );
    vec![
        (
            "entry-form",
            joined(&[form.retired, form.defaults].concat()),
        ),
        ("options-form", joined(&problems)),
    ]
}

/// `L1.walk`, for the `data` of a group answer: a 1.4 claim has `group-form` (no `path` on the group or its entries, no
/// member at its default); an earlier claim has `minor-form`.
pub fn group_form_findings(data: &Value, claim: Claim) -> Findings {
    if !claim.declares_1_4() {
        return vec![("minor-form", joined(&legacy_problems(data)))];
    }
    let mut form = Form::default();
    let command = data
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    form.node("group", data, &format!("group {command}"), &[]);
    form.entries(
        data.get("commands").unwrap_or(&Value::Null),
        &format!("group {command} "),
    );
    vec![(
        "group-form",
        joined(&[form.retired, form.defaults].concat()),
    )]
}

/// `L1.walk`, for a command document: a 1.4 claim has `no-retired-members` (no `path`, `schemas`, `input.option`,
/// `input.schemaRef` or `validators[].rejects`: Annex S2 rule 16), `no-default-members` (no member at its default: rule 17)
/// and `option-names` (every name in `options` a tree option or a reserved option the document does not imply, none given
/// twice, `--input` and `--fields` only where the document offers them: rule 17, spec 9.5); an earlier claim has
/// `minor-form`. `doc` is what [`super::view::command_view`] built for a 1.4 claim, or `CommandDoc::parse` before.
pub fn command_form_findings(doc: &CommandDoc, claim: Claim) -> Findings {
    if !claim.declares_1_4() {
        return vec![("minor-form", joined(&legacy_problems(&doc.raw)))];
    }
    let mut form = Form::default();
    let raw = &doc.raw;
    let command = raw
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    form.node("command", raw, command, &[]);
    for (index, output) in raw
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        form.node("output", output, &format!("{command} output {index}"), &[]);
    }
    if let Some(input) = raw.get("input") {
        form.node("input", input, &format!("{command} input"), &[]);
    }
    for operand in raw
        .get("operands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = operand
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        form.argument("operand", operand, &format!("{command} operand {name}"));
    }
    for option in raw
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|option| option.is_object())
    {
        let name = option
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        form.argument("option", option, &format!("{command} option {name}"));
    }
    for (index, validator) in raw
        .get("validators")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        form.node(
            "validator",
            validator,
            &format!("{command} validator {index}"),
            &[],
        );
    }

    let mut names: Vec<String> = Vec::new();
    if let Some(notes) = &doc.v14 {
        names.extend(notes.unknown_names.iter().map(|name| {
            format!("option name {name} in {command} names no option of the tree and no reserved option (spec 9.5, Annex S2 rule 17)")
        }));
        names.extend(notes.given_twice.iter().map(|name| {
            format!("option --{name} is given more than once in the options of {command} (Annex S2 rule 17)")
        }));
        names.extend(notes.unoffered_options_listed.iter().map(|name| {
            let feature = if name == "input" {
                "no input"
            } else {
                "no output with fields"
            };
            format!("{command} lists --{name}, but its document has {feature} (spec 9.5, Annex S2 rule 5)")
        }));
    }
    vec![
        ("no-retired-members", joined(&form.retired)),
        ("no-default-members", joined(&form.defaults)),
        ("option-names", joined(&names)),
    ]
}

/// `L1.walk` (the tree's options): every option the tree defines is named by at least one command (Annex S2 rule 17).
/// `tree` is the `data` of the tree answer, `docs` the views of the commands read (`CommandDoc::v14` says which options
/// each names). A search answer (`query`) lists matches, not the tree, and defines nothing to name; a tree with no
/// `options` has nothing to judge, and the result is empty.
pub fn tree_options_named_findings(tree: &Value, docs: &[&CommandDoc]) -> Findings {
    let Some(options) = tree
        .get("options")
        .and_then(Value::as_array)
        .filter(|_| tree.get("query").is_none())
    else {
        return Vec::new();
    };
    let unused: Vec<String> = options
        .iter()
        .filter_map(|option| option.get("name").and_then(Value::as_str))
        .filter(|name| {
            !docs.iter().any(|doc| {
                doc.v14
                    .as_ref()
                    .is_some_and(|notes| notes.named.iter().any(|named| named == name))
            })
        })
        .map(|name| format!("tree option {name} is named by no command (Annex S2 rule 17)"))
        .collect();
    vec![("tree-options-named", joined(&unused))]
}

/// The members a document of 1.0-1.3 carries and the schema no longer requires, by definition (spec 15.7).
const LEGACY_REQUIRED: [(&str, &[&str]); 8] = [
    ("treeEntry", &["path", "kind"]),
    ("group", &["path"]),
    (
        "command",
        &["path", "operands", "options", "errors", "schemas"],
    ),
    (
        "operand",
        &["valueName", "valueType", "required", "variadic", "default"],
    ),
    (
        "option",
        &["valueType", "required", "repeatable", "default"],
    ),
    ("output", &["kind", "schemaVersion"]),
    ("input", &["option", "schemaRef", "batch"]),
    ("validator", &["rejects"]),
];

/// What a tree, group or command document of a minor below 1.4 lacks that it carried before 1.4, or carries that is since 1.4.
fn legacy_problems(data: &Value) -> Vec<String> {
    let mut problems = Vec::new();
    let mut need = |def: &str, node: &Value, at: &str| {
        let required = LEGACY_REQUIRED
            .iter()
            .find(|(name, _)| *name == def)
            .map_or(&[][..], |(_, required)| *required);
        for key in required {
            if node.get(key).is_none() {
                problems.push(format!(
                    "{at} lacks {key}, which a document of 1.0-1.3 carries (spec 15.7)"
                ));
            }
        }
    };
    let kind = data.get("kind").and_then(Value::as_str);
    let command = data
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut since: Vec<String> = Vec::new();
    let mut value_names: Vec<String> = Vec::new();
    if matches!(kind, Some("tree" | "group")) {
        if kind == Some("group") {
            need("group", data, &format!("group {command}"));
        }
        if kind == Some("tree") && data.get("options").is_some() {
            since.push("the tree's options".to_string());
        }
        for entry in data
            .get("commands")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = entry
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            need("treeEntry", entry, &format!("tree entry {id}"));
        }
    }
    if kind == Some("command") {
        need("command", data, command);
        for (index, validator) in data
            .get("validators")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            need(
                "validator",
                validator,
                &format!("{command} validator {index}"),
            );
        }
        for operand in data
            .get("operands")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let name = operand
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            need("operand", operand, &format!("{command} operand {name}"));
        }
        for option in data
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(name) = option.get("name").and_then(Value::as_str) else {
                if let Some(name) = option.as_str() {
                    since.push(format!("the option name {name} in {command}"));
                }
                continue;
            };
            let at = format!("{command} option {name}");
            need("option", option, &at);
            let value_type = option.get("valueType").and_then(Value::as_str);
            if !matches!(value_type, Some("switch" | "count")) && option.get("valueName").is_none()
            {
                value_names.push(format!(
                    "{at} lacks valueName, which a document of 1.0-1.3 carries (spec 15.7)"
                ));
            }
        }
        for (index, output) in data
            .get("outputs")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            need("output", output, &format!("{command} output {index}"));
        }
        if let Some(input) = data.get("input") {
            need("input", input, &format!("{command} input"));
        }
    }
    problems.extend(value_names);
    problems.extend(since.into_iter().map(|what| {
        format!(
            "{what} is since 1.4, but the document declares an earlier minor (Annex S2 rule 16)"
        )
    }));
    problems
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::l1::view::{command_view, ViewContext};

    fn failing(findings: &Findings) -> Vec<&'static str> {
        findings
            .iter()
            .filter(|(_, problem)| problem.is_some())
            .map(|(condition, _)| *condition)
            .collect()
    }

    #[test]
    fn atip_check14_05_the_schema_marks_and_defaults_are_what_rules_16_and_17_read() {
        let command = members("command").expect("command");
        for retired in ["path", "schemas"] {
            assert!(command[retired].get("x-atip-until").is_some(), "{retired}");
        }
        assert_eq!(command["async"]["default"], json!(false));
        assert_eq!(
            members("treeEntry").expect("entry")["kind"]["default"],
            json!("command")
        );
        assert_eq!(
            members("output").expect("output")["schemaVersion"]["default"],
            json!("1.0")
        );
        assert!(members("input").expect("input")["schemaRef"]
            .get("x-atip-until")
            .is_some());
        assert!(members("validator").expect("validator")["rejects"]
            .get("x-atip-until")
            .is_some());
    }

    #[test]
    fn atip_check14_06_a_tree_of_1_4_has_no_path_no_command_kind_and_no_default() {
        let tree = json!({
            "kind": "tree", "level": "L1",
            "options": [{"name": "team", "required": true, "help": "h"}],
            "commands": [{"command": "show", "summary": "s", "effect": "read"}]
        });
        assert!(failing(&tree_form_findings(&tree, Claim::V1_4)).is_empty());
        let mut bad = tree.clone();
        bad["commands"][0]["path"] = json!(["show"]);
        assert_eq!(
            failing(&tree_form_findings(&bad, Claim::V1_4)),
            ["entry-form"]
        );
        let mut bad = tree.clone();
        bad["commands"][0]["kind"] = json!("command");
        assert_eq!(
            failing(&tree_form_findings(&bad, Claim::V1_4)),
            ["entry-form"]
        );
        let mut bad = tree.clone();
        bad["options"][0]["required"] = json!(false);
        assert_eq!(
            failing(&tree_form_findings(&bad, Claim::V1_4)),
            ["options-form"]
        );
        let mut bad = tree;
        bad["options"] = json!([{"name": "team", "help": "h"}, {"name": "team", "help": "h"}]);
        assert_eq!(
            failing(&tree_form_findings(&bad, Claim::V1_4)),
            ["options-form"]
        );
    }

    #[test]
    fn atip_check14_07_a_tree_before_1_4_keeps_its_members_and_has_no_options() {
        let tree = json!({
            "kind": "tree", "level": "L1",
            "commands": [{"command": "show", "summary": "s", "effect": "read"}]
        });
        let findings = tree_form_findings(&tree, Claim::V1_3);
        assert_eq!(failing(&findings), ["minor-form"]);
        let problem = findings[0].1.as_deref().expect("a problem");
        assert!(
            problem.contains("lacks path") && problem.contains("lacks kind"),
            "{problem}"
        );
        let full = json!({
            "kind": "tree", "level": "L1",
            "commands": [{"command": "show", "path": ["show"], "kind": "command", "summary": "s", "effect": "read"}]
        });
        assert!(failing(&tree_form_findings(&full, Claim::V1_3)).is_empty());
        let mut shared = full;
        shared["options"] = json!([{"name": "team", "help": "h"}]);
        assert_eq!(
            failing(&tree_form_findings(&shared, Claim::V1_3)),
            ["minor-form"]
        );
    }

    #[test]
    fn atip_check14_08_a_command_of_1_4_is_judged_as_listed() {
        let options = [json!({"name": "team", "required": true, "help": "h"})];
        let context = ViewContext {
            tree_options: &options,
            ..ViewContext::default()
        };
        let command = json!({
            "kind": "command", "command": "show", "summary": "s", "effect": "read",
            "options": ["team"],
            "outputs": [{"schemaRef": "#/schemas/R"}],
            "examples": ["acme show --team a --json"]
        });
        let view = command_view(&command, &context).expect("view");
        assert!(failing(&command_form_findings(&view, Claim::V1_4)).is_empty());
        for (edit, expected) in [
            (json!({"path": ["show"]}), "no-retired-members"),
            (json!({"schemas": {"R": {}}}), "no-retired-members"),
            (json!({"async": false}), "no-default-members"),
            (json!({"options": ["team", "region"]}), "option-names"),
            (
                json!({"options": ["team", {"name": "team", "help": "h"}]}),
                "option-names",
            ),
        ] {
            let mut bad = command.clone();
            for (key, value) in edit.as_object().expect("edit") {
                bad[key] = value.clone();
            }
            let view = command_view(&bad, &context).expect("view");
            assert_eq!(
                failing(&command_form_findings(&view, Claim::V1_4)),
                [expected],
                "{edit}"
            );
        }
        let mut bad = command.clone();
        bad["outputs"][0]["kind"] = json!("report");
        bad["options"] = json!(["team", {"name": "limit", "valueType": "integer", "flagOnly": true, "required": false, "help": "h"}]);
        let view = command_view(&bad, &context).expect("view");
        let findings = command_form_findings(&view, Claim::V1_4);
        assert_eq!(failing(&findings), ["no-default-members"]);
        let problem = findings[1].1.as_deref().expect("a problem");
        assert!(
            problem.contains("output 0: kind") && problem.contains("option limit: required"),
            "{problem}"
        );
    }

    #[test]
    fn atip_check14_09_every_tree_option_must_be_named() {
        let options = [
            json!({"name": "team", "help": "h"}),
            json!({"name": "region", "help": "h"}),
        ];
        let tree = json!({"kind": "tree", "level": "L1", "options": options, "commands": []});
        let context = ViewContext {
            tree_options: &options,
            ..ViewContext::default()
        };
        let command = json!({
            "kind": "command", "command": "show", "summary": "s", "effect": "read",
            "options": ["team"], "outputs": [{"schemaRef": "#/schemas/R"}], "examples": ["e"]
        });
        let view = command_view(&command, &context).expect("view");
        let findings = tree_options_named_findings(&tree, &[&view]);
        assert_eq!(failing(&findings), ["tree-options-named"]);
        assert!(findings[0]
            .1
            .as_deref()
            .is_some_and(|problem| problem.contains("region")));
        assert!(
            tree_options_named_findings(&json!({"kind": "tree", "commands": []}), &[&view])
                .is_empty()
        );
    }
}
