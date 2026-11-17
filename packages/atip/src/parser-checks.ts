/**
 * What a command declares about its arguments, enforced by the parser from its description (spec 9.7.4, 9.8, 10.7
 * step 6): every value of its type and within its `domain`, every constraint. `schema` prints the same description,
 * so what a caller reads is what the parser checks. Validators are the command's own code (they are outside the
 * profile) and run after the parser.
 */
import type {
  ArgumentDescription,
  CommandDescription,
  ConstraintDescription,
  OptionDescription,
} from "./description.ts";
import { argvValues, INTEGER_PATTERN, typedValue } from "./description.ts";
import { type ArgvRefusal, fixedOrder, type ParserProfile } from "./parser-profile.ts";
import { suggest } from "./suggest.ts";
import { domainProblem } from "./value.ts";

/** One option's argv value: a switch `true`, a repeatable option its values, else its text. */
export type ArgvValue = string | true | ReadonlyArray<string>;

const INTEGER = new RegExp(INTEGER_PATTERN);

const valuesOf = (value: ArgvValue | undefined): ReadonlyArray<string> =>
  value === undefined || value === true ? [] : typeof value === "string" ? [value] : value;

/** Why one value is not of its argument's type, or undefined: a parse failure (spec 10.7 step 6, since 1.2). */
export const typeProblem = (
  profile: ParserProfile,
  command: CommandDescription,
  argument: ArgumentDescription,
  field: string,
  text: string,
): ArgvRefusal | undefined => {
  const type = argument.valueType;
  if (type === "switch" || type === "enum" || typedValue(type, text) !== undefined)
    return undefined;
  return {
    // an operand's own refusal code is OPERAND_INVALID, an option's OPTION_VALUE_INVALID
    code: field.startsWith("--") ? "OPTION_VALUE_INVALID" : "OPERAND_INVALID",
    message:
      type === "integer" && INTEGER.test(text)
        ? `${field} is outside ±(2^53-1): ${profile.name} never rounds an integer`
        : `${field} must be ${type === "json" ? "JSON (not null)" : type === "number" ? "a number" : "an integer"}`,
    field,
    received: text,
    hint: profile.hint.arguments(command),
  };
};

/** Why a value is not among an option's possible values, or undefined. */
export const possibleValueProblem = (
  profile: ParserProfile,
  command: CommandDescription,
  option: OptionDescription,
  value: string,
): ArgvRefusal | undefined =>
  option.possibleValues === undefined || option.possibleValues.includes(value)
    ? undefined
    : {
        code: "OPTION_VALUE_INVALID",
        message: `--${option.name} must be one of ${option.possibleValues.join(", ")}`,
        field: `--${option.name}`,
        received: value,
        hint: profile.hint.command(command),
        expected: option.possibleValues,
        suggestions: suggest(value, option.possibleValues),
      };

/** An empty piece of a comma list, refused like an invalid value with the piece as `received` (spec 9.7.6). */
const emptyPiece = (
  profile: ParserProfile,
  command: CommandDescription,
  option: OptionDescription,
  text: string,
): ArgvRefusal => ({
  code: "OPTION_VALUE_INVALID",
  message: `--${option.name} takes a comma list without an empty item (got ${JSON.stringify(text)})`,
  field: `--${option.name}`,
  received: "",
  hint: profile.hint.command(command),
});

/** The values one text gives `option` (a comma list's pieces), or why one of them is refused (spec 9.7.6). */
export const piecesOf = (
  profile: ParserProfile,
  command: CommandDescription,
  option: OptionDescription,
  text: string,
  typed: boolean,
): { readonly values: ReadonlyArray<string> } | { readonly refusal: ArgvRefusal } => {
  const values = argvValues(option, text);
  for (const piece of values) {
    const refusal =
      option.commaList === true && piece === ""
        ? emptyPiece(profile, command, option, text)
        : (possibleValueProblem(profile, command, option, piece) ??
          (typed ? typeProblem(profile, command, option, `--${option.name}`, piece) : undefined));
    if (refusal !== undefined) return { refusal };
  }
  return { values };
};

/** Why one value of an argument is refused: not of its type, or outside its domain. */
const valueProblem = (
  profile: ParserProfile,
  command: CommandDescription,
  argument: ArgumentDescription,
  field: string,
  text: string,
): ArgvRefusal | undefined => {
  const type = argument.valueType;
  if (type === "switch" || type === "enum") return undefined;
  const typed = typedValue(type, text);
  if (typed === undefined) return typeProblem(profile, command, argument, field, text);
  if (argument.domain === undefined) return undefined;
  const problem = domainProblem(argument.domain, typed);
  return problem === undefined
    ? undefined
    : {
        code: field.startsWith("--") ? "OPTION_VALUE_INVALID" : "OPERAND_INVALID",
        message: `${field} must be ${problem}`,
        field,
        received: text,
        hint: profile.hint.arguments(command),
      };
};

