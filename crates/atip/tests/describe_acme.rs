//! The 1.4 self-description of the repository's own `acme` examples (`examples/schema-*-acme-*.json`) against what `atip::Described`
//! writes.
//!
//! The examples are the contract's reference documents of 1.4. This test reads them back into the typed model a tool would
//! build (the full form: defaults stated, the implied options and codes listed, `path` and `schemas` filled, each validator's
//! `rejects`) and has `Described` write them again: the tree, every command document and every schemas answer must equal the
//! example, and validate against `schema/schema-doc.schema.json`. The model is built here from the documents, so a mistake in
//! the reading would show as a difference, never as an agreement.
//!
//! `member list` gives `--cursor` and `--all` a help of its own, so its document lists them as objects: the fixed shape plus that
//! help. The bare reserved name is for a reserved option whose help is the standard text (`describe::standard_help`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use atip::doc::{
    CommandDoc, ConditionDoc, ConstraintDoc, Effect, EntryKind, FieldsDoc, Idempotency, InputDoc,
    OperandDoc, OptionDoc, OutputDoc, OutputKind, RuleKind, TreeEntry, ValidatorDoc, ValueType,
};
use atip::{schema_doc_problems, Described, Minor};

fn examples() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

/// The whole text of an example file.
fn text(name: &str) -> String {
    std::fs::read_to_string(examples().join(name)).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn envelope(name: &str) -> Value {
    serde_json::from_str(&text(name)).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn data(name: &str) -> Value {
    envelope(name)["data"].clone()
}

/// Whether `text` has no whitespace (space, tab, CR, LF) outside strings, except one newline at the end (spec 5.1).
fn is_compact(text: &str) -> bool {
    let body = text.strip_suffix('\n').unwrap_or(text);
    let mut in_string = false;
    let mut escaped = false;
    for c in body.chars() {
        if in_string {
            match (escaped, c) {
                (true, _) => escaped = false,
                (false, '\\') => escaped = true,
                (false, '"') => in_string = false,
                _ => {}
            }
        } else if c == '"' {
            in_string = true;
        } else if matches!(c, ' ' | '\t' | '\r' | '\n') {
            return false;
        }
    }
    true
}

// -------------------------------------------------------------- the model, read back

fn text_of(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| item.as_str().expect("a string").to_string())
        .collect()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn value_type(value: &Value) -> ValueType {
    match value.get("valueType").and_then(Value::as_str) {
        None | Some("string") => ValueType::String,
        Some("switch") => ValueType::Switch,
        Some("count") => ValueType::Count,
        Some("integer") => ValueType::Integer,
        Some("number") => ValueType::Number,
        Some("path") => ValueType::Path,
        Some("enum") => ValueType::Enum,
        Some("json") => ValueType::Json,
        Some(other) => panic!("valueType {other}"),
    }
}

fn effect(text: &str) -> Effect {
    match text {
        "read" => Effect::Read,
        "write" => Effect::Write,
        "destructive" => Effect::Destructive,
        other => panic!("effect {other}"),
    }
}

fn default_for(value_type: ValueType) -> Value {
    match value_type {
        ValueType::Switch => json!(false),
        ValueType::Count => json!(0),
        _ => Value::Null,
    }
}

fn upper(name: &str) -> String {
    name.to_uppercase().replace('-', "_")
}

fn extensions(value: &Value) -> BTreeMap<String, Value> {
    value
        .as_object()
        .expect("an object")
        .iter()
        .filter(|(key, _)| key.starts_with("x-"))
        .map(|(key, member)| (key.clone(), member.clone()))
        .collect()
}

/// An option of the document with every default stated, as a tool's model holds it.
fn option_of(raw: &Value) -> OptionDoc {
    let name = text_of(raw, "name").expect("a name");
    let value_type = value_type(raw);
    let valued = !matches!(value_type, ValueType::Switch | ValueType::Count);
    OptionDoc {
        short: text_of(raw, "short"),
        value_name: valued.then(|| text_of(raw, "valueName").unwrap_or_else(|| upper(&name))),
        value_type,
        possible_values: raw.get("possibleValues").map(strings),
        required: flag(raw, "required"),
        repeatable: value_type == ValueType::Count || flag(raw, "repeatable"),
        default: raw
            .get("default")
            .cloned()
            .unwrap_or_else(|| default_for(value_type)),
        default_note: text_of(raw, "defaultNote"),
        env: text_of(raw, "env"),
        flag_only: flag(raw, "flagOnly"),
        domain: raw.get("domain").cloned(),
        help: text_of(raw, "help").expect("help"),
        name,
    }
}

/// The reserved option `name` in its fixed shape (spec 4.5, Annex S2 rule 8), with its standard help: the model of a bare name.
fn reserved(name: &str) -> Option<OptionDoc> {
    let (value_type, flag_only) = match name {
        "json" | "commit" | "all" => (ValueType::Switch, true),
        "input" | "plan-digest" | "cursor" | "fields" => (ValueType::String, true),
        "limit" => (ValueType::Integer, true),
        "dry-run" => (ValueType::Switch, false),
        "operation" => (ValueType::String, false),
        _ => return None,
    };
    let mut raw = json!({ "name": name, "valueType": value_type.as_str(), "help": atip::describe::standard_help(name) });
    if flag_only {
        raw["flagOnly"] = json!(true);
    }
    Some(option_of(&raw))
}

fn operand_of(raw: &Value) -> OperandDoc {
    let name = text_of(raw, "name").expect("a name");
    let value_type = value_type(raw);
    OperandDoc {
        value_name: text_of(raw, "valueName").unwrap_or_else(|| upper(&name)),
        value_type,
        possible_values: raw.get("possibleValues").map(strings),
        required: flag(raw, "required"),
        variadic: flag(raw, "variadic"),
        default: raw.get("default").cloned().unwrap_or(Value::Null),
        default_note: text_of(raw, "defaultNote"),
        domain: raw.get("domain").cloned(),
        help: text_of(raw, "help").expect("help"),
        name,
    }
}

fn constraint_of(raw: &Value) -> ConstraintDoc {
    ConstraintDoc {
        rule: match raw["rule"].as_str().expect("a rule") {
            "atLeastOne" => RuleKind::AtLeastOne,
            "exactlyOne" => RuleKind::ExactlyOne,
            "atMostOne" => RuleKind::AtMostOne,
            "requires" => RuleKind::Requires,
            "forbids" => RuleKind::Forbids,
            other => panic!("rule {other}"),
        },
        names: raw.get("names").map(strings),
        when: raw.get("if").map(|condition| ConditionDoc {
            name: text_of(condition, "name").expect("a name"),
            values: condition.get("in").and_then(Value::as_array).cloned(),
        }),
        then: raw.get("then").map(strings),
        code: text_of(raw, "code"),
        help: text_of(raw, "help"),
        extensions: extensions(raw),
    }
}

fn output_of(raw: &Value) -> OutputDoc {
    OutputDoc {
        kind: match raw.get("kind").and_then(Value::as_str) {
            None | Some("report") => OutputKind::Report,
            Some("artifact") => OutputKind::Artifact,
            Some("stream") => OutputKind::Stream,
            Some(other) => panic!("kind {other}"),
        },
        schema_ref: text_of(raw, "schemaRef").expect("schemaRef"),
        schema_version: text_of(raw, "schemaVersion").unwrap_or_else(|| "1.0".to_string()),
        media_type: text_of(raw, "mediaType"),
        event_ref: text_of(raw, "eventRef"),
        batch: flag(raw, "batch"),
        when: text_of(raw, "when"),
        fields: raw.get("fields").map(|fields| FieldsDoc {
            records: text_of(fields, "records").expect("records"),
            paths: strings(&fields["paths"]),
            keep: fields.get("keep").map(strings).unwrap_or_default(),
            default: fields.get("default").map(strings),
        }),
    }
}

/// The codes a 1.4 document implies, given the options its full set has (spec 9.5).
fn implied_codes(input: Option<&InputDoc>, options: &[OptionDoc]) -> Vec<&'static str> {
    let offers = |name: &str| options.iter().any(|option| option.name == name);
    let mut codes = vec!["USAGE", "INTERNAL"];
    if let Some(input) = input {
        codes.extend(["INPUT_INVALID", "INPUT_CONFLICT", "INPUT_TOO_LARGE"]);
        if input.batch {
            codes.push("BATCH_INCOMPLETE");
        }
    }
    for (option, code) in [
        ("commit", "PLAN_STALE"),
        ("operation", "OPERATION_REUSED"),
        ("cursor", "CURSOR_INVALID"),
    ] {
        if offers(option) {
            codes.push(code);
        }
    }
    codes
}

/// The model of one command: the 1.4 command document and its schemas answer read back into the full form.
fn command_of(raw: &Value, answer: &Value, tree_options: &[OptionDoc]) -> CommandDoc {
    let command = text_of(raw, "command").expect("command");
    let outputs: Vec<OutputDoc> = raw["outputs"]
        .as_array()
        .expect("outputs")
        .iter()
        .map(output_of)
        .collect();
    let input = raw.get("input").map(|input| InputDoc {
        option: "--input",
        schema_ref: "#/schemas/Input".to_string(),
        arguments_ref: text_of(input, "argumentsRef"),
        batch: flag(input, "batch"),
        max_bytes: input["maxBytes"].as_u64().expect("maxBytes"),
        max_items: input.get("maxItems").and_then(Value::as_u64),
        example: input["example"].clone(),
    });
    // The full option set: the implied ones first, then what the document lists.
    let mut options = vec![reserved("json").expect("json")];
    if input.is_some() {
        options.push(reserved("input").expect("input"));
    }
    if outputs.iter().any(|output| output.fields.is_some()) {
        options.push(reserved("fields").expect("fields"));
    }
    for listed in raw
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        options.push(match listed.as_str() {
            Some(name) => tree_options
                .iter()
                .find(|option| option.name == name)
                .cloned()
                .or_else(|| reserved(name))
                .unwrap_or_else(|| panic!("{command}: the name {name} resolves to no option")),
            None => option_of(listed),
        });
    }
    let mut errors = raw.get("errors").map(strings).unwrap_or_default();
    errors.extend(
        implied_codes(input.as_ref(), &options)
            .into_iter()
            .map(str::to_string),
    );
    let schemas: BTreeMap<String, Value> = answer["schemas"]
        .as_object()
        .expect("schemas")
        .iter()
        .filter(|(name, _)| name.as_str() != "Input")
        .map(|(name, schema)| (name.clone(), schema.clone()))
        .collect();
    let rejects = answer.get("rejects").and_then(Value::as_array);
    CommandDoc {
        kind: CommandDoc::KIND,
        path: command.split(' ').map(str::to_string).collect(),
        summary: text_of(raw, "summary").expect("summary"),
        effect: effect(raw["effect"].as_str().expect("effect")),
        idempotency: raw
            .get("idempotency")
            .and_then(Value::as_str)
            .map(|text| match text {
                "replay-safe" => Idempotency::ReplaySafe,
                "content-keyed" => Idempotency::ContentKeyed,
                "appends" => Idempotency::Appends,
                "once" => Idempotency::Once,
                other => panic!("idempotency {other}"),
            }),
        effect_note: text_of(raw, "effectNote"),
        is_async: flag(raw, "async"),
        operands: raw
            .get("operands")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(operand_of)
            .collect(),
        options,
        constraints: raw
            .get("constraints")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(constraint_of)
            .collect(),
        validators: raw
            .get("validators")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
            .map(|(at, validator)| ValidatorDoc {
                arguments: strings(&validator["arguments"]),
                code: text_of(validator, "code").expect("code"),
                description: text_of(validator, "description").expect("description"),
                rejects: strings(&rejects.expect("rejects")[at]),
                extensions: extensions(validator),
            })
            .collect(),
        errors,
        outputs,
        input,
        examples: strings(&raw["examples"]),
        schemas,
        extensions: extensions(raw),
        command,
    }
}

