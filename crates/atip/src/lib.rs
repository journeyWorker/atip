//! `atip`: what a command-line tool shares to speak the atip/1 contract.
//!
//! The crate lives in the atip repository next to the spec and its schemas, and depends on no tool's crate.
//!
//! **Features.** `validate` (off by default) adds the JSON Schema validation of documents and links `jsonschema`: the
//! validators of [`schema`], `fields::projected_problems` and `domain::compile`. A tool that only builds documents and
//! refuses arguments leaves it off; the checker and every test turn it on. `domain::admits` judges a domain without it.
//!
//! - [`error`]: [`CliError`], its builder, [`ErrorBody`], [`redact`], the
//!   error-code row type [`CodeInfo`] and the exit values [`EXIT_FAILED`] and
//!   [`EXIT_REFUSED`]. A tool owns its table of rows; the crate owns the shape.
//! - [`schema`]: the contract's envelope, error and registry-entry JSON
//!   Schemas, embedded from the repository's `schema/` directory, and, with the
//!   feature `validate`, the validators that use them (`envelope_problems`,
//!   `registry_entry_problems`).
//! - [`doc`]: the documents `schema --json` answers with (tree, group, command,
//!   option, operand, output, input), typed in the full form that 1.0 to 1.3 write,
//!   and deriving `JsonSchema`.
//! - [`describe`]: the one serializer of the `schema` answers by the minor a tool declares: [`Described`] takes the typed
//!   model and writes the tree, groups and commands of 1.0 to 1.3 as they are, and for 1.4 the compact form of spec 9 (defaults,
//!   implied options and codes left out, shared options in the tree, reserved options by name) and the schemas answer
//!   (`schema <COMMAND> --schemas --json`).
//! - [`fragment`]: the fragment schema of one `--input` document, derived from the operands and options (spec 9.9.2, 1.4),
//!   which the schemas answer holds as `Input`.
//! - [`help`]: `--help --json` and `--version --json` refused with `USAGE` after the path is resolved (spec 4.4.1, 1.4), and
//!   the argv test that sees them.
//! - [`fields`]: field paths and projection (spec 6.10): the path grammar, the
//!   projection of a record, the `fields` declaration of an output with the checks
//!   spec 10.13 puts on it, and the validation of a projected answer against the
//!   output's schema with `required` reduced.
//! - [`project`]: the generic projection of a clap tree onto those documents:
//!   the tree and its paths, `valueType`, typed defaults, the declared `--input`
//!   fragment schema of 1.0 to 1.3, the schemas a command document carries, and the help
//!   line that points at `schema`. It guesses nothing: a custom value parser
//!   without a table entry fails.
//! - [`argv`]: the JSON-mode flag and the argv test that decides it.
//! - [`envelope`]: a document as one compact line, and printing it.
//! - [`minor`]: [`Minor`], the minors of atip/1 the crate knows (1.0 to 1.4), and
//!   [`CONTRACT_VERSION`], the newest one the crate implements. A tool's own
//!   declaration of its minor is its own constant, not this one.
//! - [`reserved`]: the table of the reserved error codes (name, exit,
//!   retryability, the minors that reserve it: twelve core codes, and `STOPPED_MIDWAY` in a 1.2 document) and the check that a tool
//!   registers one as the contract reserves it.
//! - [`condition`]: the fifteen conditions of the code-name convention (spec 7.2, since 1.3), with their exit and
//!   retryability, `code_name_problem`, the check that a code is a core code or `<SUBJECT>_<CONDITION>`, and
//!   `CodeInfo::of`, which builds a tool's own row from a code and its condition so that exit and retryability are the
//!   condition's.
//! - [`plan`]: the plan of a destructive command (its effects and inputs), its digest (`sha256:` and the SHA-256 of the RFC 8785
//!   text of the plan, [`jcs`]), the preview report and its JSON Schema, the commit gate (`PLAN_STALE`, the two options that
//!   require each other), the commit call a preview's `meta.next` leads with, and the stop of a command part-way through
//!   (`STOPPED_MIDWAY` in a 1.2 document, the tool's own `<SUBJECT>_INCOMPLETE` from 1.3).
//! - [`cursor`]: paging cursors bound to the call that issued them, by the minor a tool declares (1.2, 1.3 and 1.4 bind alike),
//!   and the call that continues a page.
//! - [`shell`]: quoting a word for a `command` string, splitting that string
//!   back into an argv, and telling a runnable one from one that still has a
//!   `<placeholder>`.

pub mod argv;
pub mod condition;
pub mod constraint;
pub mod cursor;
pub mod describe;
pub mod doc;
pub mod domain;
pub mod envelope;
pub mod error;
pub mod fields;
pub mod fragment;
pub mod given;
pub mod help;
pub mod jcs;
mod judge;
pub mod minor;
pub mod plan;
pub mod project;
pub mod reserved;
pub mod schema;
pub mod shell;

pub use argv::{argv_wants_json, json_mode, set_json_mode, wants_json};
pub use condition::{code_name_problem, Condition};
pub use cursor::{next_page_argv, Binding, CursorInvalid, Cursors, CURSOR_INVALID_REASONS};
pub use describe::{Described, Document};
pub use envelope::{line, print_line};
pub use error::{
    count_with_exit, find_code, find_warning, reason_of_code, reasons_with_exit, redact, with_row,
    CliError, CodeInfo, ErrorBody, ReasonInfo, WarningInfo, EXIT_FAILED, EXIT_REFUSED,
};
pub use given::{write_argv, Given};
pub use help::{json_request, refuse_help, refuse_version, Flag, Request};
pub use minor::{Minor, UnknownMinor};
pub use plan::{Effect, Plan, PlanDigest, Preview};
pub use project::{flag_only_options, flag_only_problems};
pub use reserved::{
    registration_problem, reserved_code, reserved_codes, ReservedCode, RESERVED_CODES,
};
#[cfg(feature = "validate")]
pub use schema::{
    envelope_problems, error_problems, guide_problems, registry_entry_problems,
    schema_doc_problems, warning_entry_problems,
};
pub use schema::{
    BATCH_REPORT_SCHEMA, CONTRACT, CONTRACT_VERSION, ENVELOPE_SCHEMA, ERROR_SCHEMA, GUIDE_SCHEMA,
    INPUT_DOCUMENT_SCHEMA, REGISTRY_ENTRY_SCHEMA, SCHEMA_DOC_SCHEMA, STREAM_LINE_SCHEMA,
    WARNING_ENTRY_SCHEMA,
};
pub use shell::{has_placeholder, quote, split_argv};
