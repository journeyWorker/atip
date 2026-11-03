//! The full view of a 1.4 command document, and of the tool's documents as a whole (spec 9.3, 9.5, 9.9.2, 9.9.3).
//!
//! A 1.4 command document lists less than the command accepts: its defaults are absent, its options are its own and
//! the names of tree options and reserved options, the reserved options its document implies are not listed, nor are
//! the codes it implies, and the schemas, the derived `--input` fragment schema and the `rejects` of its validators are
//! in the `--schemas` answer. Every rule of Annex S2 reads the command as it is, so the checker builds that command
//! from the answers ([`command_view`]) and the rules read the result, a [`CommandDoc`] like any other:
//!
//! * `path` is the words of `command`; every argument has the members its document leaves at their defaults stated;
//! * `options` are the implied reserved options with their fixed shapes (Annex S2 rule 8), then the entries of the
//!   document's `options` in order: a name is a tree option (the tree's definition), else a reserved option the document
//!   does not imply (its fixed shape), else left out; an object is the option;
//! * `errors` are the listed ones, then the implied codes and the registered finer replacements of `USAGE` (spec 7.3.2);
//! * `schemas` are those of the `--schemas` answer, without `Input`, and `Input` is **derived** by the checker from the
//!   full option set ([`derive_fragment`]); the answer's own `Input` is kept aside ([`ViewNotes::answer_input`]);
//! * `input.schema_ref` is `#/schemas/Input`, and each validator's `rejects` is the list of the answer at its index;
//! * `raw` stays what the document listed, and [`ViewNotes`] says how its names were read, so that the rules that judge
//!   the listing (Annex S2 rules 16 and 17) and the rules that judge the command meet in one value.
//!
//! Everything here is a pure function of the answers' `data`: nothing launches a process.

use serde_json::{json, Map, Value};

use super::model::{camel, flag, text, words, Arg, CommandDoc, GroupDoc, ToolDocs, Tree};
use crate::claim::Claim;

/// One reserved option (spec 4.5) with the shape that is fixed for it (Annex S2 rule 8), which is the shape of a name
/// that is neither a tree option nor a listed object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReservedOption {
    pub name: &'static str,
    pub value_type: &'static str,
    /// Flag-only: never a key of an `--input` document (spec 4.5; `limit`, `cursor`, `all` and `fields` since 1.2).
    pub flag_only: bool,
}

const fn reserved(name: &'static str, value_type: &'static str, flag_only: bool) -> ReservedOption {
    ReservedOption {
        name,
        value_type,
        flag_only,
    }
}

/// The reserved options a command may name in a 1.4 document, with their fixed shapes.
pub const RESERVED_OPTIONS: [ReservedOption; 10] = [
    reserved("json", "switch", true),
    reserved("input", "string", true),
    reserved("commit", "switch", true),
    reserved("plan-digest", "string", true),
    reserved("dry-run", "switch", false),
    reserved("limit", "integer", true),
    reserved("cursor", "string", true),
    reserved("all", "switch", true),
    reserved("fields", "string", true),
    reserved("operation", "string", false),
];

/// The reserved option named `name`.
pub fn reserved_option(name: &str) -> Option<&'static ReservedOption> {
    RESERVED_OPTIONS.iter().find(|option| option.name == name)
}

impl ReservedOption {
    /// The option as a document would list it in full: its name, shape and `flagOnly`, and no `help`.
    fn listed(&self) -> Value {
        let mut object = json!({"name": self.name, "valueType": self.value_type});
        if self.flag_only {
            object["flagOnly"] = Value::Bool(true);
        }
        object
    }
}

/// The reserved options the command document `data` implies, so that it does not list them (spec 9.5): `--json`
/// always, `--input` when it has `input`, `--fields` when an output declares `fields`.
pub fn implied_option_names(data: &Value) -> Vec<&'static str> {
    let mut names = vec!["json"];
    if data.get("input").is_some() {
        names.push("input");
    }
    let fields = data
        .get("outputs")
        .and_then(Value::as_array)
        .is_some_and(|outputs| outputs.iter().any(|output| output.get("fields").is_some()));
    if fields {
        names.push("fields");
    }
    names
}

