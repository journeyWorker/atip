//! `atip skills show`: the guides for agents built into the binary (spec 14), embedded at build time from
//! `crates/atip-check/guides/`, so a guide always matches the binary it ships in and reads no state.

use serde::Serialize;

use crate::cli::CommandId;
use crate::output::{self, Code, Failure};

/// The guide `skills show` prints without a name.
pub const DEFAULT: &str = "checker";

/// Every guide of this build: its name and its Markdown. The first is [`DEFAULT`].
pub const GUIDES: [(&str, &str); 1] = [(DEFAULT, include_str!("../guides/checker.md"))];

/// The name of every guide, in the order of [`GUIDES`].
pub fn names() -> Vec<&'static str> {
    GUIDES.iter().map(|(name, _)| *name).collect()
}

/// The `data` of `skills show --json` (`schema/guide.schema.json`).
#[derive(Debug, Serialize)]
pub struct Guide {
    pub name: &'static str,
    pub text: &'static str,
    pub guides: Vec<&'static str>,
}

/// The guide named `name`, the default one for `None`; `None` for a name that is no guide (the command line refuses it first).
pub fn guide(name: Option<&str>) -> Option<Guide> {
    let wanted = name.unwrap_or(DEFAULT);
    GUIDES
        .iter()
        .find(|(name, _)| *name == wanted)
        .map(|(name, text)| Guide {
            name,
            text,
            guides: names(),
        })
}

/// `atip skills show [NAME]`: the guide as Markdown, or in JSON mode the envelope whose `data` is [`Guide`] (spec 14.1). The
/// command line has refused a name that is no guide; were one to arrive here, it is a bug of this build.
pub fn answer(name: Option<&str>, json: bool) -> Result<String, Failure> {
    let shown = guide(name).ok_or_else(|| {
        Failure::new(
            Code::Internal,
            format!("atip hit a bug: {} is not a guide", name.unwrap_or(DEFAULT)),
        )
        .in_command(CommandId::SkillsShow.name())
    })?;
    Ok(if json {
        output::answer_line(CommandId::SkillsShow, &shown)
    } else {
        shown.text.trim_end().to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{guide, names, DEFAULT, GUIDES};

    #[test]
    fn atip_check_guides_01_every_guide_validates_lists_every_name_and_its_command_lines_parse() {
        assert_eq!(GUIDES[0].0, DEFAULT);
        for name in names() {
            let shown = guide(Some(name)).expect("a guide");
            let data = serde_json::to_value(&shown).expect("json");
            assert_eq!(atip::guide_problems(&data), Vec::<String>::new(), "{name}");
            assert_eq!(shown.guides, names());
            // Spec 14.3: every fenced line that starts with `atip` parses once its placeholders are substituted.
            let mut fenced = false;
            for line in shown.text.lines() {
                if line.starts_with("```") {
                    fenced = !fenced;
                    continue;
                }
                let Some(words) = line.strip_prefix("atip ").filter(|_| fenced) else {
                    continue;
                };
                let words = words
                    .replace("<BINARY>", "atip")
                    .replace("<FILE>", "f.json")
                    .replace("<LEVEL>", "L0");
                let argv: Vec<std::ffi::OsString> = atip::split_argv(&words)
                    .into_iter()
                    .map(Into::into)
                    .collect();
                assert!(crate::cli::parse(&argv).is_ok(), "{name}: {line}");
            }
        }
        assert_eq!(guide(None).expect("the default").name, DEFAULT);
        assert!(guide(Some("nosuch")).is_none());
    }
}
