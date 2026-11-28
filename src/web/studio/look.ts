import { lookAt, type Shown } from "../../shared/inserts.ts"
import { stepPath } from "../../shared/page.ts"
import type { ShownWord } from "../../shared/subtitles.ts"
import { NO_EDITS, type Edits } from "../../shared/timeline.ts"
import { FRAME, textAreaOf } from "../../shared/zones.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { insertView } from "../insert-view.ts"
import { montage, type Playing } from "../montage.ts"
import { montageSound } from "../montage-sound.ts"
import type { Loaded } from "../timeline-draw.ts"
import { loader } from "../timeline-load.ts"
import { playback } from "../timeline-subtitles.ts"
import { icon } from "./icons.ts"
import { lookFace } from "./look-face.ts"
import { lookMargins } from "./look-margins.ts"
import { lookNoise } from "./look-noise.ts"
import { lookSubtitles } from "./look-subtitles.ts"
import { cutOfPage, type Cut } from "./montage-model.ts"
import { paintThought, shownTexts } from "./montage-screen.ts"
import { button } from "./ui.ts"

const WATCH = "Смотреть ролик"
const STOP = "Остановить"
const COLOUR = "Студия сама подгонит цвет кожи во всех видео к первому видео с лицом."
const EMPTY = "В ролике пока нет ни одной части. Соберите его на шаге «Монтаж»."

export interface LookStep {
  readonly body: HTMLElement
  readonly dispose: () => void
}

interface State {
  loaded: Loaded | undefined
  cut: Cut | undefined
  drawn: string
  edits: Edits
  base: number | undefined
  shown: ReadonlyArray<Shown>
  overlay: ReadonlyArray<Shown>
  words: ReadonlyArray<ShownWord>
  playing: Playing | undefined
}

const cutOfLoaded = (loaded: Loaded): Cut | undefined => {
  const { timeline } = loaded.view
  return timeline.state === "ready" && loaded.transcripts.size > 0 ? cutOfPage(loaded.view, timeline, loaded.transcripts, timeline.edits) : undefined
}

const row = (label: string, ...control: ReadonlyArray<Node>): HTMLElement =>
  h("div", { class: "look-row" }, h("span", { class: "look-row__label" }, label), h("div", { class: "look-row__control" }, ...control))

const lookGroups = (subtitles: Node, face: Node, noise: Node): HTMLElement =>
  h("div", { class: "look-groups" },
      subtitles,
      h("section", { class: "group look-settings", "aria-labelledby": "look-picture" },
        h("h2", { class: "group__title", id: "look-picture" }, "Картинка"),
        face,
        row("Цвет", h("p", { class: "look-row__text" }, COLOUR))),
      h("section", { class: "group look-settings", "aria-labelledby": "look-sound" },
        h("h2", { class: "group__title", id: "look-sound" }, "Звук"),
        noise))

export const lookStep = (projectId: string): LookStep => {
  const state: State = { loaded: undefined, cut: undefined, drawn: "", edits: NO_EDITS, base: undefined, shown: [], overlay: [], words: [], playing: undefined }
  const sound = montageSound(projectId)
  const overlay = insertView(Api.insertUrls(projectId))
  const thought = h("div", { class: "thought-preview", "aria-hidden": "true" })
  const margins = lookMargins(projectId)
  const go = button("main", WATCH, { disabled: true }, "play")
  const clock = h("span", { class: "clock" })
  const frame = h("div", { class: "frame" }, overlay.node, thought)
  const face = lookFace(projectId)
  const noise = lookNoise(projectId, (urlOf) => { player.source(urlOf) })
  const subtitles = lookSubtitles(projectId, (view) => {
    const middle = view.subtitles.style === "example" && view.example?.title === "middle"
    const { box } = textAreaOf("Instagram")
    thought.style.top = middle ? `${(box.top + box.bottom) / 2 / FRAME.height * 100}%` : ""
    thought.style.transform = middle ? "translateY(-50%)" : ""
    paint(state.playing)
  })
  frame.append(subtitles.plate, subtitles.subtitle, margins.overlay)
  const empty = h("p", { class: "hint", hidden: true }, EMPTY)
  const work = h("div", { class: "look", hidden: true },
    h("div", { class: "look-viewer" }, frame, h("div", { class: "montage-viewer__bar" }, go, clock), margins.controls),
    lookGroups(subtitles.node, face.node, noise.node))
  const next = h("div", { class: "next", hidden: true }, h("a", { class: "btn btn--main", href: stepPath(projectId, "done") }, "Дальше: ролики", icon("right")))
  const body = h("div", { class: "body body--look" },
    h("div", { class: "head" }, h("h1", { tabindex: "-1" }, "Оформление")),
    empty, work, next, h("div", { hidden: true }, sound.node))

  const paintClock = (): void => {
    const total = formatLength(state.cut?.length ?? 0)
    const { playing } = state
    clock.textContent = state.cut === undefined ? "" : `${formatLength(playing === undefined ? 0 : (state.base ?? 0) + playing.elapsed)} / ${total}`
  }

  const paint = (playing: Playing | undefined): void => {
    const was = state.playing
    state.playing = playing
    overlay.paint(playing === undefined ? undefined : lookAt(state.overlay, playing.elapsed))
    const at = playing === undefined ? undefined : (state.base ?? 0) + playing.elapsed
    subtitles.paintFrame(playing === undefined ? "" : state.words.find((one) => playing.elapsed >= one.start && playing.elapsed < one.end)?.text ?? "", at, state.cut?.reel ?? [])
    paintThought(thought, at === undefined ? undefined : shownTexts(state.cut).find((text) => at >= text.start && at < text.end))
    paintClock()
    if ((was === undefined) !== (playing === undefined)) go.replaceChildren(icon(playing === undefined ? "play" : "stop"), playing === undefined ? WATCH : STOP)
  }

  const player = montage(projectId, paint, sound.dbAt, (video) => state.loaded?.view.faces.find((faces) => faces.video === video))
  frame.prepend(player.node)
  const { watch } = playback(state, () => state.cut?.reel ?? [], player)

  const draw = (): void => {
    const cut = state.loaded === undefined ? undefined : cutOfLoaded(state.loaded)
    state.cut = cut
    state.shown = cut?.shown ?? []
    const first = cut?.reel[0]
    work.hidden = first === undefined
    next.hidden = first === undefined
    empty.hidden = state.loaded === undefined || first !== undefined
    go.disabled = first === undefined
    if (first !== undefined && state.playing === undefined) player.show(first)
    paint(state.playing)
  }

  const show = (loaded: Loaded): void => {
    state.loaded = loaded
    const { timeline } = loaded.view
    state.edits = timeline.state === "ready" ? timeline.edits : NO_EDITS
    const drawn = JSON.stringify([loaded.view, [...loaded.transcripts.keys()]])
    if (drawn === state.drawn) return
    state.drawn = drawn
    draw()
  }

  go.addEventListener("click", () => {
    if (state.playing !== undefined) player.stop()
    else {
      const first = state.cut?.reel[0]
      if (first !== undefined) watch(first.block)
    }
  })
  const refresh = loader(projectId, body, show, () => ({ changes: 0, busy: false }))
  // The loader stops once its anchor leaves the page, so the first load waits until the caller has put the body on the page.
  queueMicrotask(() => {
    refresh()
    sound.refresh()
    face.refresh()
    noise.refresh()
    subtitles.refresh()
  })
  return {
    body,
    dispose: () => {
      player.stop()
      face.dispose()
      noise.dispose()
      subtitles.dispose()
    }
  }
}
