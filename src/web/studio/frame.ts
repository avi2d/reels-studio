import { Effect } from "effect"
import { STEPS, STUDIO_PATH, projectPath, stepPath, type Step } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { REEL_REMOVAL } from "../remove.ts"
import { icon } from "./icons.ts"
import { editTitle } from "./title-sheet.ts"
import { confirmRemoval, menuButton } from "./ui.ts"

const STEP_NAMES = { records: "Записи", plan: "План", montage: "Монтаж", look: "Оформление", done: "Ролики" } satisfies Record<Step, string>

export const stepName = (step: Step): string => STEP_NAMES[step]

const removeReel = (project: Api.ProjectView, onRemoved: () => void): void => {
  confirmRemoval({
    title: REEL_REMOVAL.title(project.title),
    what: REEL_REMOVAL.what,
    note: REEL_REMOVAL.note,
    label: REEL_REMOVAL.label,
    remove: Api.removeProject(project.id),
    onRemoved
  })
}

interface ReelBar {
  readonly project: Api.ProjectView
  readonly removed: () => void
  readonly renamed: (title: string) => void
}

export const topBar = (reel?: ReelBar): HTMLElement => {
  const home = h("a", { class: "top__home", href: STUDIO_PATH }, ...reel === undefined ? [] : [icon("left")], "Студия")
  const header = h("header", { class: "top" }, home)
  if (reel === undefined) return header

  let project = reel.project
  const name = h("span", { class: "top__name" }, project.title)
  const rename = (): void => {
    editTitle({ kind: "rename", title: project.title }, (title) => Effect.map(Api.renameProject(project.id, title), (saved) => {
      project = saved.project
      name.textContent = project.title
      reel.renamed(project.title)
    }))
  }
  header.append(name, menuButton("Ещё", [
    { label: "Переименовать", icon: "pencil", danger: false, run: rename },
    { label: "Удалить ролик", icon: "trash", danger: true, run: () => { removeReel(project, reel.removed) } }
  ]))
  return header
}

const isDone = (project: Api.ProjectView, step: Step): boolean => step === "records" && project.stage === "uploaded"

const stepLink = (project: Api.ProjectView, current: Step) => (step: Step, index: number): HTMLElement => {
  const on = step === current
  const done = isDone(project, step)
  return h("li", {}, h("a", {
    class: ["step", on ? "step--on" : "", done ? "step--done" : ""].filter((name) => name !== "").join(" "),
    href: stepPath(project.id, step),
    "aria-label": `Шаг ${index + 1}: ${STEP_NAMES[step]}`,
    "aria-current": on ? "step" : false
  },
  h("span", { class: "step__mark" }, done && !on ? icon("check") : String(index + 1)),
  h("span", { class: "step__text" }, h("b", {}, STEP_NAMES[step]))))
}

export const rail = (project: Api.ProjectView, current: Step): HTMLElement =>
  h("nav", { class: "rail", "aria-label": "Шаги" },
    h("ol", { class: "steps" }, ...STEPS.map(stepLink(project, current))),
    h("p", { class: "steps__now" }, `${STEPS.indexOf(current) + 1} из ${STEPS.length} · `, h("b", {}, STEP_NAMES[current])))

export const stepBody = (project: Api.ProjectView, step: Step): HTMLElement =>
  h("div", { class: "body" },
    h("h1", { tabindex: "-1" }, STEP_NAMES[step]),
    h("p", { class: "hint" }, "Этот шаг пока работает в прежней студии."),
    h("a", { class: "btn btn--quiet btn--start", href: projectPath(project.id) }, "Открыть в прежней студии"))
