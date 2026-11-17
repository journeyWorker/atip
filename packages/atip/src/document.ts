/**
 * The `schema` answers (spec 9) from command descriptions: the tree, a group, one command document, and (1.4) one
 * command's schemas answer. What is the tool's choice (generic codes, shared options, the fragment's spelling) comes
 * from its `ToolProfile`.
 *
 * A tool that declares 1.3 or earlier gets the form of its minor (spec 15.7): every member written out, the outputs'
 * JSON Schemas and the `--input` fragment schema inside the command document. A tool that declares 1.4 gets the form
 * of spec 9.5, written by one serializer (approaches/implementation.md §8): no member at its default, no implied option
 * or code, the options several commands share defined once in the tree and named by the commands, `--commit` and
 * `--plan-digest` by their reserved names, and the JSON Schemas, the derived fragment schema (`Input`) and the
 * validators' `rejects` in the schemas answer (spec 9.9.3).
 */
import { Option } from "effect";
import { shellSplit } from "./argv.ts";
import {
  argumentValue,
  type CommandDescription,
  type ConstraintDescription,
  type EffectKind,
  fieldName,
  type OperandDescription,
  type OptionDescription,
  type OutputDescription,
} from "./description.ts";
import { decodeJsonText, type Json, type JsonObject, schemasOf } from "./json.ts";
import { type ContractMinor, declaresAtLeast } from "./envelope.ts";
import {
  DERIVED_FRAGMENT_STYLE,
  type FragmentStyle,
  type GroupDescription,
  type ToolProfile,
  toolDescription,
} from "./tool.ts";

/** A command as the tree lists it (spec 9.3). */
export interface TreeCommand {
  readonly path: ReadonlyArray<string>;
  readonly summary: string;
  readonly effect: EffectKind;
}

/** Whether a tool writes the 1.4 form of the self-description (spec 9, 15.7). */
const writes14 = (minor: ContractMinor): boolean => declaresAtLeast(minor, "1.4");

/** A command's tree entry; in 1.4 without `path` and the default `kind` (spec 9.3, 9.5). */
const commandEntry = (minor: ContractMinor) => (command: TreeCommand) =>
  writes14(minor)
    ? { command: command.path.join(" "), summary: command.summary, effect: command.effect }
    : {
        command: command.path.join(" "),
        path: [...command.path],
        kind: "command" as const,
        summary: command.summary,
        effect: command.effect,
      };

const groupEntry = (minor: ContractMinor, group: GroupDescription) =>
  writes14(minor)
    ? { command: group.name, kind: "group" as const, summary: group.summary }
    : { command: group.name, path: [group.name], kind: "group" as const, summary: group.summary };

const inGroup = (group: GroupDescription) => (command: TreeCommand) =>
  command.path.length > 1 && command.path[0] === group.name;

/**
 * The tree (spec 9.3): every group, each followed by its commands, then the commands at the root (a group before its
 * commands, spec 9.4). `commands` are the ones the tree shows, in order. In 1.4 `options` defines the shared options
 * (`sharedOptions`), absent when there are none; in 1.6 `pathShape` labels the words of a full-length path (spec
 * 4.1.1), absent when the tool declares none.
 */
export const treeDocument = (
  commands: ReadonlyArray<TreeCommand>,
  groups: ReadonlyArray<GroupDescription>,
  level: string,
  minor: ContractMinor,
  shared: SharedOptions = [],
  pathShape?: ReadonlyArray<string>,
): JsonObject => ({
  kind: "tree",
  level,
  ...(pathShape !== undefined && declaresAtLeast(minor, "1.6")
    ? { pathShape: [...pathShape] }
    : {}),
  ...(writes14(minor) && shared.length > 0
    ? { options: shared.map((option) => option.document) }
    : {}),
  commands: [
    ...groups.flatMap((group) => [
      groupEntry(minor, group),
      ...commands.filter(inGroup(group)).map(commandEntry(minor)),
    ]),
    ...commands.filter((command) => command.path.length === 1).map(commandEntry(minor)),
  ],
});

/** One group (spec 9.4) and its commands; in 1.4 without `path`. */
export const groupDocument = (
  commands: ReadonlyArray<TreeCommand>,
  group: GroupDescription,
  minor: ContractMinor,
): JsonObject => ({
  kind: "group",
  command: group.name,
  ...(writes14(minor) ? {} : { path: [group.name] }),
  summary: group.summary,
  commands: commands.filter(inGroup(group)).map(commandEntry(minor)),
});

/** The `valueName` a 1.4 document leaves out: the name in upper case with `_` for `-` (spec 9.5). */
const impliedValueName = (name: string): string => name.toUpperCase().replaceAll("-", "_");

