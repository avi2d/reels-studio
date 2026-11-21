import type { Transcript } from "./plan.ts"
import type { AnsweredJoin, Clip, Edits, Head, JoinAnswer, VideoFaces } from "./timeline.ts"

export const JUMP_STEP = 0.08
export const AROUND_JOIN_SECONDS = 1.5

const SAME_MOMENT = 0.01
const HEAD_REACH = 0.4

export interface Join {
  readonly after: number
  readonly end: Clip
  readonly start: Clip
}

export const joinsOf = (clips: ReadonlyArray<Clip>): ReadonlyArray<Join> =>
  clips.flatMap((start, after): ReadonlyArray<Join> => {
    const end = clips[after - 1]
    if (end === undefined) return []
    if (end.video === start.video && Math.abs(start.start - end.end) < SAME_MOMENT) return []
    return [{ after, end, start }]
  })

export const headAt = (measured: VideoFaces, time: number, side: "before" | "after"): Head | undefined => {
  const reach = Math.floor(HEAD_REACH / measured.step + SAME_MOMENT)
  const nearest = side === "before" ? Math.floor(time / measured.step + SAME_MOMENT) : Math.ceil(time / measured.step - SAME_MOMENT)
  for (let offset = 0; offset <= reach; offset += 1) {
    const head = measured.heads[side === "before" ? nearest - offset : nearest + offset]
    if (head !== undefined && head !== null) return head
  }
  return undefined
}

export const headShift = (before: Head, after: Head): number =>
  Math.hypot(after.x - before.x, after.y - before.y, after.size - before.size) / ((before.size + after.size) / 2)

interface Edge { readonly video: string; readonly at: number }

const sameEdge = (left: Edge, right: Edge): boolean => left.video === right.video && Math.abs(left.at - right.at) < SAME_MOMENT

const isJoin = (answered: AnsweredJoin, join: Join): boolean =>
  sameEdge(answered.end, { video: join.end.video, at: join.end.end }) && sameEdge(answered.start, { video: join.start.video, at: join.start.start })

const answerAt = (edits: Edits, join: Join): JoinAnswer | undefined => edits.joins.find((answered) => isJoin(answered, join))?.answer

export interface Place {
  readonly join: Join
  readonly shift: number
  readonly trim: JoinTrim
  readonly answer: JoinAnswer | undefined
}

export const placesOf = (
  clips: ReadonlyArray<Clip>, faces: ReadonlyMap<string, VideoFaces>, transcripts: ReadonlyMap<string, Transcript>, edits: Edits
): ReadonlyArray<Place> =>
  joinsOf(clips).flatMap((join): ReadonlyArray<Place> => {
    const before = faces.get(join.end.video)
    const after = faces.get(join.start.video)
    const left = before === undefined ? undefined : headAt(before, join.end.end, "before")
    const right = after === undefined ? undefined : headAt(after, join.start.start, "after")
    if (left === undefined || right === undefined) return []
    const shift = headShift(left, right)
    if (shift <= JUMP_STEP) return []
    return [{ join, shift, trim: trimOf(join, faces, transcripts), answer: answerAt(edits, join) }]
  })

export const facesByVideo = (faces: ReadonlyArray<VideoFaces>): ReadonlyMap<string, VideoFaces> =>
  new Map(faces.map((one) => [one.video, one]))

const isOff = (faces: VideoFaces, index: number): boolean => {
  const look = faces.gaze[index]
  return look !== undefined && look !== "camera"
}

const offFrom = (faces: VideoFaces, from: number, to: number): number => {
  let index = Math.floor(to / faces.step + SAME_MOMENT)
  while (index * faces.step >= from && isOff(faces, index)) index -= 1
  return Math.max(from, Math.min(to, (index + 0.5) * faces.step))
}

const offUntil = (faces: VideoFaces, from: number, to: number): number => {
  let index = Math.ceil(from / faces.step - SAME_MOMENT)
  while (index * faces.step <= to && isOff(faces, index)) index += 1
  return Math.min(to, Math.max(from, (index - 0.5) * faces.step))
}

type Word = Transcript["words"][number]