/// The error codes the command document `data` implies, so that it does not list them (spec 9.5), given the names of
/// its full option set: `USAGE` and `INTERNAL`; the `INPUT_*` codes with `input`; `BATCH_INCOMPLETE` with
/// `input.batch`; `PLAN_STALE` with `--commit`; `OPERATION_REUSED` with `--operation`; `CURSOR_INVALID` with
/// `--cursor`. The registered finer replacements of `USAGE` are implied too, but which ones a tool uses is its
/// registry's to say ([`usage_replacements`]).
pub fn implied_codes(data: &Value, option_names: &[&str]) -> Vec<&'static str> {
    let mut codes = vec!["USAGE", "INTERNAL"];
    if let Some(input) = data.get("input") {
        codes.extend(["INPUT_INVALID", "INPUT_CONFLICT", "INPUT_TOO_LARGE"]);
        if flag(input, "batch") {
            codes.push("BATCH_INCOMPLETE");
        }
    }
    for (option, code) in [
        ("commit", "PLAN_STALE"),
        ("operation", "OPERATION_REUSED"),
        ("cursor", "CURSOR_INVALID"),
    ] {
        if option_names.contains(&option) {
            codes.push(code);
        }
    }
    codes
}

/// The codes of an error registry that are finer replacements of `USAGE` (spec 7.3.2): registered at exit 2, not a core
/// code, with the condition `INVALID` or `REQUIRED`. The registry does not say which of them a tool uses in place of
/// `USAGE`, so a 1.4 command document MAY list them or leave them out (spec 9.5); the view counts them as listed.
pub fn usage_replacements(entries: &[Value]) -> Vec<String> {
    entries
        .iter()
        .filter(|entry| entry.get("exit").and_then(Value::as_i64) == Some(2))
        .filter_map(|entry| entry.get("code").and_then(Value::as_str))
        .filter(|code| atip::reserved_code(code, atip::Minor::V1_4).is_none())
        .filter(|code| {
            matches!(
                atip::Condition::of_code(code),
                Some((_, atip::Condition::Invalid | atip::Condition::Required))
            )
        })
        .map(str::to_string)
        .collect()
}

/// `name` in upper case with `_` for `-`: the `valueName` an argument that gives none has (spec 9.5).
fn default_value_name(name: &str) -> String {
    name.to_ascii_uppercase().replace('-', "_")
}

/// The `default` of an argument whose document leaves it out (spec 9.5): `false` for a switch, `0` for a count.
fn absent_default(value_type: &str) -> Value {
    match value_type {
        "switch" => Value::Bool(false),
        "count" => Value::from(0),
        _ => Value::Null,
    }
}

/// An operand or option object with every member its document leaves at the default stated (spec 9.5): `valueType`,
/// `required`, `repeatable` (a count is repeatable by definition), `variadic`, `flagOnly`, `default` and, for an
/// argument that takes a value, `valueName`.
pub fn full_argument(listed: &Value, is_option: bool) -> Value {
    let mut object = listed.as_object().cloned().unwrap_or_default();
    let value_type = object
        .get("valueType")
        .and_then(Value::as_str)
        .unwrap_or("string")
        .to_string();
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    object.insert("valueType".to_string(), Value::String(value_type.clone()));
    object.entry("required").or_insert(Value::Bool(false));
    if is_option {
        let repeatable = value_type == "count"
            || object
                .get("repeatable")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        object.insert("repeatable".to_string(), Value::Bool(repeatable));
        object.entry("flagOnly").or_insert(Value::Bool(false));
    } else {
        object.entry("variadic").or_insert(Value::Bool(false));
    }
    object
        .entry("default")
        .or_insert_with(|| absent_default(&value_type));
    if value_type != "switch" && value_type != "count" && !name.is_empty() {
        object
            .entry("valueName")
            .or_insert_with(|| Value::String(default_value_name(&name)));
    }
    Value::Object(object)
}

/// How the names of a 1.4 command document's `options` were read, and what the answers held beside it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ViewNotes {
    /// The tree options the document names, in order (each once).
    pub named: Vec<String>,
    /// Names that are neither a tree option nor a reserved option (Annex S2 rule 17): the option is left out.
    pub unknown_names: Vec<String>,
    /// Options given more than once, by name and object or twice by either (Annex S2 rule 17).
    pub given_twice: Vec<String>,
    /// Implied reserved options (`--json`, `--input` with `input`, `--fields` with `fields`) that are listed, by name or
    /// as an object (spec 9.5).
    pub implied_options_listed: Vec<String>,
    /// `--input` or `--fields` listed by a document that has no `input` or no output with `fields` (spec 9.5).
    pub unoffered_options_listed: Vec<String>,
    /// Implied error codes (`USAGE`, `INTERNAL`, the codes of the features it offers) that `errors` lists (spec 9.5).
    pub implied_codes_listed: Vec<String>,
    /// The `Input` member of the command's `--schemas` answer; the view's own `Input` is the derived one.
    pub answer_input: Option<Value>,
    /// Whether a `--schemas` answer was given to the view.
    pub schemas_answered: bool,
}

