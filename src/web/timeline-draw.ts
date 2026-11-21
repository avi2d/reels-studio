import { lengthOf, type Transcript } from "../shared/plan.ts"
import { facesByVideo, openPlaces, placesOf, trimmed } from "../shared/joins.ts"
import { arrange, assemble, chosenTake, clipsOf, playedPause, withManualPauses, type Edits, type GazeFailure, type Placed, type Take, type TimelinePage, type TimelineView } from "../shared/timeline.ts"
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { button, focusWhenReady, iconButton, tooltip } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { margins, type Margins } from "./margins.ts"
import { blockDetail, deletedList, pauseList, type DetailActions } from "./timeline-detail.ts"
import { cutMap } from "./timeline-map.ts"
import { placeList, type PlaceActions, type PlaceCoverage } from "./timeline-places.ts"
import { blockRow, type RowActions } from "./timeline-row.ts"

export const STOP = "Остановить"
export const GO = "Смотреть с этого блока"
const STRIP = { label: "Убрать все паузы", hint: "Убирает все паузы в выбранных дублях" }
const UNSTRIP = { label: "Вернуть все паузы", hint: "Возвращает все паузы в выбранные дубли" }

export const stripWords = (allRemoved: boolean): typeof STRIP => allRemoved ? UNSTRIP : STRIP
const GATHER = "Собери блоки из всех видео и расставь дубли от лучшего к худшему."
const NO_SPEECH = "Блоки появятся, когда студия услышит первое видео."
const GATHERING = "Студия собирает блоки из всех видео. Потом сама выберет лучший дубль в каждом блоке и сократит паузы."
const REGATHERING = "Студия собирает блоки заново. Дубли и паузы обновятся сами."
const FAILED = "Студия не смогла собрать блоки. Новое видео или измеренный взгляд попробуют ещё раз."
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
  readonly places: number
  readonly placesComplete: boolean
}

export interface Hooks {
  readonly ask: (text: string) => void
  readonly openTakes: () => void
  readonly status: (status: Status) => void
  readonly edited?: () => void
  readonly settled?: (ok: boolean) => void
  readonly active?: () => boolean
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
      `Студия ещё измеряет взгляд в камеру в видео: ${waiting}. Когда закончит, студия соберёт блоки заново сама.`)]),
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
    if (timeline.state === "unreadable") return [h("p", { class: "error" }, "Блоки не прочитались. Попросите студию собрать их заново."), gather("Собрать блоки заново")]
    if (view.gatherFailed) return [h("p", { class: "error" }, FAILED), gather("Собрать блоки")]
    return [h("p", { class: "muted" }, NO_BLOCKS), gather("Собрать блоки")]
  }
  const dropped = timeline.dropped === 0 ? [] : [h("p", { class: "muted" },
    `Студия пропустила дубли, которые не нашла в видео: ${timeline.dropped}. Попросите в чате собрать блоки заново.`)]
  const failed = view.gatherFailed && !view.gathering
    ? [h("p", { class: "error" }, FAILED), gather("Собрать блоки")]
    : []
  return [...regathering, ...failed, ...dropped, ...looksNote(view.looks)]
}

const summaryOf = (placed: ReadonlyArray<Placed>): string => {
  if (placed.length === 0) return "Все блоки удалены"
  const pauses = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed))
  const shown = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed).flatMap((pause) => playedPause(one, pause)))
  const length = formatLength(lengthOf(placed.flatMap((one) => one.spans)))
  const kept = pauses.length === 0 ? "пауз нет" : `пауз: ${pauses.length} на ${formatLength(lengthOf(shown))}`
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
  readonly zones: Margins
  readonly facts: HTMLElement
  readonly rowHolder: HTMLElement
  readonly map: HTMLElement
  readonly detailHolder: HTMLElement
  readonly pauseHolder: HTMLElement
  readonly placeHolder: HTMLElement
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
  zones: margins(),
  facts: h("span", { class: "facts" }),
  rowHolder: h("div", { class: "blocks-holder" }),
  map: h("ol", { class: "map" }),
  detailHolder: h("div", { class: "details" }),
  pauseHolder: h("div", { class: "details" }),
  placeHolder: h("div", { class: "details places" })
  }
}

interface Drawn {
  readonly loaded: Loaded
  readonly timeline: Ready
  readonly edits: Edits
  readonly selected: string | undefined
}

export type Actions = RowActions & DetailActions & PlaceActions & { readonly change: (edits: Edits) => void }

export const textOf = (transcripts: ReadonlyMap<string, Transcript>, take: Take): string =>
  (transcripts.get(take.video)?.words ?? []).slice(take.from, take.to + 1).map((word) => word.text).join(" ")

const replaceLists = (holder: HTMLElement, ...nodes: ReadonlyArray<HTMLElement>): void => {
  const lists = () => holder.querySelectorAll<HTMLElement>("[data-scroll-key]")
  const offsets = new Map([...lists()].map((list) => [list.dataset.scrollKey, list.scrollTop]))
  holder.replaceChildren(...nodes)
  for (const list of lists()) list.scrollTop = offsets.get(list.dataset.scrollKey) ?? 0
}

const placeCoverage = (view: TimelineView, placed: ReadonlyArray<Placed>): PlaceCoverage => {
  const waiting = new Set(view.looks.flatMap((look) => look.state === "waiting" ? [look.video] : []))
  const failed = new Set(view.looks.flatMap((look) => look.state === "failed" ? [look.video] : []))
  return {
    waiting: placed.some((one) => waiting.has(one.take.video)),
    failed: [...new Set(placed.flatMap((one) => failed.has(one.take.video) ? [one.take.video] : []))]
  }
}

