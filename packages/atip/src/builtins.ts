/**
 * The built-ins of a tool defined with `defineTool` (approaches/typescript.md §3.1): `schema` (spec 9.1-9.5, 9.9.3,
 * 7.4, 7.5) and `skills show` (spec 14.1). A built-in is two parts the tool joins with `defineCommand`: its
 * declaration in the tool's wording, to which the tool adds its report, the errors it lists and its own members, and
 * its handler, typed by the tool's errors it fails with (so the type checker holds it to the declared errors, as for any
 * command), which answers from the tool it runs in (`SelfDescription`).
 */
import { Effect, Option, Schema } from "effect";
import { commandLine } from "./argv.ts";
import { operand, switchOption } from "./argument.ts";
import type { ArgumentsGiven } from "./declaration.ts";
import { Given, SelfDescription } from "./define-tool.ts";
import { declaresAtLeast } from "./envelope.ts";
import type { Carrier, CommandFailure, DefinedError } from "./errors.ts";
import { suggest } from "./suggest.ts";

/** One of the tool's defined errors, by its code and reasons. */
type ToolError<Code extends string, Reason extends string> = DefinedError<Code, Reason, Carrier>;

/** A built-in's answer, decoded with the report the tool declared for it. */
const answer =
  <S extends Schema.Top & Schema.Decoder<unknown>>(report: S) =>
  (data: unknown): Effect.Effect<S["Type"]> =>
    Effect.orDie(Schema.decodeEffect(report)(data));

// ---------------------------------------------------------------------------------------------------- schema

const REGISTRY_OPTIONS = ["errors", "error", "warnings", "warning"] as const;
type RegistryOption = (typeof REGISTRY_OPTIONS)[number];

/** The arguments of the built-in `schema`. */
export interface SchemaArguments {
  readonly operands: ReadonlyArray<string>;
  readonly schemas: boolean;
  readonly errors: boolean;
  readonly error?: string;
  readonly warnings: boolean;
  readonly warning?: string;
}

/** The tool's wording of its `schema` command. */
export interface SchemaWording {
  readonly summary: string;
  /** The command words operand, and what its absence means. */
  readonly command: string;
  readonly commandDefault: string;
  /** `--schemas` (spec 9.9.3): the JSON Schemas of one command. */
  readonly schemas: string;
  readonly errors: string;
  readonly error: string;
  readonly warnings: string;
  readonly warning: string;
  readonly examples: readonly [string, ...Array<string>];
}

/**
 * The declaration of the built-in `schema` (spec 9.1): `schema [WORD...]`, `--schemas`, `--errors`, `--error <CODE>`,
 * `--warnings`, `--warning <CODE>`, in the tool's wording. The tool adds its report, the errors it lists (among them
 * the two `schemaHandler` fails with) and its own members. `--schemas` is since 1.4: `defineTool` describes an earlier
 * tool's `schema` without it.
 */
export const schemaDeclaration = (wording: SchemaWording) => ({
  path: ["schema"] as const,
  summary: wording.summary,
  effect: { kind: "read" } as const,
  operands: [
    operand("command", Schema.String, {
      valueName: "WORD",
      help: wording.command,
      defaultNote: wording.commandDefault,
      variadic: true,
      required: false,
    }),
  ] as const,
  input: Schema.Struct({
    schemas: switchOption(wording.schemas),
    errors: switchOption(wording.errors),
    error: Schema.optionalKey(
      Schema.String.annotate({ valueName: "CODE", description: wording.error }),
    ),
    warnings: switchOption(wording.warnings),
    warning: Schema.optionalKey(
      Schema.String.annotate({ valueName: "CODE", description: wording.warning }),
    ),
  }),
  examples: wording.examples,
});

/** The registry options given, in the order the command line gave them (in declaration order when unknown). */
const registryOptions = (
  args: SchemaArguments,
  given: Option.Option<ArgumentsGiven>,
): ReadonlyArray<RegistryOption> => {
  const present = REGISTRY_OPTIONS.filter((name) =>
    name === "errors" || name === "warnings" ? args[name] : args[name] !== undefined,
  );
  const order = Option.match(given, { onNone: () => undefined, onSome: (known) => known.order });
  if (order === undefined) return present;
  const at = (name: RegistryOption) => {
    const index = order.indexOf(name);
    return index === -1 ? order.length : index;
  };
  return present.toSorted((a, b) => at(a) - at(b));
};

