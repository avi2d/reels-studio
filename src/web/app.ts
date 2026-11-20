import { Effect } from "effect"
import * as Api from "./api.ts"
import { chatDrawer } from "./chat.ts"
import { button, iconButton, tooltip } from "./controls.ts"
import { h } from "./dom.ts"
import { formatSize } from "./format.ts"
import { homeView } from "./home.ts"
import { startKit } from "./kit.ts"
import { libraryPicker } from "./library.ts"
import { shrinkWhenScrolledPast } from "./mini.ts"
import { oneAfterAnother } from "./queue.ts"
import { askToRemove } from "./remove.ts"
import { run } from "./run.ts"
import { stageRail, type StageId, type StageNote } from "./stages.ts"
import { timelineCard, type Status } from "./timeline.ts"
import { upload, videoShelf, type Progress } from "./upload.ts"
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
    ? h("p", { class: "muted" }, "Видео ещё не загружено.")
    : h("ul", { class: "files" }, ...project.files.map((file) => h("li", {}, h("span", {}, file.name), h("span", {}, formatSize(file.size)))))

const PICK_FIRST = "Загрузить видео"
const PICK_MORE = "Добавить ещё видео"

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)
const uploadsByProject = new Map<string, Array<HTMLElement>>()
const refreshByProject = new Map<string, () => Effect.Effect<void, Api.Failed>>()

const uploadKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`

const uploadRow = (projectId: string, file: File) => {
  const bar = h("progress", { max: "1", value: "0" })
  const status = h("p", { class: "muted", role: "status" }, "Ждёт своей очереди.")
  const node = h("li", { class: "upload" },
    h("div", { class: "name" }, h("span", {}, file.name), h("span", {}, formatSize(file.size))), bar, status)
  node.dataset.key = uploadKey(file)
  const onProgress = (progress: Progress): void => {
    if (progress.waiting) {
      status.textContent = "Связь пропала. Загрузка продолжится сама, когда связь вернётся."
      return
    }
    bar.value = progress.sent / progress.total
    const percent = Math.floor((progress.sent / progress.total) * 100)
    status.textContent = `Загружено ${formatSize(progress.sent)} из ${formatSize(progress.total)}, ${percent}%`
  }
  const failUpload = (message: string): void => {
    node.dataset.failed = "true"
    status.className = "error"
    bar.hidden = file.size === 0
    status.textContent = file.size === 0
      ? message
      : `${message} Выберите тот же файл ещё раз, и загрузка продолжится с того же места.`
  }
  const work = upload(videoShelf(projectId), file, onProgress).pipe(
    Effect.flatMap(() => (refreshByProject.get(projectId)?.() ?? Effect.void).pipe(
      Effect.map(() => {
        for (const kept of uploadsByProject.get(projectId) ?? []) {
          if (kept === node || kept.dataset.uploaded === "true") kept.remove()
        }
        uploadsByProject.set(projectId, (uploadsByProject.get(projectId) ?? []).filter((kept) => kept !== node && kept.dataset.uploaded !== "true"))
      }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        node.dataset.uploaded = "true"
        status.textContent = "Видео загружено. Список обновится при следующей загрузке."
      }))
    )),
    Effect.catch((error) => Effect.sync(() => {
      failUpload(error.message)
    })),
    Effect.catchDefect(() => Effect.sync(() => {
      failUpload("Не получилось загрузить.")
    }))
  )
  return { node, work }
}

const videoCard = (project: Api.ProjectView, onUploaded: () => void): HTMLElement => {
  const files = h("div", {}, fileList(project))
  const rows = h("ul", { class: "uploads" })
  if (!uploadsByProject.has(project.id)) uploadsByProject.set(project.id, [])
  rows.append(...(uploadsByProject.get(project.id) ?? []))
  const input = h("input", { class: "file-input", type: "file", accept: "video/*", multiple: true })
  const label = h("span", {}, project.files.length === 0 ? PICK_FIRST : PICK_MORE)
  const refresh = (): Effect.Effect<void, Api.Failed> =>
    Effect.map(Api.getProject(project.id), (fresh) => {
      files.replaceChildren(fileList(fresh.project))
      label.textContent = PICK_MORE
      onUploaded()
    })
  refreshByProject.set(project.id, refresh)
  const picker = libraryPicker(project.id, refresh)
  picker.reload()
  const add = (chosen: ReadonlyArray<File>): void => {
    const made: Array<{ node: HTMLElement; work: Effect.Effect<void> }> = []
    for (const file of chosen) {
      const key = uploadKey(file)
      const live = uploadsByProject.get(project.id) ?? []
      if (live.some((candidate) => candidate.dataset.key === key && candidate.dataset.failed !== "true")) continue
      const row = uploadRow(project.id, file)
      const stale = live.filter((candidate) => candidate.dataset.key === key && candidate.dataset.failed === "true")
      for (const old of stale) old.remove()
      uploadsByProject.set(project.id, [...(uploadsByProject.get(project.id) ?? []).filter((candidate) => !stale.includes(candidate)), row.node])
      made.push(row)
    }
    if (made.length === 0) return
    rows.append(...made.map((row) => row.node))
    enqueue(made.map((row) => row.work))
  }
  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })
  return h("section", { class: "card" }, h("h2", {}, "Видео"), files, rows,
    h("div", { class: "row" }, h("label", { class: "button" }, label, input), picker.open), picker.panel,
    h("p", { class: "muted" }, "Можно выбрать сразу несколько видео: они загрузятся по очереди. Не закрывайте страницу, пока идёт загрузка. Исходные видео студия не меняет."))
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
        if (seen.first && status.heard > 0) stages.open("takes")
        seen.first = false
      }
    })
    const refresh = (): void => {
      videos.refresh()
      timeline.refresh()
    }
    const chat = chatDrawer(project, messages, models, refresh)
    const remove = button("quiet", {
      class: "end",
      click: () => { askToRemove(project, () => { location.hash = "#/" }) }
    }, "Удалить ролик")
    const back = iconButton("plain", "back", "Все ролики", { class: "back", href: "#/" })
    const { panels } = timeline
    const stages = stageRail(
      { brief: h("div", { class: "pane" }, videoCard(project, refresh), videos.node, remove), takes: panels.takes, pauses: panels.pauses },
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

const route = (): void => {
  const match = /^#\/p\/([a-z0-9-]+)$/.exec(location.hash)
  document.title = "Студия Reels"
  const view = match?.[1] === undefined ? Effect.map(Api.listProjects, ({ projects }) => { show(homeView(projects, route)) }) : projectView(match[1])
  run(view, showFailure)
}

startKit()
globalThis.addEventListener("hashchange", route)
route()
