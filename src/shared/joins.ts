import { framedHead, frameToward, inView } from "./framing.ts"
import type { Transcript } from "./plan.ts"
import { FADE, type AnsweredJoin, type Clip, type Edits, type Frame, type Head, type JoinAnswer, type JoinState, type VideoFaces } from "./timeline.ts"

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
    const at = (side === "before" ? nearest - offset : nearest + offset) * measured.step
    if (side === "before" ? time - at > HEAD_REACH + SAME_MOMENT : at - time > HEAD_REACH + SAME_MOMENT) break
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

const answeredAt = (edits: Edits, join: Join): AnsweredJoin | undefined => edits.joins.find((answered) => isJoin(answered, join))

const answerAt = (edits: Edits, join: Join): JoinState | undefined => answeredAt(edits, join)?.answer

const coverAt = (edits: Edits, join: Join): string | undefined => {
  const answered = answeredAt(edits, join)
  return answered?.answer === "cover" ? answered.picture : undefined
}

export interface Cover {
  readonly join: Join
  readonly picture: string
}

export const coversOf = (clips: ReadonlyArray<Clip>, edits: Edits, pictures: ReadonlyArray<string>): ReadonlyArray<Cover> =>
  joinsOf(clips).flatMap((join): ReadonlyArray<Cover> => {
    const picture = coverAt(edits, join)
    return picture === undefined || !pictures.includes(picture) ? [] : [{ join, picture }]
  })

type Align =
  | { readonly kind: "zoom"; readonly frame: Frame }
  | { readonly kind: "far" }
  | { readonly kind: "level" }
  | { readonly kind: "unmeasured" }

export interface Place {
  readonly join: Join
  readonly shift: number
  readonly trim: JoinTrim
  readonly align: Align
  readonly answer: JoinState | undefined
  readonly answered: AnsweredJoin | undefined
}



interface Seen { readonly head: Head; readonly measured: boolean }

const seenAt = (faces: VideoFaces | undefined, time: number, side: "before" | "after"): Seen | undefined => {
  const head = faces === undefined ? undefined : headAt(faces, time, side)
  if (head === undefined) return undefined
  return faces?.aspect === undefined ? { head, measured: false } : { head: inView(head, faces.aspect), measured: true }
}

const alignOf = (before: Head, after: Seen, measured: boolean): Align => {
  if (!measured) return { kind: "unmeasured" }
  const frame = frameToward(before, after.head)
  if (frame === undefined) return { kind: "far" }
  if (frame.scale < 1.005) return { kind: "level" }
  return { kind: "zoom", frame }
}

type Faces = ReadonlyMap<string, VideoFaces>
type Transcripts = ReadonlyMap<string, Transcript>

interface Pass {
  readonly frames: ReadonlyArray<Frame | undefined>
  readonly places: ReadonlyArray<Place>
}

// A frame holds until the next join, so the head before a join is seen through the frame an earlier join set.
const passOf = (clips: ReadonlyArray<Clip>, faces: Faces, transcripts: Transcripts, edits: Edits): Pass => {
  const starts = new Map(joinsOf(clips).map((join) => [join.after, join]))
  const places: Array<Place> = []
  const frameAfter = (join: Join, held: Frame | undefined): Frame | undefined => {
    const before = seenAt(faces.get(join.end.video), join.end.end, "before")
    const after = seenAt(faces.get(join.start.video), join.start.start, "after")
    if (before === undefined || after === undefined) return undefined
    const shown = framedHead(before.head, held)
    const shift = headShift(shown, after.head)
    if (shift <= JUMP_STEP) return undefined
    const align = alignOf(shown, after, before.measured && after.measured)
    const given = answerAt(edits, join)
    const answer = given === "zoom" && align.kind !== "zoom" ? undefined : given
    places.push({ join, shift, trim: trimOf(join, faces, transcripts), align, answer, answered: answeredAt(edits, join) })
    return answer === "zoom" && align.kind === "zoom" ? align.frame : undefined
  }
  const frames: Array<Frame | undefined> = []
  for (const [index] of clips.entries()) {
    const join = starts.get(index)
    frames.push(join === undefined ? frames.at(-1) : frameAfter(join, frames.at(-1)))
  }
  return { frames, places }
}

export const placesOf = (clips: ReadonlyArray<Clip>, faces: Faces, transcripts: Transcripts, edits: Edits): ReadonlyArray<Place> =>
  passOf(clips, faces, transcripts, edits).places

export const facesByVideo = (faces: ReadonlyArray<VideoFaces>): ReadonlyMap<string, VideoFaces> =>
  new Map(faces.map((one) => [one.video, one]))

const isOff = (faces: VideoFaces, index: number): boolean => {
  const look = faces.gaze[index]
  return look !== undefined && look !== "camera"
}

const offFrom = (faces: VideoFaces, from: number, to: number): number => {
  let index = Math.min(Math.floor(to / faces.step + SAME_MOMENT), faces.gaze.length - 1)
  if (index * faces.step < from - SAME_MOMENT || !isOff(faces, index)) return to
  while (index * faces.step >= from && isOff(faces, index)) index -= 1
  return Math.max(from, Math.min(to, (index + 0.5) * faces.step))
}

const offUntil = (faces: VideoFaces, from: number, to: number): number => {
  let index = Math.ceil(from / faces.step - SAME_MOMENT)
  if (!isOff(faces, index)) return from
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
  const end = said === undefined ? offBefore : Math.min(before.end, Math.max(saidEnd + FADE, offBefore))
  const start = next === undefined ? offAfter : Math.max(after.start, Math.min(nextStart - FADE, offAfter))
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

export const cutOf = (clips: ReadonlyArray<Clip>, faces: Faces, transcripts: Transcripts, edits: Edits): ReadonlyArray<Clip> => {
  const { frames } = passOf(clips, faces, transcripts, edits)
  const framed = clips.map((clip, index) => {
    const frame = frames[index]
    return frame === undefined ? clip : { ...clip, frame }
  })
  return trimmed(framed, faces, transcripts, edits)
}

export const openPlaces = (places: ReadonlyArray<Place>): number => places.filter((place) => place.answer === undefined).length

const endsOf = (join: Join) => ({ end: { video: join.end.video, at: join.end.end }, start: { video: join.start.video, at: join.start.start } })

export const withAnswer = (edits: Edits, join: Join, answer: JoinAnswer): Edits => ({
  ...edits,
  joins: [...edits.joins.filter((answered) => !isJoin(answered, join)), { ...endsOf(join), answer }]
})

export const withCover = (edits: Edits, join: Join, picture: string): Edits => ({
  ...edits,
  joins: [...edits.joins.filter((answered) => !isJoin(answered, join)), { ...endsOf(join), answer: "cover", picture }]
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
