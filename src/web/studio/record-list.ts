import type { Transcript } from "../../shared/plan.ts"
import { h, placeInOrder, type Props } from "../dom.ts"
import { icon } from "./icons.ts"
import type { Action, Row } from "./record-rows.ts"
import { percentOf, statusOf, type Take } from "./takes.ts"
import { button, menuButton } from "./ui.ts"

const isBad = (take: Take): boolean => take.kind === "unheard" || take.kind === "unsent"

const thumbOf = (row: Row): HTMLElement =>
  h("span", { class: "rec__thumb" }, row.preview === undefined
    ? icon(row.take.kind === "ready" ? "film" : "upload")
    : h("video", { muted: true, playsinline: true, preload: "metadata", tabindex: "-1", "aria-hidden": "true", src: `${row.preview}#t=0.5` }))

const textOf = (row: Row): HTMLElement =>
  h("span", { class: "rec__text" },
    h("b", {}, row.name),
    h("span", { class: isBad(row.take) ? "rec__status rec__status--bad" : "rec__status" }, statusOf(row.take)),
    ...row.take.kind === "sending" ? [h("progress", { class: "bar", max: "100", value: String(percentOf(row.take.sent, row.take.total)), "aria-hidden": "true" })] : [],
    ...row.note === undefined ? [] : [h("span", { class: "rec__note" }, row.note)])

const actionNode = (row: Row, action: Action): HTMLElement => {
  switch (action.kind) {
    case "retry": return button("quiet", "Ещё раз", { class: "btn btn--quiet btn--sm", "data-focus": "retry", click: action.run }, "retry")
    case "drop": return h("button", { class: "btn btn--plain btn--icon", type: "button", "data-focus": "drop", title: "Не загружать", "aria-label": `Не загружать «${row.name}»`, click: action.run }, icon("close"))
    case "remove": return menuButton(`Ещё о записи «${row.name}»`, [{ label: "Удалить запись", icon: "trash", danger: true, run: action.run }])
  }
}

const transcriptOf = (preview: string, transcript: Transcript): HTMLElement => {
  const player = h("video", { class: "rec__player", controls: true, playsinline: true, preload: "metadata", src: preview })
  const words = transcript.words.flatMap((word) => [h("button", { class: "word", type: "button", click: () => { player.currentTime = word.start } }, word.text), " "])
  return h("div", { class: "rec__open" }, player, ...words.length === 0
    ? [h("p", { class: "hint" }, "Студия не услышала в этой записи слов.")]
    : [h("p", { class: "transcript" }, ...words), h("p", { class: "hint" }, "Нажмите на слово, и запись перейдёт к нему.")])
}

const mainOf = (row: Row, playable: boolean, open: boolean, onOpen: () => void): HTMLElement => {
  if (row.choice !== undefined) {
    const box = h("input", { class: "rec__check", type: "checkbox", "data-focus": "choice", checked: row.choice.checked, change: row.choice.toggle })
    return h("label", { class: "rec__main" }, box, thumbOf(row), textOf(row))
  }
  return !playable
    ? h("div", { class: "rec__main" }, thumbOf(row), textOf(row))
    : h("button", { class: "rec__main", type: "button", "data-focus": "main", "aria-expanded": String(open), click: onOpen }, thumbOf(row), textOf(row), h("span", { class: "rec__chev" }, icon("down")))
}

const rowNode = (row: Row, open: boolean, onOpen: () => void): HTMLElement => {
  const heard = row.transcript !== undefined && row.preview !== undefined ? { preview: row.preview, transcript: row.transcript } : undefined
  const main = mainOf(row, heard !== undefined, open, onOpen)
  return h("li", { class: open ? "rec rec--open" : "rec" },
    h("div", { class: "rec__row" }, main, h("div", { class: "rec__actions" }, ...row.actions.map((action) => actionNode(row, action)))),
    ...open && heard !== undefined ? [transcriptOf(heard.preview, heard.transcript)] : [])
}


const keepFocus = (old: HTMLElement | undefined, fresh: HTMLElement): void => {
  const focused = document.activeElement
  if (old === undefined || !(focused instanceof HTMLElement) || !old.contains(focused)) return
  const target = fresh.querySelector(`[data-focus="${focused.dataset.focus ?? ""}"]`) ?? fresh.querySelector("[data-focus]")
  if (target instanceof HTMLElement) queueMicrotask(() => { target.focus() })
}

export interface RowList {
  readonly node: HTMLUListElement
  readonly show: (rows: ReadonlyArray<Row>) => void
}

export const rowList = (props: Props): RowList => {
  const node = h("ul", { class: "recs", ...props })
  const shown = new Map<string, { readonly signature: string; readonly node: HTMLElement }>()
  const state = { open: "", rows: [] as ReadonlyArray<Row> }
  const show = (rows: ReadonlyArray<Row>): void => {
    state.rows = rows
    node.hidden = rows.length === 0
    placeInOrder(node, rows.map((row) => {
      const open = row.key === state.open
      const signature = JSON.stringify([row, open])
      const kept = shown.get(row.key)
      if (kept?.signature === signature) return kept.node
      const fresh = rowNode(row, open, () => {
        state.open = open ? "" : row.key
        show(state.rows)
      })
      keepFocus(kept?.node, fresh)
      shown.set(row.key, { signature, node: fresh })
      return fresh
    }))
    const keys = new Set(rows.map((row) => row.key))
    for (const key of shown.keys()) if (!keys.has(key)) shown.delete(key)
  }
  return { node, show }
}

// A row that leaves the list takes the focus with it, so the focus goes back to the heading instead of the page.
export const showKeepingFocus = (heading: HTMLElement, lists: ReadonlyArray<readonly [RowList, ReadonlyArray<Row>]>): void => {
  const hadFocus = lists.some(([list]) => list.node.contains(document.activeElement))
  for (const [list, rows] of lists) list.show(rows)
  if (hadFocus) queueMicrotask(() => { if (!lists.some(([list]) => list.node.contains(document.activeElement))) heading.focus() })
}
