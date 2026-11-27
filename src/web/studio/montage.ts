import { mergeEdits } from "../../shared/timeline.ts"
import { editHistory } from "../edit-history.ts"
import { montage } from "../montage.ts"
import type { Loaded } from "../timeline-draw.ts"
import { adoptLoaded, loader } from "../timeline-load.ts"
import { saver, type Ticket } from "../timeline-save.ts"
import { playback } from "../timeline-subtitles.ts"
import type { StudioChat } from "./chat.ts"
import { partActions } from "./montage-actions.ts"
import { drawMontage, drawUndo, type Drawing } from "./montage-draw.ts"
import { onMontageKeys } from "./montage-keys.ts"
import { nextAsking, questionKey } from "./montage-model.ts"
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
    if (adoptLoaded(state, loaded, ticket, busy())) draw()
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
  const next = cut === undefined ? undefined : nextAsking(cut.questions, state.lastQuestion)
  if (next === undefined) return
  const key = questionKey(next)
  state.lastQuestion = key
  select(next.part)
  const ask = [...screen.detail.querySelectorAll<HTMLElement>("[data-ask]")].find((node) => node.dataset.ask === key)
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
  let redrawPending = false
  let pressing = false
  // A redraw between a press and its release detaches the pressed control, so the browser sends the click nowhere.
  const draw = (): void => {
    if (pressing || isEditingWord(screen)) {
      redrawPending = true
      drawUndo(drawing)
      return
    }
    redrawPending = false
    drawMontage(drawing)
  }
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
  const loads = shower(screen, state, saving.busy, draw)
  const refresh = loader(projectId, screen.body, loads.show, () => ({ changes: state.changes, busy: saving.busy() }))
  const gather = (): void => { if (!chat.ask({ text: GATHER, finish: refresh })) chat.open() }
  const actions = partActions({ projectId, state, history, toast: screen.toast, hear })
  const drawing: Drawing = { projectId, screen, state, history, actions, player, select, gather }
  const toggle = (): void => {
    if (state.playing !== undefined) player.stop()
    else if (state.selected !== undefined && state.cut?.parts.some((part) => part.one.block.id === state.selected) === true) watch(state.selected)
  }
  screen.go.addEventListener("click", toggle)
  screen.asks.addEventListener("click", () => {
    globalThis.setTimeout(() => { walkQuestions(screen, state, select) }, 0)
  })
  screen.undo.addEventListener("click", history.undo)
  screen.redo.addEventListener("click", history.redo)
  const drawDeferred = (): void => {
    loads.showPending()
    if (redrawPending) draw()
  }
  screen.detail.addEventListener("focusout", () => { globalThis.setTimeout(drawDeferred, 0) })
  screen.body.addEventListener("pointerdown", () => { pressing = true })
  const release = (): void => {
    if (!pressing) return
    globalThis.setTimeout(() => {
      pressing = false
      drawDeferred()
    }, 0)
  }
  document.addEventListener("pointerup", release, true)
  document.addEventListener("pointercancel", release, true)
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
      document.removeEventListener("pointerup", release, true)
      document.removeEventListener("pointercancel", release, true)
      player.stop()
      void saving.flush()
    }
  }
}
