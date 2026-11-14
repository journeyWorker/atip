//! `atip`'s command line: `check` and `schema`, parsed by clap.
//!
//! The clap tree of [`command`] is the one description of the syntax: `atip schema` projects it with the `atip` crate
//! (`crate::spec`), and every parse failure is mapped once, here, onto the contract's codes: `UNKNOWN_COMMAND`,
//! `COMMAND_REQUIRED`, or `USAGE` with the argument at fault in `field` (spec 7.1.3, 7.3; Annex S1 item 6).

use std::ffi::OsString;
use std::path::PathBuf;

use clap::builder::PossibleValuesParser;
use clap::error::{ContextKind, ContextValue, ErrorKind};
use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand, ValueEnum};

use crate::claim::MINORS;
use crate::output::{Code, Failure, TOOL};
use crate::report::Mode;

/// The levels the contract defines; each has checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Level {
    #[value(name = "L0")]
    L0,
    #[value(name = "L1")]
    L1,
    #[value(name = "L2")]
    L2,
}

/// The arguments of `atip check`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckArgs {
    pub bin: OsString,
    pub level: Level,
    pub fixture: OsString,
    /// The claimed minor from `--contract`; the fixture's `contractVersion` when absent.
    pub contract: Option<String>,
    /// How many invocations a deep run may have running at once (`--jobs`, at least 1); [`default_jobs`] when absent.
    pub jobs: usize,
}

/// The `--jobs` of a run that gives none: half the processors the checker may use, at most 4, at least 1.
///
/// The invocations run alongside each other are separate processes doing their own work, while the checker's threads
/// mostly wait for them; half the processors leaves the rest to the tool's own threads and to whatever else the machine
/// runs (a run is often one of many on a developer's machine or a shared CI runner). Beyond 4 the gain flattens: what
/// is left is the calls that must run alone and the chains that run in order.
pub fn default_jobs() -> usize {
    std::thread::available_parallelism().map_or(1, |count| (count.get() / 2).clamp(1, 4))
}

/// Where the level of a run comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LevelSource {
    /// `--level` named it.
    Claimed,
    /// `--level` was left out: the level the tool's own `schema --json` declares, and `L0` when it has no schema.
    Tree,
}

/// The arguments of `atip schema`. The path, `--errors`, `--error`, `--warnings` and `--warning` exclude each other, and so do
/// `--schemas` and the four registry options (clap refuses both, spec 9.1.1); that `--schemas` names a command is the
/// validator of `crate::spec`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SchemaArgs {
    /// The command path, as given: each word separately or several in one quoted word.
    pub path: Vec<String>,
    pub schemas: bool,
    pub errors: bool,
    pub error: Option<String>,
    pub warnings: bool,
    pub warning: Option<String>,
}

/// What the command line asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// `--help` or `--version`: text for people, printed as it is.
    Text(String),
    /// A run of the checks: the arguments (with `L0` as the level when [`LevelSource::Tree`] says it is the tool's to give), the mode (`--deep` makes it
    /// [`Mode::Deep`]) and where the level comes from.
    Check(CheckArgs, Mode, LevelSource),
    /// A `schema` answer.
    Schema(SchemaArgs),
    /// `skills show`: the guide named, or the default one.
    Skills(Option<String>),
}

/// The commands of `atip`, by id (spec 4.1): the commands of the tree, which every table keyed by command matches
/// exhaustively, so a command without its facts does not compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandId {
    Check,
    Schema,
    SkillsShow,
}

impl CommandId {
    /// Every command, in the order of the tree.
    pub const ALL: [CommandId; 3] = [CommandId::Check, CommandId::Schema, CommandId::SkillsShow];

    /// The command's id: its words, joined by one space.
    pub const fn name(self) -> &'static str {
        match self {
            CommandId::Check => "check",
            CommandId::Schema => "schema",
            CommandId::SkillsShow => "skills show",
        }
    }

    /// The command whose id is `name`.
    pub fn named(name: &str) -> Option<CommandId> {
        CommandId::ALL.into_iter().find(|id| id.name() == name)
    }
}

/// The groups of `atip`: `skills`, which holds `skills show`.
pub const GROUPS: [&str; 1] = ["skills"];

/// The id of the command or group `path` names, as a string that lives as long as the program.
fn path_id(path: &[String]) -> Option<&'static str> {
    let joined = path.join(" ");
    CommandId::named(&joined)
        .map(CommandId::name)
        .or_else(|| GROUPS.into_iter().find(|group| *group == joined))
}

/// The first line of every `--help`: where an agent reads the machine description and the guide (spec 4.4.2, 4.4.3).
pub const HELP_POINTER: &str =
    "Agents: `atip schema --json` describes every command, option and error code as JSON; `atip skills show` is the guide.";

