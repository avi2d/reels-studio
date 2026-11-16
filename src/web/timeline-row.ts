import type { Pause, Placed } from "../shared/timeline.ts"
import { lengthOf } from "../shared/plan.ts"
import { h } from "./dom.ts"
import { formatLength, formatPause } from "./format.ts"

export interface RowActions {
  readonly select: (block: string) => void
  readonly reorder: (blocks: ReadonlyArray<string>) => void
  readonly setPause: (video: string, after: number, removed: boolean) => void
}

const pauseChip = (video: string, pause: Pause, actions: RowActions): HTMLElement => {
  const length = formatPause(pause.end - pause.start)
  const label = pause.removed ? `Вернуть паузу ${length}` : `Убрать паузу ${length}`
  return h("button", {
    type: "button",
    class: pause.removed ? "pause removed" : "pause",
    "aria-label": label,
    title: label,
    "data-key": `pause:${video}:${pause.after}`,
    click: () => { actions.setPause(video, pause.after, !pause.removed) }
  }, h("span", {}, `пауза ${length}`), h("span", { "aria-hidden": "true" }, pause.removed ? "↺" : "✕"))
}

const centre = (node: Element): number => {
  const box = node.getBoundingClientRect()
  return box.left + box.width / 2
}

const EDGE = 48
const EDGE_STEP = 14

// The dragged slot never leaves the document: a node that is re-inserted loses its pointer capture.
const follow = (row: HTMLElement, slot: HTMLElement, x: number): void => {
  const box = row.getBoundingClientRect()
  if (x > box.right - EDGE) row.scrollLeft += EDGE_STEP
  if (x < box.left + EDGE) row.scrollLeft -= EDGE_STEP
  for (let next = slot.nextElementSibling; next !== null && x > centre(next); next = slot.nextElementSibling) slot.before(next)
  for (let before = slot.previousElementSibling; before !== null && x < centre(before); before = slot.previousElementSibling) slot.after(before)
}

const idsOf = (row: HTMLElement): ReadonlyArray<string> =>
  [...row.children].flatMap((slot) => slot instanceof HTMLElement && slot.dataset.id !== undefined ? [slot.dataset.id] : [])

const KEY_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }

const dragHandle = (row: HTMLElement, slot: HTMLElement, title: string, id: string, actions: RowActions): HTMLElement => {
  const handle = h("button", {
    type: "button",
    class: "handle",
    "aria-label": `Переместить блок «${title}». Стрелки влево и вправо двигают его`,
    title: "Перетащите блок на новое место",
    "data-key": `handle:${id}`
  }, "⠿")
  const state = { dragging: false }
  const drop = (): void => {
    if (!state.dragging) return
    state.dragging = false
    slot.classList.remove("dragging")
    actions.reorder(idsOf(row))
  }
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    handle.setPointerCapture(event.pointerId)
    state.dragging = true
    slot.classList.add("dragging")
  })
  handle.addEventListener("pointermove", (event) => { if (state.dragging) follow(row, slot, event.clientX) })
  handle.addEventListener("pointerup", drop)
  handle.addEventListener("pointercancel", drop)
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

const slotOf = (row: HTMLElement, one: Placed, index: number, selected: string | undefined, actions: RowActions): HTMLElement => {
  const { block, take } = one
  const rank = block.takes.indexOf(take) + 1
  const slot = h("li", { class: "slot", "data-id": block.id })
  const pick = h("button", {
    type: "button",
    class: "pick",
    "aria-pressed": String(block.id === selected),
    "data-key": `pick:${block.id}`,
    click: () => { actions.select(block.id) }
  },
    h("strong", {}, `${index + 1}. ${block.title}`),
    h("span", { class: "muted" }, `${formatLength(lengthOf(one.spans))} · дубль ${rank} из ${block.takes.length}`))
  const inner = one.pauses.filter((pause) => pause.after !== take.to).map((pause) => pauseChip(take.video, pause, actions))
  const after = one.pauses.filter((pause) => pause.after === take.to).map((pause) => pauseChip(take.video, pause, actions))
  slot.append(
    h("div", { class: block.id === selected ? "block selected" : "block" },
      h("div", { class: "block-head" }, dragHandle(row, slot, block.title, block.id, actions), pick), ...inner),
    ...after)
  return slot
}

export const blockRow = (placed: ReadonlyArray<Placed>, selected: string | undefined, actions: RowActions): HTMLElement => {
  const row = h("ol", { class: "blocks" })
  row.append(...placed.map((one, index) => slotOf(row, one, index, selected, actions)))
  return row
}
