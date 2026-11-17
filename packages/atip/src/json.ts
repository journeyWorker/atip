/**
 * JSON values as the contract's documents hold them, and the JSON Schemas of Effect Schemas as a command document
 * holds them (spec 9.9.1, 9.9.3): every schema lives in the document's `schemas` and refers to the others as
 * `#/schemas/<Name>`. Effect writes its definitions under `#/$defs/<Name>`; `schemasOf` moves them and rewrites the
 * references.
 */
import { Schema } from "effect";

/** A JSON value. */
export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** A JSON object. */
export type JsonObject = { readonly [key: string]: Json };

export const isJsonObject = (value: Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a value is JSON (no `undefined`, function, bigint or non-finite number anywhere in it). */
export const isJson: (value: unknown) => value is Json = Schema.is(Schema.Json);

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

/** A JSON text as its value; none when the text is no JSON. */
export const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

/**
 * A JSON Schema with `#/$defs/X` references rewritten to `#/schemas/X`, and Effect's `$schema` marker dropped. A map of
 * unknown values (`Schema.Record(Schema.String, Schema.Unknown)`), which Effect writes as a bare `{"type": "object"}`,
 * says `additionalProperties: true`: Annex F3 makes a map's keys selectable only when `additionalProperties` is a
 * schema, `true` included, and a bare object would leave a published map-key path unselectable.
 */
const rewrite = (node: Json): Json => {
  if (Array.isArray(node)) return node.map(rewrite);
  if (!isJsonObject(node)) return node;
  if (
    node["type"] === "object" &&
    node["properties"] === undefined &&
    node["patternProperties"] === undefined &&
    node["additionalProperties"] === undefined
  )
    return rewrite({ ...node, additionalProperties: true });
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "$schema")
      .map(([key, value]) =>
        key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")
          ? [key, `#/schemas/${value.slice("#/$defs/".length)}`]
          : [key, rewrite(value)],
      ),
  );
};

/** How a report's JSON Schema treats members its Effect Schema does not model (`toJsonSchemaDocument`'s option). */
export type ExcessProperty = "ignore" | "error";

/**
 * The schemas a command document needs for one Effect Schema named `name`: the root under `name` and every definition
 * it references under its own name. A root that is only a reference to a definition of the same name is that
 * definition.
 */
export const schemasOf = (
  name: string,
  schema: Schema.Top,
  onExcessProperty: ExcessProperty = "error",
): Readonly<Record<string, Json>> => {
  const generated = Schema.toJsonSchemaDocument(schema, { onExcessProperty });
  const root = rewrite(decodeJson(generated.schema));
  const definitions = decodeJson(generated.definitions);
  const moved: Record<string, Json> = isJsonObject(definitions)
    ? Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, rewrite(value)]))
    : {};
  const selfReference =
    isJsonObject(root) && root["$ref"] === `#/schemas/${name}` && Object.keys(root).length === 1;
  return selfReference ? moved : { ...moved, [name]: root };
};
