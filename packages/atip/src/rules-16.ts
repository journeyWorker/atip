/**
 * The rules a tool's self-description must keep across its commands, checked when the tool is defined: comma lists
 * (spec 9.7.6, Annex S2 rule 18), the tree's path shape (spec 4.1.1, rule 19) and one meaning per option name (Annex S1
 * item 4; per group since 1.6). Each function returns one sentence per problem; `defineTool` refuses a tool with any. A
 * tool that keeps its own command records runs them on its descriptions.
 */
import { type CommandDescription, KEBAB, type OptionDescription } from "./description.ts";
import { type ContractMinor, declaresAtLeast } from "./envelope.ts";
import type { Json } from "./json.ts";
import { patternAdmitsComma, patternProblem } from "./pattern.ts";

/** The valueTypes a comma list may have (spec 9.7.6). */
export const COMMA_LIST_TYPES: ReadonlyArray<string> = [
  "string",
  "integer",
  "number",
  "path",
  "enum",
];

/** Why one option's `commaList` breaks Annex S2 rule 18 (or rule 16 below 1.6). */
const commaListOptionProblems = (
  minor: ContractMinor,
  where: string,
  option: OptionDescription,
): ReadonlyArray<string> => {
  if (option.commaList !== true) return [];
  const at = `${where} --${option.name}`;
  const pattern = option.domain?.["pattern"];
  return [
    ...(declaresAtLeast(minor, "1.6")
      ? []
      : [`${at}: commaList is since 1.6, the tool declares ${minor} (Annex S2 rule 16)`]),
    ...(option.repeatable && COMMA_LIST_TYPES.includes(option.valueType)
      ? []
      : [
          `${at}: commaList on a ${option.repeatable ? "" : "non-repeatable "}${option.valueType} option (Annex S2 rule 18)`,
        ]),
    ...(option.possibleValues ?? [])
      .filter((value) => value.includes(","))
      .map(
        (value) => `${at}: possible value ${JSON.stringify(value)} holds "," (Annex S2 rule 18)`,
      ),
    ...(Array.isArray(option.default) ? option.default : [])
      .filter((value) => typeof value === "string" && value.includes(","))
      .map(
        (value) => `${at}: default element ${JSON.stringify(value)} holds "," (Annex S2 rule 18)`,
      ),
    ...((option.valueType === "string" || option.valueType === "path") &&
    (typeof pattern !== "string" || patternAdmitsComma(pattern))
      ? [
          `${at}: a ${option.valueType} comma list needs a domain pattern that admits no "," (Annex S2 rule 18)`,
        ]
      : []),
  ];
};

/** Annex S2 rule 18 over every option of every command. */
export const commaListProblems = (
  minor: ContractMinor,
  commands: ReadonlyArray<CommandDescription>,
): ReadonlyArray<string> =>
  commands.flatMap((command) =>
    command.options.flatMap((option) =>
      commaListOptionProblems(minor, command.path.join(" "), option),
    ),
  );

/** Every `pattern` keyword in a domain, a `json` domain's nested schemas included. */
const patternsOf = (node: Json): ReadonlyArray<string> => {
  if (Array.isArray(node)) return node.flatMap(patternsOf);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === "pattern" && typeof value === "string" ? [value] : patternsOf(value),
  );
};

/**
 * Annex V2 at the minor the tool declares: every domain pattern of every operand and option is of the form that minor
 * admits (`\p{White_Space}` and `\P{White_Space}` only from 1.5, spec 15.9).
 */
export const patternMinorProblems = (
  minor: ContractMinor,
  commands: ReadonlyArray<CommandDescription>,
): ReadonlyArray<string> =>
  commands.flatMap((command) =>
    [...command.operands, ...command.options].flatMap((argument) =>
      patternsOf(argument.domain ?? null).flatMap((pattern) => {
        const problem = patternProblem(pattern, minor);
        const name = "variadic" in argument ? `<${argument.name}>` : `--${argument.name}`;
        return problem === undefined
          ? []
          : [
              `${command.path.join(" ")} ${name}: pattern ${JSON.stringify(pattern)} ${problem} (Annex V2)`,
            ];
      }),
    ),
  );

