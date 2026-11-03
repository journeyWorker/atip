//! The self-description a tool answers `schema` with, in the form of the minor it declares (spec 9, 15.7).
//!
//! A tool builds its typed model once ([`crate::doc`]: the tree entries and one [`CommandDoc`] per command, in the full form
//! every minor can be written from) and hands it to [`Described::new`] with the minor it declares. [`Described`] is then the
//! one serializer of the answers:
//!
//! | answer | method | before 1.4 | in 1.4 |
//! |---|---|---|---|
//! | `schema --json` | [`Described::tree`] | `level`, `commands` | also `options`: the options commands share, defined once |
//! | `schema <GROUP> --json` | [`Described::group`] | with `path` | without `path` |
//! | `schema <COMMAND> --json` | [`Described::command`] | the model as it is | the call surface of spec 9.5 |
//! | `schema <COMMAND> --schemas --json` | [`Described::schemas`] | none | `kind: schemas` (spec 9.9.3) |
//!
//! Each method returns a [`Document`]: the `data` of the envelope, which a tool wraps like any other (`serde` serializes it in
//! the order of the form, so [`crate::line`] prints compact JSON with the members where the spec lists them); [`Document::to_value`]
//! is the same as a [`serde_json::Value`] for a test.
//!
//! **The 1.4 form** is owned here and nowhere else (`approaches/implementation.md` §8; no command writes an omission by hand):
//!
//! - *Defaults are left out* (spec 9.5; Annex S2 rule 17): `required`, `repeatable`, `variadic`, `flagOnly` and `async` false; a
//!   `default` that is `null` (`false` for a switch, `0` for a count); `valueType` `string`; `valueName` the name in upper case
//!   with `_` for `-`; an output's `kind` `report` and `schemaVersion` `1.0`; `input.batch` false; an empty list; a tree entry's
//!   `kind` `command`. `path` is never written.
//! - *What the document implies is left out*: the options `--json`, `--input` (with `input`) and `--fields` (when an output has
//!   `fields`), which the model lists in their reserved kind (value type, `flagOnly`, no `required`, `repeatable` or default;
//!   their placeholder and help never reach a document) and which must be of it; the codes `USAGE`, `INTERNAL`,
//!   `INPUT_INVALID`, `INPUT_CONFLICT` and `INPUT_TOO_LARGE` with `input`, `BATCH_INCOMPLETE` with `input.batch`, `PLAN_STALE`
//!   with `--commit`, `OPERATION_REUSED` with `--operation`, `CURSOR_INVALID` with `--cursor`, and the finer replacements of
//!   `USAGE` the tool registers ([`Described::usage_replacements`]). `--commit` and `--plan-digest` are not implied: they stay
//!   listed.
//! - *Reserved names*: each reserved option has one standard help text ([`standard_help`]). An option that is the reserved option
//!   unchanged (spec 4.5, Annex S2 rule 8: its fixed shape) and whose `help` equals the standard text, after whitespace is
//!   normalised, is listed by its bare name (`"commit"`, `"plan-digest"`, `"dry-run"`, `"operation"`, and `limit`, `cursor`,
//!   `all` when they carry no default, domain or value name of their own). A reserved option with another `help` is an object:
//!   the fixed shape plus that `help`, as is an option with another shape (`--limit` with a default and a bound). A tool that
//!   wants another standard text defines the option once in the tree's `options` (the shared options below): a name resolves
//!   to the tree's definition first.
//! - *Shared options*: an option whose serialization is the same on two or more commands is defined once in the tree's
//!   `options`, in the order of its first appearance, and each of those commands names it where it stood. An option that differs
//!   (`required`, default, enum subset, help) is another definition and stays in full on its command. Two definitions of one
//!   name cannot both be shared (a name resolves to one): the one on more commands is, the first of equals.
//! - *Schemas*: the command document has no `schemas`, `input.schemaRef`, `input.option` or `validators[].rejects`; the schemas
//!   answer holds exactly the schemas the refs reach (output `schemaRef` and `eventRef`, `input.argumentsRef`, and what they
//!   refer to through `#/schemas/<Name>`), the derived fragment schema ([`crate::fragment`]) under `Input` when the command has
//!   `input`, and `rejects`, one list per validator in `validators` order, present exactly when there are validators.
//!
//! The model is checked when it is built ([`Error`]); the answers never fail. A tool still registers every code and enforces
//! every option; only the document leaves out what it implies.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::Value;

use crate::doc::{CommandDoc, Effect, Idempotency};
use crate::doc::{
    ConstraintDoc, EntryKind, FieldsDoc, InputDoc, OperandDoc, OptionDoc, OutputDoc, OutputKind,
    TreeEntry, ValidatorDoc, ValueType,
};
use crate::envelope;
use crate::fragment::Fragment;
use crate::minor::Minor;

/// Why a model cannot be written as a document of the minor it declares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Two tree entries have one `command`.
    DuplicateEntry(String),
    /// Two command documents have one `command`.
    DuplicateCommand(String),
    /// A tree entry of kind `command` has no command document.
    NoCommandDocument(String),
    /// A command lists one option name twice.
    DuplicateOption { command: String, option: String },
    /// A command lists `--json`, `--input` (with `input`) or `--fields` (with an output's `fields`), which its document implies,
    /// in a shape other than the reserved one: a 1.4 document cannot say it (Annex S2 rule 17).
    ImpliedOptionChanged { command: String, option: String },
    /// A command lists an option as an object, in full, that has no `help`: only a reserved option unchanged may be listed by its
    /// bare name, which carries none (spec 9.5).
    OptionWithoutHelp { command: String, option: String },
    /// A command lists `--input` without `input`, or `--fields` without an output that declares `fields` (spec 9.5).
    OptionWithoutFeature { command: String, option: String },
    /// A ref of a command is not of the form `#/schemas/<Name>`.
    BadRef { command: String, reference: String },
    /// A schema a ref of the command reaches is not in the command's `schemas`.
    MissingSchema { command: String, name: String },
    /// A ref of the command names `Input`, which the schemas answer keeps for the derived fragment schema (spec 9.9.3).
    InputIsReserved { command: String },
    /// A validator has no `rejects` invocation (spec 9.8.2): the schemas answer lists at least one per validator.
    EmptyRejects { command: String, validator: usize },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::DuplicateEntry(command) => write!(f, "the tree lists `{command}` twice"),
            Error::DuplicateCommand(command) => write!(f, "two command documents are for `{command}`"),
            Error::NoCommandDocument(command) => write!(f, "the tree lists the command `{command}` and the model has no document for it"),
            Error::DuplicateOption { command, option } => write!(f, "`{command}` lists --{option} twice (Annex S2 rule 9)"),
            Error::ImpliedOptionChanged { command, option } => write!(f, "`{command}` lists --{option}, which its document implies, in a shape other than the reserved one: a 1.4 document cannot say it (spec 9.5, Annex S2 rule 17)"),
            Error::OptionWithoutHelp { command, option } => write!(f, "`{command}` lists --{option} in full and gives it no help (spec 9.5)"),
            Error::OptionWithoutFeature { command, option } => write!(f, "`{command}` lists --{option} but declares no {} (spec 9.5)", if option == "input" { "input" } else { "output with fields" }),
            Error::BadRef { command, reference } => write!(f, "`{command}` has the ref `{reference}`, which is not `#/schemas/<Name>` (spec 9.9.1)"),
            Error::MissingSchema { command, name } => write!(f, "`{command}` refers to the schema `{name}`, which its model does not hold (Annex S2 rule 2)"),
            Error::InputIsReserved { command } => write!(f, "a ref of `{command}` names `Input`, which the schemas answer keeps for the derived fragment schema (spec 9.9.3)"),
            Error::EmptyRejects { command, validator } => write!(f, "validator {validator} of `{command}` has no `rejects` invocation (spec 9.8.2)"),
        }
    }
}

impl std::error::Error for Error {}

