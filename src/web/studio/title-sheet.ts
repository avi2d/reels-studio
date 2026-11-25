import { Effect } from "effect"
import type { Failed } from "../api.ts"
import { h } from "../dom.ts"
import { run } from "../run.ts"
import { button, sheet } from "./ui.ts"

const COPY = {
  new: { heading: "Новый ролик", save: "Создать ролик", pending: "Создаём…", placeholder: "Например: возврат без чека" },
  rename: { heading: "Переименовать ролик", save: "Сохранить название", pending: "Сохраняем…" }
}

type TitleSheet = { readonly kind: "new" } | { readonly kind: "rename"; readonly title: string }

export const editTitle = (mode: TitleSheet, save: (title: string) => Effect.Effect<void, Failed>): void => {
  const copy = COPY[mode.kind]
  const title = h("input", {
    class: "field", type: "text", name: "title", maxlength: "120", required: true, autocomplete: "off",
    ...mode.kind === "new" ? { placeholder: COPY.new.placeholder } : { value: mode.title }
  })
  const problem = h("p", { class: "error", role: "alert" })
  const submit = button("main", copy.save, { type: "submit" })
  const cancel = button("quiet", "Отмена")
  const form = h("form", { class: "sheet__form" },
    h("h2", { id: "reel-title" }, copy.heading),
    h("label", { class: "label" }, "Название", title),
    h("div", { class: "sheet__row" }, submit, cancel),
    problem)
  const dialog = sheet("reel-title", form)
  const busy = (on: boolean): void => {
    title.readOnly = on
    submit.disabled = on
    cancel.disabled = on
    submit.textContent = on ? copy.pending : copy.save
  }
  dialog.addEventListener("cancel", (event) => { if (submit.disabled) event.preventDefault() })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    if (submit.disabled) return
    busy(true)
    problem.textContent = ""
    run(Effect.map(save(title.value.trim()), () => { dialog.close() }), (message) => {
      busy(false)
      problem.textContent = message
      title.focus()
    })
  })
  cancel.addEventListener("click", () => { dialog.close() })
  dialog.showModal()
  if (mode.kind === "rename") title.select()
}
