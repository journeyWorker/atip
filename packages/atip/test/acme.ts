/**
 * `acme`, a minimal example tool on `@journeykit/atip`'s command library: a team roster with one read (`member show`),
 * one write with constraints and a validator (`member tag`), and one destructive command (`member purge`). It shows
 * what a tool writes: its errors, its commands with their handlers, the ports its handlers use (`RosterReader` to read
 * and `Roster` to change; a destructive command's `plan` gets the reader only), its profile for the `schema`
 * documents, and the tool itself (`defineTool`): the built-ins `schema` and `skills show` in its wording, its
 * tool-level errors, warnings and guides. Everything else is derived, the contract's `--json`, `--input`, `--commit`
 * and `--plan-digest` with their relation and codes included.
 */
import { Context, Effect, Layer, Ref, Schema } from "effect";
import {
  artifact,
  atMostOne,
  CONTRACT_VERSION,
  defaulted,
  defineCommand,
  defineError,
  defineTool,
  defineWarning,
  operand,
  type PlanEffect,
  report,
  requires,
  schemaDeclaration,
  schemaHandler,
  skillsDeclaration,
  skillsHandler,
  switchOption,
  toolProfile,
} from "../src/index.ts";

// ---------------------------------------------------------------------------------------------------- errors

// acme declares 1.3 (`CONTRACT_VERSION`): a code is `<SUBJECT>_<CONDITION>`, and its condition gives the exit and the
// retryability (spec 7.2.2), so a definition leaves them out. The core codes that end in no condition (`USAGE`,
// `UNKNOWN_COMMAND`, `INTERNAL`) give their row, spec 7.3.1's.

export const MemberNotFound = defineError({
  code: "MEMBER_NOT_FOUND",
  meaning: "No member has this number",
  fix: "List the members: acme member list --json",
});

export const NoteRequired = defineError({
  code: "NOTE_REQUIRED",
  meaning: "A tag with an expiry needs a note saying why it expires",
  fix: "Add --note with the reason",
});

export const DateInvalid = defineError({
  code: "DATE_INVALID",
  meaning: "The date is not a day of the calendar",
  fix: "Give a real day as YYYY-MM-DD",
  reasons: {
    NO_SUCH_DAY: { meaning: "The month has no such day", fix: "Check the month's length" },
  },
});

export const RosterUnavailable = defineError({
  code: "ROSTER_UNAVAILABLE",
  meaning: "The roster cannot be read",
  fix: "Retry later",
});

/**
 * acme's stop part-way (spec 8.3.2): a command that works in steps met, after a step made effects, what it refuses
 * before its work. One `<SUBJECT>_INCOMPLETE` per subject; its `reason` is the refused code alone, an exit-2 code of the
 * registry, and `meta.next` leads with the command that reads what was done. A tool that declares 1.2 has the core
 * `STOPPED_MIDWAY` instead.
 */
export const MemberIncomplete = defineError({
  code: "MEMBER_INCOMPLETE",
  meaning: "The command stopped after a step made effects; error.reason names the refusal",
  fix: "Read what was done first (acme member show <NUMBER> --json), then act on the reason's fix",
  reasons: {
    MEMBER_NOT_FOUND: {
      meaning: "A later step found no member",
      fix: "Read what was done first, then list the members: acme member list --json",
    },
    PLAN_STALE: {
      meaning: "A commit detected, after it made some of the effects, that the plan changed",
      fix: "Read what was done first, then preview again and commit the new digest",
    },
  },
});

export const TagRepeated = defineWarning({
  code: "TAG_REPEATED",
  meaning: "The member already had this tag",
  fix: "Nothing to redo",
});

/** acme's generic codes, which every command can return. */
export const GENERIC_ERRORS = [
  "USAGE",
  "INPUT_INVALID",
  "INPUT_CONFLICT",
  "INPUT_TOO_LARGE",
  "INTERNAL",
] as const;

// ---------------------------------------------------------------------------------------------------- the port

export interface Member {
  readonly number: number;
  readonly name: string;
  readonly tags: ReadonlyArray<string>;
}

