import { Effect, Schema } from "effect"
import { lengthOf, type Transcript } from "./plan.ts"
import { assemble, keptOf, samePause, withChoice, withPauses, type Block, type Edits } from "./timeline.ts"

export const MAX_BRIEF = 4000

export const Done = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("take"), block: Schema.String, take: Schema.Int, of: Schema.Int, reason: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pauses"), count: Schema.Int, seconds: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("no-blocks") })
])
export type Done = typeof Done.Type

export const Approval = Schema.Struct({ plan: Schema.String, texts: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))), at: Schema.String, done: Schema.Array(Done) })
export type Approval = typeof Approval.Type

export const PlanView = Schema.Union([
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({ state: Schema.Literal("proposed"), text: Schema.String }),
  Schema.Struct({ state: Schema.Literal("approved"), text: Schema.String, at: Schema.String, done: Schema.Array(Done) })
])
export type PlanView = typeof PlanView.Type

export const APPS = ["Instagram", "YouTube Shorts", "TikTok"] as const
export const App = Schema.Literals(APPS)
export type App = typeof App.Type

export const TaskChoices = Schema.Struct({ apps: Schema.Array(App), files: Schema.Array(Schema.String) })
export type TaskChoices = typeof TaskChoices.Type

export const EVERY_APP: TaskChoices = { apps: APPS, files: [] }

export const inAppOrder = (apps: Iterable<App>): ReadonlyArray<App> => {
  const chosen = new Set(apps)
  return APPS.filter((app) => chosen.has(app))
}

export const TaskFile = Schema.Union([
  Schema.Struct({ name: Schema.String }),
  Schema.Struct({ upload: Schema.String })
])
export type TaskFile = typeof TaskFile.Type

export const NewTask = Schema.Struct({
  text: Schema.String,
  apps: Schema.optionalKey(Schema.Array(App)),
  files: Schema.optionalKey(Schema.Array(TaskFile))
})
export type NewTask = typeof NewTask.Type

export const BriefView = Schema.Struct({ brief: Schema.String, ...TaskChoices.fields, plan: PlanView, working: Schema.Boolean })
export type BriefView = typeof BriefView.Type

export const planView = (text: string | undefined, texts: string | undefined, approval: Approval | undefined): PlanView => {
  if (text === undefined || text.trim() === "") return { state: "none" }
  if (approval === undefined || approval.plan !== text || approval.texts !== (texts ?? null)) return { state: "proposed", text }
  return { state: "approved", text, at: approval.at, done: approval.done }
}

const YES = new Set(["согласна", "согласен"])

export const approves = (text: string): boolean => YES.has(text.trim().toLowerCase().replace(/[.!\s]+$/u, ""))

const playedLength = (blocks: ReadonlyArray<Block>, edits: Edits, transcripts: ReadonlyMap<string, Transcript>): number =>
  lengthOf(assemble(blocks, edits, transcripts).flatMap((one) => one.spans))

export const shortenPlaced = (
  blocks: ReadonlyArray<Block>,
  edits: Edits,
  transcripts: ReadonlyMap<string, Transcript>
): Edits => {
  const placed = assemble(blocks, edits, transcripts)
  const kept = keptOf(edits)
  const pauses = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed && !kept.some((hold) => samePause(hold, { video: one.take.video, after: pause.after }))).map((pause) => ({ video: one.take.video, after: pause.after })))
  return withPauses(edits, pauses, true)
}

export const afterYes = (
  blocks: ReadonlyArray<Block>,
  edits: Edits,
  transcripts: ReadonlyMap<string, Transcript>
): { readonly edits: Edits; readonly done: ReadonlyArray<Done> } => {
  const placed = assemble(blocks, edits, transcripts)
  if (placed.length === 0) return { edits, done: [{ kind: "no-blocks" }] }
  const pinned = placed.reduce((next, one) => withChoice(next, one.block.id, one.take), edits)
  const next = shortenPlaced(blocks, pinned, transcripts)
  const cut = assemble(blocks, next, transcripts)
  const removed = cut.flatMap((one) => one.pauses.filter((pause) => pause.removed))
  const takes = cut.map((one): Done => ({
    kind: "take",
    block: one.block.title,
    take: one.block.takes.indexOf(one.take) + 1,
    of: one.block.takes.length,
    reason: one.take.reason
  }))
  const seconds = playedLength(blocks, { ...next, pauses: [] }, transcripts) - playedLength(blocks, next, transcripts)
  return { edits: next, done: [...takes, { kind: "pauses", count: removed.length, seconds }] }
}
