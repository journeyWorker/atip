/**
 * `defineCommand` (approaches/typescript.md §3): one declaration per command. Its arguments are an Effect Schema
 * Struct and its operands; its outputs are its report schemas; its errors are `defineError` values. The handler gets
 * `{ operands, ...arguments }` typed from the declaration, so reading an argument the command does not declare does
 * not compile, and its error channel is the declared errors' failures, so failing with an undeclared one does not
 * compile either. A destructive command's handler is `{ plan, commit }` (§3.5, `runDestructive` in plan.ts).
 *
 * The declaration is checked when it is defined (`describe`, declaration.ts): what the description could not state
 * throws, so a tool's tests fail on load rather than its `schema` answer lying.
 */
import { Effect, Result, Schema } from "effect";
import type { AnyOperand, Operand } from "./argument.ts";
import {
  type AnyOutput,
  type ArgumentsGiven,
  type ArgumentCondition,
  type ConstraintDeclaration,
  type DeclarationView,
  describe,
  type EffectDeclaration,
  type InputSchema,
  type ValidatorDeclaration,
} from "./declaration.ts";
import { type CommandDescription, optionName } from "./description.ts";
import type { AnyDefinedError, CommandFailure, FailureOf } from "./errors.ts";
import { argumentIssues, ArgumentsError } from "./issues.ts";
import type { JsonObject } from "./json.ts";
import type { Plan, PlanHandler } from "./plan.ts";

// ---------------------------------------------------------------------------------------------------- arguments

type OperandValue<O> =
  O extends Operand<string, infer S, false, infer Required>
    ? Required extends true
      ? S["Type"]
      : S["Type"] | undefined
    : never;

/** The handler's `operands`: one value per operand, a variadic one's values last. */
export type OperandValues<O extends ReadonlyArray<AnyOperand>> = O extends readonly [
  infer Head,
  ...infer Tail extends ReadonlyArray<AnyOperand>,
]
  ? Head extends Operand<string, infer S, true, boolean>
    ? ReadonlyArray<S["Type"]>
    : readonly [OperandValue<Head>, ...OperandValues<Tail>]
  : readonly [];

/** What a handler gets: the operands and the decoded input (defaults applied). */
export type Arguments<Input extends InputSchema, Operands extends ReadonlyArray<AnyOperand>> = {
  readonly operands: OperandValues<Operands>;
} & Input["Type"];

/** The names constraints and validators may use: the input's field names and the operands' names. */
export type ArgumentName<Input extends InputSchema, Operands extends ReadonlyArray<AnyOperand>> =
  | (keyof Input["fields"] & string)
  | Operands[number]["name"];

type ElementOf<T> = T extends ReadonlyArray<infer Element> ? Element : T;

/** One value of a named argument as JSON gives it (an element of a repeatable option): what `in` lists. */
export type ArgumentValue<
  Input extends InputSchema,
  Operands extends ReadonlyArray<AnyOperand>,
  Name,
> = Exclude<
  Name extends keyof Input["fields"]
    ? ElementOf<Input["fields"][Name]["Encoded"]>
    : Extract<Operands[number], { readonly name: Name }>["schema"]["Encoded"],
  undefined
>;

/** Every condition a declaration's rules may state: one argument, with `in` values of that argument's type. */
export type ConditionOf<Input extends InputSchema, Operands extends ReadonlyArray<AnyOperand>> = {
  readonly [Name in ArgumentName<Input, Operands>]: ArgumentCondition<
    Name,
    ArgumentValue<Input, Operands, Name>
  >;
}[ArgumentName<Input, Operands>];

/** The declaration of a command (§3.1); `effect` decides the handler's shape. */
export interface Declaration<
  Input extends InputSchema,
  Operands extends ReadonlyArray<AnyOperand>,
  Errors extends ReadonlyArray<AnyDefinedError>,
  Outputs extends ReadonlyArray<AnyOutput>,
  Kind extends EffectDeclaration,
> {
  readonly path: readonly [string, ...Array<string>];
  readonly summary: string;
  readonly effect: Kind;
  /** Every effect the effect class does not say (spec 9.5). */
  readonly effectNote?: string;
  /** Exit 0 means accepted, not done (spec 12.2). */
  readonly async?: boolean;
  readonly operands?: Operands;
  /** The options, one field each (`Schema.Struct({})` for none). */
  readonly input: Input;
  readonly constraints?: ReadonlyArray<
    ConstraintDeclaration<
      NoInfer<ArgumentName<Input, Operands>>,
      NoInfer<Errors[number]["code"]>,
      NoInfer<ConditionOf<Input, Operands>>
    >
  >;
  readonly validators?: ReadonlyArray<
    ValidatorDeclaration<
      NoInfer<Arguments<Input, Operands>>,
      NoInfer<ArgumentName<Input, Operands>>,
      NoInfer<Errors[number]>
    >
  >;
  readonly outputs: Outputs;
  readonly errors: Errors;
  /** A batch input of at most `maxItems` documents, answered by a batch report of version `report` (spec 10.11). */
  readonly batch?: { readonly maxItems: number; readonly report: string };
  /** The most bytes `--input` takes; absent: the tool's. */
  readonly maxBytes?: number;
  readonly examples: readonly [string, ...Array<string>];
  /** `x-<tool>` members (spec 9.10.2): each key `x-…`. */
  readonly ext?: JsonObject;
}