/** The `default` a 1.4 document leaves out: `false` for a switch, `0` for a count, else `null` (spec 9.5). */
const impliedDefault = (valueType: string): Json =>
  valueType === "switch" ? false : valueType === "count" ? 0 : null;

/** One operand (spec 9.6); `lean` (1.4) leaves out every member at its default (spec 9.5). */
const operandDocument = (operand: OperandDescription, lean: boolean): JsonObject => ({
  name: operand.name,
  ...(lean && operand.valueName === impliedValueName(operand.name)
    ? {}
    : { valueName: operand.valueName }),
  ...(lean && operand.valueType === "string" ? {} : { valueType: operand.valueType }),
  ...(operand.possibleValues === undefined ? {} : { possibleValues: [...operand.possibleValues] }),
  ...(lean && !operand.required ? {} : { required: operand.required }),
  ...(lean && !operand.variadic ? {} : { variadic: operand.variadic }),
  ...(lean && operand.default === null ? {} : { default: operand.default }),
  ...(operand.defaultNote === undefined ? {} : { defaultNote: operand.defaultNote }),
  ...(operand.domain === undefined ? {} : { domain: operand.domain }),
  help: operand.help,
});

/** One option (spec 9.7); `lean` (1.4) leaves out every member at its default, and a count's `repeatable` (spec 9.5). */
const optionDocument = (option: OptionDescription, lean: boolean): JsonObject => ({
  name: option.name,
  ...(option.valueName === undefined || (lean && option.valueName === impliedValueName(option.name))
    ? {}
    : { valueName: option.valueName }),
  ...(lean && option.valueType === "string" ? {} : { valueType: option.valueType }),
  ...(option.possibleValues === undefined ? {} : { possibleValues: [...option.possibleValues] }),
  ...(lean && !option.required ? {} : { required: option.required }),
  ...(lean && (!option.repeatable || option.valueType === "count")
    ? {}
    : { repeatable: option.repeatable }),
  ...(lean && option.default === impliedDefault(option.valueType)
    ? {}
    : { default: option.default }),
  ...(option.defaultNote === undefined ? {} : { defaultNote: option.defaultNote }),
  ...(option.domain === undefined ? {} : { domain: option.domain }),
  ...(option.env === undefined ? {} : { env: option.env }),
  ...(option.commaList === true ? { commaList: true } : {}),
  ...(option.flagOnly ? { flagOnly: true } : {}),
  ...(option.short === undefined ? {} : { short: option.short }),
  help: option.help,
});

const constraintDocument = (rule: ConstraintDescription): JsonObject => {
  const code = rule.code === undefined ? {} : { code: rule.code };
  if ("names" in rule) return { rule: rule.rule, names: [...rule.names], ...code };
  return {
    rule: rule.rule,
    if: { name: rule.if.name, ...(rule.if.in === undefined ? {} : { in: [...rule.if.in] }) },
    // spec 9.8.1 names the member `then`; the document is JSON, never awaited
    // oxlint-disable-next-line unicorn/no-thenable
    then: [...rule.needs],
    ...code,
  };
};

/** One output (spec 9.9.1); `lean` (1.4) leaves out `kind` report and `schemaVersion` 1.0 (spec 9.5). */
const outputEntry = (output: OutputDescription, lean: boolean): JsonObject => ({
  ...(lean && output.kind === "report" ? {} : { kind: output.kind }),
  schemaRef: `#/schemas/${output.name}`,
  ...(lean && output.schemaVersion === "1.0" ? {} : { schemaVersion: output.schemaVersion }),
  ...(output.mediaType === undefined ? {} : { mediaType: output.mediaType }),
  ...(output.batch === true ? { batch: true } : {}),
  ...(output.when === undefined ? {} : { when: output.when }),
  ...(output.fields === undefined
    ? {}
    : {
        fields: {
          records: output.fields.records,
          paths: [...output.fields.paths],
          ...(output.fields.keep === undefined ? {} : { keep: [...output.fields.keep] }),
          ...(output.fields.default === undefined ? {} : { default: [...output.fields.default] }),
        },
      }),
  ...output.ext,
});

const outputSchemas = (
  output: OutputDescription,
  tool: ToolProfile,
): Readonly<Record<string, Json>> =>
  "effect" in output.schema
    ? schemasOf(output.name, output.schema.effect, tool.reportExcessProperty)
    : { [output.name]: output.schema.json };

