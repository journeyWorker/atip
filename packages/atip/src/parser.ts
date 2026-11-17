/**
 * The argv parser over command descriptions (spec 4.2, 10.7 steps 3-6): resolves the command path, then options and
 * operands, environment defaults, required arguments, types, domains and constraints. Every refusal carries `field`,
 * `expected`, `suggestions` and a runnable `hint` (spec 7.1); a removed or renamed spelling is refused with its
 * replacement (Annex S1 item 7). Pure: the environment is passed in, and an `--input` document is merged by `mergeInput`
 * (`input.ts`) after the tool read it.
 */
import { Result } from "effect";
import { commandLine, isJsonMode } from "./argv.ts";
import { declaresAtLeast } from "./envelope.ts";
import type { CommandDescription } from "./description.ts";
import {
  type ArgvValue,
  constraintProblem,
  piecesOf,
  typeProblem,
  valuesProblem,
} from "./parser-checks.ts";
import {
  type ArgvRefusal,
  fixedOrder,
  missingOperandCode,
  type ParserProfile,
  type Refused,
  unknownOptionCode,
} from "./parser-profile.ts";
import { suggest } from "./suggest.ts";

/** A command line the parser accepted: the command, its arguments as argv text, and where each came from. */
export interface ParsedCommand {
  readonly command: CommandDescription;
  readonly operands: ReadonlyArray<string>;
  /** Option name → value, in the order given; environment values after them. */
  readonly options: Readonly<Record<string, ArgvValue>>;
  /** Options whose value came from the environment, by name. */
  readonly fromEnv: ReadonlyArray<string>;
  /** The arguments whose value came from the `--input` document: option names, and `operands` (spec 10.7 step 4). */
  readonly fromInput?: ReadonlyArray<string>;
  /**
   * A tool that declares 1.2, with `--input`: argv's first parse failure, which answers at spec 10.7 step 3, after the
   * document is read and validated (steps 1-2). The runner refuses with it then; the arguments are argv's as read.
   */
  readonly deferred?: ArgvRefusal;
}

/** What a command line asks for. */
export type CommandLine =
  | { readonly kind: "invoke"; readonly parsed: ParsedCommand }
  | { readonly kind: "help"; readonly command?: CommandDescription; readonly group?: string }
  | { readonly kind: "version" };

/** The environment the parser reads defaults from (spec 9.7.1 `env`). */
export type Environment = Readonly<Record<string, string | undefined>>;

const refused = (refusal: ArgvRefusal, command?: CommandDescription): Refused =>
  command === undefined ? { refusal } : { refusal, command };

const idOf = (command: CommandDescription): string => command.path.join(" ");

/** A list as prose: `a, b and c`. */
const listed = (items: ReadonlyArray<string>): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

type Resolved =
  | { readonly command: CommandDescription; readonly rest: ReadonlyArray<string> }
  | { readonly group: string }
  | { readonly refusal: ArgvRefusal };

/** Resolves the command words at the start of argv. */
const resolve = (
  profile: ParserProfile,
  commands: ReadonlyArray<CommandDescription>,
  words: ReadonlyArray<string>,
): Resolved => {
  const tool = profile.name;
  const first = words[0];
  const tops = [
    ...new Set(commands.filter(profile.listed).map((command) => command.path[0] ?? "")),
  ];
  if (first === undefined || first === "--json")
    return {
      refusal: {
        code: "COMMAND_REQUIRED",
        message: `${tool} needs a command`,
        hint: profile.hint.tool,
        expected: tops,
      },
    };
  if (first.startsWith("-")) {
    const spellings = profile.globalOptions.flatMap((option) => [
      `--${option.name}`,
      ...(option.short === undefined ? [] : [`-${option.short}`]),
    ]);
    return {
      refusal: {
        code: unknownOptionCode(profile),
        message: `${first}: before the command ${tool} takes only ${listed(spellings)}`,
        field: first,
        received: first,
        hint: profile.hint.tool,
        expected: spellings,
      },
    };
  }
  const single = commands.find((command) => command.path.length === 1 && command.path[0] === first);
  if (single !== undefined) return { command: single, rest: words.slice(1) };
  const removed = profile.legacy.removedCommand(words.slice(0, 2));
  if (removed !== undefined)
    return {
      refusal: {
        code: "UNKNOWN_COMMAND",
        message: removed.message,
        field: "command",
        received: removed.received,
        hint: removed.hint,
        expected: removed.expected,
      },
    };
  const inGroup = commands.filter(
    (command) => command.path.length > 1 && command.path[0] === first,
  );
  if (inGroup.length > 0) {
    const second = words[1];
    if (second === undefined || second.startsWith("-")) return { group: first };
    const command = inGroup.find((candidate) => candidate.path[1] === second);
    if (command !== undefined) return { command, rest: words.slice(2) };
    const verbs = inGroup.filter(profile.listed).map((one) => one.path[1] ?? "");
    const destructive = new Set(
      inGroup.filter((one) => one.effect === "destructive").map((one) => one.path[1] ?? ""),
    );
    return {
      refusal: {
        code: "UNKNOWN_COMMAND",
        message: `${tool} ${first} has no command ${second}`,
        field: "command",
        received: second,
        hint: profile.hint.group(first),
        expected: verbs,
        suggestions: suggest(second, verbs, destructive).map((verb) => `${first} ${verb}`),
      },
    };
  }
  const script = profile.legacy.unknownCommand(words);
  if (script !== undefined)
    return {
      refusal: {
        code: "UNKNOWN_COMMAND",
        message: script.message,
        field: "command",
        received: script.received,
        hint: script.hint,
        expected: script.expected,
      },
    };
  return {
    refusal: {
      code: "UNKNOWN_COMMAND",
      message: `${tool} has no command ${first}`,
      field: "command",
      received: first,
      hint: profile.hint.tool,
      expected: tops,
      suggestions: suggest(first, tops),
    },
  };
};