/** Reading the roster: all a destructive command's `plan` may use, so its preview cannot make an effect. */
export interface RosterReaderShape {
  readonly find: (number: number) => Effect.Effect<Member | undefined>;
}

/** Changing the roster: a write's handler and a destructive command's `commit` use it. */
export interface RosterShape {
  readonly put: (member: Member) => Effect.Effect<void>;
  readonly remove: (number: number) => Effect.Effect<void>;
}

/** The roster as the handlers read it. */
export class RosterReader extends Context.Service<RosterReader, RosterReaderShape>()(
  "@journeykit/atip/test/acme/RosterReader",
) {}

/** The roster as the handlers change it. */
export class Roster extends Context.Service<Roster, RosterShape>()("@journeykit/atip/test/acme/Roster") {}

/** A roster in memory, holding `members`: both ports over one state. */
export const rosterOf = (members: ReadonlyArray<Member>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = yield* Ref.make(new Map(members.map((member) => [member.number, member])));
      const reader: RosterReaderShape = {
        find: (number) => Effect.map(Ref.get(state), (all) => all.get(number)),
      };
      const writer: RosterShape = {
        put: (member) => Ref.update(state, (all) => new Map(all).set(member.number, member)),
        remove: (number) =>
          Ref.update(state, (all) => {
            const next = new Map(all);
            next.delete(number);
            return next;
          }),
      };
      return Context.make(RosterReader, reader).pipe(Context.add(Roster, writer));
    }),
  );

const found = Effect.fn("Acme.found")(function* (number: number) {
  const roster = yield* RosterReader;
  const member = yield* roster.find(number);
  if (member === undefined)
    return yield* MemberNotFound.fail({
      message: `no member ${number}`,
      field: "<number>",
      received: String(number),
    });
  return member;
});

// ---------------------------------------------------------------------------------------------------- commands

const MemberNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Tag = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u));
const Day = Schema.String.check(
  Schema.isPattern(new RegExp(String.raw`^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.+Z\-]+)?$`, "u")),
);

export const MemberView = Schema.Struct({
  number: Schema.Int,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
}).annotate({ description: "One member" });

export const MemberTagged = Schema.Struct({
  number: Schema.Int,
  tags: Schema.Array(Schema.String),
  unchanged: Schema.Boolean,
});

/** A purge's report; the preview members (`planDigest`, `committed`) are the runner's (`runDestructive`). */
export const MemberPurged = Schema.Struct({
  number: Schema.Int,
  effects: Schema.Array(Schema.Struct({ action: Schema.String, target: Schema.String })),
});

export const memberShow = defineCommand(
  {
    path: ["member", "show"],
    summary: "Show one member",
    effect: { kind: "read" },
    operands: [
      operand("number", MemberNumber, { valueName: "NUMBER", help: "The member's number" }),
    ],
    input: Schema.Struct({
      withTags: switchOption("Include the member's tags"),
    }),
    outputs: [report("MemberView", "1.0", MemberView)],
    errors: [MemberNotFound, RosterUnavailable],
    examples: ["acme member show 7 --with-tags --json"],
  },
  (args) =>
    Effect.map(found(args.operands[0]), (member) =>
      args.withTags ? member : { ...member, tags: [] },
    ),
);

/** A day that the calendar has (the pattern admits 2026-02-30). */
const isCalendarDay = (text: string): boolean => {
  const day = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text.slice(0, 10);
};