/// The tree entries and options of the tree example.
fn tree_of(raw: &Value) -> (Vec<TreeEntry>, Vec<OptionDoc>) {
    let entries = raw["commands"]
        .as_array()
        .expect("commands")
        .iter()
        .map(|entry| {
            let command = text_of(entry, "command").expect("command");
            TreeEntry {
                path: command.split(' ').map(str::to_string).collect(),
                kind: if entry.get("kind").and_then(Value::as_str) == Some("group") {
                    EntryKind::Group
                } else {
                    EntryKind::Command
                },
                summary: text_of(entry, "summary").expect("summary"),
                effect: text_of(entry, "effect").map(|text| effect(&text)),
                extensions: extensions(entry),
                command,
            }
        })
        .collect();
    let options = raw
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(option_of)
        .collect();
    (entries, options)
}

fn file_of(command: &str) -> String {
    command.replace(' ', "-")
}

/// The model of acme, and the example documents of every command by name. `schema` is the tool's own command, which the
/// examples list in the tree and do not describe: its document is the model's to supply.
fn acme() -> (Described, Vec<TreeEntry>, Vec<(String, Value, Value)>) {
    let tree = data("schema-tree-acme.json");
    let (entries, tree_options) = tree_of(&tree);
    let mut commands = Vec::new();
    let mut examples = Vec::new();
    for entry in entries
        .iter()
        .filter(|entry| entry.kind == EntryKind::Command)
    {
        if entry.command == "schema" {
            continue;
        }
        let name = file_of(&entry.command);
        let raw = data(&format!("schema-command-acme-{name}.json"));
        let answer = data(&format!("schema-schemas-acme-{name}.json"));
        commands.push(command_of(&raw, &answer, &tree_options));
        examples.push((entry.command.clone(), raw, answer));
    }
    let own = json!({
        "kind": "command", "command": "schema", "summary": "Describe the CLI", "effect": "read",
        "outputs": [{ "schemaRef": "#/schemas/SchemaReport" }], "examples": ["acme schema --json"],
    });
    let answer = json!({ "schemas": { "SchemaReport": { "type": "object" } } });
    commands.push(command_of(&own, &answer, &tree_options));
    let described = Described::new(Minor::V1_4, "L1", entries.clone(), commands)
        .expect("the acme model can be written");
    (described, entries, examples)
}

