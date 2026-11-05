//! The documents of atip/1 1.3 to 1.5 (approaches/checker.md 6 and 7.2) as input of the pure judging functions of the checker.
//!
//! The repository's own `examples/` (read from `../../examples`, not the pinned copies of `tests/fixtures/`, which hold 1.0-1.2) are the
//! subject: acme declares 1.4 (its `member find`, which uses `\p{White_Space}`, 1.5) and holds every condition of the rows `L1.tree`,
//! `L1.walk`, `L1.schemas`, `L1.code-names`, `L1.warnings`, `L1.reserved-applicable`, `L1.patterns` and `L0.compact`; each `examples/invalid/`
//! document that is about 1.3, 1.4 or 1.5 breaks one rule, and the table `JUDGED` says which function judges it and which condition it breaks.
//! What no function of this slice judges is in `OUT_OF_SCOPE` with the reason; a file of `invalid/` that names acme and is in neither list
//! fails the test, so a new example is never left unaccounted for.
//!
//! The full view of a 1.4 command (`l1::view`) is built from the acme tree, the command's document and its schemas answer, as a run does.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use atip_check::checks::documents::{
    code_names_findings, emitted_warnings_findings, examples_findings, grammar_findings,
    pattern_findings, registry_findings, reserved_applicable_findings, schema_doc_problems,
    schemas_answer_findings, warnings_findings, Finding,
};
use atip_check::checks::rules::{compact_problem, contract_version_findings, emitted};
use atip_check::claim::Claim;
use atip_check::l1::form::{
    command_form_findings, group_form_findings, tree_form_findings, tree_options_named_findings,
};
use atip_check::l1::model::{CommandDoc, ToolDocs};
use atip_check::l1::rules::{command_findings, tree_findings};
use atip_check::l1::view::{usage_replacements, Answers};

fn examples() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

