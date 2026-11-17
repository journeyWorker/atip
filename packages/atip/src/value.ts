/**
 * Whether a value is within an argument's domain (Annex V1: the profile keywords of its valueType), and whether a JSON
 * value is a value of an argument as its description states it: what a constraint's `in` lists must be (spec 9.8.1).
 * The parser and the declaration checks share `domainProblem`, so a bound reads the same wherever it is enforced.
 */
import type { ArgumentDescription, Domain } from "./description.ts";
import type { Json } from "./json.ts";

const bound = (domain: Domain, keyword: string): number | undefined => {
  const value = domain[keyword];
  return typeof value === "number" ? value : undefined;
};

/**
 * What a value must be to satisfy the domain it breaks (`at least 1`, `a multiple of 5`, the pattern's description),
 * or undefined when it satisfies it. Lengths count code points, as JSON Schema does; `multipleOf` holds when the
 * quotient is an integer, as JSON Schema validators read it.
 */
export const domainProblem = (domain: Domain, value: string | number): string | undefined => {
  if (typeof value === "number") {
    const minimum = bound(domain, "minimum");
    if (minimum !== undefined && value < minimum) return `at least ${minimum}`;
    const maximum = bound(domain, "maximum");
    if (maximum !== undefined && value > maximum) return `at most ${maximum}`;
    const exclusiveMinimum = bound(domain, "exclusiveMinimum");
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum)
      return `more than ${exclusiveMinimum}`;
    const exclusiveMaximum = bound(domain, "exclusiveMaximum");
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum)
      return `less than ${exclusiveMaximum}`;
    const multipleOf = bound(domain, "multipleOf");
    if (multipleOf !== undefined && !Number.isInteger(value / multipleOf))
      return `a multiple of ${multipleOf}`;
    return undefined;
  }
  const length = Array.from(value).length;
  const minLength = bound(domain, "minLength");
  if (minLength !== undefined && length < minLength) return `at least ${minLength} characters`;
  const maxLength = bound(domain, "maxLength");
  if (maxLength !== undefined && length > maxLength) return `at most ${maxLength} characters`;
  const { pattern, description } = domain;
  if (typeof pattern === "string" && !new RegExp(pattern, "u").test(value))
    return typeof description === "string" ? description : `matching ${pattern}`;
  return undefined;
};

/** Why a value breaks an argument's domain, as one sentence about the value (undefined: it does not). */
const valueDomainProblem = (domain: Domain | undefined, value: string | number) => {
  const problem = domain === undefined ? undefined : domainProblem(domain, value);
  return problem === undefined ? undefined : `${JSON.stringify(value)} must be ${problem}`;
};

/**
 * Why a value is not a valid value of an argument (spec 9.8.1: a constraint's `in` values are), by its valueType and
 * domain; a switch or a count takes no `in`. A `json` argument's value is checked for being one (not `null`) only.
 */
export const inValueProblem = (argument: ArgumentDescription, value: Json): string | undefined => {
  const shown = JSON.stringify(value);
  switch (argument.valueType) {
    case "switch":
    case "count":
      return `a ${argument.valueType} takes no in (spec 9.8.1)`;
    case "enum":
      return typeof value === "string" && (argument.possibleValues ?? []).includes(value)
        ? undefined
        : `${shown} is not one of ${(argument.possibleValues ?? []).join(", ")}`;
    case "json":
      return value === null ? "null is no json value" : undefined;
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value)
        ? valueDomainProblem(argument.domain, value)
        : `${shown} is not an integer`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? valueDomainProblem(argument.domain, value)
        : `${shown} is not a number`;
    default:
      return typeof value === "string"
        ? valueDomainProblem(argument.domain, value)
        : `${shown} is not a string`;
  }
};