fn schema_envelope(data: &Value) -> Value {
    json!({
        "ok": true,
        "data": data,
        "meta": { "command": "schema", "contract": "atip/1", "contractVersion": "1.4", "schemaVersion": "1.4", "tool": "acme", "toolVersion": "1.0.0" },
    })
}

// ------------------------------------------------------------------------- the tests

#[test]
fn atip_crate14_13_the_acme_examples_of_1_4_validate_and_are_compact() {
    let mut checked = 0;
    for entry in std::fs::read_dir(examples()).expect("the examples") {
        let name = entry
            .expect("an entry")
            .file_name()
            .into_string()
            .expect("a name");
        if !(name.starts_with("schema-") && name.contains("-acme") && name.ends_with(".json")) {
            continue;
        }
        if name.contains("-error") || name.contains("-warning") {
            continue;
        }
        let document = envelope(&name);
        if document["meta"]["contractVersion"] != "1.4" {
            continue;
        }
        assert_eq!(
            schema_doc_problems(&document),
            Vec::<String>::new(),
            "{name}"
        );
        assert!(is_compact(&text(&name)), "{name} is compact (spec 5.1)");
        checked += 1;
    }
    assert!(
        checked >= 23,
        "the tree, the commands and the schemas answers: {checked}"
    );
}

