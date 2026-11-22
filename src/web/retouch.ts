import { Effect } from "effect"
import type { Face } from "../shared/face.ts"
import { minuteTakes, TRIAL_SECONDS, type RetouchView } from "../shared/retouch.ts"
import * as Api from "./api.ts"
import type WaSwitch from "@awesome.me/webawesome/dist/components/switch/switch.js"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { faceCompare } from "./face-compare.ts"

const POLL_MS = 1000
const IDLE_MS = 5000

const ABOUT = `Студия возьмёт первые ${TRIAL_SECONDS} секунд ролика и только на лице выровняет тон кожи и осветлит белки глаз. Новых кадров она не рисует, исходные видео не меняются. Проба ролик не меняет: включить выравнивание в ролике можно ниже.`
const FAILED = "Проба не получилась. Подробности в журнале студии. Нажмите «Сделать пробу», чтобы попробовать ещё раз."
const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и пробу можно будет сделать."
const NEEDS_TRIAL = "Сначала сделайте пробу и сравните лицо до и после. Потом здесь можно включить выравнивание."
const OFF_KEPT = "Выключено. Лицо в готовом ролике остаётся как в исходных видео."
const LIGHT_KEPT = "Включено. Готовый ролик уже собран с выровненным лицом."
const LIGHT_UNBUILT = "Включено. Нажмите «Собрать ролик с выровненным лицом»: студия соберёт ролик, и лицо в нём будет выровнено."
const LIGHT_STALE = "Включено, но готовый ролик собран без выравнивания. Нажмите «Собрать ролик с выровненным лицом»: студия соберёт его заново."
const OFF_STALE = "Выключено, но готовый ролик собран с выровненным лицом. Нажмите «Собрать ролик заново», чтобы вернуть исходное лицо."

export const faceNext = (view: RetouchView): string => {
  if (view.trial === undefined && view.face === "off") return NEEDS_TRIAL
  if (view.face === "light") return view.built === undefined ? LIGHT_UNBUILT : view.built === "light" ? LIGHT_KEPT : LIGHT_STALE
  return view.built === "light" ? OFF_STALE : OFF_KEPT
}

export const needsBuild = (view: RetouchView): boolean =>
  view.built === undefined ? view.face === "light" : view.built !== view.face

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

const faceChoice = (onPick: (face: Face) => void, onBuild: () => void): { readonly node: HTMLElement; readonly show: (view: RetouchView) => void } => {
  const toggle: WaSwitch = h("wa-switch", { change: () => { onPick(toggle.checked ? "light" : "off") } }, "Выровнять кожу и белки глаз в готовом ролике")
  const next = h("p", { class: "face-next", role: "status" })
  const build = button("primary", { click: onBuild }, "Собрать ролик")
  const buildRow = h("div", { class: "row", hidden: true }, build)
  const node = h("section", { class: "face-apply" }, h("h3", {}, "Лицо в готовом ролике"), toggle, next, buildRow)
  const show = (view: RetouchView): void => {
    toggle.checked = view.face === "light"
    toggle.disabled = view.trial === undefined && view.face === "off"
    next.textContent = faceNext(view)
    buildRow.hidden = !needsBuild(view) || view.cut === 0
    build.textContent = view.face === "light" ? "Собрать ролик с выровненным лицом" : "Собрать ролик заново"
  }
  return { node, show }
}

export const retouchCard = (projectId: string, onBuild: () => void): { readonly node: HTMLElement; readonly refresh: () => void; readonly pause: () => void } => {
  const state = { timer: 0, made: "", busy: false, saving: false, counter: 0, applied: 0 }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const pair = faceCompare()
  const clip = h("video", { class: "trial-clip", controls: true, playsinline: true, preload: "metadata" })
  const cost = h("p", {})
  const result = h("div", { class: "trial", hidden: true },
    pair.node, clip, h("p", { class: "muted" }, "В видео слева до, справа после."), cost)
  const start = button("normal", {}, "Сделать пробу")
  const choice = faceChoice((face) => { choose(face) }, onBuild)
  const node = h("section", { class: "card reel-card" }, h("h2", {}, "Проба: ровная кожа и белки глаз"), h("p", { class: "muted" }, ABOUT), h("div", { class: "row" }, start), status, bar, problem, result, choice.node)

  const show = (view: RetouchView): void => {
    state.busy = view.job.state === "waiting" || view.job.state === "running"
    start.disabled = state.busy || view.cut === 0
    start.textContent = view.trial === undefined ? "Сделать пробу" : "Сделать пробу заново"
    status.textContent = trialStatus(view)
    bar.hidden = view.job.state !== "running"
    bar.value = view.job.state === "running" ? view.job.done : 0
    if (view.job.state === "failed") problem.textContent = FAILED
    else if (state.busy) problem.textContent = ""
    if (!state.saving) choice.show(view)
    result.hidden = view.trial === undefined
    if (view.trial === undefined) return
    if (state.made !== view.trial.made) {
      state.made = view.trial.made
      pair.show(Api.retouchUrl(projectId, "before.jpg", state.made), Api.retouchUrl(projectId, "after.jpg", state.made))
      clip.src = Api.retouchUrl(projectId, "compare.mp4", state.made)
    }
    cost.textContent = costText(view.trial)
  }

  const invalidate = (): void => {
    state.applied = (state.counter += 1)
  }

  const refresh = (): void => {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    state.timer = Number(globalThis.setTimeout(refresh, state.busy ? POLL_MS : IDLE_MS))
    const seq = (state.counter += 1)
    Effect.runFork(Api.getRetouch(projectId).pipe(
      Effect.map((view) => {
        if (seq <= state.applied) return
        state.applied = seq
        show(view)
      }),
      Effect.catchTag("Failed", () => Effect.void)
    ))
  }

  start.addEventListener("click", () => {
    start.disabled = true
    problem.textContent = ""
    invalidate()
    Effect.runFork(Api.startRetouch(projectId).pipe(
      Effect.map((view) => {
        invalidate()
        show(view)
        refresh()
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        problem.textContent = error.message
        start.disabled = false
      }))
    ))
  })

  const choose = (face: Face): void => {
    state.saving = true
    problem.textContent = ""
    invalidate()
    Effect.runFork(Api.setFace(projectId, face).pipe(
      Effect.map((view) => {
        state.saving = false
        invalidate()
        show(view)
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        state.saving = false
        problem.textContent = error.message
        refresh()
      }))
    ))
  }

  return { node, refresh, pause: () => { clip.pause() } }
}