const lastWordBefore = (transcript: Transcript, at: number): Word | undefined =>
  transcript.words.findLast((word) => word.start < at - SAME_MOMENT)

const firstWordAfter = (transcript: Transcript, at: number): Word | undefined =>
  transcript.words.find((word) => word.end > at + SAME_MOMENT)

interface JoinTrim {
  readonly end: number
  readonly start: number
  readonly cut: number
  readonly spoken: string | undefined
}

const untouched = (join: Join): JoinTrim => ({ end: join.end.end, start: join.start.start, cut: 0, spoken: undefined })

export const trimOf = (join: Join, faces: ReadonlyMap<string, VideoFaces>, transcripts: ReadonlyMap<string, Transcript>): JoinTrim => {
  const { end: before, start: after } = join
  const facesBefore = faces.get(before.video)
  const facesAfter = faces.get(after.video)
  const wordsBefore = transcripts.get(before.video)
  const wordsAfter = transcripts.get(after.video)
  if (facesBefore === undefined || facesAfter === undefined || wordsBefore === undefined || wordsAfter === undefined) return untouched(join)
  const said = lastWordBefore(wordsBefore, before.end)
  const saidEnd = said === undefined ? before.start : Math.min(said.end, before.end)
  const offBefore = offFrom(facesBefore, before.start, before.end)
  const next = firstWordAfter(wordsAfter, after.start)
  const nextStart = next === undefined ? after.end : Math.max(next.start, after.start)
  const offAfter = offUntil(facesAfter, after.start, after.end)
  const end = Math.max(saidEnd, offBefore)
  const start = Math.min(nextStart, offAfter)
  const cut = before.end - end + start - after.start
  const downInSaid = offBefore + facesBefore.step / 2 <= saidEnd + SAME_MOMENT
  const downInNext = offAfter - facesAfter.step / 2 >= nextStart - SAME_MOMENT
  const spoken = downInSaid ? said?.text : downInNext ? next?.text : undefined
  return cut <= SAME_MOMENT ? { ...untouched(join), spoken } : { end, start, cut, spoken }
}

export const trimmed = (
  clips: ReadonlyArray<Clip>, faces: ReadonlyMap<string, VideoFaces>, transcripts: ReadonlyMap<string, Transcript>, edits: Edits
): ReadonlyArray<Clip> => {
  const trims = new Map(joinsOf(clips).flatMap((join) => answerAt(edits, join) !== "trim" ? [] : [[join.after, trimOf(join, faces, transcripts)] as const]))
  return clips.map((clip, index) => ({ ...clip, start: trims.get(index)?.start ?? clip.start, end: trims.get(index + 1)?.end ?? clip.end }))
}

export const openPlaces = (places: ReadonlyArray<Place>): number => places.filter((place) => place.answer === undefined).length

export const withAnswer = (edits: Edits, join: Join, answer: JoinAnswer): Edits => ({
  ...edits,
  joins: [
    ...edits.joins.filter((answered) => !isJoin(answered, join)),
    { end: { video: join.end.video, at: join.end.end }, start: { video: join.start.video, at: join.start.start }, answer }
  ]
})

const lastSeconds = (clips: ReadonlyArray<Clip>, seconds: number): ReadonlyArray<Clip> => {
  const kept: Array<Clip> = []
  let left = seconds
  for (const clip of clips.toReversed()) {
    if (left <= 0) break
    const start = Math.max(clip.start, clip.end - left)
    kept.unshift({ ...clip, start })
    left -= clip.end - start
  }
  return kept
}

const firstSeconds = (clips: ReadonlyArray<Clip>, seconds: number): ReadonlyArray<Clip> => {
  const kept: Array<Clip> = []
  let left = seconds
  for (const clip of clips) {
    if (left <= 0) break
    const end = Math.min(clip.end, clip.start + left)
    kept.push({ ...clip, end })
    left -= end - clip.start
  }
  return kept
}

export const aroundJoin = (clips: ReadonlyArray<Clip>, join: Join, seconds: number): ReadonlyArray<Clip> =>
  [...lastSeconds(clips.slice(0, join.after), seconds), ...firstSeconds(clips.slice(join.after), seconds)]