/// The reserved options of spec 4.5 with their fixed shape (Annex S2 rule 8): their value type and whether they are flag-only.
const RESERVED_OPTIONS: [(&str, ValueType, bool); 10] = [
    ("json", ValueType::Switch, true),
    ("input", ValueType::String, true),
    ("commit", ValueType::Switch, true),
    ("plan-digest", ValueType::String, true),
    ("dry-run", ValueType::Switch, false),
    ("limit", ValueType::Integer, true),
    ("cursor", ValueType::String, true),
    ("all", ValueType::Switch, true),
    ("fields", ValueType::String, true),
    ("operation", ValueType::String, false),
];

/// What `default` is when a document leaves it out: `false` for a switch, `0` for a count, else `null` (spec 9.5).
fn default_is_implied(value_type: ValueType, default: &Value) -> bool {
    match value_type {
        ValueType::Switch => default == &Value::Bool(false),
        ValueType::Count => default.as_u64() == Some(0),
        _ => default.is_null(),
    }
}

/// Whether `value_name` is the name in upper case with `_` for `-` (spec 9.5).
fn is_default_value_name(value_name: &str, name: &str) -> bool {
    value_name.len() == name.len()
        && value_name.bytes().zip(name.bytes()).all(|(given, byte)| {
            given
                == if byte == b'-' {
                    b'_'
                } else {
                    byte.to_ascii_uppercase()
                }
        })
}

/// Whether `option` has the fixed shape of the reserved option of its name (spec 4.5, Annex S2 rule 8): its value type and
/// `flagOnly`, and no `required`, `repeatable` or default of its own. What an option the document implies says besides is
/// never written, so this is all that is compared for it.
fn has_reserved_kind(option: &OptionDoc) -> bool {
    RESERVED_OPTIONS
        .iter()
        .find(|(name, _, _)| *name == option.name)
        .is_some_and(|(_, value_type, flag_only)| {
            option.value_type == *value_type
                && option.flag_only == *flag_only
                && !option.required
                && !option.repeatable
                && default_is_implied(option.value_type, &option.default)
        })
}

/// The standard help text of the reserved option `name` (spec 4.5): the text a bare name stands for. A model whose option has
/// this text, with its whitespace normalised, is written as the bare name; another text is written in an object.
pub fn standard_help(name: &str) -> Option<&'static str> {
    Some(match name {
        "json" => "Write the result as one JSON document.",
        "input" => "The arguments as a JSON document: a file, or - for stdin.",
        "commit" => "Make the change; without it the command only previews.",
        "plan-digest" => "The digest of the preview this commit carries out.",
        "dry-run" => "Preview the change without making it.",
        "limit" => "Return at most this many items.",
        "cursor" => "Resume after the last item of the previous page (meta.page.nextCursor).",
        "all" => "Return every item from the cursor on.",
        "fields" => "Return only these fields of each record.",
        "operation" => "A key that makes a repeated call the same operation.",
        _ => return None,
    })
}

/// Whether `left` and `right` are the same words, whatever the whitespace between them.
fn same_words(left: &str, right: &str) -> bool {
    left.split_whitespace().eq(right.split_whitespace())
}

/// Whether `option` is the reserved option of its name, unchanged, with its standard `help`: it can be listed by its bare name,
/// which resolves to the fixed shape and the standard text, so nothing else of it may differ (a `valueName` is the default
/// one). With another `help` it is listed as an object, which can say it.
fn is_reserved_shape(option: &OptionDoc) -> bool {
    has_reserved_kind(option)
        && standard_help(&option.name).is_some_and(|standard| same_words(&option.help, standard))
        && option.short.is_none()
        && option.default_note.is_none()
        && option.env.is_none()
        && option.domain.is_none()
        && option.possible_values.is_none()
        && option
            .value_name
            .as_deref()
            .is_none_or(|value_name| is_default_value_name(value_name, &option.name))
}

// ------------------------------------------------------------------- the 1.4 views

/// An option object of a 1.4 document: every member that is not its default (spec 9.5).
#[derive(Debug)]
struct OptionView<'a>(&'a OptionDoc);

impl Serialize for OptionView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let option = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("name", &option.name)?;
        if let Some(short) = &option.short {
            map.serialize_entry("short", short)?;
        }
        if let Some(value_name) = option
            .value_name
            .as_ref()
            .filter(|value_name| !is_default_value_name(value_name, &option.name))
        {
            map.serialize_entry("valueName", value_name)?;
        }
        if option.value_type != ValueType::String {
            map.serialize_entry("valueType", &option.value_type)?;
        }
        if let Some(members) = &option.possible_values {
            map.serialize_entry("possibleValues", members)?;
        }
        if option.required {
            map.serialize_entry("required", &true)?;
        }
        if option.repeatable && option.value_type != ValueType::Count {
            map.serialize_entry("repeatable", &true)?;
        }
        if !default_is_implied(option.value_type, &option.default) {
            map.serialize_entry("default", &option.default)?;
        }
        if let Some(note) = &option.default_note {
            map.serialize_entry("defaultNote", note)?;
        }
        if let Some(env) = &option.env {
            map.serialize_entry("env", env)?;
        }
        if option.flag_only {
            map.serialize_entry("flagOnly", &true)?;
        }
        if let Some(domain) = &option.domain {
            map.serialize_entry("domain", domain)?;
        }
        map.serialize_entry("help", &option.help)?;
        map.end()
    }
}

/// An operand of a 1.4 document.
#[derive(Debug)]
struct OperandView<'a>(&'a OperandDoc);

impl Serialize for OperandView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let operand = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("name", &operand.name)?;
        if !is_default_value_name(&operand.value_name, &operand.name) {
            map.serialize_entry("valueName", &operand.value_name)?;
        }
        if operand.value_type != ValueType::String {
            map.serialize_entry("valueType", &operand.value_type)?;
        }
        if let Some(members) = &operand.possible_values {
            map.serialize_entry("possibleValues", members)?;
        }
        if operand.required {
            map.serialize_entry("required", &true)?;
        }
        if operand.variadic {
            map.serialize_entry("variadic", &true)?;
        }
        if !operand.default.is_null() {
            map.serialize_entry("default", &operand.default)?;
        }
        if let Some(note) = &operand.default_note {
            map.serialize_entry("defaultNote", note)?;
        }
        if let Some(domain) = &operand.domain {
            map.serialize_entry("domain", domain)?;
        }
        map.serialize_entry("help", &operand.help)?;
        map.end()
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_report(kind: &OutputKind) -> bool {
    *kind == OutputKind::Report
}

fn is_first_version(version: &&str) -> bool {
    **version == *"1.0"
}

/// An output of a 1.4 document.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputView<'a> {
    #[serde(skip_serializing_if = "is_report")]
    kind: OutputKind,
    schema_ref: &'a str,
    #[serde(skip_serializing_if = "is_first_version")]
    schema_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_type: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_ref: Option<&'a str>,
    #[serde(skip_serializing_if = "is_false")]
    batch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    when: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<&'a FieldsDoc>,
}

impl<'a> OutputView<'a> {
    fn of(output: &'a OutputDoc) -> Self {
        OutputView {
            kind: output.kind,
            schema_ref: &output.schema_ref,
            schema_version: &output.schema_version,
            media_type: output.media_type.as_deref(),
            event_ref: output.event_ref.as_deref(),
            batch: output.batch,
            when: output.when.as_deref(),
            fields: output.fields.as_ref(),
        }
    }
}

/// The `input` of a 1.4 document: no `option`, no `schemaRef` (the fragment schema is derived).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputView<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    arguments_ref: Option<&'a str>,
    #[serde(skip_serializing_if = "is_false")]
    batch: bool,
    max_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_items: Option<u64>,
    example: &'a Value,
}

impl<'a> InputView<'a> {
    fn of(input: &'a InputDoc) -> Self {
        InputView {
            arguments_ref: input.arguments_ref.as_deref(),
            batch: input.batch,
            max_bytes: input.max_bytes,
            max_items: input.max_items,
            example: &input.example,
        }
    }
}

