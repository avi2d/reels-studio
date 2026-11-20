import { lengthOf, type Transcript } from "../shared/plan.ts"
import { arrange, assemble, chosenTake, withPauses, type Edits, type GazeFailure, type Placed, type Take, type TimelinePage, type TimelineView } from "../shared/timeline.ts"
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { button, focusWhenReady, iconButton, tooltip } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { blockDetail, deletedList, pauseList, type DetailActions } from "./timeline-detail.ts"
import { cutMap } from "./timeline-map.ts"
import { blockRow, type RowActions } from "./timeline-row.ts"

export const STOP = "Остановить"
export const GO = "Смотреть с этого блока"
const STRIP = { label: "Убрать все паузы", hint: "Убирает все паузы в выбранных дублях" }
const UNSTRIP = { label: "Вернуть все паузы", hint: "Возвращает все паузы в выбранные дубли" }

export const stripWords = (allRemoved: boolean): typeof STRIP => allRemoved ? UNSTRIP : STRIP
const GATHER = "Собери блоки из всех видео и расставь дубли от лучшего к худшему."
const NO_SPEECH = "Блоки появятся, когда студия услышит первое видео."
const GATHERING = "Студия собирает блоки из всех видео. Потом сама выберет лучший дубль в каждом блоке и сократит паузы."
const REGATHERING = "Студия собирает блоки заново вместе с новым видео. Дубли и паузы обновятся сами."
const NO_BLOCKS = "Блоков пока нет. Студия соберёт их из текста всех видео: дубли с одним смыслом попадут в один блок, лучший дубль встанет первым."
const NO_ROW = "Здесь появятся блоки ролика и паузы в них."
const NO_PAUSES = "Паузы появятся, когда студия соберёт блоки."

type Ready = Extract<TimelineView["timeline"], { readonly state: "ready" }>

export interface Loaded {
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly view: TimelinePage
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

const GAZE_CAUSE: Readonly<Record<GazeFailure, string>> = {
  "no-tool": "Программа, которая меряет взгляд, не найдена на компьютере студии. Установите uv и перезапустите студию.",
  "tool-failed": "Программа, которая меряет взгляд, завершилась с ошибкой. Подробности в журнале студии. Исправьте причину и перезапустите студию.",
  "file-unreadable": "Студия не смогла прочитать файл с измеренным взглядом. Удалите файл измерения в папке gaze и перезапустите студию, чтобы измерить взгляд заново. Подробности в журнале студии.",
  "video-unreadable": "Студия не смогла открыть файл предпросмотра этого видео для измерения взгляда. Проверьте видео и перезапустите студию. Подробности в журнале студии."
}

const looksNote = (looks: TimelineView["looks"]): ReadonlyArray<HTMLElement> => {
  const waiting = looks.filter((look) => look.state === "waiting").map((look) => look.video).join(", ")
  const failures = new Map<GazeFailure, Array<string>>()
  for (const look of looks) {
    if (look.state === "failed") failures.set(look.reason, [...(failures.get(look.reason) ?? []), look.video])
  }
  return [
    ...(waiting === "" ? [] : [h("p", { class: "muted", role: "status" },
      `Студия ещё измеряет взгляд в камеру в видео: ${waiting}. Когда закончит, попросите в чате расставить дубли заново.`)]),
    ...[...failures].map(([reason, videos]) => h("p", { class: "muted" },
      `Взгляд в камеру не удалось измерить в видео: ${videos.join(", ")}. Дубли из них расставлены только по речи. ${GAZE_CAUSE[reason]}`))
  ]
}

export const notesOf = ({ transcripts, view }: Loaded, ask: (text: string) => void): ReadonlyArray<HTMLElement> => {
  if (transcripts.size === 0) return [h("p", { class: "muted" }, NO_SPEECH)]
  const gather = (label: string): HTMLElement => button("primary", { class: "end", click: () => { ask(GATHER) } }, label)
  const { timeline } = view
  if (view.gathering && timeline.state !== "ready") return [h("p", { class: "muted", role: "status" }, GATHERING)]
  const regathering = view.gathering ? [h("p", { class: "muted", role: "status" }, REGATHERING)] : []
  if (timeline.state !== "ready") {
    return timeline.state === "none"
      ? [h("p", { class: "muted" }, NO_BLOCKS), gather("Собрать блоки")]
      : [h("p", { class: "error" }, "Блоки не прочитались. Попросите студию собрать их заново."), gather("Собрать блоки заново")]
  }
  const dropped = timeline.dropped === 0 ? [] : [h("p", { class: "muted" },
    `Студия пропустила дубли, которые не нашла в видео: ${timeline.dropped}. Попросите в чате собрать блоки заново.`)]
  return [...regathering, ...dropped, ...looksNote(view.looks)]
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
      if (node.dataset.key === key) focusWhenReady(node)
    }
  }
}

const tool = (label: string, title: string, props: Readonly<Record<string, string>> = {}): WaButton =>
  button("normal", { disabled: true, title, ...props }, label)

const iconTool = (id: string, ...[look, name, label]: Parameters<typeof iconButton>): { readonly button: WaButton; readonly tip: HTMLElement } => {
  const made = iconButton(look, name, label, { disabled: true })
  return { button: made, tip: tooltip(made, id, label) }
}

