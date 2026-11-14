//! `docs/atip.cli.json`, the checked-in spec of `atip`, so a change to the surface shows in review: generated from the clap tree and
//! the facts of `atip_check::spec`, byte for byte the committed file, and equal to what the built binary answers to `atip
//! schema`. `ATIP_CHECK_BLESS_CLI_SPEC=1 cargo test -p atip-check --test cli_spec` rewrites the file.

mod support;

use std::path::{Path, PathBuf};

use serde_json::Value;

use atip_check::output::DECLARED_MINOR;
use support::{atip_as_given, Harness};

fn spec_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/atip.cli.json")
}

/// Whether `text` has no space, tab, CR or LF outside its strings (spec 5.1).
fn compact(text: &str) -> bool {
    let (mut in_string, mut escaped) = (false, false);
    text.chars().all(|c| {
        if in_string {
            match (escaped, c) {
                (true, _) => escaped = false,
                (false, '\\') => escaped = true,
                (false, '"') => in_string = false,
                _ => {}
            }
            true
        } else {
            in_string = c == '"';
            !matches!(c, ' ' | '\t' | '\r' | '\n')
        }
    })
}

#[test]
fn atip_check_spec_10_the_checked_in_spec_is_generated() {
    let text = atip_check::spec::render().expect("the spec");
    if std::env::var_os("ATIP_CHECK_BLESS_CLI_SPEC").is_some() {
        std::fs::write(spec_path(), &text).expect("write the spec");
    }
    let committed = std::fs::read_to_string(spec_path()).expect("docs/atip.cli.json");
    assert_eq!(committed, text, "docs/atip.cli.json is out of date; run ATIP_CHECK_BLESS_CLI_SPEC=1 cargo test -p atip-check --test cli_spec and commit");
}

/// Every answer of the binary is one compact envelope that validates against the contract's schemas, declares the claimed minor,
/// and holds what the committed spec holds.
#[test]
fn atip_check_spec_11_the_binary_answers_what_the_spec_holds() {
    let spec: Value =
        serde_json::from_str(&std::fs::read_to_string(spec_path()).expect("docs/atip.cli.json"))
            .expect("json");
    let harness = Harness::new();
    let (cwd, tmp) = (harness.path("cwd"), harness.path("tmp"));
    std::fs::create_dir_all(&cwd).expect("cwd");
    std::fs::create_dir_all(&tmp).expect("tmp");
    let answer = |args: &[&str]| -> Value {
        let output = atip_as_given(&cwd, &tmp, args);
        assert_eq!(output.code, Some(0), "{args:?}: {}", output.stdout);
        assert!(output.stderr.is_empty(), "{args:?}: {}", output.stderr);
        let document = output.envelope();
        assert!(
            compact(output.stdout.trim_end_matches('\n')),
            "{args:?}: not compact"
        );
        assert!(atip::envelope_problems(&document).is_empty(), "{args:?}");
        assert_eq!(
            atip::schema_doc_problems(&document),
            Vec::<String>::new(),
            "{args:?}"
        );
        assert_eq!(document["meta"]["command"], "schema");
        assert_eq!(document["meta"]["schemaVersion"], DECLARED_MINOR);
        assert_eq!(document["meta"]["contractVersion"], DECLARED_MINOR);
        // Without --json the answer is the same document, without its envelope (spec 9.1.1).
        let text: Vec<&str> = args
            .iter()
            .copied()
            .filter(|arg| *arg != "--json")
            .collect();
        let plain = atip_as_given(&cwd, &tmp, &text);
        assert_eq!(
            serde_json::from_str::<Value>(&plain.stdout).expect("json"),
            document["data"],
            "{text:?}"
        );
        document["data"].clone()
    };
    assert_eq!(answer(&["schema", "--json"]), spec["tree"]);
    assert_eq!(answer(&["schema", "--json"])["level"], "L2");
    for document in spec["groups"].as_array().expect("groups") {
        let name = document["command"].as_str().expect("command");
        assert_eq!(answer(&["schema", name, "--json"]), *document, "{name}");
    }
    let commands = spec["commands"].as_array().expect("commands");
    assert_eq!(commands.len(), 3);
    for document in commands {
        let name = document["command"].as_str().expect("command");
        assert_eq!(answer(&["schema", name, "--json"]), *document, "{name}");
        assert_eq!(
            answer(&["schema", name, "--schemas", "--json"]),
            spec["schemas"][name],
            "{name}"
        );
    }
    assert_eq!(
        answer(&["schema", "--errors", "--json"])["errors"],
        spec["errors"]
    );
    assert_eq!(
        answer(&["schema", "--warnings", "--json"])["warnings"],
        spec["warnings"]
    );
    for row in spec["errors"].as_array().expect("errors") {
        let code = row["code"].as_str().expect("code");
        assert_eq!(
            answer(&["schema", "--error", code, "--json"])["error"],
            *row
        );
    }
    for row in spec["warnings"].as_array().expect("warnings") {
        let code = row["code"].as_str().expect("code");
        assert_eq!(
            answer(&["schema", "--warning", code, "--json"])["warning"],
            *row
        );
    }
    // The same command as one quoted word (spec 9.1.1).
    assert_eq!(
        answer(&["schema", "check", "--json"]),
        answer(&["schema", " check ", "--json"])
    );
    assert_eq!(spec["contractVersion"], DECLARED_MINOR);
}
