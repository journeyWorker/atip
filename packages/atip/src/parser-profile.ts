/**
 * What the argv parser needs from a tool besides its commands (spec 4.2, 10.7): the tool's name, which commands its
 * listings show, and its spellings: its global options, the spellings it removed or renamed (Annex S1 item 7), and how its
 * hints read. A tool built with `defineTool` states its spellings in its profile (`ToolProfile.parser`) and its
 * listings once (`ToolProfile.listed`); `tool.parser` is the resolved profile. The parser's refusals come back as typed
 * parts (`ArgvRefusal`, spec 7.1) with atip's codes, worded by the library with the tool's name; a removed spelling is
 * worded by the tool. A tool maps them to its own registry.
 */
import type { CommandDescription } from "./description.ts";
import { CONTRACT_VERSION, type ContractMinor, declaresAtLeast } from "./envelope.ts";

/** A reserved reason the library gives under `INPUT_INVALID` or `INPUT_TOO_LARGE` (spec 7.3.3). */
export type InputReason =
  | "BATCH_UNSUPPORTED"
  | "EMPTY"
  | "NOT_OBJECT"
  | "INVALID_VALUE"
  | "FLAG_ONLY_KEY"
  | "UNKNOWN_KEY"
  | "TOO_MANY_ITEMS";

/**
 * One problem of a command line or an `--input` document (spec 7.1): its code (atip's, or the code a constraint
 * declares) and the parts a caller acts on, in the order a tool prints them before `expected` and `suggestions`.
 */
export interface ArgvProblem {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly received?: string;
  readonly reason?: InputReason;
  readonly hint?: string;
  readonly expected?: ReadonlyArray<string>;
  readonly suggestions?: ReadonlyArray<string>;
}

/** A refusal: its first problem, and every problem in `details` when one input has two or more (spec 10.7 step 2). */
export interface ArgvRefusal extends ArgvProblem {
  readonly details?: ReadonlyArray<ArgvProblem>;
}

/** A refusal with the command it concerns, when the path resolved to one. */
export interface Refused {
  readonly refusal: ArgvRefusal;
  readonly command?: CommandDescription;
}

/** A global option (spec 4.4.1): accepted before the path and after it, answering instead of running the command. */
export interface GlobalOption {
  readonly name: string;
  readonly short?: string;
  readonly answer: "help" | "version";
}

/** A removed spelling's refusal (`UNKNOWN_COMMAND`, Annex S1 item 7), worded by the tool: its hint is the replacement. */
export interface RemovedSpelling {
  readonly message: string;
  readonly received: string;
  readonly expected: ReadonlyArray<string>;
  readonly hint: string;
}

/** The spellings a tool removed or renamed (Annex S1 item 7): each is refused, its hint the replacement. */
export interface LegacySpellings {
  /** A removed two-word command (`play log`), looked up before the groups. */
  readonly removedCommand: (words: ReadonlyArray<string>) => RemovedSpelling | undefined;
  /** A first word that is no command and no group (an old script name). */
  readonly unknownCommand: (words: ReadonlyArray<string>) => RemovedSpelling | undefined;
  /** The new name of a renamed option; refused naming it when the command has an option of that name. */
  readonly renamedOption: (name: string) => string | undefined;
  /** The repeatable option a command's trailing operands became; refused with that option in the hint. */
  readonly movedOperands: (command: CommandDescription) => string | undefined;
}

/** Where a refusal's hint points (spec 7.1: a runnable command line). */
export interface HintForm {
  /** For a command line that names no command. */
  readonly tool: string;
  /** For a group without a command, or an unknown verb in it. */
  readonly group: (group: string) => string;
  /** For an option the command does not have, given twice, or a value not among its possible values. */
  readonly command: (command: CommandDescription) => string;
  /** For a value outside its type or domain, or a broken constraint. */
  readonly arguments: (command: CommandDescription) => string;
  /** For a missing value, operand or option, or too many operands: a complete invocation. */
  readonly usage: (command: CommandDescription) => string;
}

