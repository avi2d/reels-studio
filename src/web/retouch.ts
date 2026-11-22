import { Effect } from "effect"
import { minuteTakes, TRIAL_SECONDS, type RetouchView } from "../shared/retouch.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"

const POLL_MS = 1000
const IDLE_MS = 5000

const ABOUT = `Студия возьмёт первые ${TRIAL_SECONDS} секунд ролика и только на лице выровняет тон кожи и осветлит белки глаз. Новых кадров она не рисует, исходные видео не меняются.`
const FAILED = "Проба не получилась. Подробности в журнале студии. Нажмите «Сделать пробу», чтобы попробовать ещё раз."
const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и пробу можно будет сделать."

export const spentText = (seconds: number): string => {
  const whole = Math.max(1, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes === 0) return `${rest} с`
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${rest} с`
}

export const trialStatus = (view: RetouchView): string => {
  const { job } = view
  if (job.state === "waiting") return "Проба ждёт своей очереди: компьютер занят другой тяжёлой работой."
  if (job.state === "running") return `Студия делает пробу: ${Math.floor(job.done * 100)}%`
  if (view.cut === 0) return NO_CUT
  return ""
}

export const costText = (trial: { readonly seconds: number; readonly took: number }): string =>
  `На ${spentText(trial.seconds)} видео ушло ${spentText(trial.took)}. Минута видео займёт около ${spentText(minuteTakes(trial))}.`

const picture = (caption: string, image: HTMLImageElement): HTMLElement =>
  h("figure", { class: "trial-picture" }, image, h("figcaption", {}, caption))

export const retouchCard = (projectId: string): { readonly node: HTMLElement; readonly refresh: () => void; readonly pause: () => void } => {
  const state = { timer: 0, made: "", busy: false }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const before = h("img", { alt: "Лицо до пробы", width: "720", height: "720" })
  const after = h("img", { alt: "Лицо после пробы", width: "720", height: "720" })
  const clip = h("video", { class: "trial-clip", controls: true, playsinline: true, preload: "metadata" })
  const cost = h("p", {})
  const result = h("div", { class: "trial", hidden: true },
    h("div", { class: "trial-pair" }, picture("До", before), picture("После", after)),
    clip, h("p", { class: "muted" }, "В видео слева до, справа после."), cost)
  const start = button("normal", {}, "Сделать пробу")
  const node = h("section", { class: "card reel-card" }, h("h2", {}, "Проба: ровная кожа и белки глаз"), h("p", { class: "muted" }, ABOUT), h("div", { class: "row" }, start), status, bar, problem, result)

  const show = (view: RetouchView): void => {
    state.busy = view.job.state === "waiting" || view.job.state === "running"
    start.disabled = state.busy || view.cut === 0
    start.textContent = view.trial === undefined ? "Сделать пробу" : "Сделать пробу заново"
    status.textContent = trialStatus(view)
    bar.hidden = view.job.state !== "running"
    bar.value = view.job.state === "running" ? view.job.done : 0
    if (view.job.state === "failed") problem.textContent = FAILED
    else if (state.busy) problem.textContent = ""
    result.hidden = view.trial === undefined
    if (view.trial === undefined) return
    if (state.made !== view.trial.made) {
      state.made = view.trial.made
      before.src = Api.retouchUrl(projectId, "before.jpg", state.made)
      after.src = Api.retouchUrl(projectId, "after.jpg", state.made)
      clip.src = Api.retouchUrl(projectId, "compare.mp4", state.made)
    }
    cost.textContent = costText(view.trial)
  }

  const refresh = (): void => {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    state.timer = Number(globalThis.setTimeout(refresh, state.busy ? POLL_MS : IDLE_MS))
    Effect.runFork(Api.getRetouch(projectId).pipe(Effect.map(show), Effect.catchTag("Failed", () => Effect.void)))
  }

  start.addEventListener("click", () => {
    start.disabled = true
    problem.textContent = ""
    Effect.runFork(Api.startRetouch(projectId).pipe(
      Effect.map((view) => {
        show(view)
        refresh()
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        problem.textContent = error.message
        start.disabled = false
      }))
    ))
  })

  return { node, refresh, pause: () => { clip.pause() } }
}
