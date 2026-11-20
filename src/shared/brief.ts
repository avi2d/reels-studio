import { Schema } from "effect"
import { lengthOf, type Transcript } from "./plan.ts"
import { assemble, withChoice, withPauses, type Block, type Edits } from "./timeline.ts"

export const MAX_BRIEF = 4000

export const Done = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("take"), block: Schema.String, take: Schema.Int, of: Schema.Int, reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pauses"), count: Schema.Int, seconds: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("no-blocks") })
])
export type Done = typeof Done.Type

export const Approval = Schema.Struct({ plan: Schema.String, at: Schema.String, done: Schema.Array(Done) })
export type Approval = typeof Approval.Type

export const PlanView = Schema.Union([
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({ state: Schema.Literal("proposed"), text: Schema.String }),
  Schema.Struct({ state: Schema.Literal("approved"), text: Schema.String, at: Schema.String, done: Schema.Array(Done) })
])
export type PlanView = typeof PlanView.Type

export const BriefView = Schema.Struct({ brief: Schema.String, plan: PlanView })
export type BriefView = typeof BriefView.Type

export const planView = (text: string | undefined, approval: Approval | undefined): PlanView => {
  if (text === undefined || text.trim() === "") return { state: "none" }
  if (approval === undefined || approval.plan !== text) return { state: "proposed", text }
  return { state: "approved", text, at: approval.at, done: approval.done }
}

const YES = new Set(["согласна", "согласен"])

export const approves = (text: string): boolean => YES.has(text.trim().toLowerCase().replace(/[.!\s]+$/u, ""))

const playedLength = (blocks: ReadonlyArray<Block>, edits: Edits, transcripts: ReadonlyMap<string, Transcript>): number =>
  lengthOf(assemble(blocks, edits, transcripts).flatMap((one) => one.spans))

export const afterYes = (
  blocks: ReadonlyArray<Block>,
  edits: Edits,
  transcripts: ReadonlyMap<string, Transcript>
): { readonly edits: Edits; readonly done: ReadonlyArray<Done> } => {
  const placed = assemble(blocks, edits, transcripts)
  if (placed.length === 0) return { edits, done: [{ kind: "no-blocks" }] }
  const chosen = placed.reduce((next, one) => withChoice(next, one.block.id, one.take), edits)
  const pauses = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed).map((pause) => ({ video: one.take.video, after: pause.after })))
  const next = withPauses(chosen, pauses, true)
  const takes = placed.map((one): Done => ({
    kind: "take",
    block: one.block.title,
    take: one.block.takes.indexOf(one.take) + 1,
    of: one.block.takes.length,
    reason: one.take.reason
  }))
  const seconds = playedLength(blocks, edits, transcripts) - playedLength(blocks, next, transcripts)
  return { edits: next, done: [...takes, { kind: "pauses", count: pauses.length, seconds }] }
}
