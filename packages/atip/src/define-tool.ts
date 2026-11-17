/**
 * `defineTool` (approaches/typescript.md §3.1): a tool as one value, built from its name, version, groups, the commands
 * it declares with `defineCommand`, its tool-level errors and warnings, its guides and its profile. From the
 * declarations alone it gives what spec 9 publishes: the tree, each group, each command document and (1.4) its schemas
 * answer (the profile's rules applied: shared options, their constraints, the contract codes, the tool's own members),
 * the error registry (the tool-level errors, then every error a command declares) and the warning registry.
 *
 * `schema` and `skills show` are built-ins (builtins.ts): the tool declares them with `defineCommand` from the
 * library's declaration in its own wording (`schemaDeclaration`, `skillsDeclaration`) and the library's handler
 * (`schemaHandler`, `skillsHandler`), and places them in its command list. Their handlers answer from the tool they run in, which the
 * runner provides as `SelfDescription` (`tool.bind`). The runner may provide `Given` too: how the arguments were
 * given, so that `schema` refuses the second of two registry options in the order the command line gave them.
 */
import { Context, Effect, Result, Schema } from "effect";
import type { ActHandler, Command } from "./command.ts";
import type { ArgumentsGiven, OutputDeclaration } from "./declaration.ts";
import type { CommandDescription } from "./description.ts";
import {
  commandDocument,
  groupDocument,
  schemasAnswer,
  type SharedOptions,
  sharedOptions,
  type TreeCommand,
  treeDocument,
} from "./document.ts";
import {
  codeNameProblems,
  declaresAtLeast,
  type RegistryEntry,
  reservedRegistryProblems,
  type WarningEntry,
} from "./envelope.ts";
import { unregisteredCodeProblems, usageReplacementProblems } from "./registry-checks.ts";
import type { AnyDefinedError, DefinedWarning } from "./errors.ts";
import type { Json, JsonObject } from "./json.ts";
import { type CommandLine, type Environment, parseCommandLine } from "./parser.ts";
import type { ParserProfile, Refused } from "./parser-profile.ts";
import {
  commaListProblems,
  optionMeaningProblems,
  pathShapeProblems,
  patternMinorProblems,
} from "./rules-16.ts";
import { type GroupDescription, type ToolProfile, toolDescription, toolProfile } from "./tool.ts";

/** Any defined command, for lists of them. */
export type AnyCommand = Command<unknown, unknown>;

/** One guide `skills show` prints (spec 14.1): its name and its Markdown, short or with its `--full` material. */
export interface GuideSource {
  readonly name: string;
  readonly text: (full: boolean) => string;
}

/** An error registry row (spec 7.4) with the tool's own members (spec 9.10.2). */
export type RegistryRow = RegistryEntry & { readonly [member: `x-${string}`]: Json };

/** What `defineTool` is built from. */
export interface ToolDeclaration {
  readonly name: string;
  /**
   * The version the tool reports (`--version`, `meta.toolVersion`) when it is known where the tool is defined; absent:
   * the runner's environment gives it (a version a build defines at compile time).
   */
  readonly version?: string;
  /** The conformance level the tree declares (spec 9.3). */
  readonly level: string;
  /** In the order the tree lists them. */
  readonly groups: ReadonlyArray<GroupDescription>;
  /** In the order the tree lists them, the built-ins where the tool puts them. */
  readonly commands: ReadonlyArray<AnyCommand>;
  /**
   * Tool-level errors, first in the registry in this order: the codes the runner returns (generic ones, the
   * during-work codes of spec 8.3) and any the tool registers beyond its commands.
   */
  readonly errors: ReadonlyArray<AnyDefinedError>;
  /** The warning registry, in order (spec 7.5.2). */
  readonly warnings: ReadonlyArray<DefinedWarning<string>>;
  /** What `skills show` prints, and the guide it prints without a name. */
  readonly guides: { readonly list: ReadonlyArray<GuideSource>; readonly default: string };
  /** The tool's rules for its documents (`toolProfile` without the name). */
  readonly profile: Omit<Parameters<typeof toolProfile>[0], "name">;
}

