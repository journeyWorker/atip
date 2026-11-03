//! The 1.4 form of the documents `schema` prints (spec 9.3-9.5, 9.9.2, 9.9.3, Annex S2 rules 16 and 17), built from the model of `spec.rs`
//! like the earlier form of `doc.rs`, which still serves 1.0 to 1.3 byte for byte.
//!
//! What 1.4 changes: no member holds its default; a tree entry has no `path` and no `kind: "command"`; the tree's `options` defines once
//! the options that two or more commands print identically (in the order of their first appearance) and a command names them; the
//! reserved options `--commit`, `--plan-digest`, `--limit`, `--cursor`, `--all` and `--operation` are named when they have exactly the
//! shape the contract fixes for them; `--json`, `--input` (with `input`) and `--fields` (with an output's `fields`) and the codes
//! they imply (`USAGE`, `INTERNAL`, `INPUT_*`, `BATCH_INCOMPLETE`, `PLAN_STALE`, `OPERATION_REUSED`, `CURSOR_INVALID`) are not listed;
//! a command document has no `path`, `schemas`, `input.option`, `input.schemaRef` or `validators[].rejects`. What it leaves out is
//! in `schema <command> --schemas --json`: the schemas the refs reach, the fragment schema derived from the full option set as
//! `Input` (spec 9.9.2: an array of values for a repeatable option, `operands` with `minItems` 1) and the validators' `rejects`.
//!
//! Seeded violations acting here (every one only for a tool that claims 1.4, each breaking the one rule it names):
//!
//! * `walkListsDefault`: every command lists a member at its default (`"required": false` on its first operand or option object;
//!   Annex S2 rule 17).
//! * `walkListsImplied`: every command lists `--json` by name, an option its document implies (spec 9.5, Annex S2 rule 4).
//! * `walkListsImpliedCode`: every command lists `USAGE` in `errors`, a code its document implies (spec 9.5, Annex S2 rule 4).
//! * `treeEntryKindCommand`: in the tree answer only, the entry of a command says `kind: "command"` (spec 9.3; group answers keep the
//!   entries without it).
//! * `schemasExtraSchema`: a schemas answer holds `Unreached`, which no ref reaches (spec 9.9.3).
//! * `schemasMissingInput`: no `Input` for a command that has `input` (spec 9.9.3).
//! * `schemasInputDiffers`: `Input` admits other keys than the options give it (`additionalProperties: true`; spec 9.9.2).
//! * `schemasWithoutRejects`: no `rejects` for a command with validators (spec 9.9.3).
//!
//! The refusals of `schema --schemas` (a bare call, a group, another selector) and their seeds `schemasBareAnswers` are in `run.rs`.

use serde_json::{json, Map, Value};

use super::doc::{rule_doc, Model};
use super::inputdoc::camel;
use super::spec::{Arg, Command};
use crate::Tool;

const INTEGER_STRING: &str = "^-?(0|[1-9][0-9]*)$";
const NUMBER_STRING: &str = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$";

/// The value name an option has when its document says none: the name in upper case, `-` written `_` (spec 9.5).
fn default_value_name(name: &str) -> String {
    name.to_uppercase().replace('-', "_")
}

/// What a document leaves out of an argument of `value_type` (spec 9.5): `false` for a switch, `0` for a count, `null` for the rest.
fn default_of(value_type: &str) -> Value {
    match value_type {
        "switch" => json!(false),
        "count" => json!(0),
        _ => Value::Null,
    }
}

/// The reserved options a document may name, with their fixed shape (Annex S2 rule 8): `valueType` and whether flag-only.
fn reserved_shape(name: &str) -> Option<(&'static str, bool)> {
    match name {
        "commit" | "all" => Some(("switch", true)),
        "plan-digest" | "cursor" => Some(("string", true)),
        "limit" => Some(("integer", true)),
        "operation" => Some(("string", false)),
        _ => None,
    }
}