fn text_of(relative: &str) -> String {
    let path = examples().join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn load(relative: &str) -> Value {
    serde_json::from_str(&text_of(relative)).unwrap_or_else(|error| panic!("{relative}: {error}"))
}

fn claim_of(document: &Value) -> Claim {
    document
        .pointer("/meta/contractVersion")
        .and_then(Value::as_str)
        .and_then(Claim::parse)
        .unwrap_or(Claim::V1_0)
}

fn failing(findings: &[Finding]) -> Vec<String> {
    let mut found: Vec<String> = findings
        .iter()
        .filter(|(_, problem)| problem.is_some())
        .map(|(condition, _)| (*condition).to_string())
        .collect();
    found.sort();
    found.dedup();
    found
}

/// The acme documents, by what each is.
struct Acme {
    tree: Value,
    /// `(command id, data)` of each command document and of each schemas answer.
    commands: Vec<(String, Value)>,
    schemas: Vec<(String, Value)>,
    /// The error registry's entries.
    errors: Vec<Value>,
    replacements: Vec<String>,
}

fn acme() -> Acme {
    let tree = load("schema-tree-acme.json");
    let mut commands = Vec::new();
    let mut schemas = Vec::new();
    let mut files: Vec<_> = std::fs::read_dir(examples())
        .expect("examples/")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    files.sort();
    for file in files {
        if file.starts_with("schema-command-acme-") || file.starts_with("schema-schemas-acme-") {
            let data = load(&file)["data"].clone();
            let id = data["command"].as_str().expect("a command id").to_string();
            if file.starts_with("schema-command-") {
                commands.push((id, data));
            } else {
                schemas.push((id, data));
            }
        }
    }
    let errors = load("schema-errors-acme.json")["data"]["errors"]
        .as_array()
        .expect("errors")
        .clone();
    let replacements = usage_replacements(&errors);
    Acme {
        tree,
        commands,
        schemas,
        errors,
        replacements,
    }
}

impl Acme {
    fn docs(&self) -> ToolDocs {
        let commands: Vec<(&str, &Value)> = self
            .commands
            .iter()
            .map(|(id, data)| (id.as_str(), data))
            .collect();
        let schemas: Vec<(&str, &Value)> = self
            .schemas
            .iter()
            .map(|(id, data)| (id.as_str(), data))
            .collect();
        ToolDocs::assemble(
            Claim::V1_4,
            "acme",
            &Answers {
                tree: Some(&self.tree["data"]),
                groups: &[],
                commands: &commands,
                schemas: &schemas,
            },
            &self.replacements,
        )
    }

    /// The view of the command `id` as its own document and `schemas` (a schemas answer's `data`) say.
    fn view(&self, data: &Value, schemas: Option<&Value>) -> CommandDoc {
        atip_check::l1::view::command_view(
            data,
            &atip_check::l1::view::ViewContext {
                tree_options: &self.tree["data"]["options"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default(),
                schemas_answer: schemas,
                usage_replacements: &self.replacements,
            },
        )
        .expect("a command document")
    }

    fn command(&self, id: &str) -> &Value {
        &self
            .commands
            .iter()
            .find(|(command, _)| command == id)
            .unwrap_or_else(|| panic!("no acme command {id}"))
            .1
    }

    fn schemas_of(&self, id: &str) -> &Value {
        &self
            .schemas
            .iter()
            .find(|(command, _)| command == id)
            .unwrap_or_else(|| panic!("no schemas answer of {id}"))
            .1
    }

    /// The command a file name names: the longest id whose words, joined by `-`, begin the rest of the stem.
    fn id_of(&self, stem: &str) -> String {
        self.commands
            .iter()
            .map(|(id, _)| id)
            .filter(|id| {
                let dashed = id.replace(' ', "-");
                stem == dashed || stem.starts_with(&format!("{dashed}-"))
            })
            .max_by_key(|id| id.len())
            .unwrap_or_else(|| panic!("{stem} names no acme command"))
            .clone()
    }
}

/// The exit of a registered code of acme at 1.4: a core code's, else the row of acme's registry.
fn exit_of(acme: &Acme) -> impl Fn(&str) -> Option<i64> + '_ {
    move |code| {
        atip::reserved_code(code, atip::Minor::V1_4)
            .map(|reserved| i64::from(reserved.exit))
            .or_else(|| {
                acme.errors
                    .iter()
                    .find(|entry| entry["code"] == code)
                    .and_then(|entry| entry["exit"].as_i64())
            })
    }
}

/// Every condition the pure functions judge on one 1.4 command of acme, by `check/condition`.
fn judged(acme: &Acme, doc: &CommandDoc, claim: Claim) -> Vec<String> {
    let minor = atip_check::checks::documents::minor_of(claim);
    let mut found: Vec<String> = Vec::new();
    let mut add = |check: &str, findings: Vec<Finding>| {
        found.extend(
            failing(&findings)
                .into_iter()
                .map(|condition| format!("{check}/{condition}")),
        );
    };
    add(
        "L1.walk",
        command_findings(doc, "acme", claim, &exit_of(acme)),
    );
    add("L1.walk", command_form_findings(doc, claim));
    add("L1.grammar", grammar_findings(&[], Some(doc), minor));
    add("L1.examples", examples_findings(doc, "acme"));
    add("L1.patterns", pattern_findings(doc, claim));
    add("L1.reserved-applicable", reserved_applicable_findings(doc));
    found.sort();
    found.dedup();
    found
}

#[test]
fn atip_check14_20_acme_holds_every_condition_of_the_1_4_rows() {
    let acme = acme();
    assert!(
        acme.tree["data"]["options"].is_array(),
        "the acme tree defines the shared options"
    );
    // The tree: the schema, the tree rules, the 1.4 form, the grammar of the paths.
    let claim = claim_of(&acme.tree);
    assert_eq!(claim, Claim::V1_4);
    assert_eq!(schema_doc_problems(&acme.tree, claim), Vec::<String>::new());
    let docs = acme.docs();
    let tree = docs.tree.as_ref().expect("a tree");
    assert_eq!(
        failing(&tree_findings(&acme.tree, tree, "L1")),
        Vec::<String>::new()
    );
    assert_eq!(
        failing(&tree_form_findings(&acme.tree["data"], claim)),
        Vec::<String>::new()
    );
    let views: Vec<&CommandDoc> = docs.commands.values().collect();
    assert_eq!(views.len(), acme.commands.len());
    assert_eq!(
        failing(&tree_options_named_findings(&acme.tree["data"], &views)),
        Vec::<String>::new()
    );
    // Every command: its document validates, its view passes every rule, its schemas answer holds the refs and the derived `Input`.
    // Each is judged at the minor it declares: `member find` is acme built for 1.5 (a `\p{White_Space}` pattern, Annex V2).
    for (id, data) in &acme.commands {
        let envelope = {
            let file = format!("schema-command-acme-{}.json", id.replace(' ', "-"));
            load(&file)
        };
        let claim = claim_of(&envelope);
        assert!(claim.declares_1_4(), "{id}");
        assert_eq!(
            schema_doc_problems(&envelope, claim),
            Vec::<String>::new(),
            "{id}"
        );
        let view = &docs.commands[id];
        assert_eq!(view.raw, *data, "{id}: raw is what was listed");
        assert_eq!(judged(&acme, view, claim), Vec::<String>::new(), "{id}");
        let answer = load(&format!(
            "schema-schemas-acme-{}.json",
            id.replace(' ', "-")
        ));
        assert_eq!(
            schema_doc_problems(&answer, claim),
            Vec::<String>::new(),
            "{id}"
        );
        assert_eq!(
            failing(&schemas_answer_findings(&answer, view, claim)),
            Vec::<String>::new(),
            "{id}"
        );
        // The checker's derived `Input` is the answer's, as JSON.
        if view.input.is_some() {
            assert_eq!(
                view.schemas["Input"], answer["data"]["schemas"]["Input"],
                "{id}"
            );
        }
    }
}

#[test]
fn atip_check14_21_acme_registries_follow_the_code_names_and_the_warning_registry() {
    let acme = acme();
    let minor = atip::Minor::V1_4;
    assert_eq!(
        failing(&code_names_findings(&acme.errors, minor)),
        Vec::<String>::new()
    );
    assert_eq!(code_names_findings(&acme.errors, minor).len(), 3);
    assert_eq!(
        failing(&registry_findings(&acme.errors, minor)),
        Vec::<String>::new()
    );
    // Below 1.3 code names are the tool's own.
    assert!(code_names_findings(&acme.errors, atip::Minor::V1_2).is_empty());
    assert!(acme.replacements.is_empty() || acme.replacements.iter().all(|code| !code.is_empty()));
    // The warning the acme report emits is in the warning registry.
    let registry = load("schema-warnings-acme.json")["data"]["warnings"]
        .as_array()
        .expect("warnings")
        .clone();
    assert_eq!(failing(&warnings_findings(&registry)), Vec::<String>::new());
    let report = load("report-acme-member-list-warning.json");
    let warned = emitted(&report).warnings;
    assert!(!warned.is_empty());
    assert_eq!(
        failing(&emitted_warnings_findings(
            Claim::V1_4,
            &warned,
            Some(&registry)
        )),
        Vec::<String>::new()
    );
}

#[test]
fn atip_check14_22_every_acme_document_that_declares_1_4_is_compact() {
    let mut judged = 0;
    let mut files: Vec<_> = std::fs::read_dir(examples())
        .expect("examples/")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("-acme-"))
        .collect();
    files.sort();
    for file in files {
        let text = text_of(&file);
        let lines: Vec<String> = if file.ends_with(".ndjson") {
            text.split_inclusive('\n').map(str::to_string).collect()
        } else {
            vec![text.clone()]
        };
        for line in lines {
            let Ok(document) = serde_json::from_str::<Value>(line.trim_end()) else {
                continue;
            };
            // The caller examples are stated at a later minor (1.6) the checker does not know; the others declare the minor they print.
            let declares = document
                .pointer("/meta/contractVersion")
                .or_else(|| document.get("contractVersion"))
                .and_then(Value::as_str)
                .and_then(Claim::parse);
            if !declares.is_some_and(Claim::declares_1_4) {
                continue;
            }
            judged += 1;
            assert_eq!(compact_problem(&line), None, "{file}");
        }
    }
    assert!(judged > 40, "the acme examples were not read ({judged})");
    // Number spellings and escapes are free: only whitespace outside strings fails.
    assert_eq!(compact_problem("{\"a\":60.0,\"b\":\"\\u00e9 x\"}\n"), None);
    assert!(compact_problem("{\"a\": 1}\n").is_some());
    assert!(compact_problem("{\"a\":1}").is_some());
    assert!(compact_problem("{\"a\":1}\n\n").is_some());
}