/// What a command's view is built from, beside its own document.
#[derive(Debug, Clone, Copy, Default)]
pub struct ViewContext<'a> {
    /// The `options` of the tree answer (the options commands share), in the form the tree lists them.
    pub tree_options: &'a [Value],
    /// The `data` of the command's `schema <path> --schemas --json` answer.
    pub schemas_answer: Option<&'a Value>,
    /// The registered finer replacements of `USAGE` ([`usage_replacements`]).
    pub usage_replacements: &'a [String],
}

/// The full view of the command document `data` (the `data` of a `kind: "command"` answer of a 1.4 tool); `None` when
/// `data` is not one. See the module header for what the view holds.
pub fn command_view(data: &Value, context: &ViewContext<'_>) -> Option<CommandDoc> {
    if data.get("kind").and_then(Value::as_str) != Some("command") {
        return None;
    }
    let implied = implied_option_names(data);
    let mut notes = ViewNotes::default();

    // The document's own entries, in order.
    let mut listed: Vec<Value> = Vec::new();
    let mut given: Vec<String> = Vec::new();
    for entry in data
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (name, option) = match entry {
            Value::String(name) => (name.as_str(), None),
            object => (
                object
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                Some(object),
            ),
        };
        if given.iter().any(|earlier| earlier == name) {
            note_once(&mut notes.given_twice, name);
            continue;
        }
        given.push(name.to_string());
        if implied.contains(&name) {
            notes.implied_options_listed.push(name.to_string());
        } else if matches!(name, "input" | "fields") {
            notes.unoffered_options_listed.push(name.to_string());
        }
        match option {
            Some(object) => listed.push(full_argument(object, true)),
            None => {
                let shared = context
                    .tree_options
                    .iter()
                    .find(|shared| shared.get("name").and_then(Value::as_str) == Some(name));
                if let Some(shared) = shared {
                    note_once(&mut notes.named, name);
                    listed.push(full_argument(shared, true));
                } else if let Some(fixed) =
                    reserved_option(name).filter(|_| !implied.contains(&name))
                {
                    listed.push(full_argument(&fixed.listed(), true));
                } else if reserved_option(name).is_none() {
                    notes.unknown_names.push(name.to_string());
                }
            }
        }
    }
    // The implied reserved options come first, each unless the document gave it as an object.
    let mut options: Vec<Value> = implied
        .iter()
        .filter(|name| {
            !listed
                .iter()
                .any(|option| option.get("name").and_then(Value::as_str) == Some(**name))
        })
        .filter_map(|name| reserved_option(name))
        .map(|fixed| full_argument(&fixed.listed(), true))
        .collect();
    options.extend(listed);

    let option_names: Vec<&str> = options
        .iter()
        .filter_map(|option| option.get("name").and_then(Value::as_str))
        .collect();
    let implied_errors = implied_codes(data, &option_names);
    let mut errors = words(data, "errors");
    notes.implied_codes_listed = errors
        .iter()
        .filter(|code| implied_errors.contains(&code.as_str()))
        .cloned()
        .collect();
    for code in implied_errors
        .iter()
        .map(|code| (*code).to_string())
        .chain(context.usage_replacements.iter().cloned())
    {
        if !errors.contains(&code) {
            errors.push(code);
        }
    }

    // The schemas answer: schemas without `Input`, and `rejects` by validator index.
    let answer = context.schemas_answer;
    notes.schemas_answered = answer.is_some();
    let mut schemas: Map<String, Value> = answer
        .and_then(|answer| answer.get("schemas"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    notes.answer_input = schemas.remove("Input");
    let rejects = answer
        .and_then(|answer| answer.get("rejects"))
        .and_then(Value::as_array);

    let mut full = data.clone();
    let object = full.as_object_mut()?;
    object.insert(
        "path".to_string(),
        json!(text(data, "command").split(' ').collect::<Vec<_>>()),
    );
    object.insert(
        "operands".to_string(),
        Value::Array(
            data.get("operands")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|operand| full_argument(operand, false))
                .collect(),
        ),
    );
    object.insert("options".to_string(), Value::Array(options));
    object.insert("errors".to_string(), json!(errors));
    object.insert(
        "outputs".to_string(),
        Value::Array(
            data.get("outputs")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned()
                .map(|mut output| {
                    if let Some(output) = output.as_object_mut() {
                        output
                            .entry("kind")
                            .or_insert_with(|| Value::String("report".to_string()));
                        output
                            .entry("schemaVersion")
                            .or_insert_with(|| Value::String("1.0".to_string()));
                    }
                    output
                })
                .collect(),
        ),
    );
    if let Some(input) = object.get_mut("input").and_then(Value::as_object_mut) {
        input.insert(
            "schemaRef".to_string(),
            Value::String("#/schemas/Input".to_string()),
        );
        input.entry("batch").or_insert(Value::Bool(false));
    }
    if let Some(validators) = object.get_mut("validators").and_then(Value::as_array_mut) {
        for (index, validator) in validators.iter_mut().enumerate() {
            if let Some(validator) = validator.as_object_mut() {
                validator.insert(
                    "rejects".to_string(),
                    rejects
                        .and_then(|lists| lists.get(index))
                        .filter(|list| list.is_array())
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                );
            }
        }
    }
    object.insert("schemas".to_string(), Value::Object(schemas));

    let mut doc = CommandDoc::parse(&full)?;
    if doc.input.is_some() {
        doc.schemas.insert(
            "Input".to_string(),
            derive_fragment(&doc.operands, &doc.options),
        );
    }
    doc.raw = data.clone();
    doc.v14 = Some(Box::new(notes));
    Some(doc)
}

