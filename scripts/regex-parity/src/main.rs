//! Runs every case of scripts/regex-cases.json through the Rust regex crate with its default limits and
//! compares the result with the recorded `rust` value: `true`, `false`, or `"error"` when `Regex::new` refuses the
//! pattern. For a case whose `difference` is of kind `unicode-version`, it also verifies the Rust half of that claim:
//! in this crate's Unicode tables the code point has the recorded `rust` general category and not the recorded
//! `ecmascript` one. Run by scripts/validate.sh when cargo is available. Exits 1 on any difference.
use serde_json::Value;

/// Whether `value` is exactly one code point of general category `category` in this crate's tables.
fn has_category(value: &str, category: &str) -> bool {
    let re = regex::Regex::new(&format!("^\\p{{{category}}}$")).expect("a general category name");
    re.is_match(value)
}

/// The problem with a case's `difference`, if any, as seen from the Rust side.
fn difference_problem(case: &Value, value: &str) -> Option<String> {
    let difference = case.get("difference")?;
    if difference["kind"] != "unicode-version" {
        return Some(format!("unknown difference kind {}", difference["kind"]));
    }
    let (Some(ours), Some(theirs)) = (
        difference["rust"].as_str(),
        difference["ecmascript"].as_str(),
    ) else {
        return Some("difference without both categories".into());
    };
    let code_point = value.chars().next().map(|c| format!("U+{:04X}", c as u32));
    if value.chars().count() != 1 || code_point.as_deref() != difference["codePoint"].as_str() {
        return Some("the value is not the recorded code point".into());
    }
    if !has_category(value, ours) {
        return Some(format!("its category in Rust's tables is not {ours}"));
    }
    if has_category(value, theirs) {
        return Some(format!(
            "Rust's tables also give it {theirs}, so the categories do not differ"
        ));
    }
    None
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: regex-parity <regex-cases.json>");
    let text = std::fs::read_to_string(&path).expect("cannot read the cases file");
    let doc: Value = serde_json::from_str(&text).expect("the cases file is not JSON");
    let cases = doc["cases"].as_array().expect("no cases array");
    let mut failed = 0;
    for case in cases {
        let pattern = case["pattern"].as_str().expect("pattern");
        let value = case["value"].as_str().expect("value");
        let observed = match regex::Regex::new(pattern) {
            Ok(re) => Value::Bool(re.is_match(value)),
            Err(_) => Value::String("error".into()),
        };
        let difference = difference_problem(case, value);
        let ok = observed == case["rust"] && difference.is_none();
        if !ok {
            failed += 1;
        }
        println!(
            "{}  rust {} {:?}: {} (recorded {}){}",
            if ok { "ok  " } else { "FAIL" },
            pattern,
            value,
            observed,
            case["rust"],
            difference
                .map(|p| format!("; difference: {p}"))
                .unwrap_or_default()
        );
    }
    println!("{} rust cases, {} failed", cases.len(), failed);
    std::process::exit(if failed == 0 { 0 } else { 1 });
}
