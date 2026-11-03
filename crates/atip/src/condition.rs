//! The code-name convention of spec 7.2 (a document that declares 1.3 or later): a tool's own error code is
//! `<SUBJECT>_<CONDITION>`, and the condition fixes the exit and gives the default retryability.
//!
//! [`Condition`] is the fifteen conditions of 7.2.2 with their exit and retryability, [`Condition::of_code`] reads a code's
//! condition (and subject) out of its name, and [`code_name_problem`] is the check a tool's own tests and the checker's
//! `L1.code-names` share. Whether a subject is a noun and not a verb is the author's judgement (`approaches/implementation.md`
//! §7); nothing here decides it.

use crate::error::{CodeInfo, ReasonInfo, EXIT_FAILED, EXIT_REFUSED};
use crate::minor::Minor;
use crate::reserved::{reserved_code, RESERVED_CODES};

/// One of the fifteen conditions of spec 7.2.2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Condition {
    Invalid,
    Required,
    NotFound,
    Exists,
    Conflict,
    Stale,
    Expired,
    Denied,
    Unsupported,
    TooLarge,
    Corrupt,
    Unavailable,
    Failed,
    Incomplete,
    Timeout,
}

impl Condition {
    /// Every condition, in the order of spec 7.2.2.
    pub const ALL: [Condition; 15] = [
        Condition::Invalid,
        Condition::Required,
        Condition::NotFound,
        Condition::Exists,
        Condition::Conflict,
        Condition::Stale,
        Condition::Expired,
        Condition::Denied,
        Condition::Unsupported,
        Condition::TooLarge,
        Condition::Corrupt,
        Condition::Unavailable,
        Condition::Failed,
        Condition::Incomplete,
        Condition::Timeout,
    ];

    /// The last word(s) of a code with this condition: `NOT_FOUND`.
    pub const fn suffix(self) -> &'static str {
        match self {
            Condition::Invalid => "INVALID",
            Condition::Required => "REQUIRED",
            Condition::NotFound => "NOT_FOUND",
            Condition::Exists => "EXISTS",
            Condition::Conflict => "CONFLICT",
            Condition::Stale => "STALE",
            Condition::Expired => "EXPIRED",
            Condition::Denied => "DENIED",
            Condition::Unsupported => "UNSUPPORTED",
            Condition::TooLarge => "TOO_LARGE",
            Condition::Corrupt => "CORRUPT",
            Condition::Unavailable => "UNAVAILABLE",
            Condition::Failed => "FAILED",
            Condition::Incomplete => "INCOMPLETE",
            Condition::Timeout => "TIMEOUT",
        }
    }

    /// The exit the condition fixes: 1 for `FAILED`, `INCOMPLETE` and `TIMEOUT` (the command ran), 2 for every other (it refused).
    pub const fn exit(self) -> u8 {
        match self {
            Condition::Failed | Condition::Incomplete | Condition::Timeout => EXIT_FAILED,
            _ => EXIT_REFUSED,
        }
    }

    /// The default retryability: `UNAVAILABLE` and `TIMEOUT` are retryable, every other condition is not.
    pub const fn retryable(self) -> bool {
        matches!(self, Condition::Unavailable | Condition::Timeout)
    }

    /// Whether a code of this condition MAY be registered with either retryability (spec 7.2.3): `FAILED`, `INCOMPLETE` and
    /// `TIMEOUT`, retryable exactly when repeating the same invocation is safe.
    pub const fn retryable_either_way(self) -> bool {
        matches!(
            self,
            Condition::Failed | Condition::Incomplete | Condition::Timeout
        )
    }

    /// The condition whose [`suffix`](Self::suffix) is `word`.
    pub fn parse(word: &str) -> Option<Condition> {
        Condition::ALL
            .into_iter()
            .find(|condition| condition.suffix() == word)
    }

    /// The subject and the condition of `code`, or `None` when the name does not follow the grammar of spec 7.2.1: a non-empty
    /// subject (`UPPER *( UPPER / DIGIT ) *( "_" 1*( UPPER / DIGIT ) )`), an underscore and one of the fifteen conditions.
    pub fn of_code(code: &str) -> Option<(&str, Condition)> {
        Condition::ALL.into_iter().find_map(|condition| {
            let subject = code.strip_suffix(condition.suffix())?.strip_suffix('_')?;
            is_subject(subject).then_some((subject, condition))
        })
    }
}

/// Whether `subject` is a subject of spec 7.2.1.
fn is_subject(subject: &str) -> bool {
    let mut words = subject.split('_');
    let first = words.next().unwrap_or_default();
    let mut chars = first.chars();
    let starts_upper = chars.next().is_some_and(|c| c.is_ascii_uppercase());
    starts_upper
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && words.all(|word| {
            !word.is_empty()
                && word
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        })
}