/** Spec 4.1.1 and Annex S2 rule 19: the labels, and no path longer than the shape; none below 1.6 (rule 16). */
export const pathShapeProblems = (
  minor: ContractMinor,
  pathShape: ReadonlyArray<string> | undefined,
  paths: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  if (pathShape === undefined) return [];
  if (!declaresAtLeast(minor, "1.6"))
    return [`pathShape is since 1.6, the tool declares ${minor} (Annex S2 rule 16)`];
  return [
    ...(pathShape.length === 0 ? ["pathShape names no word (spec 4.1.1)"] : []),
    ...pathShape
      .filter((label) => !KEBAB.test(label))
      .map((label) => `pathShape label ${JSON.stringify(label)} is not kebab-case (spec 4.1.1)`),
    ...pathShape
      .filter((label, index) => pathShape.indexOf(label) !== index)
      .map((label) => `pathShape label ${JSON.stringify(label)} is given twice (Annex S2 rule 19)`),
    ...paths
      .filter((path) => path.length > pathShape.length)
      .map(
        (path) =>
          `path ${JSON.stringify(path.join(" "))} is longer than the pathShape of ${pathShape.length} words (Annex S2 rule 19)`,
      ),
  ];
};

/** The group of a command (Annex S1 item 4): its path without the final word, the verb; "" at the root. */
const groupOf = (command: CommandDescription): string => command.path.slice(0, -1).join(" ");

/** A switch or a count has no value name to tell another meaning by: it keeps one tool-wide. */
const valueless = (option: OptionDescription): boolean =>
  option.valueType === "switch" || option.valueType === "count";

/** The value name a document shows: declared, else the name upper-cased with `_` for `-` (spec 9.5, as the checker reads it). */
const valueNameOf = (option: OptionDescription): string =>
  option.valueName ?? option.name.toUpperCase().replaceAll("-", "_");

/**
 * Annex S1 item 4: an option name keeps one meaning (value name and value type). In a 1.6 tool it holds within a group;
 * across groups the same name with the same value name keeps one value type (a different value name is another
 * meaning), and a switch or a count keeps one value type tool-wide. Below 1.6 it holds tool-wide. The options are
 * compared by name, so a large tool pays for the names it shares, not for every pair of commands.
 */
export const optionMeaningProblems = (
  minor: ContractMinor,
  commands: ReadonlyArray<CommandDescription>,
): ReadonlyArray<string> => {
  const grouped = declaresAtLeast(minor, "1.6");
  const byName = new Map<
    string,
    Array<{ readonly command: CommandDescription; readonly option: OptionDescription }>
  >();
  for (const command of commands)
    for (const option of command.options) {
      const uses = byName.get(option.name);
      if (uses === undefined) byName.set(option.name, [{ command, option }]);
      else uses.push({ command, option });
    }
  const problems = new Set<string>();
  for (const [name, uses] of byName)
    for (const [index, mine] of uses.entries())
      for (const theirs of uses.slice(index + 1)) {
        const sameGroup = !grouped || groupOf(mine.command) === groupOf(theirs.command);
        const toolWide = valueless(mine.option) || valueless(theirs.option);
        const sameValueName = valueNameOf(mine.option) === valueNameOf(theirs.option);
        const sameType = mine.option.valueType === theirs.option.valueType;
        const broken =
          sameGroup || toolWide ? !sameValueName || !sameType : sameValueName && !sameType;
        if (!broken) continue;
        const [a, b] = [mine.command.path.join(" "), theirs.command.path.join(" ")].toSorted();
        const rule = !grouped
          ? `one value name and value type tool-wide below 1.6`
          : sameGroup
            ? `one value name and value type within the group ${JSON.stringify(groupOf(mine.command))}`
            : toolWide
              ? "a switch or a count keeps one meaning tool-wide"
              : "the same value name is the same value type in every group";
        problems.add(`--${name} has two meanings in ${a} and ${b}: ${rule} (Annex S1 item 4)`);
      }
  return [...problems];
};
