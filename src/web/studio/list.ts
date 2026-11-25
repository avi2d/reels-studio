import { Effect } from "effect"
import { stepPath } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatDay } from "../format.ts"
import { icon } from "./icons.ts"
import { editTitle } from "./title-sheet.ts"
import { button } from "./ui.ts"

const STATUS = { created: "Новый", uploaded: "Записи загружены", built: "Ролики готовы" } satisfies Record<Api.ProjectView["status"], string>

const thumb = (project: Api.ProjectView): HTMLElement =>
  h("span", { class: "reelcard__thumb" }, project.cover === undefined
    ? icon("film")
    : h("video", { muted: true, playsinline: true, preload: "metadata", tabindex: "-1", "aria-hidden": "true", src: `${Api.previewUrl(project.id, project.cover)}#t=0.5` }))

const card = (project: Api.ProjectView): HTMLElement =>
  h("li", {}, h("a", { class: "reelcard", href: stepPath(project.id, "records") },
    thumb(project),
    h("span", { class: "reelcard__text" }, h("b", {}, project.title), h("span", {}, `${formatDay(project.createdAt)} · ${STATUS[project.status]}`)),
    icon("right")))

export const listView = (projects: ReadonlyArray<Api.ProjectView>, onCreated: (id: string) => void): HTMLElement =>
  h("div", { class: "body" },
    h("div", { class: "head" },
      h("h1", { tabindex: "-1" }, "Ролики"),
      button("main", "Новый ролик", { click: () => {
        editTitle({ kind: "new" }, (title) => Effect.map(Api.createProject(title), ({ project }) => { onCreated(project.id) }))
      } }, "plus")),
    projects.length === 0
      ? h("p", { class: "hint" }, "Роликов пока нет. Нажмите «Новый ролик» и назовите первый.")
      : h("ul", { class: "reels" }, ...projects.map(card)))
