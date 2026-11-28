import { Effect } from "effect"
import type { Face, NoFace } from "../../shared/face.ts"
import { CLOSE_UP_FROM_SECONDS, TRIAL_SECONDS, type RetouchView } from "../../shared/retouch.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { costText, trialStatus } from "../retouch.ts"
import { button } from "./ui.ts"

const POLL_MS = 1000

const ABOUT = `«Мягче» выравнивает тон кожи и осветляет белки глаз. Выбрать его можно после пробы: студия проверит первые ${TRIAL_SECONDS} секунд ролика.`
const FAILED = "Проба не получилась. Подробности в журнале студии. Нажмите «Сделать пробу», чтобы попробовать ещё раз."
const NO_FACE = {
  "short-cut": `Проба не получилась: ролик короче ${CLOSE_UP_FROM_SECONDS} секунд, а лицо студия ищет после ${CLOSE_UP_FROM_SECONDS}-й секунды. Сделайте ролик длиннее на шаге «Монтаж» и повторите пробу.`,
  unseen: `Проба не получилась: студия ищет лицо с ${CLOSE_UP_FROM_SECONDS}-й секунды ролика и не нашла его. Поставьте первым блок, где видно лицо, и повторите пробу.`
} satisfies Record<NoFace, string>

const failureText = (job: RetouchView["job"]): string =>
  job.state !== "failed" ? "" : job.noFace === undefined ? FAILED : NO_FACE[job.noFace]

const isBusy = (view: RetouchView): boolean => view.job.state === "waiting" || view.job.state === "running"

export interface LookFace {
  readonly node: HTMLElement
  readonly refresh: () => void
  readonly dispose: () => void
}

export const lookFace = (projectId: string): LookFace => {
  const state: { timer: number; asked: number; view: RetouchView | undefined } = { timer: 0, asked: 0, view: undefined }
  const asIs = button("quiet", "Как есть", { "aria-pressed": "false", click: () => { choose("off") } })
  const softer = button("quiet", "Мягче", { "aria-pressed": "false", "aria-describedby": "look-face-about", click: () => { choose("light") } })
  const about = h("p", { class: "hint", id: "look-face-about" }, ABOUT)
  const status = h("p", { class: "hint", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const start = button("quiet", "Сделать пробу", { click: () => { startTrial() } })
  const node = h("div", { class: "look-row" },
    h("span", { class: "look-row__label", id: "look-face-title" }, "Лицо"),
    h("div", { class: "look-row__control" },
      h("div", { class: "seg", role: "group", "aria-labelledby": "look-face-title" }, asIs, softer),
      about, h("div", { class: "look-trial" }, start), status, bar, problem))

  const show = (view: RetouchView): void => {
    state.view = view
    const busy = isBusy(view)
    const tried = view.trial !== undefined
    for (const [choice, face] of [[asIs, "off"], [softer, "light"]] as const) {
      const on = view.face === face
      choice.className = `btn btn--${on ? "main" : "quiet"}`
      choice.setAttribute("aria-pressed", String(on))
    }
    softer.disabled = !tried && view.face === "off"
    about.hidden = tried
    start.hidden = tried && view.job.state !== "failed"
    start.disabled = busy || view.cut === 0
    start.textContent = tried ? "Сделать пробу заново" : "Сделать пробу"
    const waiting = trialStatus(view)
    status.textContent = waiting !== "" ? waiting : tried && !busy ? costText(view.trial) : ""
    bar.hidden = view.job.state !== "running"
    bar.value = view.job.state === "running" ? view.job.done : 0
    problem.textContent = failureText(view.job)
  }

  const pollLater = (): void => {
    globalThis.clearTimeout(state.timer)
    if (node.isConnected && state.view !== undefined && isBusy(state.view)) state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }

  const apply = (asked: number) => (view: RetouchView): void => {
    if (asked !== state.asked) return
    show(view)
    pollLater()
  }

  const fail = (asked: number) => (error: Api.Failed) => Effect.sync(() => {
    if (asked !== state.asked) return
    if (state.view !== undefined) show(state.view)
    problem.textContent = error.message
  })

  const ask = (call: Effect.Effect<RetouchView, Api.Failed>): void => {
    state.asked += 1
    const asked = state.asked
    Effect.runFork(call.pipe(Effect.map(apply(asked)), Effect.catchTag("Failed", fail(asked))))
  }

  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    ask(Api.getRetouch(projectId))
  }

  const startTrial = (): void => {
    start.disabled = true
    problem.textContent = ""
    ask(Api.startRetouch(projectId))
  }

  const choose = (face: Face): void => {
    if (state.view?.face === face) return
    problem.textContent = ""
    ask(Api.setFace(projectId, face))
  }

  return { node, refresh, dispose: () => { globalThis.clearTimeout(state.timer) } }
}