/// What is wrong with the name, exit and retryability of `code` for a document that declares `minor` (spec 7.2.3): `None` for a
/// document that declares less than 1.3 (code names are the tool's own then), for a core code (7.3.1, which
/// [`crate::registration_problem`] judges) and for a code that follows the convention with its condition's exit and retryability.
/// An exit or retryability the registry does not state is `None` in the arguments and is never read as right.
pub fn code_name_problem(
    minor: Minor,
    code: &str,
    exit: Option<i64>,
    retryable: Option<bool>,
) -> Option<String> {
    if !minor.at_least(Minor::V1_3) || reserved_code(code, minor).is_some() {
        return None;
    }
    let Some((_, condition)) = Condition::of_code(code) else {
        return Some(format!(
            "{code} is neither a core code nor <SUBJECT>_<CONDITION> with one of the conditions {}",
            Condition::ALL.map(Condition::suffix).join(", ")
        ));
    };
    let wrong_exit = exit != Some(i64::from(condition.exit()));
    let wrong_retryable = match retryable {
        None => true,
        Some(flag) => !condition.retryable_either_way() && flag != condition.retryable(),
    };
    (wrong_exit || wrong_retryable).then(|| {
        format!(
            "{code} is exit {} retryable {}, its condition {} fixes exit {} and retryable {}{}",
            exit.map_or("?".to_string(), |exit| exit.to_string()),
            retryable.map_or("?".to_string(), |flag| flag.to_string()),
            condition.suffix(),
            condition.exit(),
            condition.retryable(),
            if condition.retryable_either_way() {
                " or true (a FAILED, INCOMPLETE or TIMEOUT code is registered either way)"
            } else {
                ""
            }
        )
    })
}

const fn bytes_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut at = 0;
    while at < a.len() {
        if a[at] != b[at] {
            return false;
        }
        at += 1;
    }
    true
}

/// [`is_subject`] for a `const` context: non-empty, starts with `A-Z`, then `A-Z`, `0-9` and single `_` between words, no
/// `_` at either end.
const fn is_subject_const(subject: &[u8]) -> bool {
    if subject.is_empty() || !subject[0].is_ascii_uppercase() || subject[subject.len() - 1] == b'_'
    {
        return false;
    }
    let mut at = 1;
    while at < subject.len() {
        let byte = subject[at];
        let word_byte = byte.is_ascii_uppercase() || byte.is_ascii_digit();
        if !(word_byte || (byte == b'_' && subject[at - 1] != b'_')) {
            return false;
        }
        at += 1;
    }
    true
}

/// Whether `code` is `<subject>_<suffix of condition>` with a subject of spec 7.2.1.
const fn names_condition(code: &str, condition: Condition) -> bool {
    let (code, suffix) = (code.as_bytes(), condition.suffix().as_bytes());
    if code.len() <= suffix.len() + 1 || code[code.len() - suffix.len() - 1] != b'_' {
        return false;
    }
    let (subject, tail) = code.split_at(code.len() - suffix.len() - 1);
    let (_, word) = tail.split_at(1);
    bytes_equal(word, suffix) && is_subject_const(subject)
}

/// Whether `code` is a core code (spec 7.3.1) of any minor: a tool's own code never takes one's name (spec 7.2.3).
const fn is_core_name(code: &str) -> bool {
    let mut at = 0;
    while at < RESERVED_CODES.len() {
        if bytes_equal(RESERVED_CODES[at].name.as_bytes(), code.as_bytes()) {
            return true;
        }
        at += 1;
    }
    false
}

impl CodeInfo {
    /// The row of a tool's own error code `code`, which is `<SUBJECT>_<CONDITION>` (spec 7.2.1): its `exit` and its
    /// `retryable` are the condition's (spec 7.2.2), never a call site's. A code that is not `<subject>_<suffix of condition>`,
    /// whose subject breaks the grammar, or that takes a core code's name does not build: in a `const` or `static` initializer
    /// that is a compile error, so a table of rows cannot hold one. A code whose condition may be registered either way
    /// (`FAILED`, `INCOMPLETE`, `TIMEOUT`) and is retryable takes [`CodeInfo::of_retryable`].
    ///
    /// The name is written out in full because a `const` cannot join strings; naming the condition beside it is what lets the
    /// compiler check the one against the other. Whether the subject is a noun is the author's (`approaches/implementation.md` §7).
    ///
    /// # Panics
    /// As above, when the arguments do not build a row (a compile error in a `const` context).
    pub const fn of(
        code: &'static str,
        condition: Condition,
        meaning: &'static str,
        fix: &'static str,
        reasons: &'static [ReasonInfo],
    ) -> CodeInfo {
        assert!(
            names_condition(code, condition),
            "the code is not <SUBJECT>_<CONDITION> with the condition given (spec 7.2.1)"
        );
        assert!(
            !is_core_name(code),
            "a tool's own code never takes a core code's name (spec 7.2.3)"
        );
        CodeInfo {
            code,
            meaning,
            exit: condition.exit(),
            retryable: condition.retryable(),
            fix,
            reasons,
        }
    }

