/**
 * The parts of a command declaration that describing it reads (approaches/typescript.md §3.1): its outputs, its
 * constraints and validators, its input Struct and effect; and `describe`, which turns a declaration into its
 * `CommandDescription` or throws when the description could not state it (an argument outside the domain profile, an
 * optional field that does not decode absent as described, a name or an extension key the contract does not allow, a
 * constraint's `in` value the argument does not take). `defineCommand` (command.ts) types the rest.
 */
import type { Schema } from "effect";
import type { AnyOperand } from "./argument.ts";
import { describeInput, describeOperand, type InputFields } from "./derive.ts";
import {
  type ArgumentDescription,
  type CommandDescription,
  type ConstraintDescription,
  type Idempotency,
  KEBAB,
  type OperandDescription,
  type OptionDescription,
  optionName,
  type OutputDescription,
  type ValidatorDescription,
} from "./description.ts";
import type { AnyDefinedError, Carrier, DefinedError, FailureParts } from "./errors.ts";
import { isJson, type Json, type JsonObject } from "./json.ts";
import type { Paging } from "./cursor.ts";
import { PlanStale } from "./plan.ts";
import { describeFields, type FieldsDeclaration } from "./selection.ts";
import { inValueProblem } from "./value.ts";

// ---------------------------------------------------------------------------------------------------- outputs

/** One form a command prints, with the Effect Schema of its `data` (spec 9.9). */
export interface OutputDeclaration<S extends Schema.Top> {
  readonly kind: "report" | "artifact";
  readonly name: string;
  readonly schemaVersion: string;
  readonly schema: S;
  readonly mediaType?: string;
  readonly when?: string;
  /** The output's field selection (spec 6.10): where its records are, the paths always kept, the default selection. */
  readonly fields?: FieldsDeclaration;
  /** `x-<tool>` members of the output entry (spec 9.10.2). */
  readonly ext?: JsonObject;
}

export type AnyOutput = OutputDeclaration<Schema.Top>;

/**
 * A report output: an enveloped report whose `data` is `schema` (its JSON Schema is published as `name`). With
 * `fields` the command takes `--fields` (spec 6.10): its selectable paths are derived from `schema`.
 */
export const report = <S extends Schema.Top>(
  name: string,
  schemaVersion: string,
  schema: S,
  options?: {
    readonly when?: string;
    readonly fields?: FieldsDeclaration;
    readonly ext?: JsonObject;
  },
): OutputDeclaration<S> => ({ kind: "report", name, schemaVersion, schema, ...options });

/** An artifact output: bytes of `mediaType` in text mode, `schema` its `--json` form (spec 9.9.1). */
export const artifact = <S extends Schema.Top>(
  name: string,
  schemaVersion: string,
  mediaType: string,
  schema: S,
): OutputDeclaration<S> => ({ kind: "artifact", name, schemaVersion, mediaType, schema });

// ---------------------------------------------------------------------------------------------------- constraints

/** The argument a requires/forbids rule tests (spec 9.8.1): given, or given with one of `in`. */
export interface ArgumentCondition<Name extends string, Value> {
  readonly name: Name;
  readonly in?: ReadonlyArray<Value>;
}

/** A rule over a group of arguments (spec 9.8.1). */
export interface GroupRule<Name extends string, Code extends string> {
  readonly rule: "atLeastOne" | "exactlyOne" | "atMostOne";
  readonly names: ReadonlyArray<Name>;
  readonly code?: Code;
}

/**
 * A rule conditioned on one argument (spec 9.8.1). `needs` is the wire member `then` (written only on emission: a
 * `then` member makes a record a thenable). In a declaration, `If` types the `in` values as the named argument's own
 * values as JSON gives them, so `in: ["green"]` on an enum of red and blue does not compile.
 */
export interface ConditionRule<Name extends string, Code extends string, If> {
  readonly rule: "requires" | "forbids";
  readonly if: If;
  readonly needs: ReadonlyArray<Name>;
  readonly code?: Code;
}