fn note_once(list: &mut Vec<String>, name: &str) {
    if !list.iter().any(|known| known == name) {
        list.push(name.to_string());
    }
}

/// The JSON Schema of one `--input` value of `argument` (spec 9.7.2, "`--input` value"). Domains are not part of it.
fn document_value_schema(argument: &Arg) -> Value {
    match argument.value_type.as_str() {
        "switch" => json!({"type": "boolean"}),
        "count" => json!({"type": "integer", "minimum": 0}),
        "integer" => json!({"anyOf": [
            {"type": "integer"},
            {"type": "string", "pattern": "^-?(0|[1-9][0-9]*)$"}
        ]}),
        "number" => json!({"anyOf": [
            {"type": "number"},
            {"type": "string", "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$"}
        ]}),
        "enum" => json!({"enum": argument.possible_values}),
        "json" => json!({"not": {"type": "null"}}),
        _ => json!({"type": "string"}),
    }
}

/// The fragment schema of one `--input` document, derived as spec 9.9.2 says from the command's operands and its full
/// option set: an object with no `required` and `additionalProperties: false` whose properties are `operands` (an array
/// of operand values, at least one, at most one per operand unless the last is variadic) and the camelCase name of every
/// option that is not flag-only, each admitting the `--input` values of 9.7.2. A repeatable option's value is a plain
/// array of them (a 1.4 tool reads an empty one as "none" or refuses it, and the schema says neither); a `count` is one
/// non-negative integer. Domains are not part of it (10.7 step 6). It is the `Input` of the `--schemas` answer (9.9.3).
pub fn derive_fragment(operands: &[Arg], options: &[Arg]) -> Value {
    let mut properties = Map::new();
    if let Some(last) = operands.last() {
        let fixed = if last.variadic {
            &operands[..operands.len() - 1]
        } else {
            operands
        };
        let mut schema = Map::new();
        schema.insert("type".to_string(), json!("array"));
        schema.insert("minItems".to_string(), json!(1));
        if !last.variadic {
            schema.insert("maxItems".to_string(), json!(operands.len()));
        }
        if !fixed.is_empty() {
            schema.insert(
                "prefixItems".to_string(),
                Value::Array(fixed.iter().map(document_value_schema).collect()),
            );
        }
        schema.insert(
            "items".to_string(),
            if last.variadic {
                document_value_schema(last)
            } else {
                Value::Bool(false)
            },
        );
        properties.insert("operands".to_string(), Value::Object(schema));
    }
    for option in options.iter().filter(|option| !option.flag_only) {
        let value = document_value_schema(option);
        let schema = if option.repeatable && option.value_type != "count" {
            json!({"type": "array", "items": value})
        } else {
            value
        };
        properties.insert(camel(&option.name), schema);
    }
    json!({"type": "object", "additionalProperties": false, "properties": properties})
}

