//! The L1 rows of contracts 1.3 and 1.4: `L1.code-names` (a claim of 1.3 or later), `L1.schemas` and `L1.help-json` (a claim of 1.4), and the 1.3 half of `L1.warnings`.
//!
//! Each row reads the log of the calls [`super::l1_plan`] made and judges the documents with the pure functions of [`super::documents`], which hold the rules:
//! the checks here only say which answer is which. `L1.schemas` and `L1.help-json` are interface checks (approaches/checker.md 3.1): an interface run judges the
//! probe's `--schemas` answer, the refusal of `schema --schemas --json`, `--help --json` and `--version --json`; a deep run judges every command and a group,
//! `<command> --help --json`, `nosuch-xyz --help --json` and `nosuch-xyz --version --json` too.

use serde_json::Value;

use super::documents::{self, Answer, HelpJsonAnswers};
use super::l1::{names_argument, refusal_text};
use super::rules;
use super::{Conditions, End, Finding, Judge};
use crate::exec::Exit;
use crate::l1::invocation::{self, Args};
use crate::l1::model::{CommandDoc, Constraint};
use crate::l1::view;

/// What a call that printed no document gives a rule that reads one: nothing, which is not a refusal.
static NO_DOCUMENT: Value = Value::Null;

impl<'a> Judge<'a> {
    /// The registered finer replacements of `USAGE` (spec 7.3.2) the registry lists.
    fn usage_codes(&self) -> Vec<String> {
        self.tool_errors
            .as_deref()
            .map(view::usage_replacements)
            .unwrap_or_default()
    }

    /// `L1.code-names` (spec 7.2, Annex S2 rule 14): every code of the registry is a core code or follows `<SUBJECT>_<CONDITION>` with its condition's exit and retryability.
    pub(crate) fn l1_code_names(&'a self) -> Finding {
        let mut c = self.check("L1.code-names");
        let Some(entries) = &self.tool_errors else {
            return c.finish_as(End::Unsupported(
                "the tool offers no `schema --errors --json`".to_string(),
            ));
        };
        c.own(self.calls.schema_errors);
        for (condition, problem) in
            documents::code_names_findings(entries, documents::minor_of(self.claim))
        {
            c.holds_at(
                self.calls.schema_errors,
                condition,
                problem.is_none(),
                || problem.clone().unwrap_or_default(),
            );
        }
        c.finish(true)
    }

    /// Every warning code any run emitted is in the warning registry, for a claim of 1.3 or later (spec 7.5.2): `registry` is the entries of `schema --warnings`, none when the
    /// tool offers it not. A code that only the error registry has fails, and so does a tool that emits a warning without offering the registry.
    pub(crate) fn judge_emitted_warnings(
        &self,
        c: &mut Conditions<'a>,
        registry: Option<&[Value]>,
    ) {
        let mut emitted: Vec<String> = Vec::new();
        let mut at: Vec<usize> = Vec::new();
        for (index, document) in self.envelopes() {
            let found = rules::emitted(document).warnings;
            if !found.is_empty() {
                at.push(index);
                emitted.extend(found);
            }
        }
        for (condition, problem) in
            documents::emitted_warnings_findings(self.claim, &emitted, registry)
        {
            if problem.is_some() {
                for index in &at {
                    c.observe(*index);
                }
            }
            c.holds_in(None, condition, problem.is_none(), || {
                problem.clone().unwrap_or_default()
            });
        }
    }

    /// `L1.schemas` (spec 9.1.1, 9.9.3, Annex S2 rules 2, 10): the `schema <path> --schemas --json` answer of each command the run asked, and the refusals of
    /// `schema --schemas --json` and `schema <a group> --schemas --json`.
    pub(crate) fn l1_schemas(&'a self) -> Finding {
        let l1 = self.l1();
        let mut c = self.check("L1.schemas");
        if l1.docs.tree.is_none() {
            return self.no_tree(c);
        }
        for run in &l1.schemas {
            c.own(run.call);
            let Some(doc) = self.docs().command(&run.id) else {
                // A command document that does not read as one is `L1.walk`'s.
                continue;
            };
            match self.ok_envelope(run.call) {
                None => c.holds_at(run.call, "kind", false, || {
                    format!(
                        "{} {}, expected a schemas answer",
                        self.label(run.call),
                        refusal_text(self.envelope(run.call), self.at(run.call).exit)
                    )
                }),
                Some(answer) => {
                    for (condition, problem) in
                        documents::schemas_answer_findings(answer, doc, self.claim)
                    {
                        c.holds_at(run.call, condition, problem.is_none(), || {
                            format!(
                                "{}: {}",
                                self.label(run.call),
                                problem.clone().unwrap_or_default()
                            )
                        });
                    }
                }
            }
        }
        let refusals: Vec<(&str, &Value)> = l1
            .schemas_refusals
            .iter()
            .map(|(call, index)| {
                c.own(*index);
                (call.as_str(), self.envelope(*index).unwrap_or(&NO_DOCUMENT))
            })
            .collect();
        for (condition, problem) in
            documents::schemas_refusal_findings(&refusals, &self.usage_codes())
        {
            c.holds_in(None, condition, problem.is_none(), || {
                problem.clone().unwrap_or_default()
            });
        }
        c.finish(!l1.schemas.is_empty() || !refusals.is_empty())
    }

