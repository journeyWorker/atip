/**
 * Checks of a tool's error registry against its commands, beyond the rows themselves (`reservedRegistryProblems` and
 * `codeNameProblems` in envelope.ts): the finer replacements of `USAGE` it declares, and every code a command lists
 * registered. `defineTool` refuses a tool with any; a tool that keeps its own command records runs them on its
 * descriptions and registry. Each returns one sentence per problem.
 */
import type { CommandDescription } from "./description.ts";
import type { RegistryEntry } from "./envelope.ts";

/** How a registry `meaning` says a code replaces `USAGE` (spec 7.3.2). */
const REPLACES_USAGE = /\b(replaces?|instead of|in place of) `?USAGE\b/i;

/**
 * The tool's declared finer replacements of `USAGE` (spec 7.3.2) that a 1.4 document may not imply, since a reader
 * could not tell them from the tool's other codes: each is registered with exit 2 and is named `<SUBJECT>_INVALID` or
 * `<SUBJECT>_REQUIRED` (7.3.2's naming, what atip's `check.ts` takes as a replacement) or says in its `meaning` that
 * it is used in place of `USAGE`.
 */
export const usageReplacementProblems = (
  replacements: ReadonlyArray<string>,
  registry: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<string> =>
  replacements.flatMap((code) => {
    const entry = registry.find((row) => row.code === code);
    if (entry === undefined) return [`the usage replacement ${code} is not registered`];
    if (entry.exit !== 2)
      return [`the usage replacement ${code} is registered with exit ${entry.exit}, not 2`];
    return /_(INVALID|REQUIRED)$/.test(code) || REPLACES_USAGE.test(entry.meaning)
      ? []
      : [
          `the usage replacement ${code} is named neither *_INVALID nor *_REQUIRED and its meaning does not say it is used in place of USAGE (spec 7.3.2)`,
        ];
  });

/**
 * Every code a command lists in its `errors` (its declared codes, the contract's and the tool's generic ones) is in the
 * registry (spec 7.4.1): a code the package adds for a reserved option (`CURSOR_INVALID` with `--cursor`, the commit
 * pair's code) needs the tool's registry row like any other.
 */
export const unregisteredCodeProblems = (
  commands: ReadonlyArray<CommandDescription>,
  genericErrors: ReadonlyArray<string>,
  registry: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<string> => {
  const registered = new Set(registry.map((row) => row.code));
  const missing = new Map<string, Array<string>>();
  const note = (code: string, where: string) => {
    if (registered.has(code)) return;
    const known = missing.get(code);
    if (known === undefined) missing.set(code, [where]);
    else known.push(where);
  };
  for (const code of genericErrors) note(code, "the tool's generic errors");
  for (const command of commands)
    for (const code of command.errors) note(code, command.path.join(" "));
  return [...missing].map(
    ([code, where]) =>
      `${code} is listed by ${where.join(", ")} but not registered: add its defineError to the tool's errors (spec 7.4.1)`,
  );
};
