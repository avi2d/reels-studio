import { Effect } from "effect"
import { aroundInsert, insertPlaces, lookAt, reelWithin, shiftedBy, shownInserts, withInsert, type InsertLook, type Shown } from "../shared/inserts.ts"
import { AROUND_JOIN_SECONDS, aroundJoin, cutOf, facesByVideo, withAnswer, withCover } from "../shared/joins.ts"
import { lengthOf } from "../shared/plan.ts"
import { faceLeft } from "../shared/framing.ts"
import type { ShownWord } from "../shared/subtitles.ts"
import {
  assemble, clipsOf, mergeEdits, NO_EDITS, playedSpans, withChoice, withDeleted, withManualPauses, within,
  type Clip, type Edits, type Placed, type Take
} from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { icon } from "./controls.ts"
import { insertView } from "./insert-view.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { montage, type LevelAt, type Playing } from "./montage.ts"
import {
  drawReady, frameOf, GO, notesOf, partsOf, refocus, STOP, textOf,
  type Actions, type Frame, type Hooks, type Loaded, type Panels, type Parts
} from "./timeline-draw.ts"
import { onKeys } from "./timeline-keys.ts"
import { POLL_MS, saver, takeServer, type Ticket } from "./timeline-save.ts"
import { correctSubtitle, editableSubtitles, paintSubtitle, playback } from "./timeline-subtitles.ts"

export type { Status } from "./timeline-draw.ts"

const PAUSE_AROUND_SECONDS = 1.5

const placedOf = (loaded: Loaded | undefined, edits: Edits): ReadonlyArray<Placed> => {
  const view = loaded?.view.timeline
  return loaded === undefined || view?.state !== "ready" ? [] : assemble(view.blocks, edits, loaded.transcripts, view.rest)
}

const takeClips = (loaded: Loaded | undefined, edits: Edits, block: string, take: Take): ReadonlyArray<Clip> => {
  const transcript = loaded?.transcripts.get(take.video)
  const view = loaded?.view.timeline
  return transcript === undefined || view?.state !== "ready" ? [] : playedSpans(transcript, take, edits, view.rest).map((span) => ({ ...span, video: take.video, block }))
}

const neighbourOf = (placed: ReadonlyArray<Placed>, block: string): string | undefined => {
  const at = placed.findIndex((one) => one.block.id === block)
  return (placed[at + 1] ?? placed[at - 1])?.block.id
}

export { takeServer, type Ticket }

const reelOf = (loaded: Loaded, edits: Edits): ReadonlyArray<Clip> =>
  cutOf(clipsOf(placedOf(loaded, edits)), facesByVideo(loaded.view.faces), loaded.transcripts, edits)

const shownOf = (loaded: Loaded, edits: Edits): ReadonlyArray<Shown> => {
  const reel = reelOf(loaded, edits)
  const planned = loaded.view.inserts.state === "ready" ? loaded.view.inserts.planned : []
  return shownInserts(insertPlaces(planned, reel, loaded.transcripts, edits, loaded.view.pictures), reel, edits, loaded.view.pictures)
}

export const playedKey = (loaded: Loaded, edits: Edits): string => {
  const reel = reelOf(loaded, edits)
  const crops = [...new Set(reel.map((clip) => clip.video))].map((video) => {
    const faces = loaded.view.faces.find((one) => one.video === video)
    return faces?.aspect === undefined ? undefined : faceLeft(faces.heads, faces.aspect)
  })
  return JSON.stringify([reel, shownOf(loaded, edits), crops])
}

interface State {
  loaded: Loaded | undefined
  edits: Edits
  acked: Edits
  changes: number
  history: Array<{ readonly before: Edits; readonly after: Edits }>
  undone: Array<{ readonly before: Edits; readonly after: Edits }>
  selected: string | undefined
  open: Placed | undefined
  base: number | undefined
  playing: Playing | undefined
  shown: ReadonlyArray<Shown>
  overlay: ReadonlyArray<Shown>
  words: ReadonlyArray<ShownWord>
  drawn: string
  content: string
  pending: { readonly loaded: Loaded; readonly ticket: Ticket } | undefined
}

const revealWithinStrip = (root: HTMLElement, selector: string): void => {
  const item = root.querySelector(selector)
  const strip = item?.closest(".map, .blocks")
  if (!item || !strip) return
  const { left, right } = item.getBoundingClientRect()
  const bounds = strip.getBoundingClientRect()
  if (left < bounds.left) strip.scrollLeft += left - bounds.left
  else if (right > bounds.right) strip.scrollLeft += right - bounds.right
}