/// A validator of a 1.4 document: no `rejects` (the schemas answer has them).
#[derive(Debug, Serialize)]
struct ValidatorView<'a> {
    arguments: &'a [String],
    code: &'a str,
    description: &'a str,
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

impl<'a> ValidatorView<'a> {
    fn of(validator: &'a ValidatorDoc) -> Self {
        ValidatorView {
            arguments: &validator.arguments,
            code: &validator.code,
            description: &validator.description,
            extensions: &validator.extensions,
        }
    }
}

/// One entry of a command's `options`: the name of a tree option or a reserved option, or the command's own option.
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Listed<'a> {
    Name(&'a str),
    Own(OptionView<'a>),
}

/// What a command's document does with each option of its model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    /// Implied by the document: not listed.
    Omit,
    /// Listed by its name: a tree option or a reserved option.
    Name,
    /// Listed in full.
    Own,
}

/// A command document of the 1.4 form (spec 9.5).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandView<'a> {
    kind: &'static str,
    command: &'a str,
    summary: &'a str,
    effect: Effect,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotency: Option<Idempotency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effect_note: Option<&'a str>,
    #[serde(rename = "async", skip_serializing_if = "is_false")]
    is_async: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    operands: Vec<OperandView<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    options: Vec<Listed<'a>>,
    #[serde(skip_serializing_if = "<[ConstraintDoc]>::is_empty")]
    constraints: &'a [ConstraintDoc],
    #[serde(skip_serializing_if = "Vec::is_empty")]
    validators: Vec<ValidatorView<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<&'a str>,
    outputs: Vec<OutputView<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<InputView<'a>>,
    examples: &'a [String],
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

/// A tree entry of the 1.4 form: no `path`, and `kind` only for a group.
#[derive(Debug)]
struct EntryView<'a>(&'a TreeEntry);

impl Serialize for EntryView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let entry = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("command", &entry.command)?;
        if entry.kind == EntryKind::Group {
            map.serialize_entry("kind", &entry.kind)?;
        }
        map.serialize_entry("summary", &entry.summary)?;
        if let Some(effect) = &entry.effect {
            map.serialize_entry("effect", effect)?;
        }
        for (name, value) in &entry.extensions {
            map.serialize_entry(name, value)?;
        }
        map.end()
    }
}

/// The tree of the 1.4 form.
#[derive(Debug, Serialize)]
struct TreeView<'a> {
    kind: &'static str,
    level: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    options: Vec<OptionView<'a>>,
    commands: Vec<EntryView<'a>>,
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

/// A group of the 1.4 form: no `path`.
#[derive(Debug, Serialize)]
struct GroupView<'a> {
    kind: &'static str,
    command: &'a str,
    summary: &'a str,
    commands: Vec<EntryView<'a>>,
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

/// One schema of a schemas answer: the command's own, or the derived fragment schema.
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum SchemaView<'a> {
    Held(&'a Value),
    Derived(Fragment<'a>),
}

/// `schema <COMMAND> --schemas --json` (spec 9.9.3).
#[derive(Debug, Serialize)]
struct SchemasView<'a> {
    kind: &'static str,
    command: &'a str,
    schemas: BTreeMap<&'a str, SchemaView<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rejects: Option<Vec<&'a [String]>>,
}

// ----------------------------------------------------------- the form before 1.4

/// The tree before 1.4: the entries as the model holds them, with their `path` and `kind`.
#[derive(Debug, Serialize)]
struct LegacyTree<'a> {
    kind: &'static str,
    level: &'a str,
    commands: &'a [TreeEntry],
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

