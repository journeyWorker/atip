/**
 * The argument records of a declaration (approaches/typescript.md §3.3): each field's valueType, `required`,
 * `repeatable`, typed `default` and `domain` are read from its JSON Schema (`Schema.toJsonSchemaDocument`) and its
 * annotations, never from Effect's AST, whose node tags may change between minors. A check the JSON Schema cannot
 * show (a `Schema.makeFilter` predicate) is found in the schema's representation (`SchemaRepresentation`, Effect's
 * stable persistence form): a check outside the domain profile (spec 9.7.4, Annex V1) is a build error, since a caller could
 * not learn it from the description; it belongs in the command's validators.
 */
import { Equal, Result, Schema, SchemaRepresentation } from "effect";
import type { AnyOperand } from "./argument.ts";
import {
  type Domain,
  type OperandDescription,
  type OptionDescription,
  optionName,
  type ValueType,
} from "./description.ts";
import { isJson, isJsonObject, type Json, type JsonObject } from "./json.ts";
import { CONTRACT_VERSION } from "./envelope.ts";
import { patternOfSource, patternProblem } from "./pattern.ts";
import { COMMA_LIST_TYPES } from "./rules-16.ts";

/** A field of an input Struct: its schema decodes with no service (the library decodes it absent at definition). */
export type FieldSchema = Schema.Top & Schema.ConstraintDecoder<unknown>;

/** The fields of an input Struct. */
export type InputFields = { readonly [key: string]: FieldSchema };

/** The checks whose JSON Schema keywords are the domain profile (spec 9.7.4, Annex V1), by their representation id. */
const PROFILE_CHECKS: ReadonlySet<string> = new Set(
  [
    "isInt",
    "isFinite",
    "isGreaterThan",
    "isGreaterThanOrEqualTo",
    "isLessThan",
    "isLessThanOrEqualTo",
    "isBetween",
    "isMultipleOf",
    "isMinLength",
    "isMaxLength",
    "isBetweenLength",
    "isPattern",
  ].map((name) => `effect/schema/${name}`),
);

const NUMERIC_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;
const STRING_KEYWORDS = ["minLength", "maxLength", "pattern"] as const;
const STRUCTURAL_KEYWORDS = [
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
] as const;
/** Annotations a JSON Schema node may carry that say nothing about the value. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "$comment",
  "format",
  "default",
  "examples",
]);
const LOWER_BOUNDS: ReadonlySet<string> = new Set([
  "minimum",
  "exclusiveMinimum",
  "minLength",
  "minItems",
]);
const UPPER_BOUNDS: ReadonlySet<string> = new Set([
  "maximum",
  "exclusiveMaximum",
  "maxLength",
  "maxItems",
]);

/** A derivation's result: its value, or why the declaration cannot be described. */
export type Derived<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

const failed = (...problems: ReadonlyArray<string>): Derived<never> => ({ ok: false, problems });

/** The id of a check's representation; undefined when it has none (an opaque predicate). */
const representationId = (check: object): string | undefined => {
  const representation = "representation" in check ? check.representation : undefined;
  return typeof representation === "object" &&
    representation !== null &&
    "id" in representation &&
    typeof representation.id === "string"
    ? representation.id
    : undefined;
};

/**
 * The ids of every check in a representation (`undefined` for an opaque filter). A group with its own id is one
 * check; a group without one is its checks.
 */
const checkIds = (node: unknown, found: Array<string | undefined>): Array<string | undefined> => {
  if (Array.isArray(node)) for (const item of node) checkIds(item, found);
  else if (typeof node === "object" && node !== null) {
    const tag = "_tag" in node ? node._tag : undefined;
    const id = representationId(node);
    if (tag === "Filter" || (tag === "FilterGroup" && id !== undefined)) found.push(id);
    else if (tag === "FilterGroup" && "checks" in node) checkIds(node.checks, found);
    else for (const child of Object.values(node)) checkIds(child, found);
  }
  return found;
};