/**
 * The handler of the built-in `schema` (spec 9.1-9.5, 9.9.3, 7.5.2), answering from the tool it runs in
 * (`SelfDescription`): no words, the tree; a group's name, the group; a command's words (or one quoted word,
 * `"run status"`), its document, or with `--schemas` (1.4) its schemas answer; `--errors`, `--error`, `--warnings`,
 * `--warning`, a registry or one row. `--schemas` without a command, with a group or a registry option is `usage` on
 * `--schemas` (spec 9.1.1). A command path and the four options exclude each other as `usage`, on the option given
 * second (`Given`) or on `<command>`; a
 * code that is in the other registry only is refused with the command that shows it (spec 7.4.3). Words that name
 * nothing are `unknownCommand` on `command` (spec 9.1.1), `expected` the words valid where the first unknown one is
 * (omitted when none is, as after a leaf command). Every answer is decoded with `report`.
 */
export const schemaHandler =
  <
    S extends Schema.Top & Schema.Decoder<unknown>,
    UsageCode extends string,
    UsageReason extends string,
    UnknownCode extends string,
    UnknownReason extends string,
  >(refusals: {
    readonly report: S;
    readonly usage: ToolError<UsageCode, UsageReason>;
    readonly unknownCommand: ToolError<UnknownCode, UnknownReason>;
  }) =>
  (
    args: SchemaArguments,
  ): Effect.Effect<
    S["Type"],
    CommandFailure<UsageCode, UsageReason> | CommandFailure<UnknownCode, UnknownReason>,
    SelfDescription
  > =>
    Effect.gen(function* () {
      const tool = yield* SelfDescription;
      const given = yield* Effect.serviceOption(Given);
      const answered = answer(refusals.report);
      const usage = refusals.usage;
      const form = (option: RegistryOption, code: string): string =>
        commandLine(tool.name, [
          "schema",
          `--${option}`,
          ...(option === "error" || option === "warning" ? [code] : []),
          "--json",
        ]);
      const [first, second] = registryOptions(args, given);
      const words = args.operands;
      if (args.schemas) {
        // spec 9.1.1: --schemas needs a command path and none of the registry options
        if (!declaresAtLeast(tool.profile.contractVersion, "1.4"))
          return yield* usage.fail({
            message: `--schemas is since atip 1.4 and ${tool.name} declares ${tool.profile.contractVersion}: a command document holds its schemas`,
            field: "--schemas",
            hint: commandLine(tool.name, ["schema", ...words, "--json"]),
          });
        if (first !== undefined) {
          const code =
            (first === "error" ? args.error : first === "warning" ? args.warning : "") ?? "";
          return yield* usage.fail({
            message: `--schemas and --${first} cannot be used together: --schemas takes the words of one command`,
            field: "--schemas",
            hint: form(first, code),
          });
        }
        if (words.length === 0)
          return yield* usage.fail({
            message:
              "--schemas needs the words of a command: it answers one command's JSON Schemas",
            field: "--schemas",
            hint: commandLine(tool.name, ["schema", "--json"]),
          });
      }
      if (first !== undefined) {
        const code =
          (first === "error" ? args.error : first === "warning" ? args.warning : "") ?? "";
        if (second !== undefined)
          return yield* usage.fail({
            message: `--${first} and --${second} cannot be used together: ask one registry at a time`,
            field: `--${second}`,
            hint: form(first, code),
          });
        if (words.length > 0)
          return yield* usage.fail({
            message: `--${first} takes no command words (got ${words.join(" ")})`,
            field: "<command>",
            received: words.join(" "),
            hint: form(first, code),
          });
        const errorCodes = tool.errors.map((row) => row.code);
        const warningCodes = tool.warnings.map((row) => row.code);
        switch (first) {
          case "errors":
            return yield* answered({ kind: "errors", errors: tool.errors });
          case "warnings":
            return yield* answered({ kind: "warnings", warnings: tool.warnings });
          case "error": {
            const row = tool.errors.find((entry) => entry.code === code);
            if (row !== undefined) return yield* answered({ kind: "error", error: row });
            return yield* usage.fail(
              warningCodes.includes(code)
                ? {
                    message: `${code} is a warning code, not an error code`,
                    field: "--error",
                    received: code,
                    hint: form("warning", code),
                  }
                : {
                    message: `no error code ${code}`,
                    field: "--error",
                    received: code,
                    suggestions: suggest(code, errorCodes),
                    hint: form("errors", ""),
                  },
            );
          }
          case "warning": {
            const row = tool.warnings.find((entry) => entry.code === code);
            if (row !== undefined) return yield* answered({ kind: "warning", warning: row });
            return yield* usage.fail(
              errorCodes.includes(code)
                ? {
                    message: `${code} is an error code, not a warning code`,
                    field: "--warning",
                    received: code,
                    hint: form("error", code),
                  }
                : {
                    message: `no warning code ${code}`,
                    field: "--warning",
                    received: code,
                    suggestions: suggest(code, warningCodes),
                    hint: form("warnings", ""),
                  },
            );
          }
        }
      }
      if (words.length === 0) return yield* answered(tool.tree());
      const id = words.join(" ").trim().split(/\s+/);
      const command = tool.command(id);
      if (command !== undefined)
        return yield* answered(args.schemas ? tool.schemas(command) : tool.document(command));
      const group = tool.group(id.join(" "));
      if (group !== undefined && args.schemas)
        return yield* usage.fail({
          message: `${id.join(" ")} is a group: --schemas answers for one command`,
          field: "--schemas",
          hint: commandLine(tool.name, ["schema", ...id, "--json"]),
        });
      if (group !== undefined) return yield* answered(group);
      const paths = tool.listed.map((entry) => entry.description.path);
      // the words before the first one no listed path has at its position, and the words valid there (spec 9.1.1)
      const unknownAt = id.findIndex(
        (_, index) =>
          !paths.some((path) => id.slice(0, index + 1).every((word, at) => path[at] === word)),
      );
      const known = unknownAt === -1 ? id : id.slice(0, unknownAt);
      const valid = [
        ...new Set(
          paths
            .filter(
              (path) => path.length > known.length && known.every((word, at) => path[at] === word),
            )
            .map((path) => path[known.length] ?? ""),
        ),
      ];
      return yield* refusals.unknownCommand.fail({
        message: `no command ${id.join(" ")}`,
        field: "command",
        received: id.join(" "),
        ...(valid.length === 0 ? {} : { expected: valid }),
        suggestions: suggest(
          id.join(" "),
          paths.map((path) => path.join(" ")),
        ),
        hint: commandLine(tool.name, ["schema", ...known, "--json"]),
      });
    });

