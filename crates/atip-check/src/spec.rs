//! `atip schema`: the self-description of `atip` itself (spec 9), at the level [`LEVEL`] and the minor
//! [`crate::output::DECLARED_MINOR`].
//!
//! The syntax comes from the clap tree of [`crate::cli::command`], projected by the `atip` crate (`atip::project`, the
//! constraints by `atip::constraint::clap_rules`); what clap does not know (effect, errors, the output and its schema,
//! examples, computed defaults, domains, validators) comes from [`facts`], an exhaustive match over
//! [`CommandId`], so a command without its facts does not compile. `atip::Described` writes every answer in the 1.6 form,
//! and one call builds the one document it answers with ([`described`] hands the others to `Described::of_models` as their
//! surfaces). [`generate`] is the checked-in `docs/atip.cli.json`, built from every document with `Described::new`; the
//! tests hold the two equal.

use std::collections::BTreeMap;

use atip::constraint::{self, Validator};
use atip::doc::{
    CommandDoc, Effect, EntryKind, OperandDoc, OptionDoc, OutputDoc, OutputKind, TreeEntry,
};
use atip::project::{self, Node};
use atip::{Described, Model, Surface};
use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::{self, CommandId, SchemaArgs};
use crate::output::{self, Code, Failure, DECLARED, DECLARED_MINOR, REGISTRY, TOOL, WARNINGS};

/// The level `atip` claims in its tree (spec 3.5).
pub const LEVEL: &str = "L1";

/// Every environment variable `atip` reads, with what it does (the house CLI guide's ENV-2; a test scans the sources).
pub const ENVIRONMENT: [(&str, &str); 2] = [
    (
        "PATH",
        "atip check looks --bin up on it when --bin is a bare name, and passes it to every program it runs",
    ),
    (
        "TMPDIR",
        "where atip check makes its scratch copies of the fixture state: the system's temporary directory when unset, a relative path taken from the working directory",
    ),
];

/// What clap does not say about a command.
struct Facts {
    effect: Effect,
    effect_note: Option<&'static str>,
    /// The codes the command can end with besides `USAGE` and `INTERNAL`, which every command can.
    errors: &'static [Code],
    examples: &'static [&'static str],
    validators: &'static [Validator],
    /// How a computed default is found, by option name.
    default_notes: &'static [(&'static str, &'static str)],
    /// The domain of an option beyond what its Rust type carries, by option name.
    domains: Vec<(&'static str, Value)>,
}

/// The facts of the command `id`.
fn facts(id: CommandId) -> Facts {
    match id {
        CommandId::Check => Facts {
            effect: Effect::Read,
            effect_note: Some("Runs the binary under test, and the fixture's prepare programs and setup calls, in scratch copies of the fixture state under TMPDIR, and removes the copies before it ends; it writes nothing else."),
            errors: &[
                Code::BinaryInvalid,
                Code::FixtureInvalid,
                Code::LevelFailed,
                Code::ScratchFailed,
                Code::ScratchUnavailable,
            ],
            examples: &["atip check --bin atip --fixture atip.fixture.json --level L0 --json"],
            validators: &[],
            default_notes: &[
                ("level", "the level of the tool's own `schema --json` (`data.level`), and L0 when it prints none"),
                ("contract", "the fixture's contractVersion, and 1.0 when the fixture has none"),
                ("jobs", "half the processors atip may use, at most 4 and at least 1"),
            ],
            domains: vec![("jobs", json!({ "minimum": 1 }))],
        },
        CommandId::Schema => Facts {
            effect: Effect::Read,
            effect_note: None,
            errors: &[Code::UnknownCommand],
            examples: &[
                "atip schema --json",
                "atip schema check --json",
                "atip schema check --schemas --json",
                "atip schema --errors --json",
                "atip schema --error FIXTURE_INVALID --json",
                "atip schema --warnings --json",
                "atip schema --warning SHOULD_FAILED --json",
            ],
            validators: &[Validator {
                arguments: &["schemas", "path"],
                code: "USAGE",
                description: "--schemas answers for one command: path names a command, not nothing (the tree).",
                rejects: &["atip schema --schemas --json"],
            }],
            default_notes: &[],
            domains: Vec::new(),
        },
    }
}

