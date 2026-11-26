import { MAX_BRIEF, type Done, type PlanView } from "../../shared/brief.ts"
import { stepPath } from "../../shared/page.ts"
import { h } from "../dom.ts"
import { formatPause } from "../format.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

const workLine = (item: Done): string => {
  if (item.kind === "no-blocks") return "Не удалось собрать части ролика. Записи остались без изменений."
  if (item.kind === "pauses") return item.count === 0
    ? "Паузы не укорачивала."
    : `Укоротила паузы: ${item.count}. Ролик короче на ${formatPause(item.seconds)}.`
  const take = item.of === 1 ? "дубль один" : `выбрала дубль ${item.take} из ${item.of}`
  const reason = item.reason.trim()
  const end = /[.!?…]$/u.test(reason) ? "" : "."
  return `«${item.block}»: ${take}.${reason === "" ? "" : ` ${reason}${end}`}`
}

export const planContent = (plan: PlanView): ReadonlyArray<HTMLElement> => {
  if (plan.state === "none") return []
  const text = h("p", { class: "studio-plan__text" }, plan.text.trim())
  return plan.state === "approved" ? [
    text,
    h("section", { class: "studio-plan__work", "aria-labelledby": "studio-plan-work" },
      h("h2", { id: "studio-plan-work" }, "Что сделала студия"),
      h("ul", {}, ...plan.done.map((done) => h("li", {}, workLine(done)))))
  ] : [text]
}

interface PlanLayout {
  readonly body: HTMLElement
  readonly field: HTMLTextAreaElement
  readonly reuse: HTMLButtonElement
  readonly plan: HTMLElement
  readonly planBody: HTMLElement
  readonly adjust: HTMLButtonElement
  readonly submit: HTMLButtonElement
  readonly next: HTMLAnchorElement
  readonly status: HTMLElement
  readonly problem: HTMLElement
  readonly refresh: HTMLButtonElement
}

export const planView = (id: string): PlanLayout => {
  const field = h("textarea", { class: "field studio-plan__task", name: "brief", rows: "4", maxlength: String(MAX_BRIEF), placeholder: "Тема, длина, для кого" })
  const reuse = button("quiet", "Как в прошлый раз", { hidden: true }, "retry")
  const task = h("div", { class: "studio-plan__card" },
    h("label", { class: "label" }, "Задание", field), reuse)
  const planBody = h("div", { class: "studio-plan__response" })
  const adjust = button("quiet", "Поправить план", { class: "btn btn--quiet btn--start", hidden: true }, "chat")
  const plan = h("section", { class: "studio-plan__card", "aria-labelledby": "studio-plan-text", hidden: true },
    h("h2", { id: "studio-plan-text" }, "План ролика"), planBody, adjust)
  const submit = button("main", "Составить план", { disabled: true }, "right")
  const next = h("a", { class: "btn btn--main", href: stepPath(id, "montage"), hidden: true }, "Дальше: монтаж", icon("right"))
  const status = h("p", { class: "hint", role: "status" })
  const problem = h("p", { class: "error", role: "alert" })
  const refresh = button("quiet", "Проверить ещё раз", { hidden: true })
  const body = h("div", { class: "body studio-plan" }, h("h1", { tabindex: "-1" }, "План"), task, plan,
    h("div", { class: "studio-plan__actions" }, status, refresh, submit, next), problem)
  return { body, field, reuse, plan, planBody, adjust, submit, next, status, problem, refresh }
}
