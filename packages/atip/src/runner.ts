/**
 * The runner of a tool (spec 10.7, 4.4): one command line to its exit, through the contract's steps in the contract's
 * order, with what is the tool's own behind hooks. The runner parses, answers `--help` and `--version` (in JSON mode a
 * 1.4 tool refuses both with `USAGE`, spec 4.4.1; an earlier one answers `--help` with the `schema` document of the
 * same path, when the tool has the built-in), reads `--input` through the tool's hook and merges it (steps 1-5), lets
 * the tool read argument values of its own (a `-` read from stdin), checks the command's validators and the read
 * selection (`--fields`, step 6) before any precondition, then the tool's preconditions on state, then runs the
 * command, and hands every outcome, refusal and failure to the tool to emit. A step that fails stops the invocation;
 * nothing after it runs. An `--input` array to a command that declares `batch` is a batch (spec 10.11, batch.ts):
 * every item through steps 2-6 first, then each through the preconditions and the work, in order.
 *
 * The tool keeps what is its own: how a refusal reads in its registry (`refusal`, `invalid`), how `--input` is read,
 * its preconditions and the context they give the command (a run, a session), how a command runs with its services
 * (`execute`), and how everything is printed (`emit`). The runner names no tool.
 */
import { Cause, Effect, Exit, Option, Result } from "effect";
import { commandLine, isJsonMode } from "./argv.ts";
import { type BatchItemOutcome, type BatchOutcome, batchRefusal } from "./batch.ts";
import { validateArguments } from "./command.ts";
import { pagingOf } from "./cursor.ts";
import { declaresAtLeast } from "./envelope.ts";
import { argumentRecord, decodeArguments } from "./decode.ts";
import type { AnyCommand, Tool } from "./define-tool.ts";
import type { CommandDescription } from "./description.ts";
import type { CommandFailure } from "./errors.ts";
import { inputArgv, mergeInput } from "./input.ts";
import type { ArgumentsError } from "./issues.ts";
import { checkSelection, type SelectionError } from "./selection.ts";
import type { Environment, ParsedCommand } from "./parser.ts";
import type { ArgvRefusal } from "./parser-profile.ts";

/** A command line the runner reached: the command as declared, as the tool describes it, and its arguments. */
export interface ToolInvocation extends ParsedCommand {
  readonly declaration: AnyCommand;
  /**
   * In a batch (spec 10.11), the index of the item this invocation is: a refusal of it names its fields under
   * `/<index>` (`batchField`). Absent: a single invocation.
   */
  readonly item?: number;
}

/** What `--help` asked about: a command, a group, or (neither) the tool. */
export interface HelpRequest {
  readonly command?: CommandDescription;
  readonly group?: string;
}

/**
 * Where a failure stopped the invocation: refused before the command ran (the command, once the path named one), or
 * while it worked (the invocation and the context its preconditions gave).
 */
export type FailureSite<C> =
  | { readonly stage: "refused"; readonly command?: CommandDescription }
  | { readonly stage: "working"; readonly invocation: ToolInvocation; readonly context: C };

/** How the tool prints what the runner reached: each ends the invocation with its exit code. */
export interface RunnerEmission<E, C, A, R> {
  readonly version: Effect.Effect<number, never, R>;
  readonly help: (request: HelpRequest) => Effect.Effect<number, never, R>;
  readonly failure: (failure: E, site: FailureSite<C>) => Effect.Effect<number, never, R>;
  /** The command's answer; a refusal of the answer itself (it cannot be printed as asked) is a failure while working. */
  readonly outcome: (
    outcome: A,
    invocation: ToolInvocation,
    context: C,
  ) => Effect.Effect<number, E, R>;
  /** A defect while the command worked (a bug): the tool logs its cause and prints its internal error. */
  readonly defect: (
    cause: Cause.Cause<unknown>,
    invocation: ToolInvocation,
    context: C,
  ) => Effect.Effect<number, never, R>;
  /**
   * An executed batch (spec 10.11): every item done, or the first to fail during execution `failed` and the rest
   * `skipped` (`batchReport` builds the report and `BATCH_INCOMPLETE`). Needed by a tool with a command that declares
   * `batch`: a batch reaching a runner without it is a defect of the tool.
   */
  readonly batch?: (outcome: BatchOutcome<E, C, A>) => Effect.Effect<number, never, R>;
}

