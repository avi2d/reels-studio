import { Effect } from "effect"
import { type LibraryVideo, pickOf } from "../../shared/library.ts"
import { stepPath } from "../../shared/page.ts"
import type { Transcript } from "../../shared/plan.ts"
import * as Api from "../api.ts"
import { h, placeInOrder } from "../dom.ts"
import { formatLength } from "../format.ts"
import { run } from "../run.ts"
import { icon } from "./icons.ts"
import { type Action, earlierRows, type Handlers, heardLengths, mineRows, type Row, type Shelves, stillHearing } from "./record-rows.ts"
import { percentOf, recordCount, statusOf, type Take } from "./takes.ts"
import { button, confirmRemoval, menuButton } from "./ui.ts"
import { dropTake, joiningTo, keepJoining, onTakesChanged, resend, sendTakes, sendingTo, takeProblem } from "./uploads.ts"

const POLL_MS = 4000

const loadShelves = (id: string): Effect.Effect<Shelves, Api.Failed> =>
  Effect.map(
    Effect.all({ reel: Api.getVideos(id), uploaded: Api.getUploaded, offer: Api.getLibrary(id), project: Api.getProject(id) }, { concurrency: "unbounded" }),
    ({ reel, uploaded, offer, project }) => ({ reel: reel.videos, uploaded: uploaded.videos, offer: offer.videos, project: project.project })
  )

const isBad = (take: Take): boolean => take.kind === "unheard" || take.kind === "unsent"

const thumbOf = (row: Row): HTMLElement =>
  h("span", { class: "rec__thumb" }, row.preview === undefined
    ? icon(row.take.kind === "ready" ? "film" : "upload")
    : h("video", { muted: true, playsinline: true, preload: "metadata", tabindex: "-1", "aria-hidden": "true", src: `${row.preview}#t=0.5` }))

const textOf = (row: Row): HTMLElement =>
  h("span", { class: "rec__text" },
    h("b", {}, row.name),
    h("span", { class: isBad(row.take) ? "rec__status rec__status--bad" : "rec__status" }, statusOf(row.take)),
    ...row.take.kind === "sending" ? [h("progress", { class: "bar", max: "100", value: String(percentOf(row.take.sent, row.take.total)), "aria-hidden": "true" })] : [],
    ...row.note === undefined ? [] : [h("span", { class: "rec__note" }, row.note)])

const actionNode = (row: Row, action: Action): HTMLElement => {
  switch (action.kind) {
    case "retry": return button("quiet", "Ещё раз", { class: "btn btn--quiet btn--sm", "data-focus": "retry", click: action.run }, "retry")
    case "add": return button("quiet", "В ролик", { class: "btn btn--quiet btn--sm", "data-focus": "add", "aria-label": `В ролик: «${row.name}»`, click: action.run }, "plus")
    case "drop": return h("button", { class: "btn btn--plain btn--icon", type: "button", "data-focus": "drop", title: "Не загружать", "aria-label": `Не загружать «${row.name}»`, click: action.run }, icon("close"))
    case "remove": return menuButton(`Ещё о записи «${row.name}»`, [{ label: "Удалить запись", icon: "trash", danger: true, run: action.run }])
  }
}

const transcriptOf = (preview: string, transcript: Transcript): HTMLElement => {
  const player = h("video", { class: "rec__player", controls: true, playsinline: true, preload: "metadata", src: preview })
  const words = transcript.words.flatMap((word) => [h("button", { class: "word", type: "button", click: () => { player.currentTime = word.start } }, word.text), " "])
  return h("div", { class: "rec__open" }, player, ...words.length === 0
    ? [h("p", { class: "hint" }, "Студия не услышала в этой записи слов.")]
    : [h("p", { class: "transcript" }, ...words), h("p", { class: "hint" }, "Нажмите на слово, и запись перейдёт к нему.")])
}