export const memberTag = defineCommand(
  {
    path: ["member", "tag"],
    summary: "Tag a member",
    effect: { kind: "write", idempotency: "replay-safe" },
    operands: [
      operand("number", MemberNumber, { valueName: "NUMBER", help: "The member's number" }),
    ],
    input: Schema.Struct({
      tag: Tag.annotate({ valueName: "TAG", description: "The tag to add" }),
      by: defaulted(Schema.String.check(Schema.isMaxLength(254)), "acme").annotate({
        valueName: "WHO",
        description: "Who tags",
        env: "ACME_USER",
      }),
      expires: Schema.optionalKey(
        Day.annotate({ valueName: "DAY", description: "When the tag lapses" }),
      ),
      note: Schema.optionalKey(Schema.String.annotate({ valueName: "TEXT", description: "Why" })),
      quiet: switchOption("Print nothing on success"),
      verbose: switchOption("Print the whole member"),
    }),
    constraints: [
      requires({ name: "expires" }, ["note"], NoteRequired),
      atMostOne(["quiet", "verbose"]),
    ],
    validators: [
      {
        arguments: ["expires"],
        error: DateInvalid,
        description:
          "--expires is a day of the calendar (2026-02-30 matches the pattern and is refused).",
        rejects: ["acme member tag 7 --tag core --expires 2026-02-30 --note trial --json"],
        check: (args) => args.expires === undefined || isCalendarDay(args.expires),
      },
    ],
    outputs: [report("MemberTagged", "1.0", MemberTagged)],
    errors: [MemberNotFound, NoteRequired, DateInvalid, RosterUnavailable],
    examples: ["acme member tag 7 --tag core --json"],
  },
  (args) =>
    Effect.gen(function* () {
      const member = yield* found(args.operands[0]);
      const unchanged = member.tags.includes(args.tag);
      if (!unchanged) {
        const roster = yield* Roster;
        yield* roster.put({ ...member, tags: [...member.tags, args.tag] });
      }
      return {
        number: member.number,
        tags: unchanged ? member.tags : [...member.tags, args.tag],
        unchanged,
      };
    }),
);

/** What `member purge` would remove. */
export interface PurgePlan {
  readonly effects: ReadonlyArray<PlanEffect>;
  readonly member: Member;
}

export const memberPurge = defineCommand(
  {
    path: ["member", "purge"],
    summary: "Remove a member and their tags",
    effect: { kind: "destructive", idempotency: "once" },
    operands: [
      operand("number", MemberNumber, { valueName: "NUMBER", help: "The member's number" }),
    ],
    input: Schema.Struct({}),
    outputs: [report("MemberPurged", "1.0", MemberPurged)],
    errors: [MemberNotFound, RosterUnavailable],
    examples: ["acme member purge 7 --json"],
  },
  {
    // RosterReader only: the plan reads, and a tool runs it with no write capability (spec 11.2)
    plan: (args) =>
      Effect.map(found(args.operands[0]), (member): PurgePlan => ({
        effects: [{ action: "remove", target: `member ${member.number}` }],
        member,
      })),
    commit: (_, plan) =>
      Effect.gen(function* () {
        const roster = yield* Roster;
        yield* roster.remove(plan.member.number);
        return { number: plan.member.number, effects: plan.effects };
      }),
  },
);

export const COMMANDS = [memberShow, memberTag, memberPurge] as const;

// ---------------------------------------------------------------------------------------------------- profile

/**
 * acme's choices for its documents: its generic codes and its `--input` limit. `--json`, `--input` on a write and the
 * commit pair on a destructive command are the package's.
 */
const ACME_RULES = {
  genericErrors: GENERIC_ERRORS,
  inputMaxBytes: 65_536,
};

export const ACME = toolProfile({ name: "acme", ...ACME_RULES });

// ---------------------------------------------------------------------------------------------------- the tool

export const Usage = defineError({
  code: "USAGE",
  exit: 2,
  retryable: false,
  meaning: "The command line is not one acme reads",
  fix: "Run acme schema --json",
});

export const UnknownCommand = defineError({
  code: "UNKNOWN_COMMAND",
  exit: 2,
  retryable: false,
  meaning: "No command has these words",
  fix: "List the commands: acme schema --json",
});

export const SkillNotFound = defineError({
  code: "SKILL_NOT_FOUND",
  meaning: "No guide has this name",
  fix: "List the guides: acme skills show --json",
});

export const OptionConflict = defineError({
  code: "OPTION_CONFLICT",
  meaning: "Two options were given that exclude or need each other",
  fix: "Read the command's constraints: acme schema <COMMAND> --json",
});