// ---------------------------------------------------------------------------------------------------- skills show

/** The arguments of the built-in `skills show`. */
export interface SkillsArguments {
  readonly operands: readonly [string | undefined];
  readonly full: boolean;
}

/** The tool's wording of its `skills show` command. */
export interface SkillsWording {
  readonly summary: string;
  /** The guide name operand, and what its absence means. */
  readonly name: string;
  readonly nameDefault: string;
  readonly full: string;
  readonly examples: readonly [string, ...Array<string>];
}

/**
 * The declaration of the built-in `skills show [NAME] [--full]` (spec 14.1), in the tool's wording. The tool adds its
 * guide report (`{name, text, guides, full}`), the errors it lists (among them the one `skillsHandler` fails with) and
 * its own members.
 */
export const skillsDeclaration = (wording: SkillsWording) => ({
  path: ["skills", "show"] as const,
  summary: wording.summary,
  effect: { kind: "read" } as const,
  operands: [
    operand("name", Schema.String, {
      valueName: "NAME",
      help: wording.name,
      defaultNote: wording.nameDefault,
      required: false,
    }),
  ] as const,
  input: Schema.Struct({ full: switchOption(wording.full) }),
  examples: wording.examples,
});

/**
 * The handler of the built-in `skills show`: the named guide, or the tool's default one, from the tool it runs in
 * (`SelfDescription`); an unknown name is `notFound`, with the guides there are. The guide is decoded with `report`.
 */
export const skillsHandler =
  <
    S extends Schema.Top & Schema.Decoder<unknown>,
    Code extends string,
    Reason extends string,
  >(refusals: {
    readonly report: S;
    readonly notFound: ToolError<Code, Reason>;
  }) =>
  (
    args: SkillsArguments,
  ): Effect.Effect<S["Type"], CommandFailure<Code, Reason>, SelfDescription> =>
    Effect.gen(function* () {
      const tool = yield* SelfDescription;
      const names = tool.guides.list.map((guide) => guide.name);
      const name = args.operands[0] ?? tool.guides.default;
      const guide = tool.guides.list.find((entry) => entry.name === name);
      if (guide === undefined)
        return yield* refusals.notFound.fail({
          message: `no guide ${name}`,
          field: "name",
          received: name,
          expected: names,
          suggestions: suggest(name, names),
          hint: commandLine(tool.name, ["skills", "show"]),
        });
      return yield* answer(refusals.report)({
        name: guide.name,
        text: guide.text(args.full),
        guides: names,
        full: args.full,
      });
    });