/// The name, the version and the JSON Schema of the one output of `id` (spec 9.9.1).
fn output_of(id: CommandId) -> Result<(&'static str, Value), String> {
    match id {
        CommandId::Check => {
            // A report is only ever serialized, so its schema follows what `Serialize` writes (renames, skipped members).
            let generator = schemars::generate::SchemaSettings::draft2020_12()
                .for_serialize()
                .into_generator();
            let schema =
                serde_json::to_value(generator.into_root_schema_for::<crate::report::Report>())
                    .map_err(|error| format!("the schema of the check report: {error}"))?;
            Ok(("CheckReport", schema))
        }
        CommandId::Schema => Ok(("SchemaAnswer", answer_schema())),
    }
}

/// The `schemaVersion` of the output of `id`: the report's for `check`, the declared minor for `schema` (spec 9.1.2).
pub const fn output_version(id: CommandId) -> &'static str {
    match id {
        CommandId::Check => output::SCHEMA_VERSION,
        CommandId::Schema => DECLARED_MINOR,
    }
}

/// The schema of a `schema` answer: one of the eight documents of spec 9, by `kind`. Each document is the contract's
/// (`schema/schema-doc.schema.json` holds it in full, and the tests hold every answer to it), so a document's members are
/// typed no further here than what tells the kinds apart.
fn answer_schema() -> Value {
    let kind = |kind: &str, members: &[&str]| {
        let mut required = vec!["kind"];
        required.extend_from_slice(members);
        json!({ "type": "object", "properties": { "kind": { "const": kind } }, "required": required })
    };
    json!({
        "title": "SchemaAnswer",
        "description": "One answer of `atip schema`, told apart by `kind`: the tree, a group, a command document, the schemas of a command, the error registry or one entry, the warning registry or one entry (spec 9).",
        "anyOf": [
            kind("tree", &["level", "commands"]),
            kind("group", &["command", "summary", "commands"]),
            kind("command", &["command", "summary", "effect", "outputs", "examples"]),
            kind("schemas", &["command", "schemas"]),
            kind("errors", &["errors"]),
            kind("error", &["error"]),
            kind("warnings", &["warnings"]),
            kind("warning", &["warning"]),
        ],
    })
}

/// The clap tree, built, so that the global `--json` has reached every command.
fn built_root() -> clap::Command {
    let mut root = cli::command();
    root.build();
    root
}

fn node_of<'a>(nodes: &'a [Node<'a>], id: CommandId) -> Result<&'a Node<'a>, String> {
    nodes
        .iter()
        .find(|node| node.command == id.name())
        .ok_or_else(|| format!("`{}` is not in the clap tree", id.name()))
}

fn problem(problem: project::Problem) -> String {
    problem.to_string()
}

/// The operands of `node`, projected.
fn operands_of(node: &Node<'_>) -> Result<Vec<OperandDoc>, String> {
    node.cmd
        .get_positionals()
        .filter(|arg| !project::is_builtin_arg(arg))
        .map(|arg| project::operand_doc(&node.command, arg, &[]).map_err(problem))
        .collect()
}

