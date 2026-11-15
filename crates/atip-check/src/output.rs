//! What `atip` prints: the envelope of the contract (spec 6, 7), or the text of a person.
//!
//! The checker follows the contract it checks: it declares [`DECLARED_MINOR`] and the level of its own tree
//! (`crate::spec::LEVEL`). Its error and warning codes and their rows live here, and nothing else decides an exit
//! (spec 7.4.2): a [`Failure`] is built from a [`Code`], whose row gives the exit and `retryable`.

use serde::Serialize;
use serde_json::Value;

use atip::{CodeInfo, Condition, ReasonInfo, WarningInfo};

/// The tool name every envelope and every text error carries.
pub const TOOL: &str = "atip";
/// The version of the report `atip check` prints, and of what a failure of a command other than `schema` would have printed.
pub const SCHEMA_VERSION: &str = "1.0";
/// `meta.contractVersion` of every envelope `atip` prints: the minor the checker itself declares (spec 15.5), and the
/// `meta.schemaVersion` of a `schema` answer (spec 9.1.2). It is the checker's own constant, apart from
/// `atip::CONTRACT_VERSION`, the newest minor the crate implements.
pub const DECLARED_MINOR: &str = "1.6";
/// [`DECLARED_MINOR`] as the crate's value, which the projection of `schema` writes its documents for.
pub const DECLARED: atip::Minor = atip::Minor::V1_6;

/// `atip`'s error registry (spec 7.4), sorted by code: the four core codes it can produce (`USAGE`, `UNKNOWN_COMMAND`,
/// `COMMAND_REQUIRED`, `INTERNAL`) and five of its own, each `<SUBJECT>_<CONDITION>` with the condition's exit and
/// retryability (spec 7.2; [`CodeInfo::of`] does not build a row that breaks that).
pub const REGISTRY: [CodeInfo; 9] = [
    CodeInfo::of(
        "BINARY_INVALID",
        Condition::Invalid,
        "the binary named by --bin does not exist, is not a file, is not executable, or cannot be started",
        "Pass --bin the path of a built, executable binary, or the name of one on PATH.",
        &[],
    ),
    CodeInfo {
        code: "COMMAND_REQUIRED",
        meaning: "atip was run without a command",
        exit: 2,
        retryable: false,
        fix: "Run one of the commands in expected; atip schema --json describes them.",
        reasons: &[],
    },
    CodeInfo::of(
        "FIXTURE_INVALID",
        Condition::Invalid,
        "the fixture file cannot be read, is not JSON, has a member of the wrong shape, or its prepare or setup command failed",
        "Fix the member the message names, or the prepare or setup command, then run atip check again.",
        &FIXTURE_INVALID_REASONS,
    ),
    CodeInfo {
        code: "INTERNAL",
        meaning: "a bug in atip",
        exit: 1,
        retryable: false,
        fix: "Report it at https://github.com/journeyWorker/atip/issues with the command line.",
        reasons: &[],
    },
    CodeInfo::of(
        "LEVEL_FAILED",
        Condition::Failed,
        "a MUST check of the level failed or is unprovided",
        "Read data.checks, fix every check whose result is fail or unprovided, then run atip check again.",
        &[],
    ),
    CodeInfo::of_retryable(
        "SCRATCH_FAILED",
        Condition::Failed,
        true,
        "the checks had started when a copy of the fixture state under TMPDIR could not be made, measured or removed",
        "Free space under TMPDIR, or point TMPDIR at a writable directory, then run atip check again: it writes nothing outside its scratch copies, so a repeat is safe.",
        &[],
    ),
    CodeInfo::of(
        "SCRATCH_UNAVAILABLE",
        Condition::Unavailable,
        "the scratch space under TMPDIR, where atip check builds the fixture state, cannot be used now: it is missing, not writable or full",
        "Free space under TMPDIR, or point TMPDIR at a writable directory, then run atip check again.",
        &[],
    ),
    CodeInfo {
        code: "UNKNOWN_COMMAND",
        meaning: "a command word is not a command of atip",
        exit: 2,
        retryable: false,
        fix: "Use one of the words in expected; atip schema --json lists the commands.",
        reasons: &[],
    },
    CodeInfo {
        code: "USAGE",
        meaning: "the command line does not parse or does not satisfy the command's requirements",
        exit: 2,
        retryable: false,
        fix: "Fix the argument field names; atip schema check --json and atip schema schema --json list every option.",
        reasons: &[],
    },
];

