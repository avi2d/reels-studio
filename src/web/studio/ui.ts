import { Effect } from "effect"
import type { Failed } from "../api.ts"
import { h, type Props } from "../dom.ts"
import { icon, type IconName } from "./icons.ts"

type Kind = "main" | "quiet" | "plain" | "danger"

export const button = (kind: Kind, label: string, props: Props = {}, lead?: IconName): HTMLButtonElement =>
  h("button", { class: `btn btn--${kind}`, type: "button", ...props }, ...lead === undefined ? [] : [icon(lead)], label)

export interface MenuItem {
  readonly label: string
  readonly icon: IconName
  readonly danger: boolean
  readonly run: () => void
}

export const menuButton = (label: string, items: ReadonlyArray<MenuItem>): HTMLElement => {
  const trigger = h("button", { class: "btn btn--plain btn--icon", type: "button", title: label, "aria-label": label, "aria-haspopup": "menu", "aria-expanded": "false" }, icon("more"))
  const list = h("div", { class: "menu", role: "menu", hidden: true })
  const box = h("div", { class: "more" }, trigger, list)
  const away = (event: PointerEvent): void => { if (!box.contains(event.target instanceof Node ? event.target : null)) close() }
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return
    close()
    trigger.focus()
  }
  function close(): void {
    list.hidden = true
    trigger.setAttribute("aria-expanded", "false")
    document.removeEventListener("pointerdown", away, true)
    document.removeEventListener("keydown", escape, true)
  }
  const open = (): void => {
    list.hidden = false
    trigger.setAttribute("aria-expanded", "true")
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", escape, true)
    list.querySelector("button")?.focus()
  }
  list.append(...items.map((item) =>
    h("button", { class: item.danger ? "menu__item menu__item--danger" : "menu__item", type: "button", role: "menuitem", click: () => {
      close()
      item.run()
    } }, icon(item.icon), item.label)))
  trigger.addEventListener("click", () => { if (list.hidden) open(); else close() })
  return box
}

export const sheet = (id: string, ...children: ReadonlyArray<Node>): HTMLDialogElement => {
  const dialog = h("dialog", { class: "sheet", "aria-labelledby": id }, ...children)
  dialog.addEventListener("close", () => { dialog.remove() })
  document.body.append(dialog)
  return dialog
}

export interface Removal {
  readonly title: string
  readonly what: string
  readonly note: string
  readonly label: string
  readonly remove: Effect.Effect<unknown, Failed>
  readonly onRemoved: () => void
}

export const confirmRemoval = ({ title, what, note, label, remove, onRemoved }: Removal): void => {
  const confirm = button("danger", label)
  const cancel = button("quiet", "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const dialog = sheet("remove-what",
    h("h2", { id: "remove-what" }, title),
    h("p", {}, what),
    h("p", { class: "hint" }, note),
    h("div", { class: "sheet__row" }, confirm, cancel),
    problem)
  const busy = (on: boolean): void => {
    dialog.toggleAttribute("data-busy", on)
    confirm.disabled = on
    cancel.disabled = on
    confirm.textContent = on ? "Удаляем…" : label
  }
  dialog.addEventListener("cancel", (event) => { if (dialog.hasAttribute("data-busy")) event.preventDefault() })
  cancel.addEventListener("click", () => { dialog.close() })
  confirm.addEventListener("click", () => {
    busy(true)
    problem.textContent = ""
    Effect.runFork(remove.pipe(
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