/// The largest `--jobs`: the largest integer the contract carries (spec 9.7.5).
const MAX_JOBS: u64 = 9_007_199_254_740_991;

const CHECK_USAGE: &str = "atip check --bin <BINARY> --fixture <FILE> [--level <LEVEL>] [--contract <MAJOR.MINOR>] [--deep] [--jobs <JOBS>] [--json]";
const SCHEMA_USAGE: &str =
    "atip schema [PATH]... [--schemas | --errors | --error <CODE> | --warnings | --warning <CODE>] [--json]";
const SKILLS_SHOW_USAGE: &str = "atip skills show [NAME] [--json]";

const CHECK_AFTER_HELP: &str = "Fixture keys of L2:
  commands.<id>.preview        argv arrays that preview a destructive command (no --commit)
  commands.<id>.async          {start, worker, outcomes}: the argv that starts the work, the NAME of the environment variable the tool's test build reads to pick its worker's outcome (the checker sets it to done, failed or timeout), and the outcomes that fake worker supports; a missing outcome leaves L2.async unprovided
  commands.<id>.allowedEffects glob list of the files a successful read may change (a read with an effectNote)
  search                       [{query, expect}]: a question for schema --search and the command it must find among the first five

allowedEffects glob: a path is relative to the working directory (a leading ./ is optional) or to HOME with a ~/ prefix; * matches any run of characters within one path segment (not /), ** matches across segments, ? one character but /, nothing else is special (no classes or braces); the whole path must match. Snapshots count files only: a directory, made to hold a changed file or left empty, is no effect (the file is judged).

Modes:
  default  The interface checks of the level: the envelope, the exit status, error codes and the registry, `next`, the shape of the `schema` document, one document in JSON mode, no prompt. About ten launches of the binary on one shared copy of the fixture state (the calls are read-only by construction). Its verdict reads `interface checks passed`, never that the level is met
  --deep   Every check of the level, each call in a fresh copy of the state: the declarations against the behaviour (walk, constraints, domains, validators, check order, paging, input, batch, effects, destructive, notRun), the grammar probes and the run on a terminal. Hundreds of launches at L1, about a thousand at L2

Every MUST check run passing exits 0, a failed check exits 1 (LEVEL_FAILED), a refusal exits 2.";

const SCHEMA_AFTER_HELP: &str =
    "Without --json the answer is the same JSON document, without its envelope.
schema reads no file, no state and no environment variable, and writes nothing.";

const SKILLS_SHOW_AFTER_HELP: &str = "Without --json the guide is printed as Markdown.
The guides are built into the binary: skills show reads no file and no state, and writes nothing.";

/// `atip`: one tree, `check`, `schema` and `skills show`, and the tool-wide `--json`.
#[derive(Debug, Parser)]
#[command(
    name = "atip",
    version,
    about = "Run a built binary and check the atip/1 contract from outside",
    disable_help_subcommand = true,
    color = clap::ColorChoice::Never,
    override_usage = "atip check --bin <BINARY> --fixture <FILE> [--level <LEVEL>] [--contract <MAJOR.MINOR>] [--deep] [--jobs <JOBS>] [--json]\n       atip schema [PATH]... [--schemas | --errors | --error <CODE> | --warnings | --warning <CODE>] [--json]\n       atip skills show [NAME] [--json]"
)]
struct Cli {
    /// Print one JSON envelope on stdout instead of text
    #[arg(long, global = true, overrides_with = "json", display_order = 100)]
    json: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Run the checks of a level against a built binary
    #[command(override_usage = CHECK_USAGE, after_help = CHECK_AFTER_HELP)]
    Check(CheckOptions),
    /// Describe atip's commands, options and error codes as JSON
    #[command(override_usage = SCHEMA_USAGE, after_help = SCHEMA_AFTER_HELP)]
    Schema(SchemaOptions),
    /// Read the guide built into atip
    #[command(subcommand)]
    Skills(SkillsCommands),
}

#[derive(Debug, Subcommand)]
enum SkillsCommands {
    /// Print a guide: the default one, or the one NAME names
    #[command(override_usage = SKILLS_SHOW_USAGE, after_help = SKILLS_SHOW_AFTER_HELP)]
    Show(SkillsShowOptions),
}

#[derive(Debug, Args)]
struct SkillsShowOptions {
    /// The guide to print; none for the default guide, which lists every guide
    #[arg(value_name = "NAME", value_parser = PossibleValuesParser::new(crate::guides::names()))]
    name: Option<String>,
}

