//! One run of `atip`: parse, check, print, exit.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use crate::checks::{run_checks, Judged, Mutation};
use crate::claim::Claim;
use crate::cli::{self, CheckArgs, Command, Level, LevelSource};
use crate::exec::{Call, RunError, Runner};
use crate::fixture;
use crate::output::{failure_line, failure_text, success_line, Code, Failure};
use crate::platform;
use crate::report::{Mode, Report};
use crate::spec;

/// Runs `atip` with `args` (the words after the program name) and returns its exit status: 0, 1 or 2.
pub fn main(args: &[OsString]) -> ExitCode {
    let json = atip::wants_json(args);
    // A panic prints nothing of its own: in JSON mode stderr stays empty, and the failure below says what happened.
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = std::panic::catch_unwind(|| execute(args))
        .unwrap_or_else(|payload| Err(internal(&payload)));
    // Every call of the run is over: only now does a closed stdout end the process by signal (spec 8.4).
    platform::restore_sigpipe();
    match outcome {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(failure) => {
            if json {
                println!("{}", failure_line(&failure));
            } else {
                eprintln!("{}", failure_text(&failure));
            }
            ExitCode::from(failure.exit())
        }
    }
}

fn internal(payload: &Box<dyn std::any::Any + Send>) -> Failure {
    let text = payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic with no message".to_string());
    Failure::new(Code::Internal, format!("atip hit a bug: {text}"))
        .hint("Report it at https://github.com/journeyWorker/atip/issues with the command line.")
}

/// The text a successful run prints on stdout: the version, a help text, a `schema` answer, a guide, the report, or the success envelope.
fn execute(args: &[OsString]) -> Result<String, Failure> {
    let json = atip::wants_json(args);
    // `--help` and `--version` print text for people; with `--json` they are refused after the path is resolved (spec 4.4.1), so
    // that JSON mode always prints an envelope and `schema` is the one machine-readable description.
    if let Some(request) = atip::json_request(args) {
        return Err(cli::help_json_refusal(&request));
    }
    match cli::parse(args)? {
        Command::Text(text) => Ok(text),
        Command::Skills(name) => crate::guides::answer(name.as_deref(), json),
        Command::Schema(schema) => spec::answer(&schema, json),
        Command::Check(check, mode, source) => {
            let report = check_binary_at(&check, mode, source)?;
            // A run with a failed or unprovided MUST check is a negative answer, exit 1 (spec 8.1), a preview too: a preview has no level verdict
            // and says so (`not a level claim`), but its answer to "does this pass as that minor" is still no. Only a passing preview exits 0, and
            // the warning that the level is still met is not its to give.
            if !report.passed {
                return Err(level_not_met(&report).unwrap_or_else(|failure| failure));
            }
            Ok(if json {
                success_line(
                    &serde_json::to_value(&report).map_err(internal_error)?,
                    if report.is_preview() {
                        0
                    } else {
                        report.advisories()
                    },
                )
            } else {
                report.text()
            })
        }
    }
}

fn internal_error(error: impl std::fmt::Display) -> Failure {
    Failure::new(Code::Internal, format!("atip hit a bug: {error}"))
        .hint("Report it at https://github.com/journeyWorker/atip/issues with the command line.")
}

/// The failed level (in interface mode, the failed interface checks; in a preview, the failed checks of the minor previewed, with the statement that it is
/// not a level claim): exit 1 with the check list in `data`; in text mode the same list follows the error line on stderr.
fn level_not_met(report: &Report) -> Result<Failure, Failure> {
    let blocking: Vec<&str> = report
        .checks
        .iter()
        .filter(|check| check.blocks_level())
        .map(|check| check.id)
        .collect();
    let data = serde_json::to_value(report).map_err(internal_error)?;
    let verdict = match (&report.statement, report.mode) {
        (Some(statement), _) => statement.clone(),
        (None, Mode::Deep) => format!("{} is not met", report.level),
        (None, Mode::Interface) => format!("the interface checks of {} failed", report.level),
    };
    Ok(Failure::new(Code::LevelFailed, format!("{verdict}: {} MUST checks fail or are unprovided ({})", blocking.len(), blocking.join(", ")))
        .in_command("check")
        .hint("Fix every check whose result is fail or unprovided in data.checks, then run atip check again.")
        .with_data(data)
        .with_detail(report.text()))
}