/**
 * The global option standing where an option can stand: before `--`, and not the value of a valued option
 * (`--reason -V` is a reason, `status 7 -- --help` an operand).
 */
const globalRequest = (
  profile: ParserProfile,
  command: CommandDescription | undefined,
  tokens: ReadonlyArray<string>,
): "help" | "version" | undefined => {
  // the spellings whose next word is their value: `--name` and a declared `-x` of a valued option
  const valued = new Set(
    (command?.options ?? [])
      .filter((option) => option.valueName !== undefined)
      .flatMap((option) => [
        `--${option.name}`,
        ...(option.short === undefined ? [] : [`-${option.short}`]),
      ]),
  );
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "--") return undefined;
    const global = profile.globalOptions.find(
      (option) => token === `--${option.name}` || token === `-${option.short ?? "-"}`,
    );
    if (global !== undefined) return global.answer;
    if (valued.has(token)) i += 1;
  }
  return undefined;
};

/** The global option a command line starts with, if any. */
const leadingRequest = (
  profile: ParserProfile,
  argv: ReadonlyArray<string>,
): "help" | "version" | undefined => {
  const leading = argv[0];
  return profile.globalOptions.find(
    (option) =>
      leading === `--${option.name}` ||
      (option.short !== undefined && leading === `-${option.short}`),
  )?.answer;
};

/**
 * Parses a command line (argv without the tool name) against the commands' descriptions (spec 4.2): the path, then
 * the options and operands, the environment, required arguments, types, domains and constraints. A command line
 * with `--input` is its explicit arguments only (spec 10.7 step 3): the environment, required arguments and
 * constraints wait for `mergeInput`.
 */
export const parseCommandLine = (
  profile: ParserProfile,
  commands: ReadonlyArray<CommandDescription>,
  argv: ReadonlyArray<string>,
  env: Environment,
): Result.Result<CommandLine, Refused> => {
  const leading = leadingRequest(profile, argv);
  // spec 4.4.1 (1.4): in JSON mode a leading `--help` or `--version` is refused once the words after it resolve, so an
  // unknown word there is UNKNOWN_COMMAND; otherwise it answers at once
  const resolves = declaresAtLeast(profile.contractVersion, "1.4") && isJsonMode(argv);
  if (leading !== undefined && !(resolves && /^[^-]/.test(argv[1] ?? "-")))
    return Result.succeed({ kind: leading });
  const resolved = resolve(profile, commands, leading === undefined ? argv : argv.slice(1));
  if ("refusal" in resolved) return Result.fail(refused(resolved.refusal));
  if ("group" in resolved) {
    const { group } = resolved;
    const request = leading ?? globalRequest(profile, undefined, argv.slice(1));
    if (request === "version") return Result.succeed({ kind: "version" });
    if (request === "help") return Result.succeed({ kind: "help", group });
    return Result.fail(
      refused({
        code: "COMMAND_REQUIRED",
        message: `${profile.name} ${group} is a group; add one of its commands`,
        field: "command",
        hint: profile.hint.group(group),
        expected: commands
          .filter((one) => one.path.length > 1 && one.path[0] === group && profile.listed(one))
          .map((one) => one.path[1] ?? ""),
      }),
    );
  }
  const { command, rest } = resolved;
  const request = leading ?? globalRequest(profile, command, rest);
  if (request === "version") return Result.succeed({ kind: "version" });
  if (request === "help") return Result.succeed({ kind: "help", command });
  const scanned = scan(profile, command, rest, fixedOrder(profile));
  if (scanned.failure !== undefined) {
    // --input given twice leaves no one document to read first: argv's failure answers now (spec 10.2)
    const inputs = rest.filter((word) => word === "--input" || word.startsWith("--input=")).length;
    if (!fixedOrder(profile) || typeof scanned.options["input"] !== "string" || inputs > 1)
      return Result.fail(refused(scanned.failure, command));
    const parsed: ParsedCommand = {
      command,
      operands: scanned.operands,
      options: scanned.options,
      fromEnv: [],
      deferred: scanned.failure,
    };
    return Result.succeed({ kind: "invoke", parsed });
  }
  return Result.map(
    finishArguments(profile, command, scanned.operands, scanned.options, env),
    (parsed): CommandLine => ({ kind: "invoke", parsed }),
  );
};

