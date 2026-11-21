import { Effect } from "effect"
import { HOME_PATH, PROJECT_PREFIX, VIDEOS_PATH, projectPath } from "../shared/page.ts"
import * as Api from "./api.ts"
import { briefCards } from "./brief.ts"
import { chatDrawer } from "./chat.ts"
import { button, iconButton, tooltip } from "./controls.ts"
import { h } from "./dom.ts"
import { formatSize } from "./format.ts"
import { homeView } from "./home.ts"
import { startKit } from "./kit.ts"
import { libraryPicker } from "./library.ts"
import { shrinkWhenScrolledPast } from "./mini.ts"
import { askToRemove } from "./remove.ts"
import { run } from "./run.ts"
import { reelPane } from "./reel.ts"
import { stageRail, type StageId, type StageNote } from "./stages.ts"
import { timelineCard, type Status } from "./timeline.ts"
import { uploadedView } from "./uploaded.ts"
import { videosCard } from "./videos.ts"

const app = document.querySelector("#app") ?? document.body

let disposeChat: (() => void) | undefined

const show = (...nodes: ReadonlyArray<Node>): void => {
  disposeChat?.()
  disposeChat = undefined
  app.replaceChildren(...nodes)
}

const showFailure = (message: string): void => {
  show(h("div", { class: "home" }, h("p", { class: "error", role: "alert" }, message), h("a", { class: "back", href: HOME_PATH }, "← Все ролики")))
}

const fileList = (project: Api.ProjectView): HTMLElement =>
  project.files.length === 0
    ? h("p", { class: "muted" }, "Видео ещё не добавлено.")
    : h("ul", { class: "files" }, ...project.files.map((file) => h("li", {}, h("span", {}, file.name), h("span", {}, formatSize(file.size)))))


const videoCard = (project: Api.ProjectView, onAdded: () => void): HTMLElement => {
  const files = h("div", {}, fileList(project))
  const refresh = (): Effect.Effect<void, Api.Failed> =>
    Effect.map(Api.getProject(project.id), (fresh) => {
      files.replaceChildren(fileList(fresh.project))
      onAdded()
    })
  const picker = libraryPicker(project.id, refresh)
  picker.reload()
  return h("section", { class: "card" }, h("h2", {}, "Видео"), files, picker.hint, h("div", { class: "row" }, picker.open), picker.panel, picker.loadError)
}

const countNote = (count: number): string => count === 0 ? "" : String(count)

const pausesNote = ({ pauses, places }: Status): string => {
  const removed = pauses.total === 0 ? "" : `${pauses.removed} из ${pauses.total}`
  const check = places === 0 ? "" : `проверить ${places}`
  return [removed, check].filter((part) => part !== "").join(" · ")
}

const stageNotes = ({ blocks, heard, pauses, places, placesComplete }: Status): Readonly<Record<Exclude<StageId, "file">, StageNote>> => ({
  brief: { note: countNote(heard), done: heard > 0 },
  takes: { note: countNote(blocks ?? 0), done: blocks !== undefined },
  pauses: {
    note: pausesNote({ blocks, heard, pauses, places, placesComplete }),
    done: pauses.total > 0 && pauses.removed === pauses.total && places === 0 && placesComplete
  }
})