/// Whether `arg` is exactly the reserved option of its name (help and value name aside), so that a command names it.
fn is_reserved_unchanged(arg: &Arg) -> bool {
    reserved_shape(arg.name).is_some_and(|(value_type, flag_only)| {
        arg.value_type == value_type && arg.flag_only == flag_only
    }) && !arg.required
        && !arg.repeatable
        && arg.default == default_of(arg.value_type)
        && arg.possible.is_empty()
        && arg.default_note.is_none()
        && arg.domain.is_none()
        && arg.env.is_none()
        && arg.short.is_none()
}

/// Whether the document of `command` implies the option `arg`, so that it does not list it (spec 9.5).
fn implied(command: &Command, arg: &Arg) -> bool {
    match arg.name {
        "json" => true,
        "input" => command.input.is_some(),
        "fields" => command.outputs.iter().any(|output| output.fields.is_some()),
        _ => false,
    }
}

/// The members an operand and an option share, each left out at its default.
fn common(arg: &Arg, doc: &mut Map<String, Value>) {
    if let Some(value_name) = arg.value_name {
        if arg.takes_value() && value_name != default_value_name(arg.name) {
            doc.insert("valueName".into(), json!(value_name));
        }
    }
    if arg.value_type != "string" {
        doc.insert("valueType".into(), json!(arg.value_type));
    }
    if !arg.possible.is_empty() {
        doc.insert("possibleValues".into(), json!(arg.possible));
    }
    if arg.required {
        doc.insert("required".into(), json!(true));
    }
    if arg.default != default_of(arg.value_type) {
        doc.insert("default".into(), arg.default.clone());
    }
    if let Some(note) = arg.default_note {
        doc.insert("defaultNote".into(), json!(note));
    }
    if let Some(domain) = &arg.domain {
        doc.insert("domain".into(), domain.clone());
    }
    if let Some(env) = arg.env {
        doc.insert("env".into(), json!(env));
    }
    doc.insert("help".into(), json!(arg.help));
}

fn operand_object(arg: &Arg) -> Value {
    let mut doc = Map::new();
    doc.insert("name".into(), json!(arg.name));
    common(arg, &mut doc);
    if arg.repeatable {
        doc.insert("variadic".into(), json!(true));
    }
    Value::Object(doc)
}

fn option_object(arg: &Arg) -> Value {
    let mut doc = Map::new();
    doc.insert("name".into(), json!(arg.name));
    if let Some(short) = arg.short {
        doc.insert("short".into(), json!(short.to_string()));
    }
    common(arg, &mut doc);
    // A count is repeatable by definition and does not say so.
    if arg.repeatable && arg.value_type != "count" {
        doc.insert("repeatable".into(), json!(true));
    }
    if arg.flag_only {
        doc.insert("flagOnly".into(), json!(true));
    }
    Value::Object(doc)
}