interface Scanned {
  readonly operands: ReadonlyArray<string>;
  readonly options: Readonly<Record<string, ArgvValue>>;
}

/** The refusal of an option the command does not have: a renamed spelling names its replacement (Annex S1 item 7). */
const unknownOption = (
  profile: ParserProfile,
  command: CommandDescription,
  rest: ReadonlyArray<string>,
  name: string,
  validFlags: ReadonlyArray<string>,
): ArgvRefusal => {
  const renamed = profile.legacy.renamedOption(name);
  const replacement =
    renamed !== undefined && command.options.some((option) => option.name === renamed)
      ? renamed
      : undefined;
  if (replacement === undefined)
    return {
      code: unknownOptionCode(profile),
      message: `${profile.name} ${idOf(command)} has no option --${name}`,
      field: `--${name}`,
      received: `--${name}`,
      hint: profile.hint.command(command),
      expected: validFlags,
      suggestions: suggest(
        name,
        command.options.map((option) => option.name),
      ).map((near) => `--${near}`),
    };
  return {
    code: unknownOptionCode(profile),
    message: `--${name} was renamed --${replacement}`,
    field: `--${name}`,
    received: `--${name}`,
    // the same invocation with the replacement
    hint: commandLine(profile.name, [
      ...command.path,
      ...rest.map((word) =>
        word === `--${name}`
          ? `--${replacement}`
          : word.startsWith(`--${name}=`)
            ? `--${replacement}=${word.slice(name.length + 3)}`
            : word,
      ),
    ]),
    expected: validFlags,
    suggestions: [`--${replacement}`],
  };
};

/** The words a command line has, read; `failure` its first parse failure, if any (spec 10.7 step 3). */
interface Scan extends Scanned {
  readonly failure?: ArgvRefusal;
}

/**
 * Reads the options and operands of one command's words (spec 4.2.2), without requirements, environment or
 * constraints. Unordered (a 1.1 tool, or a document's argv, already validated at step 2), it stops at the first failure
 * it meets. Ordered (argv of a 1.2 tool), it reads every word and keeps the failure at the earliest argv position, a
 * value's type and a word past the last operand included (spec 10.7 step 6), so that `--input` is known even after a
 * bad word.
 */