/**
 * The tool's part of an invocation. `E` is the tool's failure (what its envelope prints), `C` the context its
 * preconditions give a command, `A` a command's outcome, `R` the services the hooks use.
 */
export interface RunnerHooks<E, C, A, R> {
  /** A refusal of the parser, the `--input` document or the merge (spec 4.2, 10.7 steps 2-5) as the tool's failure. */
  readonly refusal: (refusal: ArgvRefusal) => E;
  /** Reads `--input`'s value to its document (spec 10.2-10.4, step 1): inline JSON, a file, `-` for stdin. */
  readonly readInput: (value: string, invocation: ToolInvocation) => Effect.Effect<unknown, E, R>;
  /** Argument values the tool reads itself once the arguments are merged (a `-` read from stdin); default: none. */
  readonly values?: (invocation: ToolInvocation) => Effect.Effect<ToolInvocation, E, R>;
  /**
   * A validator's refusal, a value the command's decoder refuses, or a `--fields` path no output selects, as the tool's
   * failure (spec 10.7 step 6).
   */
  readonly invalid: (
    failure: CommandFailure | ArgumentsError | SelectionError,
    invocation: ToolInvocation,
  ) => E;
  /** The tool's checks of state before the command runs (spec 10.7: after every stateless one); its value is the context. */
  readonly preconditions: (invocation: ToolInvocation) => Effect.Effect<C, E, R>;
  /** Runs the command: its handler, with the tool's services and the context provided. */
  readonly execute: (invocation: ToolInvocation, context: C) => Effect.Effect<A, E, R>;
  readonly emit: RunnerEmission<E, C, A, R>;
}

/**
 * Step 6 of spec 10.7, stateless, so a refused value is refused the same way whatever the tool's state: the command's
 * validators on its decoded arguments (9.8.2), given the sources of the arguments and the invocation's paging (a
 * cursor's binding, by the minor the tool declares, spec 6.9), then the read selection against its outputs' `fields`
 * (6.10). A command without validators decodes nothing here; its handler's arguments are decoded when it runs.
 */
const validated = (
  tool: Tool,
  invocation: ToolInvocation,
): Effect.Effect<void, CommandFailure | ArgumentsError | SelectionError> => {
  const { declaration } = invocation;
  const validators =
    declaration.validators.length === 0
      ? Effect.void
      : Effect.flatMap(
          decodeArguments(declaration, argumentRecord(declaration, invocation)),
          (args) =>
            validateArguments(declaration, args, {
              fromEnv: invocation.fromEnv,
              fromInput: invocation.fromInput ?? [],
              paging: pagingOf(tool.profile.contractVersion, invocation),
            }),
        );
  return Effect.andThen(
    validators,
    Effect.fromResult(checkSelection(invocation.command, invocation.options)),
  );
};

