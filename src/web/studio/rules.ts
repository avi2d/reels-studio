import { Effect } from "effect"
import type { Step } from "../../shared/page.ts"
import { formatSeconds, type RuleChangeView, type RuleId, type RulesView } from "../../shared/rules.ts"
import type { ZoomLevel } from "../../shared/zoom-plan.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { formatPause } from "../format.ts"
import { run } from "../run.ts"
import type { StudioChat } from "./chat.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

const seconds = (value: number): string => `${formatSeconds(value).replace(".", ",")} с`

const pausePhrase = (value: number): string => `пауза остаётся ${seconds(value)}`

const ZOOM_PHRASES = {
  off: "без приближений на ключевых словах",
  soft: "приближения на ключевых словах мягкие",
  full: "приближения на ключевых словах сильные"
} satisfies Record<ZoomLevel, string>

const ZOOM_INSTEAD = { off: "без приближений", soft: "мягких", full: "сильных" } satisfies Record<ZoomLevel, string>

const ZOOM_BACK = { off: "Снова без приближений", soft: "Вернуть мягкие", full: "Вернуть сильные" } satisfies Record<ZoomLevel, string>

const RULE_STEP = { pause: "montage", zoom: "montage" } satisfies Record<RuleId, Step>

export const hasRules = (step: Step): boolean => Object.values(RULE_STEP).some((owner) => owner === step)

type PauseChange = Extract<RuleChangeView, { readonly id: "pause" }>
type ZoomChange = Extract<RuleChangeView, { readonly id: "zoom" }>

const lengthLine = (change: PauseChange): string => {
  const shift = change.length.to - change.length.from
  if (change.pauses.length === 0) return "В ролике пока нет укороченных пауз, правило сработает на них."
  if (Math.abs(shift) < 0.05) return `Пауз изменилось: ${change.pauses.length}.`
  return `Пауз изменилось: ${change.pauses.length}. Ролик ${shift > 0 ? "длиннее" : "короче"} на ${formatPause(Math.abs(shift))}.`
}

const zoomCard = (change: ZoomChange, undo: () => void): HTMLElement =>
  h("div", { class: "studio-rules__change" },
    h("p", {}, h("b", {}, "Правило изменено из чата: "), `${ZOOM_PHRASES[change.to]} вместо ${ZOOM_INSTEAD[change.from]}.`),
    h("p", { class: "hint" }, change.zooms.length === 0
      ? "В ролике пока нет приближений, которые следуют правилу."
      : `Приближений изменилось: ${change.zooms.length}. Те, что вы выбрали в части сами, остались как были.`),
    ...change.zooms.length === 0 ? [] : [h("ol", { class: "studio-rules__pauses" }, ...change.zooms.map((zoom) =>
      h("li", {}, `«${zoom.block}», на «${zoom.words}»`)))],
    button("quiet", ZOOM_BACK[change.from], { class: "btn btn--quiet btn--start", "data-key": "undo", click: undo }, "retry"))

const changeCard = (change: RuleChangeView, undo: () => void): HTMLElement => change.id === "zoom" ? zoomCard(change, undo) :
  h("div", { class: "studio-rules__change" },
    h("p", {}, h("b", {}, "Правило изменено из чата: "), `${pausePhrase(change.to)} вместо ${seconds(change.from)}.`),
    h("p", { class: "hint" }, lengthLine(change)),
    ...change.pauses.length === 0 ? [] : [h("ol", { class: "studio-rules__pauses" }, ...change.pauses.map((pause) =>
      h("li", {}, `«${pause.block}», после «${pause.word}»: ${seconds(pause.from)} → ${seconds(pause.to)}`)))],
    button("quiet", `Вернуть ${seconds(change.from)}`, { class: "btn btn--quiet btn--start", "data-key": "undo", click: undo }, "retry"))

export interface RulesPanel {
  readonly node: HTMLElement
  readonly dispose: () => void
}

export const rulesPanel = (id: string, step: Step, chat: Pick<StudioChat, "status" | "watch">, changed?: () => void): RulesPanel => {
  const list = h("ul", { class: "studio-rules__list" })
  const change = h("div", {})
  const problem = h("p", { class: "error", role: "alert" })
  const node = h("section", { class: "studio-plan__card studio-rules", "aria-labelledby": "studio-rules-title", hidden: true },
    h("h2", { id: "studio-rules-title" }, "Правила"),
    h("p", { class: "hint" }, "Студия применяет их ко всему ролику. Чтобы поменять правило, напишите в чат, например «оставляй паузы подлиннее»."),
    list, change, problem)
  let cancel: (() => void) | undefined
  let busy = false

  const lock = (): void => {
    for (const control of node.querySelectorAll("button")) control.disabled = busy || chat.status() === "busy"
  }

  const load = (work: Effect.Effect<RulesView, Api.Failed>, onChanged?: () => void): void => {
    cancel?.()
    busy = true
    lock()
    cancel = run(Effect.map(work, (view) => {
      busy = false
      problem.textContent = ""
      show(view)
      onChanged?.()
    }), (message) => {
      busy = false
      problem.textContent = message
      lock()
      node.hidden = false
    })
  }

  const ruleItem = (rule: RulesView["rules"][number]): HTMLElement => {
    const pin = h("button", {
      class: rule.kept ? "btn btn--plain studio-rules__pin studio-rules__pin--on" : "btn btn--plain studio-rules__pin",
      type: "button",
      "data-key": `pin:${rule.id}`,
      "aria-pressed": rule.kept ? "true" : "false",
      title: rule.kept ? "Следующие ролики начнут с этого правила. Нажмите, чтобы не переносить" : "Начинать с этого правила следующие ролики",
      click: () => { if (!busy && chat.status() !== "busy") load(Api.keepRule(id, rule.id, !rule.kept)) }
    }, icon("pin"), "Для следующих роликов")
    return h("li", {}, h("span", {}, rule.id === "pause" ? pausePhrase(rule.value) : ZOOM_PHRASES[rule.value]), pin)
  }

  function show(view: RulesView): void {
    const active = document.activeElement
    const focused = active instanceof HTMLElement && node.contains(active) ? active.dataset["key"] : undefined
    list.replaceChildren(...view.rules.filter((rule) => RULE_STEP[rule.id] === step).map(ruleItem))
    const undo = (): void => { if (!busy && chat.status() !== "busy") load(Api.undoRule(id), changed) }
    change.replaceChildren(...view.changes.filter((one) => RULE_STEP[one.id] === step).map((one) => changeCard(one, undo)))
    lock()
    node.hidden = false
    if (focused !== undefined) (node.querySelector<HTMLElement>(`[data-key="${focused}"]`) ?? list.querySelector("button"))?.focus()
  }

  let last = chat.status()
  const stop = chat.watch(() => {
    const before = last
    last = chat.status()
    lock()
    if (before === "busy" && last !== "busy") load(Api.getRules(id))
  })
  load(Api.getRules(id))
  return { node, dispose: () => { cancel?.(); stop() } }
}
