import type { Noise, NoiseView, PauseNoise } from "../../shared/noise.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import type { UrlOf } from "../montage.ts"
import { queued } from "./queued.ts"
import { button } from "./ui.ts"

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
  let source = ""
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
    if (key === source) return
    source = key
    onSource(sourceOf(projectId, view))
  }

  const requests = queued({ node, problem, isBusy, show, load: Api.getNoise(projectId) })

  const start = (): void => {
    requests.stop()
    if (!node.isConnected) return
    source = ""
    onSource((video) => Api.previewUrl(projectId, video))
    problem.textContent = ""
    again.hidden = true
    requests.ask(Api.startCleaning(projectId))
  }

  const choose = (noise: Noise): void => {
    if (requests.view()?.noise === noise) return
    problem.textContent = ""
    requests.ask(Api.setNoise(projectId, noise))
  }

  return { node, refresh: start, dispose: requests.stop }
}