/// The document keys (camelCase) of the repeatable options of `doc` that an `--input` document may carry: the repeatable options of its
/// full option set that are not flag-only and not a `count` (whose value is one integer). The empty array of each is the probe of
/// `L2.input-refusals` (condition `empty-array`, spec 9.9.2; see `checks::documents::empty_array_answer`).
pub fn repeatable_document_keys(doc: &CommandDoc) -> Vec<String> {
    doc.options
        .iter()
        .filter(|option| option.repeatable && !option.flag_only && option.value_type != "count")
        .map(|option| camel(&option.name))
        .collect()
}

/// The `data` of the answers a tool printed to `schema`, by what each is: the input of [`ToolDocs::assemble`].
#[derive(Debug, Clone, Copy, Default)]
pub struct Answers<'a> {
    /// The `data` of `schema --json`.
    pub tree: Option<&'a Value>,
    /// `(command id, data)` of each group document.
    pub groups: &'a [(&'a str, &'a Value)],
    /// `(command id, data)` of each command document.
    pub commands: &'a [(&'a str, &'a Value)],
    /// `(command id, data)` of each `schema <path> --schemas --json` answer (1.4 claims).
    pub schemas: &'a [(&'a str, &'a Value)],
}

impl ToolDocs {
    /// The documents of a tool that claims `claim`, from the `data` of its answers. A claim below 1.4 reads each
    /// document as it is printed; a 1.4 claim builds the full view of each command ([`command_view`]) from the tree's
    /// shared options, the command's `--schemas` answer and `usage_replacements` ([`usage_replacements`]). A document
    /// that is not of its kind is left out, as [`CommandDoc::parse`] and the others leave it.
    pub fn assemble(
        claim: Claim,
        tool: &str,
        answers: &Answers<'_>,
        usage_replacements: &[String],
    ) -> ToolDocs {
        let tree_options: Vec<Value> = answers
            .tree
            .and_then(|tree| tree.get("options"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut docs = ToolDocs {
            tool: tool.to_string(),
            tree: answers.tree.and_then(Tree::parse),
            ..ToolDocs::default()
        };
        for (id, data) in answers.groups {
            if let Some(group) = GroupDoc::parse(data) {
                docs.groups.insert((*id).to_string(), group);
            }
        }
        for (id, data) in answers.commands {
            let doc = if claim.declares_1_4() {
                let answer = answers
                    .schemas
                    .iter()
                    .find(|(command, _)| command == id)
                    .map(|(_, answer)| *answer);
                command_view(
                    data,
                    &ViewContext {
                        tree_options: &tree_options,
                        schemas_answer: answer,
                        usage_replacements,
                    },
                )
            } else {
                CommandDoc::parse(data)
            };
            if let Some(doc) = doc {
                docs.commands.insert((*id).to_string(), doc);
            }
        }
        docs.tree_options = tree_options;
        docs
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn tree_options() -> Vec<Value> {
        vec![json!({"name": "team", "required": true, "short": "t", "help": "The team"})]
    }

    fn data() -> Value {
        json!({
            "kind": "command",
            "command": "member tag",
            "summary": "Add a tag",
            "effect": "write",
            "idempotency": "replay-safe",
            "operands": [{"name": "number", "valueType": "integer", "required": true, "help": "n"}],
            "options": ["team", "dry-run", {"name": "tag", "required": true, "help": "t"}],
            "errors": ["TAG_INVALID"],
            "outputs": [{"schemaRef": "#/schemas/Report"}],
            "input": {"maxBytes": 1000, "example": {"operands": [7], "tag": "x"}},
            "validators": [{"arguments": ["tag"], "code": "TAG_INVALID", "description": "d"}],
            "examples": ["acme member tag 7 --tag x --json"]
        })
    }

    #[test]
    fn atip_check14_01_the_view_states_defaults_names_and_implied_members() {
        let schemas = json!({
            "kind": "schemas", "command": "member tag",
            "schemas": {"Report": {"type": "object"}},
            "rejects": [["acme member tag 7 --tag admin --json"]]
        });
        let options = tree_options();
        let context = ViewContext {
            tree_options: &options,
            schemas_answer: Some(&schemas),
            usage_replacements: &["OPTION_INVALID".to_string()],
        };
        let doc = command_view(&data(), &context).expect("a command");
        assert_eq!(doc.path, ["member", "tag"]);
        let names: Vec<&str> = doc
            .options
            .iter()
            .map(|option| option.name.as_str())
            .collect();
        assert_eq!(names, ["json", "input", "team", "dry-run", "tag"]);
        let team = doc.option("team").expect("the tree option");
        assert!(team.required && team.short == Some('t'));
        let json = doc.option("json").expect("implied");
        assert!(json.flag_only && json.value_type == "switch");
        assert_eq!(
            doc.option("dry-run").map(|option| option.default.clone()),
            Some(json!(false))
        );
        assert_eq!(
            doc.option("tag")
                .and_then(|option| option.value_name.clone())
                .as_deref(),
            Some("TAG")
        );
        assert_eq!(
            doc.errors,
            [
                "TAG_INVALID",
                "USAGE",
                "INTERNAL",
                "INPUT_INVALID",
                "INPUT_CONFLICT",
                "INPUT_TOO_LARGE",
                "OPTION_INVALID"
            ]
        );
        assert_eq!(doc.outputs[0].kind, "report");
        assert_eq!(doc.outputs[0].schema_version, "1.0");
        assert_eq!(
            doc.input.as_ref().map(|input| input.schema_ref.as_str()),
            Some("#/schemas/Input")
        );
        assert_eq!(
            doc.validators[0].rejects,
            ["acme member tag 7 --tag admin --json"]
        );
        assert_eq!(
            doc.raw["options"][0],
            json!("team"),
            "raw is what was listed"
        );
        let notes = doc.v14.expect("notes");
        assert_eq!(notes.named, ["team"]);
        assert!(notes.unknown_names.is_empty() && notes.given_twice.is_empty());
    }

    #[test]
    fn atip_check14_02_the_derived_fragment_follows_the_full_option_set() {
        let options = tree_options();
        let context = ViewContext {
            tree_options: &options,
            ..ViewContext::default()
        };
        let doc = command_view(&data(), &context).expect("a command");
        let input = &doc.schemas["Input"];
        assert_eq!(input["additionalProperties"], json!(false));
        assert!(input.get("required").is_none());
        let properties = input["properties"].as_object().expect("properties");
        let mut keys: Vec<&str> = properties.keys().map(String::as_str).collect();
        keys.sort_unstable();
        // flag-only options (`json`, `input`) are not keys; `team`, `dryRun` and `tag` are.
        assert_eq!(keys, ["dryRun", "operands", "tag", "team"]);
        assert_eq!(properties["operands"]["maxItems"], json!(1));
        assert_eq!(properties["operands"]["minItems"], json!(1));
        assert_eq!(properties["operands"]["items"], json!(false));
        assert_eq!(properties["dryRun"], json!({"type": "boolean"}));
    }

    #[test]
    fn atip_check14_03_a_repeatable_option_is_a_plain_array_and_a_count_one_integer() {
        let operands = [];
        let repeatable = Arg::parse(
            &full_argument(&json!({"name": "label", "repeatable": true}), true),
            true,
        );
        let count = Arg::parse(
            &full_argument(&json!({"name": "verbose", "valueType": "count"}), true),
            true,
        );
        assert!(count.repeatable, "a count is repeatable by definition");
        let fragment = derive_fragment(&operands, &[repeatable, count]);
        assert_eq!(
            fragment["properties"]["label"],
            json!({"type": "array", "items": {"type": "string"}}),
            "no minItems on the array of a repeatable option"
        );
        assert_eq!(
            fragment["properties"]["verbose"],
            json!({"type": "integer", "minimum": 0})
        );
        assert!(fragment["properties"].get("operands").is_none());
    }

    #[test]
    fn atip_check14_04_the_notes_say_what_the_names_did() {
        let mut document = data();
        document["options"] =
            json!(["team", "team", "region", "json", {"name": "input"}, "fields", "commit"]);
        let options = tree_options();
        let context = ViewContext {
            tree_options: &options,
            ..ViewContext::default()
        };
        let doc = command_view(&document, &context).expect("a command");
        let notes = doc.v14.as_ref().expect("notes");
        assert_eq!(notes.given_twice, ["team"]);
        assert_eq!(notes.unknown_names, ["region"]);
        assert_eq!(notes.implied_options_listed, ["json", "input"]);
        assert_eq!(notes.unoffered_options_listed, ["fields"]);
        // `--commit` is never implied: named, it is offered, and its code is implied with it.
        assert!(doc.option("commit").is_some() && doc.errors.contains(&"PLAN_STALE".to_string()));
    }
}