#[test]
fn atip_check14_23_a_1_3_acme_document_keeps_the_members_a_1_4_one_leaves_out() {
    // The 1.4 documents of acme, read as documents that declare 1.3, lack the members 1.0-1.3 carry.
    let acme = acme();
    let findings = tree_form_findings(&acme.tree["data"], Claim::V1_3);
    assert_eq!(failing(&findings), ["minor-form"]);
    let problem = findings[0].1.as_deref().expect("a problem");
    assert!(
        problem.contains("the tree's options") && problem.contains("lacks path"),
        "{problem}"
    );
    let show = acme.view(acme.command("member show"), None);
    assert_eq!(
        failing(&command_form_findings(&show, Claim::V1_3)),
        ["minor-form"]
    );
    // A group of 1.4 has no `path`; the same group read at 1.3 lacks it.
    let group = serde_json::json!({
        "kind": "group", "command": "member", "summary": "s",
        "commands": [{"command": "member show", "summary": "s", "effect": "read"}]
    });
    assert_eq!(
        failing(&group_form_findings(&group, Claim::V1_4)),
        Vec::<String>::new()
    );
    assert_eq!(
        failing(&group_form_findings(&group, Claim::V1_3)),
        ["minor-form"]
    );
}

/// How an invalid example is judged.
#[derive(Debug, Clone, Copy)]
enum Judge {
    /// `pattern_findings` over the view, the claim the file declares.
    Patterns,
    /// `command_form_findings` over the document (its view for 1.4), the claim the file declares.
    CommandForm,
    /// `command_findings` over the view with the acme schemas answer of the same command.
    Walk,
    /// `command_findings` over the view built with the invalid schemas answer (it carries the `rejects`).
    WalkWithAnswer,
    /// `reserved_applicable_findings` over the view.
    ReservedApplicable,
    /// `schemas_answer_findings` over the invalid answer and the view of the command.
    Schemas,
    /// `tree_form_findings`.
    TreeForm,
    /// `tree_options_named_findings` over the invalid tree and the acme commands.
    TreeOptionsNamed,
    /// `code_names_findings` over the entries of the registry document.
    CodeNames,
    /// `compact_problem` over the file (or over each line of a stream).
    Compact,
    /// `contract_version_findings` at the 1.4 claim.
    ContractVersion,
    /// `grammar_findings` over the document at the claim it declares.
    Grammar,
    /// `emitted_warnings_findings` over the warnings the report emits and the acme warning registry.
    EmittedWarnings,
}

