import { Effect } from "effect"
import { lengthOf } from "../shared/plan.ts"
import {
  assemble, clipsOf, NO_EDITS, playedSpans, withChoice, withDeleted, withNeighbours, withPauses, within,
  type Clip, type Edits, type Placed, type Take
} from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { montage, type Playing } from "./montage.ts"
import {
  drawReady, frameOf, notesOf, partsOf, PLAY, refocus, startOf, STOP, textOf,
  type Actions, type Frame, type Hooks, type Loaded, type Panels, type Parts
} from "./timeline-draw.ts"
import { onKeys } from "./timeline-keys.ts"
import { POLL_MS, saver } from "./timeline-save.ts"

export type { Status } from "./timeline-draw.ts"

const AROUND_SECONDS = 2
const PAUSE_AROUND_SECONDS = 1.5

const placedOf = (loaded: Loaded | undefined, edits: Edits): ReadonlyArray<Placed> => {
  const view = loaded?.view.timeline
  return loaded === undefined || view?.state !== "ready" ? [] : assemble(view.blocks, edits, loaded.transcripts)
}

const takeClips = (loaded: Loaded | undefined, edits: Edits, block: string, take: Take): ReadonlyArray<Clip> => {
  const transcript = loaded?.transcripts.get(take.video)
  return transcript === undefined ? [] : playedSpans(transcript, take, edits).map((span) => ({ ...span, video: take.video, block }))
}

const neighbourOf = (placed: ReadonlyArray<Placed>, block: string): string | undefined => {
  const at = placed.findIndex((one) => one.block.id === block)
  return (placed[at + 1] ?? placed[at - 1])?.block.id
}

const clipsFrom = (clips: ReadonlyArray<Clip>, block: string): ReadonlyArray<Clip> => {
  const first = clips.findIndex((clip) => clip.block === block)
  return first === -1 ? [] : clips.slice(first)
}

const aroundClips = (placed: ReadonlyArray<Placed>, own: ReadonlyArray<Clip>, block: string): ReadonlyArray<Clip> =>
  withNeighbours(clipsOf(placed), block, own, AROUND_SECONDS)

interface State {
  loaded: Loaded | undefined
  edits: Edits
  history: Array<Edits>
  selected: string | undefined
  open: Placed | undefined
  base: number | undefined
  playing: Playing | undefined
  seen: string
}

