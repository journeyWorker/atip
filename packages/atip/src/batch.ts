/**
 * Batches (spec 10.11): an `--input` array (or an NDJSON file or stdin the tool reads as one) to a command that declares
 * `batch`. The runner (`runCommandLine`) preflights every item first, running steps 1-6 of spec 10.7 on each, and the
 * first item that fails refuses the whole batch with that item's own code and its pointer under `/<index>`, nothing
 * executed. Then it executes the items in order, each through the tool's preconditions and `execute`, and stops at the
 * first that fails: that item is `failed` with its own error, the ones after it `skipped`. The tool prints the
 * outcome (`RunnerEmission.batch`); `batchReport` builds the report and the `BATCH_INCOMPLETE` error from it.
 *
 * A batch is not a transaction: an item that failed during execution may have made effects (its own code's exit says
 * so). A destructive command takes no batch (`defineCommand` refuses the declaration).
 */
import type { CommandDescription } from "./description.ts";
import type { ArgvRefusal } from "./parser-profile.ts";
import type { ToolInvocation } from "./runner.ts";

/** One submitted item as the runner reached it, by its index in the batch. */
export type BatchItemOutcome<E, C, A> =
  | {
      readonly status: "done";
      readonly index: number;
      readonly outcome: A;
      readonly invocation: ToolInvocation;
      readonly context: C;
    }
  | {
      readonly status: "failed";
      readonly index: number;
      readonly failure: E;
      readonly invocation: ToolInvocation;
    }
  | { readonly status: "skipped"; readonly index: number };

/** An executed batch: one outcome per submitted item, in order. */
export interface BatchOutcome<E, C, A> {
  readonly command: CommandDescription;
  readonly items: ReadonlyArray<BatchItemOutcome<E, C, A>>;
}

/** What an executed item reports (spec 10.11): whether it changed anything, and its single-invocation data. */
export interface BatchItemReport {
  readonly status: "written" | "unchanged";
  readonly data: unknown;
}

/**
 * The error object of an item that failed (spec 7.1), as the tool's envelope prints it: its members beyond these
 * (`field`, `reason`, …) are kept as the tool gives them.
 */
export interface BatchItemError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** One entry of a batch report (`schema/batch-report.schema.json`). */
export type BatchReportItem =
  | { readonly index: number; readonly status: "written" | "unchanged"; readonly data: unknown }
  | { readonly index: number; readonly status: "failed"; readonly error: BatchItemError }
  | { readonly index: number; readonly status: "skipped" };

/** The `BATCH_INCOMPLETE` refusal parts (spec 7.3.1, 10.11): exit 1, not retryable, `field` the failed item. */
export interface BatchIncomplete {
  readonly code: "BATCH_INCOMPLETE";
  readonly message: string;
  readonly field: string;
  readonly retryable: false;
}

/** What a tool prints for an executed batch: the report, its output's name, and the error when an item failed. */
export interface BatchReport {
  /** The batch output's `data`: one entry per submitted item, in order. */
  readonly data: { readonly items: ReadonlyArray<BatchReportItem> };
  /** The batch output's name (`meta.output`, spec 6.6), the one whose `batch` is true. */
  readonly output: string | undefined;
  /** Present when an item failed during execution: the envelope is then a failure, exit 1. */
  readonly incomplete?: BatchIncomplete;
}

/** `1 written, 1 unchanged, 1 skipped`; `nothing written` when no item ran. */
const tally = (items: ReadonlyArray<BatchReportItem>): string => {
  const count = (status: BatchReportItem["status"]) =>
    items.filter((item) => item.status === status).length;
  const parts = (["written", "unchanged", "skipped"] as const).flatMap((status) =>
    count(status) === 0 ? [] : [`${count(status)} ${status}`],
  );
  return count("written") + count("unchanged") === 0
    ? ["nothing written", ...parts].join(", ")
    : parts.join(", ");
};

/**
 * The report of an executed batch (spec 10.11), from what each item reported (`item`, by its outcome) and the error
 * object of the item that failed (`error`): every item `written`, `unchanged`, `failed` or `skipped` in order, and,
 * when one failed, `BATCH_INCOMPLETE` with `field` `/<index>` and a message that names the item, its code and what
 * was done.
 */
export const batchReport = <E, C, A>(
  outcome: BatchOutcome<E, C, A>,
  render: {
    readonly item: (outcome: A, invocation: ToolInvocation) => BatchItemReport;
    readonly error: (failure: E, invocation: ToolInvocation) => BatchItemError;
  },
): BatchReport => {
  const items = outcome.items.map((item): BatchReportItem => {
    switch (item.status) {
      case "done": {
        const reported = render.item(item.outcome, item.invocation);
        return { index: item.index, status: reported.status, data: reported.data };
      }
      case "failed":
        return {
          index: item.index,
          status: "failed",
          error: render.error(item.failure, item.invocation),
        };
      case "skipped":
        return { index: item.index, status: "skipped" };
    }
  });
  const output = outcome.command.outputs.find((candidate) => candidate.batch === true)?.name;
  const failed = items.find((item) => item.status === "failed");
  if (failed === undefined || failed.status !== "failed") return { data: { items }, output };
  return {
    data: { items },
    output,
    incomplete: {
      code: "BATCH_INCOMPLETE",
      message: `item ${failed.index} of ${items.length} failed (${failed.error.code}): ${tally(items)}`,
      field: `/${failed.index}`,
      retryable: false,
    },
  };
};

/**
 * A `field` of a batch item's refusal as spec 10.8 writes it: a document pointer under the item's index (`/round` of
 * item 1 is `/1/round`), `--input` the item itself (`/1`); an argv argument, shared by every item, as it is. A tool's
 * own refusals of an item (`RunnerHooks.invalid`, `values`) use it with `ToolInvocation.item`.
 */
export const batchField = (index: number, field: string | undefined): string =>
  field === undefined || field === "--input"
    ? `/${index}`
    : field.startsWith("/")
      ? `/${index}${field}`
      : field;

/** A refusal of a batch item with its fields under the item's index (`batchField`). */
export const batchRefusal = (index: number, refusal: ArgvRefusal): ArgvRefusal => ({
  ...refusal,
  field: batchField(index, refusal.field),
  ...(refusal.details === undefined
    ? {}
    : {
        details: refusal.details.map((detail) => ({
          ...detail,
          field: batchField(index, detail.field),
        })),
      }),
});
