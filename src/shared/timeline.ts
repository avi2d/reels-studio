import { Effect, Schema } from "effect"
import type { Span, Transcript } from "./plan.ts"
import { PlannedDoubts } from "./doubts-file.ts"
import { PlannedTexts, TextAnswer, textKey } from "./texts.ts"

export const MIN_PAUSE = 0.5
export const PAUSE_REST = 0.2

// A rest longer than the shortest pause would make that pause longer than its own silence.
export const PauseRest = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(MIN_PAUSE))

export const Head = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  size: Schema.Finite.check(Schema.isGreaterThan(0))
})
export type Head = typeof Head.Type

const Step = Schema.Finite.check(Schema.isGreaterThan(0))
const HeadSamples = Schema.Array(Schema.NullOr(Head))
const GazeSamples = Schema.Array(Schema.Literals(["camera", "away", "hidden"]))

const Aspect = Schema.Finite.check(Schema.isGreaterThan(0))

export const Gaze = Schema.Struct({
  step: Step,
  samples: GazeSamples,
  heads: Schema.optionalKey(HeadSamples),
  aspect: Schema.optionalKey(Aspect)
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
export type PauseRef = typeof PauseRef.Type

const ClipEdge = Schema.Struct({ video: Schema.String, at: Schema.Finite })

export const JoinAnswer = Schema.Literals(["zoom", "trim", "leave"])
export type JoinAnswer = typeof JoinAnswer.Type

const joinEnds = { end: ClipEdge, start: ClipEdge }

const AnsweredJoin = Schema.Union([
  Schema.Struct({ ...joinEnds, answer: JoinAnswer }),
  Schema.Struct({ ...joinEnds, answer: Schema.Literal("cover"), picture: Schema.String })
])
export type AnsweredJoin = typeof AnsweredJoin.Type
export type JoinState = AnsweredJoin["answer"]

export const replyKey = (answered: AnsweredJoin): string => answered.answer === "cover" ? `cover:${answered.picture}` : answered.answer

export const InsertAnswer = Schema.Union([
  Schema.Struct({ id: Schema.String, answer: Schema.Literals(["keep", "sound", "remove"]) }),
  Schema.Struct({ id: Schema.String, answer: Schema.Literal("replace"), picture: Schema.String })
])
export type InsertAnswer = typeof InsertAnswer.Type

export const insertKey = (answered: InsertAnswer): string => answered.answer === "replace" ? `replace:${answered.picture}` : answered.answer

const WordCorrection = Schema.Struct({ block: Schema.String, video: Schema.String, index: Schema.Int, text: Schema.String })
export type WordCorrection = typeof WordCorrection.Type

export const Edits = Schema.Struct({
  order: Schema.Array(Schema.String),
  deleted: Schema.Array(Schema.String),
  chosen: Schema.Array(Schema.Struct({ block: Schema.String, video: Schema.String, from: Schema.Int })),
  pauses: Schema.Array(PauseRef),
  kept: Schema.optionalKey(Schema.Array(PauseRef)),
  joins: Schema.Array(AnsweredJoin).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  inserts: Schema.Array(InsertAnswer).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  texts: Schema.optionalKey(Schema.Array(TextAnswer)),
  subtitles: Schema.optionalKey(Schema.Array(WordCorrection))
})
export type Edits = typeof Edits.Type

export const NO_EDITS: Edits = { order: [], deleted: [], chosen: [], pauses: [], kept: [], joins: [], inserts: [] }

export const GazeFailure = Schema.Literals(["no-tool", "tool-failed", "file-unreadable", "video-unreadable"])
export type GazeFailure = typeof GazeFailure.Type

const Look = Schema.Union([
  Schema.Struct({ video: Schema.String, state: Schema.Literals(["measured", "waiting"]) }),
  Schema.Struct({ video: Schema.String, state: Schema.Literal("failed"), reason: GazeFailure })
])

export const VideoFaces = Schema.Struct({ video: Schema.String, step: Step, gaze: GazeSamples, heads: HeadSamples, aspect: Schema.optionalKey(Aspect) })
export type VideoFaces = typeof VideoFaces.Type

const insertPhrase = { id: Schema.String, video: Schema.String, from: Schema.Int, to: Schema.Int, reason: Schema.String }

export const PlannedInsert = Schema.Union([
  Schema.Struct({ ...insertPhrase, picture: Schema.String }),
  Schema.Struct({ ...insertPhrase, clip: Schema.String, start: Schema.optionalKey(Schema.Finite) }),
  Schema.Struct({ ...insertPhrase, document: Schema.String, page: Schema.Int, quote: Schema.String })
])
export type PlannedInsert = typeof PlannedInsert.Type

export const InsertsFile = Schema.Struct({ inserts: Schema.Array(PlannedInsert) })

export const PlannedInserts = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
  Schema.Struct({ state: Schema.Literal("ready"), planned: Schema.Array(PlannedInsert), dropped: Schema.Int })
])
export type PlannedInserts = typeof PlannedInserts.Type