#[test]
fn atip_crate14_14_the_tree_written_for_acme_is_the_example() {
    let (described, _, _) = acme();
    let written = described.tree().to_value();
    assert_eq!(written, data("schema-tree-acme.json"));
    assert_eq!(
        schema_doc_problems(&schema_envelope(&written)),
        Vec::<String>::new()
    );
}

#[test]
fn atip_crate14_15_every_command_document_written_for_acme_is_the_example() {
    let (described, _, examples) = acme();
    assert_eq!(examples.len(), 11);
    for (command, raw, _) in &examples {
        let written = described.command(command).expect("a command").to_value();
        assert_eq!(written, *raw, "{command}");
        assert_eq!(
            schema_doc_problems(&schema_envelope(&written)),
            Vec::<String>::new(),
            "{command}"
        );
    }
}

#[test]
fn atip_crate14_16_every_schemas_answer_written_for_acme_is_the_example() {
    let (described, _, examples) = acme();
    for (command, _, answer) in &examples {
        let written = described.schemas(command).expect("an answer").to_value();
        assert_eq!(&written, answer, "{command}");
        assert_eq!(
            schema_doc_problems(&schema_envelope(&written)),
            Vec::<String>::new(),
            "{command}"
        );
    }
    // The tool's own command has no validator and no input: no `Input`, no `rejects`.
    let own = described.schemas("schema").expect("an answer").to_value();
    assert_eq!(
        own,
        json!({ "kind": "schemas", "command": "schema", "schemas": { "SchemaReport": { "type": "object" } } })
    );
}

