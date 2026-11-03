//! The fragment schema of one `--input` document, derived from a command's operands and options (spec 9.9.2, 10.5).
//!
//! In a 1.4 document the fragment schema is not declared: it is a function of the arguments, so it can never disagree with
//! them. It is an object with `additionalProperties: false` and no `required`, whose properties are
//!
//! - `operands`: an array of the operand values, at least one (`minItems: 1`), at most one per operand unless the last is
//!   variadic;
//! - one property per option of the full option set that is not flag-only, under its camelCase name, admitting the values
//!   of its `valueType` as a document spells them (spec 9.7.2): an array of them when the option is repeatable (a `count`
//!   stays one non-negative integer). The array has no `minItems`: a tool reads `[]` as none or refuses it with
//!   `INPUT_INVALID` and the pointer, and both conform (1.4.2).
//!
//! Domains are not part of it: they are checked at step 6 of spec 10.7. [`Fragment`] serializes its members in the order
//! above, so the text a tool prints is the same on every run; [`derived_fragment`] is the same schema as a [`Value`] (whose
//! members a `serde_json` build without `preserve_order` sorts), the form a comparison reads. The schemas answer holds the
//! fragment under the name `Input` ([`crate::describe::Described::schemas`]), and a checker compares it with its own derivation.

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::Value;

use crate::doc::{OperandDoc, OptionDoc, ValueType};
use crate::project::{camel_case, INTEGER_PATTERN, NUMBER_PATTERN};

/// `{"type": <kind>}`.
#[derive(Debug, Serialize)]
struct OfType {
    #[serde(rename = "type")]
    kind: &'static str,
}

/// `{"type": "integer", "minimum": 0}`: a count.
#[derive(Debug, Serialize)]
struct NonNegative {
    #[serde(rename = "type")]
    kind: &'static str,
    minimum: u8,
}

/// `{"type": "string", "pattern": <pattern>}`: a number spelled as a string.
#[derive(Debug, Serialize)]
struct Spelled {
    #[serde(rename = "type")]
    kind: &'static str,
    pattern: &'static str,
}

/// `{"anyOf": [{"type": <number type>}, {"type": "string", "pattern": <pattern>}]}`.
#[derive(Debug, Serialize)]
struct NumberOrSpelled {
    #[serde(rename = "anyOf")]
    any_of: (OfType, Spelled),
}

/// `{"enum": [..]}`.
#[derive(Debug, Serialize)]
struct Members<'a> {
    #[serde(rename = "enum")]
    members: &'a [String],
}

/// `{"not": {"type": "null"}}`: any JSON value but a top-level `null` (a `json` argument).
#[derive(Debug, Serialize)]
struct NotNull {
    not: OfType,
}

/// What a document may hold for one value of an argument (spec 9.7.2).
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Encoded<'a> {
    Plain(OfType),
    Count(NonNegative),
    Spelled(NumberOrSpelled),
    Members(Members<'a>),
    Anything(NotNull),
    /// The boolean schema `false`: no further operand.
    Nothing(bool),
}

fn encoded<'a>(value_type: ValueType, members: Option<&'a [String]>) -> Encoded<'a> {
    let number = |kind, pattern| {
        Encoded::Spelled(NumberOrSpelled {
            any_of: (
                OfType { kind },
                Spelled {
                    kind: "string",
                    pattern,
                },
            ),
        })
    };
    match value_type {
        ValueType::Switch => Encoded::Plain(OfType { kind: "boolean" }),
        ValueType::Count => Encoded::Count(NonNegative {
            kind: "integer",
            minimum: 0,
        }),
        ValueType::String | ValueType::Path => Encoded::Plain(OfType { kind: "string" }),
        ValueType::Integer => number("integer", INTEGER_PATTERN),
        ValueType::Number => number("number", NUMBER_PATTERN),
        ValueType::Enum => Encoded::Members(Members {
            members: members.unwrap_or_default(),
        }),
        ValueType::Json => Encoded::Anything(NotNull {
            not: OfType { kind: "null" },
        }),
    }
}

