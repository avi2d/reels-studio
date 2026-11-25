import { Effect } from "effect"
import { STEPS, STUDIO_PATH, projectPath, stepPath, type Step } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { REEL_REMOVAL } from "../remove.ts"
import { icon } from "./icons.ts"
import { button, menuButton, sheet } from "./ui.ts"

const STEP_NAMES = { records: "Записи", plan: "План", montage: "Монтаж", look: "Оформление", done: "Ролики" } satisfies Record<Step, string>

export const stepName = (step: Step): string => STEP_NAMES[step]

const confirmRemoval = (project: Api.ProjectView, onRemoved: () => void): void => {
  const confirm = button("danger", REEL_REMOVAL.label)
  const cancel = button("quiet", "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const dialog = sheet("remove-reel",
    h("h2", { id: "remove-reel" }, REEL_REMOVAL.title(project.title)),
    h("p", {}, REEL_REMOVAL.what),
    h("p", { class: "hint" }, REEL_REMOVAL.note),
    h("div", { class: "sheet__row" }, confirm, cancel),
    problem)
  const busy = (on: boolean): void => {
    dialog.toggleAttribute("data-busy", on)
    confirm.disabled = on
    cancel.disabled = on
    confirm.textContent = on ? "Удаляем…" : REEL_REMOVAL.label
  }
  dialog.addEventListener("cancel", (event) => { if (dialog.hasAttribute("data-busy")) event.preventDefault() })
  cancel.addEventListener("click", () => { dialog.close() })
  confirm.addEventListener("click", () => {
    busy(true)
    problem.textContent = ""
    Effect.runFork(Api.removeProject(project.id).pipe(
      Effect.map(() => {
        busy(false)
        dialog.close()
        onRemoved()
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        busy(false)
        problem.textContent = error.message
      }))
    ))
  })
  dialog.showModal()
  cancel.focus()
}

export const topBar = (reel?: { readonly project: Api.ProjectView; readonly removed: () => void }): HTMLElement =>
  h("header", { class: "top" },
    h("a", { class: "top__home", href: STUDIO_PATH }, ...reel === undefined ? [] : [icon("left")], "Студия"),
    ...reel === undefined ? [] : [
      h("span", { class: "top__name" }, reel.project.title),
      menuButton("Ещё", [{ label: "Удалить ролик", icon: "trash", danger: true, run: () => { confirmRemoval(reel.project, reel.removed) } }])
    ])

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
