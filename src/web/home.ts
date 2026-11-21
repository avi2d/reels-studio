import { Effect } from "effect"
import { VIDEOS_PATH, projectPath } from "../shared/page.ts"
import * as Api from "./api.ts"
import { button, iconButton } from "./controls.ts"
import { h } from "./dom.ts"
import { formatDay } from "./format.ts"
import { askToRemove } from "./remove.ts"
import { run } from "./run.ts"

const askForTitle = (onCreated: (id: string) => void): void => {
  const title = h("input", { type: "text", name: "title", maxlength: "120", required: true, autocomplete: "off", placeholder: "Например: нотариальный осмотр сайта" })
  const problem = h("p", { class: "error", role: "alert" })
  const create = button("primary", { type: "submit" }, "Создать ролик")
  const cancel = button("quiet", { type: "button" }, "Отмена")
  const form = h("form", {
    submit: (event) => {
      event.preventDefault()
      create.disabled = true
      problem.textContent = ""
      run(
        Effect.map(Api.createProject(title.value), ({ project }) => {
          dialog.close()
          onCreated(project.id)
        }),
        (message) => {
          problem.textContent = message
          create.disabled = false
        }
      )
    }
  }, h("h2", { id: "new-title" }, "Новый ролик"), h("label", {}, "Название", title), h("div", { class: "row" }, create, cancel), problem)
  const dialog = h("dialog", { class: "confirm", "aria-labelledby": "new-title" }, form)
  dialog.addEventListener("close", () => { dialog.remove() })
  cancel.addEventListener("click", () => { dialog.close() })
  document.body.append(dialog)
  dialog.showModal()
}

const cover = (project: Api.ProjectView): HTMLElement => {
  const state = h("span", { class: "state" }, project.stage === "created" ? "Ждёт видео" : `Видео: ${project.files.length}`)
  if (project.cover === undefined) return h("span", { class: "cover" }, state)
  const frame = h("video", {
    muted: true,
    playsinline: true,
    preload: "metadata",
    tabindex: "-1",
    "aria-hidden": "true",
    src: `${Api.previewUrl(project.id, project.cover)}#t=0.5`
  })
  return h("span", { class: "cover" }, frame, state)
}

const tile = (project: Api.ProjectView, onRemoved: () => void): HTMLElement =>
  h("li", { class: project.stage === "created" ? "tile waits" : "tile" },
    h("a", { href: projectPath(project.id) }, cover(project), h("b", {}, project.title), h("small", {}, formatDay(project.createdAt))),
    iconButton("normal", "close", `Удалить ролик «${project.title}»`, {
      class: "del",
      size: "s",
      pill: true,
      title: "Удалить ролик",
      click: () => { askToRemove(project, onRemoved) }
    }))

const countsOf = (projects: ReadonlyArray<Api.ProjectView>): HTMLElement => {
  const waiting = projects.filter((project) => project.stage === "created").length
  return waiting === 0
    ? h("span", { class: "sum" }, projects.length === 0 ? "" : `Роликов: ${projects.length}`)
    : h("span", { class: "sum waits" }, `Ждут видео: ${waiting} из ${projects.length}`)
}

export const homeView = (projects: ReadonlyArray<Api.ProjectView>, on: {
  readonly created: (id: string) => void
  readonly removed: () => void
}): HTMLElement =>
  h("div", { class: "home" },
    h("header", { class: "top" },
      h("h1", { class: "brand" }, "Студия Reels"),
      countsOf(projects),
      h("div", { class: "actions" }, button("normal", { href: VIDEOS_PATH }, "Загрузить видео"), button("primary", { click: () => { askForTitle(on.created) } }, "Новый ролик"))),
    projects.length === 0
      ? h("p", { class: "none" }, "Роликов пока нет. Загрузите видео, затем нажмите «Новый ролик» и назовите первый.")
      : h("ul", { class: "grid" }, ...projects.map((project) => tile(project, on.removed))))
