//! `--help --json` and `--version --json`, refused (spec 4.4.1, since 1.4).
//!
//! The machine-readable self-description is `schema` (spec 9), never `--help`: in a document that declares 1.4, `--help` with
//! `--json` refuses with `USAGE`, `field` `--help` and the `hint` `<tool> schema <PATH> --json` for the path it named
//! (`<tool> schema --json` at the root), and `--version` with `--json` refuses with `USAGE`, `field` `--version` and the hint
//! `<tool> --version` (every envelope's `meta.toolVersion` carries the version). Both resolve the path first, so a word that is
//! no command still answers `UNKNOWN_COMMAND` with the valid words there (spec 4.4.1, 1.4.2). Earlier minors MAY answer
//! `--help --json` with the `schema` document; a tool that declares one of them does not call these.
//!
//! [`json_request`] reads the flag from argv before clap has parsed it, and [`Request::refusal`] builds the refusal over the
//! tool's `clap::Command`. [`refuse_help`] and [`refuse_version`] are the same refusals for a tool that finds the path words
//! itself (a tool with a global option that takes a value before the command names its words explicitly).

use std::ffi::OsStr;

use clap::Command;

use crate::error::CliError;
use crate::project::{resolve, Resolved, Unknown};
use crate::reserved::reserved_error;
use crate::shell::quote;

/// Which of the text flags was given with `--json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flag {
    /// `--help` or `-h`.
    Help,
    /// `--version` or `-V`.
    Version,
}

/// A call that asks for `--help` or `--version` and `--json`: the flag, and the words of argv that can be the command path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    /// The first of the text flags on argv.
    pub flag: Flag,
    /// The words of argv before `--` that do not start with `-`, in order: the command path, then perhaps operands. Their values
    /// are not read here; the path is what resolves over the tool's tree.
    pub words: Vec<String>,
}

/// The request in `args` (the words after the program name), or `None` when argv does not hold both a text flag (`--help`,
/// `-h`, `--version`, `-V`) and `--json`, before the first `--`. When both text flags are given, the first one wins.
pub fn json_request<I, S>(args: I) -> Option<Request>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut json = false;
    let mut flag = None;
    let mut words = Vec::new();
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" {
            break;
        }
        match arg.to_str() {
            Some("--json") => json = true,
            Some("--help" | "-h") => flag = flag.or(Some(Flag::Help)),
            Some("--version" | "-V") => flag = flag.or(Some(Flag::Version)),
            Some(word) if !word.starts_with('-') => words.push(word.to_string()),
            _ => {}
        }
    }
    flag.filter(|_| json).map(|flag| Request { flag, words })
}

impl Request {
    /// The refusal of this request over the tool `tool` whose command tree is `root`: `UNKNOWN_COMMAND` for a path that does not
    /// resolve, else the `USAGE` refusal of the flag.
    pub fn refusal(&self, root: &Command, tool: &str) -> CliError {
        match self.flag {
            Flag::Help => refuse_help(root, tool, &self.words),
            Flag::Version => refuse_version(root, tool, &self.words),
        }
    }
}

/// The command words of `words`: the longest prefix that resolves over `root`, ending at the first command (what follows a
/// command is its operands). An unresolvable word is the `UNKNOWN_COMMAND` refusal.
fn resolved_path(root: &Command, tool: &str, words: &[String]) -> Result<Vec<String>, CliError> {
    match resolve(root, words) {
        Ok(Resolved::Tree) => Ok(Vec::new()),
        Ok(Resolved::Group(path) | Resolved::Command(path)) => Ok(path),
        // After a command the words are operands, which `--help` never reads.
        Err(unknown) if unknown.expected.is_empty() => Ok(unknown.resolved),
        Err(unknown) => Err(unknown_command(tool, unknown)),
    }
}

/// `schema <PATH> --json` of `tool`: the call that describes the path (the tree at the root).
fn schema_call(tool: &str, path: &[String]) -> String {
    let mut call = format!("{} schema", quote(tool));
    for word in path {
        call.push(' ');
        call.push_str(&quote(word));
    }
    call.push_str(" --json");
    call
}

fn unknown_command(tool: &str, unknown: Unknown) -> CliError {
    let hint = schema_call(tool, &unknown.resolved);
    reserved_error("UNKNOWN_COMMAND", unknown.message())
        .field("command")
        .received(unknown.word)
        .expected(unknown.expected)
        .suggestions(unknown.suggestions)
        .hint(hint)
}

/// `--help --json` over the path `words` (spec 4.4.1): `UNKNOWN_COMMAND` when a word is no command, else `USAGE` with `field`
/// `--help` and the hint `<tool> schema <PATH> --json` for the path the words resolved to.
pub fn refuse_help(root: &Command, tool: &str, words: &[String]) -> CliError {
    match resolved_path(root, tool, words) {
        Ok(path) => {
            let call = schema_call(tool, &path);
            reserved_error(
                "USAGE",
                format!("`--help` prints text for people and has no JSON form; the machine-readable description is `{call}`"),
            )
            .field("--help")
            .hint(call)
        }
        Err(unknown) => unknown,
    }
}