export interface Parts {
  readonly summary: HTMLElement
  readonly clock: HTMLElement
  readonly undo: WaButton
  readonly redo: WaButton
  readonly strip: WaButton
  readonly prev: WaButton
  readonly go: WaButton
  readonly goTip: HTMLElement
  readonly next: WaButton
  readonly historyTips: ReadonlyArray<HTMLElement>
  readonly transportTips: ReadonlyArray<HTMLElement>
  readonly tag: HTMLElement
  readonly facts: HTMLElement
  readonly rowHolder: HTMLElement
  readonly map: HTMLElement
  readonly detailHolder: HTMLElement
  readonly pauseHolder: HTMLElement
}

export const partsOf = (): Parts => {
  const undo = iconTool("tool-undo", "quiet", "undo", "Отменить")
  const redo = iconTool("tool-redo", "quiet", "redo", "Повторить")
  const prev = iconTool("tool-prev", "plain", "previous", "Блок до этого")
  const go = iconTool("tool-go", "bright", "play", GO)
  const next = iconTool("tool-next", "plain", "next", "Блок после этого")
  prev.button.classList.add("prev")
  next.button.classList.add("next")
  go.button.classList.add("go")
  go.button.pill = true
  return {
  summary: h("span", { class: "sum" }),
  clock: h("span", { class: "clock", role: "timer" }),
  undo: undo.button,
  redo: redo.button,
  strip: tool(STRIP.label, STRIP.hint, { class: "end" }),
  prev: prev.button,
  go: go.button,
  goTip: go.tip,
  next: next.button,
  historyTips: [undo.tip, redo.tip],
  transportTips: [prev.tip, go.tip, next.tip],
  tag: h("span", { class: "tag", hidden: true }),
  facts: h("span", { class: "facts" }),
  rowHolder: h("div", { class: "blocks-holder" }),
  map: h("ol", { class: "map" }),
  detailHolder: h("div", { class: "details" }),
  pauseHolder: h("div", { class: "details" })
  }
}

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

const replaceLists = (holder: HTMLElement, ...nodes: ReadonlyArray<HTMLElement>): void => {
  const lists = () => holder.querySelectorAll<HTMLElement>("[data-scroll-key]")
  const offsets = new Map([...lists()].map((list) => [list.dataset.scrollKey, list.scrollTop]))
  holder.replaceChildren(...nodes)
  for (const list of lists()) list.scrollTop = offsets.get(list.dataset.scrollKey) ?? 0
}

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
  const strip = stripWords(allRemoved)
  parts.strip.textContent = strip.label
  parts.strip.title = strip.hint
  parts.strip.onclick = () => { actions.change(withPauses(edits, pauses, !allRemoved)) }
  parts.prev.disabled = index === 0
  parts.next.disabled = index >= placed.length - 1
  parts.prev.onclick = () => { actions.select(placed[index - 1]?.block.id ?? "") }
  parts.next.onclick = () => { actions.select(placed[index + 1]?.block.id ?? "") }
  parts.facts.textContent = open === undefined ? "" : `дубль ${open.block.takes.indexOf(open.take) + 1} из ${open.block.takes.length}`
  const scrollLeft = parts.rowHolder.firstElementChild?.scrollLeft ?? 0
  const row = blockRow(placed, open?.block.id, actions)
  parts.rowHolder.replaceChildren(row)
  row.scrollLeft = scrollLeft
  parts.map.replaceChildren(...cutMap(placed, open?.block.id, actions.select))
  replaceLists(parts.detailHolder,
    ...(open === undefined ? [] : [blockDetail(open.block, index + 1, chosenTake(open.block, edits), loaded.transcripts, edits, actions)]),
    ...(deleted.length === 0 ? [] : [deletedList(deleted, actions)]))
  replaceLists(parts.pauseHolder, pauseList(placed, (video, at) => loaded.transcripts.get(video)?.words[at]?.text ?? "", actions))
  return { open, status: { removed: pauses.filter((pause) => pause.removed).length, total: pauses.length } }
}

export interface Panels {
  readonly tracks: HTMLElement
  readonly viewer: HTMLElement
  readonly takes: HTMLElement
  readonly pauses: HTMLElement
  readonly history: HTMLElement
  readonly summary: HTMLElement
}

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
  const ready = h("div", { class: "lanes", hidden: true }, parts.rowHolder)
  const frame = h("div", { class: "frame" }, parts.tag)
  const overview = h("nav", { class: "overview", "aria-label": "Весь ролик", hidden: true }, parts.map)
  const panels: Panels = {
    tracks: h("section", { class: "timeline", "aria-label": "Монтаж" }, ready, empty, problem),
    viewer: h("section", { class: "viewer", "aria-label": "Просмотр" },
      h("div", { class: "viewbox" },
        h("div", { class: "stage" }, frame),
        overview,
        h("div", { class: "transport" }, parts.clock, parts.prev, parts.go, parts.next, parts.facts, ...parts.transportTips))),
    takes: h("div", { class: "pane" }, notes, parts.detailHolder),
    pauses: h("div", { class: "pane" }, noPauses, parts.strip, parts.pauseHolder),
    history: h("div", { class: "history", role: "group", "aria-label": "Правки монтажа" }, parts.undo, parts.redo, ...parts.historyTips),
    summary: parts.summary
  }
  return { notes, problem, empty, noPauses, ready, frame, overview, panels }
}