const display = (parts: Parts, state: State) => {
  const placedNow = (): ReadonlyArray<Placed> => placedOf(state.loaded, state.edits)

  const showTag = (block: string | undefined): void => {
    const placed = placedNow()
    const index = placed.findIndex((one) => one.block.id === block)
    const one = placed[index]
    parts.tag.hidden = one === undefined
    if (one !== undefined) parts.tag.replaceChildren(h("b", {}, String(index + 1)), one.block.title)
  }

  const showClock = (): void => {
    const placed = placedNow()
    const total = formatLength(lengthOf(placed.flatMap((one) => one.spans)))
    const playing = state.playing
    if (playing === undefined) {
      const index = placed.findIndex((one) => one.block.id === state.open?.block.id)
      parts.clock.textContent = placed.length === 0 ? "" : `${formatLength(startOf(placed, Math.max(0, index)))} / ${total}`
    } else {
      parts.clock.textContent = state.base === undefined ? formatLength(playing.elapsed) : `${formatLength(state.base + playing.elapsed)} / ${total}`
    }
  }

  const markPlaying = (playing: Playing | undefined): void => {
    const before = state.playing?.clip.block
    state.playing = playing
    parts.play.textContent = playing === undefined ? PLAY : STOP
    parts.go.textContent = playing === undefined ? "▶" : "■"
    parts.go.setAttribute("aria-label", playing === undefined ? "Смотреть с этого блока" : STOP)
    showClock()
    const now = playing?.clip.block
    if (before === now) return
    showTag(now ?? state.open?.block.id)
    for (const item of parts.map.querySelectorAll<HTMLElement>(".map-item")) item.classList.toggle("playing", item.dataset.id === now)
    for (const slot of parts.rowHolder.querySelectorAll<HTMLElement>(".slot")) {
      const current = slot.dataset.id === now
      slot.classList.toggle("playing", current)
      if (current) slot.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }

  return { placedNow, showTag, showClock, markPlaying }
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
  parts.detailHolder.hidden = !isReady
  ui.notes.replaceChildren(...notesOf(loaded, hooks.ask))
  const drawn = timeline.state === "ready" && isReady
    ? drawReady(parts, { loaded, timeline, edits: state.edits, selected: state.selected }, actions)
    : undefined
  const open = drawn?.open
  state.open = open
  for (const button of [parts.play, parts.go, parts.around]) button.disabled = open === undefined
  if (open === undefined) for (const button of [parts.strip, parts.prev, parts.next]) button.disabled = true
  parts.undo.disabled = state.history.length === 0
  if (!isReady) parts.summary.textContent = ""
  const first = open?.spans[0]
  if (open !== undefined && first !== undefined) player.show({ ...first, video: open.take.video, block: open.block.id })
  view.showTag(open?.block.id)
  view.showClock()
  hooks.status({
    heard: loaded.transcripts.size,
    blocks: drawn === undefined ? undefined : view.placedNow().length,
    pauses: drawn?.status ?? { removed: 0, total: 0 }
  })
  refocus([ui.panels.tracks, ui.panels.takes, ui.panels.pauses], active)
}

const loader = (projectId: string, anchor: HTMLElement, show: (loaded: Loaded) => void): () => void => {
  const state = { timer: 0 }
  const later = (): void => {
    globalThis.clearTimeout(state.timer)
    state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }
  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!anchor.isConnected) return
    Effect.runFork(Effect.all([Api.getVideos(projectId), Api.getTimeline(projectId)], { concurrency: 2 }).pipe(
      Effect.map(([{ videos }, view]) => {
        const heard = videos.flatMap((video) => video.state === "ready" ? [[video.name, video.transcript] as const] : [])
        show({ transcripts: new Map(heard), view })
        if (videos.some((video) => video.state === "waiting") || view.looks.some((look) => look.state === "waiting")) later()
      }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }
  return refresh
}

export const timelineCard = (projectId: string, hooks: Hooks): { readonly panels: Panels; readonly refresh: () => void } => {
  const parts = partsOf()
  const ui = frameOf(parts)
  const state: State =
    { loaded: undefined, edits: NO_EDITS, history: [], selected: undefined, open: undefined, base: undefined, playing: undefined, seen: "" }
  const view = display(parts, state)
  const player = montage(projectId, view.markPlaying)
  ui.frame.prepend(player.node)
  const saving = saver(projectId, ui.problem, () => state.edits)
  const draw = (): void => { redraw({ parts, ui, state, view, player, hooks }, actions) }

  const hear = (clips: ReadonlyArray<Clip>): void => {
    state.base = undefined
    player.play(clips)
  }

  const watch = (from: string | undefined): void => {
    const clips = clipsOf(view.placedNow())
    const cut = from === undefined ? clips : clipsFrom(clips, from)
    state.base = lengthOf(clips) - lengthOf(cut)
    player.play(cut)
  }

  const apply = (edits: Edits): void => {
    player.stop()
    state.edits = edits
    draw()
    saving.save()
  }

  const change = (edits: Edits): void => {
    state.history.push(state.edits)
    apply(edits)
  }

  const undo = (): void => {
    const before = state.history.pop()
    if (before !== undefined) apply(before)
  }

  const select = (block: string): void => {
    player.stop()
    state.selected = block
    draw()
    parts.rowHolder.querySelector(".clip.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }

  const actions: Actions = {
    change,
    textOf: (take) => textOf(state.loaded?.transcripts ?? new Map(), take),
    select: (block) => {
      select(block)
      hooks.openTakes()
    },
    reorder: (blocks) => { change({ ...state.edits, order: [...blocks] }) },
    setPause: (video, after, removed) => { change(withPauses(state.edits, [{ video, after }], removed)) },
    choose: (block, take) => { change(withChoice(state.edits, block, take)) },
    hear: (block, take) => { hear(takeClips(state.loaded, state.edits, block, take)) },
    hearAround: (block, take) => { hear(aroundClips(view.placedNow(), takeClips(state.loaded, state.edits, block, take), block)) },
    hearPause: (one, pause) => {
      const window = { start: pause.start - PAUSE_AROUND_SECONDS, end: pause.end + PAUSE_AROUND_SECONDS }
      hear(within(takeClips(state.loaded, state.edits, one.block.id, one.take), window))
    },
    setDeleted: (block, deleted) => {
      state.selected = deleted && block === state.open?.block.id ? neighbourOf(view.placedNow(), block) : state.selected
      change(withDeleted(state.edits, block, deleted))
    }
  }

  const toggle = (from: string | undefined): void => {
    if (state.playing !== undefined) player.stop()
    else if (state.open !== undefined) watch(from)
  }
  parts.play.addEventListener("click", () => { toggle(undefined) })
  parts.go.addEventListener("click", () => { toggle(state.open?.block.id) })
  parts.undo.addEventListener("click", undo)
  parts.around.addEventListener("click", () => {
    const open = state.open
    if (open !== undefined) actions.hearAround(open.block.id, open.take)
  })
  onKeys(ui.panels.tracks, () => ({ placed: view.placedNow(), open: state.open }),
    { choose: actions.choose, setDeleted: actions.setDeleted, step: select, toggle: () => { toggle(state.open?.block.id) }, undo })

  const show = (loaded: Loaded): void => {
    const seen = JSON.stringify([loaded.view, [...loaded.transcripts.keys()]])
    if (seen === state.seen) return
    state.seen = seen
    state.loaded = loaded
    if (loaded.view.timeline.state === "ready" && !saving.busy()) state.edits = loaded.view.timeline.edits
    player.stop()
    draw()
  }

  return { panels: ui.panels, refresh: loader(projectId, ui.panels.tracks, show) }
}