/** The type of what an output list's handler returns: the data of one of its outputs. */
export type OutputType<Outputs extends ReadonlyArray<AnyOutput>> =
  Outputs[number]["schema"]["Type"];

/** A read or write command's handler. */
export type ActHandler<Args, A, E, R> = (args: Args) => Effect.Effect<A, E, R>;

/** The handler a command of effect `Kind` has: `{ plan, commit }` for a destructive one, else a function. */
export type HandlerOf<
  Kind extends EffectDeclaration,
  Args,
  A,
  E,
  R,
  P extends Plan,
  RPlan,
> = Kind extends {
  readonly kind: "destructive";
}
  ? PlanHandler<Args, P, A, E, R, RPlan>
  : ActHandler<Args, A, E, R>;

/** Nothing when the effect is one of `Want`; else an object the handler lacks, named by the rule it breaks. */
type OnlyFor<
  Kind extends EffectDeclaration,
  Want extends EffectDeclaration["kind"],
  Rule extends string,
> = Kind["kind"] extends Want ? unknown : { readonly [_ in Rule]: never };

/**
 * What `defineCommand` accepts as the handler: either shape, each allowed only for its effect. A union and not
 * `HandlerOf`, because TypeScript infers the plan type of `{ plan, commit }` (for `commit`'s parameter) only from a
 * contextual type that is no conditional; the wrong shape fails with the rule as its message.
 */
export type HandlerFor<Kind extends EffectDeclaration, Args, A, E, R, P extends Plan, RPlan> =
  | (ActHandler<Args, A, E, R> &
      OnlyFor<Kind, "read" | "write", "a destructive command's handler is { plan, commit }">)
  | (PlanHandler<Args, P, A, E, R, RPlan> &
      OnlyFor<
        Kind,
        "destructive",
        "a read or write command's handler is a function of its arguments"
      >);

/** A defined command: its description, its handler and outputs as declared, and the decoders of its arguments. */
export interface Command<
  Args,
  Handler,
  Outputs extends ReadonlyArray<AnyOutput> = ReadonlyArray<AnyOutput>,
> {
  readonly description: CommandDescription;
  readonly handler: Handler;
  /** The outputs as declared, with their Effect Schemas: a tool encodes the handler's result with them. */
  readonly outputs: Outputs;
  /** The input Struct as declared: the argument schema of its options (spec 10.7 step 6). */
  readonly input: InputSchema;
  readonly operands: ReadonlyArray<AnyOperand>;
  /**
   * The decoded options and operands as the handler gets them: the input decoded by the argument schema (defaults,
   * domains), the operands by theirs. The caller has already turned argv strings into values (`decode.ts`).
   */
  readonly toArguments: (
    options: unknown,
    operands: ReadonlyArray<unknown>,
  ) => Effect.Effect<Args, ArgumentsError>;
  readonly validators: ReadonlyArray<ValidatorDeclaration<Args, string, AnyDefinedError>>;
  /** The errors as declared: the registry `defineTool` builds holds each of them (spec 7.4). */
  readonly errors: ReadonlyArray<AnyDefinedError>;
}

/** The arguments a command's handler gets. */
export type ArgumentsOf<C> = C extends Command<infer Args, unknown> ? Args : never;

/** The schema of the operands as the argument schema decodes them: each operand's own schema, a variadic one last. */
const operandsSchema = (operands: ReadonlyArray<AnyOperand>): Schema.Decoder<unknown> => {
  const fixed = operands
    .filter((entry) => !entry.variadic)
    .map((entry) => (entry.required ? entry.schema : Schema.optionalKey(entry.schema)));
  const variadic = operands.find((entry) => entry.variadic);
  return variadic === undefined
    ? Schema.Tuple(fixed)
    : Schema.TupleWithRest(Schema.Tuple(fixed), [variadic.schema]);
};

/**
 * Whether decoded operands have the types the declaration gives them: `O` is the declared operands' type, `operands`
 * the declared operands (none when the declaration has none).
 */