/// `{"type": "array", "items": <items>}`: the document value of a repeatable option.
#[derive(Debug, Serialize)]
struct Several<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    items: Encoded<'a>,
}

/// The `operands` property.
#[derive(Debug, Serialize)]
struct Operands<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(rename = "minItems")]
    min_items: u8,
    #[serde(rename = "maxItems", skip_serializing_if = "Option::is_none")]
    max_items: Option<usize>,
    #[serde(rename = "prefixItems", skip_serializing_if = "Vec::is_empty")]
    prefix_items: Vec<Encoded<'a>>,
    items: Encoded<'a>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Property<'a> {
    Operands(Operands<'a>),
    One(Encoded<'a>),
    Several(Several<'a>),
}

/// The members of `properties`, in the order of the operands and then of the options.
#[derive(Debug)]
struct Properties<'a>(Vec<(String, Property<'a>)>);

impl Serialize for Properties<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (name, property) in &self.0 {
            map.serialize_entry(name, property)?;
        }
        map.end()
    }
}

/// The derived fragment schema of one command (spec 9.9.2); see the module.
#[derive(Debug, Serialize)]
pub struct Fragment<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(rename = "additionalProperties")]
    additional_properties: bool,
    properties: Properties<'a>,
}

impl<'a> Fragment<'a> {
    /// The fragment of a command whose operands are `operands` and whose full option set is `options`: the options
    /// the command lists, and the ones its document implies (spec 9.5), which are all flag-only and so leave no property.
    pub fn of(operands: &'a [OperandDoc], options: &'a [OptionDoc]) -> Self {
        let mut properties = Vec::with_capacity(options.len() + 1);
        if let Some(last) = operands.last() {
            let fixed = if last.variadic {
                &operands[..operands.len() - 1]
            } else {
                operands
            };
            let of = |operand: &'a OperandDoc| {
                encoded(operand.value_type, operand.possible_values.as_deref())
            };
            properties.push((
                "operands".to_string(),
                Property::Operands(Operands {
                    kind: "array",
                    min_items: 1,
                    max_items: (!last.variadic).then_some(operands.len()),
                    prefix_items: fixed.iter().map(of).collect(),
                    items: if last.variadic {
                        of(last)
                    } else {
                        Encoded::Nothing(false)
                    },
                }),
            ));
        }
        for option in options.iter().filter(|option| !option.flag_only) {
            let value = encoded(option.value_type, option.possible_values.as_deref());
            let property = if option.repeatable && option.value_type != ValueType::Count {
                Property::Several(Several {
                    kind: "array",
                    items: value,
                })
            } else {
                Property::One(value)
            };
            properties.push((camel_case(&option.name), property));
        }
        Fragment {
            kind: "object",
            additional_properties: false,
            properties: Properties(properties),
        }
    }

    /// The fragment as a JSON value.
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("a fragment schema serializes")
    }
}