/** The name of a command's fragment schema: its path words in PascalCase, then `Input` (`finding close` → `FindingCloseInput`). */
const fragmentName = (command: CommandDescription): string =>
  `${command.path
    .flatMap((word) => word.split("-"))
    .map((word) => (word[0]?.toUpperCase() ?? "") + word.slice(1))
    .join("")}Input`;

/**
 * The fragment schema of the command's `--input` documents (spec 9.9.2) in a spelling: the tool's own before 1.4,
 * `DERIVED_FRAGMENT_STYLE` (the spec's derivation, exactly) in a 1.4 schemas answer.
 */
const fragmentDocument = (command: CommandDescription, style: FragmentStyle): JsonObject => {
  const keyed = command.options.filter((option) => !option.flagOnly);
  const fixed = command.operands.filter((operand) => !operand.variadic).map(style.value);
  const variadic = command.operands.find((operand) => operand.variadic);
  const description = style.description(command);
  return {
    type: "object",
    ...(description === undefined ? {} : { description }),
    properties: {
      ...(command.operands.length === 0
        ? {}
        : {
            operands: style.operands(
              fixed,
              variadic === undefined ? undefined : style.value(variadic),
            ),
          }),
      ...Object.fromEntries(
        keyed.map((option) => [
          fieldName(option.name),
          option.repeatable && option.valueType !== "count"
            ? style.repeated(style.value(option))
            : style.value(option),
        ]),
      ),
    },
    additionalProperties: false,
  };
};

/**
 * The command's first example as one `--input` document (spec 9.9.2): its operands and every option it gives that a
 * document may set, typed; an example that passes `--input '{…}'` contributes that document too.
 */
const inputExample = (command: CommandDescription, tool: ToolProfile): JsonObject => {
  const words = shellSplit(command.examples[0] ?? "") ?? [];
  const read = tool.readExample(command, words.slice(1));
  if (read === undefined) return {};
  const document: Record<string, Json> = {};
  const embedded = read.options["input"];
  if (typeof embedded === "string" && embedded.trimStart().startsWith("{")) {
    const parsed = decodeJsonText(embedded);
    if (
      Option.isSome(parsed) &&
      typeof parsed.value === "object" &&
      parsed.value !== null &&
      !Array.isArray(parsed.value)
    )
      Object.assign(document, parsed.value);
  }
  if (read.operands.length > 0)
    document["operands"] = read.operands.map((text, index) => {
      const operand =
        command.operands[index] ?? command.operands.find((candidate) => candidate.variadic);
      return operand === undefined ? text : argumentValue(operand, text);
    });
  for (const option of command.options) {
    if (option.flagOnly) continue;
    const value = read.options[option.name];
    if (value === undefined || value === false) continue;
    document[fieldName(option.name)] =
      value === true
        ? true
        : typeof value === "string"
          ? argumentValue(option, value)
          : value.map((text) => argumentValue(option, text));
  }
  return document;
};

/** Whether a described command takes `--input` (the tool's shared options included). */
const takesInput = (command: CommandDescription): boolean =>
  command.options.some((option) => option.name === "input");

/**
 * The reserved options a 1.4 command document implies and never lists (spec 9.5): `--json` always, `--input` with
 * `input`, `--fields` when an output declares `fields`.
 */
const impliedOptions = (command: CommandDescription): ReadonlyArray<string> => [
  "json",
  ...(takesInput(command) ? ["input"] : []),
  ...(command.outputs.some((output) => output.fields !== undefined) ? ["fields"] : []),
];

/**
 * The reserved options a 1.4 document names by their reserved name, never as an object: `--commit` and
 * `--plan-digest`, whose shape the contract fixes (spec 4.5, Annex S2 rule 8) and which are never implied, so that the
 * document alone says whether a bare run of a destructive command acts (spec 9.5).
 */
const RESERVED_NAMES: ReadonlyArray<string> = ["commit", "plan-digest"];

/**
 * The codes a 1.4 command document implies and never lists (spec 7.3.1, 9.5): `USAGE`, the tool's registered finer
 * replacements of it (7.3.2), `INTERNAL`; the `INPUT_*` codes (implied with `input`; without it `--input` is an unknown
 * option, so the runner cannot raise them); `BATCH_INCOMPLETE` with a batch, `PLAN_STALE` with `--commit`,
 * `OPERATION_REUSED` with `--operation`, `CURSOR_INVALID` with `--cursor`.
 */
