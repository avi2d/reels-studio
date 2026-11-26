import { Effect } from "effect"
import type { BriefView } from "../../shared/brief.ts"
import * as Api from "../api.ts"
import { run } from "../run.ts"
import type { Reply } from "./chat-turn.ts"
import type { StudioChat } from "./chat.ts"
import { planContent, planView } from "./plan-view.ts"

const ASK = "Составь один план всего ролика по заданию."
const YES = "Согласна"
const POLL_MS = 1000

const priorBrief = Effect.fnUntraced(function*(id: string) {
  const { projects } = yield* Api.listProjects
  for (const project of projects) {
    if (project.id === id) continue
    const { brief } = yield* Api.getBrief(project.id)
    if (brief.trim() !== "") return brief.trim()
  }
  return ""
})

interface StepOptions {
  readonly chat: Pick<StudioChat, "status" | "watch" | "ask" | "open">
  readonly draft: string | undefined
  readonly keepDraft: (value: string | undefined) => void
  readonly advance: () => void
}

interface StudioPlan {
  readonly body: HTMLElement
  readonly dispose: () => void
}

type Action = "making" | "confirming" | "waiting"

class PlanFlow {
  readonly view: ReturnType<typeof planView>
  private action: Action | undefined
  private previous = ""
  private timer: ReturnType<typeof setTimeout> | undefined
  private cancelRefresh: (() => void) | undefined
  private canApprove = true
  private knownPlan = ""
  private left = false

  private readonly id: string
  private readonly options: StepOptions
  private current: BriefView

  constructor(id: string, current: BriefView, options: StepOptions) {
    this.id = id
    this.current = current
    this.options = options
    this.view = planView(id)
    this.view.field.value = options.draft ?? current.brief.trim()
  }

  private matchesPlan(): boolean {
    return this.canApprove && this.task() === this.current.brief.trim()
  }

  private task(): string {
    return this.view.field.value.trim()
  }

  private setProblem(message: string): void {
    this.view.problem.textContent = message
  }

  private statusMessage(): string {
    if (this.action === "making") return "Составляю план…"
    if (this.action !== undefined || this.current.working) return "Выполняю план…"
    switch (this.options.chat.status()) {
      case "busy": return "Студия отвечает в чате."
      case "loading": return "Загружаю чат…"
      case "unavailable": return "Откройте чат, чтобы загрузить его ещё раз."
      case "ready": return ""
    }
  }

  private render(): void {
    const { view, action, current, previous } = this
    const matches = this.matchesPlan()
    const busy = action !== undefined || current.working
    const done = matches && current.plan.state === "approved"
    const confirm = matches && current.plan.state === "proposed"
    const label = confirm || action === "confirming" || action === "waiting" ? "Да, делайте" : "Составить план"
    view.reuse.hidden = this.task() !== "" || previous === ""
    view.field.readOnly = busy
    view.submit.hidden = done && !busy
    view.submit.disabled = this.task() === "" || busy || this.options.chat.status() !== "ready"
    view.submit.lastChild?.replaceWith(label)
    view.next.hidden = !done || busy
    view.status.textContent = this.statusMessage()
    view.adjust.hidden = !confirm || busy
    const planKey = JSON.stringify(current.plan)
    if (planKey === this.knownPlan) return
    this.knownPlan = planKey
    view.planBody.replaceChildren(...planContent(current.plan))
    view.plan.hidden = current.plan.state === "none"
  }

  private schedule(): void {
    if (this.current.working) this.timer = setTimeout(() => { this.refresh() }, POLL_MS)
  }

  private show(fresh: BriefView): void {
    this.current = fresh
    if (!this.view.refresh.hidden) this.setProblem("")
    this.view.refresh.hidden = true
    if (this.action === "waiting" && !fresh.working) {
      this.action = undefined
      if (fresh.plan.state === "approved") this.options.advance()
      else if (this.view.problem.textContent === "") this.setProblem("План не выполнен. Нажмите «Да, делайте» ещё раз.")
    }
    this.render()
    this.schedule()
  }

  private refresh(receive: (fresh: BriefView) => void = (fresh) => { this.show(fresh) }): void {
    clearTimeout(this.timer)
    this.cancelRefresh?.()
    this.cancelRefresh = run(Effect.map(Api.getBrief(this.id), receive), (message) => {
      if (this.action === "making") this.action = undefined
      this.setProblem(message)
      this.view.refresh.hidden = false
      this.render()
      this.schedule()
    })
  }

  private madePlan(reply: Reply): void {
    if (this.left) return
    if (reply.kind !== "answered") {
      this.canApprove = false
      this.action = undefined
      this.setProblem(reply.kind === "stopped" ? "Составление плана остановлено." : reply.message)
      this.refresh()
    } else {
      this.refresh((fresh) => {
        this.action = undefined
        this.canApprove = true
        if (fresh.plan.state === "none") this.setProblem("Студия не записала план. Составьте его ещё раз.")
        this.show(fresh)
      })
    }
    this.render()
  }

  private acceptedPlan(reply: Reply): void {
    if (this.left) return
    if (reply.kind === "failed") this.setProblem(reply.message)
    this.action = "waiting"
    this.render()
    this.refresh()
  }

  private submit(): void {
    if (this.view.submit.disabled) return
    const { chat, keepDraft } = this.options
    this.setProblem("")
    if (this.matchesPlan() && this.current.plan.state === "proposed") {
      this.action = "confirming"
      if (!chat.ask({ text: YES, finish: (reply) => { this.acceptedPlan(reply) } })) this.action = undefined
    } else {
      const text = this.task()
      this.action = "making"
      if (!chat.ask({
        text: ASK,
        prepare: Effect.map(Api.saveBrief(this.id, text), (fresh) => {
          this.current = fresh
          keepDraft(undefined)
        }),
        finish: (reply) => { this.madePlan(reply) }
      })) this.action = undefined
    }
    this.render()
  }

  start(): StudioPlan {
    const { view, options: { chat, keepDraft } } = this
    let lastChat = chat.status()
    const stopWatching = chat.watch(() => {
      const before = lastChat
      lastChat = chat.status()
      if (before === "busy" && lastChat === "ready" && this.action === undefined) this.refresh()
      this.render()
    })
    let cancelReuse: (() => void) | undefined
    const loadPrevious = (): void => {
      if (this.task() !== "" || cancelReuse !== undefined) return
      cancelReuse = run(Effect.map(priorBrief(this.id), (brief) => {
        this.previous = brief
        this.render()
      }), () => {})
    }
    const fieldChanged = (): void => {
      keepDraft(view.field.value === this.current.brief.trim() ? undefined : view.field.value)
      loadPrevious()
      this.render()
    }
    view.field.addEventListener("input", fieldChanged)
    view.reuse.addEventListener("click", () => {
      if (this.task() !== "") return
      view.field.value = this.previous
      view.field.focus()
      fieldChanged()
    })
    view.submit.addEventListener("click", () => { this.submit() })
    view.adjust.addEventListener("click", chat.open)
    view.refresh.addEventListener("click", () => {
      this.setProblem("")
      this.refresh()
    })
    loadPrevious()
    this.render()
    this.schedule()
    return {
      body: view.body,
      dispose: () => {
        this.left = true
        cancelReuse?.()
        this.cancelRefresh?.()
        stopWatching()
        clearTimeout(this.timer)
      }
    }
  }
}

export const planStep = (id: string, initial: BriefView, options: StepOptions): StudioPlan => new PlanFlow(id, initial, options).start()