/// A group before 1.4: with its `path`.
#[derive(Debug, Serialize)]
struct LegacyGroup<'a> {
    kind: &'static str,
    command: &'a str,
    path: &'a [String],
    summary: &'a str,
    commands: Vec<&'a TreeEntry>,
    #[serde(flatten)]
    extensions: &'a BTreeMap<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Body<'a> {
    Tree(TreeView<'a>),
    Group(GroupView<'a>),
    Command(Box<CommandView<'a>>),
    Schemas(SchemasView<'a>),
    LegacyTree(LegacyTree<'a>),
    LegacyGroup(LegacyGroup<'a>),
    LegacyCommand(&'a CommandDoc),
}

/// The `data` of a `schema` answer, in the form of the minor the model was built for. It serializes members in the order of
/// the form; [`Document::to_value`] and [`Document::to_line`] are the other ways to read it.
#[derive(Debug, Serialize)]
pub struct Document<'a>(Body<'a>);

impl Document<'_> {
    /// The document as a JSON value (`serde_json` without `preserve_order` sorts the members of an object).
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("a self-description serializes")
    }

    /// The document as compact JSON on one line, in the order of the form, without the newline.
    pub fn to_line(&self) -> String {
        envelope::line(self)
    }
}

// ------------------------------------------------------------------ the model

/// What a 1.4 document does with a model: the shared options, and what each command does with each of its options.
#[derive(Debug)]
struct Layout {
    /// The shared options, in the order of their first appearance: the command and the option's place in it.
    shared: Vec<(usize, usize)>,
    /// Per command, per option of the model.
    slots: Vec<Vec<Slot>>,
    /// Per command: the names of the schemas its refs reach.
    reached: Vec<BTreeSet<String>>,
}

/// A tool's self-description: the model and the minor it is written for.
#[derive(Debug)]
pub struct Described {
    minor: Minor,
    level: String,
    tree_extensions: BTreeMap<String, Value>,
    group_extensions: BTreeMap<String, BTreeMap<String, Value>>,
    usage_replacements: Vec<String>,
    entries: Vec<TreeEntry>,
    commands: Vec<CommandDoc>,
    layout: Option<Layout>,
}

/// What a group or tree writes when the tool set no `x-` members of its own.
static NO_EXTENSIONS: BTreeMap<String, Value> = BTreeMap::new();

const SCHEMAS_PREFIX: &str = "#/schemas/";

impl Described {
    /// The self-description of a tool that declares `minor`: `level` (`L1` or `L2`), `entries` the tree in its order (a group
    /// before its commands, `schema` included) and one document per command, in the full form: every option the command
    /// accepts is listed (the implied ones included, in their reserved shape), every code is in `errors`, `path` and `schemas`
    /// are filled, and each validator has its `rejects`. Up to 1.3 the documents are written as they are; for 1.4 the form of
    /// the module is derived, and a model that cannot be written in it is refused.
    pub fn new(
        minor: Minor,
        level: impl Into<String>,
        entries: Vec<TreeEntry>,
        commands: Vec<CommandDoc>,
    ) -> Result<Self, Error> {
        let mut seen = BTreeSet::new();
        for entry in &entries {
            if !seen.insert(entry.command.as_str()) {
                return Err(Error::DuplicateEntry(entry.command.clone()));
            }
        }
        let mut documented = BTreeSet::new();
        for command in &commands {
            if !documented.insert(command.command.as_str()) {
                return Err(Error::DuplicateCommand(command.command.clone()));
            }
        }
        if let Some(entry) = entries.iter().find(|entry| {
            entry.kind == EntryKind::Command && !documented.contains(entry.command.as_str())
        }) {
            return Err(Error::NoCommandDocument(entry.command.clone()));
        }
        let layout = minor
            .at_least(Minor::V1_4)
            .then(|| Layout::of(&commands))
            .transpose()?;
        Ok(Described {
            minor,
            level: level.into(),
            tree_extensions: BTreeMap::new(),
            group_extensions: BTreeMap::new(),
            usage_replacements: Vec::new(),
            entries,
            commands,
            layout,
        })
    }

    /// The finer codes the tool registers in place of `USAGE` (spec 7.3.2): a 1.4 document implies them, so it does not list
    /// them in `errors`.
    pub fn usage_replacements<I, S>(mut self, codes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.usage_replacements = codes.into_iter().map(Into::into).collect();
        self
    }

    /// The tool's own members of the tree (`x-<tool>`, spec 9.10.2): a tool that filters its tree (spec 9.3) says so here.
    pub fn tree_extensions(mut self, extensions: BTreeMap<String, Value>) -> Self {
        self.tree_extensions = extensions;
        self
    }

    /// The tool's own members of the group `command` (`x-<tool>`, spec 9.10.2), written beside the contract's own in its
    /// document; none by default.
    pub fn group_extensions(
        mut self,
        command: impl Into<String>,
        extensions: BTreeMap<String, Value>,
    ) -> Self {
        self.group_extensions.insert(command.into(), extensions);
        self
    }

    /// The minor the documents are written for.
    pub fn minor(&self) -> Minor {
        self.minor
    }

    /// The tree: `schema --json`.
    pub fn tree(&self) -> Document<'_> {
        Document(match &self.layout {
            None => Body::LegacyTree(LegacyTree {
                kind: "tree",
                level: &self.level,
                commands: &self.entries,
                extensions: &self.tree_extensions,
            }),
            Some(layout) => Body::Tree(TreeView {
                kind: "tree",
                level: &self.level,
                options: layout
                    .shared
                    .iter()
                    .map(|&(command, option)| OptionView(&self.commands[command].options[option]))
                    .collect(),
                commands: self.entries.iter().map(EntryView).collect(),
                extensions: &self.tree_extensions,
            }),
        })
    }

    /// The group `command` (`schema <GROUP> --json`), or `None` when the tree has no group of that name.
    pub fn group(&self, command: &str) -> Option<Document<'_>> {
        let group = self
            .entries
            .iter()
            .find(|entry| entry.kind == EntryKind::Group && entry.command == command)?;
        let children = self.entries.iter().filter(|entry| {
            entry
                .command
                .strip_prefix(command)
                .and_then(|rest| rest.strip_prefix(' '))
                .is_some_and(|word| !word.contains(' '))
        });
        let extensions = self.group_extensions.get(command).unwrap_or(&NO_EXTENSIONS);
        Some(Document(match &self.layout {
            None => Body::LegacyGroup(LegacyGroup {
                kind: "group",
                command: &group.command,
                path: &group.path,
                summary: &group.summary,
                commands: children.collect(),
                extensions,
            }),
            Some(_) => Body::Group(GroupView {
                kind: "group",
                command: &group.command,
                summary: &group.summary,
                commands: children.map(EntryView).collect(),
                extensions,
            }),
        }))
    }

    fn position(&self, command: &str) -> Option<usize> {
        self.commands
            .iter()
            .position(|document| document.command == command)
    }

    /// The command `command` (`schema <COMMAND> --json`), or `None` when the model has no such command.
    pub fn command(&self, command: &str) -> Option<Document<'_>> {
        let at = self.position(command)?;
        let document = &self.commands[at];
        Some(Document(match &self.layout {
            None => Body::LegacyCommand(document),
            Some(layout) => Body::Command(Box::new(self.command_view(at, layout))),
        }))
    }

    fn command_view<'a>(&'a self, at: usize, layout: &Layout) -> CommandView<'a> {
        let document = &self.commands[at];
        let options = document
            .options
            .iter()
            .zip(&layout.slots[at])
            .filter_map(|(option, slot)| match slot {
                Slot::Omit => None,
                Slot::Name => Some(Listed::Name(&option.name)),
                Slot::Own => Some(Listed::Own(OptionView(option))),
            })
            .collect();
        CommandView {
            kind: CommandDoc::KIND,
            command: &document.command,
            summary: &document.summary,
            effect: document.effect,
            idempotency: document.idempotency,
            effect_note: document.effect_note.as_deref(),
            is_async: document.is_async,
            operands: document.operands.iter().map(OperandView).collect(),
            options,
            constraints: &document.constraints,
            validators: document.validators.iter().map(ValidatorView::of).collect(),
            errors: document
                .errors
                .iter()
                .map(String::as_str)
                .filter(|code| !self.is_implied_code(document, code))
                .collect(),
            outputs: document.outputs.iter().map(OutputView::of).collect(),
            input: document.input.as_ref().map(InputView::of),
            examples: &document.examples,
            extensions: &document.extensions,
        }
    }

    /// Whether the document of `command` implies `code` (spec 9.5), so that it is not listed in `errors`.
    fn is_implied_code(&self, command: &CommandDoc, code: &str) -> bool {
        let offers = |name: &str| command.options.iter().any(|option| option.name == name);
        match code {
            "USAGE" | "INTERNAL" => true,
            "INPUT_INVALID" | "INPUT_CONFLICT" | "INPUT_TOO_LARGE" => command.input.is_some(),
            "BATCH_INCOMPLETE" => command.input.as_ref().is_some_and(|input| input.batch),
            "PLAN_STALE" => offers("commit"),
            "OPERATION_REUSED" => offers("operation"),
            "CURSOR_INVALID" => offers("cursor"),
            other => self.usage_replacements.iter().any(|code| code == other),
        }
    }

    /// The schemas answer of `command` (`schema <COMMAND> --schemas --json`, spec 9.9.3): `None` for a model written for
    /// a minor before 1.4, which has no such answer, and for a command the model does not have.
    pub fn schemas(&self, command: &str) -> Option<Document<'_>> {
        let layout = self.layout.as_ref()?;
        let at = self.position(command)?;
        let document = &self.commands[at];
        let mut schemas: BTreeMap<&str, SchemaView<'_>> = layout.reached[at]
            .iter()
            .map(|name| {
                let schema = &document.schemas[name.as_str()];
                (name.as_str(), SchemaView::Held(schema))
            })
            .collect();
        if document.input.is_some() {
            schemas.insert(
                "Input",
                SchemaView::Derived(Fragment::of(&document.operands, &document.options)),
            );
        }
        Some(Document(Body::Schemas(SchemasView {
            kind: "schemas",
            command: &document.command,
            schemas,
            rejects: (!document.validators.is_empty()).then(|| {
                document
                    .validators
                    .iter()
                    .map(|validator| validator.rejects.as_slice())
                    .collect()
            }),
        })))
    }
}

/// An option definition that is not a reserved name, by its serialization: where it first stood and on how many commands.
#[derive(Debug)]
struct Definition {
    first: (usize, usize),
    commands: usize,
}

/// What `command`'s document does with `option` before the shared options are known, or why it cannot say it.
fn slot_of(command: &CommandDoc, option: &OptionDoc) -> Result<Slot, Error> {
    let implied = match option.name.as_str() {
        "json" => true,
        "input" => command.input.is_some(),
        "fields" => command.outputs.iter().any(|output| output.fields.is_some()),
        _ => false,
    };
    let refused = || (command.command.clone(), option.name.clone());
    if !implied && matches!(option.name.as_str(), "input" | "fields") {
        let (command, option) = refused();
        return Err(Error::OptionWithoutFeature { command, option });
    }
    if implied && !has_reserved_kind(option) {
        let (command, option) = refused();
        return Err(Error::ImpliedOptionChanged { command, option });
    }
    Ok(if implied {
        Slot::Omit
    } else if is_reserved_shape(option) {
        Slot::Name
    } else {
        Slot::Own
    })
}

/// An option listed in full has a `help`, which an object must carry.
fn own_has_help(command: &CommandDoc, option: &OptionDoc) -> Result<(), Error> {
    if option.help.trim().is_empty() {
        return Err(Error::OptionWithoutHelp {
            command: command.command.clone(),
            option: option.name.clone(),
        });
    }
    Ok(())
}

