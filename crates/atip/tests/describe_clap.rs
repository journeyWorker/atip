//! The 1.4 writer over a clap tree: a reserved option whose clap help is the standard text (whitespace aside) is listed by its
//! bare name, and one with another help is an object: the fixed shape plus that help. A tool that wants another standard text
//! defines the option once in the tree.

use std::collections::BTreeMap;

use clap::{Arg, ArgAction, Command};
use serde_json::{json, Value};

use atip::describe::standard_help;
use atip::doc::{CommandDoc, Effect, EntryKind, OptionDoc, OutputDoc, OutputKind, TreeEntry};
use atip::project::option_doc;
use atip::{Described, Minor};

/// A command named `name` with the clap `args`, projected with the crate's own `option_doc`.
fn command_of(name: &'static str, args: Vec<Arg>) -> CommandDoc {
    let cmd = Command::new(name)
        .about("Do it.")
        .args(args)
        .disable_help_flag(true);
    let options: Vec<OptionDoc> = cmd
        .get_arguments()
        .map(|arg| option_doc(name, arg, &[], &["commit", "cursor", "limit"]).expect("an option"))
        .collect();
    CommandDoc {
        kind: CommandDoc::KIND,
        command: name.to_string(),
        path: vec![name.to_string()],
        summary: "Do it.".to_string(),
        effect: Effect::Read,
        idempotency: None,
        effect_note: None,
        is_async: false,
        operands: Vec::new(),
        options,
        constraints: Vec::new(),
        validators: Vec::new(),
        errors: vec!["USAGE".to_string(), "INTERNAL".to_string()],
        outputs: vec![OutputDoc {
            kind: OutputKind::Report,
            schema_ref: "#/schemas/Report".to_string(),
            schema_version: "1.0".to_string(),
            media_type: None,
            event_ref: None,
            batch: false,
            when: None,
            fields: None,
        }],
        input: None,
        examples: vec![format!("tool {name} --json")],
        schemas: BTreeMap::from([("Report".to_string(), json!({ "type": "object" }))]),
        extensions: BTreeMap::new(),
    }
}

fn described(commands: Vec<CommandDoc>) -> Described {
    let entries = commands
        .iter()
        .map(|command| TreeEntry {
            command: command.command.clone(),
            path: command.path.clone(),
            kind: EntryKind::Command,
            summary: command.summary.clone(),
            effect: Some(command.effect),
            extensions: BTreeMap::new(),
        })
        .collect();
    Described::new(Minor::V1_4, "L1", entries, commands).expect("a model")
}

fn flag(name: &'static str, help: String) -> Arg {
    Arg::new(name)
        .long(name)
        .action(ArgAction::SetTrue)
        .help(help)
}

fn listed(described: &Described, command: &str) -> Vec<Value> {
    let document = described.command(command).expect("a command").to_value();
    document["options"].as_array().cloned().unwrap_or_default()
}

#[test]
fn atip_crate_clap_standard_help_is_the_bare_name_and_another_help_is_an_object() {
    let standard = standard_help("commit").expect("standard").to_string();
    let spread = format!("  {}\n", standard.replace(' ', "   "));
    let described = described(vec![
        command_of(
            "run",
            vec![
                flag("commit", spread),
                Arg::new("cursor")
                    .long("cursor")
                    .value_name("CURSOR")
                    .help("Resume after the last run of the previous page"),
                Arg::new("limit")
                    .long("limit")
                    .value_name("LIMIT")
                    .value_parser(clap::value_parser!(i64))
                    .help(standard_help("limit").expect("standard")),
            ],
        ),
        command_of("stop", vec![flag("commit", standard)]),
    ]);
    assert_eq!(
        listed(&described, "run"),
        [
            json!("commit"),
            json!({ "name": "cursor", "flagOnly": true, "help": "Resume after the last run of the previous page" }),
            json!("limit"),
        ]
    );
    assert_eq!(listed(&described, "stop"), [json!("commit")]);
    assert!(described.tree().to_value().get("options").is_none());
}

#[test]
fn atip_crate_clap_a_tool_defines_its_own_standard_text_once_in_the_tree() {
    let own = "Make the change for real; without it, a preview.";
    let described = described(vec![
        command_of("run", vec![flag("commit", own.to_string())]),
        command_of("stop", vec![flag("commit", own.to_string())]),
    ]);
    assert_eq!(
        described.tree().to_value()["options"],
        json!([{ "name": "commit", "flagOnly": true, "valueType": "switch", "help": own }])
    );
    assert_eq!(listed(&described, "run"), [json!("commit")]);
    assert_eq!(listed(&described, "stop"), [json!("commit")]);
}