#[derive(Debug, Args)]
struct CheckOptions {
    /// The binary to check: a path, or a name found on PATH
    #[arg(long, value_name = "BINARY")]
    bin: OsString,
    /// The level the tool claims: L0, L1 or L2 (cumulative: L2 also runs the checks of L0 and L1). Defaults to the level of the tool's own `schema --json`, and to L0 when it has none
    #[arg(long, value_name = "LEVEL", hide_possible_values = true)]
    level: Option<Level>,
    /// The tool's fixture file: JSON with contractVersion, prepare, setup, env, timeoutSeconds, probe, globalOptions, registry, warnings, commands (and, in commands, ok, refused, paged, missingValue, fields, domainRejects, batchFailsAt, batchFailsFirst, preview, async and allowedEffects), search and notRun (the ids of commands that do not end on their own, such as a server: each runs once, up to its first JSON document, and is then signalled)
    #[arg(long, value_name = "FILE")]
    fixture: PathBuf,
    /// The contract minor the tool claims: 1.0, 1.1, 1.2, 1.3, 1.4, 1.5 or 1.6. Defaults to the fixture's contractVersion, and to 1.0. When it differs from the minor the fixture declares, it is not refused: the checks run by that minor's rules as a preview. The report says `declared X, checked as Y, not a level claim`, the verdict is `preview` (no level is met or failed), and the failed checks are listed; a failed or unprovided MUST check still exits 1 (LEVEL_FAILED), a preview that passes exits 0
    #[arg(long, value_name = "MAJOR.MINOR", value_parser = PossibleValuesParser::new(MINORS), hide_possible_values = true)]
    contract: Option<String>,
    /// Run every check of the level, not only the interface checks (see Modes)
    #[arg(long, overrides_with = "deep")]
    deep: bool,
    /// How many invocations of a deep run may run at once, each in its own copy of the state: a whole number, at least 1 (1 runs them one after another). Defaults to half the processors, at most 4. Discovery, the calls that continue another call's state, the timed and terminal runs and the notRun commands run alone, and the report is the same whatever the number
    #[arg(long, value_name = "JOBS", value_parser = parse_jobs)]
    jobs: Option<u64>,
}

#[derive(Debug, Args)]
struct SchemaOptions {
    /// The command to describe, as separate words or one quoted string; none for the tree
    #[arg(value_name = "PATH")]
    path: Vec<String>,
    /// The JSON Schemas the command's document refers to, and the rejects of its validators, instead of the document (needs a command path)
    #[arg(long, conflicts_with_all = ["errors", "error", "warnings", "warning"])]
    schemas: bool,
    /// Every error code, with its exit, retryability, meaning, fix and reasons
    #[arg(long, conflicts_with_all = ["path", "error", "warnings", "warning"])]
    errors: bool,
    /// One error code: its exit, retryability, meaning, fix and reasons
    #[arg(long, value_name = "CODE", conflicts_with_all = ["path", "warnings", "warning"])]
    error: Option<String>,
    /// Every warning code, with its meaning and fix
    #[arg(long, conflicts_with_all = ["path", "warning"])]
    warnings: bool,
    /// One warning code: its meaning and fix
    #[arg(long, value_name = "CODE", conflicts_with_all = ["path"])]
    warning: Option<String>,
}

/// `--jobs`: digits only, from 1 to the largest integer the contract carries.
fn parse_jobs(text: &str) -> Result<u64, String> {
    let count = text
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| text.parse::<u64>().ok())
        .flatten();
    match count {
        Some(count) if (1..=MAX_JOBS).contains(&count) => Ok(count),
        _ => Err(format!(
            "{text} is not a number of jobs: a whole number from 1 to {MAX_JOBS}"
        )),
    }
}

/// The clap tree of `atip`, with the first line of every `--help` pointing at `atip schema --json` and `atip skills show`
/// (spec 4.4.2, 4.4.3). Not built: [`crate::spec`] builds it, so that the global `--json` reaches every command.
pub fn command() -> clap::Command {
    atip::project::point_help_at_schema(Cli::command(), HELP_POINTER)
}