/// Runs the checks of the claimed level against the binary: the interface checks, or with [`Mode::Deep`] every check of the level.
pub fn check_binary(args: &CheckArgs, mode: Mode) -> Result<Report, Failure> {
    check_binary_at(args, mode, LevelSource::Claimed)
}

/// Like [`check_binary`], at the level `source` says: the claimed one in `args`, or the level of the tool's own `schema --json`.
pub fn check_binary_at(
    args: &CheckArgs,
    mode: Mode,
    source: LevelSource,
) -> Result<Report, Failure> {
    check_binary_with(args, mode, source, Mutation::none()).map(|judged| judged.report)
}

/// What a test may do to a run: report checks as passed whatever they found, or treat single conditions as holding,
/// to show that the test of each notices the missing check or condition (approaches/checker.md 7.2). Returns the
/// report and the id of every condition the run judged. The run is deep: every check of the level, each call in a
/// fresh copy of the state. Not part of the checker's interface: only with the `test-support` feature.
#[cfg(feature = "test-support")]
pub fn check_binary_mutated(
    args: &CheckArgs,
    forced_pass: &[&str],
    skipped_conditions: &[&str],
) -> Result<(Report, std::collections::BTreeSet<String>), Failure> {
    check_binary_with(
        args,
        Mode::Deep,
        LevelSource::Claimed,
        Mutation {
            forced_pass,
            skipped_conditions,
        },
    )
    .map(|judged| (judged.report, judged.conditions))
}

/// Where a run was when its scratch space failed: building the fixture state, before any check ran, or later, while the checks
/// ran (spec 8.3: a failure after the work started is exit 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Preparing,
    Checking,
}

/// The failure of a run that stopped with `error` at `stage`.
fn run_failure(error: RunError, stage: Stage) -> Failure {
    let refuse = |code: Code, message: String, field: &str| {
        Failure::new(code, message).in_command("check").field(field)
    };
    match error {
        RunError::Spawn(reason) => refuse(
            Code::BinaryInvalid,
            format!("the binary cannot be started: {reason}"),
            "--bin",
        ),
        RunError::Setup(reason) => {
            refuse(Code::FixtureInvalid, reason, "--fixture").reason("SETUP_FAILED")
        }
        RunError::Prepare(reason) => {
            refuse(Code::FixtureInvalid, reason, "--fixture").reason("PREPARE_FAILED")
        }
        RunError::Fixture(reason) => {
            refuse(Code::FixtureInvalid, reason, "--fixture").reason("WRONG_SHAPE")
        }
        RunError::Scratch(reason) => {
            let code = match stage {
                Stage::Preparing => Code::ScratchUnavailable,
                Stage::Checking => Code::ScratchFailed,
            };
            Failure::new(code, format!("the scratch space cannot be used: {reason}"))
                .in_command("check")
                .hint("Free space under TMPDIR, or point TMPDIR at a writable directory, then run atip check again.")
        }
    }
}

fn check_binary_with(
    args: &CheckArgs,
    mode: Mode,
    source: LevelSource,
    mutation: Mutation<'_>,
) -> Result<Judged, Failure> {
    let refuse = |code: Code, message: String, field: &str| {
        Failure::new(code, message).in_command("check").field(field)
    };
    let fixture_path = Path::new(&args.fixture);
    let fixture = fixture::load(fixture_path).map_err(|error| {
        refuse(Code::FixtureInvalid, error.message, "--fixture").reason(error.reason)
    })?;
    // `--contract` names the minor the checks judge by. When the fixture declares another minor the run is a preview: it is checked by the minor
    // asked for and is no claim of a level (the report says so).
    let (claim, declared) = match (
        args.contract.as_deref().and_then(Claim::parse),
        fixture.contract_version,
    ) {
        (Some(given), Some(declared)) if given != declared => (given, Some(declared)),
        (Some(claim), _) | (None, Some(claim)) => (claim, None),
        (None, None) => (Claim::V1_0, None),
    };
    let bin =
        resolve_binary(&args.bin).map_err(|reason| refuse(Code::BinaryInvalid, reason, "--bin"))?;
    let mut runner = Runner::new(&bin, &fixture)
        .map_err(|error| run_failure(error, Stage::Preparing))?
        .with_jobs(args.jobs);
    let from_run = |error: RunError| run_failure(error, Stage::Checking);
    let level = match source {
        LevelSource::Claimed => args.level,
        LevelSource::Tree => tree_level(&mut runner).map_err(from_run)?,
    };
    let name = bin
        .file_name()
        .map_or_default(|name| name.to_string_lossy().into_owned());
    let mut judged =
        run_checks(runner, &fixture, claim, &name, mutation, level, mode).map_err(from_run)?;
    if let Some(declared) = declared {
        judged.report = judged.report.previewing(declared);
    }
    Ok(judged)
}

