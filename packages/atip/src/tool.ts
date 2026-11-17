/**
 * The seam of a tool around its commands: what the library needs from it to print a command's documents and answer
 * `schema` (`defineTool`, define-tool.ts). Every member is the tool's choice within the contract: its generic codes,
 * its shared options and their relations, the codes the contract ties to a command's shape, its `--input` limit, how
 * its fragment schemas are spelled, its own `x-` members, and how its command line is spelled (`parser`).
 * `toolDescription` applies these rules to a declared command: the description its documents print and its parser
 * enforces.
 */
import type {
  ArgumentDescription,
  CommandDescription,
  ConstraintDescription,
  OptionDescription,
} from "./description.ts";
import { argvValues, INTEGER_PATTERN, NUMBER_PATTERN } from "./description.ts";
import { CONTRACT_VERSION, type ContractMinor, declaresAtLeast } from "./envelope.ts";
import type { ExcessProperty, Json } from "./json.ts";
import {
  type ParserSpellings,
  type ParserSpellingsInput,
  parserSpellings,
} from "./parser-profile.ts";
import { PLAN_DIGEST_PATTERN } from "./plan.ts";

/** A group of commands (spec 9.4): the first word of its commands' paths. */
export interface GroupDescription {
  readonly name: string;
  readonly summary: string;
}

/**
 * How a tool that declares 1.3 or earlier spells its fragment schemas (the 1.3 text's 10.10). Any spelling that
 * accepts exactly the values 9.7.2 lets a document give is valid; `ATIP_FRAGMENT_STYLE` is the one atip's examples
 * use. A tool that declares 1.4 publishes the derived fragment schema (spec 9.9.2), `DERIVED_FRAGMENT_STYLE`, whatever
 * its profile says.
 */
export interface FragmentStyle {
  /** One value of an argument as a document gives it. */
  readonly value: (argument: ArgumentDescription) => Json;
  /** A repeatable option's key, from the schema of one value. */
  readonly repeated: (one: Json) => Json;
  /** The `operands` array, from the schemas of the fixed operands and of the variadic one. */
  readonly operands: (fixed: ReadonlyArray<Json>, variadic: Json | undefined) => Json;
  /** The fragment schema's `description`; undefined: none. */
  readonly description: (command: CommandDescription) => string | undefined;
}

/** The fragment spelling of atip's examples (`examples/schema-command-*.json`). */
export const ATIP_FRAGMENT_STYLE: FragmentStyle = {
  value: (argument) => {
    switch (argument.valueType) {
      case "switch":
        return { type: "boolean" };
      case "count":
        return { type: "integer", minimum: 0 };
      case "integer":
        return { type: ["integer", "string"], pattern: INTEGER_PATTERN };
      case "number":
        return { type: ["number", "string"], pattern: NUMBER_PATTERN };
      case "enum":
        return { enum: [...(argument.possibleValues ?? [])] };
      case "json":
        return { not: { type: "null" } };
      default:
        return { type: "string" };
    }
  },
  repeated: (one) => ({ type: "array", items: one, minItems: 1 }),
  operands: (fixed, variadic) => {
    const [only] = fixed;
    const items =
      variadic === undefined && only !== undefined && fixed.length === 1
        ? { items: only }
        : {
            ...(fixed.length === 0 ? {} : { prefixItems: [...fixed] }),
            ...(variadic === undefined ? {} : { items: variadic }),
          };
    return {
      type: "array",
      ...items,
      minItems: 1,
      ...(variadic === undefined ? { maxItems: fixed.length } : {}),
    };
  },
  description: () => undefined,
};

/**
 * The fragment schema as spec 9.9.2 derives it from the options (1.4), member for member what a reader derives
 * (atip's `check.ts` `deriveFragment`): each value as 9.7.2 admits it, a repeatable option's an array of them, the
 * operands an array of at least one with no item past the last fixed operand unless the last is variadic, no
 * `description`. A 1.4 schemas answer publishes it as `Input` (spec 9.9.3).
 */