    /// `L1.help-json` (spec 4.4.1): `--help --json` and `--version --json` refuse with `USAGE` and a hint to `schema` or to `--version`; a deep run also asks `<command> --help --json`,
    /// `nosuch-xyz --help --json` and `nosuch-xyz --version --json`, the path being resolved first.
    pub(crate) fn l1_help_json(&'a self) -> Finding {
        let l1 = self.l1();
        let mut c = self.check("L1.help-json");
        let Some(calls) = &l1.help_json else {
            return c.finish_as(End::Unsupported(
                "the run made no `--help --json` call".to_string(),
            ));
        };
        let answer = |index: usize| Answer {
            exit: match self.at(index).exit {
                Exit::Code(code) => Some(i64::from(code)),
                Exit::Signal(_) | Exit::TimedOut => None,
            },
            document: self.documents[index].as_ref(),
        };
        let nothing = Answer {
            exit: None,
            document: None,
        };
        let answers = HelpJsonAnswers {
            root: answer(calls.root),
            command: calls
                .command
                .as_ref()
                .map_or(nothing, |(_, index)| answer(*index)),
            unknown: calls.unknown.map_or(nothing, answer),
            version: answer(calls.version),
            version_unknown: calls.version_unknown.map(answer),
        };
        let command = calls.command.as_ref().map_or("", |(id, _)| id.as_str());
        let judged = |condition: &str| -> Option<usize> {
            match condition {
                "help-root" => Some(calls.root),
                "help-command" => calls.command.as_ref().map(|(_, index)| *index),
                "help-unknown" => calls.unknown,
                "version" => Some(calls.version),
                _ => None,
            }
        };
        for index in [
            Some(calls.root),
            Some(calls.version),
            calls.unknown,
            calls.version_unknown,
        ]
        .into_iter()
        .chain([calls.command.as_ref().map(|(_, index)| *index)])
        .flatten()
        {
            c.own(index);
        }
        for (condition, problem) in
            documents::help_json_findings(&self.tool, command, &answers, &self.usage_codes())
        {
            // A call a deep run adds is not made in an interface run: its condition is not judged.
            let Some(index) = judged(condition) else {
                continue;
            };
            c.holds_at(index, condition, problem.is_none(), || {
                problem.clone().unwrap_or_default()
            });
        }
        c.finish(true)
    }
}

/// The arguments the caller can add or remove to satisfy the rule `constraint` broken by `args` (spec 9.8.1), and the one that the table of implementation.md 2 names:
/// the first name in the rule's own order, never in argv's. `args` break the rule; `None` for a rule that names no argument to change.
fn constraint_fields<'c>(
    doc: &CommandDoc,
    constraint: &'c Constraint,
    args: &Args,
) -> Option<(Vec<&'c str>, &'c str)> {
    let given = |name: &&'c str| invocation::arg_given(doc, args, name);
    let condition = constraint.if_name.as_deref();
    let (qualifying, table): (Vec<&str>, Option<&str>) = match constraint.rule.as_str() {
        "requires" => {
            let missing: Vec<&str> = constraint
                .then
                .iter()
                .map(String::as_str)
                .filter(|name| !given(name))
                .collect();
            (
                missing.iter().copied().chain(condition).collect(),
                missing.first().copied(),
            )
        }
        "forbids" => {
            let present: Vec<&str> = constraint
                .then
                .iter()
                .map(String::as_str)
                .filter(given)
                .collect();
            (
                present.iter().copied().chain(condition).collect(),
                present.first().copied(),
            )
        }
        "atMostOne" | "exactlyOne" | "atLeastOne" => {
            let names: Vec<&str> = constraint.names.iter().map(String::as_str).collect();
            let present: Vec<&str> = names.iter().copied().filter(given).collect();
            let all = constraint.rule == "atLeastOne" || present.is_empty();
            let chosen = if all { names } else { present };
            let first = chosen.first().copied();
            (chosen, first)
        }
        _ => return None,
    };
    table.map(|table| (qualifying, table))
}