const scan = (
  profile: ParserProfile,
  command: CommandDescription,
  rest: ReadonlyArray<string>,
  ordered: boolean,
): Scan => {
  const byName = new Map(command.options.map((option) => [option.name, option]));
  const options: Record<string, ArgvValue> = {};
  const operands: Array<string> = [];
  const variadic = command.operands.find((operand) => operand.variadic);
  const validFlags = [
    ...command.options.map((option) => `--${option.name}`),
    ...profile.globalOptions.map((option) => `--${option.name}`),
  ];
  // the earliest failure; "extra" an operand past the last one, worded once every word is read
  let failure: ArgvRefusal | "extra" | undefined;
  let afterDashes = false;
  for (let i = 0; i < rest.length && (ordered || failure === undefined); i++) {
    const token = rest[i] ?? "";
    const isOperand = afterDashes || !token.startsWith("-") || token === "-" || /^-\d/.test(token);
    const short =
      !isOperand && token.startsWith("-") && !token.startsWith("--")
        ? command.options.find(
            (option) => option.short !== undefined && token === `-${option.short}`,
          )
        : undefined;
    if (!afterDashes && token === "--") {
      afterDashes = true;
      continue;
    }
    if (isOperand) {
      const operand = command.operands[operands.length] ?? variadic;
      if (ordered && failure === undefined)
        failure =
          operand === undefined
            ? "extra"
            : typeProblem(profile, command, operand, operand.name, token);
      operands.push(token);
      continue;
    }
    if (short === undefined && !token.startsWith("--")) {
      const shorts = [...profile.globalOptions, ...command.options].flatMap((option) =>
        option.short === undefined ? [] : [`-${option.short}`],
      );
      failure ??= {
        code: unknownOptionCode(profile),
        message: `${token}: ${profile.name} uses long options only (besides ${listed(shorts)})`,
        field: token,
        received: token,
        hint: profile.hint.command(command),
        expected: validFlags,
      };
      continue;
    }
    // a declared short option is its long name, in the separate form only (spec 4.2.2)
    const eq = short === undefined ? token.indexOf("=") : -1;
    const name = short?.name ?? token.slice(2, eq === -1 ? undefined : eq);
    const option = byName.get(name);
    if (option === undefined) {
      // read on as if it were a switch: what follows is still read for its own failures and for --input
      failure ??= unknownOption(profile, command, rest, name, validFlags);
      continue;
    }
    let value: string | true;
    if (option.valueName === undefined) {
      if (eq !== -1) {
        failure ??= {
          code: "OPTION_VALUE_INVALID",
          message: `--${name} is a ${option.valueType === "count" ? "count" : "switch"} and takes no value`,
          field: `--${name}`,
          received: token.slice(eq + 1),
          hint: profile.hint.command(command),
        };
        continue;
      }
      value = true;
    } else if (eq !== -1) value = token.slice(eq + 1);
    else {
      const next = rest[i + 1];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) {
        failure ??= {
          code: "OPTION_VALUE_REQUIRED",
          message: `--${name} requires a value <${option.valueName}>${next === undefined ? "" : ` (the next word ${next} is an option; quote the value or use --${name}=VALUE)`}`,
          field: `--${name}`,
          hint: profile.hint.usage(command),
          expected: [`<${option.valueName}>`],
        };
        continue;
      }
      value = next;
      i += 1;
    }
    const pieces = value === true ? undefined : piecesOf(profile, command, option, value, ordered);
    if (pieces !== undefined && "refusal" in pieces) {
      failure ??= pieces.refusal;
      continue;
    }
    const previous = options[name];
    // a count is given once per occurrence, and read as their number (spec 4.2.2)
    if (option.valueType === "count")
      options[name] = String((typeof previous === "string" ? Number(previous) : 0) + 1);
    else if (option.repeatable)
      // occurrences add up, a comma list's pieces in order (spec 9.7.6)
      options[name] = [
        ...(Array.isArray(previous) ? previous : []),
        ...(pieces?.values ?? [String(value)]),
      ];
    else if (previous !== undefined)
      failure ??= {
        code: "OPTION_CONFLICT",
        message: `--${name} was given twice`,
        field: `--${name}`,
        hint: profile.hint.command(command),
      };
    else options[name] = value;
  }
  if (failure === undefined) return { operands, options };
  return {
    operands,
    options,
    failure: failure === "extra" ? extraOperands(profile, command, operands, options) : failure,
  };
};

/**
 * Reads the options and operands of one command's words (spec 4.2.2), without requirements, environment or
 * constraints: the relaxed first pass of spec 10.7 step 3, refused with its first parse failure.
 */
export const scanArguments = (
  profile: ParserProfile,
  command: CommandDescription,
  rest: ReadonlyArray<string>,
): Result.Result<Scanned, ArgvRefusal> => {
  const { failure, operands, options } = scan(profile, command, rest, false);
  return failure === undefined ? Result.succeed({ operands, options }) : Result.fail(failure);
};