/** One JSON Schema node with its `$ref` resolved and its `allOf` folded in, bounds tightened. */
const flatten = (node: Json, definitions: JsonObject): Derived<JsonObject> => {
  if (!isJsonObject(node))
    return failed(`a JSON Schema node is not an object: ${JSON.stringify(node)}`);
  const reference = node["$ref"];
  if (typeof reference === "string") {
    const target = definitions[reference.replace(/^#\/\$defs\//, "")];
    if (target === undefined) return failed(`unresolved ${reference}`);
    const { $ref: _, ...siblings } = node;
    const resolved = flatten(target, definitions);
    return resolved.ok ? flatten({ ...resolved.value, ...siblings }, definitions) : resolved;
  }
  const { allOf, ...rest } = node;
  if (allOf === undefined) return { ok: true, value: rest };
  if (!Array.isArray(allOf)) return failed(`allOf is not an array: ${JSON.stringify(allOf)}`);
  const merged: Record<string, Json> = { ...rest };
  for (const part of allOf) {
    const flat = flatten(part, definitions);
    if (!flat.ok) return flat;
    for (const [key, value] of Object.entries(flat.value)) {
      const known = merged[key];
      if (known === undefined || ANNOTATION_KEYWORDS.has(key)) merged[key] = value;
      else if (typeof known === "number" && typeof value === "number" && LOWER_BOUNDS.has(key))
        merged[key] = Math.max(known, value);
      else if (typeof known === "number" && typeof value === "number" && UPPER_BOUNDS.has(key))
        merged[key] = Math.min(known, value);
      else if (JSON.stringify(known) !== JSON.stringify(value))
        return failed(
          `two different ${key} (${JSON.stringify(known)}, ${JSON.stringify(value)}) on one value`,
        );
    }
  }
  return { ok: true, value: merged };
};

/** A field's node without the `null` branch its decoding default adds (`withDecodingDefault` accepts `undefined`). */
const withoutDefaultNull = (node: JsonObject): JsonObject => {
  const branches = node["anyOf"];
  if (!Array.isArray(branches) || branches.length !== 2) return node;
  const [first, second] = branches;
  const isNull = (branch: Json | undefined): boolean =>
    JSON.stringify(branch) === '{"type":"null"}';
  const kept = isNull(second) ? first : isNull(first) ? second : undefined;
  if (kept === undefined || !isJsonObject(kept)) return node;
  const { anyOf: _, ...siblings } = node;
  return { ...kept, ...siblings };
};

/** What one value of an argument is: its valueType, its enum and its domain. */
interface ValueKind {
  readonly valueType: Exclude<ValueType, "count">;
  readonly possibleValues?: ReadonlyArray<string>;
  readonly domain?: Domain;
}

const pick = (
  node: JsonObject,
  keywords: ReadonlyArray<string>,
  drop: (key: string, value: Json) => boolean,
) =>
  Object.fromEntries(
    keywords.flatMap((key) => {
      const value = node[key];
      return value === undefined || drop(key, value) ? [] : [[key, value] as const];
    }),
  );

/** The keywords of a `json` domain that are not its own profile's, recursively (Annex V1). */
const jsonDomainProblems = (node: Json, at: string): ReadonlyArray<string> => {
  if (typeof node === "boolean") return [];
  if (!isJsonObject(node)) return [`${at} is not a schema`];
  const allowed = new Set<string>([
    ...NUMERIC_KEYWORDS,
    ...STRING_KEYWORDS,
    ...STRUCTURAL_KEYWORDS,
    ...ANNOTATION_KEYWORDS,
  ]);
  const own = Object.keys(node)
    .filter((key) => !allowed.has(key))
    .map((key) => `${at}: ${key} is outside the json domain profile`);
  const properties = node["properties"];
  const nested = [
    ...(properties !== undefined && isJsonObject(properties)
      ? Object.entries(properties).flatMap(([key, value]) =>
          jsonDomainProblems(value, `${at}.properties.${key}`),
        )
      : []),
    ...(node["items"] === undefined ? [] : jsonDomainProblems(node["items"], `${at}.items`)),
    ...(node["additionalProperties"] === undefined
      ? []
      : jsonDomainProblems(node["additionalProperties"], `${at}.additionalProperties`)),
  ];
  const pattern = node["pattern"];
  // the newest minor's dialect here: `defineTool` holds each pattern to the minor the tool declares (`patternMinorProblems`)
  const patternIssue =
    typeof pattern === "string" ? patternProblem(pattern, CONTRACT_VERSION) : undefined;
  return [
    ...own,
    ...nested,
    ...(patternIssue === undefined ? [] : [`${at}: pattern ${patternIssue}`]),
  ];
};

/** The domain of a value's profile keywords (in profile order); a pattern must be of the Annex V2 form. */
const domainOf = (keywords: JsonObject): Derived<Domain | undefined> => {
  if (Object.keys(keywords).length === 0) return { ok: true, value: undefined };
  const wrong = Object.entries(keywords).filter(([key, value]) =>
    key === "pattern" ? typeof value !== "string" : typeof value !== "number",
  );
  if (wrong.length > 0)
    return failed(`a domain keyword has the wrong type: ${JSON.stringify(keywords)}`);
  const pattern = keywords["pattern"];
  const problem =
    typeof pattern === "string" ? patternProblem(pattern, CONTRACT_VERSION) : undefined;
  return problem === undefined
    ? { ok: true, value: keywords }
    : failed(`pattern ${JSON.stringify(pattern)}: ${problem}`);
};

/** The keys a node of one valueType may carry: its type keywords, annotations and its profile. */
const unknownKeys = (node: JsonObject, allowed: ReadonlyArray<string>): ReadonlyArray<string> =>
  Object.keys(node).filter((key) => !ANNOTATION_KEYWORDS.has(key) && !allowed.includes(key));

/** One value's kind, from its flattened node. `json` is the annotated valueType; a node is never asked for `count`. */
const kindOf = (
  node: JsonObject,
  annotations: Schema.Annotations.Annotations,
): Derived<ValueKind> => {
  if (annotations.valueType === "json") {
    const { description: _, title: __, default: ___, examples: ____, ...structure } = node;
    const problems = jsonDomainProblems(structure, "domain");
    if (problems.length > 0) return failed(...problems);
    return {
      ok: true,
      value: {
        valueType: "json",
        ...(Object.keys(structure).length === 0 ? {} : { domain: structure }),
      },
    };
  }
  const values = node["enum"];
  if (values !== undefined) {
    if (
      !Array.isArray(values) ||
      !values.every((value): value is string => typeof value === "string")
    )
      return failed(`an enum argument takes strings, not ${JSON.stringify(values)}`);
    const extra = unknownKeys(node, ["type", "enum"]);
    if (extra.length > 0)
      return failed(`${extra.join(", ")} is outside the domain profile of an enum`);
    return { ok: true, value: { valueType: "enum", possibleValues: values } };
  }
  const type = node["type"];
  const valued = (
    valueType: ValueKind["valueType"],
    keywords: ReadonlyArray<string>,
    drop: (key: string, value: Json) => boolean,
  ): Derived<ValueKind> => {
    const extra = unknownKeys(node, ["type", ...keywords]);
    if (extra.length > 0)
      return failed(`${extra.join(", ")} is outside the domain profile of ${valueType}`);
    const domain = domainOf(pick(node, keywords, drop));
    return domain.ok
      ? {
          ok: true,
          value: { valueType, ...(domain.value === undefined ? {} : { domain: domain.value }) },
        }
      : domain;
  };
  if (type === "boolean") return valued("switch", [], () => false);
  // an integer is within ±(2^53-1) by its valueType (spec 9.7.5): Schema.Int's own bounds are no domain
  if (type === "integer")
    return valued(
      "integer",
      NUMERIC_KEYWORDS,
      (key, value) =>
        (key === "minimum" && value === -Number.MAX_SAFE_INTEGER) ||
        (key === "maximum" && value === Number.MAX_SAFE_INTEGER),
    );
  if (type === "number") return valued("number", NUMERIC_KEYWORDS, () => false);
  if (type === "string")
    return valued(node["format"] === "path" ? "path" : "string", STRING_KEYWORDS, () => false);
  return failed(`no valueType for the JSON Schema ${JSON.stringify(node)}`);
};

/**
 * The `pattern` keywords anywhere in a JSON Schema node: in `properties`, `items`, `additionalProperties` and every
 * definition a `$ref` reaches (each definition once).
 */
const patternCount = (node: Json, definitions: JsonObject, seen: Set<string>): number => {
  if (Array.isArray(node))
    return node.reduce<number>((sum, item) => sum + patternCount(item, definitions, seen), 0);
  if (!isJsonObject(node)) return 0;
  const reference = node["$ref"];
  const name = typeof reference === "string" ? reference.replace(/^#\/\$defs\//, "") : undefined;
  const target = name === undefined || seen.has(name) ? undefined : definitions[name];
  if (name !== undefined) seen.add(name);
  return (
    (typeof node["pattern"] === "string" ? 1 : 0) +
    (target === undefined ? 0 : patternCount(target, definitions, seen)) +
    Object.entries(node)
      // the keyword is counted above; a property named `pattern` (an object) is walked like any other
      .filter(([key, value]) => !(key === "pattern" && typeof value === "string"))
      .reduce((sum, [, value]) => sum + patternCount(value, definitions, seen), 0)
  );
};

/**
 * The representation's checks outside the profile, and whether a pattern check lost its pattern: Effect publishes a
 * pattern only with the `u` flag, so fewer `pattern` keywords than `isPattern` checks means one is missing.
 */
const checkProblems = (
  schema: Schema.Constraint,
  node: JsonObject,
  definitions: JsonObject,
): ReadonlyArray<string> => {
  const ids = checkIds(SchemaRepresentation.toRepresentation(schema.ast), []);
  const foreign = ids.filter((id) => id === undefined || !PROFILE_CHECKS.has(id));
  const patterns = ids.filter((id) => id === "effect/schema/isPattern").length;
  return [
    ...foreign.map(
      (id) =>
        `the check ${id ?? "(a predicate)"} is outside the domain profile (spec 9.7.4, Annex V1): declare it as one of the command's validators`,
    ),
    ...(patterns > patternCount(node, definitions, new Set())
      ? [
          "Schema.isPattern needs a RegExp with the u flag: JSON Schema reads patterns with it, and Effect publishes no other",
        ]
      : []),
  ];
};

/** A JSON Schema node with every `pattern` keyword written as the pattern its RegExp means (`patternOfSource`). */
const sourcePatterns = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(sourcePatterns);
  if (typeof node !== "object" || node === null) return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "pattern" && typeof value === "string"
        ? patternOfSource(value)
        : sourcePatterns(value),
    ]),
  );
};