impl Layout {
    fn of(commands: &[CommandDoc]) -> Result<Layout, Error> {
        let mut reached = Vec::with_capacity(commands.len());
        let mut slots: Vec<Vec<Slot>> = Vec::with_capacity(commands.len());
        let mut definitions: Vec<Definition> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        // Per command, per option: the definition of an option that is its own, so far.
        let mut definition_of: Vec<Vec<Option<usize>>> = Vec::with_capacity(commands.len());
        for (at, command) in commands.iter().enumerate() {
            reached.push(reached_schemas(command)?);
            let mut row = Vec::with_capacity(command.options.len());
            let mut known = Vec::with_capacity(command.options.len());
            for (place, option) in command.options.iter().enumerate() {
                if command.options[..place]
                    .iter()
                    .any(|earlier| earlier.name == option.name)
                {
                    return Err(Error::DuplicateOption {
                        command: command.command.clone(),
                        option: option.name.clone(),
                    });
                }
                let slot = slot_of(command, option)?;
                if slot == Slot::Own {
                    own_has_help(command, option)?;
                }
                row.push(slot);
                known.push((slot == Slot::Own).then(|| {
                    let key =
                        serde_json::to_string(&OptionView(option)).expect("an option serializes");
                    let next = definitions.len();
                    let found = *index.entry(key).or_insert(next);
                    if found == next {
                        definitions.push(Definition {
                            first: (at, place),
                            commands: 0,
                        });
                    }
                    definitions[found].commands += 1;
                    found
                }));
            }
            slots.push(row);
            definition_of.push(known);
        }
        let option_at = |(command, option): (usize, usize)| &commands[command].options[option];
        // One definition per name is shared: the one on the most commands, the first of equals; and only from two commands on.
        let mut best: HashMap<&str, usize> = HashMap::new();
        for (known, definition) in definitions.iter().enumerate() {
            if definition.commands < 2 {
                continue;
            }
            let name = option_at(definition.first).name.as_str();
            if best
                .get(name)
                .is_none_or(|&held| definitions[held].commands < definition.commands)
            {
                best.insert(name, known);
            }
        }
        let chosen: BTreeSet<usize> = best.values().copied().collect();
        let tree_names: BTreeSet<&str> = chosen
            .iter()
            .map(|&known| option_at(definitions[known].first).name.as_str())
            .collect();
        for (at, command) in commands.iter().enumerate() {
            for (place, option) in command.options.iter().enumerate() {
                let slot = &mut slots[at][place];
                match definition_of[at][place] {
                    Some(known) if chosen.contains(&known) => *slot = Slot::Name,
                    // A name that resolves to a tree option is that option: the reserved one, in full, is the command's own.
                    None if *slot == Slot::Name && tree_names.contains(option.name.as_str()) => {
                        own_has_help(command, option)?;
                        *slot = Slot::Own;
                    }
                    _ => {}
                }
            }
        }
        Ok(Layout {
            shared: chosen
                .iter()
                .map(|&known| definitions[known].first)
                .collect(),
            slots,
            reached,
        })
    }
}

/// The schemas the refs of `command` reach, by name (spec 9.9.3): what its refs name and what those refer to through
/// `#/schemas/<Name>`.
fn reached_schemas(command: &CommandDoc) -> Result<BTreeSet<String>, Error> {
    let mut refs: Vec<&str> = Vec::new();
    for output in &command.outputs {
        refs.push(&output.schema_ref);
        refs.extend(output.event_ref.as_deref());
    }
    if let Some(input) = &command.input {
        refs.extend(input.arguments_ref.as_deref());
    }
    let mut reached = BTreeSet::new();
    let mut pending: Vec<&str> = Vec::new();
    for reference in refs {
        let name = reference
            .strip_prefix(SCHEMAS_PREFIX)
            .ok_or_else(|| Error::BadRef {
                command: command.command.clone(),
                reference: reference.to_string(),
            })?;
        pending.push(name);
    }
    while let Some(name) = pending.pop() {
        // `Input` is the derived fragment schema's name: no ref, direct or reached through another schema, takes it.
        if name == "Input" {
            return Err(Error::InputIsReserved {
                command: command.command.clone(),
            });
        }
        if reached.contains(name) {
            continue;
        }
        let schema = command
            .schemas
            .get(name)
            .ok_or_else(|| Error::MissingSchema {
                command: command.command.clone(),
                name: name.to_string(),
            })?;
        reached.insert(name.to_string());
        collect_refs(schema, &mut pending);
    }
    if let Some((at, _)) = command
        .validators
        .iter()
        .enumerate()
        .find(|(_, validator)| validator.rejects.is_empty())
    {
        return Err(Error::EmptyRejects {
            command: command.command.clone(),
            validator: at,
        });
    }
    Ok(reached)
}

