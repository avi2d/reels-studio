import { Effect } from "effect"
import { pickOf } from "../../shared/library.ts"
import { STUDIO_PATH, stepPath } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { run } from "../run.ts"
import { icon } from "./icons.ts"
import { rowList, showKeepingFocus } from "./record-list.ts"
import { earlierRows, heardLengths, mineRows, offerKey, type Shelves, stillHearing } from "./record-rows.ts"
import { recordCount } from "./takes.ts"
import { button } from "./ui.ts"
import { onTakesChanged, sendingNow } from "./uploads.ts"

const POLL_MS = 4000

const loadShelves = (id: string): Effect.Effect<Shelves, Api.Failed> =>
  Effect.map(
    Effect.all({ reel: Api.getVideos(id), offer: Api.getLibrary(id), project: Api.getProject(id) }, { concurrency: "unbounded" }),
    ({ reel, offer, project }) => ({ reel: reel.videos, offer, project: project.project })
  )

const layout = (id: string) => {
  const heading = h("h1", { tabindex: "-1" })
  const mine = rowList({ "aria-label": "Записи ролика" })
  const problem = h("p", { class: "error", role: "alert" })
  const loadProblem = h("p", { class: "error", role: "alert" })
  const earlierTitle = h("h2", { class: "recs-title", id: "records-earlier" }, "Загружены раньше")
  const earlier = rowList({ "aria-labelledby": "records-earlier" })
  const add = button("main", "Добавить в ролик", { class: "btn btn--main btn--start" }, "plus")
  const all = button("quiet", "Выбрать все", { class: "btn btn--quiet btn--sm" })
  const choose = h("div", { class: "choose" },
    h("p", { class: "hint" }, "Отметьте записи, которые нужны в ролике, и нажмите «Добавить в ролик»."),
    earlier.node,
    h("div", { class: "choose__bar" }, add, all))
  const sending = h("p", { class: "hint" })
  const listening = h("p", { class: "hint" })
  const empty = h("div", { class: "pick" },
    h("p", { class: "hint" }, "Загруженных записей пока нет. Загрузите дубли на странице «Ролики», и они появятся здесь."),
    h("a", { class: "btn btn--quiet", href: STUDIO_PATH }, icon("upload"), "К загрузке видео"))
  const next = h("a", { class: "btn btn--main btn--start", href: stepPath(id, "plan") }, "Дальше: план", icon("right"))
  const body = h("div", { class: "body" }, heading, mine.node, problem, loadProblem, earlierTitle, choose, sending, listening, empty, next)
  return { heading, mine, problem, loadProblem, earlierTitle, earlier, add, all, choose, sending, listening, empty, next, body }
}

interface Live {
  readonly id: string
  readonly view: ReturnType<typeof layout>
  readonly adding: Set<string>
  readonly chosen: Set<string>
  readonly onProject: (project: Api.ProjectView) => void
  shelves: Shelves
  timer: number
  generation: number
}

const addChosen = (live: Live): void => {
  const videos = live.shelves.offer.videos.filter((video) => live.chosen.has(offerKey(video)))
  if (videos.length === 0) return
  const keys = videos.map(offerKey)
  for (const key of keys) {
    live.chosen.delete(key)
    live.adding.add(key)
  }
  live.view.problem.textContent = ""
  render(live)
  const settle = (): void => { for (const key of keys) live.adding.delete(key) }
  run(Effect.map(Api.addVideos(live.id, videos.map(pickOf)), () => {
    refresh(live)
  }), (message) => {
    settle()
    for (const key of keys) live.chosen.add(key)
    live.view.problem.textContent = message
    render(live)
  })
}

const toggle = (live: Live, key: string): void => {
  if (!live.chosen.delete(key)) live.chosen.add(key)
  render(live)
}

const toggleAll = (live: Live): void => {
  const free = live.shelves.offer.videos.map(offerKey).filter((key) => !live.adding.has(key))
  const every = free.every((key) => live.chosen.has(key))
  for (const key of free) {
    if (every) live.chosen.delete(key)
    else live.chosen.add(key)
  }
  render(live)
}

