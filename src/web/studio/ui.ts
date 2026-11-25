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