/// The level the tool's own `schema --json` declares (`data.level`), and `L0` when it prints no such document: a tool that cannot describe itself claims
/// nothing above the level that needs no self-description.
fn tree_level(runner: &mut Runner) -> Result<Level, RunError> {
    let outcome = runner.run(&Call::new(["schema", "--json"]))?;
    let document: Option<serde_json::Value> = serde_json::from_slice(&outcome.stdout).ok();
    Ok(
        match document
            .as_ref()
            .filter(|document| document.get("ok") == Some(&serde_json::Value::Bool(true)))
            .and_then(|document| document.pointer("/data/level"))
            .and_then(serde_json::Value::as_str)
        {
            Some("L2") => Level::L2,
            Some("L1") => Level::L1,
            _ => Level::L0,
        },
    )
}

/// The binary as an absolute path: a path as given, a bare name found on `PATH`; it must be an executable file.
fn resolve_binary(bin: &OsStr) -> Result<PathBuf, String> {
    let given = Path::new(bin);
    let path = if given.components().count() > 1 || bin.to_string_lossy().contains('/') {
        std::path::absolute(given).map_err(|error| format!("{}: {error}", given.display()))?
    } else {
        let search = std::env::var_os("PATH").unwrap_or_default();
        let found = std::env::split_paths(&search)
            .map(|dir| dir.join(given))
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| format!("{} is not on PATH", given.display()))?;
        // A relative entry of PATH is relative to the working directory, which every invocation of the run changes.
        std::path::absolute(&found).map_err(|error| format!("{}: {error}", found.display()))?
    };
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if !platform::is_executable(&metadata) {
        return Err(format!("{} is not executable", path.display()));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{internal, run_failure, Stage};
    use crate::exec::RunError;
    use crate::output::{failure_line, Code};
    use crate::schema::schemas;

    #[test]
    fn atip_check_06_a_panic_is_an_internal_failure_with_exit_1_and_a_way_to_report_it() {
        let payload = std::panic::catch_unwind(|| panic!("boom")).expect_err("the closure panics");
        let failure = internal(&payload);
        assert_eq!((failure.code, failure.exit()), (Code::Internal, 1));
        assert!(
            failure.message.contains("boom")
                && failure
                    .hint
                    .as_deref()
                    .is_some_and(|hint| hint.contains("issues")),
            "{failure:?}"
        );
        let document: serde_json::Value =
            serde_json::from_str(&failure_line(&failure)).expect("json");
        assert_eq!(schemas().envelope_problems(&document), Vec::<String>::new());
        assert_eq!(document["error"]["code"], "INTERNAL");
    }

    /// The scratch space has a code for each stage (spec 8.3): `SCRATCH_UNAVAILABLE` (exit 2, retryable) while the fixture state is
    /// built, before any check ran, and `SCRATCH_FAILED` (exit 1, retryable: the checks write nothing outside their copies) once
    /// they run. The witness of the second, which no black-box call provokes on demand.
    #[test]
    fn atip_check_06_a_scratch_failure_has_a_code_for_each_stage() {
        for (stage, code, exit) in [
            (Stage::Preparing, Code::ScratchUnavailable, 2),
            (Stage::Checking, Code::ScratchFailed, 1),
        ] {
            let failure = run_failure(RunError::Scratch("disk full".to_string()), stage);
            assert_eq!((failure.code, failure.exit()), (code, exit));
            assert!(failure.code.info().retryable);
            assert_eq!(failure.command, Some("check"));
            let document: serde_json::Value =
                serde_json::from_str(&failure_line(&failure)).expect("json");
            assert_eq!(schemas().envelope_problems(&document), Vec::<String>::new());
        }
    }
}