/// The options of `node`, projected, with the computed defaults and the domains of `facts`. A table row that names no
/// option of the command is a defect of the table.
fn options_of(node: &Node<'_>, facts: &Facts) -> Result<Vec<OptionDoc>, String> {
    let mut options = Vec::new();
    for arg in node
        .cmd
        .get_arguments()
        .filter(|arg| !arg.is_positional() && !project::is_builtin_arg(arg))
    {
        let mut option =
            project::option_doc(&node.command, arg, &[], atip::flag_only_options(DECLARED))
                .map_err(problem)?;
        if let Some((_, note)) = facts
            .default_notes
            .iter()
            .find(|(name, _)| *name == option.name)
        {
            option.default_note = Some((*note).to_string());
        }
        if let Some((_, domain)) = facts.domains.iter().find(|(name, _)| *name == option.name) {
            option.domain = atip::domain::merge(option.domain.take(), Some(domain.clone()))
                .map_err(|reason| {
                    format!(
                        "`{}`: the domain of --{}: {reason}",
                        node.command, option.name
                    )
                })?;
        }
        options.push(option);
    }
    let named = facts
        .default_notes
        .iter()
        .map(|(name, _)| *name)
        .chain(facts.domains.iter().map(|(name, _)| *name));
    for name in named {
        if !options.iter().any(|option| option.name == name) {
            return Err(format!(
                "`{}`: the facts name --{name}, which the command does not have",
                node.command
            ));
        }
    }
    Ok(options)
}

/// The surface of the command `id` (`atip::Surface`): what the tree's shared options need of a command whose document a call
/// does not build. It is `Surface::of` the command's document; a test holds the two equal.
fn surface_of(node: &Node<'_>, id: CommandId) -> Result<Surface, String> {
    Ok(Surface {
        command: node.command.clone(),
        options: options_of(node, &facts(id))?,
        input: false,
        fields: false,
    })
}

/// The document of the command `id`, in the full form `atip::Described` writes every minor from.
fn document_of(node: &Node<'_>, id: CommandId) -> Result<CommandDoc, String> {
    let facts = facts(id);
    let operands = operands_of(node)?;
    let options = options_of(node, &facts)?;
    let (name, schema) = output_of(id)?;
    let mut schemas = BTreeMap::new();
    project::add_schema(&mut schemas, name, schema)?;
    let outputs = vec![OutputDoc {
        kind: OutputKind::Report,
        schema_ref: format!("#/schemas/{name}"),
        schema_version: output_version(id).to_string(),
        media_type: None,
        event_ref: None,
        batch: false,
        when: None,
        fields: None,
    }];
    let constraints = constraint::clap_rules(node.cmd);
    let validators: Vec<_> = facts.validators.iter().map(Validator::doc).collect();
    let mut errors: Vec<String> = facts
        .errors
        .iter()
        .chain(&[Code::Usage, Code::Internal])
        .map(|code| code.info().code.to_string())
        .collect();
    errors.sort();
    errors.dedup();
    let examples: Vec<String> = facts.examples.iter().map(ToString::to_string).collect();
    let problems = constraint::document_problems(
        &options,
        &operands,
        &constraints,
        &validators,
        &errors,
        &examples,
        DECLARED,
    );
    if !problems.is_empty() {
        return Err(format!("`{}`: {}", node.command, problems.join("; ")));
    }
    Ok(CommandDoc {
        kind: CommandDoc::KIND,
        command: node.command.clone(),
        path: node.path.clone(),
        summary: project::summary(node).map_err(problem)?,
        effect: facts.effect,
        idempotency: None,
        effect_note: facts.effect_note.map(str::to_string),
        is_async: false,
        operands,
        options,
        constraints,
        validators,
        errors,
        outputs,
        input: None,
        examples,
        schemas,
        extensions: BTreeMap::new(),
    })
}

