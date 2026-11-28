import { stepPath } from "../../shared/page.ts"
import { chosenTake } from "../../shared/timeline.ts"
import { h } from "../dom.ts"
import type { EditHistory } from "../edit-history.ts"
import { nameIn } from "../../shared/text-names.ts"
import { formatLength } from "../format.ts"
import type { Montage } from "../montage.ts"
import type { Loaded } from "../timeline-draw.ts"
import { editableSubtitles } from "../timeline-subtitles.ts"
import { icon } from "./icons.ts"
import { cutOfPage, isOpen, type Cut } from "../../shared/montage-cut.ts"
import { notesOf } from "./montage-notes.ts"
import { goneDetail, partDetail, screenGroup, type PartActions, type PartData } from "./montage-part.ts"
import { showClock, type Screen, type State } from "./montage-screen.ts"
import { button } from "./ui.ts"

const PHRASE_ENDS = 4

const phraseOf = (transcripts: Loaded["transcripts"]) => ({ video, from, to }: { readonly video: string; readonly from: number; readonly to: number }): string => {
  const words = transcripts.get(video)?.words.slice(from, to + 1).map((word) => word.text) ?? []
  if (words.length <= PHRASE_ENDS * 2) return words.join(" ")
  return `${words.slice(0, PHRASE_ENDS).join(" ")} … ${words.slice(-PHRASE_ENDS).join(" ")}`
}

const partButton = (key: string, on: boolean, ...children: ReadonlyArray<Node | string>): HTMLElement =>
  h("li", {}, h("button", { class: on ? "part part--on" : "part", type: "button", "data-key": `part:${key}`, "aria-current": on ? "true" : false }, ...children))

const partsNav = (cut: Cut, selected: string | undefined, select: (block: string) => void): HTMLElement => {
  const asking = new Set(cut.questions.filter(isOpen).map((question) => question.part))
  const nav = h("nav", { class: "parts", "aria-label": "Части" }, h("ol", {},
    ...cut.parts.map((part) => {
      const id = part.one.block.id
      const asks = asking.has(id)
      return partButton(id, id === selected,
        h("span", { class: "part__n" }, String(part.number)),
        h("span", { class: "part__name" }, part.one.block.title, ...asks ? [h("span", { class: "visually-hidden" }, ", есть вопрос")] : []),
        h("span", { class: "part__dur" }, formatLength(part.length)),
        ...asks ? [h("span", { class: "part__q", "aria-hidden": "true" })] : [])
    }),
    ...cut.gone.map((block) => partButton(block.id, block.id === selected,
      h("span", { class: "part__n", "aria-hidden": "true" }, "–"),
      h("span", { class: "part__name part__name--gone" }, block.title),
      h("span", { class: "part__dur" }, "убрана")))))
  nav.addEventListener("click", (event) => {
    const key = event.target instanceof Element ? event.target.closest(".part")?.getAttribute("data-key") : undefined
    if (key !== undefined && key !== null) select(key.slice("part:".length))
  })
  return nav
}

const detailOf = (cut: Cut, loaded: Loaded, state: State, actions: PartActions): HTMLElement => {
  const texts = [...cut.parts.flatMap((part) => part.texts), ...cut.outside.texts]
  const data = (words: PartData["words"]): PartData => ({
    count: cut.parts.length,
    rest: cut.rest,
    transcripts: loaded.transcripts,
    edits: state.edits,
    pictures: loaded.view.pictures,
    words,
    phraseOf: phraseOf(loaded.transcripts),
    textName: (id) => nameIn(texts, id)
  })
  const part = cut.parts.find((one) => one.one.block.id === state.selected)
  const gone = cut.gone.find((block) => block.id === state.selected)
  const detail = part !== undefined
    ? partDetail(part, data(editableSubtitles(loaded, state.edits, part.one)), actions)
    : gone !== undefined
      ? goneDetail(gone, chosenTake(gone, state.edits), data([]), actions)
      : h("p", { class: "hint" }, "Все части убраны из ролика. Выберите убранную часть в списке и верните её.")
  return h("div", { class: "detail" }, detail, ...screenGroup(cut.outside, data([]), actions, "Не в ролике"))
}

const nextOf = (projectId: string, cut: Cut | undefined): ReadonlyArray<HTMLElement> => {
  if (cut === undefined || cut.parts.length === 0) return []
  const open = cut.questions.filter(isOpen).length
  if (open === 0) return [h("a", { class: "btn btn--main", href: stepPath(projectId, "look") }, "Дальше: оформление", icon("right"))]
  return [
    button("main", "Дальше: оформление", { disabled: true, "aria-describedby": "montage-blocked" }),
    h("p", { class: "hint", id: "montage-blocked" }, `Сначала ответьте на вопросы: ${open}. Кнопка «Вопросы» проведёт по ним.`)
  ]
}

const refocus = (root: HTMLElement, key: string | undefined): void => {
  if (key === undefined || document.activeElement !== document.body) return
  const target = [...root.querySelectorAll<HTMLElement>("[data-key]")].find((node) => node.dataset.key === key)
  target?.focus({ preventScroll: true })
}

export interface Drawing {
  readonly projectId: string
  readonly screen: Screen
  readonly state: State
  readonly history: EditHistory
  readonly actions: PartActions
  readonly player: Montage
  readonly select: (block: string) => void
  readonly gather: () => void
}

export const drawUndo = ({ screen, history }: Pick<Drawing, "screen" | "history">): void => {
  screen.undo.disabled = !history.canUndo()
  screen.redo.disabled = !history.canRedo()
}

const drawHead = (drawing: Drawing, cut: Cut | undefined): void => {
  const { screen } = drawing
  const open = cut?.questions.filter(isOpen).length ?? 0
  screen.work.hidden = cut === undefined
  screen.figure.textContent = cut === undefined ? "" : formatLength(cut.length)
  screen.asks.hidden = open === 0
  screen.asks.textContent = `Вопросы: ${open}`
  drawUndo(drawing)
}

const drawCut = ({ screen, state, actions, player, select }: Drawing, cut: Cut, loaded: Loaded): void => {
  const ids = [...cut.parts.map((part) => part.one.block.id), ...cut.gone.map((block) => block.id)]
  if (state.selected === undefined || !ids.includes(state.selected)) state.selected = ids[0]
  screen.nav.replaceChildren(partsNav(cut, state.selected, select))
  screen.detail.replaceChildren(detailOf(cut, loaded, state, actions))
  const first = cut.reel.find((clip) => clip.block === state.selected)
  if (first !== undefined && state.playing === undefined) player.show(first)
  screen.go.disabled = first === undefined
}

export const drawMontage = (drawing: Drawing): void => {
  const { screen, state, projectId, gather } = drawing
  const { loaded } = state
  if (loaded === undefined) return
  const active = document.activeElement instanceof HTMLElement && screen.body.contains(document.activeElement) ? document.activeElement.dataset.key : undefined
  const { timeline } = loaded.view
  screen.notes.replaceChildren(...notesOf(loaded, gather))
  const cut = timeline.state === "ready" && loaded.transcripts.size > 0 ? cutOfPage(loaded.view, timeline, loaded.transcripts, state.edits) : undefined
  state.cut = cut
  state.shown = cut?.shown ?? []
  drawHead(drawing, cut)
  screen.next.replaceChildren(...nextOf(projectId, cut))
  if (cut !== undefined) drawCut(drawing, cut, loaded)
  showClock(screen, state)
  refocus(screen.body, active)
}