const jsonSchemaOf = (
  schema: Schema.Constraint,
): Derived<{ readonly node: JsonObject; readonly definitions: JsonObject }> => {
  const document = Schema.toJsonSchemaDocument(schema);
  const root: unknown = sourcePatterns(document.schema);
  const definitions: unknown = sourcePatterns(document.definitions);
  if (!isJson(root) || !isJson(definitions) || !isJsonObject(definitions))
    return failed("the JSON Schema is not JSON");
  const flat = flatten(root, definitions);
  return flat.ok ? { ok: true, value: { node: flat.value, definitions } } : flat;
};

/** The typed default of an option (spec 9.7.3). */
const defaultOf = (
  annotations: Schema.Annotations.Annotations,
  valueType: ValueType,
  repeatable: boolean,
): Derived<Json> => {
  if (valueType === "switch") return { ok: true, value: false };
  const value: unknown = annotations.default;
  if (value === undefined) return { ok: true, value: valueType === "count" ? 0 : null };
  if (!isJson(value)) return failed(`the default (a ${typeof value}) is not JSON`);
  if (repeatable && valueType !== "count" && !Array.isArray(value))
    return failed(`a repeatable option's default is an array, not ${JSON.stringify(value)}`);
  return { ok: true, value };
};

/** How a field is declared to be optional with its description's default: the helper the problem names. */
const optionalBy = (option: OptionDescription): string =>
  option.valueType === "switch"
    ? "switchOption(help)"
    : option.valueType === "count"
      ? "count(help)"
      : option.default === null
        ? "Schema.optionalKey(schema)"
        : "defaulted(schema, value)";