/// The reasons under `FIXTURE_INVALID` (spec 7.6), sorted by name.
pub const FIXTURE_INVALID_REASONS: [ReasonInfo; 5] = [
    ReasonInfo {
        reason: "NOT_JSON",
        meaning: "the fixture file is not JSON",
        fix: "Write the fixture as one JSON object.",
    },
    ReasonInfo {
        reason: "PREPARE_FAILED",
        meaning: "a prepare command of the fixture did not exit 0",
        fix: "Run the prepare command named in the message by hand and fix what it reports.",
    },
    ReasonInfo {
        reason: "SETUP_FAILED",
        meaning: "a setup command of the fixture did not exit 0",
        fix: "Run the setup command named in the message by hand and fix what it reports.",
    },
    ReasonInfo {
        reason: "UNREADABLE",
        meaning: "the fixture file cannot be read",
        fix: "Pass the path of a readable file with --fixture.",
    },
    ReasonInfo {
        reason: "WRONG_SHAPE",
        meaning: "a member of the fixture has the wrong shape or an unknown value",
        fix: "Fix the member the message names.",
    },
];

/// `atip`'s warning registry (spec 7.5.2), sorted by code.
pub const WARNINGS: [WarningInfo; 1] = [WarningInfo {
    code: "SHOULD_FAILED",
    meaning: "a SHOULD check failed: an advisory, which never fails the level",
    fix: "Read data.checks for the checks whose strength is SHOULD and whose result is fail.",
}];

/// The codes `atip` emits, in the order of [`REGISTRY`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    BinaryInvalid,
    CommandRequired,
    FixtureInvalid,
    Internal,
    LevelFailed,
    ScratchFailed,
    ScratchUnavailable,
    UnknownCommand,
    Usage,
}

impl Code {
    /// Every code, in the order of [`REGISTRY`].
    pub const ALL: [Code; 9] = [
        Code::BinaryInvalid,
        Code::CommandRequired,
        Code::FixtureInvalid,
        Code::Internal,
        Code::LevelFailed,
        Code::ScratchFailed,
        Code::ScratchUnavailable,
        Code::UnknownCommand,
        Code::Usage,
    ];

    /// The registry row: the only source of the exit and of `retryable`.
    pub fn info(self) -> &'static CodeInfo {
        &REGISTRY[self as usize]
    }

    /// The code whose registered name is `name`.
    pub fn named(name: &str) -> Option<Code> {
        Code::ALL.into_iter().find(|code| code.info().code == name)
    }
}

/// A refusal or a failure, before it is printed. Its members are on [`FailureBody`], boxed so that a `Result` carrying one stays small.
#[derive(Debug, Clone)]
pub struct Failure(Box<FailureBody>);

impl std::ops::Deref for Failure {
    type Target = FailureBody;

    fn deref(&self) -> &FailureBody {
        &self.0
    }
}

impl std::ops::DerefMut for Failure {
    fn deref_mut(&mut self) -> &mut FailureBody {
        &mut self.0
    }
}

/// The members of a [`Failure`].
#[derive(Debug, Clone)]
pub struct FailureBody {
    pub code: Code,
    pub message: String,
    /// The command resolved so far (`check`, `schema`); `None` when not even the first word resolved.
    pub command: Option<&'static str>,
    pub field: Option<String>,
    pub expected: Vec<String>,
    pub received: Option<String>,
    pub suggestions: Vec<String>,
    pub hint: Option<String>,
    /// Which of the situations registered under the code this is (spec 7.6).
    pub reason: Option<&'static str>,
    /// The partial output of a command that ran (exit 1 only).
    pub data: Option<Value>,
    /// More lines for the text form on stderr, such as the check list; never in the envelope.
    pub detail: Option<String>,
}

