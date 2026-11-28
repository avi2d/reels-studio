import { withText } from "../../shared/captions.ts"
import { aroundInsert, reelWithin, shiftedBy, withInsert, type Shown } from "../../shared/inserts.ts"
import { AROUND_JOIN_SECONDS, aroundJoin, withAnswer, withCover } from "../../shared/joins.ts"
import { lengthOf, type Span } from "../../shared/plan.ts"
import {
  arrange, playedSpans, withChoice, withDeleted, withManualPauses, within,
  type Block, type Clip, type Edits, type Take
} from "../../shared/timeline.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import type { EditHistory } from "../edit-history.ts"
import { correctSubtitle } from "../timeline-subtitles.ts"
import { withZoom } from "../../shared/zooms.ts"
import { zoomedReel } from "../../shared/montage-cut.ts"
import type { PartActions } from "./montage-part.ts"
import type { State } from "./montage-screen.ts"
import { button } from "./ui.ts"

const PAUSE_AROUND_SECONDS = 1.5
const ZOOM_BEFORE_SECONDS = 1.5
const ZOOM_AFTER_SECONDS = 3

const WORD_AROUND_SECONDS = 1

const wordWindow = (reel: ReadonlyArray<Clip>, block: string, video: string, word: Span): Span | undefined => {
  let at = 0
  for (const clip of reel) {
    if (clip.block === block && clip.video === video && word.end > clip.start && word.start < clip.end) {
      const start = at + Math.max(word.start, clip.start) - clip.start
      return { start: Math.max(0, start - WORD_AROUND_SECONDS), end: start + Math.min(word.end, clip.end) - Math.max(word.start, clip.start) + WORD_AROUND_SECONDS }
    }
    at += clip.end - clip.start
  }
  return undefined
}

// The full order keeps a removed part between its neighbours, so a part brought back returns to its place.
const movedOrder = (blocks: ReadonlyArray<Block>, edits: Edits, id: string, by: -1 | 1): ReadonlyArray<string> => {
  const order = arrange(blocks, { ...edits, deleted: [] }).placed.map((block) => block.id)
  const gone = new Set(edits.deleted)
  const from = order.indexOf(id)
  let to = from + by
  while (order[to] !== undefined && gone.has(order[to] ?? "")) to += by
  const target = order[to]
  if (from === -1 || target === undefined) return order
  const moved = order.filter((one) => one !== id)
  moved.splice(moved.indexOf(target) + (by === 1 ? 1 : 0), 0, id)
  return moved
}

const neighbourOf = (state: State, block: string): string | undefined => {
  const parts = state.cut?.parts ?? []
  const at = parts.findIndex((part) => part.one.block.id === block)
  return (parts[at + 1] ?? parts[at - 1])?.one.block.id
}

const takeClips = (state: State, block: string, take: Take): ReadonlyArray<Clip> => {
  const transcript = state.loaded?.transcripts.get(take.video)
  const timeline = state.loaded?.view.timeline
  return transcript === undefined || timeline?.state !== "ready" ? [] : playedSpans(transcript, take, state.edits, timeline.rest).map((span) => ({ ...span, video: take.video, block }))
}

export interface ActionsContext {
  readonly projectId: string
  readonly state: State
  readonly history: EditHistory
  readonly toast: HTMLElement
  readonly hear: (clips: ReadonlyArray<Clip>, shown: ReadonlyArray<Shown>) => void
}

const joinActions = ({ state, history, hear }: ActionsContext): Pick<PartActions, "hearJoin" | "hearUnaligned" | "answer" | "cover"> => ({
  hearJoin: (join) => {
    const reel = state.cut?.reel ?? []
    const from = Math.max(0, lengthOf(reel.slice(0, join.after)) - AROUND_JOIN_SECONDS)
    hear(aroundJoin(reel, join, AROUND_JOIN_SECONDS), shiftedBy(state.shown, from))
  },
  hearUnaligned: (join) => {
    const { loaded } = state
    const timeline = loaded?.view.timeline
    if (loaded === undefined || timeline?.state !== "ready") return
    const leave = withAnswer(state.edits, join, "leave")
    hear(aroundJoin(zoomedReel(loaded.view, timeline, loaded.transcripts, leave).clips, join, AROUND_JOIN_SECONDS), [])
  },
  answer: (join, answer) => { history.change(withAnswer(state.edits, join, answer)) },
  cover: (join, picture) => { history.change(withCover(state.edits, join, picture)) }
})

const blockActions = ({ state, history, toast }: ActionsContext): Pick<PartActions, "move" | "remove" | "restore"> => ({
  move: (block, by) => {
    const timeline = state.loaded?.view.timeline
    if (timeline?.state === "ready") history.change({ ...state.edits, order: [...movedOrder(timeline.blocks, state.edits, block, by)] })
  },
  remove: (block) => {
    const title = state.cut?.parts.find((part) => part.one.block.id === block)?.one.block.title ?? ""
    state.selected = neighbourOf(state, block) ?? block
    history.change(withDeleted(state.edits, block, true))
    toast.replaceChildren(h("span", {}, `Часть «${title}» убрана.`), button("plain", "Отменить", { click: history.undo }))
  },
  restore: (block) => { history.change(withDeleted(state.edits, block, false)) }
})

export const partActions = (context: ActionsContext): PartActions => {
  const { projectId, state, history, hear } = context
  const showAround = (span: Span): void => {
    const window = aroundInsert(span)
    hear(reelWithin(state.cut?.reel ?? [], window), shiftedBy(state.shown, window.start))
  }
  return {
    ...Api.insertUrls(projectId),
    ...joinActions(context),
    ...blockActions(context),
    choose: (block, take) => { history.change(withChoice(state.edits, block, take)) },
    hearTake: (block, take) => { hear(takeClips(state, block, take), []) },
    hearPause: (one, pause) => {
      hear(within(takeClips(state, one.block.id, one.take), { start: pause.start - PAUSE_AROUND_SECONDS, end: pause.end + PAUSE_AROUND_SECONDS }), [])
    },
    setPause: (video, after, removed) => { history.change(withManualPauses(state.edits, [{ video, after }], removed)) },
    fixWord: (block, video, index, text) => { history.change(correctSubtitle(state.edits, block, video, index, text)) },
    hearWord: (block, video, index) => {
      const reel = state.cut?.reel ?? []
      const word = state.loaded?.transcripts.get(video)?.words[index]
      const window = word === undefined ? undefined : wordWindow(reel, block, video, word)
      if (window !== undefined) hear(reelWithin(reel, window), shiftedBy(state.shown, window.start))
    },
    showInsert: showAround,
    answerInsert: (answer) => { history.change(withInsert(state.edits, answer)) },
    showText: showAround,
    answerText: (answer) => { history.change(withText(state.edits, answer)) },
    setZoom: (id, level) => { history.change(withZoom(state.edits, id, level)) },
    hearZoom: (place) => {
      const window = { start: Math.max(0, place.at - ZOOM_BEFORE_SECONDS), end: place.at + ZOOM_AFTER_SECONDS }
      hear(reelWithin(state.cut?.reel ?? [], window), shiftedBy(state.shown, window.start))
    }
  }
}
