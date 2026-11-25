import { Effect } from "effect"
import { type LibraryVideo, pickOf } from "../../shared/library.ts"
import { STUDIO_PATH, stepPath } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatLength } from "../format.ts"
import { run } from "../run.ts"
import { icon } from "./icons.ts"
import { rowList, showKeepingFocus } from "./record-list.ts"
import { earlierRows, heardLengths, mineRows, type Shelves, stillHearing } from "./record-rows.ts"
import { recordCount } from "./takes.ts"

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
  const listening = h("p", { class: "hint" })
  const empty = h("div", { class: "pick" },
    h("p", { class: "hint" }, "Загруженных записей пока нет. Загрузите дубли на странице «Ролики», и они появятся здесь."),
    h("a", { class: "btn btn--quiet", href: STUDIO_PATH }, icon("upload"), "К загрузке видео"))
  const next = h("a", { class: "btn btn--main btn--start", href: stepPath(id, "plan") }, "Дальше: план", icon("right"))
  const body = h("div", { class: "body" }, heading, mine.node, problem, loadProblem, earlierTitle, earlier.node, listening, empty, next)
  return { heading, mine, problem, loadProblem, earlierTitle, earlier, listening, empty, next, body }
}

interface Live {
  readonly id: string
  readonly view: ReturnType<typeof layout>
  readonly adding: Set<string>
  readonly onProject: (project: Api.ProjectView) => void
  shelves: Shelves
  timer: number
  generation: number
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
  const earlier = earlierRows(shelves, live.adding, (key, video) => { addToReel(live, key, video) })
  const lengths = heardLengths(shelves)
  const { listening } = shelves.offer
  view.heading.textContent = headingOf(mine.length, lengths)
  view.earlierTitle.hidden = earlier.length === 0
  view.listening.hidden = listening === 0
  view.listening.textContent = `Ещё слушаю: ${recordCount(listening)}. Готовые записи появятся здесь сами.`
  view.empty.hidden = mine.length > 0 || earlier.length > 0 || listening > 0
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

export const recordsStep = (project: Api.ProjectView, onProject: (project: Api.ProjectView) => void): Effect.Effect<HTMLElement, Api.Failed> =>
  Effect.map(loadShelves(project.id), (shelves) => {
    const live: Live = { id: project.id, view: layout(project.id), adding: new Set(), onProject, shelves, timer: 0, generation: 0 }
    render(live)
    if (stillHearing(shelves)) later(live)
    return live.view.body
  })
