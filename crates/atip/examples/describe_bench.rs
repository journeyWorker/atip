//! The cost of the `schema` answers by the size of a tool: a synthetic clap tree of `N`
//! commands that share `K` options, projected with the crate's own `project` functions and checked with
//! `constraint::document_problems` the way a tool builds its model, then written by [`Described`].
//!
//! ```text
//! cargo run --release -p atip --example describe_bench            # the default grid: N 20/80/320 × K 4/40
//! cargo run --release -p atip --example describe_bench -- 320 40  # one cell
//! ```
//!
//! Each column is the minimum over the repetitions, per call, in microseconds. A tool that builds every document:
//!
//! - `model`: the clap tree projected onto one `CommandDoc` per command, each checked;
//! - `new`: `Described::new` over that model;
//! - `tree`, `command`, `schemas`: the tree line, one command's document line and its schemas answer line, from a
//!   `Described` already built;
//! - `call`: one `schema <COMMAND> --json` call: `model` + `new` + `command`.
//!
//! A tool that builds the document of the command asked for and the [`Surface`] of the others ([`Described::of_models`]):
//!
//! - `surfaces`: the options of every command projected, and the one document built and checked;
//! - `of_models`: `Described::of_models` over them;
//! - `call′`: `surfaces` + `of_models` + `command`.
//!
//! `K` adds shared options to every command. The growth shape to hold: `call′` grows with `N` only by the options every
//! command projects, and the per-command cost stays flat when `K` grows tenfold.

use std::collections::BTreeMap;
use std::hint::black_box;
use std::time::{Duration, Instant};

use clap::{value_parser, Arg, ArgAction, Command};
use serde_json::{json, Value};

use atip::constraint::document_problems;
use atip::describe::standard_help;
use atip::doc::{
    CommandDoc, Effect, EntryKind, InputDoc, OperandDoc, OptionDoc, OutputDoc, OutputKind,
    TreeEntry, ValidatorDoc,
};
use atip::project::{
    add_schema, arguments_schema, flag_only_options, fragment_schema, operand_doc, option_doc,
};
use atip::{Described, Minor, Model, Surface};

const MINOR: Minor = Minor::V1_6;
/// Commands per group.
const GROUP: usize = 8;
/// `$defs` every report schema carries, the same in every command (a tool's shared record types).
const SHARED_DEFS: usize = 6;
/// The domain of every shared option and of the operand: an id, as a tool's table writes it.
const ID_PATTERN: &str = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";

fn reserved(name: &'static str) -> Arg {
    let arg = Arg::new(name)
        .long(name)
        .help(standard_help(name).expect("a reserved name"));
    match name {
        "json" | "all" | "commit" | "dry-run" => arg.action(ArgAction::SetTrue),
        "limit" => arg.value_parser(value_parser!(i64)),
        _ => arg,
    }
}

/// The clap command of command `at`: one operand, the `k` shared options, two of its own, and the reserved options its
/// features bring. Built once per cell: the timings are the crate's and the projection's, not clap's.
fn clap_command(at: usize, k: usize) -> Command {
    let mut cmd = Command::new(format!("c{at}"))
        .about(format!("Do the thing number {at}."))
        .disable_help_flag(true)
        .arg(
            Arg::new("target_id")
                .help("The target to act on.")
                .required(true),
        )
        .arg(reserved("json"));
    for shared in 0..k {
        cmd = cmd.arg(
            Arg::new(format!("shared-{shared}"))
                .long(format!("shared-{shared}"))
                .help(format!(
                    "The shared setting {shared}, which every command reads the same way."
                )),
        );
    }
    cmd = cmd
        .arg(
            Arg::new("label")
                .long("label")
                .action(ArgAction::Append)
                .help(format!("A label of the thing {at}.")),
        )
        .arg(
            Arg::new("depth")
                .long("depth")
                .value_parser(value_parser!(u32))
                .default_value("3")
                .help("How deep to look."),
        );
    if at.is_multiple_of(4) {
        cmd = cmd.arg(reserved("limit")).arg(reserved("cursor"));
    }
    if at % 2 == 1 {
        cmd = cmd.arg(reserved("input"));
    }
    cmd
}

/// The report schema of command `at`, as `schemars` writes one: the record types under `$defs`.
fn report_schema(at: usize) -> Value {
    let mut defs = serde_json::Map::new();
    for def in 0..SHARED_DEFS {
        defs.insert(
            format!("Record{def}"),
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The record's id." },
                    "count": { "type": "integer", "format": "uint32", "minimum": 0 },
                    "next": { "$ref": format!("#/$defs/Record{}", (def + 1) % SHARED_DEFS) },
                },
                "required": ["id", "count"],
            }),
        );
    }
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": format!("C{at}Report"),
        "type": "object",
        "properties": {
            "items": { "type": "array", "items": { "$ref": "#/$defs/Record0" } },
            "total": { "type": "integer" },
        },
        "required": ["items", "total"],
        "$defs": defs,
    })
}