/**
 * Whether an option described as not required decodes as its description says when it is absent (approaches/
 * typescript.md §3.4): to nothing when it has no default, else to what its default decodes to. A switch defaults to
 * false and a count to 0 only through `switchOption` and `count` (or `defaulted`).
 */
const absentProblem = (
  key: string,
  field: FieldSchema,
  option: OptionDescription,
): string | undefined => {
  if (option.required) return undefined;
  const decode = Schema.decodeUnknownResult(Schema.Struct({ [key]: field }));
  const absent = decode({});
  if (Result.isFailure(absent))
    return `it is described as optional, but the Struct refuses it absent: declare it with ${optionalBy(option)}`;
  const value = absent.success[key];
  if (option.default === null)
    return value === undefined
      ? undefined
      : `absent, it decodes to a value its description does not state: declare its default with defaulted(schema, value)`;
  const given = decode({ [key]: option.default });
  if (Result.isFailure(given))
    return `its default ${JSON.stringify(option.default)} is not one of its own values`;
  return Equal.equals(value, given.success[key])
    ? undefined
    : `absent, it does not decode to its default ${JSON.stringify(option.default)}: declare it with ${optionalBy(option)}`;
};

/** One option from one field of the input Struct. */
export const describeField = (
  key: string,
  field: FieldSchema,
  property: Json,
  keyRequired: boolean,
  definitions: JsonObject,
): Derived<OptionDescription> => {
  const where = (problems: ReadonlyArray<string>) =>
    failed(...problems.map((problem) => `--${optionName(key)}: ${problem}`));
  if (key === "operands")
    return where(["operands is not an option name: declare operands with operand(...)"]);
  const annotations = Schema.resolveAnnotations(field) ?? {};
  const hasDefault = annotations.default !== undefined;
  const flat = flatten(property, definitions);
  if (!flat.ok) return where(flat.problems);
  const node = hasDefault ? withoutDefaultNull(flat.value) : flat.value;
  const checks = checkProblems(field, node, definitions);
  if (checks.length > 0) return where(checks);
  const isArray = node["type"] === "array" && annotations.valueType !== "json";
  const elementNode = isArray
    ? flatten(node["items"] ?? {}, definitions)
    : { ok: true as const, value: node };
  if (!elementNode.ok) return where(elementNode.problems);
  const extraArrayKeys = isArray ? unknownKeys(node, ["type", "items", "minItems"]) : [];
  const minItems = isArray && typeof node["minItems"] === "number" ? node["minItems"] : 0;
  const kind =
    annotations.valueType === "count" ? kindOf(node, {}) : kindOf(elementNode.value, annotations);
  if (!kind.ok) return where(kind.problems);
  const valueType: ValueType = annotations.valueType === "count" ? "count" : kind.value.valueType;
  const repeatable = isArray || valueType === "count";
  const problems = [
    ...extraArrayKeys.map((keyword) => `${keyword} is outside the profile of a repeatable option`),
    ...(isArray && minItems > 1 ? ["a repeatable option takes minItems 1 at most (required)"] : []),
    ...(annotations.valueType === "count" && kind.value.valueType !== "integer"
      ? ["a count is an integer"]
      : []),
    ...(isArray && kind.value.valueType === "switch" ? ["a switch is not repeatable"] : []),
    ...(isArray && keyRequired && !hasDefault && minItems < 1
      ? [
          "a required repeatable option needs Schema.isMinLength(1); an optional one is Schema.optionalKey",
        ]
      : []),
    ...(annotations.description === undefined ? ["no help: annotate the field's description"] : []),
    ...(annotations.valueName === undefined && valueType !== "switch" && valueType !== "count"
      ? ["no valueName annotation"]
      : []),
    ...(annotations.valueName !== undefined && (valueType === "switch" || valueType === "count")
      ? [`a ${valueType} has no valueName`]
      : []),
    // an environment value is text (spec 10.7 step 5); a switch and a count have none to read
    ...(annotations.env !== undefined && (valueType === "switch" || valueType === "count")
      ? [`a ${valueType} reads no environment variable`]
      : []),
    // a comma list is a repeatable option of one value per piece (spec 9.7.6, Annex S2 rule 18)
    ...(annotations.commaList === true &&
    (!isArray || !COMMA_LIST_TYPES.includes(valueType))
      ? [
          `a comma list is a repeatable string, integer, number, path or enum option, not ${isArray ? "" : "a single "}${valueType}`,
        ]
      : []),
  ];
  if (problems.length > 0) return where(problems);
  const typedDefault = defaultOf(annotations, valueType, repeatable);
  if (!typedDefault.ok) return where(typedDefault.problems);
  const countDomain =
    valueType === "count" && kind.value.domain !== undefined
      ? Object.fromEntries(
          Object.entries(kind.value.domain).filter(
            ([keyword, value]) => !(keyword === "minimum" && value === 0),
          ),
        )
      : kind.value.domain;
  const domain: Domain | undefined =
    annotations.domainDescription === undefined
      ? countDomain !== undefined && Object.keys(countDomain).length > 0
        ? countDomain
        : undefined
      : { ...countDomain, description: annotations.domainDescription };
  const described: OptionDescription = {
    name: optionName(key),
    ...(annotations.valueName === undefined ? {} : { valueName: annotations.valueName }),
    valueType,
    ...(kind.value.possibleValues === undefined
      ? {}
      : { possibleValues: kind.value.possibleValues }),
    required: keyRequired && !hasDefault && valueType !== "switch" && valueType !== "count",
    repeatable,
    default: typedDefault.value,
    ...(annotations.defaultNote === undefined ? {} : { defaultNote: annotations.defaultNote }),
    ...(domain === undefined ? {} : { domain }),
    ...(annotations.env === undefined ? {} : { env: annotations.env }),
    ...(annotations.commaList === true ? { commaList: true as const } : {}),
    flagOnly: annotations.flagOnly === true,
    ...(annotations.short === undefined ? {} : { short: annotations.short }),
    help: annotations.description ?? "",
  };
  const absent = absentProblem(key, field, described);
  return absent === undefined ? { ok: true, value: described } : where([absent]);
};