/// `--version --json` over the path `words` (spec 4.4.1, 1.4.2): `UNKNOWN_COMMAND` when a word is no command, else `USAGE`
/// with `field` `--version` and the hint `<tool> --version`.
pub fn refuse_version(root: &Command, tool: &str, words: &[String]) -> CliError {
    match resolved_path(root, tool, words) {
        Ok(_) => {
            let call = format!("{} --version", quote(tool));
            reserved_error(
                "USAGE",
                format!("`--version` prints text for people and has no JSON form; every envelope's `meta.toolVersion` carries the version, and `{call}` prints it"),
            )
            .field("--version")
            .hint(call)
        }
        Err(unknown) => unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool() -> Command {
        Command::new("acme")
            .subcommand(Command::new("build").about("Build"))
            .subcommand(
                Command::new("member")
                    .about("Members")
                    .subcommand(Command::new("list").about("List"))
                    .subcommand(Command::new("show").about("Show")),
            )
            .subcommand(Command::new("schema").about("Describe"))
    }

    fn words(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn atip_crate14_09_the_flag_is_read_with_json_before_the_double_dash_only() {
        let request = |args: &[&str]| json_request(args.iter().copied());
        assert_eq!(
            request(&["member", "list", "--help", "--json"]),
            Some(Request {
                flag: Flag::Help,
                words: words("member list")
            })
        );
        assert_eq!(
            request(&["--json", "-h"]).map(|request| request.flag),
            Some(Flag::Help)
        );
        assert_eq!(
            request(&["-V", "--json"]).map(|request| request.flag),
            Some(Flag::Version)
        );
        assert_eq!(
            request(&["--version", "--help", "--json"]).map(|request| request.flag),
            Some(Flag::Version),
            "the first text flag wins"
        );
        assert_eq!(request(&["--help"]), None, "without --json it is text");
        assert_eq!(request(&["--version"]), None);
        assert_eq!(request(&["member", "--json"]), None, "no text flag");
        assert_eq!(request(&["member", "--", "--help", "--json"]), None);
        assert_eq!(
            request(&["member", "show", "7", "--help", "--json"]).map(|request| request.words),
            Some(words("member show 7")),
            "the words after a command are its operands"
        );
    }

    #[test]
    fn atip_crate14_10_help_json_is_a_usage_refusal_naming_the_schema_of_the_path() {
        let root = tool();
        let error = refuse_help(&root, "acme", &words("member list"));
        assert_eq!(
            (error.code, error.exit, error.retryable),
            ("USAGE", 2, false)
        );
        assert_eq!(error.field_name(), Some("--help"));
        assert_eq!(error.hint_text(), Some("acme schema member list --json"));
        let group = refuse_help(&root, "acme", &words("member"));
        assert_eq!(group.hint_text(), Some("acme schema member --json"));
        let at_root = refuse_help(&root, "acme", &[]);
        assert_eq!(at_root.hint_text(), Some("acme schema --json"));
        let operands = refuse_help(&root, "acme", &words("member show 7 now"));
        assert_eq!(
            operands.hint_text(),
            Some("acme schema member show --json"),
            "operands are not path words"
        );
    }

    #[test]
    fn atip_crate14_11_the_path_is_resolved_first_so_an_unknown_word_is_unknown_command() {
        let root = tool();
        for error in [
            refuse_help(&root, "acme", &words("nosuch-xyz")),
            refuse_version(&root, "acme", &words("nosuch-xyz")),
        ] {
            assert_eq!(
                (error.code, error.exit, error.retryable),
                ("UNKNOWN_COMMAND", 2, false)
            );
            assert_eq!(error.field_name(), Some("command"));
            assert_eq!(error.received_value(), Some("nosuch-xyz"));
            assert_eq!(
                error.expected_values(),
                Some(["build", "member", "schema"].map(String::from).as_slice())
            );
            assert_eq!(error.hint_text(), Some("acme schema --json"));
        }
        let nested = refuse_help(&root, "acme", &words("member lst"));
        assert_eq!(nested.code, "UNKNOWN_COMMAND");
        assert_eq!(nested.suggested(), ["list"]);
        assert_eq!(nested.hint_text(), Some("acme schema member --json"));
    }

    #[test]
    fn atip_crate14_12_version_json_is_a_usage_refusal_whose_hint_is_the_text_flag() {
        let root = tool();
        for path in ["", "member", "member list"] {
            let error = refuse_version(&root, "acme", &words(path));
            assert_eq!(
                (error.code, error.exit, error.retryable),
                ("USAGE", 2, false)
            );
            assert_eq!(error.field_name(), Some("--version"));
            assert_eq!(error.hint_text(), Some("acme --version"));
        }
        let request = json_request(["member", "list", "--version", "--json"]).expect("a request");
        assert_eq!(
            request.refusal(&root, "acme").field_name(),
            Some("--version")
        );
        let unknown = json_request(["nosuch-xyz", "--version", "--json"]).expect("a request");
        assert_eq!(unknown.refusal(&root, "acme").code, "UNKNOWN_COMMAND");
    }

    #[test]
    fn atip_crate14_43_a_refusal_is_a_valid_compact_failure_envelope() {
        let root = tool();
        let refusals = [
            refuse_help(&root, "acme", &words("member list")),
            refuse_version(&root, "acme", &[]),
            refuse_help(&root, "acme", &words("member lst")),
        ];
        for error in refusals {
            let body = error.body_with(
                error.field_name().map(str::to_string),
                error.suggested().to_vec(),
            );
            let envelope = serde_json::json!({
                "ok": false,
                "error": body,
                "meta": { "schemaVersion": "1.0", "tool": "acme", "toolVersion": "1.0.0", "contract": "atip/1", "contractVersion": "1.4" },
            });
            assert_eq!(
                crate::schema::envelope_problems(&envelope),
                Vec::<String>::new(),
                "{}",
                error.code
            );
            let line = crate::envelope::line(&envelope);
            let outside_strings = line
                .split('"')
                .step_by(2)
                .all(|part| !part.contains([' ', '\t', '\r', '\n']));
            assert!(outside_strings, "{line}");
        }
    }
}