const projectView = (id: string): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const [{ project }, { messages }, { models }] = yield* Effect.all([Api.getProject(id), Api.getChat(id), Api.getModels], { concurrency: 3 })
    document.title = `${project.title} · Студия Reels`
    const videos = videosCard(project.id)
    const reel = h("div", { class: "reel blank" })
    const seen = { first: true }
    const activeStage: { now: StageId } = { now: "brief" }
    let builtPane: ReturnType<typeof reelPane> | undefined
    const timeline = timelineCard(project.id, {
      ask: (message) => { chat.ask(message) },
      openTakes: () => { if (stages.now() === "brief") stages.open("takes") },
      status: (status) => {
        const notes = stageNotes(status)
        stages.note("brief", notes.brief)
        stages.note("takes", notes.takes)
        stages.note("pauses", notes.pauses)
        reel.classList.toggle("blank", status.blocks === undefined)
        if (seen.first && status.blocks !== undefined) stages.open("takes")
        seen.first = false
      },
      edited: () => { builtPane?.edited() },
      settled: (ok) => { builtPane?.settled(ok) },
      active: () => activeStage.now !== "file"
    })
    const built = reelPane(project.id, {
      note: (note) => { stages.note("file", note) },
      playing: () => { timeline.stop() },
      flush: () => timeline.flush(),
      pending: () => timeline.busy()
    })
    builtPane = built
    const brief = briefCards(project.id, (message) => { chat.ask(message) }, () => { timeline.refresh() })
    const refresh = (): void => {
      videos.refresh()
      timeline.refresh()
      brief.refresh()
      built.refresh()
    }
    const chat = chatDrawer(project, messages, models, refresh)
    const remove = button("quiet", {
      class: "end",
      click: () => { askToRemove(project, () => { navigate(HOME_PATH) }) }
    }, "Удалить ролик")
    const back = iconButton("plain", "back", "Все ролики", { class: "back", href: HOME_PATH })
    const { panels } = timeline
    const stages = stageRail(
      { brief: h("div", { class: "pane" }, videoCard(project, refresh), ...brief.nodes, videos.node, remove), takes: panels.takes, pauses: panels.pauses, file: built.node },
      panels.tracks,
      (stage) => {
        activeStage.now = stage
        reel.dataset.stage = stage
        if (stage !== "file") return built.pause()
        timeline.stop()
        void timeline.flush().then(() => { built.refresh() })
      })
    reel.append(
      h("header", { class: "bar" },
        back, tooltip(back, "bar-back", "Все ролики"), h("h1", {}, project.title),
        panels.history, chat.opener),
      panels.viewer,
      h("div", { class: "dock" }, panels.summary),
      h("div", { class: "board" }, stages.rail),
      chat.node)
    show(reel)
    disposeChat = chat.dispose
    shrinkWhenScrolledPast(panels.viewer)
    refresh()
  })

type Page = { readonly kind: "home" } | { readonly kind: "videos" } | { readonly kind: "project"; readonly id: string }

const pageAt = (pathname: string): Page | undefined => {
  if (pathname === HOME_PATH) return { kind: "home" }
  const path = pathname.replace(/\/$/, "")
  if (path === VIDEOS_PATH) return { kind: "videos" }
  const id = path.startsWith(PROJECT_PREFIX) ? path.slice(PROJECT_PREFIX.length) : ""
  return /^[a-z0-9-]+$/.test(id) ? { kind: "project", id } : undefined
}

let stopPageLoad: (() => void) | undefined

const route = (): void => {
  stopPageLoad?.()
  stopPageLoad = undefined
  const page = pageAt(location.pathname)
  document.title = "Студия Reels"
  if (page?.kind === "videos") {
    document.title = "Загруженные видео · Студия Reels"
    show(uploadedView())
    return
  }
  const view = page?.kind === "project" ? projectView(page.id) : Effect.map(Api.listProjects, ({ projects }) => {
    show(homeView(projects, {
      created: (id) => { navigate(projectPath(id)) },
      removed: route
    }))
  })
  stopPageLoad = run(view, showFailure)
}

function navigate(address: string | URL): void {
  history.pushState(null, "", address)
  route()
}

const clickedPage = (event: MouseEvent): URL | undefined => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement)
  if (link === undefined || !link.hasAttribute("href") || (link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return
  const url = new URL(link.href)
  if (url.origin === location.origin && url.hash === "" && pageAt(url.pathname) !== undefined) return url
}

if (location.pathname === HOME_PATH && location.hash.startsWith("#/")) {
  const path = location.hash.slice(1)
  if (pageAt(path) !== undefined) history.replaceState(history.state, "", path + location.search)
}
startKit()
document.addEventListener("click", (event) => {
  const url = clickedPage(event)
  if (url === undefined) return
  event.preventDefault()
  navigate(url)
})
globalThis.addEventListener("popstate", route)
route()