const impliedCodes = (command: CommandDescription, tool: ToolProfile): ReadonlySet<string> => {
  const offers = (name: string) => command.options.some((option) => option.name === name);
  return new Set([
    "USAGE",
    ...tool.usageReplacements,
    "INTERNAL",
    "INPUT_INVALID",
    "INPUT_CONFLICT",
    "INPUT_TOO_LARGE",
    ...(command.input.batch === undefined ? [] : ["BATCH_INCOMPLETE"]),
    ...(offers("commit") ? ["PLAN_STALE"] : []),
    ...(offers("operation") ? ["OPERATION_REUSED"] : []),
    ...(offers("cursor") ? ["CURSOR_INVALID"] : []),
  ]);
};

/** One option definition the tree's `options` holds (spec 9.3): its name, its 1.4 document and that document's text. */
export interface SharedOption {
  readonly name: string;
  readonly document: JsonObject;
  readonly text: string;
}
export type SharedOptions = ReadonlyArray<SharedOption>;

/** The options a 1.4 document lists as objects: neither implied nor named by their reserved name. */
const objectOptions = (command: CommandDescription): ReadonlyArray<OptionDescription> => {
  const implied = impliedOptions(command);
  return command.options.filter(
    (option) => !implied.includes(option.name) && !RESERVED_NAMES.includes(option.name),
  );
};

/**
 * The options the tree defines once (spec 9.3, approaches/implementation.md §8), from the described commands the tree
 * lists: an option whose 1.4 document is the same on two or more of them, in the order of its first appearance. Two
 * definitions of one name that both recur cannot both be named: the one more commands share is (the first to appear on
 * a tie), and the other stays an object on its commands. In a tool that declares 1.6 a name whose definitions differ in
 * value name or value type (one meaning per group, Annex S1 item 4) is never shared, since a tree option is tool-wide:
 * each definition stays whole on its commands (the atip crate 0.3.1 rule).
 */
export const sharedOptions = (
  commands: ReadonlyArray<CommandDescription>,
  minor: ContractMinor,
): SharedOptions => {
  const seen = new Map<string, { readonly option: SharedOption; commands: number }>();
  const meaningOf = new Map<string, string>();
  const severalMeanings = new Set<string>();
  for (const command of commands)
    for (const option of objectOptions(command)) {
      const document = optionDocument(option, true);
      const text = JSON.stringify(document);
      const known = seen.get(text);
      if (known === undefined)
        seen.set(text, { option: { name: option.name, document, text }, commands: 1 });
      else known.commands += 1;
      const meaning = `${option.valueName ?? impliedValueName(option.name)} ${option.valueType}`;
      const held = meaningOf.get(option.name);
      if (held === undefined) meaningOf.set(option.name, meaning);
      else if (held !== meaning) severalMeanings.add(option.name);
    }
  const groupsMean = declaresAtLeast(minor, "1.6");
  const recurring = [...seen.values()].filter(
    (entry) => entry.commands > 1 && !(groupsMean && severalMeanings.has(entry.option.name)),
  );
  const chosen = new Map<string, { readonly option: SharedOption; commands: number }>();
  for (const entry of recurring) {
    const known = chosen.get(entry.option.name);
    if (known === undefined || entry.commands > known.commands)
      chosen.set(entry.option.name, entry);
  }
  const texts = new Set([...chosen.values()].map((entry) => entry.option.text));
  return recurring.filter((entry) => texts.has(entry.option.text)).map((entry) => entry.option);
};

/** A 1.4 document's `options` (spec 9.5): no implied option, reserved and shared options by name, others in full. */
const options14 = (command: CommandDescription, shared: SharedOptions): ReadonlyArray<Json> => {
  const implied = impliedOptions(command);
  const named = new Set(shared.map((option) => option.text));
  return command.options.flatMap((option): ReadonlyArray<Json> => {
    if (implied.includes(option.name)) return [];
    if (RESERVED_NAMES.includes(option.name)) return [option.name];
    const document = optionDocument(option, true);
    return [named.has(JSON.stringify(document)) ? option.name : document];
  });
};