/** The invocation, as argv, with the values that became an option written as that option (Annex S1 item 7). */
const movedHint = (
  profile: ParserProfile,
  command: CommandDescription,
  operands: ReadonlyArray<string>,
  given: Readonly<Record<string, ArgvValue>>,
  movedTo: string,
): string =>
  commandLine(profile.name, [
    ...command.path,
    ...operands.slice(0, command.operands.length),
    ...operands.slice(command.operands.length).flatMap((value) => [`--${movedTo}`, value]),
    ...Object.entries(given).flatMap(([name, value]) =>
      value === true
        ? [`--${name}`]
        : typeof value === "string" &&
            command.options.some((option) => option.name === name && option.valueType === "count")
          ? Array.from({ length: Number(value) }, () => `--${name}`)
          : (typeof value === "string" ? [value] : value).flatMap((one) => [`--${name}`, one]),
    ),
  ]);

/** The refusal of operands past the last one: a word a moved spelling now takes as an option (Annex S1 item 7), or one too many. */
const extraOperands = (
  profile: ParserProfile,
  command: CommandDescription,
  operands: ReadonlyArray<string>,
  given: Readonly<Record<string, ArgvValue>>,
): ArgvRefusal => {
  const movedTo = profile.legacy.movedOperands(command);
  return movedTo !== undefined
    ? {
        code: "USAGE",
        message: `${profile.name} ${idOf(command)} takes these values with --${movedTo}, once per value`,
        field: "operands",
        received: operands.slice(command.operands.length).join(" "),
        hint: movedHint(profile, command, operands, given, movedTo),
      }
    : {
        code: "OPERAND_INVALID",
        message: `${profile.name} ${idOf(command)} takes ${command.operands.length} operand(s); got ${operands.length}`,
        field: "operands",
        received: operands.slice(command.operands.length).join(" "),
        hint: profile.hint.usage(command),
      };
};

/**
 * Operand counts, environment defaults, required arguments, domains and constraints (spec 10.7 steps 5-6), in that
 * order: within `required` and domains, operands first, then options in declaration order (1.2; 1.1 checks options'
 * values before operands'). With `--input` among the options, these are the explicit argv arguments of step 3: the
 * environment, required arguments and constraints wait for the merge (`mergeInput`); a 1.1 tool checks the given values'
 * types and domains here, a 1.2 tool checked their types while reading argv and checks domains after the merge.
 */
export const finishArguments = (
  profile: ParserProfile,
  command: CommandDescription,
  operands: ReadonlyArray<string>,
  given: Readonly<Record<string, ArgvValue>>,
  env: Environment,
): Result.Result<ParsedCommand, Refused> => {
  const fail = (refusal: ArgvRefusal) => Result.fail(refused(refusal, command));
  const givenInput = given["input"] !== undefined;
  const required = command.operands.filter((operand) => operand.required);
  const variadic = command.operands.some((operand) => operand.variadic);
  if (!variadic && operands.length > command.operands.length)
    return fail(extraOperands(profile, command, operands, given));
  if (operands.length < required.length && !givenInput) {
    const missing = required[operands.length];
    return fail({
      code: missingOperandCode(profile),
      message: `${profile.name} ${idOf(command)} needs <${missing?.valueName ?? ""}>`,
      field: missing?.name ?? "",
      hint: profile.hint.usage(command),
      expected: [`<${missing?.valueName ?? ""}>`],
    });
  }
  const options: Record<string, ArgvValue> = { ...given };
  const fromEnv: Array<string> = [];
  for (const option of givenInput ? [] : command.options) {
    if (options[option.name] !== undefined || option.env === undefined) continue;
    const value = env[option.env];
    if (value === undefined || value === "") continue;
    // an env value of a comma list is split like its argv value (spec 9.7.6)
    const pieces = piecesOf(profile, command, option, value, false);
    if ("refusal" in pieces) return fail({ ...pieces.refusal, field: option.env });
    options[option.name] = option.repeatable ? pieces.values : value;
    fromEnv.push(option.name);
  }
  const missing = command.options.find(
    (option) => option.required && options[option.name] === undefined,
  );
  if (missing !== undefined && !givenInput)
    return fail({
      code: "OPTION_REQUIRED",
      message: `${profile.name} ${idOf(command)} needs --${missing.name} <${missing.valueName ?? ""}>`,
      field: `--${missing.name}`,
      hint: profile.hint.usage(command),
    });
  // spec 10.7 step 6: the types and domains of every value; the relations once --input is merged
  if (!givenInput || !fixedOrder(profile)) {
    const invalid = valuesProblem(profile, command, operands, options);
    if (invalid !== undefined) return fail(invalid);
  }
  if (!givenInput) {
    const broken = constraintProblem(profile, command, operands, options, fromEnv);
    if (broken !== undefined) return fail(broken);
  }
  return Result.succeed({ command, operands, options, fromEnv });
};