/** A relation between arguments, naming fields by their field name and operands by theirs. */
export type ConstraintDeclaration<
  Name extends string,
  Code extends string,
  If extends ArgumentCondition<Name, unknown> = ArgumentCondition<Name, Json>,
> = GroupRule<Name, Code> | ConditionRule<Name, Code, If>;

const codeOf = <Code extends string>(error: { readonly code: Code } | undefined) =>
  error === undefined ? {} : { code: error.code };

const condition =
  (rule: "requires" | "forbids") =>
  <
    const If extends string,
    const Needs extends string,
    const In extends ReadonlyArray<Json> = readonly [],
    const Code extends string = never,
  >(
    when: { readonly name: If; readonly in?: In },
    needs: ReadonlyArray<Needs>,
    error?: { readonly code: Code },
  ): ConditionRule<If | Needs, Code, ArgumentCondition<If, In[number]>> => ({
    rule,
    if: when,
    needs,
    ...codeOf(error),
  });

const group =
  (rule: "atLeastOne" | "exactlyOne" | "atMostOne") =>
  <const Name extends string, const Code extends string = never>(
    names: ReadonlyArray<Name>,
    error?: { readonly code: Code },
  ): GroupRule<Name, Code> => ({ rule, names, ...codeOf(error) });

/** When `when` holds (an argument given, with one of `in`), every one of `needs` is given. */
export const requires = condition("requires");
/** When `when` holds, none of `needs` is given. */
export const forbids = condition("forbids");
export const atLeastOne = group("atLeastOne");
export const exactlyOne = group("exactlyOne");
export const atMostOne = group("atMostOne");

/** An input Struct: its fields are the command's options; it and each field decode with no service. */
export type InputSchema = Schema.Decoder<object> & { readonly fields: InputFields };

/** The reasons a defined error registers, as a union of names. */
type ReasonOf<E> = E extends DefinedError<string, infer Reason, Carrier> ? Reason : never;

/**
 * What a validator says when it refuses, beyond its code: the message naming what is wrong with this value, the flag,
 * the value received, a hint (spec 7.1). Absent members are the validator's own: its `description` as the message,
 * its first argument as the field.
 */
export type ValidatorRefusal<Reason extends string = string> = Partial<FailureParts<Reason>>;

/**
 * How the arguments were given: the names of the options whose value came from the environment (spec 10.7 step 5), so
 * a refusal's hint repeats the invocation as the caller wrote it, and the option names in the order the command line
 * gave them (absent: unknown), so a refusal of two exclusive options names the one given second. `fromInput` names the
 * arguments whose value came from the `--input` document (spec 10.7 step 4; absent: unknown), so a validator can take
 * a value only from the document (a credential that must never be a command-line word). `paging` is the
 * invocation's cursor binding and next page (spec 6.9, `pagingOf`), which the command's own arguments cannot tell: it
 * depends on where each argument came from and on the tool's shared options (absent: unknown).
 */
export interface ArgumentsGiven {
  readonly fromEnv: ReadonlyArray<string>;
  readonly fromInput?: ReadonlyArray<string>;
  readonly order?: ReadonlyArray<string>;
  readonly paging?: Paging;
}

/** A stateless check outside the domains and constraints (spec 9.8.2): `check` holds for every accepted argument. */
export interface ValidatorDeclaration<Args, Name extends string, Error extends AnyDefinedError> {
  readonly arguments: ReadonlyArray<Name>;
  readonly error: Error;
  readonly description: string;
  /** Complete invocations that parse and satisfy everything else, and that this validator refuses. */
  readonly rejects: ReadonlyArray<string>;
  /**
   * `true` when the arguments pass; `false`, or the parts of the refusal that say why (a reason of the validator's
   * error, the value refused), when they do not. A method, so a command of specific arguments is still a command of
   * `unknown` ones (`Command<unknown, unknown>`).
   */
  check(args: Args, given: ArgumentsGiven): boolean | ValidatorRefusal<ReasonOf<Error>>;
}

// ---------------------------------------------------------------------------------------------------- declaration

export type EffectDeclaration =
  | { readonly kind: "read" }
  | { readonly kind: "write" | "destructive"; readonly idempotency: Idempotency };

