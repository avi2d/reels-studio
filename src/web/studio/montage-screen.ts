import type { ShownText } from "../../shared/captions.ts"
import { lookAt, type Shown } from "../../shared/inserts.ts"
import type { ShownWord } from "../../shared/subtitles.ts"
import { NO_EDITS, type Edits } from "../../shared/timeline.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { insertView, type InsertView } from "../insert-view.ts"
import type { Playing } from "../montage.ts"
import { montageSound, type MontageSound } from "../montage-sound.ts"
import type { Loaded } from "../timeline-draw.ts"
import type { Ticket } from "../timeline-save.ts"
import { paintSubtitle } from "../timeline-subtitles.ts"
import { icon } from "./icons.ts"
import type { Cut } from "./montage-model.ts"
import { button } from "./ui.ts"

const WATCH = "Смотреть с этой части"
const STOP = "Остановить"

export interface State {
  loaded: Loaded | undefined
  cut: Cut | undefined
  edits: Edits
  acked: Edits
  changes: number
  selected: string | undefined
  playing: Playing | undefined
  base: number | undefined
  shown: ReadonlyArray<Shown>
  overlay: ReadonlyArray<Shown>
  words: ReadonlyArray<ShownWord>
  drawn: string
  pending: { readonly loaded: Loaded; readonly ticket: Ticket } | undefined
}

export const freshState = (): State => ({
  loaded: undefined, cut: undefined, edits: NO_EDITS, acked: NO_EDITS, changes: 0, selected: undefined, playing: undefined,
  base: undefined, shown: [], overlay: [], words: [], drawn: "", pending: undefined
})

export interface Screen {
  readonly body: HTMLElement
  readonly figure: HTMLElement
  readonly asks: HTMLButtonElement
  readonly undo: HTMLButtonElement
  readonly redo: HTMLButtonElement
  readonly problem: HTMLElement
  readonly notes: HTMLElement
  readonly toast: HTMLElement
  readonly overlay: InsertView
  readonly subtitle: HTMLElement
  readonly thought: HTMLElement
  readonly sound: MontageSound
  readonly go: HTMLButtonElement
  readonly clock: HTMLElement
  readonly frame: HTMLElement
  readonly nav: HTMLElement
  readonly detail: HTMLElement
  readonly next: HTMLElement
  readonly work: HTMLElement
}

const iconButton = (name: "undo" | "redo", label: string): HTMLButtonElement =>
  h("button", { class: "btn btn--plain btn--icon", type: "button", title: label, "aria-label": label, disabled: true }, icon(name))

export const montageScreen = (projectId: string): Screen => {
  const parts = {
    figure: h("span", { class: "figure" }),
    asks: button("main", "", { hidden: true }),
    undo: iconButton("undo", "Отменить"),
    redo: iconButton("redo", "Повторить"),
    problem: h("p", { class: "error", role: "alert" }),
    notes: h("div", { class: "notes" }),
    toast: h("div", { class: "toast", role: "status" }),
    overlay: insertView(Api.insertUrls(projectId)),
    subtitle: h("div", { class: "subtitle-preview", "aria-hidden": "true" }),
    thought: h("div", { class: "thought-preview", "aria-hidden": "true" }),
    sound: montageSound(projectId),
    go: button("main", WATCH, {}, "play"),
    clock: h("span", { class: "clock" }),
    nav: h("div", { class: "parts-holder" }),
    detail: h("div", { class: "detail-holder" }),
    next: h("div", { class: "next" })
  }
  const frame = h("div", { class: "frame" }, parts.overlay.node, parts.thought, parts.subtitle)
  const work = h("div", { class: "montage", hidden: true },
    h("div", { class: "montage-viewer" }, frame, h("div", { class: "montage-viewer__bar" }, parts.go, parts.clock), parts.sound.node),
    parts.nav, parts.detail)
  const body = h("div", { class: "body body--montage" },
    h("div", { class: "head" },
      h("h1", { tabindex: "-1" }, "Монтаж ", parts.figure),
      h("div", { class: "head__acts" }, parts.asks, parts.undo, parts.redo)),
    parts.problem, parts.notes, parts.toast, work, parts.next)
  return { ...parts, frame, work, body }
}

const shownTexts = (cut: Cut | undefined): ReadonlyArray<ShownText> =>
  cut === undefined ? [] : [...cut.parts.flatMap((part) => part.texts), ...cut.outside.texts].flatMap(({ place }) => place.state === "shown" ? [place.shown] : [])

const paintThought = (node: HTMLElement, text: ShownText | undefined): void => {
  const id = text?.id ?? ""
  if (node.dataset.id === id) return
  node.dataset.id = id
  node.replaceChildren(...(text?.lines ?? []).map((line) => h("span", { class: line.accent ? "accent" : "context" }, line.text)))
}

const startOf = (cut: Cut | undefined, block: string | undefined): number =>
  cut?.parts.find((part) => part.one.block.id === block)?.start ?? 0

export const showClock = (screen: Screen, state: State): void => {
  const total = formatLength(state.cut?.length ?? 0)
  const { playing } = state
  if (playing === undefined) screen.clock.textContent = state.cut === undefined ? "" : `${formatLength(startOf(state.cut, state.selected))} / ${total}`
  else screen.clock.textContent = state.base === undefined ? formatLength(playing.elapsed) : `${formatLength(state.base + playing.elapsed)} / ${total}`
}

export const paintPlaying = (screen: Screen, state: State, playing: Playing | undefined): void => {
  const was = state.playing
  state.playing = playing
  screen.overlay.paint(playing === undefined ? undefined : lookAt(state.overlay, playing.elapsed))
  paintSubtitle(screen.subtitle, playing === undefined ? "" : state.words.find((word) => playing.elapsed >= word.start && playing.elapsed < word.end)?.text ?? "")
  const at = playing === undefined || state.base === undefined ? undefined : state.base + playing.elapsed
  paintThought(screen.thought, at === undefined ? undefined : shownTexts(state.cut).find((text) => at >= text.start && at < text.end))
  showClock(screen, state)
  if ((was === undefined) !== (playing === undefined)) screen.go.replaceChildren(icon(playing === undefined ? "play" : "stop"), playing === undefined ? WATCH : STOP)
  for (const part of screen.nav.querySelectorAll<HTMLElement>(".part")) part.classList.toggle("part--playing", part.dataset.key === `part:${playing?.clip.block ?? ""}`)
}
