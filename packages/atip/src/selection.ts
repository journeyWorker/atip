/**
 * The field selection of a report (spec 6.10, 9.9.1): the declaration says where the records are (`records`, an RFC
 * 6901 pointer into `data`), which paths are always kept and the selection without `--fields`; the selectable paths
 * are read from the report's JSON Schema (`Schema.toJsonSchemaDocument`), so they cannot drift from what it prints.
 *
 * A path names a member of a record in its one spelling (fields.ts): `[]` steps into the elements of an array of
 * records (`members[].title`); a map (an object schema without properties) is selectable as a whole, and its keys are
 * selectable through it (Annex F3). Paths go {@link MAX_DEPTH} members deep; a deeper value is selected
 * whole through its parent.
 *
 * {@link checkSelection} reads a `--fields` value against a command's described outputs: the runner's part of step 6
 * (spec 10.7), stateless, so an unknown path is refused before any precondition.
 */
import { Result, Schema } from "effect";
import type { Derived } from "./derive.ts";
import type { CommandDescription, FieldsDescription, OutputSchema } from "./description.ts";
import {
  type FieldStep,
  formatFieldPath,
  formatFieldStep,
  parseFieldPath,
  splitFieldList,
} from "./fields.ts";
import { isJson, isJsonObject, type Json, type JsonObject } from "./json.ts";

/** What a report declares of its field selection (spec 6.10); its paths are derived. */
export interface FieldsDeclaration {
  /**
   * The RFC 6901 pointer of the records in `data`, through object members: `""` (absent) is `data` itself, `/runs` its
   * member `runs` (an array: each element is a record).
   */
  readonly records?: string;
  /** Paths always kept (a record's key, its url): not selectable themselves. */
  readonly keep?: ReadonlyArray<string>;
  /** The selection without `--fields` (absent: every path). A kept path may be listed: it is kept anyway. */
  readonly default?: ReadonlyArray<string>;
}

/** How many members deep paths go. */
const MAX_DEPTH = 6;

/** A node's variants: its `$ref` resolved, its `anyOf`/`oneOf` branches flattened, `null` left out. */
const variants = (
  node: Json,
  definitions: JsonObject,
  chain: ReadonlyArray<string> = [],
): ReadonlyArray<JsonObject> => {
  if (!isJsonObject(node)) return [];
  const reference = node["$ref"];
  if (typeof reference === "string") {
    const name = reference.replace(/^#\/\$defs\//, "");
    const target = definitions[name];
    // a definition that is only a reference to itself names nothing
    return target === undefined || chain.includes(name)
      ? []
      : variants(target, definitions, [...chain, name]);
  }
  const branches = node["anyOf"] ?? node["oneOf"];
  if (Array.isArray(branches))
    return branches.flatMap((branch) => variants(branch, definitions, chain));
  return node["type"] === "null" ? [] : [node];
};

const isRecordNode = (node: JsonObject): boolean =>
  isJsonObject(node["properties"] ?? null) || node["type"] === "object";

/** Every path under `node` (a record or a member of one), in schema order, each once. */
const walk = (
  node: Json,
  definitions: JsonObject,
  prefix: string,
  depth: number,
  out: Array<string>,
): void => {
  for (const variant of variants(node, definitions)) {
    const items = variant["items"];
    if (variant["type"] === "array" && items !== undefined) {
      if (prefix !== "" && variants(items, definitions).some(isRecordNode))
        walk(items, definitions, `${prefix}[]`, depth, out);
      continue;
    }
    const properties = variant["properties"];
    if (properties === undefined || !isJsonObject(properties) || depth >= MAX_DEPTH) continue;
    for (const [name, child] of Object.entries(properties)) {
      const path = `${prefix}${formatFieldStep({ name, list: false }, prefix === "")}`;
      if (!out.includes(path)) out.push(path);
      walk(child, definitions, path, depth + 1, out);
    }
  }
};

/** The record schema `records` points to (each element of an array there), or why it points to none. */
const recordsNode = (
  root: Json,
  definitions: JsonObject,
  records: string,
): Result.Result<Json, string> => {
  if (records === "") return Result.succeed(root);
  if (!records.startsWith("/") || /~[^01]|~$/.test(records))
    return Result.fail(`records ${records} is not an RFC 6901 pointer`);
  let node = root;
  for (const segment of records.slice(1).split("/")) {
    const name = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    const holder = variants(node, definitions).find((variant) => {
      const properties = variant["properties"];
      return properties !== undefined && isJsonObject(properties) && name in properties;
    });
    const properties = holder?.["properties"];
    const member =
      properties !== undefined && isJsonObject(properties) ? properties[name] : undefined;
    if (member === undefined)
      return Result.fail(`records ${records}: the report has no member ${name} there`);
    node = member;
  }
  const array = variants(node, definitions).find(
    (variant) => variant["type"] === "array" && variant["items"] !== undefined,
  );
  return Result.succeed(array?.["items"] ?? node);
};

/** The selectable paths of a report (spec 9.9.1 `fields`), or why its declaration names a path it does not have. */
export const describeFields = (
  schema: Schema.Top,
  declared: FieldsDeclaration,
): Derived<FieldsDescription> => {
  const document = Schema.toJsonSchemaDocument(schema);
  const root: unknown = document.schema;
  const definitions: unknown = document.definitions;
  if (!isJson(root) || !isJson(definitions) || !isJsonObject(definitions))
    return { ok: false, problems: ["the report's JSON Schema is not JSON"] };
  const records = declared.records ?? "";
  const node = recordsNode(root, definitions, records);
  if (Result.isFailure(node)) return { ok: false, problems: [node.failure] };
  const every: Array<string> = [];
  walk(node.success, definitions, "", 0, every);
  const keep = declared.keep ?? [];
  const paths = every.filter((path) => !keep.includes(path));
  const problems = [
    ...(every.length === 0 ? ["the records have no member to select"] : []),
    ...keep
      .filter((path) => !every.includes(path))
      .map((path) => `keep names ${path}, which is no path of the records`),
    ...(declared.default ?? [])
      .filter((path) => !every.includes(path))
      .map((path) => `default names ${path}, which is no path of the records`),
  ];
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      records,
      paths,
      ...(keep.length === 0 ? {} : { keep }),
      ...(declared.default === undefined
        ? {}
        : { default: declared.default.filter((path) => paths.includes(path)) }),
    },
  };
};

