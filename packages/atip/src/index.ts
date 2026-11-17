/**
 * `@journeykit/atip`: the atip/1 contract, minors 1.1 to 1.6 (spec v1.6.1), keyed on the minor a tool declares, for a
 * TypeScript tool on Effect 4 — envelope and meta schemas, the core codes and reasons, the code-name conditions, next
 * steps with POSIX quoting, field paths with bracketed keys, cursors bound to their invocation, and destructive plans
 * with their digest and commit line — and the command library of approaches/typescript.md §3: `defineCommand` with an
 * Effect Schema input, `defineError` and `defineWarning`, the argument decoders, `defineTool` with the contract's
 * reserved options and codes, batches, the `schema` documents generated from the declarations, and the runner. A
 * tool's tests validate its output against the contract's JSON Schemas through `@journeykit/atip/validate`.
 *
 * The command library's surface is named here, one module at a time; what a module keeps to itself (the derivation
 * of argument records, the value decoders, the JSON Schema rewriting, the fragment and example builders) is not
 * exported.
 */
export * from "./argv.ts";
export { CONDITIONS, type Condition, type ConditionRow, conditionOf } from "./conditions.ts";
export * from "./cursor.ts";
export * from "./envelope.ts";
export * from "./fields.ts";
export * from "./plan.ts";

// declaring a command
export {
  type AnyOperand,
  count,
  defaulted,
  json,
  type Operand,
  operand,
  type OperandOptions,
  type OperandSchema,
  Path,
  switchOption,
} from "./argument.ts";
export {
  type ActHandler,
  type ArgumentName,
  type Arguments,
  type ArgumentsOf,
  type ArgumentValue,
  type Command,
  type ConditionOf,
  type Declaration,
  defineCommand,
  describeCommand,
  type HandlerFor,
  type HandlerOf,
  type OperandValues,
  type OutputType,
  validateArguments,
} from "./command.ts";
export {
  type AnyOutput,
  artifact,
  atLeastOne,
  atMostOne,
  type ArgumentCondition,
  type ConditionRule,
  type ConstraintDeclaration,
  describeOperands,
  describeOptions,
  type EffectDeclaration,
  exactlyOne,
  forbids,
  type GroupRule,
  type InputSchema,
  type OutputDeclaration,
  report,
  requires,
  type ArgumentsGiven,
  type ValidatorDeclaration,
  type ValidatorRefusal,
} from "./declaration.ts";
export { checkSelection, type FieldsDeclaration, SelectionError } from "./selection.ts";
export {
  type AnyDefinedError,
  type Carrier,
  CommandFailure,
  type DefinedError,
  type DefinedWarning,
  defineError,
  defineWarning,
  type ErrorRow,
  type FailureOf,
  type FailureParts,
  type ReasonText,
  type WarningValue,
} from "./errors.ts";

// decoding its arguments
export { argumentRecord, decodeArguments, type DecodeOptions, decodeDocument } from "./decode.ts";
export { type ArgumentIssue, ArgumentsError, argvField } from "./issues.ts";

// describing it
export {
  type ArgumentDescription,
  type CommandDescription,
  type ConstraintDescription,
  type Domain,
  type EffectKind,
  fieldName,
  type FieldsDescription,
  type Idempotency,
  type InputDescription,
  // a tool's FragmentStyle spells integers and numbers with these (spec 9.7.2)
  INTEGER_PATTERN,
  NUMBER_PATTERN,
  type OperandDescription,
  type OptionDescription,
  // a tool that keeps its own command records reads a comma list's argv and env values with it (spec 9.7.6)
  argvValues,
  optionName,
  type OutputDescription,
  type OutputSchema,
  // a tool that keeps its own command records types their argv values with it
  typedValue,
  type ValidatorDescription,
  type ValueType,
} from "./description.ts";
export {
  commandDocument,
  groupDocument,
  schemasAnswer,
  type SharedOption,
  type SharedOptions,
  sharedOptions,
  treeDocument,
  type TreeCommand,
} from "./document.ts";
export { type ExcessProperty, isJson, isJsonObject, type Json, type JsonObject } from "./json.ts";
export { patternAdmitsComma, patternProblem } from "./pattern.ts";
export { domainProblem, inValueProblem } from "./value.ts";
// the checks `defineTool` runs, for a tool that keeps its own command records
export {
  COMMA_LIST_TYPES,
  commaListProblems,
  optionMeaningProblems,
  pathShapeProblems,
  patternMinorProblems,
} from "./rules-16.ts";
export { unregisteredCodeProblems, usageReplacementProblems } from "./registry-checks.ts";
export {
  ATIP_FRAGMENT_STYLE,
  CONTRACT_RULES,
  type ContractRules,
  type ContractRulesInput,
  DERIVED_FRAGMENT_STYLE,
  commitOption,
  FLAG_ONLY_SINCE_12,
  type ExampleArguments,
  fieldsOption,
  type FragmentStyle,
  type GroupDescription,
  inputOption,
  jsonOption,
  planDigestOption,
  readExampleArgv,
  type ToolProfile,
  toolDescription,
  toolProfile,
} from "./tool.ts";

// parsing its command line and `--input` (spec 4.2, 10)
export {
  type CommandLine,
  type Environment,
  type ParsedCommand,
  parseCommandLine,
} from "./parser.ts";
export { type ArgvValue } from "./parser-checks.ts";
export {
  ATIP_GLOBAL_OPTIONS,
  type ArgvProblem,
  type ArgvRefusal,
  type GlobalOption,
  type HintForm,
  type InputReason,
  type LegacySpellings,
  type ParserProfile,
  parserProfile,
  type ParserSpellings,
  type ParserSpellingsInput,
  parserSpellings,
  type Refused,
  type RemovedSpelling,
} from "./parser-profile.ts";
export { documentField, inputArgv, mergeInput } from "./input.ts";

// the tool: its documents, registries and built-ins (`defineTool`)
export {
  type AnyCommand,
  defineTool,
  Given,
  type GuideSource,
  type RegistryRow,
  SelfDescription,
  type Tool,
  type ToolDeclaration,
} from "./define-tool.ts";
export {
  type SchemaArguments,
  schemaDeclaration,
  schemaHandler,
  type SchemaWording,
  type SkillsArguments,
  skillsDeclaration,
  skillsHandler,
  type SkillsWording,
} from "./builtins.ts";
export {
  type FailureSite,
  type HelpRequest,
  type RunnerEmission,
  type RunnerHooks,
  runCommandLine,
  type ToolInvocation,
} from "./runner.ts";
export {
  batchField,
  type BatchIncomplete,
  type BatchItemError,
  type BatchItemOutcome,
  type BatchItemReport,
  type BatchOutcome,
  batchRefusal,
  type BatchReport,
  batchReport,
  type BatchReportItem,
} from "./batch.ts";
export { distance, suggest } from "./suggest.ts";