/** How a tool's command line is spelled beyond the grammar: its global options, old spellings and hints. */
export interface ParserSpellings {
  readonly globalOptions: ReadonlyArray<GlobalOption>;
  readonly legacy: LegacySpellings;
  readonly hint: HintForm;
}

/** What a tool gives of its spellings; every member left out is atip's default. */
export interface ParserSpellingsInput {
  readonly globalOptions?: ReadonlyArray<GlobalOption>;
  readonly legacy?: Partial<LegacySpellings>;
  readonly hint?: Partial<HintForm>;
}

/** What the parser needs from the tool: its name, its listings over the commands it parses, and its spellings. */
export interface ParserProfile extends ParserSpellings {
  readonly name: string;
  /**
   * Whether one of the commands the parser was given is listed (`expected` and `suggestions` of an unknown command);
   * unlisted ones still run.
   */
  readonly listed: (command: CommandDescription) => boolean;
  /** The contract minor the tool declares: which minor's check order and constraint `field` the parser follows. */
  readonly contractVersion: ContractMinor;
}

/** `--help`/`-h` and `--version`/`-V` (spec 4.4.1). */
export const ATIP_GLOBAL_OPTIONS: ReadonlyArray<GlobalOption> = [
  { name: "help", short: "h", answer: "help" },
  { name: "version", short: "V", answer: "version" },
];

const NO_LEGACY: LegacySpellings = {
  removedCommand: () => undefined,
  unknownCommand: () => undefined,
  renamedOption: () => undefined,
  movedOperands: () => undefined,
};

/** A tool's spellings: what it gives, atip's default for the rest (its hints point at `<tool> schema … --json`). */
export const parserSpellings = (
  tool: string,
  spellings: ParserSpellingsInput = {},
): ParserSpellings => {
  const schema = (words: ReadonlyArray<string>) => [tool, "schema", ...words, "--json"].join(" ");
  return {
    globalOptions: spellings.globalOptions ?? ATIP_GLOBAL_OPTIONS,
    legacy: { ...NO_LEGACY, ...spellings.legacy },
    hint: {
      tool: schema([]),
      group: (group) => schema([group]),
      command: (command) => schema(command.path),
      arguments: (command) => schema(command.path),
      usage: (command) => command.examples[0] ?? [tool, ...command.path].join(" "),
      ...spellings.hint,
    },
  };
};

/**
 * The parser profile of a tool that keeps its own command list (a `defineTool` tool has `tool.parser`): its name, its
 * listings (default: every command), its spellings and the minor it declares (default: `CONTRACT_VERSION`).
 */
export const parserProfile = (
  profile: ParserSpellingsInput & {
    readonly name: string;
    readonly listed?: (command: CommandDescription) => boolean;
    readonly contractVersion?: ContractMinor;
  },
): ParserProfile => ({
  name: profile.name,
  listed: profile.listed ?? (() => true),
  contractVersion: profile.contractVersion ?? CONTRACT_VERSION,
  ...parserSpellings(profile.name, profile),
});

/**
 * Whether the parser follows 1.2's fixed order (spec 10.7 step 6): the earliest argv parse failure by position (with
 * `--input`, at step 3), then `required`, domains and constraints, operands before options; and 9.8.1's `field`
 * table. A tool that declares 1.1 keeps 1.1's order.
 */
export const fixedOrder = (profile: ParserProfile): boolean =>
  declaresAtLeast(profile.contractVersion, "1.2");

/**
 * The code of an unknown or malformed option (spec 7.3.2): a tool that declares 1.3 uses `OPTION_INVALID`, the finer
 * parse code that follows the code-name grammar (7.2); one that declares 1.2 or earlier keeps `UNKNOWN_OPTION`.
 */
export const unknownOptionCode = (profile: ParserProfile): string =>
  declaresAtLeast(profile.contractVersion, "1.3") ? "OPTION_INVALID" : "UNKNOWN_OPTION";

/** The code of a missing operand: `OPERAND_REQUIRED` for a tool that declares 1.3 (spec 7.2.2), else `OPERAND_MISSING`. */
export const missingOperandCode = (profile: ParserProfile): string =>
  declaresAtLeast(profile.contractVersion, "1.3") ? "OPERAND_REQUIRED" : "OPERAND_MISSING";