// ---------------------------------------------------------------------------------------------------- --fields

/**
 * A `--fields` value the command's outputs cannot select (spec 6.10, 10.7 step 6): `USAGE` on `--fields`. `unknown`
 * are the paths that name nothing (empty when the value is no list of field paths at all), `expected` every selectable
 * path.
 */
export class SelectionError extends Schema.TaggedError<SelectionError>()("SelectionError", {
  message: Schema.String,
  received: Schema.String,
  unknown: Schema.Array(Schema.String),
  expected: Schema.Array(Schema.String),
}) {}

/** The root and the definitions of an output's JSON Schema. */
const jsonSchemaOf = (
  schema: OutputSchema,
): { readonly root: Json; readonly definitions: JsonObject } | undefined => {
  if ("json" in schema) {
    const definitions = isJsonObject(schema.json) ? schema.json["$defs"] : undefined;
    return {
      root: schema.json,
      definitions: definitions !== undefined && isJsonObject(definitions) ? definitions : {},
    };
  }
  const document = Schema.toJsonSchemaDocument(schema.effect);
  const root: unknown = document.schema;
  const definitions: unknown = document.definitions;
  return isJson(root) && isJson(definitions) && isJsonObject(definitions)
    ? { root, definitions }
    : undefined;
};

/** The schema a path's steps reach from `node` (a record), through object members and `[]` into array elements. */
const nodeAt = (
  node: Json,
  definitions: JsonObject,
  steps: ReadonlyArray<FieldStep>,
): Json | undefined => {
  let current: Json = node;
  for (const step of steps) {
    const holder = variants(current, definitions).find((variant) => {
      const properties = variant["properties"];
      return properties !== undefined && isJsonObject(properties) && step.name in properties;
    });
    const properties = holder?.["properties"];
    const member =
      properties !== undefined && isJsonObject(properties) ? properties[step.name] : undefined;
    if (member === undefined) return undefined;
    current = member;
    if (step.list) {
      const items = variants(current, definitions).find(
        (variant) => variant["type"] === "array" && variant["items"] !== undefined,
      )?.["items"];
      if (items === undefined) return undefined;
      current = items;
    }
  }
  return current;
};

/** A map (Annex F3): an object schema without properties whose other members are allowed. */
const isMapNode = (node: Json, definitions: JsonObject): boolean =>
  variants(node, definitions).some((variant) => {
    const properties = variant["properties"];
    return (
      variant["type"] === "object" &&
      (properties === undefined ||
        (isJsonObject(properties) && Object.keys(properties).length === 0)) &&
      variant["additionalProperties"] !== false
    );
  });

/** Whether one output selects `steps`: a declared or kept path, or one key of a declared map. */
const selects = (
  output: { readonly schema: OutputSchema; readonly fields: FieldsDescription },
  steps: ReadonlyArray<FieldStep>,
): boolean => {
  const declared = [...output.fields.paths, ...(output.fields.keep ?? [])];
  if (declared.includes(formatFieldPath(steps))) return true;
  const base = steps.slice(0, -1);
  const last = steps.at(-1);
  if (last === undefined || last.list || base.length === 0) return false;
  if (!declared.includes(formatFieldPath(base))) return false;
  const document = jsonSchemaOf(output.schema);
  if (document === undefined) return false;
  const records = recordsNode(document.root, document.definitions, output.fields.records);
  if (Result.isFailure(records)) return false;
  const map = nodeAt(records.success, document.definitions, base);
  return map !== undefined && isMapNode(map, document.definitions);
};

/**
 * The invocation's `--fields` (`options.fields`) read against the outputs of `command` that declare `fields` (spec
 * 6.10): every path one of them selects, or a {@link SelectionError}. A command without `fields`, or an invocation
 * without `--fields`, has nothing to check; `--full` and `--max-bytes` are checked by the parser (their relation and
 * domain).
 */
export const checkSelection = (
  command: CommandDescription,
  options: Readonly<Record<string, unknown>>,
): Result.Result<void, SelectionError> => {
  const text = options["fields"];
  const outputs = command.outputs.flatMap((output) =>
    output.fields === undefined ? [] : [{ schema: output.schema, fields: output.fields }],
  );
  if (typeof text !== "string" || outputs.length === 0) return Result.void;
  const expected = [...new Set(outputs.flatMap((output) => output.fields.paths))];
  const refused = (message: string, unknown: ReadonlyArray<string>) =>
    Result.fail(new SelectionError({ message, received: text, unknown, expected }));
  const listed = splitFieldList(text);
  if (listed === undefined) return refused(`--fields: ${text}: a bracketed key is not closed`, []);
  const unknown: Array<string> = [];
  for (const path of listed) {
    const steps = parseFieldPath(path);
    if (Result.isFailure(steps)) return refused(`--fields: ${steps.failure}`, []);
    if (!outputs.some((output) => selects(output, steps.success))) unknown.push(path);
  }
  return unknown.length === 0
    ? Result.void
    : refused(
        `--fields: ${unknown.join(", ")} ${unknown.length === 1 ? "is not a path" : "are not paths"} of this answer`,
        unknown,
      );
};