const display = (parts: Parts, state: State, paint: (look: InsertLook | undefined) => void, subtitle: HTMLElement) => {
  const placedNow = (): ReadonlyArray<Placed> => placedOf(state.loaded, state.edits)
  const reelNow = (): ReadonlyArray<Clip> => state.loaded === undefined ? [] : reelOf(state.loaded, state.edits)

  const showTag = (block: string | undefined): void => {
    const placed = placedNow()
    const index = placed.findIndex((one) => one.block.id === block)
    const one = placed[index]
    parts.tag.hidden = one === undefined
    if (one !== undefined) parts.tag.replaceChildren(h("b", {}, String(index + 1)), one.block.title)
  }

  const showClock = (): void => {
    const reel = reelNow()
    const total = formatLength(lengthOf(reel))
    const playing = state.playing
    if (playing === undefined) {
      const at = state.open === undefined ? 0 : reel.findIndex((clip) => clip.block === state.open?.block.id)
      const start = at === -1 ? 0 : lengthOf(reel.slice(0, at))
      parts.clock.textContent = reel.length === 0 ? "" : `${formatLength(start)} / ${total}`
    } else {
      parts.clock.textContent = state.base === undefined ? formatLength(playing.elapsed) : `${formatLength(state.base + playing.elapsed)} / ${total}`
    }
  }

  const paintPlaying = (): void => {
    const now = state.playing?.clip.block
    showTag(now ?? state.open?.block.id)
    for (const item of parts.map.querySelectorAll<HTMLElement>(".map-item")) item.classList.toggle("playing", item.dataset.id === now)
    for (const slot of parts.rowHolder.querySelectorAll<HTMLElement>(".slot")) slot.classList.toggle("playing", slot.dataset.id === now)
  }

  const markPlaying = (playing: Playing | undefined): void => {
    const before = state.playing?.clip.block
    state.playing = playing
    paint(playing === undefined ? undefined : lookAt(state.overlay, playing.elapsed))
    paintSubtitle(subtitle, playing === undefined ? "" : state.words.find((word) => playing.elapsed >= word.start && playing.elapsed < word.end)?.text ?? "")
    showClock()
    const now = playing?.clip.block
    if (before === now) return
    if (before === undefined || now === undefined) {
      const label = playing === undefined ? GO : STOP
      parts.go.replaceChildren(icon(playing === undefined ? "play" : "stop", label))
      parts.goTip.textContent = label
    }
    paintPlaying()
    revealWithinStrip(parts.map, ".playing")
    revealWithinStrip(parts.rowHolder, ".slot.playing")
  }

  return { placedNow, reelNow, showTag, showClock, markPlaying, paintPlaying }
}

interface Desk {
  readonly parts: Parts
  readonly ui: Frame
  readonly state: State
  readonly view: ReturnType<typeof display>
  readonly player: ReturnType<typeof montage>
  readonly hooks: Hooks
}

const redraw = ({ hooks, parts, player, state, ui, view }: Desk, actions: Actions): void => {
  const loaded = state.loaded
  if (loaded === undefined) return
  const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined
  const { timeline } = loaded.view
  const isReady = timeline.state === "ready" && loaded.transcripts.size > 0
  ui.ready.hidden = !isReady
  ui.overview.hidden = !isReady
  ui.empty.hidden = isReady
  ui.noPauses.hidden = isReady
  parts.pauseHolder.hidden = !isReady
  parts.placeHolder.hidden = !isReady
  parts.strip.hidden = !isReady
  parts.detailHolder.hidden = !isReady
  ui.notes.replaceChildren(...notesOf(loaded, hooks.ask))
  const drawn = timeline.state === "ready" && isReady
    ? drawReady(parts, { loaded, timeline, edits: state.edits, selected: state.selected }, actions)
    : undefined
  const open = drawn?.open
  state.open = open
  state.shown = drawn?.shown ?? []
  parts.go.disabled = open === undefined
  if (open === undefined) for (const button of [parts.strip, parts.prev, parts.next]) button.disabled = true
  parts.undo.disabled = state.history.length === 0
  parts.redo.disabled = state.undone.length === 0
  if (!isReady) parts.summary.textContent = ""
  const first = open === undefined ? undefined : view.reelNow().find((clip) => clip.block === open.block.id)
  if (first !== undefined) player.show(first)
  if (state.playing === undefined) view.showTag(open?.block.id)
  else view.paintPlaying()
  view.showClock()
  hooks.status({
    heard: loaded.transcripts.size,
    blocks: drawn === undefined ? undefined : view.placedNow().length,
    pauses: drawn?.status.pauses ?? { removed: 0, total: 0 },
    places: drawn?.status.places ?? 0,
    placesComplete: drawn?.status.placesComplete ?? false
  })
  refocus([ui.panels.viewer, ui.panels.tracks, ui.panels.takes, ui.panels.pauses], active)
}