use Judge::{
    CodeNames, CommandForm, Compact, ContractVersion, EmittedWarnings, Grammar, Patterns,
    ReservedApplicable, Schemas, TreeForm, TreeOptionsNamed, Walk, WalkWithAnswer,
};

/// The invalid examples of 1.3 to 1.5: the file, how it is judged, the conditions it breaks (and no other).
const JUDGED: &[(&str, Judge, &[&str])] = &[
    (
        "invalid/schema-command-acme-build-count-repeatable.json",
        CommandForm,
        &["no-default-members"],
    ),
    (
        "invalid/schema-command-acme-member-find-1-4-white-space.json",
        Patterns,
        &["form"],
    ),
    (
        "invalid/schema-command-acme-member-find-shorthand-s.json",
        Patterns,
        &["form"],
    ),
    (
        "invalid/schema-command-acme-member-list-limit-not-flag-only.json",
        Grammar,
        &["reserved-shape"],
    ),
    (
        "invalid/schema-command-acme-member-roster-1-3-option-name.json",
        CommandForm,
        &["minor-form"],
    ),
    (
        "invalid/schema-command-acme-member-roster-option-twice.json",
        CommandForm,
        &["option-names"],
    ),
    (
        "invalid/schema-command-acme-member-show-1-3-no-path.json",
        CommandForm,
        &["minor-form"],
    ),
    (
        "invalid/schema-command-acme-member-show-1-3-operand-defaults-left-out.json",
        CommandForm,
        &["minor-form"],
    ),
    (
        "invalid/schema-command-acme-member-show-embeds-schemas.json",
        CommandForm,
        &["no-retired-members"],
    ),
    (
        "invalid/schema-command-acme-member-show-has-path.json",
        CommandForm,
        &["no-retired-members"],
    ),
    (
        "invalid/schema-command-acme-member-show-lists-json.json",
        ReservedApplicable,
        &["implied-option"],
    ),
    (
        "invalid/schema-command-acme-member-show-lists-usage.json",
        ReservedApplicable,
        &["implied-code"],
    ),
    (
        "invalid/schema-command-acme-member-show-names-json.json",
        ReservedApplicable,
        &["implied-option"],
    ),
    (
        "invalid/schema-command-acme-member-show-not-compact.json",
        Compact,
        &["no-whitespace"],
    ),
    (
        "invalid/schema-command-acme-member-show-unknown-option-name.json",
        CommandForm,
        &["option-names"],
    ),
    (
        "invalid/schema-command-acme-member-tag-input-example-unknown-key.json",
        Walk,
        &["rule-7"],
    ),
    (
        "invalid/schema-command-acme-member-tag-option-required-false.json",
        CommandForm,
        // The file also keeps `rejects` in its validator (rule 16), which the 1.4 form moved to the schemas answer.
        &["no-default-members", "no-retired-members"],
    ),
    (
        "invalid/schema-command-acme-member-tag-validator-rejects.json",
        CommandForm,
        &["no-retired-members"],
    ),
    (
        "invalid/schema-error-acme-code-grammar.json",
        CodeNames,
        &["grammar"],
    ),
    (
        "invalid/schema-error-acme-incomplete-exit-2.json",
        CodeNames,
        &["exit"],
    ),
    (
        "invalid/schema-error-acme-not-found-exit-1.json",
        CodeNames,
        &["exit"],
    ),
    (
        "invalid/schema-error-acme-stopped-midway-in-1-3.json",
        CodeNames,
        &["grammar"],
    ),
    (
        "invalid/schema-error-acme-unavailable-not-retryable.json",
        CodeNames,
        &["retryable"],
    ),
    (
        "invalid/schema-schemas-acme-member-show-extra-schema.json",
        Schemas,
        &["members"],
    ),
    (
        "invalid/schema-schemas-acme-member-show-in-1-3.json",
        Schemas,
        &["kind"],
    ),
    (
        "invalid/schema-schemas-acme-member-show-missing-schema.json",
        Schemas,
        &["members"],
    ),
    (
        "invalid/schema-schemas-acme-member-tag-input-differs.json",
        Schemas,
        &["input"],
    ),
    (
        "invalid/schema-schemas-acme-member-tag-rejects-is-example.json",
        WalkWithAnswer,
        &["rule-13"],
    ),
    (
        "invalid/schema-schemas-acme-member-tag-without-input.json",
        Schemas,
        &["input"],
    ),
    (
        "invalid/schema-schemas-acme-member-tag-without-rejects.json",
        Schemas,
        &["rejects"],
    ),
    (
        "invalid/schema-tree-acme-entry-kind-command.json",
        TreeForm,
        &["entry-form"],
    ),
    (
        "invalid/schema-tree-acme-entry-path.json",
        TreeForm,
        &["entry-form"],
    ),
    (
        "invalid/schema-tree-acme-markers-missing.json",
        ContractVersion,
        // The answer also says `schemaVersion` 1.0, which is not the claim's either.
        &["markers-present", "schema-version-is-claim"],
    ),
    (
        "invalid/schema-tree-acme-option-unused.json",
        TreeOptionsNamed,
        &["tree-options-named"],
    ),
    (
        "invalid/stream-acme-build-not-compact.ndjson",
        Compact,
        &["no-whitespace"],
    ),
    (
        "invalid/report-acme-warning-error-registry-only.json",
        EmittedWarnings,
        &["emitted-in-warning-registry"],
    ),
    (
        "invalid/report-acme-warning-unregistered.json",
        EmittedWarnings,
        &["emitted-in-warning-registry"],
    ),
];