export const PlanStale = defineError({
  code: "PLAN_STALE",
  meaning: "The state changed since the preview: its digest is not the plan's",
  fix: "Preview again and commit the new digest",
});

/** acme's codes every command can return, as values: the runner returns them (spec 7.3.1). */
const RUNNER_ERRORS = [
  Usage,
  ...["INPUT_INVALID", "INPUT_CONFLICT", "INPUT_TOO_LARGE"].map((code) =>
    defineError({
      code,
      meaning: `--input is refused (${code})`,
      fix: "Run acme schema <COMMAND> --schemas --json and send a document that matches its Input",
    }),
  ),
  defineError({
    code: "INTERNAL",
    exit: 1,
    retryable: false,
    meaning: "A bug in acme",
    fix: "Report it with the command line",
  }),
];

/** A `schema` answer as acme prints it: any JSON object (the package's schema-doc schema checks its shape). */
export const SchemaAnswer = Schema.Record(Schema.String, Schema.Json);

/** A guide as `skills show --json` prints it (spec 14.1). */
export const GuideAnswer = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
  guides: Schema.Array(Schema.String),
  full: Schema.Boolean,
});

export const schemaBuiltin = defineCommand(
  {
    ...schemaDeclaration({
      summary: "Describe acme: the command tree, one command, the error codes or the warning codes",
      command: "Words of a command (`member tag`)",
      commandDefault: "the tree",
      schemas: "Answer the JSON Schemas of one command",
      errors: "List every error code",
      error: "Show one error code",
      warnings: "List every warning code",
      warning: "Show one warning code",
      examples: ["acme schema member tag --json"],
    }),
    outputs: [report("SchemaView", CONTRACT_VERSION, SchemaAnswer)],
    errors: [UnknownCommand, Usage],
  },
  schemaHandler({ report: SchemaAnswer, usage: Usage, unknownCommand: UnknownCommand }),
);

export const skillsBuiltin = defineCommand(
  {
    ...skillsDeclaration({
      summary: "Print a guide of acme",
      name: "acme (the tool) or roster (keeping the roster)",
      nameDefault: "acme",
      full: "Include the reference sections",
      examples: ["acme skills show roster --json"],
    }),
    outputs: [artifact("Guide", "1.0", "text/markdown", GuideAnswer)],
    errors: [SkillNotFound],
  },
  skillsHandler({ report: GuideAnswer, notFound: SkillNotFound }),
);

/** The guides `skills show` prints: a short form, and the reference after it with `--full`. */
const GUIDES = [
  {
    name: "acme",
    short: "# acme\n\nA team roster.",
    reference: "\n\n## Reference\n\nEvery command.",
  },
  { name: "roster", short: "# roster\n\nKeep it current.", reference: "\n\n## Reference\n\nTags." },
].map((guide) => ({
  name: guide.name,
  text: (full: boolean) => (full ? `${guide.short}${guide.reference}` : guide.short),
}));

/**
 * The tool-level rules of `defineTool` on top of the document rules: the relation of the commit pair answers acme's
 * `OPTION_CONFLICT` (spec 11.7), which the package then lists on a destructive command beside `PLAN_STALE`.
 */
export const ACME_TOOL_RULES = {
  ...ACME_RULES,
  contract: { commitPairCode: "OPTION_CONFLICT" },
};

/** acme as one value: its commands, groups, registries and guides. */
export const ACME_TOOL_DECLARATION = {
  name: "acme",
  version: "0.1.0",
  level: "L1",
  groups: [
    { name: "member", summary: "Members of the roster: show, tag, purge" },
    { name: "skills", summary: "Guides of acme: show" },
  ],
  commands: [schemaBuiltin, ...COMMANDS, skillsBuiltin],
  errors: [...RUNNER_ERRORS, UnknownCommand, SkillNotFound, OptionConflict, PlanStale],
  warnings: [TagRepeated],
  guides: { list: GUIDES, default: "acme" },
  profile: ACME_TOOL_RULES,
};

export const ACME_TOOL = defineTool(ACME_TOOL_DECLARATION);