export const DERIVED_FRAGMENT_STYLE: FragmentStyle = {
  value: (argument) => {
    switch (argument.valueType) {
      case "switch":
        return { type: "boolean" };
      case "count":
        return { type: "integer", minimum: 0 };
      case "integer":
        return { anyOf: [{ type: "integer" }, { type: "string", pattern: INTEGER_PATTERN }] };
      case "number":
        return { anyOf: [{ type: "number" }, { type: "string", pattern: NUMBER_PATTERN }] };
      case "enum":
        return { enum: [...(argument.possibleValues ?? [])] };
      case "json":
        return { not: { type: "null" } };
      default:
        return { type: "string" };
    }
  },
  repeated: (one) => ({ type: "array", items: one }),
  operands: (fixed, variadic) => ({
    type: "array",
    minItems: 1,
    ...(variadic === undefined ? { maxItems: fixed.length } : {}),
    ...(fixed.length === 0 ? {} : { prefixItems: [...fixed] }),
    items: variadic ?? false,
  }),
  description: () => undefined,
};

/** One example's arguments as argv gives them: operand words, and option values by option name. */
export interface ExampleArguments {
  readonly operands: ReadonlyArray<string>;
  /** A switch `true`, a count its occurrences as text, a repeatable option its values, else its value. */
  readonly options: Readonly<Record<string, string | boolean | ReadonlyArray<string>>>;
}

/** What `commandDocument` and `defineTool` need from the tool. */
export interface ToolProfile {
  readonly name: string;
  /**
   * The contract minor the tool declares (`meta.contractVersion`, spec 15.5): the rules a later minor adds for its
   * own documents do not hold for it. Default: {@link CONTRACT_VERSION}.
   */
  readonly contractVersion: ContractMinor;
  /** Codes every command can return (spec 9.5 `errors` lists them too). */
  readonly genericErrors: ReadonlyArray<string>;
  /**
   * The tool's own options every command (or some) takes besides its declared ones, appended to its document's
   * options before the contract's (`ContractRules`). An option of a contract name given here replaces the contract's.
   */
  readonly sharedOptions: (command: CommandDescription) => ReadonlyArray<OptionDescription>;
  /**
   * The relations among the tool's shared options a command takes (spec 9.8.1: `--fields` or `--full`), after its own
   * constraints and before the contract's (`--commit` with `--plan-digest`). `command` has its shared options.
   */
  readonly sharedConstraints: (command: CommandDescription) => ReadonlyArray<ConstraintDescription>;
  /**
   * The tool's own codes tied to a command's shape (the during-work code of a backend code a write lists, spec 8.3),
   * after its declared ones and the contract's. `command` has its shared options.
   */
  readonly contractErrors: (command: CommandDescription) => ReadonlyArray<string>;
  /** What the package adds to every command for the contract's reserved options and codes. */
  readonly contract: ContractRules;
  /**
   * The command as the tool publishes it, its shared options, constraints and contract codes included: where the
   * tool's own `x-` members (spec 9.10.2) are written otherwise than its declaration holds them. Default: unchanged.
   */
  readonly published: (command: CommandDescription) => CommandDescription;
  /**
   * Whether the tree, its group and the parser's listings (`expected`, `suggestions`) name the command, as declared
   * (one the tool only starts itself is not); its document stays and it still runs.
   */
  readonly listed: (command: CommandDescription) => boolean;
  /** How the tool's command line is spelled beyond the grammar: global options, old spellings, hints (spec 4.4.1, Annex S1 item 7). */
  readonly parser: ParserSpellings;
  /** The tool's own members of an error code's registry row (spec 9.10.2), after the row (`{}`: none). */
  readonly errorMembers: (code: string) => { readonly [member: `x-${string}`]: Json };
  /** The most bytes one `--input` takes, unless a command says otherwise. */
  readonly inputMaxBytes: number;
  /** How a report's JSON Schema treats members its Effect Schema does not model. */
  readonly reportExcessProperty: ExcessProperty;
  /** The fragment spelling of a tool that declares 1.3 or earlier (unused at 1.4, spec 9.9.2). */
  readonly fragment: FragmentStyle;
  /**
   * The tool's registered finer replacements of `USAGE` (spec 7.3.2): exit-2 codes it uses for a usage problem it
   * never reports as `USAGE`. A 1.4 command document implies them, as it implies `USAGE` (spec 9.5); each must be
   * registered with exit 2 and be named `<SUBJECT>_INVALID` or `<SUBJECT>_REQUIRED` or say in its `meaning` that it is
   * used in place of `USAGE`, so that a reader can tell it from the tool's other codes. Default: none.
   */
  readonly usageReplacements: ReadonlyArray<string>;
  /** Reads a command's first example (argv after the tool name) for its `input.example`; undefined: unreadable. */
  readonly readExample: (
    command: CommandDescription,
    argv: ReadonlyArray<string>,
  ) => ExampleArguments | undefined;
  /**
   * The tree's `pathShape` (spec 4.1.1, a 1.6 tool): one kebab-case label per word of a full-length path; no path is
   * longer (Annex S2 rule 19). Default: none, and paths SHOULD keep to three words.
   */
  readonly pathShape?: ReadonlyArray<string>;
}

