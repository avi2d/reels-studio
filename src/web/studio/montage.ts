import { mergeEdits } from "../../shared/timeline.ts"
import { editHistory } from "../edit-history.ts"
import { montage } from "../montage.ts"
import type { Loaded } from "../timeline-draw.ts"
import { loader } from "../timeline-load.ts"
import { saver, takeServer, type Ticket } from "../timeline-save.ts"
import { playback } from "../timeline-subtitles.ts"
import type { StudioChat } from "./chat.ts"
import { partActions } from "./montage-actions.ts"
import { drawMontage, type Drawing } from "./montage-draw.ts"
import { onMontageKeys } from "./montage-keys.ts"
import { nextAsking } from "./montage-model.ts"
import { freshState, montageScreen, paintPlaying, type Screen, type State } from "./montage-screen.ts"

const GATHER = "Собери блоки из всех видео и расставь дубли от лучшего к худшему."

export interface MontageStep {
  readonly body: HTMLElement
  readonly dispose: () => void
}

const isEditingWord = (screen: Screen): boolean => screen.detail.querySelector(".word-field") !== null

// A redraw while a word field is open would throw away what the person is typing, so a load waits until the field closes.
const shower = (screen: Screen, state: State, busy: () => boolean, draw: () => void) => {
  const show = (loaded: Loaded, ticket: Ticket): void => {
    if (isEditingWord(screen)) {
      state.pending = { loaded, ticket }
      return
    }
    const { timeline } = loaded.view
    if (timeline.state === "ready" && takeServer(state.edits, state.acked, timeline.edits, ticket, state.changes, busy())) {
      state.edits = timeline.edits
      state.acked = timeline.edits
    }
    state.loaded = loaded
    const drawn = JSON.stringify([loaded.view, [...loaded.transcripts.keys()], state.edits])
    if (drawn === state.drawn) return
    state.drawn = drawn
    draw()
  }
  const showPending = (): void => {
    const deferred = state.pending
    if (deferred === undefined || isEditingWord(screen)) return
    state.pending = undefined
    show(deferred.loaded, deferred.ticket)
  }
  return { show, showPending }
}

const walkQuestions = (screen: Screen, state: State, select: (block: string) => void): void => {
  const cut = state.cut
  const next = cut === undefined ? undefined : nextAsking(cut.questions, cut.parts, state.selected)
  if (next === undefined) return
  select(next)
  const ask = screen.detail.querySelector<HTMLElement>(".ask--open")
  ask?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  ask?.focus({ preventScroll: true })
}

export const montageStep = (projectId: string, chat: StudioChat): MontageStep => {
  const state = freshState()
  const screen = montageScreen(projectId)
  const player = montage(projectId, (playing) => { paintPlaying(screen, state, playing) }, screen.sound.dbAt,
    (video) => state.loaded?.view.faces.find((faces) => faces.video === video))
  screen.frame.prepend(player.node)
  const { hear, watch } = playback(state, () => state.cut?.reel ?? [], player)
  const draw = (): void => { drawMontage(drawing) }
  const saving = saver(projectId, screen.problem, () => state.edits, () => state.acked, (sent, merged) => {
    state.acked = merged
    state.edits = mergeEdits(sent, state.edits, merged)
    state.changes += 1
    draw()
  })
  const history = editHistory(() => state.edits, (edits) => {
    player.stop()
    screen.toast.replaceChildren()
    state.edits = edits
    state.changes += 1
    saving.save()
    draw()
  })
  const select = (block: string): void => {
    player.stop()
    state.selected = block
    draw()
  }
  const loads = shower(screen, state, saving.busy, () => {
    draw()
    loads.showPending()
  })
  const refresh = loader(projectId, screen.body, loads.show, () => ({ changes: state.changes, busy: saving.busy() }))
  const gather = (): void => { if (!chat.ask({ text: GATHER, finish: refresh })) chat.open() }
  const actions = partActions({ projectId, state, history, toast: screen.toast, hear })
  const drawing: Drawing = { projectId, screen, state, history, actions, player, select, gather }
  const toggle = (): void => {
    if (state.playing !== undefined) player.stop()
    else if (state.selected !== undefined && state.cut?.parts.some((part) => part.one.block.id === state.selected) === true) watch(state.selected)
  }
  screen.go.addEventListener("click", toggle)
  screen.asks.addEventListener("click", () => { walkQuestions(screen, state, select) })
  screen.undo.addEventListener("click", history.undo)
  screen.redo.addEventListener("click", history.redo)
  screen.detail.addEventListener("focusout", () => { globalThis.setTimeout(loads.showPending, 0) })
  const stopKeys = onMontageKeys({ toggle, undo: history.undo })
  // The loader stops once its anchor leaves the page, so the first load waits until the caller has put the body on the page.
  queueMicrotask(() => {
    refresh()
    screen.sound.refresh()
  })
  return {
    body: screen.body,
    dispose: () => {
      stopKeys()
      player.stop()
      void saving.flush()
    }
  }
}
