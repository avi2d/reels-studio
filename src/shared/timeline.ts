import { Schema } from "effect"
import type { Span, Transcript } from "./plan.ts"

export const MIN_PAUSE = 0.5
export const PAUSE_REST = 0.2

export const Gaze = Schema.Struct({
  step: Schema.Finite.check(Schema.isGreaterThan(0)),
  samples: Schema.Array(Schema.Literals(["camera", "away", "hidden"]))
})
export type Gaze = typeof Gaze.Type

export const cameraShare = (gaze: Gaze, span: Span): number | undefined => {
  const seen = gaze.samples.slice(Math.ceil(span.start / gaze.step), Math.ceil(span.end / gaze.step))
  if (seen.length === 0) return undefined
  return seen.filter((sample) => sample === "camera").length / seen.length
}

const takeFields = { video: Schema.String, from: Schema.Int, to: Schema.Int, reason: Schema.String }
const blockFields = { id: Schema.String, title: Schema.String }

export const Blocks = Schema.Struct({
  blocks: Schema.Array(Schema.Struct({ ...blockFields, takes: Schema.Array(Schema.Struct(takeFields)) }))
})
export type Blocks = typeof Blocks.Type

const Take = Schema.Struct({ ...takeFields, camera: Schema.optionalKey(Schema.Finite) })
export type Take = typeof Take.Type

const Block = Schema.Struct({ ...blockFields, takes: Schema.NonEmptyArray(Take) })
export type Block = typeof Block.Type

const PauseRef = Schema.Struct({ video: Schema.String, after: Schema.Int })
type PauseRef = typeof PauseRef.Type

export const Edits = Schema.Struct({
  order: Schema.Array(Schema.String),
  deleted: Schema.Array(Schema.String),
  chosen: Schema.Array(Schema.Struct({ block: Schema.String, video: Schema.String, from: Schema.Int })),
  pauses: Schema.Array(PauseRef)
})
export type Edits = typeof Edits.Type

export const NO_EDITS: Edits = { order: [], deleted: [], chosen: [], pauses: [] }

export const GazeFailure = Schema.Literals(["no-tool", "tool-failed", "file-unreadable", "no-face"])
export type GazeFailure = typeof GazeFailure.Type

const Look = Schema.Union([
  Schema.Struct({ video: Schema.String, state: Schema.Literals(["measured", "waiting"]) }),
  Schema.Struct({ video: Schema.String, state: Schema.Literal("failed"), reason: GazeFailure })
])

export const TimelineView = Schema.Struct({
  looks: Schema.Array(Look),
  timeline: Schema.Union([
    Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
    Schema.Struct({ state: Schema.Literal("ready"), blocks: Schema.Array(Block), dropped: Schema.Int, edits: Edits })
  ])
})
export type TimelineView = typeof TimelineView.Type

type Transcripts = ReadonlyMap<string, Transcript>

const speechOf = (transcript: Transcript, take: { readonly from: number; readonly to: number }): Span | undefined => {
  const first = transcript.words[take.from]
  const last = transcript.words[take.to]
  return first === undefined || last === undefined || take.from > take.to ? undefined : { start: first.start, end: last.end }
}

export const soundBlocks = (
  written: Blocks,
  transcripts: Transcripts,
  gazes: ReadonlyMap<string, Gaze>
): { readonly blocks: ReadonlyArray<Block>; readonly dropped: number } => {
  const blocks: Array<Block> = []
  let dropped = 0
  for (const block of written.blocks) {
    const takes = block.takes.flatMap((take): ReadonlyArray<Take> => {
      const transcript = transcripts.get(take.video)
      const speech = transcript === undefined ? undefined : speechOf(transcript, take)
      if (speech === undefined) return []
      const gaze = gazes.get(take.video)
      const camera = gaze === undefined ? undefined : cameraShare(gaze, speech)
      return [camera === undefined ? take : { ...take, camera }]
    })
    dropped += block.takes.length - takes.length
    const [best, ...rest] = takes
    if (best === undefined) continue
    if (blocks.some((other) => other.id === block.id)) {
      dropped += takes.length
      continue
    }
    blocks.push({ id: block.id, title: block.title, takes: [best, ...rest] })
  }
  return { blocks, dropped }
}

export const arrange = (
  blocks: ReadonlyArray<Block>,
  edits: Edits
): { readonly placed: ReadonlyArray<Block>; readonly deleted: ReadonlyArray<Block> } => {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const order = [...new Set(edits.order)].filter((id) => byId.has(id))
  blocks.forEach((block, index) => {
    if (order.includes(block.id)) return
    const before = blocks[index - 1]
    order.splice(before === undefined ? 0 : order.indexOf(before.id) + 1, 0, block.id)
  })
  const gone = new Set(edits.deleted)
  const inOrder = order.flatMap((id) => byId.get(id) ?? [])
  return { placed: inOrder.filter((block) => !gone.has(block.id)), deleted: inOrder.filter((block) => gone.has(block.id)) }
}

export const chosenTake = (block: Block, edits: Edits): Take => {
  const choice = edits.chosen.find((chosen) => chosen.block === block.id)
  const take = choice === undefined ? undefined : block.takes.find((one) => one.video === choice.video && one.from === choice.from)
  return take ?? block.takes[0]
}

export interface Pause extends Span {
  readonly after: number
  readonly removed: boolean
}

const samePause = (left: PauseRef, right: PauseRef): boolean => left.video === right.video && left.after === right.after

// A word ends where the silence after it starts, so the stretch of a take runs to the next word of its video.
export const pausesOf = (transcript: Transcript, take: Take, edits: Edits): ReadonlyArray<Pause> =>
  transcript.words.slice(take.from, take.to + 1).flatMap((word, offset): ReadonlyArray<Pause> => {
    const after = take.from + offset
    const end = transcript.words[after + 1]?.start ?? transcript.duration
    if (end - word.end < MIN_PAUSE) return []
    return [{ after, start: word.end, end, removed: edits.pauses.some((pause) => samePause(pause, { video: take.video, after })) }]
  })