/**
 * The contract's reserved options and the codes they imply, which the package adds to every described command so a
 * tool writes none of them: `--json` on every command (spec 4.3); `--input` on the commands `takesInput` names (spec
 * 10.1: every write and destructive command at L2, and a read that declares a batch), with the `INPUT_*` codes;
 * `--fields` on a command whose output declares `fields` (spec 6.10);
 * `--commit` and `--plan-digest` on a destructive command (spec 11.4), each requiring the other with `commitPairCode`
 * (spec 11.7), and `PLAN_STALE` and `commitPairCode` in its errors; `BATCH_INCOMPLETE` on a command that declares a
 * batch (spec 10.11); `CURSOR_INVALID` on a command that takes `--cursor` (spec 6.9); `fieldsCode` on a command that
 * takes `--fields`. An option the command or the tool's `sharedOptions` already gives is kept as given, and an equal
 * relation is not added twice.
 */
export interface ContractRules {
  /** The help of each option the package adds. */
  readonly help: {
    readonly json: string;
    readonly input: string;
    readonly fields: string;
    readonly commit: string;
    readonly planDigest: string;
  };
  /**
   * Whether the command takes `--input`. Default: every `write` and `destructive` command, and a `read` that declares
   * a batch (spec 10.1, Annex S2 rule 5); another `read` may.
   */
  readonly takesInput: (command: CommandDescription) => boolean;
  /**
   * The registered code the relation of `--commit` and `--plan-digest` answers (spec 11.7: `USAGE`, a finer
   * replacement, or the rule's own code). Default: none, `USAGE`.
   */
  readonly commitPairCode?: string;
  /**
   * The registered finer replacement of `USAGE` (spec 7.3.2) a `--fields` path that is no path of the answer is refused
   * with (spec 6.10). Default: none, `USAGE`.
   */
  readonly fieldsCode?: string;
}

/** The contract's own rules, the package's default. */
export const CONTRACT_RULES: ContractRules = {
  help: {
    json: "Print one JSON envelope",
    input: "The arguments as one JSON document: inline, a file, or - for stdin",
    fields: "The paths of the answer to keep, comma-separated",
    commit: "Act: carry out the plan whose digest --plan-digest gives",
    planDigest: "data.planDigest of the preview being committed",
  },
  // a read takes --input when it declares a batch, which only --input can carry (Annex S2 rule 5)
  takesInput: (command) => command.effect !== "read" || command.input.batch !== undefined,
};

/** The contract's options a command does not give itself (its own and the tool's shared ones), in the contract's order. */
const contractOptions = (
  command: CommandDescription,
  rules: ContractRules,
): ReadonlyArray<OptionDescription> => {
  const absent = (name: string) => !command.options.some((option) => option.name === name);
  const destructive = command.effect === "destructive";
  return [
    ...(absent("input") && rules.takesInput(command) ? [inputOption(rules.help.input)] : []),
    ...(absent("fields") && command.outputs.some((output) => output.fields !== undefined)
      ? [fieldsOption(rules.help.fields)]
      : []),
    ...(destructive && absent("commit") ? [commitOption(rules.help.commit)] : []),
    ...(destructive && absent("plan-digest") ? [planDigestOption(rules.help.planDigest)] : []),
    ...(absent("json") ? [jsonOption(rules.help.json)] : []),
  ];
};