/** The 1.4 command document (spec 9.5): the call surface, without JSON Schemas, defaults or implied members. */
const commandDocument14 = (
  command: CommandDescription,
  tool: ToolProfile,
  shared: SharedOptions,
): JsonObject => {
  const implied = impliedCodes(command, tool);
  const errors = [...new Set([...command.errors, ...tool.genericErrors])]
    .filter((code) => !implied.has(code))
    .sort();
  const options = options14(command, shared);
  const batch = command.input.batch;
  return {
    kind: "command",
    command: command.path.join(" "),
    summary: command.summary,
    effect: command.effect,
    ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
    ...(command.effectNote === undefined ? {} : { effectNote: command.effectNote }),
    ...(command.async ? { async: true } : {}),
    ...(command.operands.length === 0
      ? {}
      : { operands: command.operands.map((operand) => operandDocument(operand, true)) }),
    ...(options.length === 0 ? {} : { options: [...options] }),
    ...(command.constraints.length === 0
      ? {}
      : { constraints: command.constraints.map(constraintDocument) }),
    ...(command.validators.length === 0
      ? {}
      : {
          validators: command.validators.map((validator) => ({
            arguments: [...validator.arguments],
            code: validator.code,
            description: validator.description,
          })),
        }),
    ...(errors.length === 0 ? {} : { errors }),
    outputs: command.outputs.map((output) => outputEntry(output, true)),
    ...(takesInput(command)
      ? {
          input: {
            maxBytes: command.input.maxBytes ?? tool.inputMaxBytes,
            ...(batch === undefined ? {} : { batch: true, maxItems: batch.maxItems }),
            example: inputExample(command, tool),
          },
        }
      : {}),
    examples: [...command.examples],
    ...command.ext,
  };
};

/** The command document of a tool that declares 1.3 or earlier (spec 15.7): every member, its schemas inside. */
const commandDocument13 = (command: CommandDescription, tool: ToolProfile): JsonObject => {
  const schemas: Readonly<Record<string, Json>> = Object.fromEntries(
    command.outputs.flatMap((output) => Object.entries(outputSchemas(output, tool))),
  );
  const name = fragmentName(command);
  const batch = command.input.batch;
  return {
    kind: "command",
    command: command.path.join(" "),
    path: [...command.path],
    summary: command.summary,
    effect: command.effect,
    ...(command.idempotency === undefined ? {} : { idempotency: command.idempotency }),
    ...(command.effectNote === undefined ? {} : { effectNote: command.effectNote }),
    ...(command.async ? { async: true } : {}),
    operands: command.operands.map((operand) => operandDocument(operand, false)),
    options: command.options.map((option) => optionDocument(option, false)),
    ...(command.constraints.length === 0
      ? {}
      : { constraints: command.constraints.map(constraintDocument) }),
    ...(command.validators.length === 0
      ? {}
      : {
          validators: command.validators.map((validator) => ({
            arguments: [...validator.arguments],
            code: validator.code,
            description: validator.description,
            rejects: [...validator.rejects],
          })),
        }),
    errors: [...new Set([...command.errors, ...tool.genericErrors])].sort(),
    outputs: command.outputs.map((output) => outputEntry(output, false)),
    ...(takesInput(command)
      ? {
          input: {
            option: "--input",
            schemaRef: `#/schemas/${name}`,
            batch: batch !== undefined,
            maxBytes: command.input.maxBytes ?? tool.inputMaxBytes,
            ...(batch === undefined ? {} : { maxItems: batch.maxItems }),
            example: inputExample(command, tool),
          },
        }
      : {}),
    examples: [...command.examples],
    schemas: takesInput(command)
      ? { ...schemas, [name]: fragmentDocument(command, tool.fragment) }
      : schemas,
    ...command.ext,
  };
};

/**
 * One command document (spec 9.5) of a declared command, with the tool's rules applied (`toolDescription`: its shared
 * options, their constraints, the contract codes, its own members), in the form of the minor the tool declares; its
 * generic codes join the listed ones, sorted; `input` is present when the command takes `--input`. In 1.4 an option
 * whose definition is one of `shared` (the tree's `options`) is named, not written out.
 */
export const commandDocument = (
  description: CommandDescription,
  tool: ToolProfile,
  shared: SharedOptions = [],
): JsonObject => {
  const command = toolDescription(description, tool);
  return writes14(tool.contractVersion)
    ? commandDocument14(command, tool, shared)
    : commandDocument13(command, tool);
};

/**
 * A command's schemas answer (spec 9.9.3, 1.4): the JSON Schemas its outputs' refs reach, its derived fragment schema
 * (spec 9.9.2) as `Input` when it takes `--input`, and one `rejects` list per validator, in the document's order.
 */
export const schemasAnswer = (description: CommandDescription, tool: ToolProfile): JsonObject => {
  const command = toolDescription(description, tool);
  const schemas: Readonly<Record<string, Json>> = Object.fromEntries(
    command.outputs.flatMap((output) => Object.entries(outputSchemas(output, tool))),
  );
  return {
    kind: "schemas",
    command: command.path.join(" "),
    schemas: takesInput(command)
      ? { ...schemas, Input: fragmentDocument(command, DERIVED_FRAGMENT_STYLE) }
      : schemas,
    ...(command.validators.length === 0
      ? {}
      : { rejects: command.validators.map((validator) => [...validator.rejects]) }),
  };
};