export const playedSpans = (transcript: Transcript, take: Take, edits: Edits): ReadonlyArray<Span> => {
  const speech = speechOf(transcript, take) ?? { start: 0, end: 0 }
  const end = transcript.words[take.to + 1]?.start ?? transcript.duration
  const cuts = pausesOf(transcript, take, edits).filter((pause) => pause.removed).map((pause) =>
    pause.after === take.to
      ? { start: pause.start + PAUSE_REST, end: pause.end }
      : { start: pause.start + PAUSE_REST / 2, end: pause.end - PAUSE_REST / 2 })
  const starts = [speech.start, ...cuts.map((cut) => cut.end)]
  const ends = [...cuts.map((cut) => cut.start), Math.max(end, speech.end)]
  return starts.flatMap((start, index) => {
    const stop = ends[index] ?? start
    return stop > start ? [{ start, end: stop }] : []
  })
}

export interface Placed {
  readonly block: Block
  readonly take: Take
  readonly pauses: ReadonlyArray<Pause>
  readonly spans: ReadonlyArray<Span>
}

export const assemble = (blocks: ReadonlyArray<Block>, edits: Edits, transcripts: Transcripts): ReadonlyArray<Placed> =>
  arrange(blocks, edits).placed.flatMap((block): ReadonlyArray<Placed> => {
    const take = chosenTake(block, edits)
    const transcript = transcripts.get(take.video)
    if (transcript === undefined) return []
    return [{ block, take, pauses: pausesOf(transcript, take, edits), spans: playedSpans(transcript, take, edits) }]
  })

const FADE = 0.06

export const fadeGain = (span: Span, time: number): number =>
  Math.max(0, Math.min(1, (time - span.start) / FADE, (span.end - time) / FADE))

export const offsetIn = (spans: ReadonlyArray<Span>, time: number): number =>
  spans.reduce((total, span) => total + Math.max(0, Math.min(time, span.end) - span.start), 0)

export const within = <S extends Span>(spans: ReadonlyArray<S>, window: Span): ReadonlyArray<S> =>
  spans.flatMap((span) => {
    const start = Math.max(span.start, window.start)
    const end = Math.min(span.end, window.end)
    return end > start ? [{ ...span, start, end }] : []
  })

export interface Clip extends Span {
  readonly video: string
  readonly block: string
}

export const clipsOf = (placed: ReadonlyArray<Placed>): ReadonlyArray<Clip> =>
  placed.flatMap((one) => one.spans.map((span) => ({ ...span, video: one.take.video, block: one.block.id })))

const tailRun = (cut: ReadonlyArray<Clip>, first: number, id: string, seconds: number): ReadonlyArray<Clip> => {
  const run: Array<Clip> = []
  let total = 0
  for (let index = first - 1; index >= 0; index -= 1) {
    const clip = cut[index]
    if (clip === undefined || clip.block !== id) break
    run.unshift(clip)
    total += clip.end - clip.start
    if (total >= seconds) break
  }
  return trimHead(run, total - seconds)
}

const trimHead = (run: ReadonlyArray<Clip>, excess: number): ReadonlyArray<Clip> => {
  const head = run[0]
  return head === undefined || excess <= 0 ? [...run] : [{ ...head, start: head.start + excess }, ...run.slice(1)]
}

const headRun = (cut: ReadonlyArray<Clip>, last: number, id: string, seconds: number): ReadonlyArray<Clip> => {
  const run: Array<Clip> = []
  let total = 0
  for (let index = last + 1; index < cut.length; index += 1) {
    const clip = cut[index]
    if (clip === undefined || clip.block !== id) break
    run.push(clip)
    total += clip.end - clip.start
    if (total >= seconds) break
  }
  return trimTail(run, total - seconds)
}

const trimTail = (run: ReadonlyArray<Clip>, excess: number): ReadonlyArray<Clip> => {
  const tail = run.at(-1)
  return tail === undefined || excess <= 0 ? [...run] : [...run.slice(0, -1), { ...tail, end: tail.end - excess }]
}

export const withNeighbours = (cut: ReadonlyArray<Clip>, block: string, own: ReadonlyArray<Clip>, seconds: number): ReadonlyArray<Clip> => {
  const blocks = cut.map((clip) => clip.block)
  const first = blocks.indexOf(block)
  const last = blocks.lastIndexOf(block)
  const beforeId = first > 0 ? cut[first - 1]?.block : undefined
  const before = beforeId === undefined ? [] : tailRun(cut, first, beforeId, seconds)
  const afterId = first === -1 ? undefined : cut[last + 1]?.block
  const after = afterId === undefined ? [] : headRun(cut, last, afterId, seconds)
  return [...before, ...own, ...after]
}

export const withChoice = (edits: Edits, block: string, take: Take): Edits => ({
  ...edits,
  chosen: [...edits.chosen.filter((chosen) => chosen.block !== block), { block, video: take.video, from: take.from }]
})

export const withDeleted = (edits: Edits, id: string, deleted: boolean): Edits => ({
  ...edits,
  deleted: deleted ? [...edits.deleted.filter((other) => other !== id), id] : edits.deleted.filter((other) => other !== id)
})

export const withPauses = (edits: Edits, pauses: ReadonlyArray<PauseRef>, removed: boolean): Edits => {
  const kept = edits.pauses.filter((old) => !pauses.some((pause) => samePause(old, pause)))
  return { ...edits, pauses: removed ? [...kept, ...pauses] : kept }
}
