import { h } from "../dom.ts"
import { icon } from "./icons.ts"
import { pageOf } from "./paging.ts"
import { button } from "./ui.ts"

export interface Pager {
  readonly node: HTMLElement
  readonly show: <T>(items: ReadonlyArray<T>) => ReadonlyArray<T>
  readonly reset: () => void
}

export const pager = (label: string, onMove: () => void): Pager => {
  const state = { page: 0 }
  const move = (step: number) => (): void => {
    state.page += step
    onMove()
  }
  const where = h("span", { class: "pager__where", "aria-live": "polite" })
  const back = button("quiet", "Назад", { class: "btn btn--quiet btn--sm", click: move(-1) }, "left")
  const next = button("quiet", "Дальше", { class: "btn btn--quiet btn--sm", click: move(1) })
  next.append(icon("right"))
  const node = h("nav", { class: "pager", "aria-label": label }, back, where, next)
  const show = <T>(items: ReadonlyArray<T>): ReadonlyArray<T> => {
    const shown = pageOf(items, state.page)
    state.page = shown.page
    const atStart = shown.page === 0
    const atEnd = shown.page === shown.pages - 1
    const stranded = (back === document.activeElement && atStart) || (next === document.activeElement && atEnd)
    node.hidden = shown.pages <= 1
    where.textContent = shown.first === shown.last ? `${shown.first} из ${shown.total}` : `${shown.first}–${shown.last} из ${shown.total}`
    back.disabled = atStart
    next.disabled = atEnd
    if (stranded && !node.hidden) (atStart ? next : back).focus()
    return shown.items
  }
  return { node, show, reset: () => { state.page = 0 } }
}