/// Parses the arguments after the program name. Every argument is text: one that is not UTF-8 is refused with `USAGE`
/// naming `ARGUMENT`, in the command its preceding words resolve to, before clap reads anything.
pub fn parse(args: &[OsString]) -> Result<Command, Failure> {
    if let Some(at) = args.iter().position(|arg| arg.to_str().is_none()) {
        let mut failure =
            Failure::new(Code::Usage, "an argument is not valid UTF-8").field("ARGUMENT");
        failure.command = path_id(&resolved_path(&args[..at]));
        return Err(failure);
    }
    let argv = std::iter::once(OsString::from(TOOL)).chain(args.iter().cloned());
    let matches = match command().try_get_matches_from(argv) {
        Ok(matches) => matches,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            return Ok(Command::Text(
                error.render().to_string().trim_end().to_string(),
            ))
        }
        Err(error) => return Err(refusal(&error, args)),
    };
    let cli = Cli::from_arg_matches(&matches).map_err(|error| {
        Failure::new(
            Code::Internal,
            format!("atip hit a bug: the parsed arguments do not fit their types: {error}"),
        )
    })?;
    Ok(match cli.command {
        Commands::Check(options) => {
            let source = if options.level.is_some() {
                LevelSource::Claimed
            } else {
                LevelSource::Tree
            };
            let mode = if options.deep {
                Mode::Deep
            } else {
                Mode::Interface
            };
            Command::Check(
                CheckArgs {
                    bin: options.bin,
                    level: options.level.unwrap_or(Level::L0),
                    fixture: options.fixture.into_os_string(),
                    contract: options.contract,
                    jobs: options.jobs.map_or_else(default_jobs, |count| {
                        usize::try_from(count).unwrap_or(usize::MAX)
                    }),
                },
                mode,
                source,
            )
        }
        Commands::Schema(options) => Command::Schema(SchemaArgs {
            path: options.path,
            schemas: options.schemas,
            errors: options.errors,
            error: options.error,
            warnings: options.warnings,
            warning: options.warning,
        }),
        Commands::Skills(SkillsCommands::Show(options)) => Command::Skills(options.name),
    })
}

/// `--help` or `--version` with `--json` (spec 4.4.1): `USAGE` naming the flag, with the hint `atip schema <PATH> --json` or
/// `atip --version`, after the path is resolved, so a word that is no command still answers `UNKNOWN_COMMAND`.
pub fn help_json_refusal(request: &atip::Request) -> Failure {
    let root = command();
    let path = match atip::project::resolve(&root, &request.words) {
        Ok(atip::project::Resolved::Group(path) | atip::project::Resolved::Command(path)) => path,
        Ok(atip::project::Resolved::Tree) => Vec::new(),
        Err(unknown) => unknown.resolved,
    };
    Failure::from_cli(&request.refusal(&root, TOOL), path_id(&path))
}

/// The command or group a failing `args` was in: the words that resolve, when every argument before them is a root option
/// that takes no value. clap reads argv in order and stops at the first argument it refuses, so a refusal before the first
/// word is the root's.
fn resolved_path(args: &[OsString]) -> Vec<String> {
    let root = command();
    let mut path: Vec<String> = Vec::new();
    for arg in args {
        match arg.to_str() {
            Some("--json" | "--help" | "-h" | "--version" | "-V") => {}
            Some(word) if !word.starts_with('-') => {
                path.push(word.to_string());
                match atip::project::resolve(&root, &path) {
                    Ok(atip::project::Resolved::Group(_)) => {}
                    Ok(_) => return path,
                    Err(_) => {
                        path.pop();
                        return path;
                    }
                }
            }
            _ => return path,
        }
    }
    path
}

/// The clap node of the command or group `id` (the root for `None`) in the built tree `root`.
fn node_of<'a>(root: &'a clap::Command, id: Option<&str>) -> Option<&'a clap::Command> {
    let mut node = root;
    for word in id.unwrap_or_default().split_whitespace() {
        node = node.find_subcommand(word)?;
    }
    Some(node)
}

/// The argument name of clap's rendering of an argument: `--bin` of `--bin <BINARY>`, the value name `PATH` of an operand's
/// `[PATH]...`.
fn argument_name(rendered: &str) -> String {
    let first = rendered.split_whitespace().next().unwrap_or_default();
    if first.starts_with('-') {
        first.split('=').next().unwrap_or_default().to_string()
    } else {
        first
            .trim_matches(|c: char| matches!(c, '[' | ']' | '<' | '>' | '.'))
            .to_string()
    }
}

/// Whether the words `args` hold `word` after a `--`: there it is an operand, whatever it looks like.
fn after_dashdash(args: &[OsString], word: &str) -> bool {
    args.iter()
        .position(|arg| arg == "--")
        .is_some_and(|at| args[at + 1..].iter().any(|arg| arg == word))
}

/// The long options of the command `id` (the root's for `None`), each written `--name`.
fn long_options(id: Option<&str>) -> Vec<String> {
    let mut root = command();
    root.build();
    node_of(&root, id).map_or_else(Vec::new, |node| {
        node.get_arguments()
            .filter_map(|arg| arg.get_long().map(|long| format!("--{long}")))
            .collect()
    })
}

/// The first required option of the command `id` that `args` do not give (`--name` or `--name=value`), in declaration order.
fn first_missing_required(id: &str, args: &[OsString]) -> Option<String> {
    let mut root = command();
    root.build();
    let node = node_of(&root, Some(id))?;
    let given = |long: &str| {
        args.iter().any(|arg| {
            arg.to_str().is_some_and(|arg| {
                arg == format!("--{long}") || arg.starts_with(&format!("--{long}="))
            })
        })
    };
    let missing = node
        .get_arguments()
        .filter(|arg| arg.is_required_set())
        .filter_map(|arg| arg.get_long())
        .find(|long| !given(long))
        .map(|long| format!("--{long}"));
    missing
}

