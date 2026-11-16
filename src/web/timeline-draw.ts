import { lengthOf, type Transcript } from "../shared/plan.ts"
import { arrange, assemble, chosenTake, withPauses, type Edits, type Placed, type Take, type TimelineView } from "../shared/timeline.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { blockDetail, deletedList, pauseList, type DetailActions } from "./timeline-detail.ts"
import { cutMap } from "./timeline-map.ts"
import { blockRow, type RowActions } from "./timeline-row.ts"

export const PLAY = "Смотреть монтаж"
export const STOP = "Остановить"
const STRIP = "Убрать все паузы"
const UNSTRIP = "Вернуть все паузы"
const GATHER = "Собери блоки из всех видео и расставь дубли от лучшего к худшему."
const NO_SPEECH = "Блоки появятся, когда студия услышит первое видео."
const NO_BLOCKS = "Блоков пока нет. Студия соберёт их из текста всех видео: дубли с одним смыслом попадут в один блок, лучший дубль встанет первым."
const NO_ROW = "Здесь появятся блоки ролика и паузы в них."
const NO_PAUSES = "Паузы появятся, когда студия соберёт блоки."

type Ready = Extract<TimelineView["timeline"], { readonly state: "ready" }>

export interface Loaded {
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly view: TimelineView
}

export interface Status {
  readonly heard: number
  readonly blocks: number | undefined
  readonly pauses: { readonly removed: number; readonly total: number }
}

export interface Hooks {
  readonly ask: (text: string) => void
  readonly openTakes: () => void
  readonly status: (status: Status) => void
}

const looksNote = (looks: TimelineView["looks"]): ReadonlyArray<HTMLElement> => {
  const named = (state: "waiting" | "failed"): string => looks.filter((look) => look.state === state).map((look) => look.video).join(", ")
  const waiting = named("waiting")
  const failed = named("failed")
  return [
    ...(waiting === "" ? [] : [h("p", { class: "muted", role: "status" },
      `Студия ещё измеряет взгляд в камеру в видео: ${waiting}. Когда закончит, попросите в чате расставить дубли заново.`)]),
    ...(failed === "" ? [] : [h("p", { class: "muted" },
      `Взгляд в камеру не удалось измерить в видео: ${failed}. Дубли из них расставлены только по речи.`)])
  ]
}

export const notesOf = ({ transcripts, view }: Loaded, ask: (text: string) => void): ReadonlyArray<HTMLElement> => {
  if (transcripts.size === 0) return [h("p", { class: "muted" }, NO_SPEECH)]
  const gather = (label: string): HTMLElement => h("button", { type: "button", class: "primary end", click: () => { ask(GATHER) } }, label)
  const { timeline } = view
  if (timeline.state !== "ready") {
    return timeline.state === "none"
      ? [h("p", { class: "muted" }, NO_BLOCKS), gather("Собрать блоки")]
      : [h("p", { class: "error" }, "Блоки не прочитались. Попросите студию собрать их заново."), gather("Собрать блоки заново")]
  }
  const dropped = timeline.dropped === 0 ? [] : [h("p", { class: "muted" },
    `Студия пропустила дубли, которые не нашла в видео: ${timeline.dropped}. Попросите в чате собрать блоки заново.`)]
  return [...dropped, ...looksNote(view.looks)]
}

const summaryOf = (placed: ReadonlyArray<Placed>): string => {
  if (placed.length === 0) return "Все блоки удалены"
  const pauses = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed))
  const length = formatLength(lengthOf(placed.flatMap((one) => one.spans)))
  const kept = pauses.length === 0 ? "пауз нет" : `пауз: ${pauses.length} на ${formatLength(lengthOf(pauses))}`
  return `Блоков: ${placed.length} · ролик ${length} · ${kept}`
}

export const refocus = (roots: ReadonlyArray<HTMLElement>, key: string | undefined): void => {
  if (key === undefined) return
  for (const root of roots) {
    for (const node of root.querySelectorAll<HTMLElement>("[data-key]")) {
      if (node.dataset.key === key) node.focus({ preventScroll: true })
    }
  }
}

const tool = (label: string, title: string, cls = ""): HTMLButtonElement =>
  h("button", { type: "button", class: cls, disabled: true, title }, label)

export interface Parts {
  readonly summary: HTMLElement
  readonly clock: HTMLElement
  readonly undo: HTMLButtonElement
  readonly strip: HTMLButtonElement
  readonly play: HTMLButtonElement
  readonly prev: HTMLButtonElement
  readonly go: HTMLButtonElement
  readonly next: HTMLButtonElement
  readonly around: HTMLButtonElement
  readonly tag: HTMLElement
  readonly facts: HTMLElement
  readonly rowHolder: HTMLElement
  readonly map: HTMLElement
  readonly detailHolder: HTMLElement
  readonly pauseHolder: HTMLElement
}

export const partsOf = (): Parts => ({
  summary: h("span", { class: "sum" }),
  clock: h("span", { class: "tc", role: "timer" }),
  undo: tool("Отменить", "Отменяет последнее изменение монтажа. Клавиша Z"),
  strip: tool(STRIP, "Убирает все паузы в выбранных дублях"),
  play: tool(PLAY, "Показывает монтаж с начала", "primary"),
  prev: h("button", { type: "button", disabled: true, "aria-label": "Блок до этого", title: "Блок до этого" }, "|◀"),
  go: h("button", { type: "button", class: "go", disabled: true, "aria-label": "Смотреть с этого блока", title: "Смотреть с этого блока. Пробел" }, "▶"),
  next: h("button", { type: "button", disabled: true, "aria-label": "Блок после этого", title: "Блок после этого" }, "▶|"),
  around: h("button", { type: "button", disabled: true, title: "Конец блока до него, этот блок и начало блока после" }, "С соседями"),
  tag: h("span", { class: "tag", hidden: true }),
  facts: h("span", { class: "side right" }),
  rowHolder: h("div", { class: "blocks-holder" }),
  map: h("ol", { class: "map" }),
  detailHolder: h("div", { class: "details" }),
  pauseHolder: h("div", { class: "details" })
})