/** The relation of `--commit` and `--plan-digest` (spec 11.7), each requiring the other, unless the command states it. */
const contractConstraints = (
  command: CommandDescription,
  stated: ReadonlyArray<ConstraintDescription>,
  rules: ContractRules,
): ReadonlyArray<ConstraintDescription> => {
  const takes = (name: string) => command.options.some((option) => option.name === name);
  if (!takes("commit") || !takes("plan-digest")) return [];
  const code = rules.commitPairCode === undefined ? {} : { code: rules.commitPairCode };
  const pair: ReadonlyArray<ConstraintDescription> = [
    { rule: "requires", if: { name: "commit" }, needs: ["plan-digest"], ...code },
    { rule: "requires", if: { name: "plan-digest" }, needs: ["commit"], ...code },
  ];
  const same = (a: ConstraintDescription, b: ConstraintDescription) =>
    !("names" in a) &&
    !("names" in b) &&
    a.rule === b.rule &&
    a.if.name === b.if.name &&
    a.if.in === undefined &&
    b.if.in === undefined &&
    a.needs.join(",") === b.needs.join(",");
  return pair.filter((rule) => !stated.some((known) => same(known, rule)));
};

/**
 * The codes the contract's options and a batch imply on a command (spec 6.9, 6.10, 7.3.1, 10.11, 11.7), beyond
 * `PLAN_STALE` (`describe`): the `INPUT_*` codes with `--input`, which a document before 1.4 lists (Annex S2 rule 4)
 * and a 1.4 document implies.
 */
const contractCodes = (command: CommandDescription, rules: ContractRules): ReadonlyArray<string> => {
  const takes = (name: string) => command.options.some((option) => option.name === name);
  return [
    ...(takes("input") ? ["INPUT_INVALID", "INPUT_CONFLICT", "INPUT_TOO_LARGE"] : []),
    ...(command.input.batch === undefined ? [] : ["BATCH_INCOMPLETE"]),
    ...(takes("cursor") ? ["CURSOR_INVALID"] : []),
    ...(takes("fields") && rules.fieldsCode !== undefined ? [rules.fieldsCode] : []),
    ...(takes("commit") && rules.commitPairCode !== undefined ? [rules.commitPairCode] : []),
  ];
};

/**
 * The reserved paging and field-selection options (spec 4.5), flag-only in a tool that declares 1.2 (spec 10.6): they
 * choose how much of the answer to print and where to continue it, and a page's `next` carries them on argv.
 */
export const FLAG_ONLY_SINCE_12: ReadonlyArray<string> = ["limit", "cursor", "all", "fields"];

/**
 * A declared command as the tool describes it: its own options, then the tool's shared ones, then the contract's it
 * lacks (in a tool that declares 1.2, the reserved paging and selection options flag-only); its own constraints, then
 * the shared options', then the contract's; its declared codes, then the contract's and the tool's; and the tool's own
 * members as it publishes them.
 */
export const toolDescription = (
  declared: CommandDescription,
  tool: ToolProfile,
): CommandDescription => {
  const shared: CommandDescription = {
    ...declared,
    options: [...declared.options, ...tool.sharedOptions(declared)],
  };
  const options = [...shared.options, ...contractOptions(shared, tool.contract)];
  const withOptions: CommandDescription = {
    ...declared,
    options: declaresAtLeast(tool.contractVersion, "1.2")
      ? options.map((option) =>
          FLAG_ONLY_SINCE_12.includes(option.name) ? { ...option, flagOnly: true } : option,
        )
      : options,
  };
  const constraints = [...declared.constraints, ...tool.sharedConstraints(withOptions)];
  return tool.published({
    ...withOptions,
    constraints: [...constraints, ...contractConstraints(withOptions, constraints, tool.contract)],
    errors: [
      ...new Set([
        ...declared.errors,
        ...contractCodes(withOptions, tool.contract),
        ...tool.contractErrors(withOptions),
      ]),
    ],
  });
};

/**
 * Reads an example's argv by the command's description (spec 4.2): the path words, then `--name value`,
 * `--name=value`, a switch or count by itself, `-x` by an option's `short`, and operands; `--` ends the options.
 * Enough for a document's own examples, which are complete and valid by rule (spec 9.5).
 */