    /// [`CodeInfo::of`] for a `FAILED`, `INCOMPLETE` or `TIMEOUT` code with the retryability the tool registers: `true` when
    /// repeating the same invocation is safe (it resumes, or an operation key reconciles it), else `false` (spec 7.2.3). Any
    /// other condition has one retryability, so another value does not build.
    ///
    /// # Panics
    /// As [`CodeInfo::of`], and when the condition is not one of the three.
    pub const fn of_retryable(
        code: &'static str,
        condition: Condition,
        retryable: bool,
        meaning: &'static str,
        fix: &'static str,
        reasons: &'static [ReasonInfo],
    ) -> CodeInfo {
        assert!(
            condition.retryable_either_way() || retryable == condition.retryable(),
            "only a FAILED, INCOMPLETE or TIMEOUT code may differ from the default retryability of its condition (spec 7.2.3)"
        );
        let mut row = CodeInfo::of(code, condition, meaning, fix, reasons);
        row.retryable = retryable;
        row
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atip_crate14_01_the_fifteen_conditions_fix_the_exit_and_the_default_retryability() {
        assert_eq!(Condition::ALL.len(), 15);
        let exit_1: Vec<&str> = Condition::ALL
            .into_iter()
            .filter(|condition| condition.exit() == 1)
            .map(Condition::suffix)
            .collect();
        assert_eq!(exit_1, ["FAILED", "INCOMPLETE", "TIMEOUT"]);
        let retryable: Vec<&str> = Condition::ALL
            .into_iter()
            .filter(|condition| condition.retryable())
            .map(Condition::suffix)
            .collect();
        assert_eq!(retryable, ["UNAVAILABLE", "TIMEOUT"]);
        for condition in Condition::ALL {
            assert_eq!(Condition::parse(condition.suffix()), Some(condition));
        }
        assert_eq!(Condition::parse("REFUSED"), None);
        assert_eq!(Condition::parse("invalid"), None);
    }

    #[test]
    fn atip_crate14_02_a_code_is_read_as_subject_and_condition() {
        assert_eq!(
            Condition::of_code("FINDING_NOT_FOUND"),
            Some(("FINDING", Condition::NotFound))
        );
        assert_eq!(
            Condition::of_code("QUERY_TOO_LARGE"),
            Some(("QUERY", Condition::TooLarge))
        );
        assert_eq!(
            Condition::of_code("S3_BUCKET_UNAVAILABLE"),
            Some(("S3_BUCKET", Condition::Unavailable))
        );
        for bad in [
            "NOT_FOUND",
            "INVALID",
            "_INVALID",
            "FINDING_",
            "PROMOTE_REFUSED",
            "STOPPED_MIDWAY",
            "finding_invalid",
            "FINDING__INVALID",
            "3D_INVALID",
            "FINDINGINVALID",
        ] {
            assert_eq!(Condition::of_code(bad), None, "{bad}");
        }
    }

    #[test]
    fn atip_crate14_03_the_name_exit_and_retryability_are_judged_from_1_3_on() {
        let problem =
            |minor, code, exit, retryable| code_name_problem(minor, code, exit, retryable);
        assert_eq!(
            problem(Minor::V1_3, "FINDING_NOT_FOUND", Some(2), Some(false)),
            None
        );
        assert_eq!(
            problem(Minor::V1_4, "STORE_UNAVAILABLE", Some(2), Some(true)),
            None
        );
        // A FAILED, INCOMPLETE or TIMEOUT code is registered either way.
        for retryable in [false, true] {
            for code in [
                "STORE_FAILED",
                "DEPLOYMENT_INCOMPLETE",
                "DEPLOYMENT_TIMEOUT",
            ] {
                assert_eq!(problem(Minor::V1_3, code, Some(1), Some(retryable)), None);
            }
        }
        assert!(
            problem(Minor::V1_3, "PROMOTE_REFUSED", Some(1), Some(false))
                .expect("no condition")
                .contains("PROMOTE_REFUSED")
        );
        assert!(
            problem(Minor::V1_3, "FINDING_NOT_FOUND", Some(1), Some(false))
                .expect("wrong exit")
                .contains("fixes exit 2")
        );
        assert!(problem(Minor::V1_3, "STORE_UNAVAILABLE", Some(2), Some(false)).is_some());
        assert!(problem(Minor::V1_3, "FINDING_INVALID", Some(2), Some(true)).is_some());
        assert!(problem(Minor::V1_3, "FINDING_INVALID", None, Some(false)).is_some());
        assert!(problem(Minor::V1_3, "FINDING_INVALID", Some(2), None).is_some());
        // `STOPPED_MIDWAY` ends in no condition once it is no core code.
        assert!(problem(Minor::V1_3, "STOPPED_MIDWAY", Some(1), Some(false)).is_some());
        assert_eq!(
            problem(Minor::V1_2, "STOPPED_MIDWAY", Some(1), Some(false)),
            None
        );
        // Core codes are `registration_problem`'s, whatever their names; earlier minors have no naming rule.
        assert_eq!(problem(Minor::V1_4, "USAGE", Some(2), Some(false)), None);
        assert_eq!(
            problem(Minor::V1_4, "PLAN_STALE", Some(2), Some(false)),
            None
        );
        assert_eq!(
            problem(Minor::V1_2, "PROMOTE_REFUSED", Some(1), Some(false)),
            None
        );
    }
}
