# @journeykit/atip

The [atip/1](https://github.com/journeyWorker/atip) contract for TypeScript command-line tools built on Effect 4. You
declare each command once, with an Effect Schema `Struct` as its input. The package derives the argv parser, the
`--input` decoder, the `schema` documents, the error registry and the envelope from that declaration. It supports
the contract's minors 1.1 to 1.6 and follows spec v1.6.1.

**Status: 0.1.0.** This is the first release, so the API can still change in 0.x minors.

## Install

```sh
bun add @journeykit/atip effect
bun add -d ajv   # only for @journeykit/atip/validate, in your tests
```

`effect` (^4.1.1) is a peer dependency. Your tool and this package must share one copy of Effect, because the
package's `Context` services and Schema classes are only recognised by that copy. `ajv` is an optional peer that only
`@journeykit/atip/validate` loads. The package ships ESM JavaScript with `.d.ts` files and runs on Node 22 or later and
on Bun.

## A tool in one file

```ts
import { Effect, Schema } from "effect";
import { defineCommand, defineError, defineTool, operand, report, switchOption } from "@journeykit/atip";

const Usage = defineError({
  code: "USAGE",
  exit: 2,
  retryable: false,
  meaning: "The command line is not one acme reads",
  fix: "Run acme schema --json",
});
const Internal = defineError({
  code: "INTERNAL",
  exit: 1,
  retryable: false,
  meaning: "A bug in acme",
  fix: "Report it with the command line",
});
// <SUBJECT>_<CONDITION>: NOT_FOUND gives exit 2, not retryable (spec 7.2)
const MemberNotFound = defineError({
  code: "MEMBER_NOT_FOUND",
  meaning: "No member has this number",
  fix: "List the members: acme member list --json",
});

const memberShow = defineCommand(
  {
    path: ["member", "show"],
    summary: "Show one member",
    effect: { kind: "read" },
    operands: [operand("number", Schema.Int, { valueName: "NUMBER", help: "The member's number" })],
    input: Schema.Struct({ withTags: switchOption("Include the member's tags") }),
    outputs: [report("Member", "1.0", Schema.Struct({ number: Schema.Int, name: Schema.String }))],
    errors: [MemberNotFound],
    examples: ["acme member show 7 --json"],
  },
  // args: { operands: readonly [number]; withTags: boolean }; failing with an undeclared error does not compile
  (args) =>
    args.operands[0] === 7
      ? Effect.succeed({ number: 7, name: "Ada" })
      : MemberNotFound.fail({ message: `no member ${args.operands[0]}` }),
);

export const acme = defineTool({
  name: "acme",
  version: "1.0.0",
  level: "L1",
  groups: [{ name: "member", summary: "Members of the roster" }],
  commands: [memberShow],
  errors: [Usage, Internal],
  warnings: [],
  guides: { list: [{ name: "acme", text: () => "# acme" }], default: "acme" },
  profile: { genericErrors: ["USAGE", "INTERNAL"] },
});

acme.tree(); // the `schema --json` tree
acme.document(memberShow); // `schema member show --json`: its options, errors, outputs and examples
acme.errors; // the error registry
```

`packages/atip/smoke.mjs` runs this example against the built package on Node and on Bun.

## What the package gives

- **Declarations.** `defineCommand` takes the input `Struct`, `operand`, `switchOption`, `count`, `json`, `defaulted`
  and `Path` for arguments. It takes `requires`, `forbids`, `atLeastOne`, `exactlyOne` and `atMostOne` for
  constraints, plus validators, outputs (`report`, `artifact`) and an optional `batch`. A destructive command's
  handler is `{ plan, commit }`.
- **Errors and warnings.** `defineError` derives the exit and the retryability from the code's condition and types
  the reasons. `defineWarning` defines a warning code.
- **The tool.** `defineTool` builds the tree, the group and command documents, the `--schemas` answer, the error and
  warning registries and the parser. Every check of spec 9 and Annex S2 runs when the tool is defined: pattern
  dialect, comma lists, path shape, one meaning per option name, code names, and every listed code registered.
- **The contract's options and codes.** You don't declare these yourself (`ContractRules`). `--json` goes on every
  command, `--input` on writes, and `--fields` where an output declares `fields`. A destructive command gets
  `--commit` and `--plan-digest`, which require each other, and `PLAN_STALE`. A paged command gets `CURSOR_INVALID`,
  and a batch command gets `BATCH_INCOMPLETE`. `profile.contract` rewords the help texts, chooses which commands take
  `--input`, and names finer codes (`commitPairCode`, `fieldsCode`).
- **The runner.** `runCommandLine` runs one command line through the steps of spec 10.7: parse, `--help` and
  `--version`, `--input` (one document or a batch, spec 10.11), validators, preconditions, the handler. Your hooks
  decide how `--input` is read and how each result is printed. `batchReport` builds a batch report and its
  `BATCH_INCOMPLETE` error.
- **Building blocks for a tool that keeps its own command records.** `parseCommandLine`, `inputArgv` and
  `mergeInput`, the document writers, and `checkSelection`. Also cursors (`pagingOf`, `bindCursor`, `unbindCursor`),
  plan digests (`planDigest`, `commitArgv`, `runDestructive`), field paths, next steps, envelope Schemas, and the
  rule checks `defineTool` runs (`patternMinorProblems`, `commaListProblems`, `pathShapeProblems`,
  `optionMeaningProblems`, `unregisteredCodeProblems`, `usageReplacementProblems`, `codeNameProblems`,
  `reservedRegistryProblems`).
- **`@journeykit/atip/validate`.** Ajv validators that check an envelope, a `schema` answer, a registry row, a guide
  and a batch report against the contract's JSON Schemas, which ship in `schema/`.

The design is described in
[approaches/typescript.md](https://github.com/journeyWorker/atip/blob/main/approaches/typescript.md) §3.

## Versions

Releases are tagged `atip-ts-vX.Y.Z`. They are versioned separately from the spec and from the Rust crates.
`CONTRACT_VERSION` is the newest contract minor the release supports (`1.6`).

## License

MIT