/** A tool: its commands, their documents and the registries, all derived from its declaration. */
export interface Tool {
  readonly name: string;
  readonly version: string | undefined;
  readonly level: string;
  readonly profile: ToolProfile;
  readonly groups: ReadonlyArray<GroupDescription>;
  readonly commands: ReadonlyArray<AnyCommand>;
  /** The commands the tree and the groups list (`profile.listed`). */
  readonly listed: ReadonlyArray<AnyCommand>;
  /** The command whose path is `words`, listed or not. */
  readonly command: (words: ReadonlyArray<string>) => AnyCommand | undefined;
  /**
   * A command as the tool describes it (`toolDescription`): what its document prints and its parser enforces. Made
   * once per command, so a description is the same value wherever it comes from.
   */
  readonly describe: (command: AnyCommand) => CommandDescription;
  /** Every command described, in the tool's order: what its parser resolves a command line against. */
  readonly descriptions: () => ReadonlyArray<CommandDescription>;
  /**
   * The tool's parser profile: its name, its spellings (`profile.parser`) and its listings (`profile.listed`, read
   * on the declaration of the command a description describes).
   */
  readonly parser: ParserProfile;
  /** Parses a command line (argv without the tool name) against the tool's commands (spec 4.2, 10.7 steps 3-6). */
  readonly parse: (
    argv: ReadonlyArray<string>,
    env: Environment,
  ) => Result.Result<CommandLine, Refused>;
  /** The tree (spec 9.3); in 1.4 with the shared options (`options`). */
  readonly tree: () => JsonObject;
  readonly group: (name: string) => JsonObject | undefined;
  /** The command document (spec 9.5), in the form of the minor the tool declares. */
  readonly document: (command: AnyCommand) => JsonObject;
  /** The command's schemas answer (spec 9.9.3; 1.4): its refs' JSON Schemas, `Input`, its validators' `rejects`. */
  readonly schemas: (command: AnyCommand) => JsonObject;
  /** The error registry: the tool-level errors, then every error a command declares, each code once. */
  readonly errors: ReadonlyArray<RegistryRow>;
  readonly warnings: ReadonlyArray<WarningEntry>;
  readonly guides: ToolDeclaration["guides"];
  /** The command with `SelfDescription` (this tool) provided to its handler: how a runner runs a built-in. */
  readonly bind: <Args, A, E, R, Outputs extends ReadonlyArray<OutputDeclaration<Schema.Top>>>(
    command: Command<Args, ActHandler<Args, A, E, R>, Outputs>,
  ) => Command<Args, ActHandler<Args, A, E, Exclude<R, SelfDescription>>, Outputs>;
}

/** The tool a built-in answers about: the runner provides it (`tool.bind`). */
export class SelfDescription extends Context.Service<SelfDescription, Tool>()(
  "@journeykit/atip/define-tool/SelfDescription",
) {}

/** How the arguments of the running command were given (spec 10.7), when the runner knows it. */
export class Given extends Context.Service<Given, ArgumentsGiven>()(
  "@journeykit/atip/define-tool/Given",
) {}

/**
 * The registry: the tool-level errors in their order, then each command's declared errors (and its validators') in
 * command order. One code is one `defineError` value: a second value for a code is refused when the tool is defined,
 * whether its row differs or not, so a lookup by code always finds the declaration every command lists.
 */
const registryOf = (
  toolErrors: ReadonlyArray<AnyDefinedError>,
  commands: ReadonlyArray<AnyCommand>,
): ReadonlyArray<RegistryEntry> => {
  const declared = new Map<string, AnyDefinedError>();
  const add = (error: AnyDefinedError, where: string) => {
    const known = declared.get(error.code);
    if (known === undefined) declared.set(error.code, error);
    else if (JSON.stringify(known.entry) !== JSON.stringify(error.entry))
      throw new Error(`${where}: ${error.code} is defined twice, with different rows`);
    else if (known !== error) throw new Error(`${where}: ${error.code} is defined twice`);
  };
  for (const error of toolErrors) add(error, "the tool's errors");
  for (const command of commands) {
    const where = command.description.path.join(" ");
    for (const error of command.errors) add(error, where);
    for (const validator of command.validators) add(validator.error, where);
  }
  return [...declared.values()].map((error) => error.entry);
};

