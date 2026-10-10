import { z } from "zod";
import { CONTRACT_VERSION, type DecimalInteger, type RunSimulationRequest } from "@/contracts";

const id = z.string().min(1);
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as DecimalInteger);
const instant = z.iso.datetime({ offset: false }).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
const positiveInteger = integer.refine(value => BigInt(value) > 0n);
const base = z.strictObject({
  id,
  datasetId: id,
  baseSnapshotId: id,
  expectedDatasetRevision: integer,
  rationale: z.string().min(1),
});
const intervention = z.discriminatedUnion("kind", [
  base.extend({
    kind: z.literal("cash_transfer"),
    sourceAccountId: id,
    targetAccountId: id,
    amount: z.strictObject({ currency: id, minorUnits: positiveInteger }),
    effectiveAt: instant,
  }).strict(),
  base.extend({
    kind: z.literal("settlement_priority"),
    obligationId: id,
    aheadOfObligationId: id,
  }).strict(),
]);

export const simulationRequestSchema: z.ZodType<RunSimulationRequest> = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  datasetId: id,
  expectedDatasetRevision: integer,
  baseSnapshotId: id,
  interventions: z.tuple([intervention], intervention),
});