/// The derived fragment schema of a command with `operands` and the full option set `options`, as a JSON value (spec 9.9.2).
pub fn derived_fragment(operands: &[OperandDoc], options: &[OptionDoc]) -> Value {
    Fragment::of(operands, options).to_value()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn option(name: &str, value_type: ValueType) -> OptionDoc {
        OptionDoc {
            name: name.to_string(),
            short: None,
            value_name: None,
            value_type,
            possible_values: None,
            required: false,
            repeatable: false,
            default: Value::Null,
            default_note: None,
            env: None,
            flag_only: false,
            domain: None,
            help: "h".to_string(),
        }
    }

    fn operand(name: &str, variadic: bool) -> OperandDoc {
        OperandDoc {
            name: name.to_string(),
            value_name: name.to_uppercase(),
            value_type: ValueType::String,
            possible_values: None,
            required: true,
            variadic,
            default: Value::Null,
            default_note: None,
            domain: None,
            help: "h".to_string(),
        }
    }

    #[test]
    fn atip_crate14_05_the_fragment_has_no_required_and_one_property_per_option_that_is_not_flag_only(
    ) {
        let mut limit = option("limit", ValueType::Integer);
        limit.flag_only = true;
        let mut tags = option("tag", ValueType::String);
        tags.repeatable = true;
        let mut kind = option("kind", ValueType::Enum);
        kind.possible_values = Some(vec!["a".to_string(), "b".to_string()]);
        let options = [
            limit,
            option("dry-run", ValueType::Switch),
            tags,
            kind,
            option("verbose", ValueType::Count),
            option("weight", ValueType::Number),
            option("scope", ValueType::Json),
            option("round", ValueType::Integer),
        ];
        let fragment = derived_fragment(&[operand("page", false)], &options);
        assert_eq!(
            fragment,
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "operands": { "type": "array", "minItems": 1, "maxItems": 1, "prefixItems": [{ "type": "string" }], "items": false },
                    "dryRun": { "type": "boolean" },
                    "tag": { "type": "array", "items": { "type": "string" } },
                    "kind": { "enum": ["a", "b"] },
                    "verbose": { "type": "integer", "minimum": 0 },
                    "weight": { "anyOf": [{ "type": "number" }, { "type": "string", "pattern": NUMBER_PATTERN }] },
                    "scope": { "not": { "type": "null" } },
                    "round": { "anyOf": [{ "type": "integer" }, { "type": "string", "pattern": INTEGER_PATTERN }] },
                }
            })
        );
        assert!(
            fragment.get("required").is_none(),
            "a fragment never has a root `required`"
        );
    }

    #[test]
    fn atip_crate14_06_a_repeatable_option_is_a_plain_array_and_a_count_stays_one_integer() {
        let mut repeated = option("label", ValueType::String);
        repeated.repeatable = true;
        let mut count = option("verbose", ValueType::Count);
        count.repeatable = true;
        let fragment = derived_fragment(&[], &[repeated, count]);
        assert_eq!(
            fragment["properties"]["label"],
            json!({ "type": "array", "items": { "type": "string" } }),
            "no minItems: `[]` is read as none or refused, both conform (1.4.2)"
        );
        assert_eq!(
            fragment["properties"]["verbose"],
            json!({ "type": "integer", "minimum": 0 })
        );
        assert!(
            fragment["properties"].get("operands").is_none(),
            "no operands, no property"
        );
    }

    #[test]
    fn atip_crate14_07_operands_are_one_per_operand_unless_the_last_is_variadic() {
        let fixed = derived_fragment(&[operand("a", false), operand("b", false)], &[]);
        assert_eq!(
            fixed["properties"]["operands"],
            json!({ "type": "array", "minItems": 1, "maxItems": 2, "prefixItems": [{ "type": "string" }, { "type": "string" }], "items": false })
        );
        let variadic = derived_fragment(&[operand("a", false), operand("rest", true)], &[]);
        assert_eq!(
            variadic["properties"]["operands"],
            json!({ "type": "array", "minItems": 1, "prefixItems": [{ "type": "string" }], "items": { "type": "string" } })
        );
        let only = derived_fragment(&[operand("file", true)], &[]);
        assert_eq!(
            only["properties"]["operands"],
            json!({ "type": "array", "minItems": 1, "items": { "type": "string" } })
        );
    }

    #[test]
    fn atip_crate14_08_the_text_of_a_fragment_is_in_the_order_of_the_operands_and_options() {
        let options = [
            option("zeta", ValueType::String),
            option("alpha", ValueType::Switch),
        ];
        let text =
            serde_json::to_string(&Fragment::of(&[operand("x", false)], &options)).expect("text");
        assert_eq!(
            text,
            r#"{"type":"object","additionalProperties":false,"properties":{"operands":{"type":"array","minItems":1,"maxItems":1,"prefixItems":[{"type":"string"}],"items":false},"zeta":{"type":"string"},"alpha":{"type":"boolean"}}}"#
        );
    }
}