/// The options two or more commands print identically (spec 9.3), by name, in the order of their first appearance. A name that two
/// commands print differently is shared by the identical ones of the first printing only.
pub fn shared_options(model: &Model) -> Vec<(&'static str, Value)> {
    let mut candidates: Vec<(&'static str, Value, usize)> = Vec::new();
    for command in &model.commands {
        for arg in command.flags() {
            if implied(command, arg) || reserved_shape(arg.name).is_some() {
                continue;
            }
            let object = option_object(arg);
            match candidates.iter_mut().find(|(name, _, _)| *name == arg.name) {
                Some((_, first, count)) => {
                    if *first == object {
                        *count += 1;
                    }
                }
                None => candidates.push((arg.name, object, 1)),
            }
        }
    }
    candidates
        .into_iter()
        .filter(|(_, _, count)| *count >= 2)
        .map(|(name, object, _)| (name, object))
        .collect()
}

/// The `options` of a command document: the options it does not imply, a name for a tree option or an unchanged reserved one.
fn listed_options(command: &Command, shared: &[(&'static str, Value)]) -> Vec<Value> {
    command
        .flags()
        .filter(|arg| !implied(command, arg))
        .map(|arg| {
            if is_reserved_unchanged(arg) {
                return json!(arg.name);
            }
            let object = option_object(arg);
            if shared
                .iter()
                .any(|(name, tree)| *name == arg.name && *tree == object)
            {
                json!(arg.name)
            } else {
                object
            }
        })
        .collect()
}

/// Whether the document of `command` implies the code `code` (spec 9.5): `USAGE`, `INTERNAL`, and the codes of the features it offers.
fn implies_code(command: &Command, code: &str) -> bool {
    let batch = command
        .input
        .as_ref()
        .and_then(|input| input.get("batch"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match code {
        "USAGE" | "INTERNAL" => true,
        "INPUT_INVALID" | "INPUT_CONFLICT" | "INPUT_TOO_LARGE" => command.input.is_some(),
        "BATCH_INCOMPLETE" => batch,
        "PLAN_STALE" => command.arg("commit").is_some(),
        "OPERATION_REUSED" => command.arg("operation").is_some(),
        "CURSOR_INVALID" => command.arg("cursor").is_some(),
        _ => false,
    }
}

/// The 1.4 entry of a group or command in a tree, a group or a search answer (no `path`, no `kind` for a command).
pub fn entry(model: &Model, id: &str, is_group: bool) -> Value {
    let mut entry = Map::new();
    entry.insert("command".into(), json!(id));
    if is_group {
        entry.insert("kind".into(), json!("group"));
    }
    entry.insert("summary".into(), json!(model.summary(id)));
    if let Some(command) = model.command(id) {
        entry.insert("effect".into(), json!(command.effect));
    }
    Value::Object(entry)
}

/// The 1.4 group document of `id`, before any seeded patch.
pub fn group_doc(model: &Model, id: &str) -> Value {
    let children: Vec<Value> = model
        .children(id)
        .iter()
        .map(|(child, is_group)| entry(model, child, *is_group))
        .collect();
    json!({
        "kind": "group",
        "command": id,
        "summary": model.summary(id),
        "commands": children,
    })
}

/// The 1.4 tree document, before any seeded patch.
pub fn tree_doc(model: &Model, groups_last: bool, level: &str) -> Value {
    let mut ids = model.all_ids();
    if groups_last {
        ids.sort_by_key(|(_, is_group)| *is_group);
    }
    let mut tree = Map::new();
    tree.insert("kind".into(), json!("tree"));
    tree.insert("level".into(), json!(level));
    let shared = shared_options(model);
    if !shared.is_empty() {
        tree.insert(
            "options".into(),
            Value::Array(shared.into_iter().map(|(_, object)| object).collect()),
        );
    }
    tree.insert(
        "commands".into(),
        Value::Array(
            ids.iter()
                .map(|(id, is_group)| {
                    let mut entry = entry(model, id, *is_group);
                    // Seeded (`treeEntryKindCommand`): in the tree answer only, a command's entry says `kind: "command"`.
                    if model.kind_command && !is_group {
                        entry["kind"] = json!("command");
                    }
                    entry
                })
                .collect(),
        ),
    );
    Value::Object(tree)
}

/// The 1.4 command document of `command`, before any seeded patch: the call surface, with no schema in it.
pub fn command_doc(tool: &Tool, model: &Model, command: &Command) -> Value {
    let tool_name = tool.name();
    let mut doc = Map::new();
    doc.insert("kind".into(), json!("command"));
    doc.insert("command".into(), json!(command.id));
    doc.insert("summary".into(), json!(command.summary));
    doc.insert("effect".into(), json!(command.effect));
    if let Some(idempotency) = command.idempotency {
        doc.insert("idempotency".into(), json!(idempotency));
    }
    if command.is_async {
        doc.insert("async".into(), json!(true));
    }
    if let Some(note) = command.effect_note {
        doc.insert("effectNote".into(), json!(note));
    }
    let operands: Vec<Value> = command.operands().map(operand_object).collect();
    if !operands.is_empty() {
        doc.insert("operands".into(), Value::Array(operands));
    }
    let mut options = listed_options(command, &shared_options(model));
    if tool.flag("walkListsImplied") {
        options.insert(0, json!("json"));
    }
    if !options.is_empty() {
        doc.insert("options".into(), Value::Array(options));
    }
    if !command.rules.is_empty() {
        doc.insert(
            "constraints".into(),
            Value::Array(command.rules.iter().map(rule_doc).collect()),
        );
    }
    if !command.validators.is_empty() {
        doc.insert(
            "validators".into(),
            Value::Array(
                command
                    .validators
                    .iter()
                    .map(|validator| {
                        json!({
                            "arguments": validator.arguments,
                            "code": validator.code,
                            "description": validator.description,
                        })
                    })
                    .collect(),
            ),
        );
    }
    let mut errors: Vec<&str> = command
        .errors
        .iter()
        .copied()
        .filter(|code| !implies_code(command, code))
        .collect();
    if tool.flag("walkListsImpliedCode") {
        errors.push("USAGE");
    }
    errors.sort_unstable();
    errors.dedup();
    if !errors.is_empty() {
        doc.insert("errors".into(), json!(errors));
    }
    doc.insert(
        "outputs".into(),
        Value::Array(command.outputs.iter().map(output_object).collect()),
    );
    if let Some(input) = &command.input {
        let mut input = input.clone();
        if let Some(members) = input.as_object_mut() {
            members.remove("option");
            members.remove("schemaRef");
            if members.get("batch") == Some(&json!(false)) {
                members.remove("batch");
            }
        }
        doc.insert("input".into(), input);
    }
    doc.insert(
        "examples".into(),
        json!(command
            .examples
            .iter()
            .map(|line| line.replace("{tool}", &tool_name))
            .collect::<Vec<_>>()),
    );
    let mut doc = Value::Object(doc);
    if tool.flag("walkListsDefault") {
        list_a_default(&mut doc);
    }
    doc
}

/// Seeded (`walkListsDefault`): `"required": false` on the first operand or option object that does not say `required`.
fn list_a_default(doc: &mut Value) {
    for member in ["operands", "options"] {
        let Some(items) = doc.get_mut(member).and_then(Value::as_array_mut) else {
            continue;
        };
        if let Some(object) = items
            .iter_mut()
            .filter_map(Value::as_object_mut)
            .find(|object| !object.contains_key("required"))
        {
            object.insert("required".into(), json!(false));
            return;
        }
    }
}

fn output_object(output: &super::spec::Output) -> Value {
    let mut entry = Map::new();
    if output.event.is_some() {
        entry.insert("kind".into(), json!("stream"));
        entry.insert("mediaType".into(), json!("application/x-ndjson"));
    }
    entry.insert(
        "schemaRef".into(),
        json!(format!("#/schemas/{}", output.schema)),
    );
    if output.version != "1.0" {
        entry.insert("schemaVersion".into(), json!(output.version));
    }
    if let Some(event) = output.event {
        entry.insert("eventRef".into(), json!(format!("#/schemas/{event}")));
    }
    if let Some(when) = output.when {
        entry.insert("when".into(), json!(when));
    }
    if output.batch {
        entry.insert("batch".into(), json!(true));
    }
    if let Some(fields) = &output.fields {
        entry.insert("fields".into(), fields.clone());
    }
    Value::Object(entry)
}

// ---- the schemas answer (spec 9.9.3) ----

/// The one value `--input` may give for `arg`, as spec 9.7.2 lists them.
fn value_schema(arg: &Arg) -> Value {
    match arg.value_type {
        "switch" => json!({"type": "boolean"}),
        "count" => json!({"type": "integer", "minimum": 0}),
        "integer" => {
            json!({"anyOf": [{"type": "integer"}, {"type": "string", "pattern": INTEGER_STRING}]})
        }
        "number" => {
            json!({"anyOf": [{"type": "number"}, {"type": "string", "pattern": NUMBER_STRING}]})
        }
        "enum" => json!({"enum": arg.possible}),
        "json" => json!({"not": {"type": "null"}}),
        _ => json!({"type": "string"}),
    }
}

/// The fragment schema of one `--input` document, derived from the full option set (spec 9.9.2): no `required`,
/// `additionalProperties: false`, `operands` (at least one, at most one per operand unless the last is variadic) and the camelCase name of
/// every option that is not flag-only.
fn fragment(command: &Command) -> Value {
    let mut properties = Map::new();
    let operands: Vec<&Arg> = command.operands().collect();
    if let Some(last) = operands.last() {
        let variadic = last.repeatable;
        let fixed = if variadic {
            &operands[..operands.len() - 1]
        } else {
            &*operands
        };
        let mut schema = Map::new();
        schema.insert("type".into(), json!("array"));
        schema.insert("minItems".into(), json!(1));
        if !variadic {
            schema.insert("maxItems".into(), json!(operands.len()));
        }
        if !fixed.is_empty() {
            schema.insert(
                "prefixItems".into(),
                Value::Array(fixed.iter().map(|operand| value_schema(operand)).collect()),
            );
        }
        schema.insert(
            "items".into(),
            if variadic {
                value_schema(last)
            } else {
                json!(false)
            },
        );
        properties.insert("operands".into(), Value::Object(schema));
    }
    for arg in command.flags().filter(|arg| !arg.flag_only) {
        let value = value_schema(arg);
        let property = if arg.repeatable && arg.value_type != "count" {
            json!({"type": "array", "items": value})
        } else {
            value
        };
        properties.insert(camel(arg.name), property);
    }
    json!({"type": "object", "additionalProperties": false, "properties": properties})
}

/// The names `#/schemas/<Name>` refs inside `value` give.
fn refs_in(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(members) => {
            for (key, member) in members {
                match member
                    .as_str()
                    .and_then(|text| text.strip_prefix("#/schemas/"))
                {
                    Some(name) if key == "$ref" => out.push(name.to_string()),
                    _ => refs_in(member, out),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                refs_in(item, out);
            }
        }
        _ => {}
    }
}

/// The 1.4 schemas answer of `command`, before any seeded patch: exactly the schemas the refs of its document reach, `Input` when it has
/// `input`, and one `rejects` list per validator.
pub fn schemas_doc(tool: &Tool, command: &Command) -> Value {
    let mut pending: Vec<String> = Vec::new();
    for output in &command.outputs {
        pending.push(output.schema.to_string());
        pending.extend(output.event.map(ToString::to_string));
    }
    if let Some(name) = command
        .input
        .as_ref()
        .and_then(|input| input.get("argumentsRef"))
        .and_then(Value::as_str)
        .and_then(|text| text.strip_prefix("#/schemas/"))
    {
        pending.push(name.to_string());
    }
    let mut reached: Vec<String> = Vec::new();
    while let Some(name) = pending.pop() {
        if reached.contains(&name) {
            continue;
        }
        if let Some((_, schema)) = command.schemas.iter().find(|(known, _)| *known == name) {
            refs_in(schema, &mut pending);
        }
        reached.push(name);
    }
    let mut schemas = Map::new();
    for (name, schema) in &command.schemas {
        if reached.iter().any(|reached| reached == name) {
            schemas
                .entry((*name).to_string())
                .or_insert_with(|| schema.clone());
        }
    }
    if command.input.is_some() && !tool.flag("schemasMissingInput") {
        let mut input = fragment(command);
        if tool.flag("schemasInputDiffers") {
            input["additionalProperties"] = json!(true);
        }
        schemas.insert("Input".into(), input);
    }
    if tool.flag("schemasExtraSchema") {
        schemas.insert("Unreached".into(), json!({"type": "object"}));
    }
    let mut doc = Map::new();
    doc.insert("kind".into(), json!("schemas"));
    doc.insert("command".into(), json!(command.id));
    doc.insert("schemas".into(), Value::Object(schemas));
    if !command.validators.is_empty() && !tool.flag("schemasWithoutRejects") {
        let tool_name = tool.name();
        doc.insert(
            "rejects".into(),
            Value::Array(
                command
                    .validators
                    .iter()
                    .map(|validator| {
                        json!(validator
                            .rejects
                            .iter()
                            .map(|line| line.replace("{tool}", &tool_name))
                            .collect::<Vec<_>>())
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(doc)
}