/// The invalid examples that name acme and no function of this slice judges, with who does.
const OUT_OF_SCOPE: &[(&str, &str)] = &[
    (
        "invalid/schema-error-acme-reason-lowercase.json",
        "1.1 `L1.reasons`, judged by tests/l1_examples.rs",
    ),
    (
        "invalid/schema-errors-acme-duplicate-code.json",
        "`L1.registry`, judged by tests/l1_examples.rs",
    ),
    (
        "invalid/schema-errors-acme-duplicate-reason.json",
        "`L1.reasons`, judged by tests/l1_examples.rs",
    ),
    (
        "invalid/schema-errors-acme-reasons-in-1-0.json",
        "`L0.contract-version`, a 1.0 claim",
    ),
    (
        "invalid/schema-errors-acme-stopped-midway-exit-2.json",
        "`L1.registry` at 1.2, judged by tests/l1_examples.rs",
    ),
    (
        "invalid/schema-version-not-contract-version.json",
        "`L0.contract-version` (`schema-version-is-claim`)",
    ),
    (
        "invalid/schema-warnings-acme-duplicate.json",
        "`L1.warnings`, judged by tests/l1_examples.rs",
    ),
    (
        "invalid/schema-warnings-acme-in-1-0.json",
        "`L0.contract-version`, a 1.0 claim",
    ),
    (
        "invalid/schema-warnings-acme-with-exit.json",
        "`L0.registry` (the warning-entry schema)",
    ),
];

