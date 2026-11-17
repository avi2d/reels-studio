import { h } from "./dom.ts"

const LIVE = [["brief", "Видео и задание"], ["takes", "Дубли и блоки"], ["pauses", "Паузы и склейки"]] as const
export type StageId = typeof LIVE[number][0]

const LATER = ["Приближения", "Субтитры", "Заголовки", "Вставки", "Музыка и звуки", "Лицо и цвет", "Голос", "Проверка и выгрузка"]

export interface StageNote {
  readonly note: string
  readonly done: boolean
}

const numbered = (index: number): string => String(index + 1).padStart(2, "0")

export const stageRail = (panes: Readonly<Record<StageId, HTMLElement>>): {
  readonly rail: HTMLElement
  readonly work: HTMLElement
  readonly open: (stage: StageId) => void
  readonly now: () => StageId
  readonly note: (stage: StageId, note: StageNote) => void
} => {
  const title = h("b")
  const count = h("span", { class: "count" })
  const body = h("div", { class: "work" })
  const work = h("section", { class: "panel workcol", "aria-label": "Этап" }, h("div", { class: "head" }, title, count), body)
  const state: { now: StageId; notes: Partial<Record<StageId, StageNote>> } = { now: "brief", notes: {} }
  const steps = LIVE.map(([id, name], index) => {
    const small = h("small")
    const mark = h("span", { class: "st" })
    const button = h("button", { type: "button", class: "step", "aria-pressed": "false", click: () => { open(id) } },
      h("span", { class: "n" }, numbered(index)), h("span", { class: "nm" }, name, small), mark)
    return { id, name, button, small, mark }
  })
  const show = (): void => {
    for (const step of steps) step.button.setAttribute("aria-pressed", String(step.id === state.now))
    const step = steps.find((one) => one.id === state.now)
    title.textContent = step?.name ?? ""
    count.textContent = state.notes[state.now]?.note ?? ""
    body.replaceChildren(panes[state.now])
  }
  function open(stage: StageId): void {
    if (stage === state.now && body.firstChild !== null) return
    state.now = stage
    show()
  }
  const note = (stage: StageId, fresh: StageNote): void => {
    state.notes[stage] = fresh
    const step = steps.find((one) => one.id === stage)
    if (step === undefined) return
    step.small.textContent = fresh.note
    step.mark.textContent = fresh.done ? "готово" : ""
    step.button.classList.toggle("done", fresh.done)
    if (stage === state.now) count.textContent = fresh.note
  }
  const later = LATER.map((name, index) =>
    h("li", { class: "step locked" }, h("span", { class: "n" }, numbered(LIVE.length + index)), h("span", { class: "nm" }, name), h("span", { class: "st" }, "позже")))
  const rail = h("nav", { class: "panel railcol", "aria-label": "Этапы работы" },
    h("div", { class: "head" }, "Этапы", h("span", { class: "count" }, `${LIVE.length} из ${LIVE.length + LATER.length} работают`)),
    h("ol", { class: "rail" }, ...steps.map((step) => h("li", {}, step.button)), ...later),
    h("p", { class: "legend" }, "Этапы с пометкой «позже» студия пока не умеет."))
  show()
  return { rail, work, open, now: () => state.now, note }
}