/** What describing reads of a declaration: its parts with the arguments' types erased (`check`, `in`). */
export interface DeclarationView {
  readonly path: readonly [string, ...Array<string>];
  readonly summary: string;
  readonly effect: EffectDeclaration;
  readonly effectNote?: string;
  readonly async?: boolean;
  readonly operands?: ReadonlyArray<AnyOperand>;
  readonly input: InputSchema;
  readonly constraints?: ReadonlyArray<
    ConstraintDeclaration<string, string, ArgumentCondition<string, unknown>>
  >;
  readonly validators?: ReadonlyArray<ValidatorDeclaration<never, string, AnyDefinedError>>;
  readonly outputs: ReadonlyArray<AnyOutput>;
  readonly errors: ReadonlyArray<AnyDefinedError>;
  readonly batch?: { readonly maxItems: number; readonly report: string };
  readonly maxBytes?: number;
  readonly examples: readonly [string, ...Array<string>];
  readonly ext?: JsonObject;
}

/** An extension member's name (spec 9.10.2). */
const EXTENSION = /^x-[a-z][a-z0-9-]*$/;

/** Why an option or operand name is not the contract's (Annex S1 items 3 and 5, spec 9.6). */
const nameProblems = (
  options: ReadonlyArray<OptionDescription>,
  operands: ReadonlyArray<OperandDescription>,
): ReadonlyArray<string> => [
  ...options.flatMap((option) => [
    ...(KEBAB.test(option.name)
      ? []
      : [`--${option.name} is not a lower kebab-case name (Annex S1 item 5): rename its field`]),
    ...(option.name.endsWith("-id")
      ? [
          `--${option.name} ends in -id (Annex S1 item 3: a bare noun, --change not --change-id): rename its field`,
        ]
      : []),
    ...(option.short === undefined || /^[a-zA-Z]$/.test(option.short)
      ? []
      : [`--${option.name}'s short ${option.short} is not one letter`]),
  ]),
  ...operands.flatMap((operand) =>
    KEBAB.test(operand.name) ? [] : [`<${operand.name}> is not a lower kebab-case name (spec 9.6)`],
  ),
];

/** Why extension members are not (spec 9.10.2): every key `x-<name>`, so none can overwrite a member. */
const extensionProblems = (where: string, ext: JsonObject | undefined): ReadonlyArray<string> =>
  Object.keys(ext ?? {})
    .filter((key) => !EXTENSION.test(key))
    .map((key) => `${where}'s ext member ${key} is no x-<name> extension (spec 9.10.2)`);

/** Why a condition's `in` values are not values of the argument it names (spec 9.8.1). */
const inProblems = (
  rule: ConditionRule<string, string, ArgumentCondition<string, unknown>>,
  argument: ArgumentDescription | undefined,
): ReadonlyArray<string> => {
  const values = rule.if.in;
  if (values === undefined || argument === undefined) return [];
  if (values.length === 0) return [`${rule.rule} on ${rule.if.name}: in lists no value`];
  return values.flatMap((value) => {
    const problem = isJson(value)
      ? inValueProblem(argument, value)
      : `${String(typeof value)} is no JSON value`;
    return problem === undefined ? [] : [`${rule.rule} on ${rule.if.name}: in ${problem}`];
  });
};

