//! The crate's copy of the contract's JSON Schemas (`crates/atip/schema/`, what `atip::schema` embeds and what the
//! published crate carries) is the spec's `schema/` directory: the same files, byte for byte. A schema edit is made in
//! `schema/` and copied with `cp schema/*.json crates/atip/schema/`.
//!
//! The test reads the repository around the crate, so it runs in a checkout, not in the published package (which has no
//! tests).

use std::collections::BTreeMap;
use std::path::Path;

/// The `*.json` files of `dir`, by file name.
fn schemas(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    std::fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("read {}: {error}", dir.display()))
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .map(|path| {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .expect("a UTF-8 file name")
                .to_string();
            let bytes = std::fs::read(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            (name, bytes)
        })
        .collect()
}

#[test]
fn schema_copy_the_crate_embeds_the_spec_s_schema_directory_byte_for_byte() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let spec = schemas(&crate_dir.join("../../schema"));
    let copy = schemas(&crate_dir.join("schema"));
    assert!(!spec.is_empty(), "the spec's schema/ has no *.json");
    let spec_names: Vec<&String> = spec.keys().collect();
    let copy_names: Vec<&String> = copy.keys().collect();
    assert_eq!(
        copy_names, spec_names,
        "crates/atip/schema/ lists other files than schema/: copy them with `cp schema/*.json crates/atip/schema/` \
         and remove the ones schema/ no longer has"
    );
    for (name, bytes) in &spec {
        assert!(
            copy[name] == *bytes,
            "crates/atip/schema/{name} differs from schema/{name}: run `cp schema/*.json crates/atip/schema/`"
        );
    }
}
