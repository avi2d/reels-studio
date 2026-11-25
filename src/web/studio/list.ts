import { Effect } from "effect"
import { stepPath } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatDay } from "../format.ts"
import { run } from "../run.ts"
import { icon } from "./icons.ts"
import { button, sheet } from "./ui.ts"

const STATUS = { created: "Новый", uploaded: "Записи загружены" } satisfies Record<Api.ProjectView["stage"], string>

const askForTitle = (onCreated: (id: string) => void): void => {
  const title = h("input", { class: "field", type: "text", name: "title", maxlength: "120", required: true, autocomplete: "off", placeholder: "Например: возврат без чека" })
  const problem = h("p", { class: "error", role: "alert" })
  const create = button("main", "Создать ролик", { type: "submit" })
  const cancel = button("quiet", "Отмена")
  const form = h("form", { class: "sheet__form" },
    h("h2", { id: "new-reel" }, "Новый ролик"),
    h("label", { class: "label" }, "Название", title),
    h("div", { class: "sheet__row" }, create, cancel),
    problem)
  const dialog = sheet("new-reel", form)
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    create.disabled = true
    problem.textContent = ""
    run(
      Effect.map(Api.createProject(title.value.trim()), ({ project }) => {
        dialog.close()
        onCreated(project.id)
      }),
      (message) => {
        problem.textContent = message
        create.disabled = false
      }
    )
  })
  cancel.addEventListener("click", () => { dialog.close() })
  dialog.showModal()
}

const thumb = (project: Api.ProjectView): HTMLElement =>
  h("span", { class: "reelcard__thumb" }, project.cover === undefined
    ? icon("film")
    : h("video", { muted: true, playsinline: true, preload: "metadata", tabindex: "-1", "aria-hidden": "true", src: `${Api.previewUrl(project.id, project.cover)}#t=0.5` }))

const card = (project: Api.ProjectView): HTMLElement =>
  h("li", {}, h("a", { class: "reelcard", href: stepPath(project.id, "records") },
    thumb(project),
    h("span", { class: "reelcard__text" }, h("b", {}, project.title), h("span", {}, `${formatDay(project.createdAt)} · ${STATUS[project.stage]}`)),
    icon("right")))

export const listView = (projects: ReadonlyArray<Api.ProjectView>, onCreated: (id: string) => void): HTMLElement =>
  h("div", { class: "body" },
    h("div", { class: "head" },
      h("h1", { tabindex: "-1" }, "Ролики"),
      button("main", "Новый ролик", { click: () => { askForTitle(onCreated) } }, "plus")),
    projects.length === 0
      ? h("p", { class: "hint" }, "Роликов пока нет. Нажмите «Новый ролик» и назовите первый.")
      : h("ul", { class: "reels" }, ...projects.map(card)))