/** Why a declaration cannot be described, beyond its arguments. */
const declarationProblems = (
  declared: DeclarationView,
  options: ReadonlyArray<OptionDescription>,
  operands: ReadonlyArray<OperandDescription>,
): ReadonlyArray<string> => {
  const names = new Set([
    ...Object.keys(declared.input.fields),
    ...operands.map((entry) => entry.name),
  ]);
  const codes = new Set(declared.errors.map((error) => error.code));
  const unknown = (where: string, used: ReadonlyArray<string>) =>
    used
      .filter((name) => !names.has(name))
      .map((name) => `${where} names ${name}, which is no argument`);
  const described = (name: string): ArgumentDescription | undefined =>
    operands.find((entry) => entry.name === name) ??
    options.find((entry) => entry.name === optionName(name));
  const variadic = operands.findIndex((entry) => entry.variadic);
  const firstOptional = operands.findIndex((entry) => !entry.required);
  return [
    ...nameProblems(options, operands),
    ...declared.path
      .filter((word) => !KEBAB.test(word))
      .map((word) => `the path word ${word} is not lower kebab-case (spec 4.1.1)`),
    ...extensionProblems("the command", declared.ext),
    ...declared.outputs.flatMap((output) =>
      extensionProblems(`the output ${output.name}`, output.ext),
    ),
    ...(variadic !== -1 && variadic !== operands.length - 1
      ? ["a variadic operand is the last one"]
      : []),
    ...(firstOptional !== -1 &&
    operands.slice(firstOptional).some((entry) => entry.required && !entry.variadic)
      ? ["a required operand after an optional one"]
      : []),
    ...operands
      .filter((entry) => options.some((option) => option.name === entry.name))
      .map((entry) => `${entry.name} is an operand and an option`),
    ...(declared.constraints ?? []).flatMap((rule) =>
      "names" in rule
        ? unknown(rule.rule, rule.names)
        : [
            ...unknown(rule.rule, [rule.if.name, ...rule.needs]),
            ...inProblems(rule, described(rule.if.name)),
          ],
    ),
    ...(declared.constraints ?? [])
      .flatMap((rule) => (rule.code === undefined || codes.has(rule.code) ? [] : [rule.code]))
      .map((code) => `a constraint's code ${code} is not in errors`),
    ...(declared.validators ?? []).flatMap((validator) => [
      ...unknown("a validator", validator.arguments),
      ...(validator.arguments.length === 0 ? ["a validator reads at least one argument"] : []),
      ...(validator.rejects.length === 0
        ? ["a validator has at least one rejects invocation"]
        : []),
      ...(codes.has(validator.error.code)
        ? []
        : [`a validator's code ${validator.error.code} is not in errors`]),
    ]),
    ...(declared.outputs.length === 0 ? ["a command has at least one output"] : []),
    ...(declared.batch !== undefined && declared.effect.kind === "destructive"
      ? ["a destructive command takes no batch (spec 10.11)"]
      : []),
  ];
};

/** The argument name a description uses: a field's option name, an operand's own. */
const describedName = (name: string, operandNames: ReadonlySet<string>): string =>
  operandNames.has(name) ? name : optionName(name);

/** The batch output a `batch` declaration adds (spec 10.11): the contract's batch report around each item's data. */
const batchOutput = (first: AnyOutput, version: string): OutputDescription => ({
  kind: "report",
  name: `Batch${first.name}`,
  schemaVersion: version,
  schema: {
    json: {
      description: `The batch output: the generic ATIP batch report with each item's data a ${first.name}.`,
      allOf: [
        { $ref: "https://atip.dev/1/batch-report.schema.json" },
        {
          properties: {
            items: { items: { properties: { data: { $ref: `#/schemas/${first.name}` } } } },
          },
        },
      ],
    },
  },
  batch: true,
  when: "--input is an array or NDJSON",
});

/**
 * The options an input Struct gives (spec 9.7), as `describe` derives them, for a tool that keeps records of its own
 * beside its declared commands (a shared option declared once as a field); throws, listing every problem, as
 * `describe` does.
 */
export const describeOptions = (input: InputSchema): ReadonlyArray<OptionDescription> => {
  const options = describeInput(input);
  const problems = options.ok ? nameProblems(options.value, []) : options.problems;
  if (!options.ok || problems.length > 0)
    throw new Error(`the options cannot be described:\n- ${problems.join("\n- ")}`);
  return options.value;
};

/** The operands as `describe` derives them (spec 9.6), for the same tool; throws, listing every problem. */
export const describeOperands = (
  operands: ReadonlyArray<AnyOperand>,
): ReadonlyArray<OperandDescription> => {
  const described = operands.map(describeOperand);
  const values = described.flatMap((entry) => (entry.ok ? [entry.value] : []));
  const problems = [
    ...described.flatMap((entry) => (entry.ok ? [] : entry.problems)),
    ...nameProblems([], values),
  ];
  if (problems.length > 0)
    throw new Error(`the operands cannot be described:\n- ${problems.join("\n- ")}`);
  return values;
};