fn stem(file: &str) -> &str {
    file.rsplit('/')
        .next()
        .and_then(|name| {
            name.strip_suffix(".json")
                .or_else(|| name.strip_suffix(".ndjson"))
        })
        .expect("a file name")
}

/// What `judge` finds wrong with the invalid example `file`: the failing conditions.
fn judge_file(acme: &Acme, file: &str, judge: Judge) -> Vec<String> {
    let text = text_of(file);
    let name = stem(file);
    match judge {
        Compact => {
            let lines: Vec<String> = if file.ends_with(".ndjson") {
                text.split_inclusive('\n').map(str::to_string).collect()
            } else {
                vec![text]
            };
            let mut found: Vec<String> = lines
                .iter()
                .filter(|line| compact_problem(line).is_some())
                .map(|_| "no-whitespace".to_string())
                .collect();
            found.dedup();
            found
        }
        _ => {
            let document: Value = serde_json::from_str(&text).expect("JSON");
            let claim = claim_of(&document);
            let data = &document["data"];
            match judge {
                CommandForm | Walk | ReservedApplicable | WalkWithAnswer | Patterns => {
                    let id = acme.id_of(
                        name.strip_prefix("schema-command-acme-")
                            .or_else(|| name.strip_prefix("schema-schemas-acme-"))
                            .expect("a command or schemas file"),
                    );
                    let doc = if claim.declares_1_4() {
                        let answer = match judge {
                            WalkWithAnswer => data,
                            _ => acme.schemas_of(&id),
                        };
                        let command = if matches!(judge, WalkWithAnswer) {
                            acme.command(&id)
                        } else {
                            data
                        };
                        acme.view(command, Some(answer))
                    } else {
                        CommandDoc::parse(data).expect("a command document")
                    };
                    let findings = match judge {
                        CommandForm => command_form_findings(&doc, claim),
                        ReservedApplicable => reserved_applicable_findings(&doc),
                        Patterns => pattern_findings(&doc, claim),
                        _ => command_findings(&doc, "acme", claim, &exit_of(acme)),
                    };
                    failing(&findings)
                }
                Schemas => {
                    let id = acme.id_of(
                        name.strip_prefix("schema-schemas-acme-")
                            .expect("a schemas file"),
                    );
                    let command = acme.view(acme.command(&id), Some(acme.schemas_of(&id)));
                    failing(&schemas_answer_findings(&document, &command, claim))
                }
                TreeForm => failing(&tree_form_findings(data, claim)),
                TreeOptionsNamed => {
                    let docs = acme.docs();
                    let views: Vec<&CommandDoc> = docs.commands.values().collect();
                    failing(&tree_options_named_findings(data, &views))
                }
                CodeNames => {
                    let entries: Vec<Value> = match data["kind"].as_str() {
                        Some("errors") => data["errors"].as_array().cloned().unwrap_or_default(),
                        _ => vec![data["error"].clone()],
                    };
                    failing(&code_names_findings(
                        &entries,
                        atip_check::checks::documents::minor_of(claim),
                    ))
                }
                ContractVersion => failing(&contract_version_findings(&document, Claim::V1_4)),
                Grammar => {
                    let doc = CommandDoc::parse(data).expect("a command document");
                    failing(&grammar_findings(
                        &[],
                        Some(&doc),
                        atip_check::checks::documents::minor_of(claim),
                    ))
                }
                EmittedWarnings => {
                    let registry = load("schema-warnings-acme.json")["data"]["warnings"]
                        .as_array()
                        .expect("warnings")
                        .clone();
                    failing(&emitted_warnings_findings(
                        claim,
                        &emitted(&document).warnings,
                        Some(&registry),
                    ))
                }
                Compact => unreachable!("judged above"),
            }
        }
    }
}