const loader = (projectId: string, anchor: HTMLElement, show: (loaded: Loaded, ticket: Ticket) => void, stamp: () => Ticket): () => void => {
  const state = { timer: 0 }
  const later = (): void => {
    globalThis.clearTimeout(state.timer)
    state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }
  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!anchor.isConnected) return
    const ticket = stamp()
    Effect.runFork(Effect.all([Api.getVideos(projectId), Api.getTimeline(projectId)], { concurrency: 2 }).pipe(
      Effect.map(([{ videos }, view]) => {
        const heard = videos.flatMap((video) => video.state === "ready" ? [[video.name, video.transcript] as const] : [])
        show({ transcripts: new Map(heard), view }, ticket)
        if (view.gathering || videos.some((video) => video.state === "waiting") || view.looks.some((look) => look.state === "waiting")) later()
      }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }
  return refresh
}

interface Card {
  readonly projectId: string
  readonly parts: Parts
  readonly ui: Frame
  readonly state: State
  readonly view: ReturnType<typeof display>
  readonly player: ReturnType<typeof montage>
  readonly saving: ReturnType<typeof saver>
  readonly hooks: Hooks
}

const actionsOf = (
  card: Card,
  change: (edits: Edits) => void,
  hear: (clips: ReadonlyArray<Clip>, overlay: ReadonlyArray<Shown>) => void,
  select: (block: string) => void
): Actions => {
  const { hooks, projectId, state, view } = card
  return {
    change,
    subtitlesOf: (one) => editableSubtitles(state.loaded, state.edits, one),
    correctSubtitle: (block, video, index, text) => { change(correctSubtitle(state.edits, block, video, index, text)) },
    textOf: (take) => textOf(state.loaded?.transcripts ?? new Map(), take),
    select: (block) => {
      select(block)
      hooks.openTakes()
    },
    reorder: (blocks) => { change({ ...state.edits, order: [...blocks] }) },
    setPause: (video, after, removed) => { change(withManualPauses(state.edits, [{ video, after }], removed)) },
    choose: (block, take) => { change(withChoice(state.edits, block, take)) },
    hear: (block, take) => { hear(takeClips(state.loaded, state.edits, block, take), []) },
    hearPause: (one, pause) => {
      const window = { start: pause.start - PAUSE_AROUND_SECONDS, end: pause.end + PAUSE_AROUND_SECONDS }
      hear(within(takeClips(state.loaded, state.edits, one.block.id, one.take), window), [])
    },
    hearJoin: (join) => {
      const reel = view.reelNow()
      const from = Math.max(0, lengthOf(reel.slice(0, join.after)) - AROUND_JOIN_SECONDS)
      hear(aroundJoin(reel, join, AROUND_JOIN_SECONDS), shiftedBy(state.shown, from))
    },
    hearUnaligned: (join) => {
      if (state.loaded !== undefined) hear(aroundJoin(reelOf(state.loaded, withAnswer(state.edits, join, "leave")), join, AROUND_JOIN_SECONDS), [])
    },
    answer: (join, answer) => { change(withAnswer(state.edits, join, answer)) },
    cover: (join, picture) => { change(withCover(state.edits, join, picture)) },
    showInsert: (span) => {
      const window = aroundInsert(span)
      hear(reelWithin(view.reelNow(), window), shiftedBy(state.shown, window.start))
    },
    answerInsert: (answer) => { change(withInsert(state.edits, answer)) },
    ...Api.insertUrls(projectId),
    ask: hooks.ask,
    setDeleted: (block, deleted) => {
      state.selected = deleted && block === state.open?.block.id ? neighbourOf(view.placedNow(), block) : state.selected
      change(withDeleted(state.edits, block, deleted))
    }
  }
}

const showLoaded = (card: Card, draw: () => void, loaded: Loaded, ticket: Ticket): void => {
  const { parts, player, saving, state } = card
  if (parts.rowHolder.querySelector(".slot.dragging") !== null) {
    state.pending = { loaded, ticket }
    state.loaded = loaded
    return
  }
  const timeline = loaded.view.timeline
  if (timeline.state === "ready" && takeServer(state.edits, state.acked, timeline.edits, ticket, state.changes, saving.busy())) {
    state.edits = timeline.edits
    state.acked = timeline.edits
  }
  state.loaded = loaded
  const drawn = JSON.stringify([loaded.view, [...loaded.transcripts.keys()], state.edits])
  if (drawn === state.drawn) return
  state.drawn = drawn
  const content = playedKey(loaded, state.edits)
  const changed = content !== state.content
  state.content = content
  if (changed) player.stop()
  draw()
}

export const timelineCard = (projectId: string, hooks: Hooks, levelAt: LevelAt): { readonly panels: Panels; readonly refresh: () => void; readonly stop: () => void; readonly flush: () => Promise<boolean>; readonly busy: () => boolean } => {
  const parts = partsOf()
  const ui = frameOf(parts)
  const state: State =
    { loaded: undefined, edits: NO_EDITS, acked: NO_EDITS, changes: 0, history: [], undone: [], selected: undefined, open: undefined, base: undefined, playing: undefined, shown: [], overlay: [], words: [], drawn: "", content: "", pending: undefined }
  const overlay = insertView(Api.insertUrls(projectId))
  const subtitle = h("div", { class: "subtitle-preview", "aria-hidden": "true" })
  const view = display(parts, state, overlay.paint, subtitle)
  const player = montage(projectId, view.markPlaying, levelAt, (video) => state.loaded?.view.faces.find((faces) => faces.video === video))
  ui.frame.prepend(player.node, overlay.node, subtitle)
  const saving = saver(projectId, ui.problem, () => state.edits, () => state.acked, (sent, merged) => {
    state.acked = merged
    state.edits = mergeEdits(sent, state.edits, merged)
    state.changes += 1
    if (state.loaded !== undefined) {
      const content = playedKey(state.loaded, state.edits)
      if (content !== state.content) {
        state.content = content
        player.stop()
      }
    }
    draw()
  }, (ok) => { hooks.settled?.(ok) })
  const card: Card = { projectId, parts, ui, state, view, player, saving, hooks }
  const draw = (): void => {
    redraw({ parts, ui, state, view, player, hooks }, actions)
    const deferred = state.pending
    if (deferred === undefined) return
    state.pending = undefined
    show(deferred.loaded, deferred.ticket)
  }

  const { hear, watch } = playback(state, view.reelNow, player)

  const apply = (edits: Edits): void => {
    player.stop()
    state.edits = edits
    state.changes += 1
    if (state.loaded !== undefined) state.content = playedKey(state.loaded, edits)
    saving.save()
    hooks.edited?.()
    draw()
  }

  const change = (edits: Edits): void => {
    state.history.push({ before: state.edits, after: edits })
    state.undone.length = 0
    apply(edits)
  }

  const undo = (): void => {
    const step = state.history.pop()
    if (step === undefined) return
    state.undone.push(step)
    apply(mergeEdits(step.after, step.before, state.edits))
  }

  const redo = (): void => {
    const step = state.undone.pop()
    if (step === undefined) return
    state.history.push(step)
    apply(mergeEdits(step.before, step.after, state.edits))
  }

  const select = (block: string): void => {
    player.stop()
    state.selected = block
    draw()
    revealWithinStrip(parts.map, ".selected")
    revealWithinStrip(parts.rowHolder, ".clip.selected")
  }

  const actions: Actions = actionsOf(card, change, hear, select)

  const toggle = (): void => {
    if (state.playing !== undefined) player.stop()
    else if (state.open !== undefined) watch(state.open.block.id)
  }
  parts.rowHolder.addEventListener("focusout", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.closest(".subtitle-row") !== null) {
      globalThis.setTimeout(() => { if (parts.rowHolder.isConnected) draw() }, 0)
    }
  })
  parts.go.addEventListener("click", toggle)
  parts.undo.addEventListener("click", undo)
  parts.redo.addEventListener("click", redo)
  onKeys(ui.panels.tracks, () => ({ placed: view.placedNow(), open: state.open }),
    { choose: actions.choose, setDeleted: actions.setDeleted, step: select, toggle, undo },
    () => hooks.active?.() ?? true)

  const show = (loaded: Loaded, ticket: Ticket): void => {
    showLoaded(card, draw, loaded, ticket)
  }

  return { panels: ui.panels, refresh: loader(projectId, ui.panels.tracks, show, () => ({ changes: state.changes, busy: saving.busy() })), stop: player.stop, flush: saving.flush, busy: saving.busy }
}