const rowNode = (row: Row, open: boolean, onOpen: () => void): HTMLElement => {
  const heard = row.transcript !== undefined && row.preview !== undefined ? { preview: row.preview, transcript: row.transcript } : undefined
  const main = heard === undefined
    ? h("div", { class: "rec__main" }, thumbOf(row), textOf(row))
    : h("button", { class: "rec__main", type: "button", "data-focus": "main", "aria-expanded": String(open), click: onOpen }, thumbOf(row), textOf(row), h("span", { class: "rec__chev" }, icon("down")))
  return h("li", { class: open ? "rec rec--open" : "rec" },
    h("div", { class: "rec__row" }, main, h("div", { class: "rec__actions" }, ...row.actions.map((action) => actionNode(row, action)))),
    ...open && heard !== undefined ? [transcriptOf(heard.preview, heard.transcript)] : [])
}

const keepFocus = (old: HTMLElement | undefined, fresh: HTMLElement): void => {
  const focused = document.activeElement
  if (old === undefined || !(focused instanceof HTMLElement) || !old.contains(focused)) return
  const target = fresh.querySelector(`[data-focus="${focused.dataset.focus ?? ""}"]`) ?? fresh.querySelector("[data-focus]")
  if (target instanceof HTMLElement) queueMicrotask(() => { target.focus() })
}

const layout = (id: string) => {
  const input = h("input", { type: "file", name: "records", accept: "video/*", multiple: true, hidden: true, tabindex: "-1" })
  const choose = (): void => { input.click() }
  const heading = h("h1", { tabindex: "-1" })
  const more = button("quiet", "Добавить", { class: "btn btn--quiet btn--sm", click: choose }, "plus")
  const pick = h("div", { class: "pick" }, button("main", "Выбрать видео", { click: choose }, "upload"), h("p", { class: "hint" }, "Можно выбрать все дубли сразу."))
  const mine = h("ul", { class: "recs", "aria-label": "Записи ролика" })
  const problem = h("p", { class: "error", role: "alert" })
  const loadProblem = h("p", { class: "error", role: "alert" })
  const earlierTitle = h("h2", { class: "recs-title", id: "records-earlier" }, "Загружены раньше")
  const earlier = h("ul", { class: "recs", "aria-labelledby": "records-earlier" })
  const next = h("a", { class: "btn btn--main btn--start", href: stepPath(id, "plan") }, "Дальше: план", icon("right"))
  const body = h("div", { class: "body" }, h("div", { class: "head" }, heading, more), pick, mine, problem, loadProblem, earlierTitle, earlier, next, input)
  return { input, heading, more, pick, mine, problem, loadProblem, earlierTitle, earlier, next, body }
}

interface Live {
  readonly id: string
  readonly view: ReturnType<typeof layout>
  readonly shown: Map<string, { readonly signature: string; readonly node: HTMLElement }>
  readonly adding: Set<string>
  readonly onProject: (project: Api.ProjectView) => void
  shelves: Shelves
  open: string
  timer: number
  generation: number
}

const act = (live: Live, work: Effect.Effect<unknown, Api.Failed>): void => {
  live.view.problem.textContent = ""
  run(Effect.map(work, () => { refresh(live) }), (message) => { live.view.problem.textContent = message })
}

const addToReel = (live: Live, key: string, video: LibraryVideo): void => {
  live.adding.add(key)
  live.view.problem.textContent = ""
  render(live)
  const settle = (): void => { live.adding.delete(key) }
  run(Effect.map(Api.addVideos(live.id, [pickOf(video)]), () => {
    settle()
    refresh(live)
  }), (message) => {
    settle()
    live.view.problem.textContent = message
    render(live)
  })
}

const removeUploaded = (live: Live, name: string): void => {
  confirmRemoval({
    title: `Удалить запись «${name}»?`,
    what: "Запись пропадёт из загруженных. Вернуть её не получится.",
    note: "Ролики, в которые вы уже добавили эту запись, сохранят её. Исходный файл на вашем устройстве студия не трогает.",
    label: "Удалить запись",
    remove: Api.removeUploaded(name),
    onRemoved: () => {
      refresh(live)
      live.view.heading.focus()
    }
  })
}