/// A clap parse failure as the contract's refusal: the code, the argument at fault (`field`), what was given (`received`, only
/// when the caller sent a value), what would parse (`expected`) and clap's nearest words (`suggestions`).
fn refusal(error: &clap::Error, args: &[OsString]) -> Failure {
    let one = |kind: ContextKind| match error.get(kind) {
        Some(ContextValue::String(value)) => Some(value.clone()),
        Some(ContextValue::Strings(values)) => values.first().cloned(),
        _ => None,
    };
    let all = |kind: ContextKind| match error.get(kind) {
        Some(ContextValue::Strings(values)) => values.clone(),
        Some(ContextValue::String(value)) => vec![value.clone()],
        _ => Vec::new(),
    };
    let path = resolved_path(args);
    let command = path_id(&path);
    // The words a command line may continue with where it stopped: the commands and groups below the path.
    let mut root = self::command();
    root.build();
    let children: Vec<String> = node_of(&root, command)
        .map(|node| {
            atip::project::subcommands(node)
                .into_iter()
                .map(|sub| sub.get_name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let schema_hint = if path.is_empty() {
        format!("{TOOL} schema --json")
    } else {
        format!("{TOOL} schema {} --json", path.join(" "))
    };
    // clap checks each value as it reads it and the required options after, but a missing required argument comes before a value
    // outside its domain (spec 10.7 steps 2-6): a whole number refused by its parser (`--jobs=0`, the one option with a domain) beside
    // a missing option is answered for the option. A value of the wrong type is a parse failure and keeps its place.
    let bad_value = error.kind() == ErrorKind::ValueValidation
        && one(ContextKind::InvalidValue).is_some_and(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        });
    if let Some(missing) = command
        .filter(|_| bad_value)
        .and_then(|id| first_missing_required(id, args))
    {
        let mut failure =
            Failure::new(Code::Usage, format!("the option {missing} is required")).field(missing);
        failure.command = command;
        return failure;
    }
    let rendered = error.render().to_string();
    let message = rendered
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .trim_start_matches("error: ")
        .to_string();
    let mut failure = match error.kind() {
        ErrorKind::InvalidSubcommand => {
            let word = one(ContextKind::InvalidSubcommand).unwrap_or_default();
            // The nearest words as `atip schema` names them for an unknown path (`atip::project::resolve`), not clap's.
            let mut words = path.clone();
            words.push(word.clone());
            let suggestions = atip::project::resolve(&root, &words)
                .err()
                .map(|unknown| unknown.suggestions)
                .unwrap_or_default();
            let mut failure = Failure::new(
                Code::UnknownCommand,
                format!(
                    "{word} is not a command of {}",
                    command.map_or_else(|| TOOL.to_string(), |id| format!("{TOOL} {id}"))
                ),
            )
            .field("command")
            .received(word)
            .expected(children)
            .suggestions(suggestions)
            .hint(schema_hint);
            failure.command = command;
            return failure;
        }
        ErrorKind::MissingSubcommand | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
            let mut failure = Failure::new(
                Code::CommandRequired,
                match command {
                    Some(group) => format!("{TOOL} {group} needs a command"),
                    None => format!("{TOOL} was run without a command"),
                },
            )
            .expected(children)
            .hint(schema_hint);
            failure.command = command;
            return failure;
        }
        ErrorKind::UnknownArgument => {
            let given = one(ContextKind::InvalidArg).unwrap_or_default();
            if given.starts_with('-') && !after_dashdash(args, &given) {
                let name = argument_name(&given);
                Failure::new(
                    Code::Usage,
                    format!(
                        "{name} is not an option of {}",
                        command.map_or_else(|| TOOL.to_string(), |id| format!("{TOOL} {id}"))
                    ),
                )
                .field(name)
                .expected(long_options(command))
                .suggestions(all(ContextKind::SuggestedArg))
            } else {
                Failure::new(
                    Code::Usage,
                    format!(
                        "{} takes no operand, got {given}",
                        command.map_or_else(|| TOOL.to_string(), |id| format!("{TOOL} {id}"))
                    ),
                )
                .field("ARGUMENT")
                .received(given)
            }
        }
        _ => {
            let mut failure = Failure::new(Code::Usage, message);
            if let Some(arg) = one(ContextKind::InvalidArg) {
                let name = argument_name(&arg);
                if error.kind() == ErrorKind::MissingRequiredArgument {
                    failure.message = format!("the option {name} is required");
                }
                failure = failure.field(name);
            }
            // `--schemas` beside a registry option is a refusal of `--schemas` itself (spec 9.1.1), whichever of the two clap
            // names first.
            if error.kind() == ErrorKind::ArgumentConflict
                && command == Some(CommandId::Schema.name())
                && args.iter().any(|arg| arg == "--schemas")
            {
                failure = failure.field("--schemas");
            }
            if let Some(value) = one(ContextKind::InvalidValue) {
                // clap reports an option with no value (`--bin --level`) as an empty value: only a value the caller sent, empty
                // or not, is `received` (spec 7.1.1).
                let sent = !value.is_empty()
                    || failure.field.as_deref().is_some_and(|field| {
                        args.iter().any(|arg| {
                            arg.to_str()
                                .is_some_and(|arg| arg == format!("{field}=").as_str())
                        })
                    });
                if sent {
                    failure = failure.received(value);
                }
            }
            let valid = all(ContextKind::ValidValue);
            let mut suggested = all(ContextKind::SuggestedValue);
            // clap's suggestions miss a value that differs only in case (`l1` for `L1`).
            if suggested.is_empty() {
                if let Some(received) = &failure.received {
                    suggested = valid
                        .iter()
                        .filter(|value| value.eq_ignore_ascii_case(received))
                        .cloned()
                        .collect();
                }
            }
            if !valid.is_empty() {
                failure = failure.expected(valid);
            }
            if !suggested.is_empty() {
                failure = failure.suggestions(suggested);
            }
            failure
        }
    };
    failure.command = command;
    if failure.field.is_none() {
        failure = failure.hint(match command {
            Some(id) => format!("{TOOL} schema {id} --json"),
            None => format!("{TOOL} schema --json"),
        });
    }
    failure
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{
        command, default_jobs, parse, CheckArgs, Command, CommandId, Level, LevelSource, SchemaArgs,
    };
    use crate::output::Code;
    use crate::report::Mode;

    fn args(words: &[&str]) -> Vec<OsString> {
        words.iter().map(OsString::from).collect()
    }

    fn code(words: &[&str]) -> (Code, Option<String>, Option<&'static str>) {
        let failure = parse(&args(words)).expect_err("must be refused");
        (failure.code, failure.field.clone(), failure.command)
    }

    #[test]
    fn atip_check_06_the_command_ids_and_groups_are_the_nodes_of_the_clap_tree() {
        let mut root = command();
        root.build();
        let nodes = atip::project::nodes(&root);
        let commands: Vec<&str> = nodes
            .iter()
            .filter(|node| !node.is_group)
            .map(|node| node.command.as_str())
            .collect();
        let groups: Vec<&str> = nodes
            .iter()
            .filter(|node| node.is_group)
            .map(|node| node.command.as_str())
            .collect();
        assert_eq!(commands, CommandId::ALL.map(CommandId::name));
        assert_eq!(groups, super::GROUPS);
        root.debug_assert();
    }

    /// L1.groups-not-runnable and the unknown word of a group (spec 4.1.2): the group's own words in `expected`.
    #[test]
    fn atip_check_guides_02_skills_is_a_group_and_show_takes_a_known_guide() {
        let failure = parse(&args(&["skills", "--json"])).expect_err("a group");
        assert_eq!(
            (failure.code, failure.command, failure.expected.as_slice()),
            (
                Code::CommandRequired,
                Some("skills"),
                ["show".to_string()].as_slice()
            )
        );
        let failure = parse(&args(&["--json", "skills", "shwo"])).expect_err("unknown");
        assert_eq!(
            (
                failure.code,
                failure.command,
                failure.expected.as_slice(),
                failure.suggestions.as_slice()
            ),
            (
                Code::UnknownCommand,
                Some("skills"),
                ["show".to_string()].as_slice(),
                ["show".to_string()].as_slice()
            )
        );
        let failure =
            parse(&args(&["skills", "show", "nosuch-xyz", "--json"])).expect_err("no guide");
        assert_eq!(
            (
                failure.code,
                failure.field.as_deref(),
                failure.command,
                failure.expected.as_slice()
            ),
            (
                Code::Usage,
                Some("NAME"),
                Some("skills show"),
                ["checker".to_string()].as_slice()
            )
        );
        assert_eq!(
            parse(&args(&["skills", "--json", "show", "checker"])).ok(),
            Some(Command::Skills(Some("checker".to_string())))
        );
        assert_eq!(
            parse(&args(&["skills", "show"])).ok(),
            Some(Command::Skills(None))
        );
    }

    #[test]
    fn atip_check_06_a_complete_check_line_parses_with_either_option_spelling() {
        let expected = Command::Check(
            CheckArgs {
                bin: "target/x".into(),
                level: Level::L0,
                fixture: "f.json".into(),
                contract: None,
                jobs: default_jobs(),
            },
            Mode::Interface,
            LevelSource::Claimed,
        );
        assert_eq!(
            parse(&args(&[
                "check",
                "--bin",
                "target/x",
                "--level",
                "L0",
                "--fixture",
                "f.json"
            ]))
            .ok(),
            Some(expected.clone())
        );
        assert_eq!(
            parse(&args(&[
                "--json",
                "check",
                "--bin=target/x",
                "--fixture=f.json",
                "--level=L0",
                "--json"
            ]))
            .ok(),
            Some(expected)
        );
        assert!(matches!(
            parse(&args(&[
                "check",
                "--level",
                "L2",
                "--bin",
                "b",
                "--fixture",
                "f"
            ]))
            .ok(),
            Some(Command::Check(
                CheckArgs {
                    level: Level::L2,
                    ..
                },
                Mode::Interface,
                LevelSource::Claimed
            ))
        ));
    }

    #[test]
    fn atip_check_deep_20_a_run_without_level_takes_the_level_of_the_tools_own_tree() {
        let source = |words: &[&str]| match parse(&args(words)) {
            Ok(Command::Check(_, _, source)) => source,
            other => panic!("not a check: {other:?}"),
        };
        assert_eq!(
            source(&["check", "--bin", "b", "--fixture", "f"]),
            LevelSource::Tree
        );
        assert_eq!(
            source(&["check", "--bin", "b", "--fixture", "f", "--level", "L1"]),
            LevelSource::Claimed
        );
    }

    #[test]
    fn atip_check_jobs_01_jobs_is_a_whole_number_of_at_least_one_and_defaults_to_half_the_processors_at_most_four(
    ) {
        let line = |extra: &[&str]| {
            let mut words = vec!["check", "--bin", "b", "--fixture", "f", "--deep"];
            words.extend(extra);
            parse(&args(&words))
        };
        let jobs = |extra: &[&str]| match line(extra) {
            Ok(Command::Check(args, _, _)) => args.jobs,
            other => panic!("not a check: {other:?}"),
        };
        assert_eq!(jobs(&["--jobs", "1"]), 1);
        assert_eq!(jobs(&["--jobs=3"]), 3);
        assert_eq!(jobs(&["--jobs=9007199254740991"]), 9_007_199_254_740_991);
        let default = jobs(&[]);
        assert!((1..=4).contains(&default), "{default}");
        assert_eq!(default, default_jobs());
        for bad in ["0", "-1", "+2", "two", "1.5", "", "9007199254740992"] {
            let failure = line(&[&format!("--jobs={bad}")]).expect_err(bad);
            assert_eq!(
                (failure.code, failure.field.as_deref(), failure.command),
                (Code::Usage, Some("--jobs"), Some("check")),
                "{bad}"
            );
        }
        assert_eq!(
            code(&[
                "check",
                "--bin",
                "b",
                "--fixture",
                "f",
                "--jobs",
                "2",
                "--jobs",
                "3"
            ]),
            (Code::Usage, Some("--jobs".to_string()), Some("check"))
        );
    }

    #[test]
    fn atip_check_deep_01_deep_is_a_flag_that_makes_the_run_deep_and_takes_no_value() {
        fn line<'a>(extra: &[&'a str]) -> Vec<&'a str> {
            let mut words = vec!["check", "--bin", "b", "--level", "L1", "--fixture", "f"];
            words.extend(extra);
            words
        }
        let mode = |extra: &[&str]| match parse(&args(&line(extra))) {
            Ok(Command::Check(_, mode, _)) => mode,
            other => panic!("not a check: {other:?}"),
        };
        assert_eq!(mode(&[]), Mode::Interface);
        assert_eq!(mode(&["--deep"]), Mode::Deep);
        // A flag given twice means what it means once, as before 0.4.0.
        assert_eq!(mode(&["--deep", "--deep", "--json", "--json"]), Mode::Deep);
        assert_eq!(
            code(&line(&["--deep=1"])),
            (Code::Usage, Some("--deep".to_string()), Some("check"))
        );
        let failure = parse(&args(&line(&["--deeep"]))).expect_err("unknown");
        assert_eq!(
            (failure.field.as_deref(), failure.suggestions.as_slice()),
            (Some("--deeep"), ["--deep".to_string()].as_slice())
        );
    }

    #[test]
    fn atip_check_06_the_root_answers_a_missing_or_unknown_command_with_its_own_code() {
        assert_eq!(code(&[]), (Code::CommandRequired, None, None));
        assert_eq!(code(&["--json"]), (Code::CommandRequired, None, None));
        assert_eq!(
            code(&["nosuch-xyz", "--json"]),
            (Code::UnknownCommand, Some("command".to_string()), None)
        );
        assert_eq!(
            code(&["--bogus", "check"]),
            (Code::Usage, Some("--bogus".to_string()), None)
        );
        assert!(
            matches!(parse(&args(&["--version"])), Ok(Command::Text(text)) if text == format!("atip {}", env!("CARGO_PKG_VERSION")))
        );
        for help in [
            &["-h"][..],
            &["--help"],
            &["check", "--help"],
            &["schema", "-h"],
            &["skills", "--help"],
            &["skills", "show", "-h"],
        ] {
            match parse(&args(help)) {
                Ok(Command::Text(text)) => {
                    assert!(text.starts_with(super::HELP_POINTER), "{help:?}: {text}");
                }
                other => panic!("{help:?}: not help: {other:?}"),
            }
        }
        let failure = parse(&args(&["chekc"])).expect_err("unknown");
        assert_eq!(
            (failure.expected.as_slice(), failure.suggestions.as_slice()),
            (
                [
                    "check".to_string(),
                    "schema".to_string(),
                    "skills".to_string()
                ]
                .as_slice(),
                ["check".to_string()].as_slice()
            )
        );
    }

    #[test]
    fn atip_check_06_a_malformed_check_line_is_a_usage_error_naming_the_argument() {
        assert_eq!(
            code(&["check", "--bogus-xyz", "--json"]),
            (Code::Usage, Some("--bogus-xyz".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--json", "--bogus-xyz"]),
            (Code::Usage, Some("--bogus-xyz".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--level", "L0", "--fixture", "f"]),
            (Code::Usage, Some("--bin".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--bin"]),
            (Code::Usage, Some("--bin".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--bin", "--level"]),
            (Code::Usage, Some("--bin".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--bin", "a", "--bin", "b"]),
            (Code::Usage, Some("--bin".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--bin", "a", "--level", "L9", "--fixture", "f"]),
            (Code::Usage, Some("--level".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "--", "--json"]),
            (Code::Usage, Some("ARGUMENT".to_string()), Some("check"))
        );
        assert_eq!(
            code(&["check", "stray"]),
            (Code::Usage, Some("ARGUMENT".to_string()), Some("check"))
        );
        let level = parse(&args(&[
            "check",
            "--bin",
            "a",
            "--level",
            "l1",
            "--fixture",
            "f",
        ]))
        .expect_err("lower case is not a level");
        assert_eq!(level.suggestions, ["L1"]);
        assert_eq!(level.expected, ["L0", "L1", "L2"]);
        assert_eq!(level.received.as_deref(), Some("l1"));
    }

    #[test]
    fn atip_check_06_schema_takes_a_path_or_one_registry_option() {
        assert_eq!(
            parse(&args(&["schema", "check", "--schemas", "--json"])).ok(),
            Some(Command::Schema(SchemaArgs {
                path: vec!["check".to_string()],
                schemas: true,
                ..SchemaArgs::default()
            }))
        );
        for (words, field) in [
            (&["schema", "--errors", "--error", "USAGE"][..], "--errors"),
            (&["schema", "check", "--errors"], "--errors"),
            (&["schema", "--error"], "--error"),
        ] {
            let (code, given, command) = code(words);
            assert_eq!((code, command), (Code::Usage, Some("schema")), "{words:?}");
            assert!(
                given
                    .as_deref()
                    .is_some_and(|given| given.starts_with("--") || given == "PATH"),
                "{words:?}: {given:?} (wanted something like {field})"
            );
        }
        // `--schemas` with a registry option names `--schemas`, in either order (spec 9.1.1).
        for words in [
            &["schema", "check", "--schemas", "--errors"][..],
            &["schema", "--errors", "--schemas"],
            &["schema", "--warnings", "--schemas"],
        ] {
            assert_eq!(
                code(words),
                (Code::Usage, Some("--schemas".to_string()), Some("schema")),
                "{words:?}"
            );
        }
    }

    #[test]
    fn atip_check_06_an_argument_that_is_not_utf8_is_refused_naming_argument() {
        use std::os::unix::ffi::OsStringExt;
        let bad = OsString::from_vec(vec![b'b', 0xff]);
        for words in [
            vec![
                OsString::from("check"),
                "--bin".into(),
                bad.clone(),
                "--fixture".into(),
                "f".into(),
            ],
            vec![
                OsString::from("check"),
                "--bin".into(),
                "b".into(),
                "--fixture".into(),
                bad.clone(),
            ],
        ] {
            let failure = parse(&words).expect_err("not UTF-8");
            assert_eq!(
                (failure.code, failure.field.as_deref(), failure.command),
                (Code::Usage, Some("ARGUMENT"), Some("check"))
            );
        }
    }
}