export const TimelineView = Schema.Struct({
  looks: Schema.Array(Look),
  faces: Schema.Array(VideoFaces),
  pictures: Schema.Array(Schema.String),
  inserts: PlannedInserts,
  texts: PlannedTexts,
  doubts: PlannedDoubts.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ state: "none" as const }))),
  timeline: Schema.Union([
    Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
    Schema.Struct({ state: Schema.Literal("ready"), blocks: Schema.Array(Block), dropped: Schema.Int, edits: Edits, rest: PauseRest })
  ])
})
export type TimelineView = typeof TimelineView.Type

export const TimelinePage = Schema.Struct({ ...TimelineView.fields, gathering: Schema.Boolean, gatherFailed: Schema.Boolean })
export type TimelinePage = typeof TimelinePage.Type

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

export const samePause = (left: PauseRef, right: PauseRef): boolean => left.video === right.video && left.after === right.after

export const keptOf = (edits: Edits): ReadonlyArray<PauseRef> => edits.kept ?? []

// A word ends where the silence after it starts, so the stretch of a take runs to the next word of its video.
export const pausesOf = (transcript: Transcript, take: Take, edits: Edits): ReadonlyArray<Pause> =>
  transcript.words.slice(take.from, take.to + 1).flatMap((word, offset): ReadonlyArray<Pause> => {
    const after = take.from + offset
    const end = transcript.words[after + 1]?.start ?? transcript.duration
    if (end - word.end < MIN_PAUSE) return []
    return [{ after, start: word.end, end, removed: edits.pauses.some((pause) => samePause(pause, { video: take.video, after })) }]
  })

