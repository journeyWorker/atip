//! Mechanical rules over `atip`'s own command line, read from the full-form documents of `atip_check::spec` (what `atip
//! schema` projects from the clap tree) and from the sources: a command's last word is a verb or the noun view `schema`
//! and a group is a noun; option names are kebab-case with one meaning each and no short form but `-h`/`-V`; every value
//! name comes from `docs/atip-vocabulary.tsv` and every row of it is used; the environment variables the code reads are
//! the spec's; and one place prints.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use atip::doc::ValueType;

/// The verbs the last word of a command may be.
const VERBS: [&str; 2] = ["check", "show"];
/// The read-only noun views: `schema`, the self-description every atip tool has.
const NOUN_VIEWS: [&str; 1] = ["schema"];
/// The nouns a group may be: `skills`, the guides (spec 14).
const NOUNS: [&str; 1] = ["skills"];

fn is_kebab(word: &str) -> bool {
    let mut parts = word.split('-');
    parts.next().is_some_and(|first| {
        first.starts_with(|c: char| c.is_ascii_lowercase())
            && first
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    }) && parts.all(|part| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    })
}

#[test]
fn atip_check_grammar_01_command_words_are_verbs_or_noun_views_and_options_follow_the_name_rules() {
    let documents = atip_check::spec::documents().expect("the documents build");
    let mut meanings: BTreeMap<String, BTreeSet<(Option<String>, &str)>> = BTreeMap::new();
    for document in &documents {
        let words: Vec<&str> = document.command.split(' ').collect();
        for word in &words {
            assert!(is_kebab(word), "{word}");
        }
        let (last, groups) = words.split_last().expect("a word");
        assert!(
            VERBS.contains(last) || NOUN_VIEWS.contains(last),
            "`{last}` is neither a verb of atip nor a noun view"
        );
        for group in groups {
            assert!(NOUNS.contains(group), "`{group}` is not a noun of atip");
        }
        for option in &document.options {
            assert!(is_kebab(&option.name), "--{}", option.name);
            assert!(!option.name.ends_with("-id"), "--{}", option.name);
            assert!(
                option.short.is_none(),
                "--{} has a short option",
                option.name
            );
            assert!(!option.help.trim().is_empty(), "--{}", option.name);
            if option.value_type == ValueType::Enum {
                assert!(option.possible_values.is_some(), "--{}", option.name);
            }
            meanings
                .entry(option.name.clone())
                .or_default()
                .insert((option.value_name.clone(), option.value_type.as_str()));
        }
    }
    // Every command sits in one group, the root: one name has one value name and one value type (spec 9.6).
    for (name, uses) in &meanings {
        assert_eq!(uses.len(), 1, "--{name} has two meanings: {uses:?}");
    }
    // No short option but clap's `-h` and the root's `-V`; the reserved names keep their meaning (spec 4.5).
    let mut root = atip_check::cli::command();
    root.build();
    let mut shorts = BTreeSet::new();
    for node in std::iter::once(&root).chain(root.get_subcommands()) {
        for arg in node.get_arguments() {
            if let Some(short) = arg.get_short() {
                shorts.insert(short);
            }
        }
    }
    assert_eq!(shorts, BTreeSet::from(['V', 'h']));
    let json = documents[0]
        .options
        .iter()
        .find(|option| option.name == "json")
        .expect("--json");
    assert!(json.flag_only && json.value_type == ValueType::Switch);
}

fn vocabulary() -> Vec<(String, String)> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/atip-vocabulary.tsv");
    let text = std::fs::read_to_string(path).expect("docs/atip-vocabulary.tsv");
    let mut lines = text.lines();
    assert_eq!(lines.next(), Some("name\tvalue-name\tconcept"));
    lines
        .map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            assert_eq!(fields.len(), 3, "{line}");
            assert!(!fields[2].trim().is_empty(), "{line}");
            (fields[0].to_string(), fields[1].to_string())
        })
        .collect()
}

/// Every value name comes from the vocabulary, every row is used, and the value names have one case.
#[test]
fn atip_check_grammar_02_value_names_come_from_the_vocabulary_both_ways() {
    let rows = vocabulary();
    let listed: BTreeSet<(String, String)> = rows.iter().cloned().collect();
    assert_eq!(listed.len(), rows.len(), "a row appears twice");
    let mut used = BTreeSet::new();
    for document in atip_check::spec::documents().expect("the documents build") {
        for option in &document.options {
            if let Some(value_name) = &option.value_name {
                used.insert((option.name.clone(), value_name.clone()));
            }
        }
        for operand in &document.operands {
            used.insert((operand.name.clone(), operand.value_name.clone()));
        }
    }
    assert_eq!(used, listed, "the value names used and the vocabulary");
    for (_, value_name) in &rows {
        assert!(
            value_name.starts_with(|c: char| c.is_ascii_uppercase())
                && value_name
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c == '.'),
            "{value_name} is not in the vocabulary's one case"
        );
    }
}

fn sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        for entry in std::fs::read_dir(dir).expect("a source directory") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let text = std::fs::read_to_string(&path).expect("a source");
                out.push((path, text));
            }
        }
    }
    let mut out = Vec::new();
    walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
    out
}

/// The variables the sources read (by name, or `TMPDIR` through `std::env::temp_dir`) are the spec's, both ways.
#[test]
fn atip_check_grammar_03_every_environment_variable_the_code_reads_is_in_the_spec() {
    let mut read = BTreeSet::new();
    for (_, text) in sources() {
        for call in ["env::var_os(\"", "env::var(\""] {
            for (at, _) in text.match_indices(call) {
                let rest = &text[at + call.len()..];
                if let Some(end) = rest.find('"') {
                    read.insert(rest[..end].to_string());
                }
            }
        }
        if text.contains("env::temp_dir()") {
            read.insert("TMPDIR".to_string());
        }
    }
    let listed: BTreeSet<String> = atip_check::spec::ENVIRONMENT
        .iter()
        .map(|(name, _)| (*name).to_string())
        .collect();
    assert_eq!(read, listed);
}

/// What `atip` prints goes through one place, `app::main`, which prints the envelope or the text it is handed.
#[test]
fn atip_check_grammar_04_only_the_entry_point_prints() {
    for (path, text) in sources() {
        let prints = ["println!", "print!(", "eprintln!", "eprint!("]
            .iter()
            .any(|call| text.contains(call));
        assert!(
            !prints || path.ends_with("app.rs"),
            "{} prints",
            path.display()
        );
    }
}
