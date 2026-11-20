import { Effect } from "effect"
import { MAX_BRIEF, type BriefView, type Done, type PlanView } from "../shared/brief.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"
import { run } from "./run.ts"

const ASK_PLAN = "Составь один план всего ролика по заданию."
const YES = "Согласна"

const BRIEF_HINT = "Напишите в двух или трёх предложениях, о чём ролик, для кого он и что в нём обязательно оставить."
const PROPOSED = "Если план подходит, нажмите «Согласна». Студия сама соберёт блоки, выберет лучшие дубли и укоротит паузы, а потом напишет здесь, что сделала. Чтобы поправить план, напишите в чат."

const sentence = (text: string): string => /[.!?…]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`

const doneLine = (done: Done): string => {
  if (done.kind === "no-blocks") return "Блоки не собрались, поэтому дубли и паузы остались как были. Напишите в чате «Согласна» ещё раз."
  if (done.kind === "pauses") {
    return done.count === 0
      ? "Пауз длиннее полсекунды в выбранных дублях нет."
      : `Укорочено пауз: ${done.count}. Каждая теперь 0,2 с, и ролик стал короче на ${formatLength(done.seconds)}. Любую паузу можно вернуть на этапе «Паузы и склейки».`
  }
  const take = done.of === 1 ? "дубль один" : `выбран дубль ${done.take} из ${done.of}`
  return `«${done.block}»: ${take}. ${sentence(done.reason)}`
}

const approvedAt = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

const planBody = (plan: Exclude<PlanView, { readonly state: "none" }>, ask: (text: string) => void): ReadonlyArray<HTMLElement> => {
  const text = h("p", { class: "plan" }, plan.text.trim())
  if (plan.state === "proposed") {
    return [text, h("p", { class: "muted" }, PROPOSED), button("primary", { class: "end", click: () => { ask(YES) } }, YES)]
  }
  return [
    text,
    h("p", { class: "muted" }, `Вы согласились с планом ${approvedAt(plan.at)}.`),
    h("h3", {}, "Что сделала студия"),
    h("ul", { class: "done" }, ...plan.done.map((done) => h("li", {}, doneLine(done))))
  ]
}

export const briefCards = (projectId: string, ask: (text: string) => void): {
  readonly nodes: ReadonlyArray<HTMLElement>
  readonly refresh: () => void
} => {
  const field = h("wa-textarea", { name: "brief", rows: "3", resize: "auto", maxlength: String(MAX_BRIEF), label: "Задание", hint: BRIEF_HINT })
  const problem = h("p", { class: "error", role: "alert" })
  const state = { filled: false, shown: "" }
  const make = button("primary", {
    class: "end",
    click: () => {
      const text = (field.value ?? "").trim()
      if (text === "") {
        problem.textContent = "Напишите задание, и студия составит по нему план."
        return
      }
      make.disabled = true
      problem.textContent = ""
      run(Effect.map(Api.saveBrief(projectId, text), (view) => {
        make.disabled = false
        show(view)
        ask(ASK_PLAN)
      }), (failure) => {
        make.disabled = false
        problem.textContent = failure
      })
    }
  }, "Составить план")
  const task = h("section", { class: "card" }, h("h2", {}, "Задание"), field, make, problem)
  const body = h("div", { class: "pane" })
  const plan = h("section", { class: "card", hidden: true }, h("h2", {}, "План ролика"), body)
  const show = (view: BriefView): void => {
    if (!state.filled) {
      field.value = view.brief.trim()
      state.filled = true
    }
    const seen = JSON.stringify(view.plan)
    if (seen === state.shown) return
    state.shown = seen
    plan.hidden = view.plan.state === "none"
    body.replaceChildren(...(view.plan.state === "none" ? [] : planBody(view.plan, ask)))
  }
  const refresh = (): void => {
    Effect.runFork(Api.getBrief(projectId).pipe(
      Effect.map(show),
      Effect.catchTag("Failed", (failure) => Effect.sync(() => { problem.textContent = failure.message }))
    ))
  }
  return { nodes: [task, plan], refresh }
}