const isOperandValues =
  <O extends ReadonlyArray<AnyOperand>>(operands: ReadonlyArray<AnyOperand>) =>
  (values: ReadonlyArray<unknown>): values is OperandValues<O> =>
    (operands.some((entry) => entry.variadic) || values.length <= operands.length) &&
    operands.every((entry, index) =>
      entry.variadic
        ? values.slice(index).every((value) => Schema.is(entry.schema)(value))
        : (index >= values.length && !entry.required) || Schema.is(entry.schema)(values[index]),
    );

/**
 * Defines a command (approaches/typescript.md §3.1). The handler's type follows the declared effect: a function of the
 * typed arguments for a read or a write, `{ plan, commit }` for a destructive command (§3.5). Its error channel is the
 * declared errors' failures (and their carriers): failing with another does not compile, and the error names the
 * handler's error type.
 */
export function defineCommand<
  Input extends InputSchema,
  const Kind extends EffectDeclaration,
  const Operands extends ReadonlyArray<AnyOperand> = readonly [],
  const Errors extends ReadonlyArray<AnyDefinedError> = readonly [],
  const Outputs extends ReadonlyArray<AnyOutput> = ReadonlyArray<AnyOutput>,
  R = never,
  P extends Plan = Plan,
  RPlan = never,
>(
  declaration: Declaration<Input, Operands, Errors, Outputs, Kind>,
  handler: HandlerFor<
    Kind,
    Arguments<Input, Operands>,
    OutputType<Outputs>,
    FailureOf<Errors[number]>,
    R,
    P,
    RPlan
  >,
): Command<
  Arguments<Input, Operands>,
  HandlerOf<
    Kind,
    Arguments<Input, Operands>,
    OutputType<Outputs>,
    FailureOf<Errors[number]>,
    R,
    P,
    RPlan
  >,
  Outputs
>;
export function defineCommand(
  declaration: DeclarationView,
  handler: unknown,
): Command<unknown, unknown> {
  const description = describe(declaration);
  const operands: ReadonlyArray<AnyOperand> = declaration.operands ?? [];
  // the handler's shape is checked by its type, and again here for a caller the type did not reach
  if ((typeof handler === "function") === (declaration.effect.kind === "destructive"))
    throw new Error(
      `${description.path.join(" ")}: ${declaration.effect.kind === "destructive" ? "a destructive command's handler is { plan, commit }" : "a read or write command's handler is a function of its arguments"}`,
    );
  const decodeOptions = Schema.decodeUnknownEffect(declaration.input, { errors: "all" });
  const decodeOperands = Schema.decodeUnknownEffect(operandsSchema(operands), { errors: "all" });
  const isValues = isOperandValues(operands);
  return {
    description,
    handler,
    outputs: declaration.outputs,
    input: declaration.input,
    operands,
    toArguments: (options, values) =>
      Effect.gen(function* () {
        // failure-policy: both decodes run so that one refusal lists every refused value; any failure is refused below
        const decoded = yield* Effect.result(decodeOptions(options));
        const typed = yield* Effect.result(decodeOperands(values));
        if (Result.isFailure(decoded) || Result.isFailure(typed))
          return yield* new ArgumentsError({
            source: "arguments",
            issues: [
              ...(Result.isFailure(decoded) ? argumentIssues(decoded.failure) : []),
              ...(Result.isFailure(typed) ? argumentIssues(typed.failure, "/operands") : []),
            ],
          });
        // the operands were decoded by their own schemas: a mismatch here is a bug of this module
        if (!Array.isArray(typed.success) || !isValues(typed.success))
          return yield* Effect.die(
            `${description.path.join(" ")}: operands decoded to the wrong shape`,
          );
        return { ...decoded.success, operands: typed.success };
      }),
    validators: declaration.validators ?? [],
    errors: declaration.errors,
  };
}

/** A command's description (spec 9.5), as `defineCommand` derived it. */
export const describeCommand = (command: {
  readonly description: CommandDescription;
}): CommandDescription => command.description;

/**
 * The command's validators on decoded arguments (spec 10.7 step 6, after domains and constraints): the first that
 * refuses fails with its code, naming its first argument and saying its description, unless its refusal says more.
 */
export const validateArguments = <Args>(
  command: Command<Args, unknown>,
  args: Args,
  given: ArgumentsGiven = { fromEnv: [] },
): Effect.Effect<void, CommandFailure> => {
  for (const validator of command.validators) {
    const verdict = validator.check(args, given);
    if (verdict === true) continue;
    const [first = ""] = validator.arguments;
    const operand = command.operands.some((entry) => entry.name === first);
    return Effect.fail(
      validator.error.make({
        message: validator.description,
        field: operand ? `<${first}>` : `--${optionName(first)}`,
        ...(verdict === false ? {} : verdict),
      }),
    );
  }
  return Effect.void;
};