/** One command line (argv without the tool's name) to its exit code, through `hooks`. */
export const runCommandLine = <E, C, A, R>(
  tool: Tool,
  argv: ReadonlyArray<string>,
  env: Environment,
  hooks: RunnerHooks<E, C, A, R>,
): Effect.Effect<number, never, R> => {
  const declarations = new Map(tool.commands.map((command) => [tool.describe(command), command]));
  const declarationOf = (description: CommandDescription): AnyCommand => {
    const declaration = declarations.get(description);
    if (declaration === undefined)
      throw new Error(`${description.path.join(" ")} is not a command of ${tool.name}`);
    return declaration;
  };
  const refused = (failure: E, command?: CommandDescription) =>
    hooks.emit.failure(
      failure,
      command === undefined ? { stage: "refused" } : { stage: "refused", command },
    );

  /** The command at work: its outcome emitted, a failure as the tool's, an interruption kept, a defect the tool's bug. */
  const work = (invocation: ToolInvocation, context: C): Effect.Effect<number, never, R> =>
    hooks.execute(invocation, context).pipe(
      Effect.flatMap((outcome) => hooks.emit.outcome(outcome, invocation, context)),
      // failure-policy: the runner's boundary: a failure is emitted as the tool's at the working stage, an
      // interruption stays one, a defect is handed to the tool as its bug
      Effect.catchCause((cause) => {
        const failure = Cause.findErrorOption(cause);
        if (Option.isSome(failure) && !Cause.hasDies(cause))
          return hooks.emit.failure(failure.value, { stage: "working", invocation, context });
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        return hooks.emit.defect(cause, invocation, context);
      }),
    );

  /** A refusal before the work: the tool's failure, and the command it concerns once one resolved. */
  interface Stopped {
    readonly failure: E;
    readonly command: CommandDescription | undefined;
  }

  /**
   * Spec 10.7 steps 2-6 for one invocation: its `--input` document (none: argv alone) validated and merged, the tool's
   * own values, the validators and the read selection. A batch item's refusals of the library name its fields under
   * the item's index (`batchRefusal`).
   */
  const prepare = (
    given: ToolInvocation,
    document: Option.Option<unknown>,
  ): Effect.Effect<ToolInvocation, Stopped, R> =>
    Effect.gen(function* () {
      let invocation = given;
      const { command, item } = given;
      const argvRefusal = (refusal: ArgvRefusal) =>
        hooks.refusal(item === undefined ? refusal : batchRefusal(item, refusal));
      if (Option.isSome(document)) {
        const documentArgv = inputArgv(tool.parser, command, document.value);
        if (Result.isFailure(documentArgv))
          return yield* Effect.fail({ failure: argvRefusal(documentArgv.failure), command });
        // spec 10.7 step 3 (1.2): argv's own parse failure answers once the document is read and validated
        if (invocation.deferred !== undefined)
          return yield* Effect.fail({ failure: hooks.refusal(invocation.deferred), command });
        const merged = mergeInput(tool.parser, invocation, documentArgv.success, env);
        if (Result.isFailure(merged))
          return yield* Effect.fail({
            failure: argvRefusal(merged.failure.refusal),
            command: merged.failure.command,
          });
        invocation = {
          ...merged.success,
          declaration: given.declaration,
          ...(item === undefined ? {} : { item }),
        };
      }
      if (hooks.values !== undefined) {
        // failure-policy: a value the tool cannot read is its refusal; nothing after it runs
        const read = yield* Effect.result(hooks.values(invocation));
        if (Result.isFailure(read)) return yield* Effect.fail({ failure: read.failure, command });
        invocation = read.success;
      }
      // failure-policy: a validator's or the selection's refusal is the tool's, before any precondition (step 6)
      const valid = yield* Effect.result(validated(tool, invocation));
      if (Result.isFailure(valid))
        return yield* Effect.fail({ failure: hooks.invalid(valid.failure, invocation), command });
      return invocation;
    });

  /**
   * A batch (spec 10.11): framed (at least one item, at most `maxItems`), every item through steps 2-6 first, the first
   * refusal answering for the whole batch; then each item through the preconditions and the work, in order, stopping
   * at the first that fails. A defect while an item works is the tool's bug, as in a single invocation.
   */
  const runBatch = (
    given: ToolInvocation,
    documents: ReadonlyArray<unknown>,
    maxItems: number,
  ): Effect.Effect<number, never, R> =>
    Effect.gen(function* () {
      const { command } = given;
      if (documents.length === 0 || documents.length > maxItems)
        return yield* refused(
          hooks.refusal(
            documents.length === 0
              ? {
                  code: "INPUT_INVALID",
                  message: "--input holds an empty batch: give at least one document",
                  field: "--input",
                  reason: "EMPTY",
                  hint: tool.parser.hint.usage(command),
                }
              : {
                  code: "INPUT_TOO_LARGE",
                  message: `--input holds ${documents.length} documents; ${command.path.join(" ")} takes at most ${maxItems}`,
                  field: "--input",
                  reason: "TOO_MANY_ITEMS",
                  hint: tool.parser.hint.usage(command),
                },
          ),
          command,
        );
      const emitBatch = hooks.emit.batch;
      if (emitBatch === undefined)
        return yield* Effect.die(
          new Error(
            `${command.path.join(" ")} declares batch, but the runner hooks of ${tool.name} have no emit.batch`,
          ),
        );
      // preflight: every item's stateless checks before any item runs
      const items: Array<ToolInvocation> = [];
      for (const [index, document] of documents.entries()) {
        const prepared = yield* Effect.result(
          prepare({ ...given, item: index }, Option.some(document)),
        );
        if (Result.isFailure(prepared))
          return yield* refused(prepared.failure.failure, prepared.failure.command);
        items.push(prepared.success);
      }
      // execution: in order, the first failure stops the batch and the rest are skipped
      const outcomes: Array<BatchItemOutcome<E, C, A>> = [];
      for (const [index, invocation] of items.entries()) {
        if (outcomes.some((outcome) => outcome.status === "failed")) {
          outcomes.push({ status: "skipped", index });
          continue;
        }
        // failure-policy: an item's failed precondition is that item's failure; the batch stops there
        const context = yield* Effect.result(hooks.preconditions(invocation));
        if (Result.isFailure(context)) {
          outcomes.push({ status: "failed", index, failure: context.failure, invocation });
          continue;
        }
        const ran = yield* Effect.exit(hooks.execute(invocation, context.success));
        if (Exit.isSuccess(ran)) {
          outcomes.push({
            status: "done",
            index,
            outcome: ran.value,
            invocation,
            context: context.success,
          });
          continue;
        }
        // failure-policy: a failure is that item's, an interruption stays one, a defect is the tool's bug
        const failure = Cause.findErrorOption(ran.cause);
        if (Option.isSome(failure) && !Cause.hasDies(ran.cause)) {
          outcomes.push({ status: "failed", index, failure: failure.value, invocation });
          continue;
        }
        if (Cause.hasInterruptsOnly(ran.cause)) return yield* Effect.interrupt;
        return yield* hooks.emit.defect(ran.cause, invocation, context.success);
      }
      return yield* emitBatch({ command, items: outcomes });
    });

  /** Spec 10.7 from step 1: `--input` (one document or a batch), steps 2-6, the preconditions, then the work. */
  const proceed = (given: ToolInvocation): Effect.Effect<number, never, R> =>
    Effect.gen(function* () {
      const { command } = given;
      const input = given.options["input"];
      let document: Option.Option<unknown> = Option.none();
      if (typeof input === "string") {
        // failure-policy: an unreadable --input is the tool's refusal, emitted; nothing after it runs
        const read = yield* Effect.result(hooks.readInput(input, given));
        if (Result.isFailure(read)) return yield* refused(read.failure, command);
        const batch = command.input.batch;
        if (Array.isArray(read.success) && batch !== undefined)
          return yield* runBatch(given, read.success, batch.maxItems);
        document = Option.some(read.success);
      }
      const prepared = yield* Effect.result(prepare(given, document));
      if (Result.isFailure(prepared))
        return yield* refused(prepared.failure.failure, prepared.failure.command);
      const invocation = prepared.success;
      // failure-policy: a failed precondition is the tool's refusal, emitted; the command does not run
      const context = yield* Effect.result(hooks.preconditions(invocation));
      if (Result.isFailure(context)) return yield* refused(context.failure, command);
      return yield* work(invocation, context.success);
    });

  return Effect.gen(function* () {
    const parsed = tool.parse(argv, env);
    if (Result.isFailure(parsed))
      return yield* refused(hooks.refusal(parsed.failure.refusal), parsed.failure.command);
    const line = parsed.success;
    // spec 4.4.1: JSON mode always prints an envelope in 1.4, so `--help` and `--version` refuse there (the parser has
    // resolved the path); an earlier minor answers `--help --json` with the `schema` document and `--version` as text
    const refuses = isJsonMode(argv) && declaresAtLeast(tool.profile.contractVersion, "1.4");
    if (line.kind === "version")
      return yield* refuses
        ? refused(
            hooks.refusal({
              code: "USAGE",
              message: `--version prints text; with --json every envelope carries the version in meta.toolVersion`,
              field: "--version",
              hint: commandLine(tool.name, ["--version"]),
            }),
          )
        : hooks.emit.version;
    if (line.kind === "invoke")
      return yield* proceed({ ...line.parsed, declaration: declarationOf(line.parsed.command) });
    const path = line.command?.path ?? (line.group === undefined ? [] : [line.group]);
    if (refuses)
      return yield* refused(
        hooks.refusal({
          code: "USAGE",
          message: `--help prints text for people; ${tool.name} schema is the machine description`,
          field: "--help",
          hint: commandLine(tool.name, ["schema", ...path, "--json"]),
        }),
        line.command,
      );
    const request: HelpRequest = {
      ...(line.command === undefined ? {} : { command: line.command }),
      ...(line.group === undefined ? {} : { group: line.group }),
    };
    const schema = isJsonMode(argv) ? tool.command(["schema"]) : undefined;
    if (schema === undefined) return yield* hooks.emit.help(request);
    return yield* proceed({
      declaration: schema,
      command: tool.describe(schema),
      operands: path,
      options: { json: true },
      fromEnv: [],
    });
  });
};
