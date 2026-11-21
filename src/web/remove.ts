import { Effect } from "effect"
import * as Api from "./api.ts"
import { button, focusWhenReady } from "./controls.ts"
import { h } from "./dom.ts"

interface Removal {
  readonly title: string
  readonly what: string
  readonly note: string
  readonly label: string
  readonly remove: Effect.Effect<unknown, Api.Failed>
  readonly onRemoved: () => void
}

export const askToConfirmRemoval = ({ title, what, note, label, remove, onRemoved }: Removal): void => {
  const confirm = button("danger", {}, label)
  const cancel = button("quiet", {}, "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const dialog = h("dialog", { class: "confirm", "aria-labelledby": "remove-title" },
    h("h2", { id: "remove-title" }, title), h("p", {}, what), h("p", { class: "muted" }, note),
    h("div", { class: "row" }, confirm, cancel), problem)
  const state = { busy: false }
  dialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault() })
  dialog.addEventListener("close", () => { dialog.remove() })
  cancel.addEventListener("click", () => { dialog.close() })
  confirm.addEventListener("click", () => {
    state.busy = true
    confirm.disabled = true
    cancel.disabled = true
    confirm.textContent = "Удаляем…"
    problem.textContent = ""
    Effect.runFork(remove.pipe(
      Effect.map(() => {
        state.busy = false
        dialog.close()
        onRemoved()
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        state.busy = false
        confirm.disabled = false
        cancel.disabled = false
        confirm.textContent = label
        problem.textContent = error.message
      }))
    ))
  })
  document.body.append(dialog)
  dialog.showModal()
  focusWhenReady(cancel)
}

export const askToRemove = (project: { readonly id: string; readonly title: string }, onRemoved: () => void): void => {
  askToConfirmRemoval({
    title: `Удалить ролик «${project.title}»?`,
    what: "Удалятся чат, план и видео этого ролика. Вернуть их не получится.",
    note: "Видео, которые есть и в других роликах, там останутся. Исходные файлы на ваших устройствах студия не трогает. Если студия сейчас отвечает в чате или слушает видео этого ролика, она остановится.",
    label: "Удалить ролик",
    remove: Api.removeProject(project.id),
    onRemoved
  })
}