/** A declaration's description (spec 9.5); throws, listing every problem, when the description could not state it. */
export const describe = (declared: DeclarationView): CommandDescription => {
  const options = describeInput(declared.input);
  const operands = (declared.operands ?? []).map(describeOperand);
  const problems = [
    ...(options.ok ? [] : options.problems),
    ...operands.flatMap((entry) => (entry.ok ? [] : entry.problems)),
  ];
  const describedOptions = options.ok ? options.value : [];
  const describedOperands = operands.flatMap((entry) => (entry.ok ? [entry.value] : []));
  problems.push(...declarationProblems(declared, describedOptions, describedOperands));
  const selections = declared.outputs.map((output) =>
    output.fields === undefined ? undefined : describeFields(output.schema, output.fields),
  );
  problems.push(
    ...selections.flatMap((selection, index) =>
      selection === undefined || selection.ok
        ? []
        : selection.problems.map(
            (problem) => `the output ${declared.outputs[index]?.name ?? ""}'s fields: ${problem}`,
          ),
    ),
  );
  if (problems.length > 0)
    throw new Error(`${declared.path.join(" ")} cannot be described:\n- ${problems.join("\n- ")}`);
  const operandNames = new Set(describedOperands.map((entry) => entry.name));
  const named = (name: string) => describedName(name, operandNames);
  const constraints: ReadonlyArray<ConstraintDescription> = (declared.constraints ?? []).map(
    (rule) =>
      "names" in rule
        ? {
            rule: rule.rule,
            names: rule.names.map(named),
            ...(rule.code === undefined ? {} : { code: rule.code }),
          }
        : {
            rule: rule.rule,
            if: {
              name: named(rule.if.name),
              // every value is JSON: declarationProblems refused any other
              ...(rule.if.in === undefined ? {} : { in: rule.if.in.filter(isJson) }),
            },
            needs: rule.needs.map(named),
            ...(rule.code === undefined ? {} : { code: rule.code }),
          },
  );
  const validators: ReadonlyArray<ValidatorDescription> = (declared.validators ?? []).map(
    (validator) => ({
      arguments: validator.arguments.map(named),
      code: validator.error.code,
      description: validator.description,
      rejects: validator.rejects,
    }),
  );
  const outputs: ReadonlyArray<OutputDescription> = declared.outputs.map((output, index) => {
    const selection = selections[index];
    return {
      kind: output.kind,
      name: output.name,
      schemaVersion: output.schemaVersion,
      schema: { effect: output.schema },
      ...(output.mediaType === undefined ? {} : { mediaType: output.mediaType }),
      ...(output.when === undefined ? {} : { when: output.when }),
      ...(selection?.ok === true ? { fields: selection.value } : {}),
      ...(output.ext === undefined ? {} : { ext: output.ext }),
    };
  });
  const [first] = declared.outputs;
  return {
    path: declared.path,
    summary: declared.summary,
    effect: declared.effect.kind,
    ...("idempotency" in declared.effect ? { idempotency: declared.effect.idempotency } : {}),
    ...(declared.effectNote === undefined ? {} : { effectNote: declared.effectNote }),
    async: declared.async === true,
    operands: describedOperands,
    options: describedOptions,
    constraints,
    validators,
    outputs:
      declared.batch === undefined || first === undefined
        ? outputs
        : [...outputs, batchOutput(first, declared.batch.report)],
    // a destructive command's runner (`runDestructive`) refuses a stale plan: PLAN_STALE is its code too (spec 7.3.1)
    errors: [
      ...new Set([
        ...declared.errors.map((error) => error.code),
        ...(declared.effect.kind === "destructive" ? [PlanStale.code] : []),
      ]),
    ],
    input: {
      ...(declared.maxBytes === undefined ? {} : { maxBytes: declared.maxBytes }),
      ...(declared.batch === undefined ? {} : { batch: declared.batch }),
    },
    examples: declared.examples,
    ext: declared.ext ?? {},
  };
};