/**
 * Why a parsed command line's values break their types or domains (environment values included), or undefined. A
 * tool that declares 1.2 checks the operands in their order and then the options in declaration order (spec 10.7
 * step 6), its argv values' types already checked by position; 1.1 checks the options first.
 */
export const valuesProblem = (
  profile: ParserProfile,
  command: CommandDescription,
  operands: ReadonlyArray<string>,
  options: Readonly<Record<string, ArgvValue>>,
): ArgvRefusal | undefined => {
  const ofOptions = () => {
    for (const option of command.options)
      for (const text of valuesOf(options[option.name])) {
        const problem = valueProblem(profile, command, option, `--${option.name}`, text);
        if (problem !== undefined) return problem;
      }
    return undefined;
  };
  const ofOperands = () => {
    for (const [index, text] of operands.entries()) {
      const operand = command.operands[index] ?? command.operands.find((one) => one.variadic);
      if (operand === undefined) continue;
      const problem = valueProblem(profile, command, operand, operand.name, text);
      if (problem !== undefined) return problem;
    }
    return undefined;
  };
  return fixedOrder(profile) ? (ofOperands() ?? ofOptions()) : (ofOptions() ?? ofOperands());
};

/**
 * Why a command line breaks one of the command's constraints, or undefined. "Given" is explicit on argv or in
 * `--input`: a default or an environment value does not count (spec 9.8.1). An operand is given when the command line
 * has it.
 */
export const constraintProblem = (
  profile: ParserProfile,
  command: CommandDescription,
  operands: ReadonlyArray<string>,
  options: Readonly<Record<string, ArgvValue>>,
  fromEnv: ReadonlyArray<string>,
): ArgvRefusal | undefined => {
  const operandIndex = (name: string) =>
    command.operands.findIndex((operand) => operand.name === name);
  const givenValues = (name: string): ReadonlyArray<string> | undefined => {
    const index = operandIndex(name);
    if (index !== -1) {
      const values = command.operands[index]?.variadic
        ? operands.slice(index)
        : operands.slice(index, index + 1);
      return values.length === 0 ? undefined : values;
    }
    const value = options[name];
    if (value === undefined || fromEnv.includes(name)) return undefined;
    return valuesOf(value);
  };
  const given = (name: string) => givenValues(name) !== undefined;
  const spell = (name: string) => (operandIndex(name) === -1 ? `--${name}` : `<${name}>`);
  const refusal = (rule: ConstraintDescription, field: string, message: string): ArgvRefusal => ({
    code: rule.code ?? "USAGE",
    message,
    field,
    hint: profile.hint.arguments(command),
  });
  for (const rule of command.constraints) {
    if (!("names" in rule)) {
      const values = givenValues(rule.if.name);
      // an `in` value as argv writes it: a string as it is, a number in JSON (`5`), a JSON value as its text
      const listed = rule.if.in?.map((value) =>
        typeof value === "string" ? value : JSON.stringify(value),
      );
      const holds =
        values !== undefined &&
        (listed === undefined || values.some((value) => listed.includes(value)));
      if (!holds) continue;
      const condition = `${spell(rule.if.name)}${listed === undefined ? "" : ` ${listed.join("|")}`}`;
      const atFault =
        rule.rule === "requires"
          ? rule.needs.find((name) => !given(name))
          : rule.needs.find((name) => given(name));
      if (atFault !== undefined)
        return refusal(
          rule,
          spell(atFault),
          rule.rule === "requires"
            ? `${condition} needs ${spell(atFault)}`
            : `${condition} cannot be used with ${spell(atFault)}`,
        );
      continue;
    }
    const present = rule.names.filter(given);
    const names = rule.names.map(spell).join(", ");
    // 1.2's field table names the first given name (spec 9.8.1); 1.1 named the second, the one after the first
    if (rule.rule !== "atLeastOne" && present.length > 1)
      return refusal(
        rule,
        spell((fixedOrder(profile) ? present[0] : present[1]) ?? ""),
        `at most one of ${names} can be given`,
      );
    if (rule.rule !== "atMostOne" && present.length === 0)
      return refusal(rule, spell(rule.names[0] ?? ""), `one of ${names} is required`);
  }
  return undefined;
};