const retryReel = (live: Live, name: string): void => {
  live.view.problem.textContent = ""
  run(Effect.map(Api.retryVideo(live.id, name), () => { refresh(live) }), (message) => { live.view.problem.textContent = message })
}

const headingOf = (count: number, lengths: ReadonlyArray<number>): string => {
  if (count === 0) return "Выберите записи"
  if (lengths.length === 0) return recordCount(count)
  return `${recordCount(count)} · ${formatLength(lengths.reduce((sum, length) => sum + length, 0))}`
}

function render(live: Live): void {
  const { view, shelves } = live
  const mine = mineRows(live.id, shelves, (name) => { retryReel(live, name) })
  const offered = new Set(shelves.offer.videos.map(offerKey))
  for (const key of live.adding) if (!offered.has(key)) live.adding.delete(key)
  for (const key of live.chosen) if (!offered.has(key)) live.chosen.delete(key)
  const earlier = earlierRows(shelves, live.adding, live.chosen, (key) => { toggle(live, key) })
  const free = earlier.filter((row) => row.choice !== undefined)
  const count = live.chosen.size
  const lengths = heardLengths(shelves)
  const { listening } = shelves.offer
  const sending = sendingNow().filter((entry) => entry.take.kind !== "unsent").length
  view.heading.textContent = headingOf(mine.length, lengths)
  view.earlierTitle.hidden = earlier.length === 0
  view.choose.hidden = earlier.length === 0
  if (count === 0 && view.add === document.activeElement) view.heading.focus()
  view.add.disabled = count === 0
  view.add.lastChild?.replaceWith(count === 0 ? "Добавить в ролик" : `Добавить в ролик: ${recordCount(count)}`)
  view.all.hidden = free.length < 2
  view.all.disabled = free.length === 0
  view.all.textContent = free.length > 0 && free.every((row) => row.choice?.checked === true) ? "Снять выбор" : "Выбрать все"
  view.sending.hidden = sending === 0
  view.sending.textContent = `Ещё загружаю: ${recordCount(sending)}. Готовые записи появятся здесь сами.`
  view.listening.hidden = listening === 0
  view.listening.textContent = `Ещё слушаю: ${recordCount(listening)}. Готовые записи появятся здесь сами.`
  view.empty.hidden = mine.length > 0 || earlier.length > 0 || listening > 0 || sending > 0
  view.next.hidden = lengths.length === 0
  showKeepingFocus(view.heading, [[view.mine, mine], [view.earlier, earlier]])
}

const later = (live: Live): void => {
  globalThis.clearTimeout(live.timer)
  live.timer = Number(globalThis.setTimeout(() => { refresh(live) }, POLL_MS))
}

function refresh(live: Live): void {
  globalThis.clearTimeout(live.timer)
  if (!live.view.body.isConnected) return
  live.generation += 1
  const generation = live.generation
  const current = (): boolean => generation === live.generation
  run(Effect.map(loadShelves(live.id), (shelves) => {
    if (!current()) return
    live.view.loadProblem.textContent = ""
    live.shelves = shelves
    live.onProject(shelves.project)
    render(live)
    if (stillHearing(shelves)) later(live)
  }), (message) => {
    if (!current()) return
    live.view.loadProblem.textContent = message
    later(live)
  })
}

const listen = (live: Live): void => {
  const stop = onTakesChanged((change) => {
    if (!live.view.body.isConnected) {
      stop()
      return
    }
    switch (change.kind) {
      case "moved": return render(live)
      case "listed":
      case "unlisted": return refresh(live)
    }
  })
}

export const recordsStep = (project: Api.ProjectView, onProject: (project: Api.ProjectView) => void): Effect.Effect<HTMLElement, Api.Failed> =>
  Effect.map(loadShelves(project.id), (shelves) => {
    const live: Live = { id: project.id, view: layout(project.id), adding: new Set(), chosen: new Set(), onProject, shelves, timer: 0, generation: 0 }
    live.view.add.addEventListener("click", () => { addChosen(live) })
    live.view.all.addEventListener("click", () => { toggleAll(live) })
    listen(live)
    render(live)
    if (stillHearing(shelves)) later(live)
    return live.view.body
  })