export const playedSpans = (transcript: Transcript, take: Take, edits: Edits, rest: number): ReadonlyArray<Span> => {
  const speech = speechOf(transcript, take) ?? { start: 0, end: 0 }
  const end = transcript.words[take.to + 1]?.start ?? transcript.duration
  const cuts = pausesOf(transcript, take, edits).filter((pause) => pause.removed).map((pause) =>
    pause.after === take.to
      ? { start: pause.start + rest, end: pause.end }
      : { start: pause.start + rest / 2, end: pause.end - rest / 2 })
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

export const playedPause = (one: Placed, pause: Pause): ReadonlyArray<Pause> =>
  one.spans.flatMap((span) => within([pause], span))

export const assemble = (blocks: ReadonlyArray<Block>, edits: Edits, transcripts: Transcripts, rest: number): ReadonlyArray<Placed> =>
  arrange(blocks, edits).placed.flatMap((block): ReadonlyArray<Placed> => {
    const take = chosenTake(block, edits)
    const transcript = transcripts.get(take.video)
    if (transcript === undefined) return []
    return [{ block, take, pauses: pausesOf(transcript, take, edits), spans: playedSpans(transcript, take, edits, rest) }]
  })

export const FADE = 0.06

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

// The part of the 9 by 16 picture the reel shows, enlarged by scale, in units of the picture height.
export const Frame = Schema.Struct({
  scale: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  left: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  top: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
})
export type Frame = typeof Frame.Type

export interface Clip extends Span {
  readonly video: string
  readonly block: string
  readonly frame?: Frame
}

export const clipsOf = (placed: ReadonlyArray<Placed>): ReadonlyArray<Clip> =>
  placed.flatMap((one) => one.spans.map((span) => ({ ...span, video: one.take.video, block: one.block.id })))

export const withChoice = (edits: Edits, block: string, take: Take): Edits => ({
  ...edits,
  chosen: [...edits.chosen.filter((chosen) => chosen.block !== block), { block, video: take.video, from: take.from }]
})

export const withDeleted = (edits: Edits, id: string, deleted: boolean): Edits => ({
  ...edits,
  deleted: deleted ? [...edits.deleted.filter((other) => other !== id), id] : edits.deleted.filter((other) => other !== id)
})

export const withPauses = (edits: Edits, pauses: ReadonlyArray<PauseRef>, removed: boolean): Edits => {
  const left = edits.pauses.filter((old) => !pauses.some((pause) => samePause(old, pause)))
  return { ...edits, pauses: removed ? [...left, ...pauses] : left }
}

export const withManualPauses = (edits: Edits, pauses: ReadonlyArray<PauseRef>, removed: boolean): Edits => {
  const withCut = withPauses(edits, pauses, removed)
  const keptNow = keptOf(edits).filter((old) => !pauses.some((pause) => samePause(old, pause)))
  return removed ? { ...withCut, kept: keptNow } : { ...withCut, kept: [...keptNow, ...pauses.filter((pause) => !keptNow.some((old) => samePause(old, pause)))] }
}

type Choice = Edits["chosen"][number]

const sameClipEdge = (left: typeof ClipEdge.Type, right: typeof ClipEdge.Type): boolean => left.video === right.video && left.at === right.at

const sameChoice = (left: Choice | undefined, right: Choice | undefined): boolean => {
  if (left === undefined || right === undefined) return left === right
  return left.video === right.video && left.from === right.from
}

export const mergeEdits = (base: Edits, local: Edits, current: Edits): Edits => {
  const mergeRefs = <Ref>(same: (left: Ref, right: Ref) => boolean) =>
    (mine: ReadonlyArray<Ref>, baseRefs: ReadonlyArray<Ref>, currentRefs: ReadonlyArray<Ref>): Array<Ref> => [
      ...currentRefs.filter((one) => !baseRefs.some((old) => same(old, one)) || mine.some((kept) => same(kept, one))),
      ...mine.filter((one) => !baseRefs.some((old) => same(old, one)) && !currentRefs.some((have) => same(have, one)))
    ]
  const mergePauses = mergeRefs(samePause)
  const sameEnds = (left: AnsweredJoin, right: AnsweredJoin): boolean =>
    sameClipEdge(left.end, right.end) && sameClipEdge(left.start, right.start)
  const ends: Array<AnsweredJoin> = []
  for (const one of [...current.joins, ...local.joins, ...base.joins]) {
    if (!ends.some((have) => sameEnds(have, one))) ends.push(one)
  }
  const answerOf = (list: ReadonlyArray<AnsweredJoin>, one: AnsweredJoin): string | undefined => {
    const found = list.find((have) => sameEnds(have, one))
    return found === undefined ? undefined : replyKey(found)
  }
  const joins = ends.flatMap((one): ReadonlyArray<AnsweredJoin> => {
    const picked = answerOf(base.joins, one) === answerOf(local.joins, one)
      ? current.joins.find((have) => sameEnds(have, one))
      : local.joins.find((have) => sameEnds(have, one))
    return picked === undefined ? [] : [picked]
  })
  const mergeAnswers = <Answer extends { readonly id: string }>(key: (answer: Answer) => string) =>
    (baseAnswers: ReadonlyArray<Answer>, localAnswers: ReadonlyArray<Answer>, currentAnswers: ReadonlyArray<Answer>): Array<Answer> => {
      const find = (list: ReadonlyArray<Answer>, id: string): Answer | undefined => list.find((one) => one.id === id)
      const same = (left: Answer | undefined, right: Answer | undefined): boolean =>
        left === undefined || right === undefined ? left === right : key(left) === key(right)
      return [...new Set([...baseAnswers, ...localAnswers, ...currentAnswers].map((one) => one.id))].flatMap((id) => {
        const entry = same(find(baseAnswers, id), find(localAnswers, id)) ? find(currentAnswers, id) : find(localAnswers, id)
        return entry === undefined ? [] : [entry]
      })
    }
  const inserts = mergeAnswers(insertKey)(base.inserts, local.inserts, current.inserts)
  const texts = mergeAnswers(textKey)(base.texts ?? [], local.texts ?? [], current.texts ?? [])
  const corrections = [...(base.subtitles ?? []), ...(local.subtitles ?? []), ...(current.subtitles ?? [])]
  const sameWord = (left: WordCorrection, right: WordCorrection): boolean =>
    left.block === right.block && left.video === right.video && left.index === right.index
  const keys = corrections.filter((one, index) => corrections.findIndex((other) => sameWord(one, other)) === index)
  const findWord = (list: ReadonlyArray<WordCorrection>, key: WordCorrection): WordCorrection | undefined => list.find((one) => sameWord(one, key))
  const subtitles = keys.flatMap((key) => {
    const before = findWord(base.subtitles ?? [], key)
    const mine = findWord(local.subtitles ?? [], key)
    const chosen = before?.text === mine?.text ? findWord(current.subtitles ?? [], key) : mine
    return chosen === undefined ? [] : [chosen]
  })
  const choiceOf = (list: ReadonlyArray<Choice>, block: string): Choice | undefined => list.find((one) => one.block === block)
  const blocks = [...new Set([...base.chosen, ...local.chosen, ...current.chosen].map((one) => one.block))]
  const reordered = base.order.length !== local.order.length || base.order.some((id, index) => local.order[index] !== id)
  return {
    order: reordered ? [...local.order] : [...current.order],
    deleted: mergeRefs((left: string, right: string) => left === right)(local.deleted, base.deleted, current.deleted),
    chosen: blocks.flatMap((block) => {
      const entry = sameChoice(choiceOf(base.chosen, block), choiceOf(local.chosen, block))
        ? choiceOf(current.chosen, block)
        : choiceOf(local.chosen, block)
      return entry === undefined ? [] : [entry]
    }),
    pauses: mergePauses(local.pauses, base.pauses, current.pauses),
    kept: mergePauses(local.kept ?? [], base.kept ?? [], current.kept ?? []),
    joins,
    inserts,
    ...(texts.length === 0 ? {} : { texts }),
    ...(subtitles.length === 0 ? {} : { subtitles })
  }
}