const handlersOf = (live: Live): Handlers => ({
  retryReel: (name) => { act(live, Api.retryVideo(live.id, name)) },
  retryUploaded: (name) => { act(live, Api.retryUploaded(name)) },
  resend: (key) => { resend(live.id, key) },
  drop: (key) => { dropTake(live.id, key) },
  add: (key, video) => { addToReel(live, key, video) },
  remove: (name) => { removeUploaded(live, name) }
})

const sync = (live: Live, list: HTMLElement, rows: ReadonlyArray<Row>): void => {
  placeInOrder(list, rows.map((row) => {
    const open = row.key === live.open
    const signature = JSON.stringify([row, open])
    const kept = live.shown.get(row.key)
    if (kept?.signature === signature) return kept.node
    const node = rowNode(row, open, () => {
      live.open = open ? "" : row.key
      render(live)
    })
    keepFocus(kept?.node, node)
    live.shown.set(row.key, { signature, node })
    return node
  }))
}

const headingOf = (count: number, lengths: ReadonlyArray<number>): string => {
  if (count === 0) return "Загрузите записи"
  if (lengths.length === 0) return recordCount(count)
  return `${recordCount(count)} · ${formatLength(lengths.reduce((sum, length) => sum + length, 0))}`
}

function render(live: Live): void {
  const { view, shelves } = live
  const handlers = handlersOf(live)
  const joining = joiningTo(live.id)
  const mine = mineRows(live.id, shelves, joining, sendingTo(live.id), handlers)
  const earlier = earlierRows(shelves, joining, live.adding, handlers)
  const lengths = heardLengths(shelves)
  view.heading.textContent = headingOf(mine.length, lengths)
  view.more.hidden = mine.length === 0
  view.pick.hidden = mine.length > 0
  view.mine.hidden = mine.length === 0
  view.earlierTitle.hidden = earlier.length === 0
  view.earlier.hidden = earlier.length === 0
  view.next.hidden = lengths.length === 0
  const focusInRows = view.mine.contains(document.activeElement) || view.earlier.contains(document.activeElement)
  sync(live, view.mine, mine)
  sync(live, view.earlier, earlier)
  if (focusInRows) queueMicrotask(() => { if (!view.body.contains(document.activeElement)) view.heading.focus() })
  const keys = new Set([...mine, ...earlier].map((row) => row.key))
  for (const key of live.shown.keys()) if (!keys.has(key)) live.shown.delete(key)
  const problem = takeProblem(live.id)
  if (problem !== undefined) view.problem.textContent = problem
}

const later = (live: Live): void => {
  globalThis.clearTimeout(live.timer)
  live.timer = Number(globalThis.setTimeout(() => { refresh(live) }, POLL_MS))
}

function refresh(live: Live): void {
  globalThis.clearTimeout(live.timer)
  if (!live.view.body.isConnected) return
  keepJoining(live.id)
  live.generation += 1
  const generation = live.generation
  const current = (): boolean => generation === live.generation
  run(Effect.map(loadShelves(live.id), (shelves) => {
    if (!current()) return
    live.view.loadProblem.textContent = ""
    live.shelves = shelves
    live.onProject(shelves.project)
    render(live)
    if (joiningTo(live.id).length > 0 || stillHearing(shelves)) later(live)
  }), (message) => {
    if (!current()) return
    live.view.loadProblem.textContent = message
    later(live)
  })
}

const listen = (live: Live): void => {
  const { input, problem, body } = live.view
  const stop = onTakesChanged((settled) => {
    if (!body.isConnected) stop()
    else if (settled) refresh(live)
    else render(live)
  })
  input.addEventListener("change", () => {
    const videos = [...input.files ?? []]
    input.value = ""
    problem.textContent = ""
    sendTakes(live.id, videos)
  })
}

export const recordsStep = (project: Api.ProjectView, onProject: (project: Api.ProjectView) => void): Effect.Effect<HTMLElement, Api.Failed> =>
  Effect.map(loadShelves(project.id), (shelves) => {
    const live: Live = { id: project.id, view: layout(project.id), shown: new Map(), adding: new Set(), onProject, shelves, open: "", timer: 0, generation: 0 }
    listen(live)
    keepJoining(live.id)
    render(live)
    if (joiningTo(live.id).length > 0 || stillHearing(shelves)) later(live)
    return live.view.body
  })