interface Drawn {
  readonly loaded: Loaded
  readonly timeline: Ready
  readonly edits: Edits
  readonly selected: string | undefined
}

export type Actions = RowActions & DetailActions & { readonly change: (edits: Edits) => void }

export const textOf = (transcripts: ReadonlyMap<string, Transcript>, take: Take): string =>
  (transcripts.get(take.video)?.words ?? []).slice(take.from, take.to + 1).map((word) => word.text).join(" ")

export const startOf = (placed: ReadonlyArray<Placed>, index: number): number => lengthOf(placed.slice(0, index).flatMap((one) => one.spans))

export const drawReady = (parts: Parts, drawn: Drawn, actions: Actions): { readonly open: Placed | undefined; readonly status: Status["pauses"] } => {
  const { edits, loaded, selected, timeline } = drawn
  const placed = assemble(timeline.blocks, edits, loaded.transcripts)
  const { deleted } = arrange(timeline.blocks, edits)
  const pauses = placed.flatMap((one) => one.pauses.map((pause) => ({ video: one.take.video, after: pause.after, removed: pause.removed })))
  const allRemoved = pauses.length > 0 && pauses.every((pause) => pause.removed)
  const index = Math.max(0, placed.findIndex((one) => one.block.id === selected))
  const open = placed[index]
  parts.summary.textContent = summaryOf(placed)
  parts.strip.disabled = pauses.length === 0
  parts.strip.textContent = allRemoved ? UNSTRIP : STRIP
  parts.strip.onclick = () => { actions.change(withPauses(edits, pauses, !allRemoved)) }
  parts.prev.disabled = index === 0
  parts.next.disabled = index >= placed.length - 1
  parts.prev.onclick = () => { actions.select(placed[index - 1]?.block.id ?? "") }
  parts.next.onclick = () => { actions.select(placed[index + 1]?.block.id ?? "") }
  parts.facts.textContent = open === undefined ? "" : `дубль ${open.block.takes.indexOf(open.take) + 1} из ${open.block.takes.length}`
  const old = parts.rowHolder.firstElementChild
  const row = blockRow(placed, open?.block.id, actions)
  parts.rowHolder.replaceChildren(row)
  row.scrollLeft = old?.scrollLeft ?? 0
  parts.map.replaceChildren(...cutMap(placed, open?.block.id, actions.select))
  parts.detailHolder.replaceChildren(
    ...(open === undefined ? [] : [blockDetail(open.block, index + 1, chosenTake(open.block, edits), loaded.transcripts, edits, actions)]),
    ...(deleted.length === 0 ? [] : [deletedList(deleted, actions)]))
  parts.pauseHolder.replaceChildren(pauseList(placed, (video, at) => loaded.transcripts.get(video)?.words[at]?.text ?? "", actions))
  return { open, status: { removed: pauses.filter((pause) => pause.removed).length, total: pauses.length } }
}

export interface Panels {
  readonly tracks: HTMLElement
  readonly viewer: HTMLElement
  readonly takes: HTMLElement
  readonly pauses: HTMLElement
  readonly tools: ReadonlyArray<HTMLElement>
  readonly clock: HTMLElement
  readonly summary: HTMLElement
}

const LANES = ["Текст", "Видео", "Паузы"]

export interface Frame {
  readonly notes: HTMLElement
  readonly problem: HTMLElement
  readonly empty: HTMLElement
  readonly noPauses: HTMLElement
  readonly ready: HTMLElement
  readonly frame: HTMLElement
  readonly overview: HTMLElement
  readonly panels: Panels
}

export const frameOf = (parts: Parts): Frame => {
  const notes = h("div", { class: "notes" })
  const problem = h("p", { class: "error", role: "alert" })
  const empty = h("p", { class: "muted lane-empty" }, NO_ROW)
  const noPauses = h("p", { class: "muted" }, NO_PAUSES)
  const ready = h("div", { class: "lanes", hidden: true },
    h("div", { class: "lane-names", "aria-hidden": "true" }, ...LANES.map((name) => h("span", {}, name))), parts.rowHolder)
  const frame = h("div", { class: "frame" }, parts.tag)
  const overview = h("nav", { class: "overview", "aria-label": "Весь ролик", hidden: true }, h("span", { class: "label" }, "Весь ролик"), parts.map)
  const panels: Panels = {
    tracks: h("section", { class: "timeline", "aria-label": "Монтаж" }, overview, ready, empty, problem),
    viewer: h("section", { class: "viewer", "aria-label": "Просмотр" },
      h("div", { class: "stage" }, frame),
      h("div", { class: "transport" }, h("span", { class: "side" }), parts.prev, parts.go, parts.next, parts.around, parts.facts)),
    takes: h("div", { class: "pane" }, notes, parts.detailHolder),
    pauses: h("div", { class: "pane" }, noPauses, parts.pauseHolder),
    tools: [parts.undo, parts.strip, parts.play],
    clock: parts.clock,
    summary: parts.summary
  }
  return { notes, problem, empty, noPauses, ready, frame, overview, panels }
}
