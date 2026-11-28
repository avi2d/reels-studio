import { Effect } from "effect"
import { stepPath } from "../../shared/page.ts"
import type { ReelView } from "../../shared/reel.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { reelFile } from "./done-file.ts"
import { failureText, headingOf, phaseOf, progressOf, type Busy, type File, type Phase } from "./done-model.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

const POLL_MS = 1000
const IDLE_MS = 3000

const EMPTY = "В ролике пока нет ни одной части. Соберите его на шаге «Монтаж»."
const STALE = "Вы меняли ролик после сборки. Ниже прежняя версия."
const KEPT = "Прежние ролики остаются до конца сборки"

export interface DoneStep {
  readonly body: HTMLElement
  readonly dispose: () => void
}

const buildProgress = (): { readonly node: HTMLElement; readonly cancel: HTMLButtonElement; readonly paint: (job: Busy, kept: File | undefined) => void } => {
  const status = h("p", { class: "done-progress__text", role: "status" })
  const bar = h("progress", { class: "bar", max: "1" })
  const cancel = button("quiet", "Остановить", {}, "stop")
  const kept = h("p", { class: "hint" }, KEPT)
  const node = h("div", { class: "done-progress", hidden: true }, h("div", { class: "done-progress__line" }, status, cancel), bar, kept)
  return {
    node,
    cancel,
    paint: (job, file) => {
      const now = progressOf(job)
      status.textContent = now.text
      if (now.done === undefined) bar.removeAttribute("value")
      else bar.value = now.done
      kept.hidden = file === undefined
    }
  }
}

const buildLabel = (phase: Phase): ReadonlyArray<Node | string> => phase.kind === "built" ? [icon("retry"), "Собрать заново"] : ["Собрать ролик"]

export const doneStep = (projectId: string): DoneStep => {
  const state = { timer: 0, busy: false, asked: 0, shown: 0 }
  const title = h("h1", { tabindex: "-1" }, "Ролики")
  const progress = buildProgress()
  const problem = h("p", { class: "error", role: "alert" })
  const empty = h("div", { class: "done-empty", hidden: true }, h("p", { class: "hint" }, EMPTY),
    h("a", { class: "btn btn--quiet btn--start", href: stepPath(projectId, "montage") }, icon("left"), "К монтажу"))
  const stale = h("div", { class: "ask ask--open", hidden: true }, h("p", {}, STALE))
  const file = reelFile(projectId)
  const build = button("main", "Собрать ролик")
  const actions = h("div", { class: "done-actions" }, file.downloadAll, build)
  const body = h("div", { class: "body body--done" },
    h("div", { class: "head" }, title), progress.node, problem, empty, stale, file.node, actions)

  const paint = (view: ReelView): void => {
    const phase = phaseOf(view)
    state.busy = phase.kind === "building"
    title.textContent = headingOf(phase)
    progress.node.hidden = phase.kind !== "building"
    empty.hidden = phase.kind !== "empty"
    stale.hidden = !(phase.kind === "built" && phase.stale)
    file.node.hidden = phase.kind !== "built"
    actions.hidden = phase.kind === "building" || phase.kind === "empty"
    if (phase.kind !== "built") file.downloadAll.hidden = true
    if (phase.kind === "building") {
      progress.paint(phase.job, phase.kept)
      problem.textContent = ""
    } else if (phase.kind !== "empty" && phase.failed !== undefined) problem.textContent = failureText(phase.failed)
    if (phase.kind === "built") file.paint(phase.file, phase.stale)
    build.replaceChildren(...buildLabel(phase))
    build.className = `btn btn--${phase.kind === "built" && !phase.stale ? "quiet" : "main"}`
  }

  // A reply to an older request would paint a state the person has already moved past.
  const ask = (run: Effect.Effect<ReelView, Api.Failed>, source: "poll" | "action"): Effect.Effect<void> => {
    const ticket = (state.asked += 1)
    return run.pipe(
      Effect.map((view) => {
        if (ticket <= state.shown) return
        state.shown = ticket
        paint(view)
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        if (source === "action" && ticket > state.shown) problem.textContent = error.message
      }))
    )
  }

  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!body.isConnected) return
    Effect.runFork(ask(Api.getReel(projectId), "poll").pipe(Effect.ensuring(Effect.sync(() => {
      globalThis.clearTimeout(state.timer)
      if (body.isConnected) state.timer = Number(globalThis.setTimeout(refresh, state.busy ? POLL_MS : IDLE_MS))
    }))))
  }

  const act = (run: Effect.Effect<ReelView, Api.Failed>, control: HTMLButtonElement): void => {
    control.disabled = true
    problem.textContent = ""
    Effect.runFork(ask(run, "action").pipe(Effect.ensuring(Effect.sync(() => {
      control.disabled = false
      refresh()
    }))))
  }

  build.addEventListener("click", () => {
    file.pause()
    act(Api.buildReel(projectId), build)
  })
  progress.cancel.addEventListener("click", () => { act(Api.cancelReel(projectId), progress.cancel) })
  // The poll stops once its anchor leaves the page, so the first load waits until the caller has put the body on the page.
  queueMicrotask(refresh)
  return {
    body,
    dispose: () => {
      globalThis.clearTimeout(state.timer)
      file.dispose()
    }
  }
}
