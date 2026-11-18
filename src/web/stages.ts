import { h } from "./dom.ts"

const LIVE = [["brief", "Видео и задание"], ["takes", "Дубли и блоки"], ["pauses", "Паузы и склейки"]] as const
export type StageId = typeof LIVE[number][0]

export interface StageNote {
  readonly note: string
  readonly done: boolean
}

export const stageRail = (panes: Readonly<Record<StageId, HTMLElement>>, onOpen: (stage: StageId) => void): {
  readonly rail: HTMLElement
  readonly work: HTMLElement
  readonly open: (stage: StageId) => void
  readonly now: () => StageId
  readonly note: (stage: StageId, note: StageNote) => void
} => {
  const work = h("div", { class: "work" })
  const state: { now: StageId } = { now: "brief" }
  const steps = LIVE.map(([id, name]) => {
    const count = h("em")
    const button = h("button", { type: "button", class: "chip", "aria-pressed": "false" }, name, count)
    button.addEventListener("click", () => {
      open(id)
      button.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
    return { id, button, count }
  })
  const show = (): void => {
    for (const step of steps) step.button.setAttribute("aria-pressed", String(step.id === state.now))
    work.replaceChildren(panes[state.now])
    onOpen(state.now)
  }
  function open(stage: StageId): void {
    if (stage === state.now && work.firstChild !== null) return
    state.now = stage
    show()
  }
  const note = (stage: StageId, fresh: StageNote): void => {
    const step = steps.find((one) => one.id === stage)
    if (step === undefined) return
    step.count.textContent = fresh.note
    step.button.classList.toggle("done", fresh.done)
  }
  const rail = h("nav", { class: "filter", "aria-label": "Этапы работы" }, ...steps.map((step) => step.button))
  show()
  return { rail, work, open, now: () => state.now, note }
}
