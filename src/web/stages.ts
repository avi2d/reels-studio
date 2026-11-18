import type { WaTabShowEvent } from "@awesome.me/webawesome/dist/events/tab-show.js"
import { h } from "./dom.ts"

const LIVE = [["brief", "Видео и задание", "Видео"], ["takes", "Дубли и блоки", "Дубли"], ["pauses", "Паузы и склейки", "Паузы"]] as const
export type StageId = typeof LIVE[number][0]

const stageOf = (name: string): StageId | undefined => LIVE.find(([id]) => id === name)?.[0]

export interface StageNote {
  readonly note: string
  readonly done: boolean
}

export const stageRail = (panes: Readonly<Record<StageId, HTMLElement>>, shared: HTMLElement, onOpen: (stage: StageId) => void): {
  readonly rail: HTMLElement
  readonly open: (stage: StageId) => void
  readonly now: () => StageId
  readonly note: (stage: StageId, note: StageNote) => void
} => {
  const state: { now: StageId } = { now: "brief" }
  const steps = LIVE.map(([id, name, short]) => {
    const count = h("em")
    const tab = h("wa-tab", { panel: id }, h("span", { class: "long" }, name), h("span", { class: "short" }, short), count)
    const panel = h("wa-tab-panel", { name: id }, panes[id])
    return { id, tab, count, panel }
  })
  const rail = h("wa-tab-group", { class: "stages", active: state.now, "without-scroll-controls": true },
    ...steps.map((step) => step.tab), shared, ...steps.map((step) => step.panel))
  const show = (): void => {
    onOpen(state.now)
  }
  const open = (stage: StageId): void => {
    if (stage === state.now) return
    state.now = stage
    rail.active = stage
    show()
  }
  rail.addEventListener("wa-tab-show", (event: WaTabShowEvent) => {
    const stage = stageOf(event.detail.name)
    if (stage !== undefined) open(stage)
  })
  const note = (stage: StageId, fresh: StageNote): void => {
    const step = steps.find((one) => one.id === stage)
    if (step === undefined) return
    step.count.textContent = fresh.note
    step.tab.classList.toggle("done", fresh.done)
  }
  show()
  return { rail, open, now: () => state.now, note }
}