#[test]
fn atip_crate14_17_what_is_printed_is_compact_one_line_json_in_the_order_of_the_form() {
    let (described, _, examples) = acme();
    let mut lines = vec![described.tree().to_line()];
    lines.extend(described.group("member").map(|group| group.to_line()));
    for (command, _, _) in &examples {
        lines.push(described.command(command).expect("a command").to_line());
        lines.push(described.schemas(command).expect("an answer").to_line());
    }
    assert_eq!(lines.len(), 1 + 1 + 22);
    for line in &lines {
        assert!(is_compact(line), "{line}");
        assert!(!line.contains('\n'));
        let value: Value = serde_json::from_str(line).expect("JSON");
        assert_eq!(
            serde_json::to_string(&value).expect("text").len(),
            line.len(),
            "the line is what a JSON round trip prints"
        );
    }
    let tag = described
        .command("member tag")
        .expect("a command")
        .to_line();
    assert!(
        tag.starts_with(r#"{"kind":"command","command":"member tag","summary":"Add a tag to a member","effect":"write","idempotency":"replay-safe","operands":[{"name":"number","valueType":"integer","required":true,"domain":{"minimum":1},"help":"The member's number"}],"options":[{"name":"tag","required":true,"domain":{"pattern":"^[a-z][a-z0-9-]*$"},"help":"The tag to add"},"#),
        "members in the order of the model: {tag}"
    );
    assert!(described
        .schemas("member tag")
        .expect("an answer")
        .to_line()
        .starts_with(
            r#"{"kind":"schemas","command":"member tag","schemas":{"BatchMemberTagReport":"#
        ));
}

#[test]
fn atip_crate14_18_a_group_lists_its_direct_children_without_path_in_1_4_and_with_it_before() {
    let (described, entries, _) = acme();
    let group = described.group("member").expect("a group").to_value();
    let children: Vec<Value> = entries
        .iter()
        .filter(|entry| {
            entry.command.starts_with("member ") && entry.command.matches(' ').count() == 1
        })
        .map(|entry| {
            let mut value = json!({ "command": entry.command, "summary": entry.summary });
            value["effect"] = json!(entry.effect.expect("a command").as_str());
            value
        })
        .collect();
    assert_eq!(
        group,
        json!({ "kind": "group", "command": "member", "summary": "Team members: export, list, roster, show, tag", "commands": children })
    );
    assert_eq!(
        schema_doc_problems(&schema_envelope(&group)),
        Vec::<String>::new()
    );
    assert!(
        described.group("member list").is_none(),
        "a command is no group"
    );
    assert!(described.group("nosuch").is_none());

    // The same model written for 1.3 keeps `path` on every entry and on the group.
    let (entries, commands) = {
        let tree = data("schema-tree-acme.json");
        let (entries, tree_options) = tree_of(&tree);
        let commands: Vec<CommandDoc> = entries
            .iter()
            .filter(|entry| entry.kind == EntryKind::Command && entry.command != "schema")
            .map(|entry| {
                let name = file_of(&entry.command);
                command_of(
                    &data(&format!("schema-command-acme-{name}.json")),
                    &data(&format!("schema-schemas-acme-{name}.json")),
                    &tree_options,
                )
            })
            .collect();
        let entries: Vec<TreeEntry> = entries
            .into_iter()
            .filter(|entry| entry.command != "schema")
            .collect();
        (entries, commands)
    };
    let before = Described::new(Minor::V1_3, "L1", entries, commands).expect("a model");
    let group = before.group("member").expect("a group").to_value();
    assert_eq!(group["path"], json!(["member"]));
    assert_eq!(group["commands"][0]["path"], json!(["member", "export"]));
    assert_eq!(group["commands"][0]["kind"], "command");
    let tree = before.tree().to_value();
    assert!(
        tree.get("options").is_none(),
        "no shared options before 1.4"
    );
    let command = before.command("member tag").expect("a command").to_value();
    assert_eq!(command["path"], json!(["member", "tag"]));
    assert!(command["schemas"].get("MemberTagReport").is_some());
    assert!(command["validators"][0].get("rejects").is_some());
    assert_eq!(command["input"]["option"], "--input");
    assert!(
        before.schemas("member tag").is_none(),
        "no schemas answer before 1.4"
    );
}
