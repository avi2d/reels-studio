import type { AnsweredJoin, Clip, Edits, Head, JoinAnswer, VideoHeads } from "./timeline.ts"

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

export const headAt = (measured: VideoHeads, time: number, side: "before" | "after"): Head | undefined => {
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

export interface Place {
  readonly join: Join
  readonly shift: number
  readonly answer: JoinAnswer | undefined
}

export const placesOf = (clips: ReadonlyArray<Clip>, heads: ReadonlyMap<string, VideoHeads>, edits: Edits): ReadonlyArray<Place> =>
  joinsOf(clips).flatMap((join): ReadonlyArray<Place> => {
    const before = heads.get(join.end.video)
    const after = heads.get(join.start.video)
    const left = before === undefined ? undefined : headAt(before, join.end.end, "before")
    const right = after === undefined ? undefined : headAt(after, join.start.start, "after")
    if (left === undefined || right === undefined) return []
    const shift = headShift(left, right)
    if (shift <= JUMP_STEP) return []
    return [{ join, shift, answer: edits.joins.find((answered) => isJoin(answered, join))?.answer }]
  })

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