/** Every option of an input Struct, in field order. */
export const describeInput = (
  input: Schema.Constraint & { readonly fields: InputFields },
): Derived<ReadonlyArray<OptionDescription>> => {
  const generated = jsonSchemaOf(input);
  if (!generated.ok) return generated;
  const { node, definitions } = generated.value;
  const properties = node["properties"];
  const required = node["required"];
  const requiredKeys = Array.isArray(required) ? required : [];
  const options: Array<OptionDescription> = [];
  const problems: Array<string> = [];
  for (const [key, field] of Object.entries(input.fields)) {
    const property =
      properties !== undefined && isJsonObject(properties) ? properties[key] : undefined;
    const described =
      property === undefined
        ? failed(`--${optionName(key)}: the JSON Schema has no property ${key}`)
        : describeField(key, field, property, requiredKeys.includes(key), definitions);
    if (described.ok) options.push(described.value);
    else problems.push(...described.problems);
  }
  return problems.length > 0 ? failed(...problems) : { ok: true, value: options };
};

/** One operand (spec 9.6). */
export const describeOperand = (declared: AnyOperand): Derived<OperandDescription> => {
  const where = (problems: ReadonlyArray<string>) =>
    failed(...problems.map((problem) => `<${declared.name}>: ${problem}`));
  const generated = jsonSchemaOf(declared.schema);
  if (!generated.ok) return where(generated.problems);
  const checks = checkProblems(declared.schema, generated.value.node, generated.value.definitions);
  if (checks.length > 0) return where(checks);
  const annotations = Schema.resolveAnnotations(declared.schema) ?? {};
  const kind = kindOf(generated.value.node, annotations);
  if (!kind.ok) return where(kind.problems);
  const valueType = kind.value.valueType;
  if (valueType === "switch") return where(["an operand is never a switch"]);
  const domain: Domain | undefined =
    annotations.domainDescription === undefined
      ? kind.value.domain
      : { ...kind.value.domain, description: annotations.domainDescription };
  return {
    ok: true,
    value: {
      name: declared.name,
      valueName: declared.valueName,
      valueType,
      ...(kind.value.possibleValues === undefined
        ? {}
        : { possibleValues: kind.value.possibleValues }),
      required: declared.required,
      variadic: declared.variadic,
      default: null,
      ...(declared.defaultNote === undefined ? {} : { defaultNote: declared.defaultNote }),
      ...(domain === undefined ? {} : { domain }),
      help: declared.help,
    },
  };
};