fn group_of(at: usize) -> String {
    format!("g{}", at / GROUP)
}

fn name_of(at: usize) -> String {
    format!("{} c{at}", group_of(at))
}

/// The tree: a group before its commands.
fn entries(n: usize) -> Vec<TreeEntry> {
    let mut entries = Vec::new();
    for at in 0..n {
        let group = group_of(at);
        if at % GROUP == 0 {
            entries.push(TreeEntry {
                command: group.clone(),
                path: vec![group.clone()],
                kind: EntryKind::Group,
                summary: format!("The things of group {group}."),
                effect: None,
                extensions: BTreeMap::new(),
            });
        }
        entries.push(TreeEntry {
            command: name_of(at),
            path: vec![group, format!("c{at}")],
            kind: EntryKind::Command,
            summary: format!("Do the thing number {at}."),
            effect: Some(Effect::Read),
            extensions: BTreeMap::new(),
        });
    }
    entries
}

/// The options of command `at`, projected; a shared option carries the id domain.
fn options_of(name: &str, cmd: &Command) -> Vec<OptionDoc> {
    cmd.get_arguments()
        .filter(|arg| !arg.is_positional())
        .map(|arg| {
            let mut option =
                option_doc(name, arg, &[], flag_only_options(MINOR)).expect("an option");
            if option.name.starts_with("shared-") {
                option.domain = Some(json!({ "pattern": ID_PATTERN }));
            }
            option
        })
        .collect()
}

/// What the layout reads of command `at`: its options, and its `input` (no output declares `fields`).
fn surface(at: usize, cmd: &Command) -> Surface {
    Surface {
        command: name_of(at),
        options: options_of(&name_of(at), cmd),
        input: at % 2 == 1,
        fields: false,
    }
}

/// The whole document of command `at`, checked as a tool checks it.
fn document(at: usize, cmd: &Command) -> CommandDoc {
    let name = name_of(at);
    let operands: Vec<OperandDoc> = cmd
        .get_positionals()
        .map(|arg| {
            let mut operand = operand_doc(&name, arg, &[]).expect("an operand");
            operand.domain = Some(json!({ "pattern": ID_PATTERN }));
            operand
        })
        .collect();
    let options = options_of(&name, cmd);
    let mut schemas = BTreeMap::new();
    let report = format!("C{at}Report");
    add_schema(&mut schemas, &report, report_schema(at)).expect("a schema");
    let mut errors = vec![
        "INTERNAL".to_string(),
        "THING_NOT_FOUND".to_string(),
        "USAGE".to_string(),
    ];
    let input = (at % 2 == 1).then(|| {
        let fragment = format!("C{at}Input");
        let arguments = format!("C{at}Arguments");
        schemas.insert(
            fragment.clone(),
            fragment_schema("input", &operands, &options),
        );
        schemas.insert(
            arguments.clone(),
            arguments_schema("arguments", &operands, &options, &[]),
        );
        errors.extend(["INPUT_CONFLICT", "INPUT_INVALID", "INPUT_TOO_LARGE"].map(str::to_string));
        InputDoc {
            option: "--input",
            schema_ref: format!("#/schemas/{fragment}"),
            arguments_ref: Some(format!("#/schemas/{arguments}")),
            batch: false,
            max_bytes: 1 << 20,
            max_items: None,
            example: json!({ "operands": ["t1"] }),
        }
    });
    if at.is_multiple_of(4) {
        errors.push("CURSOR_INVALID".to_string());
    }
    let validators = if at.is_multiple_of(3) {
        errors.push("THING_LABEL_INVALID".to_string());
        vec![ValidatorDoc {
            arguments: vec!["label".to_string()],
            code: "THING_LABEL_INVALID".to_string(),
            description: "A label names no other thing.".to_string(),
            rejects: vec![format!("tool {name} t1 --label t1 --json")],
            extensions: BTreeMap::new(),
        }]
    } else {
        Vec::new()
    };
    errors.sort();
    let examples = vec![format!("tool {name} t1 --json")];
    let problems = document_problems(
        &options,
        &operands,
        &[],
        &validators,
        &errors,
        &examples,
        MINOR,
    );
    assert!(problems.is_empty(), "{name}: {problems:?}");
    CommandDoc {
        kind: CommandDoc::KIND,
        command: name,
        path: vec![group_of(at), format!("c{at}")],
        summary: format!("Do the thing number {at}."),
        effect: Effect::Read,
        idempotency: None,
        effect_note: None,
        is_async: false,
        operands,
        options,
        constraints: Vec::new(),
        validators,
        errors,
        outputs: vec![OutputDoc {
            kind: OutputKind::Report,
            schema_ref: format!("#/schemas/{report}"),
            schema_version: "1.0".to_string(),
            media_type: None,
            event_ref: None,
            batch: false,
            when: None,
            fields: None,
        }],
        input,
        examples,
        schemas,
        extensions: BTreeMap::new(),
    }
}