/// The names `$ref: "#/schemas/<Name>"` points at anywhere in `schema`.
fn collect_refs<'a>(schema: &'a Value, found: &mut Vec<&'a str>) {
    match schema {
        Value::Object(map) => {
            for (key, value) in map {
                match value {
                    Value::String(target) if key == "$ref" => {
                        found.extend(target.strip_prefix(SCHEMAS_PREFIX));
                    }
                    other => collect_refs(other, found),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_refs(item, found);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn option(name: &str, value_type: ValueType) -> OptionDoc {
        let valued = !matches!(value_type, ValueType::Switch | ValueType::Count);
        OptionDoc {
            name: name.to_string(),
            short: None,
            value_name: valued.then(|| name.to_uppercase().replace('-', "_")),
            value_type,
            possible_values: None,
            required: false,
            repeatable: false,
            default: match value_type {
                ValueType::Switch => json!(false),
                ValueType::Count => json!(0),
                _ => Value::Null,
            },
            default_note: None,
            env: None,
            flag_only: false,
            domain: None,
            help: format!("The {name}."),
        }
    }

    fn reserved(name: &str) -> OptionDoc {
        let (_, value_type, flag_only) = *RESERVED_OPTIONS
            .iter()
            .find(|(reserved, _, _)| *reserved == name)
            .expect("a reserved name");
        let mut option = option(name, value_type);
        option.flag_only = flag_only;
        option
    }

    /// A reserved option with its standard `help`: listed by its bare name.
    fn bare(name: &str) -> OptionDoc {
        let mut option = reserved(name);
        option.help = standard_help(name).expect("a reserved name").to_string();
        option
    }

    fn report() -> OutputDoc {
        OutputDoc {
            kind: OutputKind::Report,
            schema_ref: "#/schemas/Report".to_string(),
            schema_version: "1.0".to_string(),
            media_type: None,
            event_ref: None,
            batch: false,
            when: None,
            fields: None,
        }
    }

    fn command(name: &str) -> CommandDoc {
        CommandDoc {
            kind: CommandDoc::KIND,
            command: name.to_string(),
            is_async: false,
            path: name.split(' ').map(str::to_string).collect(),
            summary: format!("Do {name}."),
            effect: Effect::Read,
            idempotency: None,
            effect_note: None,
            operands: Vec::new(),
            options: vec![reserved("json")],
            constraints: Vec::new(),
            validators: Vec::new(),
            errors: vec!["USAGE".to_string(), "INTERNAL".to_string()],
            outputs: vec![report()],
            input: None,
            examples: vec![format!("acme {name} --json")],
            schemas: BTreeMap::from([("Report".to_string(), json!({ "type": "object" }))]),
            extensions: BTreeMap::new(),
        }
    }

    fn entry(command: &CommandDoc) -> TreeEntry {
        TreeEntry {
            command: command.command.clone(),
            path: command.path.clone(),
            kind: EntryKind::Command,
            summary: command.summary.clone(),
            effect: Some(command.effect),
            extensions: BTreeMap::new(),
        }
    }

    fn described(commands: Vec<CommandDoc>) -> Result<Described, Error> {
        let entries = commands.iter().map(entry).collect();
        Described::new(Minor::V1_4, "L1", entries, commands)
    }

    fn written(described: &Described, command: &str) -> Value {
        described.command(command).expect("a command").to_value()
    }

    fn listed(document: &Value) -> Vec<Value> {
        document
            .get("options")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }

    #[test]
    fn atip_crate14_19_a_member_at_its_default_is_left_out_and_one_that_differs_is_written() {
        let mut plain = command("plain");
        plain.operands = vec![OperandDoc {
            name: "file-name".to_string(),
            value_name: "FILE_NAME".to_string(),
            value_type: ValueType::String,
            possible_values: None,
            required: false,
            variadic: false,
            default: Value::Null,
            default_note: None,
            domain: None,
            help: "A file.".to_string(),
        }];
        plain.options.push(option("quiet", ValueType::Switch));
        let mut counted = option("verbose", ValueType::Count);
        counted.repeatable = true;
        plain.options.push(counted);
        let mut busy = command("busy");
        busy.is_async = true;
        busy.idempotency = Some(Idempotency::ReplaySafe);
        busy.effect = Effect::Write;
        busy.effect_note = Some("records one run".to_string());
        busy.outputs[0].kind = OutputKind::Stream;
        busy.outputs[0].schema_version = "1.1".to_string();
        busy.outputs[0].media_type = Some("application/x-ndjson".to_string());
        let mut number = option("weight", ValueType::Number);
        number.value_name = Some("W".to_string());
        number.default = json!(1.5);
        number.repeatable = true;
        number.required = true;
        busy.options.push(number);
        let described = described(vec![plain, busy]).expect("a model");
        assert_eq!(
            written(&described, "plain"),
            json!({
                "kind": "command", "command": "plain", "summary": "Do plain.", "effect": "read",
                "operands": [{ "name": "file-name", "help": "A file." }],
                "options": [
                    { "name": "quiet", "valueType": "switch", "help": "The quiet." },
                    { "name": "verbose", "valueType": "count", "help": "The verbose." },
                ],
                "outputs": [{ "schemaRef": "#/schemas/Report" }],
                "examples": ["acme plain --json"],
            })
        );
        assert_eq!(
            written(&described, "busy"),
            json!({
                "kind": "command", "command": "busy", "summary": "Do busy.", "effect": "write",
                "idempotency": "replay-safe", "effectNote": "records one run", "async": true,
                "options": [{ "name": "weight", "valueName": "W", "valueType": "number", "required": true, "repeatable": true, "default": 1.5, "help": "The weight." }],
                "outputs": [{ "kind": "stream", "schemaRef": "#/schemas/Report", "schemaVersion": "1.1", "mediaType": "application/x-ndjson" }],
                "examples": ["acme busy --json"],
            })
        );
    }

    fn feature_command() -> CommandDoc {
        let mut feature = command("feature");
        feature.effect = Effect::Destructive;
        feature.idempotency = Some(Idempotency::Once);
        feature.options.extend([
            reserved("input"),
            reserved("fields"),
            bare("commit"),
            bare("plan-digest"),
            bare("operation"),
            bare("cursor"),
        ]);
        feature.outputs[0].fields = Some(FieldsDoc {
            records: String::new(),
            paths: vec!["a".to_string()],
            keep: Vec::new(),
            default: None,
        });
        feature.input = Some(InputDoc {
            option: "--input",
            schema_ref: "#/schemas/Input".to_string(),
            arguments_ref: None,
            batch: true,
            max_bytes: 1024,
            max_items: Some(5),
            example: json!({}),
        });
        feature.errors.extend(
            [
                "INPUT_INVALID",
                "INPUT_CONFLICT",
                "INPUT_TOO_LARGE",
                "BATCH_INCOMPLETE",
                "PLAN_STALE",
                "OPERATION_REUSED",
                "CURSOR_INVALID",
                "OPTION_INVALID",
                "MEMBER_NOT_FOUND",
                "UNVERIFIABLE",
            ]
            .map(str::to_string),
        );
        feature
    }

    #[test]
    fn atip_crate14_20_the_options_and_codes_a_document_implies_are_not_listed() {
        let described = described(vec![feature_command()])
            .expect("a model")
            .usage_replacements(["OPTION_INVALID"]);
        let document = written(&described, "feature");
        assert_eq!(
            listed(&document),
            [
                json!("commit"),
                json!("plan-digest"),
                json!("operation"),
                json!("cursor")
            ],
            "--json, --input and --fields are implied; --commit and --plan-digest never are"
        );
        assert_eq!(
            document["errors"],
            json!(["MEMBER_NOT_FOUND", "UNVERIFIABLE"]),
            "the implied codes and the registered replacement of USAGE are left out"
        );
        assert_eq!(
            document["input"],
            json!({ "batch": true, "maxBytes": 1024, "maxItems": 5, "example": {} })
        );
        // Without the replacement registered, the code is any other.
        let described = super::tests::described(vec![feature_command()]).expect("a model");
        assert_eq!(
            written(&described, "feature")["errors"],
            json!(["OPTION_INVALID", "MEMBER_NOT_FOUND", "UNVERIFIABLE"])
        );
        // A command without those features lists the codes that are its own: PLAN_STALE without --commit is any other code.
        let mut bare = command("bare");
        bare.errors
            .extend(["PLAN_STALE", "INPUT_INVALID", "CURSOR_INVALID"].map(str::to_string));
        let described = super::tests::described(vec![bare]).expect("a model");
        assert_eq!(
            written(&described, "bare")["errors"],
            json!(["PLAN_STALE", "INPUT_INVALID", "CURSOR_INVALID"])
        );
    }

    #[test]
    fn atip_crate14_21_a_reserved_option_with_the_standard_help_is_its_name_and_one_with_another_help_or_shape_is_an_object(
    ) {
        let mut paged = command("paged");
        let mut limit = reserved("limit");
        limit.value_name = Some("N".to_string());
        limit.default = json!(50);
        limit.domain = Some(json!({ "minimum": 1 }));
        let mut key = reserved("operation");
        key.value_name = Some("KEY".to_string());
        // The standard text with its whitespace changed is still the standard text.
        let mut commit = reserved("commit");
        commit.help = format!(
            "  {}\n",
            standard_help("commit")
                .expect("standard")
                .replace(' ', "  ")
        );
        // `--cursor` and `--all` with another help: the fixed shape plus that help.
        let mut cursor = reserved("cursor");
        cursor.help = "Resume after the last member of the previous page.".to_string();
        let mut all = reserved("all");
        all.help = "Return every member from the cursor on.".to_string();
        paged
            .options
            .extend([limit, cursor, all, key, bare("dry-run"), commit]);
        let described = described(vec![paged]).expect("a model");
        let document = written(&described, "paged");
        assert_eq!(
            listed(&document),
            [
                json!({ "name": "limit", "valueName": "N", "valueType": "integer", "default": 50, "flagOnly": true, "domain": { "minimum": 1 }, "help": "The limit." }),
                json!({ "name": "cursor", "flagOnly": true, "help": "Resume after the last member of the previous page." }),
                json!({ "name": "all", "valueType": "switch", "flagOnly": true, "help": "Return every member from the cursor on." }),
                json!({ "name": "operation", "valueName": "KEY", "help": "The operation." }),
                json!("dry-run"),
                json!("commit"),
            ],
            "the bare name only where the help is the standard text"
        );
        assert!(described.tree().to_value().get("options").is_none());
    }

    #[test]
    fn atip_crate14_21b_a_tool_defines_another_standard_help_once_in_the_tree_and_a_name_that_resolves_there_is_written_in_full(
    ) {
        let mut cursor = reserved("cursor");
        cursor.help = "Resume after the last item.".to_string();
        let described = described(vec![
            with_option("a", cursor.clone()),
            with_option("b", cursor),
        ])
        .expect("a model");
        assert_eq!(
            described.tree().to_value()["options"],
            json!([{ "name": "cursor", "flagOnly": true, "help": "Resume after the last item." }])
        );
        assert_eq!(listed(&written(&described, "a")), [json!("cursor")]);
        // A name that resolves to a tree option is written in full, with the standard text it stands for.
        let mut key = reserved("operation");
        key.value_name = Some("KEY".to_string());
        let described = super::tests::described(vec![
            with_option("a", key.clone()),
            with_option("b", key.clone()),
            with_option("c", bare("operation")),
        ])
        .expect("a model");
        assert_eq!(
            listed(&written(&described, "c")),
            [json!({ "name": "operation", "help": standard_help("operation") })]
        );
        // An option written in full needs a help: an empty one is refused.
        let mut empty = key;
        empty.help = String::new();
        let refused =
            super::tests::described(vec![with_option("a", empty)]).expect_err("a refusal");
        assert_eq!(
            refused,
            Error::OptionWithoutHelp {
                command: "a".to_string(),
                option: "operation".to_string()
            }
        );
    }

    fn with_option(name: &str, option: OptionDoc) -> CommandDoc {
        let mut command = command(name);
        command.options.push(option);
        command
    }

    fn required(name: &str) -> OptionDoc {
        let mut team = option(name, ValueType::String);
        team.required = true;
        team
    }

    #[test]
    fn atip_crate14_22_an_option_with_one_serialization_on_two_commands_moves_to_the_tree() {
        let described = described(vec![
            with_option("a", required("team")),
            with_option("b", option("tag", ValueType::String)),
            with_option("c", option("team", ValueType::String)),
            with_option("d", required("team")),
            with_option("e", option("tag", ValueType::String)),
            with_option("f", option("lonely", ValueType::String)),
        ])
        .expect("a model");
        let tree = described.tree().to_value();
        assert_eq!(
            tree["options"],
            json!([
                { "name": "team", "required": true, "help": "The team." },
                { "name": "tag", "help": "The tag." },
            ]),
            "in the order of first appearance"
        );
        let names = |command: &str| listed(&written(&described, command));
        assert_eq!(names("a"), [json!("team")]);
        assert_eq!(names("b"), [json!("tag")]);
        assert_eq!(
            names("c"),
            [json!({ "name": "team", "help": "The team." })],
            "another definition stays in full"
        );
        assert_eq!(names("d"), [json!("team")]);
        assert_eq!(names("e"), [json!("tag")]);
        assert_eq!(
            names("f"),
            [json!({ "name": "lonely", "help": "The lonely." })],
            "an option on one command stays on it"
        );
    }

    #[test]
    fn atip_crate14_23_one_name_has_one_shared_definition_the_one_on_more_commands_else_the_first()
    {
        let mut other = required("team");
        other.help = "Another team.".to_string();
        let described = described(vec![
            with_option("a", other.clone()),
            with_option("b", other.clone()),
            with_option("c", required("team")),
            with_option("d", required("team")),
            with_option("e", required("team")),
        ])
        .expect("a model");
        assert_eq!(
            described.tree().to_value()["options"],
            json!([{ "name": "team", "required": true, "help": "The team." }]),
            "three commands beat two"
        );
        assert_eq!(
            listed(&written(&described, "a")),
            [json!({ "name": "team", "required": true, "help": "Another team." })]
        );
        // On a tie the first to appear is shared.
        let tied = super::tests::described(vec![
            with_option("a", other.clone()),
            with_option("b", other),
            with_option("c", required("team")),
            with_option("d", required("team")),
        ])
        .expect("a model");
        assert_eq!(
            tied.tree().to_value()["options"],
            json!([{ "name": "team", "required": true, "help": "Another team." }])
        );
        assert_eq!(listed(&written(&tied, "a")), [json!("team")]);
        assert_eq!(
            listed(&written(&tied, "c")),
            [json!({ "name": "team", "required": true, "help": "The team." })]
        );
    }

    #[test]
    fn atip_crate14_24_a_name_that_resolves_to_a_tree_option_is_never_the_reserved_one() {
        let mut key = reserved("operation");
        key.value_name = Some("KEY".to_string());
        let described = described(vec![
            with_option("a", key.clone()),
            with_option("b", key),
            with_option("c", reserved("operation")),
        ])
        .expect("a model");
        assert_eq!(
            described.tree().to_value()["options"],
            json!([{ "name": "operation", "valueName": "KEY", "help": "The operation." }])
        );
        assert_eq!(listed(&written(&described, "a")), [json!("operation")]);
        assert_eq!(
            listed(&written(&described, "c")),
            [json!({ "name": "operation", "help": "The operation." })],
            "the name would resolve to the tree option, so the reserved one is written in full"
        );
    }

    #[test]
    fn atip_crate14_25_the_schemas_answer_holds_what_the_refs_reach_input_and_rejects() {
        let mut run = feature_command();
        run.outputs[0].event_ref = Some("#/schemas/Event".to_string());
        run.input.as_mut().expect("input").arguments_ref = Some("#/schemas/Arguments".to_string());
        run.schemas = BTreeMap::from([
            (
                "Report".to_string(),
                json!({ "type": "object", "properties": { "item": { "$ref": "#/schemas/Item" }, "$ref": { "type": "string" } } }),
            ),
            ("Item".to_string(), json!({ "$ref": "#/schemas/Deep" })),
            ("Deep".to_string(), json!(false)),
            ("Event".to_string(), json!(true)),
            ("Arguments".to_string(), json!({ "type": "object" })),
            ("Unused".to_string(), json!({ "type": "null" })),
            ("Input".to_string(), json!({ "type": "null" })),
        ]);
        run.operands = vec![OperandDoc {
            name: "id".to_string(),
            value_name: "ID".to_string(),
            value_type: ValueType::String,
            possible_values: None,
            required: true,
            variadic: false,
            default: Value::Null,
            default_note: None,
            domain: None,
            help: "An id.".to_string(),
        }];
        run.validators = vec![
            ValidatorDoc {
                arguments: vec!["id".to_string()],
                code: "ID_INVALID".to_string(),
                description: "Refuses some ids.".to_string(),
                rejects: vec!["acme feature a --json".to_string()],
                extensions: BTreeMap::new(),
            },
            ValidatorDoc {
                arguments: vec!["id".to_string()],
                code: "ID_INVALID".to_string(),
                description: "Refuses others.".to_string(),
                rejects: vec![
                    "acme feature b --json".to_string(),
                    "acme feature c --json".to_string(),
                ],
                extensions: BTreeMap::new(),
            },
        ];
        let described = described(vec![run]).expect("a model");
        let answer = described.schemas("feature").expect("an answer").to_value();
        let schemas = answer["schemas"].as_object().expect("schemas");
        assert_eq!(
            schemas.keys().map(String::as_str).collect::<Vec<_>>(),
            ["Arguments", "Deep", "Event", "Input", "Item", "Report"],
            "exactly what the refs reach, and the derived Input; `Unused` and the model's own `Input` are not served"
        );
        assert_eq!(schemas["Deep"], json!(false));
        assert_eq!(
            schemas["Input"]["properties"]["operands"]["maxItems"],
            json!(1)
        );
        assert_eq!(
            answer["rejects"],
            json!([
                ["acme feature a --json"],
                ["acme feature b --json", "acme feature c --json"]
            ])
        );
        assert_eq!(answer["kind"], "schemas");
        assert!(described.schemas("nosuch").is_none());
        let document = written(&described, "feature");
        assert!(document.get("schemas").is_none());
        assert!(document["validators"][0].get("rejects").is_none());
        assert_eq!(document["validators"][1]["code"], "ID_INVALID");
        // Without validators or input the answer has neither.
        let plain = super::tests::described(vec![command("plain")]).expect("a model");
        assert_eq!(
            plain.schemas("plain").expect("an answer").to_value(),
            json!({ "kind": "schemas", "command": "plain", "schemas": { "Report": { "type": "object" } } })
        );
    }

    #[test]
    fn atip_crate14_26_a_model_the_1_4_form_cannot_say_is_refused_when_it_is_built() {
        let build = |commands: Vec<CommandDoc>| super::tests::described(commands).err();
        let mut twice = command("a");
        twice.options.push(option("json", ValueType::Switch));
        assert!(matches!(
            build(vec![twice]),
            Some(Error::DuplicateOption { .. })
        ));
        let mut changed = command("a");
        changed.options[0].value_type = ValueType::String;
        assert!(matches!(
            build(vec![changed]),
            Some(Error::ImpliedOptionChanged { .. })
        ));
        let mut without = command("a");
        without.options.push(reserved("input"));
        assert!(matches!(
            build(vec![without]),
            Some(Error::OptionWithoutFeature { .. })
        ));
        let mut fields = command("a");
        fields.options.push(reserved("fields"));
        assert!(matches!(
            build(vec![fields]),
            Some(Error::OptionWithoutFeature { .. })
        ));
        let mut missing = command("a");
        missing.schemas.clear();
        assert!(matches!(
            build(vec![missing]),
            Some(Error::MissingSchema { .. })
        ));
        let mut bad = command("a");
        bad.outputs[0].schema_ref = "#/$defs/Report".to_string();
        assert!(matches!(build(vec![bad]), Some(Error::BadRef { .. })));
        let mut named = command("a");
        named.outputs[0].schema_ref = "#/schemas/Input".to_string();
        assert!(matches!(
            build(vec![named]),
            Some(Error::InputIsReserved { .. })
        ));
        let mut empty = command("a");
        empty.validators = vec![ValidatorDoc {
            arguments: Vec::new(),
            code: "A_INVALID".to_string(),
            description: "d".to_string(),
            rejects: Vec::new(),
            extensions: BTreeMap::new(),
        }];
        assert!(matches!(
            build(vec![empty]),
            Some(Error::EmptyRejects { .. })
        ));
        assert!(matches!(
            Described::new(
                Minor::V1_4,
                "L1",
                vec![entry(&command("a"))],
                vec![command("a"), command("a")]
            ),
            Err(Error::DuplicateCommand(_))
        ));
        let one = command("a");
        let entries = vec![entry(&one), entry(&one)];
        assert!(matches!(
            Described::new(Minor::V1_4, "L1", entries, vec![one.clone()]),
            Err(Error::DuplicateEntry(_))
        ));
        assert!(matches!(
            Described::new(Minor::V1_4, "L1", vec![entry(&one)], Vec::new()),
            Err(Error::NoCommandDocument(_))
        ));
        // A tool of an earlier minor writes the model as it is, so what only the 1.4 form cannot say is no defect there.
        let mut missing = command("a");
        missing.schemas.clear();
        let described = Described::new(Minor::V1_3, "L1", vec![entry(&missing)], vec![missing])
            .expect("a 1.3 model");
        assert_eq!(described.minor(), Minor::V1_3);
        for error in [
            Error::DuplicateEntry("a".to_string()),
            Error::ImpliedOptionChanged {
                command: "a".to_string(),
                option: "json".to_string(),
            },
        ] {
            assert!(!error.to_string().is_empty());
        }
    }

    #[test]
    fn atip_crate14_27_the_tools_own_members_ride_beside_the_contracts() {
        let mut tool = command("tool");
        tool.extensions
            .insert("x-acme".to_string(), json!({ "needsLogin": false }));
        tool.constraints = vec![ConstraintDoc {
            rule: crate::doc::RuleKind::AtMostOne,
            names: Some(vec!["a".to_string(), "b".to_string()]),
            when: None,
            then: None,
            code: None,
            help: None,
            extensions: BTreeMap::from([("x-acme".to_string(), json!(1))]),
        }];
        let mut entries = vec![entry(&tool)];
        entries[0]
            .extensions
            .insert("x-acme".to_string(), json!("entry"));
        let described = Described::new(Minor::V1_4, "L2", entries, vec![tool])
            .expect("a model")
            .tree_extensions(BTreeMap::from([(
                "x-acme".to_string(),
                json!({ "filtered": true }),
            )]));
        let tree = described.tree().to_value();
        assert_eq!(tree["level"], "L2");
        assert_eq!(tree["x-acme"], json!({ "filtered": true }));
        assert_eq!(tree["commands"][0]["x-acme"], "entry");
        let document = written(&described, "tool");
        assert_eq!(document["x-acme"], json!({ "needsLogin": false }));
        assert_eq!(
            document["constraints"][0],
            json!({ "rule": "atMostOne", "names": ["a", "b"], "x-acme": 1 })
        );
    }

    fn group_model(minor: Minor) -> Described {
        let a = command("tool a");
        let group = TreeEntry {
            command: "tool".to_string(),
            path: vec!["tool".to_string()],
            kind: EntryKind::Group,
            summary: "Tool commands.".to_string(),
            effect: None,
            extensions: BTreeMap::new(),
        };
        Described::new(minor, "L1", vec![group, entry(&a)], vec![a]).expect("a model")
    }

    #[test]
    fn atip_crate14_44_an_implied_option_is_judged_by_its_kind_not_its_placeholder() {
        let mut input = reserved("input");
        input.value_name = Some("JSON|FILE|-".to_string());
        input.help = "A document, a file or - for stdin.".to_string();
        let mut run = feature_command();
        let at = run
            .options
            .iter()
            .position(|option| option.name == "input")
            .expect("input");
        run.options[at] = input;
        let described = described(vec![run]).expect("an implied --input keeps its placeholder");
        assert!(
            !listed(&written(&described, "feature"))
                .iter()
                .any(|option| option == "input" || option["name"] == "input"),
            "an implied option is not listed"
        );
        // The kind is still held: another value type, `required` or a default is a change.
        for change in [
            (|option: &mut OptionDoc| option.value_type = ValueType::Integer) as fn(&mut OptionDoc),
            |option| option.required = true,
            |option| option.default = json!("x"),
            |option| option.flag_only = false,
        ] {
            let mut run = feature_command();
            let at = run
                .options
                .iter()
                .position(|option| option.name == "input")
                .expect("input");
            change(&mut run.options[at]);
            assert!(matches!(
                super::tests::described(vec![run]),
                Err(Error::ImpliedOptionChanged { .. })
            ));
        }
        // A reserved option listed by its bare name is strict: its placeholder reaches the document through the name.
        let mut plan = command("plan");
        let mut digest = reserved("plan-digest");
        digest.value_name = Some("SHA256".to_string());
        plan.options.push(digest);
        let described = super::tests::described(vec![plan]).expect("a model");
        assert_eq!(
            listed(&written(&described, "plan")),
            [
                json!({ "name": "plan-digest", "valueName": "SHA256", "flagOnly": true, "help": "The plan-digest." })
            ]
        );
    }

    #[test]
    fn atip_crate14_45_a_groups_own_extensions_are_written_at_1_3_and_1_4_and_none_by_default() {
        for minor in [Minor::V1_3, Minor::V1_4] {
            let plain = group_model(minor);
            let before = plain.group("tool").expect("a group").to_line();
            assert!(!before.contains("x-"), "{minor}: {before}");
            let described = group_model(minor).group_extensions(
                "tool",
                BTreeMap::from([("x-acme".to_string(), json!({ "area": "ops" }))]),
            );
            let group = described.group("tool").expect("a group").to_value();
            assert_eq!(group["x-acme"], json!({ "area": "ops" }), "{minor}");
            assert_eq!(group["summary"], "Tool commands.", "{minor}");
            assert_eq!(group.get("path").is_some(), minor == Minor::V1_3, "{minor}");
            // An extension of another group, or of none, changes nothing here.
            let other = group_model(minor).group_extensions(
                "elsewhere",
                BTreeMap::from([("x-acme".to_string(), json!(1))]),
            );
            assert_eq!(other.group("tool").expect("a group").to_line(), before);
        }
    }

    #[test]
    fn atip_crate14_46_a_ref_that_reaches_input_through_another_schema_is_refused() {
        let mut nested = command("a");
        nested.schemas.insert(
            "Report".to_string(),
            json!({ "type": "object", "properties": { "args": { "$ref": "#/schemas/Input" } } }),
        );
        nested
            .schemas
            .insert("Input".to_string(), json!({ "type": "object" }));
        assert!(matches!(
            super::tests::described(vec![nested]),
            Err(Error::InputIsReserved { .. })
        ));
        // A schema the model calls `Input` that no ref reaches is not served and not an error.
        let mut unreached = command("a");
        unreached
            .schemas
            .insert("Input".to_string(), json!({ "type": "null" }));
        let described = super::tests::described(vec![unreached]).expect("a model");
        let answer = described.schemas("a").expect("an answer").to_value();
        assert!(answer["schemas"].get("Input").is_none());
    }
}
