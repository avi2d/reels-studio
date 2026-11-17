import { offsetIn, type Pause, type Placed, type Take } from "../shared/timeline.ts"
import { lengthOf } from "../shared/plan.ts"
import { h } from "./dom.ts"
import { formatLength, formatPause } from "./format.ts"

export interface RowActions {
  readonly select: (block: string) => void
  readonly textOf: (take: Take) => string
  readonly reorder: (blocks: ReadonlyArray<string>) => void
  readonly setPause: (video: string, after: number, removed: boolean) => void
}

const share = (part: number, whole: number): string => `${(whole <= 0 ? 0 : (part / whole) * 100).toFixed(2)}%`

const pauseMark = (one: Placed, pause: Pause, length: number, actions: RowActions): HTMLElement => {
  const size = formatPause(pause.end - pause.start)
  const label = pause.removed ? `Вернуть паузу ${size}` : `Убрать паузу ${size}`
  const left = share(offsetIn(one.spans, pause.start), length)
  return h("button", {
    type: "button",
    class: pause.removed ? "pause removed" : "pause",
    style: pause.removed ? `left: min(${left}, 100% - var(--gap-min))` : `left: min(${left}, 100% - var(--gap-min)); width: ${share(pause.end - pause.start, length)}`,
    "aria-label": label,
    title: label,
    "data-key": `pause:${one.take.video}:${pause.after}`,
    click: () => { actions.setPause(one.take.video, pause.after, !pause.removed) }
  }, pause.removed ? "↺" : size)
}

const EDGE = 48
const EDGE_STEP = 14

interface Point {
  readonly x: number
  readonly y: number
}

const holds = (node: Element, point: Point): boolean => {
  const box = node.getBoundingClientRect()
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
}

interface Drag {
  from: ReadonlyArray<string> | undefined
  crossed: Element | undefined
}

export interface Crossing<T> {
  readonly movers: ReadonlyArray<T>
  readonly side: "before" | "after"
}

export const crossingOf = <T>(row: ReadonlyArray<T>, dragged: T, under: T): Crossing<T> => {
  const from = row.indexOf(dragged)
  const to = row.indexOf(under)
  return to > from ? { movers: row.slice(from + 1, to + 1), side: "before" } : { movers: row.slice(to, from), side: "after" }
}

// The dragged slot is never re-inserted: a node that leaves the document loses its pointer capture, and the drop never arrives.
const follow = (row: HTMLElement, slot: HTMLElement, point: Point, drag: Drag): void => {
  const box = row.getBoundingClientRect()
  if (point.x > box.right - EDGE) row.scrollLeft += EDGE_STEP
  if (point.x < box.left + EDGE) row.scrollLeft -= EDGE_STEP
  const under = [...row.children].find((other) => holds(other, { x: point.x, y: box.top + box.height / 2 }))
  if (under === undefined || under === slot) {
    drag.crossed = undefined
    return
  }
  if (under === drag.crossed) return
  drag.crossed = under
  const { movers, side } = crossingOf([...row.children], slot, under)
  if (side === "before") slot.before(...movers)
  else slot.after(...movers)
}

const idsOf = (row: HTMLElement): ReadonlyArray<string> =>
  [...row.children].flatMap((slot) => slot instanceof HTMLElement && slot.dataset.id !== undefined ? [slot.dataset.id] : [])

const KEY_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }

const dragHandle = (row: HTMLElement, slot: HTMLElement, title: string, id: string, selected: string | undefined, actions: RowActions): HTMLElement => {
  const handle = h("button", {
    type: "button",
    class: "handle",
    "aria-label": `Переместить блок «${title}». Стрелки влево и вправо двигают его`,
    title: "Перетащите блок на новое место",
    "data-key": `handle:${id}`
  }, "⠿")
  const state: Drag = { from: undefined, crossed: undefined }
  const drop = (): void => {
    const from = state.from
    if (from === undefined) return
    state.from = undefined
    state.crossed = undefined
    slot.classList.remove("dragging")
    const ids = idsOf(row)
    if (ids.some((one, index) => one !== from[index])) actions.reorder(ids)
    actions.select(id)
  }
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    handle.setPointerCapture(event.pointerId)
    state.from = idsOf(row)
    slot.classList.add("dragging")
  })
  handle.addEventListener("pointermove", (event) => { if (state.from !== undefined) follow(row, slot, { x: event.clientX, y: event.clientY }, state) })
  for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(end, drop)
  handle.addEventListener("focus", () => {
    if (state.from === undefined && id !== selected) actions.select(id)
  })
  handle.addEventListener("keydown", (event) => {
    const step = KEY_STEPS[event.key]
    if (step === undefined) return
    event.preventDefault()
    const ids = idsOf(row)
    const from = ids.indexOf(id)
    const to = from + step
    const other = ids[to]
    if (other === undefined) return
    actions.reorder(ids.map((one, index) => index === from ? other : index === to ? id : one))
  })
  return handle
}

interface At {
  readonly index: number
  readonly start: number
}

const slotOf = (row: HTMLElement, one: Placed, at: At, selected: string | undefined, actions: RowActions): HTMLElement => {
  const { block, take } = one
  const length = lengthOf(one.spans)
  const rank = block.takes.indexOf(take) + 1
  const slot = h("li", { class: "slot", "data-id": block.id, style: `--len: ${length.toFixed(1)}` })
  const pick = h("button", {
    type: "button",
    class: "pick",
    "aria-pressed": String(block.id === selected),
    "aria-label": `Блок ${at.index + 1}. ${block.title}`,
    title: `${block.title} · ${formatLength(length)}`,
    "data-key": `pick:${block.id}`,
    click: () => { actions.select(block.id) }
  },
    h("span", { class: "name" }, h("b", {}, String(at.index + 1)), block.title),
    h("span", { class: "rank" }, `дубль ${rank} из ${block.takes.length} · ${formatLength(length)}`))
  slot.append(
    h("span", { class: "at" }, formatLength(at.start)),
    h("span", { class: "said", title: actions.textOf(take) }, actions.textOf(take)),
    h("div", { class: block.id === selected ? "clip selected" : "clip" }, dragHandle(row, slot, block.title, block.id, selected, actions), pick),
    h("div", { class: "gaps" }, ...one.pauses.map((pause) => pauseMark(one, pause, length, actions))))
  return slot
}

export const blockRow = (placed: ReadonlyArray<Placed>, selected: string | undefined, actions: RowActions): HTMLElement => {
  const row = h("ol", { class: "blocks" })
  const starts = placed.map((_, index) => lengthOf(placed.slice(0, index).flatMap((one) => one.spans)))
  row.append(...placed.map((one, index) => slotOf(row, one, { index, start: starts[index] ?? 0 }, selected, actions)))
  return row
}
