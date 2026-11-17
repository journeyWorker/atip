// The built package as a user loads it: `node smoke.mjs` and `bun smoke.mjs` after `bun run build` (CI runs both).
// It defines the README's `acme` tool from dist/ through the package's own name and checks what it answers.
import { strict as assert } from "node:assert";
import { Effect, Schema } from "effect";
import { defineCommand, defineError, defineTool, operand, report, switchOption } from "@journeykit/atip";
import { schemaAnswerProblems } from "@journeykit/atip/validate";

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
const MemberNotFound = defineError({
  code: "MEMBER_NOT_FOUND",
  meaning: "No member has this number",
  fix: "List the members: acme member list --json",
});

const Member = Schema.Struct({ number: Schema.Int, name: Schema.String });

const memberShow = defineCommand(
  {
    path: ["member", "show"],
    summary: "Show one member",
    effect: { kind: "read" },
    operands: [operand("number", Schema.Int, { valueName: "NUMBER", help: "The member's number" })],
    input: Schema.Struct({ withTags: switchOption("Include the member's tags") }),
    outputs: [report("Member", "1.0", Member)],
    errors: [MemberNotFound],
    examples: ["acme member show 7 --json"],
  },
  (args) =>
    args.operands[0] === 7
      ? Effect.succeed({ number: 7, name: "Ada" })
      : MemberNotFound.fail({ message: `no member ${args.operands[0]}` }),
);

const acme = defineTool({
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

const document = acme.document(memberShow);
assert.deepEqual(
  document.options,
  [{ name: "with-tags", valueType: "switch", help: "Include the member's tags" }],
  "--json is implied, never listed (spec 9.5)",
);
assert.deepEqual(document.errors, ["MEMBER_NOT_FOUND"]);
const meta = {
  schemaVersion: "1.6",
  tool: "acme",
  toolVersion: "1.0.0",
  command: "schema",
  contract: "atip/1",
  contractVersion: "1.6",
};
assert.deepEqual(schemaAnswerProblems({ ok: true, data: document, meta }), []);
assert.deepEqual(schemaAnswerProblems({ ok: true, data: acme.tree(), meta }), []);
const refused = await Effect.runPromise(
  Effect.flip(memberShow.handler({ operands: [8], withTags: false })),
);
assert.equal(refused.code, "MEMBER_NOT_FOUND");
console.log(`smoke: ${typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`} ok`);
