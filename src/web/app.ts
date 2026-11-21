import { Effect } from "effect"
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
  show(h("div", { class: "home" }, h("p", { class: "error", role: "alert" }, message), h("a", { class: "back", href: "#/" }, "← Все ролики")))
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

const stageNotes = ({ blocks, heard, pauses }: Status): Readonly<Record<StageId, StageNote>> => ({
  brief: { note: countNote(heard), done: heard > 0 },
  takes: { note: countNote(blocks ?? 0), done: blocks !== undefined },
  pauses: {
    note: pauses.total === 0 ? "" : `${pauses.removed} из ${pauses.total}`,
    done: pauses.total > 0 && pauses.removed === pauses.total
  }
})

const projectView = (id: string): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const [{ project }, { messages }, { models }] = yield* Effect.all([Api.getProject(id), Api.getChat(id), Api.getModels], { concurrency: 3 })
    document.title = `${project.title} · Студия Reels`
    const videos = videosCard(project.id)
    const reel = h("div", { class: "reel blank" })
    const seen = { first: true }
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
      }
    })
    const brief = briefCards(project.id, (message) => { chat.ask(message) }, () => { timeline.refresh() })
    const refresh = (): void => {
      videos.refresh()
      timeline.refresh()
      brief.refresh()
    }
    const chat = chatDrawer(project, messages, models, refresh)
    const remove = button("quiet", {
      class: "end",
      click: () => { askToRemove(project, () => { location.hash = "#/" }) }
    }, "Удалить ролик")
    const back = iconButton("plain", "back", "Все ролики", { class: "back", href: "#/" })
    const { panels } = timeline
    const stages = stageRail(
      { brief: h("div", { class: "pane" }, videoCard(project, refresh), ...brief.nodes, videos.node, remove), takes: panels.takes, pauses: panels.pauses },
      panels.tracks,
      (stage) => { reel.dataset.stage = stage })
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

const VIDEOS = "#/videos"

const route = (): void => {
  const match = /^#\/p\/([a-z0-9-]+)$/.exec(location.hash)
  document.title = "Студия Reels"
  if (location.hash === VIDEOS) {
    document.title = "Загруженные видео · Студия Reels"
    show(uploadedView())
    return
  }
  const view = match?.[1] === undefined ? Effect.map(Api.listProjects, ({ projects }) => { show(homeView(projects, route)) }) : projectView(match[1])
  run(view, showFailure)
}

startKit()
globalThis.addEventListener("hashchange", route)
route()