impl Failure {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self(Box::new(FailureBody {
            code,
            message: message.into(),
            command: None,
            field: None,
            expected: Vec::new(),
            received: None,
            suggestions: Vec::new(),
            reason: None,
            hint: None,
            data: None,
            detail: None,
        }))
    }

    /// The failure of an error the `atip` crate built (the `--help --json` and `--version --json` refusals), in `command`. A code
    /// the registry lacks is a bug of this build: `INTERNAL`.
    pub fn from_cli(error: &atip::CliError, command: Option<&'static str>) -> Self {
        let Some(code) = Code::named(error.code) else {
            return Failure::new(
                Code::Internal,
                format!("atip hit a bug: the code {} is not registered", error.code),
            );
        };
        let mut failure = Failure::new(code, error.message.clone())
            .expected(error.expected_values().unwrap_or_default().iter().cloned())
            .suggestions(error.suggested().iter().cloned());
        failure.command = command;
        failure.field = error.field_name().map(str::to_string);
        failure.received = error.received_value().map(str::to_string);
        failure.hint = error.hint_text().map(str::to_string);
        failure
    }

    #[must_use]
    pub fn in_command(mut self, command: &'static str) -> Self {
        self.command = Some(command);
        self
    }

    #[must_use]
    pub fn reason(mut self, reason: &'static str) -> Self {
        self.reason = Some(reason);
        self
    }

    #[must_use]
    pub fn field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    #[must_use]
    pub fn expected<I, S>(mut self, expected: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.expected = expected.into_iter().map(Into::into).collect();
        self
    }

    #[must_use]
    pub fn received(mut self, received: impl Into<String>) -> Self {
        self.received = Some(received.into());
        self
    }

    #[must_use]
    pub fn suggestions<I, S>(mut self, suggestions: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.suggestions = suggestions.into_iter().map(Into::into).collect();
        self
    }

    #[must_use]
    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    #[must_use]
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    #[must_use]
    pub fn with_detail(mut self, detail: String) -> Self {
        self.detail = Some(detail);
        self
    }

    /// The process exit: the code's registry row, never chosen here.
    pub fn exit(&self) -> u8 {
        self.code.info().exit
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<&'static str>,
    contract: &'static str,
    contract_version: &'static str,
    schema_version: &'static str,
    tool: &'static str,
    tool_version: &'static str,
    #[serde(skip_serializing_if = "<[MetaWarning]>::is_empty")]
    warnings: Vec<MetaWarning>,
}

#[derive(Serialize)]
struct MetaWarning {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    message: &'a str,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    field: Option<&'a str>,
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    expected: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    received: Option<&'a str>,
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    suggestions: &'a [String],
}

#[derive(Serialize)]
struct Envelope<'a, D: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<&'a D>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody<'a>>,
    meta: Meta,
}

