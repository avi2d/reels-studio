import { Effect } from "effect"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"

export const askToRemove = (project: { readonly id: string; readonly title: string }, onRemoved: () => void): void => {
  const confirm = button("danger", {}, "Удалить ролик")
  const cancel = button("quiet", {}, "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const dialog = h("dialog", { class: "confirm", "aria-labelledby": "remove-title" },
    h("h2", { id: "remove-title" }, `Удалить ролик «${project.title}»?`),
    h("p", {}, "Удалятся чат, план и видео этого ролика. Вернуть их не получится."),
    h("p", { class: "muted" }, "Видео, которые есть и в других роликах, там останутся. Исходные файлы на ваших устройствах студия не трогает. Если студия сейчас отвечает в чате или слушает видео этого ролика, она остановится."),
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
    Effect.runFork(Api.removeProject(project.id).pipe(
      Effect.map(() => {
        state.busy = false
        dialog.close()
        onRemoved()
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        state.busy = false
        confirm.disabled = false
        cancel.disabled = false
        confirm.textContent = "Удалить ролик"
        problem.textContent = error.message
      }))
    ))
  })
  document.body.append(dialog)
  dialog.showModal()
  cancel.focus()
}