/** Defines a tool from its declaration (approaches/typescript.md §3.1). */
export const defineTool = (declaration: ToolDeclaration): Tool => {
  const profile = toolProfile({ ...declaration.profile, name: declaration.name });
  const { commands, groups } = declaration;
  const ids = commands.map((command) => command.description.path.join(" "));
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length > 0) throw new Error(`commands declared twice: ${twice.join(", ")}`);
  const warningCodes = declaration.warnings.map((warning) => warning.code);
  if (new Set(warningCodes).size !== warningCodes.length)
    throw new Error("a warning code is declared twice");
  if (!declaration.guides.list.some((guide) => guide.name === declaration.guides.default))
    throw new Error(`the default guide ${declaration.guides.default} is not a guide`);
  const listed = commands.filter((command) => profile.listed(command.description));
  const minor = profile.contractVersion;
  // a tool that declares 1.3 or earlier has no `schema --schemas` (spec 9.9.3 is since 1.4): its `schema` is described
  // without the switch, so its parser refuses it as an unknown option and its document does not list it
  const declared = (command: AnyCommand): CommandDescription =>
    declaresAtLeast(minor, "1.4") || command.description.path.join(" ") !== "schema"
      ? command.description
      : {
          ...command.description,
          options: command.description.options.filter((option) => option.name !== "schemas"),
        };
  // each command described once; a description leads back to its command, so listings read the declaration
  const described = new Map<AnyCommand, CommandDescription>();
  const declarations = new Map<CommandDescription, AnyCommand>();
  const describe = (command: AnyCommand): CommandDescription => {
    const known = described.get(command);
    if (known !== undefined) return known;
    const description = toolDescription(declared(command), profile);
    described.set(command, description);
    declarations.set(description, command);
    return description;
  };
  let all: ReadonlyArray<CommandDescription> | undefined;
  const descriptions = () => {
    all ??= commands.map(describe);
    return all;
  };
  const listedSet = new Set<AnyCommand>(listed);
  const parser: ParserProfile = {
    name: declaration.name,
    // a description of this tool's is listed when its command is; any other by the profile's rule
    listed: (description) => {
      const command = declarations.get(description);
      return command === undefined ? profile.listed(description) : listedSet.has(command);
    },
    contractVersion: profile.contractVersion,
    ...profile.parser,
  };
  const entries: ReadonlyArray<TreeCommand> = listed.map((command) => command.description);
  const registry = registryOf(declaration.errors, commands);
  // a reserved code has its reserved exit and retryability, STOPPED_MIDWAY its reserved reasons in a 1.2 tool; in a 1.3
  // tool every code is a core code or follows the code-name grammar with its condition's exit and retryability
  const registryProblems = new Set([
    ...reservedRegistryProblems(profile.contractVersion, registry),
    ...codeNameProblems(profile.contractVersion, registry),
    ...usageReplacementProblems(profile.usageReplacements, registry),
    ...unregisteredCodeProblems(descriptions(), profile.genericErrors, registry),
  ]);
  if (registryProblems.size > 0) throw new Error([...registryProblems].join("; "));
  // the rules between commands: comma lists, the path shape, the pattern dialect of the declared minor, one meaning
  // per option name
  const shapeProblems = [
    ...commaListProblems(minor, descriptions()),
    ...pathShapeProblems(
      minor,
      profile.pathShape,
      commands.map((command) => command.description.path),
    ),
    ...patternMinorProblems(minor, descriptions()),
    // between the documents a caller reads, as the checker does: the listed commands (the tree's shared options too)
    ...optionMeaningProblems(minor, listed.map(describe)),
  ];
  if (shapeProblems.length > 0) throw new Error(shapeProblems.join("; "));
  const errors: ReadonlyArray<RegistryRow> = registry.map((entry) => ({
    ...entry,
    ...profile.errorMembers(entry.code),
  }));
  // the tree's shared options (1.4), from the commands it lists; made once, read by the tree and every document
  let shared: SharedOptions | undefined;
  const sharedOnce = (): SharedOptions => {
    shared ??= declaresAtLeast(minor, "1.4") ? sharedOptions(listed.map(describe), minor) : [];
    return shared;
  };
  const tool: Tool = {
    name: declaration.name,
    version: declaration.version,
    level: declaration.level,
    profile,
    groups,
    commands,
    listed,
    command: (words) => {
      const id = words.join(" ");
      return commands.find((command) => command.description.path.join(" ") === id);
    },
    describe,
    descriptions,
    parser,
    parse: (argv, env) => parseCommandLine(parser, descriptions(), argv, env),
    tree: () =>
      treeDocument(entries, groups, declaration.level, minor, sharedOnce(), profile.pathShape),
    group: (name) => {
      const group = groups.find((candidate) => candidate.name === name);
      return group === undefined ? undefined : groupDocument(entries, group, minor);
    },
    document: (command) => commandDocument(declared(command), profile, sharedOnce()),
    schemas: (command) => schemasAnswer(declared(command), profile),
    errors,
    warnings: declaration.warnings.map((warning) => warning.entry),
    guides: declaration.guides,
    bind: (command) => ({
      ...command,
      handler: (args) => Effect.provideService(command.handler(args), SelfDescription, tool),
    }),
  };
  return tool;
};
