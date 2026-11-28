import { Effect } from "effect"
import type { Noise, NoiseView, PauseNoise } from "../../shared/noise.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import type { UrlOf } from "../montage.ts"
import { button } from "./ui.ts"

const POLL_MS = 1000

const ABOUT = "Нажмите «Смотреть ролик», чтобы услышать выбранный вариант. Исходные видео не меняются."
const FAILED = "Звук очистить не получилось. Подробности в журнале студии."
const NOT_YET = "Пока студия чистит звук, ролик играет как есть."

const CHOICES = [["off", "Оставить"], ["light", "Убрать слегка"], ["strong", "Убрать сильно"]] as const satisfies ReadonlyArray<readonly [Noise, string]>

const SILENT_PAUSE_DB = -65

const decibels = (value: number): string => `${Math.round(value).toString().replace("-", "\u2212")}\u00a0дБ`

export const noiseFacts = (pauses: PauseNoise, noise: Noise): ReadonlyArray<string> => {
  const level = noise === "off"
    ? `Шум в паузах: ${decibels(pauses.off)}, как в записи.`
    : `Шум в паузах: ${decibels(pauses.off)} в записи, ${decibels(pauses[noise])} после очистки.`
  return pauses.off < SILENT_PAUSE_DB ? [level, "В паузах и в записи почти тихо, поэтому на слух разница едва заметна."] : [level]
}

const isBusy = (view: NoiseView): boolean => view.job.state === "waiting" || view.job.state === "running"

export const noiseStatus = (view: NoiseView): string => {
  const { job } = view
  if (job.state === "waiting") return "Очистка звука ждёт своей очереди: компьютер занят другой тяжёлой работой."
  if (job.state === "running") return `Студия чистит звук: ${Math.floor(job.done * 100)}%`
  return ""
}

export const sourceOf = (projectId: string, view: NoiseView): UrlOf => {
  const { noise, cleaned } = view
  if (noise === "off" || cleaned === undefined) return (video) => Api.previewUrl(projectId, video)
  return (video) => Api.cleanedPreviewUrl(projectId, noise, video, cleaned.made)
}

const sourceKey = (view: NoiseView): string => view.noise === "off" || view.cleaned === undefined ? "" : `${view.noise} ${view.cleaned.made}`

export interface LookNoise {
  readonly node: HTMLElement
  readonly refresh: () => void
  readonly dispose: () => void
}

export const lookNoise = (projectId: string, onSource: (urlOf: UrlOf) => void): LookNoise => {
  const state: { timer: number; asked: number; view: NoiseView | undefined; source: string } = { timer: 0, asked: 0, view: undefined, source: "" }
  const choices = CHOICES.map(([noise, label]) => [noise, button("quiet", label, { "aria-pressed": "false", click: () => { choose(noise) } })] as const)
  const facts = h("div", { class: "look-noise__facts" })
  const status = h("p", { class: "hint", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const again = button("quiet", "Попробовать ещё раз", { hidden: true, click: () => { start() } })
  const node = h("div", { class: "look-row" },
    h("span", { class: "look-row__label", id: "look-noise-title" }, "Шум"),
    h("div", { class: "look-row__control" },
      h("div", { class: "seg look-noise__choices", role: "group", "aria-labelledby": "look-noise-title" }, ...choices.map(([, choice]) => choice)),
      h("p", { class: "hint" }, ABOUT), facts, status, bar, problem, again))

  const show = (view: NoiseView): void => {
    state.view = view
    for (const [noise, choice] of choices) {
      const on = view.noise === noise
      choice.className = `btn btn--${on ? "main" : "quiet"}`
      choice.setAttribute("aria-pressed", String(on))
    }
    const pauses = view.cleaned?.pauses
    facts.replaceChildren(...(pauses === undefined ? [] : noiseFacts(pauses, view.noise).map((fact) => h("p", {}, fact))))
    const progress = noiseStatus(view)
    status.textContent = view.noise !== "off" && view.cleaned === undefined && view.job.state !== "failed" ? [progress, NOT_YET].filter((text) => text !== "").join(" ") : progress
    bar.hidden = view.job.state !== "running"
    bar.value = view.job.state === "running" ? view.job.done : 0
    problem.textContent = view.job.state === "failed" ? FAILED : ""
    again.hidden = view.job.state !== "failed"
    const key = sourceKey(view)
    if (key === state.source) return
    state.source = key
    onSource(sourceOf(projectId, view))
  }

  const pollLater = (): void => {
    globalThis.clearTimeout(state.timer)
    if (node.isConnected && state.view !== undefined && isBusy(state.view)) state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }

  const apply = (asked: number) => (view: NoiseView): void => {
    if (asked !== state.asked) return
    show(view)
    pollLater()
  }

  const fail = (asked: number) => (error: Api.Failed) => Effect.sync(() => {
    if (asked !== state.asked) return
    if (state.view !== undefined) show(state.view)
    problem.textContent = error.message
    pollLater()
  })

  const ask = (call: Effect.Effect<NoiseView, Api.Failed>): void => {
    state.asked += 1
    const asked = state.asked
    Effect.runFork(call.pipe(Effect.map(apply(asked)), Effect.catchTag("Failed", fail(asked))))
  }

  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    ask(Api.getNoise(projectId))
  }

  const start = (): void => {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    problem.textContent = ""
    again.hidden = true
    ask(Api.startCleaning(projectId))
  }

  const choose = (noise: Noise): void => {
    if (state.view?.noise === noise) return
    problem.textContent = ""
    ask(Api.setNoise(projectId, noise))
  }

  return { node, refresh: start, dispose: () => { globalThis.clearTimeout(state.timer) } }
}
