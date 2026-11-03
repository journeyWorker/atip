//! The plan digest test vectors of the contract repository (`examples/plan-digest/`, spec 12.6), run against
//! `atip::jcs` and `atip::plan`: the RFC 8785 text of each plan and its `sha256:` digest.
//!
//! The vectors are read from the repository's own directory, the one copy `scripts/plan-digest.ts` recomputes too. They bind no tool
//! that computes its digest another way (12.6 is a SHOULD); they bind this crate, which says it follows the recommendation.

use std::path::Path;

use serde_json::Value;

use atip::plan::{digest_of, Plan};

/// Every vector of the directory.
const VECTORS: [&str; 9] = [
    "empty-effects.json",
    "key-order-utf16.json",
    "key-order.json",
    "large-integers-as-strings.json",
    "nested.json",
    "numbers-integral.json",
    "numbers-other.json",
    "preview.json",
    "strings.json",
];

fn directory() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plan-digest")
}

fn vector(name: &str) -> Value {
    let bytes =
        std::fs::read(directory().join(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
    serde_json::from_slice(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"))
}

#[test]
fn atip_crateplan_12_the_directory_holds_exactly_the_vectors_this_test_runs() {
    // A vector added to the repository's directory is named here, so it is run and never silently left out.
    let mut found: Vec<String> = std::fs::read_dir(directory())
        .expect("the vectors")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    found.sort();
    let mut named: Vec<String> = VECTORS.iter().map(|name| (*name).to_string()).collect();
    named.sort();
    assert_eq!(found, named);
}

#[test]
fn atip_crateplan_12_every_vector_has_the_canonical_text_and_the_digest_the_contract_gives() {
    for name in VECTORS {
        let document = vector(name);
        let plan = &document["plan"];
        let canonical =
            atip::jcs::to_string(plan).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            canonical,
            document["canonical"].as_str().expect("a canonical text"),
            "{name}: the RFC 8785 text"
        );
        assert_eq!(
            digest_of(plan)
                .unwrap_or_else(|error| panic!("{name}: {error}"))
                .as_str(),
            document["digest"].as_str().expect("a digest"),
            "{name}: the digest"
        );
    }
}

#[test]
fn atip_crateplan_12_a_plan_of_the_crates_own_type_has_the_same_digest_for_every_vector() {
    for name in VECTORS {
        let document = vector(name);
        let plan: Plan = serde_json::from_value(document["plan"].clone())
            .unwrap_or_else(|error| panic!("{name}: the vector is a Plan: {error}"));
        assert_eq!(
            plan.digest()
                .unwrap_or_else(|error| panic!("{name}: {error}"))
                .as_str(),
            document["digest"].as_str().expect("a digest"),
            "{name}"
        );
        // The report of its preview carries that digest.
        assert_eq!(
            plan.preview().expect("a preview").plan_digest,
            document["digest"].as_str().expect("a digest"),
            "{name}"
        );
    }
}

#[test]
fn atip_crateplan_12_an_integer_beyond_the_safe_range_is_refused_and_its_string_is_the_vectors_form(
) {
    let document = vector("large-integers-as-strings.json");
    assert_eq!(
        document["plan"]["inputs"]["since"], "12345678901234567890",
        "the vector holds such an integer as a string"
    );
    // The same plan with the integers as numbers is refused, never digested to something another implementation would not.
    let as_numbers: Value = serde_json::from_str(r#"{"effects":[{"action":"update","record":"18446744073709551615"}],"inputs":{"since":12345678901234567890,"sequence":9007199254740993,"previous":-9223372036854775808}}"#).expect("JSON");
    assert!(
        digest_of(&as_numbers).is_err(),
        "a 64-bit integer beyond ±(2^53-1) is not a plan input"
    );
    let sequence: Value =
        serde_json::from_str(r#"{"effects":[],"inputs":{"sequence":9007199254740993}}"#)
            .expect("JSON");
    assert!(matches!(
        digest_of(&sequence),
        Err(atip::jcs::Error::NumberNotSafe(_))
    ));
}
