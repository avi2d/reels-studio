import { Schema } from "effect"
import { lengthOf, type Transcript } from "./plan.ts"
import { assemble, NO_EDITS, PAUSE_REST, PauseRest, playedPause, type Block, type Edits } from "./timeline.ts"

export const RuleId = Schema.Literal("pause")
export type RuleId = typeof RuleId.Type

export const RulesFile = Schema.Struct({ pause: Schema.optionalKey(PauseRest) })
export type RulesFile = typeof RulesFile.Type

export type Rules = Required<RulesFile>

const STUDIO_RULES: Rules = { pause: PAUSE_REST }

export const formatSeconds = (seconds: number): string => String(Number(seconds.toFixed(2)))

export const rulesOf = (own: RulesFile): Rules => ({ ...STUDIO_RULES, ...own })

export const RuleChange = Schema.Struct({ id: RuleId, from: PauseRest, to: PauseRest, before: RulesFile })
export type RuleChange = typeof RuleChange.Type

const PauseShift = Schema.Struct({ block: Schema.String, word: Schema.String, from: Schema.Finite, to: Schema.Finite })
type PauseShift = typeof PauseShift.Type

export const RulesView = Schema.Struct({
  rules: Schema.Array(Schema.Struct({ id: RuleId, value: PauseRest, kept: Schema.Boolean })),
  change: Schema.optionalKey(Schema.Struct({
    id: RuleId,
    from: PauseRest,
    to: PauseRest,
    pauses: Schema.Array(PauseShift),
    length: Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
  }))
})
export type RulesView = typeof RulesView.Type

type Shifts = Pick<NonNullable<RulesView["change"]>, "pauses" | "length">

interface Cut {
  readonly blocks: ReadonlyArray<Block>
  readonly edits: Edits
  readonly transcripts: ReadonlyMap<string, Transcript>
}

const pauseShifts = (cut: Cut, from: number, to: number): Shifts => {
  const before = assemble(cut.blocks, cut.edits, cut.transcripts, from)
  const after = assemble(cut.blocks, cut.edits, cut.transcripts, to)
  const pauses = before.flatMap((one, index) => {
    const now = after[index]
    if (now === undefined) return []
    return one.pauses.flatMap((pause, at): ReadonlyArray<PauseShift> => {
      const moved = now.pauses[at]
      if (!pause.removed || moved === undefined) return []
      const word = (cut.transcripts.get(one.take.video)?.words[pause.after]?.text ?? "").replace(/[\p{P}]+$/u, "")
      return [{ block: one.block.title, word, from: lengthOf(playedPause(one, pause)), to: lengthOf(playedPause(now, moved)) }]
    })
  })
  const total = (placed: typeof before): number => lengthOf(placed.flatMap((one) => one.spans))
  return { pauses, length: { from: total(before), to: total(after) } }
}

const NO_CUT: Cut = { blocks: [], edits: NO_EDITS, transcripts: new Map() }

// A change the person or a later reply already replaced no longer describes the rule, so it is not shown.
export const rulesView = (rules: Rules, kept: RulesFile, change: RuleChange | undefined, cut: Cut | undefined): RulesView => ({
  rules: [{ id: "pause", value: rules.pause, kept: kept.pause === rules.pause }],
  ...change === undefined || change.to !== rules[change.id] ? {} : {
    change: { id: change.id, from: change.from, to: change.to, ...pauseShifts(cut ?? NO_CUT, change.from, change.to) }
  }
})

export const KeptInput = Schema.Struct({ kept: Schema.Boolean })