#[test]
fn atip_check14_24_each_invalid_example_of_1_3_and_1_4_breaks_exactly_its_rule() {
    let acme = acme();
    let mismatches: Vec<String> = JUDGED
        .iter()
        .filter_map(|(file, judge, expected)| {
            let found = judge_file(&acme, file, *judge);
            (found != *expected)
                .then(|| format!("{file} ({judge:?}): found {found:?}, expected {expected:?}"))
        })
        .collect();
    assert_eq!(mismatches, Vec::<String>::new());
}

#[test]
fn atip_check14_25_every_invalid_acme_example_is_judged_or_out_of_scope() {
    let mut known: BTreeMap<String, &str> = BTreeMap::new();
    for (file, _, _) in JUDGED {
        known.insert((*file).to_string(), "judged");
    }
    for (file, why) in OUT_OF_SCOPE {
        known.insert((*file).to_string(), why);
    }
    for file in known.keys() {
        assert!(examples().join(file).exists(), "{file} does not exist");
    }
    let mut unaccounted: Vec<String> = std::fs::read_dir(examples().join("invalid"))
        .expect("examples/invalid")
        .filter_map(Result::ok)
        .map(|entry| format!("invalid/{}", entry.file_name().to_string_lossy()))
        .filter(|file| {
            let name = file.trim_start_matches("invalid/");
            // The self-description examples of acme, and the one stream that is about compactness.
            (name.starts_with("schema-") && name.contains("-acme-"))
                || name == "stream-acme-build-not-compact.ndjson"
        })
        .filter(|file| !known.contains_key(file))
        .collect();
    unaccounted.sort();
    assert_eq!(
        unaccounted,
        Vec::<String>::new(),
        "judge them in JUDGED or give OUT_OF_SCOPE a reason"
    );
}

#[test]
fn atip_check14_26_the_repeatable_keys_and_the_empty_array_probe_of_acme() {
    use atip_check::checks::documents::{empty_array_answer, EmptyArray};
    use atip_check::l1::view::repeatable_document_keys;
    use serde_json::json;

    let acme = acme();
    let docs = acme.docs();
    // `page label` has a repeatable `--label`; `build` has a count (one integer, no probe), the others nothing.
    assert_eq!(
        repeatable_document_keys(&docs.commands["page label"]),
        ["label"]
    );
    assert!(repeatable_document_keys(&docs.commands["build"]).is_empty());
    assert_eq!(
        docs.commands["page label"].schemas["Input"]["properties"]["label"]["type"],
        "array"
    );
    assert!(
        docs.commands["page label"].schemas["Input"]["properties"]["label"]
            .get("minItems")
            .is_none()
    );
    // Either answer to `{"label":[]}` conforms; the probe describes what it saw.
    let accepted = json!({"ok": true, "data": {}, "meta": {}});
    let refused =
        json!({"ok": false, "error": {"code": "INPUT_INVALID", "field": "/label"}, "meta": {}});
    let other = json!({"ok": false, "error": {"code": "USAGE", "field": "--input"}, "meta": {}});
    assert_eq!(
        empty_array_answer("label", Some(&accepted)),
        EmptyArray::ReadAsNone
    );
    assert_eq!(
        empty_array_answer("label", Some(&refused)),
        EmptyArray::Refused
    );
    assert!(matches!(
        empty_array_answer("label", Some(&other)),
        EmptyArray::Other(_)
    ));
    assert!(matches!(
        empty_array_answer("label", None),
        EmptyArray::Other(_)
    ));
    assert!(EmptyArray::Refused.note("label").contains("/label"));
}
