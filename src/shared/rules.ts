import { Schema } from "effect"
import { cutOf, facesByVideo } from "./joins.ts"
import { lengthOf, type Transcript } from "./plan.ts"
import { assemble, clipsOf, NO_EDITS, PAUSE_REST, PauseRest, playedPause, type Block, type Edits, type VideoFaces } from "./timeline.ts"
import { zoomedOf } from "./zooms.ts"
import { ZoomLevel, type PlannedZoom } from "./zoom-plan.ts"

const RULE_IDS = ["pause", "zoom"] as const
export const RuleId = Schema.Literals(RULE_IDS)
export type RuleId = typeof RuleId.Type

export const RulesFile = Schema.Struct({ pause: Schema.optionalKey(PauseRest), zoom: Schema.optionalKey(ZoomLevel) })
export type RulesFile = typeof RulesFile.Type

const FullRules = Schema.Struct({ pause: PauseRest, zoom: ZoomLevel })
export type Rules = typeof FullRules.Type

const STUDIO_RULES: Rules = { pause: PAUSE_REST, zoom: "full" }

export const formatSeconds = (seconds: number): string => String(Number(seconds.toFixed(2)))

export const rulesOf = (own: RulesFile): Rules => ({ ...STUDIO_RULES, ...own })

export const ruleOf = (rules: Rules, id: RuleId): RulesFile => id === "pause" ? { pause: rules.pause } : { zoom: rules.zoom }

export const withoutRule = (own: RulesFile, id: RuleId): RulesFile => {
  const { pause, zoom } = own
  return { ...id === "pause" || pause === undefined ? {} : { pause }, ...id === "zoom" || zoom === undefined ? {} : { zoom } }
}

export const RuleChange = Schema.Struct({ before: RulesFile, after: FullRules })
export type RuleChange = typeof RuleChange.Type

export const changedRules = (from: Rules, to: Rules): ReadonlyArray<RuleId> => RULE_IDS.filter((id) => from[id] !== to[id])

// A pinned rule moves only where it held the old value, so a pin the person set apart from this reel stays.
export const movedPins = (kept: RulesFile, from: Rules, to: Rules): RulesFile => ({
  ...kept,
  ...kept.pause !== undefined && kept.pause === from.pause ? { pause: to.pause } : {},
  ...kept.zoom !== undefined && kept.zoom === from.zoom ? { zoom: to.zoom } : {}
})

const PauseShift = Schema.Struct({ block: Schema.String, word: Schema.String, from: Schema.Finite, to: Schema.Finite })
type PauseShift = typeof PauseShift.Type

const FollowingZoom = Schema.Struct({ block: Schema.String, words: Schema.String })
type FollowingZoom = typeof FollowingZoom.Type

const PauseChange = Schema.Struct({
  id: Schema.Literal("pause"),
  from: PauseRest,
  to: PauseRest,
  pauses: Schema.Array(PauseShift),
  length: Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
})

const ZoomChange = Schema.Struct({ id: Schema.Literal("zoom"), from: ZoomLevel, to: ZoomLevel, zooms: Schema.Array(FollowingZoom) })

export const RulesView = Schema.Struct({
  rules: Schema.Array(Schema.Union([
    Schema.Struct({ id: Schema.Literal("pause"), value: PauseRest, kept: Schema.Boolean }),
    Schema.Struct({ id: Schema.Literal("zoom"), value: ZoomLevel, kept: Schema.Boolean })
  ])),
  changes: Schema.Array(Schema.Union([PauseChange, ZoomChange]))
})
export type RulesView = typeof RulesView.Type
export type RuleChangeView = RulesView["changes"][number]

interface Cut {
  readonly blocks: ReadonlyArray<Block>
  readonly edits: Edits
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly zooms: ReadonlyArray<PlannedZoom>
  readonly faces: ReadonlyArray<VideoFaces>
}

const pauseChange = (cut: Cut, from: number, to: number): typeof PauseChange.Type => {
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
  return { id: "pause", from, to, pauses, length: { from: total(before), to: total(after) } }
}

// A zoom the person set on the page keeps its own level, so only the others follow the rule.
const zoomChange = (cut: Cut, from: ZoomLevel, to: ZoomLevel, rest: number): typeof ZoomChange.Type => {
  const placed = assemble(cut.blocks, cut.edits, cut.transcripts, rest)
  const faces = facesByVideo(cut.faces)
  const clips = cutOf(clipsOf(placed), faces, cut.transcripts, cut.edits)
  const zoomedUnder = (rule: ZoomLevel) => zoomedOf(clips, cut.zooms, faces, cut.transcripts, cut.edits, rule).places
  const before = new Set(zoomedUnder(from).flatMap((place) => place.state === "zoomed" ? [place.planned.id] : []))
  const zooms = zoomedUnder(to).flatMap((place): ReadonlyArray<FollowingZoom> => {
    if (place.given || (place.state !== "zoomed" && !before.has(place.planned.id))) return []
    const one = placed.find((candidate) => candidate.block.id === place.block)
    if (one === undefined) return []
    const zoom = place.planned
    const words = (cut.transcripts.get(zoom.video)?.words ?? []).slice(zoom.from, zoom.to + 1).map((word) => word.text).join(" ").replace(/[\p{P}]+$/u, "")
    return [{ block: one.block.title, words }]
  })
  return { id: "zoom", from, to, zooms }
}

const NO_CUT: Cut = { blocks: [], edits: NO_EDITS, transcripts: new Map(), zooms: [], faces: [] }

// A change the person or a later reply already replaced no longer describes the rules, so it is not shown.
export const rulesView = (rules: Rules, kept: RulesFile, change: RuleChange | undefined, cut: Cut | undefined): RulesView => {
  const from = change === undefined ? rules : rulesOf(change.before)
  const current = change !== undefined && changedRules(change.after, rules).length === 0
  const changes = current ? changedRules(from, rules).map((id): RuleChangeView => id === "pause"
    ? pauseChange(cut ?? NO_CUT, from.pause, rules.pause)
    : zoomChange(cut ?? NO_CUT, from.zoom, rules.zoom, rules.pause)) : []
  return {
    rules: [{ id: "pause", value: rules.pause, kept: kept.pause === rules.pause }, { id: "zoom", value: rules.zoom, kept: kept.zoom === rules.zoom }],
    changes
  }
}

export const KeptInput = Schema.Struct({ kept: Schema.Boolean })