/// Every command's whole document.
fn documents(clap: &[Command]) -> Vec<CommandDoc> {
    clap.iter()
        .enumerate()
        .map(|(at, cmd)| document(at, cmd))
        .collect()
}

/// The document of command `asked` and the surfaces of the others, in the model's order.
fn models(clap: &[Command], asked: usize) -> Vec<Model> {
    clap.iter()
        .enumerate()
        .map(|(at, cmd)| {
            if at == asked {
                Model::Document(Box::new(document(at, cmd)))
            } else {
                Model::Surface(surface(at, cmd))
            }
        })
        .collect()
}

/// The minimum time of `run` over `repeats` calls; the input of each call is made by `setup`, and its result dropped,
/// outside the time.
fn fastest<I, T>(
    repeats: usize,
    mut setup: impl FnMut() -> I,
    mut run: impl FnMut(I) -> T,
) -> Duration {
    (0..repeats)
        .map(|_| {
            let input = setup();
            let started = Instant::now();
            let output = black_box(run(input));
            let elapsed = started.elapsed();
            drop(output);
            elapsed
        })
        .min()
        .expect("at least one repeat")
}

fn micros(duration: Duration) -> String {
    format!("{:.1}", duration.as_secs_f64() * 1e6)
}

fn cell(n: usize, k: usize) {
    let repeats = (4000 / n).clamp(10, 200);
    let clap: Vec<Command> = (0..n).map(|at| clap_command(at, k)).collect();
    let tree = entries(n);
    // The command answered: one in the middle of the tree, with `--input` (so its schemas answer derives `Input`).
    let asked = (n / 2) | 1;
    let asked_name = name_of(asked);
    let model = fastest(repeats, || (), |()| documents(&clap));
    let new = fastest(
        repeats,
        || (tree.clone(), documents(&clap)),
        |(tree, documents)| Described::new(MINOR, "L2", tree, documents).expect("a model"),
    );
    let described = Described::new(MINOR, "L2", tree.clone(), documents(&clap)).expect("a model");
    let tree_line = fastest(repeats, || (), |()| described.tree().to_line());
    let command = fastest(
        repeats,
        || (),
        |()| described.command(&asked_name).expect("a command").to_line(),
    );
    let schemas = fastest(
        repeats,
        || (),
        |()| described.schemas(&asked_name).expect("a command").to_line(),
    );
    let surfaces = fastest(repeats, || (), |()| models(&clap, asked));
    let of_models = fastest(
        repeats,
        || (tree.clone(), models(&clap, asked)),
        |(tree, models)| Described::of_models(MINOR, "L2", tree, models).expect("a model"),
    );
    let partial =
        Described::of_models(MINOR, "L2", tree.clone(), models(&clap, asked)).expect("a model");
    for (whole, part) in [
        (described.tree().to_line(), partial.tree().to_line()),
        (
            described.command(&asked_name).expect("a command").to_line(),
            partial.command(&asked_name).expect("a command").to_line(),
        ),
        (
            described.schemas(&asked_name).expect("a command").to_line(),
            partial.schemas(&asked_name).expect("a command").to_line(),
        ),
    ] {
        assert_eq!(
            whole, part,
            "the answers from surfaces are the whole model's"
        );
    }
    println!(
        "| {n} | {k} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
        micros(model),
        micros(new),
        micros(tree_line),
        micros(command),
        micros(schemas),
        micros(model + new + command),
        micros(surfaces),
        micros(of_models),
        micros(surfaces + of_models + command),
    );
}

fn main() {
    let args: Vec<usize> = std::env::args()
        .skip(1)
        .map(|arg| arg.parse().expect("N and K are numbers"))
        .collect();
    let grid: Vec<(usize, usize)> = match args.as_slice() {
        [] => [20, 80, 320]
            .into_iter()
            .flat_map(|n| [4, 40].map(|k| (n, k)))
            .collect(),
        [n, k] => vec![(*n, *k)],
        _ => panic!("usage: describe_bench [N K]"),
    };
    println!("| N | K | model µs | new µs | tree µs | command µs | schemas µs | call µs | surfaces µs | of_models µs | call′ µs |");
    println!("|---|---|---|---|---|---|---|---|---|---|---|");
    for (n, k) in grid {
        cell(n, k);
    }
}