impl<'a> Judge<'a> {
    /// The `field` of a constraint's refusal (spec 9.8.1, implementation.md 2) of the invocation `call` that breaks the rules `members` of `doc` alone, read from the
    /// failure it printed, for a claim of 1.3 or later (a claim below 1.3 was never judged on it): it names an argument of a rule that the caller can add or remove to satisfy it
    /// (`field-qualifies`, a MUST), and it is the argument the table of implementation.md 2 names (`field-follows-the-rule`, a recommendation: another qualifying argument is an advisory).
    pub(crate) fn judge_constraint_field(
        &self,
        c: &mut Conditions<'a>,
        doc: &CommandDoc,
        members: &[usize],
        words: &[String],
        call: usize,
    ) {
        if !self.claim.declares_1_3() {
            return;
        }
        let Ok(parsed) = invocation::parse(doc, words) else {
            return;
        };
        let args = invocation::args(doc, &parsed);
        let rules: Vec<(Vec<&str>, &str)> = members
            .iter()
            .filter_map(|index| doc.constraints.get(*index))
            .filter_map(|constraint| constraint_fields(doc, constraint, &args))
            .collect();
        if rules.is_empty() {
            return;
        }
        let field = self
            .failure(call)
            .and_then(|(_, field)| field)
            .map(str::to_string);
        let names = |wanted: &[&str]| {
            field.as_deref().is_some_and(|field| {
                wanted
                    .iter()
                    .filter_map(|name| doc.arg(name))
                    .any(|arg| names_argument(field, arg))
            })
        };
        let shown = field.as_deref().unwrap_or("no field");
        let qualifying: Vec<&str> = rules
            .iter()
            .flat_map(|(qualifying, _)| qualifying.iter().copied())
            .collect();
        let tables: Vec<&str> = rules.iter().map(|(_, table)| *table).collect();
        let qualifies = names(&qualifying);
        c.holds_at(call, "field-qualifies", qualifies, || {
            format!(
                "{}: `{}` was refused on {shown}, which the caller can neither add nor remove to satisfy the rule: expected one of {}",
                doc.command,
                words.join(" "),
                qualifying.join(", ")
            )
        });
        if !qualifies {
            return;
        }
        let why = || {
            format!(
                "{}: `{}` was refused on {shown}; the rule names {} first (implementation.md 2)",
                doc.command,
                words.join(" "),
                tables.join(" or ")
            )
        };
        c.recommends("field-follows-the-rule", names(&tables), why);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn doc() -> CommandDoc {
        let option = |name: &str, value_type: &str| json!({"name": name, "valueType": value_type, "required": false, "repeatable": false, "default": null, "valueName": name.to_uppercase(), "help": "h"});
        CommandDoc::parse(&json!({
            "kind": "command", "command": "case close", "path": ["case", "close"], "effect": "write",
            "operands": [],
            "options": [
                option("disposition", "string"), option("reason", "string"), option("note", "string"),
                option("a", "string"), option("b", "string"), option("c", "string"),
            ],
            "constraints": [
                {"rule": "requires", "if": {"name": "disposition"}, "then": ["reason", "note"]},
                {"rule": "forbids", "if": {"name": "disposition"}, "then": ["a", "b"]},
                {"rule": "atMostOne", "names": ["a", "b", "c"]},
                {"rule": "exactlyOne", "names": ["reason", "note"]},
                {"rule": "atLeastOne", "names": ["b", "c"]}
            ]
        }))
        .expect("a command")
    }

    fn fields(command_line: &[&str], rule: usize) -> Option<(Vec<String>, String)> {
        let doc = doc();
        let words: Vec<String> = command_line
            .iter()
            .map(|word| (*word).to_string())
            .collect();
        let parsed = invocation::parse(&doc, &words).expect("parses");
        let args = invocation::args(&doc, &parsed);
        constraint_fields(&doc, &doc.constraints[rule], &args).map(|(qualifying, table)| {
            (
                qualifying.into_iter().map(str::to_string).collect(),
                table.to_string(),
            )
        })
    }

    #[test]
    fn atip_check14_53_a_constraint_field_is_the_first_argument_of_the_rules_own_order_among_those_the_caller_can_add_or_remove(
    ) {
        // requires: the first name in `then` that is not given; the condition's own argument can be removed too.
        let (qualifying, table) =
            fields(&["case", "close", "--disposition=x", "--note=n"], 0).expect("broken");
        assert_eq!(
            (qualifying, table),
            (
                vec!["reason".into(), "disposition".into()],
                "reason".to_string()
            )
        );
        // forbids: the first name in `then` that is given.
        let (_, table) =
            fields(&["case", "close", "--disposition=x", "--b=1", "--a=1"], 1).expect("broken");
        assert_eq!(table, "a");
        // atMostOne: the first given name in `names`, never argv's first.
        let (qualifying, table) = fields(&["case", "close", "--c=1", "--a=1"], 2).expect("broken");
        assert_eq!(
            (qualifying, table),
            (vec!["a".into(), "c".into()], "a".to_string())
        );
        // exactlyOne with none given: the first name; with more than one given: the first given.
        let (qualifying, table) = fields(&["case", "close"], 3).expect("broken");
        assert_eq!(
            (qualifying, table),
            (vec!["reason".into(), "note".into()], "reason".to_string())
        );
        let (_, table) = fields(&["case", "close", "--note=n", "--reason=r"], 3).expect("broken");
        assert_eq!(table, "reason");
        // atLeastOne with none given: the first name.
        let (_, table) = fields(&["case", "close"], 4).expect("broken");
        assert_eq!(table, "b");
    }
}