export interface DrawnStatus {
  readonly pauses: Status["pauses"]
  readonly places: number
  readonly placesComplete: boolean
}

type PauseMark = { readonly video: string; readonly after: number; readonly removed: boolean }

const drawChrome = (
  parts: Parts,
  displayed: ReadonlyArray<Placed>,
  placed: ReadonlyArray<Placed>,
  open: Placed | undefined,
  index: number,
  pauses: ReadonlyArray<PauseMark>,
  allRemoved: boolean,
  edits: Edits,
  actions: Actions
): void => {
  parts.summary.textContent = summaryOf(displayed)
  parts.strip.disabled = pauses.length === 0
  const strip = stripWords(allRemoved)
  parts.strip.textContent = strip.label
  parts.strip.title = strip.hint
  parts.strip.onclick = () => { actions.change(withManualPauses(edits, pauses, !allRemoved)) }
  parts.prev.disabled = index === 0
  parts.next.disabled = index >= placed.length - 1
  parts.prev.onclick = () => { actions.select(displayed[index - 1]?.block.id ?? "") }
  parts.next.onclick = () => { actions.select(displayed[index + 1]?.block.id ?? "") }
  parts.facts.textContent = open === undefined ? "" : `дубль ${open.block.takes.indexOf(open.take) + 1} из ${open.block.takes.length}`
}

const drawRows = (parts: Parts, displayed: ReadonlyArray<Placed>, open: Placed | undefined, actions: Actions): void => {
  const scrollLeft = parts.rowHolder.firstElementChild?.scrollLeft ?? 0
  const row = blockRow(displayed, open?.block.id, actions)
  parts.rowHolder.replaceChildren(row)
  row.scrollLeft = scrollLeft
  parts.map.replaceChildren(...cutMap(displayed, open?.block.id, actions.select))
}

const drawPanels = (
  parts: Parts,
  displayed: ReadonlyArray<Placed>,
  placed: ReadonlyArray<Placed>,
  open: Placed | undefined,
  index: number,
  loaded: Loaded,
  edits: Edits,
  deleted: ReturnType<typeof arrange>["deleted"],
  faces: ReturnType<typeof facesByVideo>,
  actions: Actions
): { readonly places: ReturnType<typeof placesOf>; readonly coverage: PlaceCoverage } => {
  replaceLists(parts.detailHolder,
    ...(open === undefined ? [] : [blockDetail(open.block, index + 1, chosenTake(open.block, edits), loaded.transcripts, edits, actions)]),
    ...(deleted.length === 0 ? [] : [deletedList(deleted, actions)]))
  const places = placesOf(clipsOf(placed), faces, loaded.transcripts, edits)
  const coverage = placeCoverage(loaded.view, placed)
  replaceLists(parts.placeHolder, placeList(places, displayed, coverage, actions))
  replaceLists(parts.pauseHolder, pauseList(displayed, (video, at) => loaded.transcripts.get(video)?.words[at]?.text ?? "", actions))
  return { places, coverage }
}

export const drawReady = (parts: Parts, drawn: Drawn, actions: Actions): { readonly open: Placed | undefined; readonly status: DrawnStatus } => {
  const { edits, loaded, selected, timeline } = drawn
  const placed = assemble(timeline.blocks, edits, loaded.transcripts)
  const faces = facesByVideo(loaded.view.faces)
  const reel = trimmed(clipsOf(placed), faces, loaded.transcripts, edits)
  const displayed = placed.map((one) => ({
    ...one,
    spans: reel.filter((clip) => clip.block === one.block.id).map((clip) => ({ start: clip.start, end: clip.end }))
  }))
  const { deleted } = arrange(timeline.blocks, edits)
  const pauses = placed.flatMap((one) => one.pauses.map((pause) => ({ video: one.take.video, after: pause.after, removed: pause.removed })))
  const allRemoved = pauses.length > 0 && pauses.every((pause) => pause.removed)
  const index = Math.max(0, displayed.findIndex((one) => one.block.id === selected))
  const open = displayed[index]
  drawChrome(parts, displayed, placed, open, index, pauses, allRemoved, edits, actions)
  drawRows(parts, displayed, open, actions)
  const { places, coverage } = drawPanels(parts, displayed, placed, open, index, loaded, edits, deleted, faces, actions)
  return { open, status: { pauses: { removed: pauses.filter((pause) => pause.removed).length, total: pauses.length }, places: openPlaces(places), placesComplete: !coverage.waiting && coverage.failed.length === 0 } }
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
  const frame = h("div", { class: "frame" }, parts.tag, parts.zones.overlay)
  const overview = h("nav", { class: "overview", "aria-label": "Весь ролик", hidden: true }, parts.map)
  const panels: Panels = {
    tracks: h("section", { class: "timeline", "aria-label": "Монтаж" }, ready, empty, problem),
    viewer: h("section", { class: "viewer", "aria-label": "Просмотр" },
      h("div", { class: "viewbox" },
        h("div", { class: "stage" }, frame),
        overview,
        h("div", { class: "transport" }, parts.clock, parts.prev, parts.go, parts.next, parts.facts, parts.zones.gear, ...parts.transportTips), parts.zones.panel)),
    takes: h("div", { class: "pane" }, notes, parts.detailHolder),
    pauses: h("div", { class: "pane" }, noPauses, parts.placeHolder, parts.strip, parts.pauseHolder),
    history: h("div", { class: "history", role: "group", "aria-label": "Правки монтажа" }, parts.undo, parts.redo, ...parts.historyTips),
    summary: parts.summary
  }
  return { notes, problem, empty, noPauses, ready, frame, overview, panels }
}