/// The tree entries, in the order of the clap tree.
fn entries(nodes: &[Node<'_>]) -> Result<Vec<TreeEntry>, String> {
    CommandId::ALL
        .into_iter()
        .map(|id| {
            let node = node_of(nodes, id)?;
            Ok(TreeEntry {
                command: node.command.clone(),
                path: node.path.clone(),
                kind: EntryKind::Command,
                summary: project::summary(node).map_err(problem)?,
                effect: Some(facts(id).effect),
                extensions: BTreeMap::new(),
            })
        })
        .collect()
}

/// The document of every command, in the order of the tree: what `docs/atip.cli.json` holds.
pub fn documents() -> Result<Vec<CommandDoc>, String> {
    let root = built_root();
    let nodes = project::nodes(&root);
    CommandId::ALL
        .into_iter()
        .map(|id| document_of(node_of(&nodes, id)?, id))
        .collect()
}

/// The self-description built from every document (`Described::new`): what [`generate`] writes.
pub fn described_whole() -> Result<Described, String> {
    let root = built_root();
    let nodes = project::nodes(&root);
    let commands = CommandId::ALL
        .into_iter()
        .map(|id| document_of(node_of(&nodes, id)?, id))
        .collect::<Result<Vec<_>, String>>()?;
    Described::new(DECLARED, LEVEL, entries(&nodes)?, commands).map_err(|error| error.to_string())
}

/// The self-description one call needs: the document of `wanted`, and the surfaces of the other commands
/// (`Described::of_models`). With no command wanted, every command is a surface: the tree needs no more.
pub fn described(wanted: Option<CommandId>) -> Result<Described, String> {
    let root = built_root();
    let nodes = project::nodes(&root);
    let models = CommandId::ALL
        .into_iter()
        .map(|id| {
            let node = node_of(&nodes, id)?;
            Ok(if wanted == Some(id) {
                Model::Document(Box::new(document_of(node, id)?))
            } else {
                Model::Surface(surface_of(node, id)?)
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Described::of_models(DECLARED, LEVEL, entries(&nodes)?, models)
        .map_err(|error| error.to_string())
}

/// One reason of a registry entry (spec 7.6).
#[derive(Debug, Serialize)]
pub struct ReasonRow {
    pub reason: &'static str,
    pub meaning: &'static str,
    pub fix: &'static str,
}

/// One entry of the error registry (`schema/registry-entry.schema.json`).
#[derive(Debug, Serialize)]
pub struct ErrorRow {
    pub code: &'static str,
    pub exit: u8,
    pub retryable: bool,
    pub meaning: &'static str,
    pub fix: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<ReasonRow>,
}

/// One entry of the warning registry (`schema/warning-entry.schema.json`).
#[derive(Debug, Serialize)]
pub struct WarningRow {
    pub code: &'static str,
    pub meaning: &'static str,
    pub fix: &'static str,
}

#[derive(Debug, Serialize)]
struct Errors {
    kind: &'static str,
    errors: Vec<ErrorRow>,
}

#[derive(Debug, Serialize)]
struct ErrorEntry {
    kind: &'static str,
    error: ErrorRow,
}

#[derive(Debug, Serialize)]
struct Warnings {
    kind: &'static str,
    warnings: Vec<WarningRow>,
}

#[derive(Debug, Serialize)]
struct WarningEntry {
    kind: &'static str,
    warning: WarningRow,
}

/// Every error code, sorted by code: `schema --errors` (spec 7.4.3).
pub fn error_rows() -> Vec<ErrorRow> {
    REGISTRY
        .iter()
        .map(|row| ErrorRow {
            code: row.code,
            exit: row.exit,
            retryable: row.retryable,
            meaning: row.meaning,
            fix: row.fix,
            reasons: row
                .reasons
                .iter()
                .map(|reason| ReasonRow {
                    reason: reason.reason,
                    meaning: reason.meaning,
                    fix: reason.fix,
                })
                .collect(),
        })
        .collect()
}

/// Every warning code, sorted by code: `schema --warnings` (spec 7.5.2).
pub fn warning_rows() -> Vec<WarningRow> {
    WARNINGS
        .iter()
        .map(|row| WarningRow {
            code: row.code,
            meaning: row.meaning,
            fix: row.fix,
        })
        .collect()
}

/// The registered codes of `known` that contain `code` or that it contains, case aside: the `suggestions` of an unknown code.
fn near_codes<'a>(code: &str, known: impl Iterator<Item = &'a str>) -> Vec<String> {
    let code = code.to_ascii_uppercase();
    known
        .filter(|known| !code.is_empty() && (known.contains(&code) || code.contains(known)))
        .take(5)
        .map(str::to_string)
        .collect()
}

/// A defect of this build, found while a document was built: `INTERNAL` in `schema`.
fn bug(problem: &str) -> Failure {
    Failure::new(Code::Internal, format!("atip hit a bug: {problem}"))
        .in_command("schema")
        .hint("Report it at https://github.com/journeyWorker/atip/issues with the command line.")
}

/// The answer as `atip` prints it: the envelope in JSON mode, else the document alone on one line (spec 9.1.1).
fn emit<D: Serialize>(document: &D, json: bool) -> String {
    if json {
        output::schema_line(document)
    } else {
        atip::line(document)
    }
}

/// `atip schema`: the tree, a command's document or its schemas, or an entry or the whole of a registry.
pub fn answer(args: &SchemaArgs, json: bool) -> Result<String, Failure> {
    let usage = |message: String, field: &str| {
        Failure::new(Code::Usage, message)
            .in_command("schema")
            .field(field)
    };
    if args.errors {
        return Ok(emit(
            &Errors {
                kind: "errors",
                errors: error_rows(),
            },
            json,
        ));
    }
    if let Some(code) = &args.error {
        let Some(row) = error_rows()
            .into_iter()
            .find(|row| row.code == code.as_str())
        else {
            let refusal = usage(format!("{code} is not an error code of atip"), "--error")
                .received(code.as_str());
            return Err(
                if WARNINGS.iter().any(|warning| warning.code == code.as_str()) {
                    refusal.hint(format!(
                        "{TOOL} schema --warning {} --json",
                        atip::quote(code)
                    ))
                } else {
                    refusal
                        .suggestions(near_codes(code, REGISTRY.iter().map(|row| row.code)))
                        .hint(format!("{TOOL} schema --errors --json"))
                },
            );
        };
        return Ok(emit(
            &ErrorEntry {
                kind: "error",
                error: row,
            },
            json,
        ));
    }
    if args.warnings {
        return Ok(emit(
            &Warnings {
                kind: "warnings",
                warnings: warning_rows(),
            },
            json,
        ));
    }
    if let Some(code) = &args.warning {
        let Some(row) = warning_rows()
            .into_iter()
            .find(|row| row.code == code.as_str())
        else {
            return Err(
                usage(format!("{code} is not a warning code of atip"), "--warning")
                    .received(code.as_str())
                    .suggestions(near_codes(code, WARNINGS.iter().map(|row| row.code)))
                    .hint(format!("{TOOL} schema --warnings --json")),
            );
        };
        return Ok(emit(
            &WarningEntry {
                kind: "warning",
                warning: row,
            },
            json,
        ));
    }
    // `atip schema "check"` and `atip schema check` name one command (spec 9.1.1).
    let words: Vec<String> = args
        .path
        .iter()
        .flat_map(|word| word.split_whitespace())
        .map(str::to_string)
        .collect();
    let root = built_root();
    let resolved = project::resolve(&root, &words).map_err(|unknown| {
        let hint = if unknown.resolved.is_empty() {
            format!("{TOOL} schema --json")
        } else {
            format!("{TOOL} schema {} --json", unknown.resolved.join(" "))
        };
        Failure::new(Code::UnknownCommand, unknown.message())
            .in_command("schema")
            .field("command")
            .received(unknown.word)
            .expected(unknown.expected)
            .suggestions(unknown.suggestions)
            .hint(hint)
    })?;
    match resolved {
        project::Resolved::Tree if args.schemas => Err(usage(
            "--schemas answers for one command, and the call names none".to_string(),
            "--schemas",
        )
        .hint(format!("{TOOL} schema --json"))),
        project::Resolved::Tree => {
            let described = described(None).map_err(|problem| bug(&problem))?;
            Ok(emit(&described.tree(), json))
        }
        project::Resolved::Group(path) => {
            let name = path.join(" ");
            if args.schemas {
                return Err(usage(
                    format!("--schemas answers for one command, and {name} is a group"),
                    "--schemas",
                )
                .hint(format!("{TOOL} schema {name} --json")));
            }
            let described = described(None).map_err(|problem| bug(&problem))?;
            let document = described
                .group(&name)
                .ok_or_else(|| bug(&format!("the group {name} has no document")))?;
            Ok(emit(&document, json))
        }
        project::Resolved::Command(path) => {
            let name = path.join(" ");
            let id = CommandId::named(&name).ok_or_else(|| bug(&format!("{name} has no facts")))?;
            let described = described(Some(id)).map_err(|problem| bug(&problem))?;
            let document = if args.schemas {
                described.schemas(&name)
            } else {
                described.command(&name)
            }
            .ok_or_else(|| bug(&format!("{name} has no document")))?;
            Ok(emit(&document, json))
        }
    }
}

/// The whole spec of `atip`, as `docs/atip.cli.json` holds it: the answers of `schema` (the tree, every command document and
/// every schemas answer), the error and warning registries, the environment variables it reads and the spellings it removed
/// (none: `atip` has never removed one).
pub fn generate() -> Result<Value, String> {
    let described = described_whole()?;
    let documents = documents()?;
    let mut commands = Vec::new();
    let mut schemas = serde_json::Map::new();
    for document in &documents {
        let name = document.command.as_str();
        commands.push(
            described
                .command(name)
                .ok_or_else(|| format!("{name} has no document"))?
                .to_value(),
        );
        schemas.insert(
            name.to_string(),
            described
                .schemas(name)
                .ok_or_else(|| format!("{name} has no schemas answer"))?
                .to_value(),
        );
    }
    let environment: Vec<Value> = ENVIRONMENT
        .iter()
        .map(|(name, about)| json!({ "name": name, "about": about }))
        .collect();
    Ok(json!({
        "_generated": "Generated from the clap tree of crates/atip-check/src/cli.rs and the facts of crates/atip-check/src/spec.rs: do not edit. Regenerate with `ATIP_CHECK_BLESS_CLI_SPEC=1 cargo test -p atip-check --test cli_spec`.",
        "tool": TOOL,
        "contract": atip::schema::CONTRACT,
        "contractVersion": DECLARED_MINOR,
        "level": LEVEL,
        "tree": described.tree().to_value(),
        "commands": commands,
        "schemas": schemas,
        "errors": error_rows(),
        "warnings": warning_rows(),
        "environment": environment,
        "removed": [],
    }))
}

/// [`generate`] as the text of `docs/atip.cli.json`: indented, one trailing newline.
pub fn render() -> Result<String, String> {
    let mut text = serde_json::to_string_pretty(&generate()?)
        .map_err(|error| format!("the spec does not serialize: {error}"))?;
    text.push('\n');
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::{described, described_whole, documents, surface_of, CommandId};

    /// `Described::of_models` answers byte for byte what `Described::new` answers from every document, as long as every surface
    /// is `Surface::of` its document (approaches/rust.md 5).
    #[test]
    fn atip_check_spec_01_one_call_builds_one_document_and_answers_as_the_whole_model() {
        let whole = described_whole().expect("the model");
        let root = super::built_root();
        let nodes = atip::project::nodes(&root);
        for (document, id) in documents().expect("documents").iter().zip(CommandId::ALL) {
            let node = super::node_of(&nodes, id).expect("a node");
            assert_eq!(
                surface_of(node, id).expect("a surface"),
                atip::Surface::of(document),
                "{}",
                id.name()
            );
            let one = described(Some(id)).expect("one document");
            assert_eq!(one.tree().to_line(), whole.tree().to_line());
            for (part, all) in [
                (one.command(id.name()), whole.command(id.name())),
                (one.schemas(id.name()), whole.schemas(id.name())),
            ] {
                assert_eq!(
                    part.expect("an answer").to_line(),
                    all.expect("an answer").to_line()
                );
            }
        }
        assert_eq!(
            described(None).expect("surfaces").tree().to_line(),
            whole.tree().to_line()
        );
    }
}