/// The `meta.schemaVersion` of an answer of `command`: the declared minor for `schema` (spec 9.1.2), [`SCHEMA_VERSION`] for
/// `check`, and `1.0` before a command resolved (spec 6.11).
fn schema_version(command: Option<&'static str>) -> &'static str {
    match command.and_then(crate::cli::CommandId::named) {
        Some(id) => crate::spec::output_version(id),
        None => SCHEMA_VERSION,
    }
}

fn meta(command: Option<&'static str>, warnings: Vec<MetaWarning>) -> Meta {
    Meta {
        command,
        contract: atip::schema::CONTRACT,
        contract_version: DECLARED_MINOR,
        schema_version: schema_version(command),
        tool: TOOL,
        tool_version: env!("CARGO_PKG_VERSION"),
        warnings,
    }
}

/// The success envelope of `atip check`: one compact line. `advisories` is how many SHOULD checks failed: more than
/// none is the warning `SHOULD_FAILED`, which does not change the exit.
pub fn success_line(data: &Value, advisories: usize) -> String {
    let warnings = if advisories == 0 {
        Vec::new()
    } else {
        vec![MetaWarning {
            code: WARNINGS[0].code,
            message: format!("{advisories} SHOULD checks failed; the level is still met"),
        }]
    };
    atip::line(&Envelope {
        ok: true,
        data: Some(data),
        error: None,
        meta: meta(Some("check"), warnings),
    })
}

/// The success envelope of an answer of `command` (`schema`, spec 9.1.2; `skills show`, spec 14.1): one compact line whose
/// `data` is `document`.
pub fn answer_line<D: Serialize>(command: crate::cli::CommandId, document: &D) -> String {
    atip::line(&Envelope {
        ok: true,
        data: Some(document),
        error: None,
        meta: meta(Some(command.name()), Vec::new()),
    })
}

/// The failure envelope: one compact line.
pub fn failure_line(failure: &Failure) -> String {
    let error = ErrorBody {
        reason: failure.reason,
        code: failure.code.info().code,
        message: &failure.message,
        retryable: failure.code.info().retryable,
        hint: failure.hint.as_deref(),
        field: failure.field.as_deref(),
        expected: &failure.expected,
        received: failure.received.as_deref(),
        suggestions: &failure.suggestions,
    };
    atip::line(&Envelope {
        ok: false,
        data: failure.data.as_ref(),
        error: Some(error),
        meta: meta(failure.command, Vec::new()),
    })
}

/// The failure as text for stderr (approaches/implementation.md §6), then its `detail` lines.
pub fn failure_text(failure: &Failure) -> String {
    let mut lines = vec![format!(
        "{TOOL}: {}: {}",
        failure.code.info().code,
        failure.message
    )];
    if let Some(reason) = failure.reason {
        lines.push(format!("  reason: {reason}"));
    }
    if let Some(field) = &failure.field {
        lines.push(format!("  field: {field}"));
    }
    if !failure.expected.is_empty() {
        lines.push(format!("  expected: {}", failure.expected.join(", ")));
    }
    if let Some(received) = &failure.received {
        lines.push(format!("  received: {received}"));
    }
    if !failure.suggestions.is_empty() {
        lines.push(format!("  suggestions: {}", failure.suggestions.join(", ")));
    }
    if let Some(hint) = &failure.hint {
        lines.push(format!("  hint: {hint}"));
    }
    if let Some(detail) = &failure.detail {
        lines.extend(detail.lines().map(|line| format!("  {line}")));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::{
        answer_line, failure_line, failure_text, success_line, Code, Failure, REGISTRY, WARNINGS,
    };

    #[test]
    fn atip_check_06_the_registry_is_sorted_and_each_code_reads_its_own_row() {
        assert!(REGISTRY.windows(2).all(|pair| pair[0].code < pair[1].code));
        assert!(WARNINGS.windows(2).all(|pair| pair[0].code < pair[1].code));
        for (code, name, exit, retryable) in [
            (Code::BinaryInvalid, "BINARY_INVALID", 2, false),
            (Code::CommandRequired, "COMMAND_REQUIRED", 2, false),
            (Code::FixtureInvalid, "FIXTURE_INVALID", 2, false),
            (Code::Internal, "INTERNAL", 1, false),
            (Code::LevelFailed, "LEVEL_FAILED", 1, false),
            (Code::ScratchFailed, "SCRATCH_FAILED", 1, true),
            (Code::ScratchUnavailable, "SCRATCH_UNAVAILABLE", 2, true),
            (Code::UnknownCommand, "UNKNOWN_COMMAND", 2, false),
            (Code::Usage, "USAGE", 2, false),
        ] {
            assert_eq!(
                (code.info().code, code.info().exit, code.info().retryable),
                (name, exit, retryable)
            );
            assert_eq!(Failure::new(code, "m").exit(), exit);
            assert_eq!(Code::named(name), Some(code));
        }
        assert_eq!(Code::ALL.len(), REGISTRY.len());
    }

    /// Every code is a core code registered as the contract reserves it, or `<SUBJECT>_<CONDITION>` with the condition's exit
    /// and retryability (spec 7.2).
    #[test]
    fn atip_check_06_every_code_is_core_or_subject_and_condition_with_the_conditions_exit_and_retryability(
    ) {
        for row in REGISTRY {
            assert_eq!(
                atip::code_name_problem(
                    super::DECLARED,
                    row.code,
                    Some(i64::from(row.exit)),
                    Some(row.retryable)
                ),
                None,
                "{}",
                row.code
            );
            assert_eq!(
                atip::registration_problem(
                    super::DECLARED,
                    row.code,
                    Some(i64::from(row.exit)),
                    Some(row.retryable)
                ),
                None,
                "{}",
                row.code
            );
        }
    }

    #[test]
    fn atip_check_03_a_failure_omits_what_it_does_not_have() {
        let line = failure_line(&Failure::new(Code::UnknownCommand, "no such command"));
        assert_eq!(line, r#"{"ok":false,"error":{"code":"UNKNOWN_COMMAND","message":"no such command","retryable":false},"meta":{"contract":"atip/1","contractVersion":"1.6","schemaVersion":"1.0","tool":"atip","toolVersion":""#.to_string() + env!("CARGO_PKG_VERSION") + r#""}}"#);
        let full = failure_line(
            &Failure::new(Code::Usage, "m")
                .in_command("check")
                .field("--bin")
                .expected(["a"])
                .received("b")
                .suggestions(["a"])
                .hint("h"),
        );
        assert!(
            full.contains(r#""command":"check""#)
                && full.contains(r#""field":"--bin""#)
                && full.contains(r#""expected":["a"]"#)
                && full.contains(r#""hint":"h""#),
            "{full}"
        );
        assert!(!full.contains("null") && !full.contains("[]"));
        // A failure of `schema` has the version of what `schema` answers: the declared minor (spec 6.11, 9.1.2).
        let schema = failure_line(&Failure::new(Code::UnknownCommand, "m").in_command("schema"));
        assert!(schema.contains(r#""schemaVersion":"1.6""#), "{schema}");
        let schema_answer = answer_line(
            crate::cli::CommandId::Schema,
            &serde_json::json!({"kind": "tree"}),
        );
        assert!(
            schema_answer.contains(r#""command":"schema","contract":"atip/1","contractVersion":"1.6","schemaVersion":"1.6""#),
            "{schema_answer}"
        );
        let guide = answer_line(crate::cli::CommandId::SkillsShow, &serde_json::json!({}));
        assert!(
            guide.contains(r#""command":"skills show""#)
                && guide.contains(r#""schemaVersion":"1.0""#),
            "{guide}"
        );
    }

    #[test]
    fn atip_check_05_the_text_form_is_code_message_then_the_members_that_exist() {
        let text = failure_text(
            &Failure::new(Code::Usage, "bad")
                .field("--bin")
                .hint("pass it")
                .with_detail("line one\nline two".to_string()),
        );
        assert_eq!(
            text,
            "atip: USAGE: bad\n  field: --bin\n  hint: pass it\n  line one\n  line two"
        );
        assert!(
            success_line(&serde_json::json!({"level": "L0"}), 0).contains(r#""command":"check""#)
        );
        let warned = success_line(&serde_json::json!({"level": "L0"}), 2);
        assert!(
            warned.contains(r#""warnings":[{"code":"SHOULD_FAILED""#),
            "{warned}"
        );
        assert!(warned.contains(r#""contractVersion":"1.6""#));
    }
}
