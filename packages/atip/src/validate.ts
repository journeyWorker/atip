/**
 * `@journeykit/atip/validate`: validation against the atip/1 JSON Schemas the package ships (`schema/`, a byte-for-byte
 * copy of the specification's `schema/` at v1.6.1), for a tool's test suite: every envelope, every `schema` answer, every
 * error and warning registry row, every guide, every batch report. Not for a tool's runtime: it loads Ajv, an optional
 * peer dependency a tool installs as a dev dependency.
 */
import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

/** One schema of the package's `schema/` directory, read once when this module loads. */
const schemaFile = (name: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`../schema/${name}.schema.json`, import.meta.url), "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`schema/${name}.schema.json is not a JSON Schema object`);
  return Object.fromEntries(Object.entries(parsed));
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schemaFile("error"));
ajv.addSchema(schemaFile("input-document"));
const envelope = ajv.compile(schemaFile("envelope"));
const registryEntry = ajv.compile(schemaFile("registry-entry"));
const warningEntry = ajv.compile(schemaFile("warning-entry"));
const guide = ajv.compile(schemaFile("guide"));
const schemaDoc = ajv.compile(schemaFile("schema-doc"));
const batchReport = ajv.compile(schemaFile("batch-report"));

const problems = (validate: ValidateFunction, value: unknown): ReadonlyArray<string> =>
  validate(value)
    ? []
    : (validate.errors ?? []).map(
        (error: ErrorObject) =>
          `${error.instancePath || "/"} ${error.message ?? error.keyword} ${JSON.stringify(error.params)}`,
      );

/** Why a printed document is not an atip/1 envelope (empty: it is one). */
export const envelopeProblems = (document: unknown): ReadonlyArray<string> =>
  problems(envelope, document);

/** Why a registry row is not an atip/1 error registry entry (empty: it is one). */
export const registryEntryProblems = (row: unknown): ReadonlyArray<string> =>
  problems(registryEntry, row);

/** Why a row is not an atip/1 warning registry entry (empty: it is one). */
export const warningEntryProblems = (row: unknown): ReadonlyArray<string> =>
  problems(warningEntry, row);

/** Why a `skills show --json` answer's `data` is not an atip/1 guide (empty: it is one; spec 14). */
export const guideProblems = (data: unknown): ReadonlyArray<string> => problems(guide, data);

/** Why a printed `schema` answer (its whole envelope) is not an atip/1 self-description (empty: it is one; spec 9). */
export const schemaAnswerProblems = (document: unknown): ReadonlyArray<string> =>
  problems(schemaDoc, document);

/** Why a batch output's `data` is not an atip/1 batch report (empty: it is one; spec 10.11). */
export const batchReportProblems = (data: unknown): ReadonlyArray<string> =>
  problems(batchReport, data);