export const readExampleArgv = (
  command: CommandDescription,
  argv: ReadonlyArray<string>,
): ExampleArguments | undefined => {
  if (command.path.some((word, index) => argv[index] !== word)) return undefined;
  const words = argv.slice(command.path.length);
  const operands: Array<string> = [];
  const options: Record<string, string | boolean | ReadonlyArray<string>> = {};
  let ended = false;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    if (ended || !word.startsWith("-") || word === "-") {
      operands.push(word);
      continue;
    }
    if (word === "--") {
      ended = true;
      continue;
    }
    const long = word.startsWith("--");
    const [spelled = "", inline] = long
      ? word.slice(2).split(/=(.*)/s, 2)
      : [word.slice(1), undefined];
    const option = command.options.find((candidate) =>
      long ? candidate.name === spelled : candidate.short === spelled,
    );
    if (option === undefined) return undefined;
    if (option.valueType === "switch") options[option.name] = true;
    else if (option.valueType === "count") {
      const seen = options[option.name];
      options[option.name] = String((typeof seen === "string" ? Number(seen) : 0) + 1);
    } else {
      const value = inline ?? words[++index];
      if (value === undefined) return undefined;
      const seen = options[option.name];
      // a comma list's pieces are its values (spec 9.7.6)
      options[option.name] = option.repeatable
        ? [...(Array.isArray(seen) ? seen : []), ...argvValues(option, value)]
        : value;
    }
  }
  return { operands, options };
};

/** The `--input` option of atip (spec 11): flag-only, a JSON document inline, a file, or `-` for stdin. */
export const inputOption = (help: string): OptionDescription => ({
  name: "input",
  valueName: "JSON|FILE|-",
  valueType: "string",
  required: false,
  repeatable: false,
  default: null,
  flagOnly: true,
  help,
});

/** The `--json` switch (spec 4.3): flag-only. */
export const jsonOption = (help: string): OptionDescription => ({
  name: "json",
  valueType: "switch",
  required: false,
  repeatable: false,
  default: false,
  flagOnly: true,
  help,
});

/** A destructive command's act switch (spec 11.7): only with the digest its preview printed. */
export const commitOption = (help: string): OptionDescription => ({
  name: "commit",
  valueType: "switch",
  required: false,
  repeatable: false,
  default: false,
  flagOnly: true,
  help,
});

/** `--plan-digest` (spec 11.6): the preview's `data.planDigest`, of the form this library computes. */
export const planDigestOption = (help: string): OptionDescription => ({
  name: "plan-digest",
  valueName: "DIGEST",
  valueType: "string",
  required: false,
  repeatable: false,
  default: null,
  domain: { pattern: PLAN_DIGEST_PATTERN },
  flagOnly: true,
  help,
});

/** `--fields` (spec 6.10): the selected paths, comma-separated (Annex F1); flag-only from 1.2 (`toolDescription`). */
export const fieldsOption = (help: string): OptionDescription => ({
  name: "fields",
  valueName: "FIELDS",
  valueType: "string",
  required: false,
  repeatable: false,
  default: null,
  flagOnly: false,
  help,
});

/** What `toolProfile` takes for the contract's rules: any of them, the help text by option. */
export type ContractRulesInput = Partial<Omit<ContractRules, "help">> & {
  readonly help?: Partial<ContractRules["help"]>;
};

/** A tool's profile: its name and generic codes, every other member atip's default unless given. */
export const toolProfile = (
  profile: Pick<ToolProfile, "name" | "genericErrors"> &
    Partial<Omit<ToolProfile, "fragment" | "parser" | "contract">> & {
      readonly fragment?: Partial<FragmentStyle>;
      readonly parser?: ParserSpellingsInput;
      readonly contract?: ContractRulesInput;
    },
): ToolProfile => ({
  contractVersion: CONTRACT_VERSION,
  sharedOptions: () => [],
  sharedConstraints: () => [],
  contractErrors: () => [],
  published: (command) => command,
  listed: () => true,
  errorMembers: () => ({}),
  inputMaxBytes: 1_048_576,
  reportExcessProperty: "error",
  usageReplacements: [],
  readExample: readExampleArgv,
  ...profile,
  parser: parserSpellings(profile.name, profile.parser),
  fragment: { ...ATIP_FRAGMENT_STYLE, ...profile.fragment },
  contract: {
    ...CONTRACT_RULES,
    ...profile.contract,
    help: { ...CONTRACT_RULES.help, ...profile.contract?.help },
  },
});
