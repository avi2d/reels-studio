import { Effect } from "effect"
import type { ReelView } from "../shared/reel.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatSize } from "./format.ts"
import type { StageNote } from "./stages.ts"

const POLL_MS = 1000

const ABOUT = "Студия соберёт ролик из исходных видео: выбранные дубли в порядке блоков, без убранных пауз, с мягким звуком на каждой склейке. Исходные видео не меняются."
const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и ролик можно будет собрать."
const FAILED = "Ролик не собрался. Подробности в журнале студии. Нажмите «Собрать ролик», чтобы попробовать ещё раз."
const NOT_SAVED = "Монтаж ещё не сохранился. Проверьте Wi-Fi: студия сохраняет его сама."
const STALE = "Монтаж изменился после сборки. Соберите ролик заново, чтобы файл совпал с монтажом."
const SAVE_HINT = "На айфоне откройте скачанный файл и выберите «Сохранить видео»: ролик появится в «Фото», и Instagram его найдёт."

export const statusOf = (view: ReelView): string => {
  const { job } = view
  if (job.state === "waiting") return "Ролик ждёт своей очереди: компьютер занят другой тяжёлой работой."
  if (job.state === "running") return job.done < 1 ? `Студия собирает ролик: ${Math.floor(job.done * 100)}%` : "Студия сохраняет файл."
  if (view.cut === 0) return NO_CUT
  return view.file === undefined ? `Ролик выйдет на ${formatLength(view.cut)}.` : ""
}

const isBusy = (view: ReelView): boolean => view.job.state === "waiting" || view.job.state === "running"

const madeAt = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

export const reelPane = (projectId: string, hooks: { readonly note: (note: StageNote) => void; readonly playing: () => void; readonly flush: () => Promise<boolean>; readonly pending: () => boolean }): {
  readonly node: HTMLElement
  readonly refresh: () => void
  readonly pause: () => void
  readonly edited: () => void
  readonly settled: (ok: boolean) => void
} => {
  const state: { timer: number; made: string | undefined; dirty: boolean; seen: number } = { timer: 0, made: undefined, dirty: false, seen: 0 }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata" })
  const facts = h("p", { class: "muted" })
  const stale = h("p", { class: "stale", hidden: true }, STALE)
  const save = button("normal", { href: Api.reelDownloadUrl(projectId), download: "" }, "Скачать")
  const file = h("div", { class: "built", hidden: true }, player, h("div", { class: "built-facts" }, facts, save, h("p", { class: "muted" }, SAVE_HINT)))
  const make = button("primary", {}, "Собрать ролик")
  const cancel = button("quiet", { hidden: true }, "Остановить сборку")
  const actions = h("div", { class: "row" }, make, cancel)
  const node = h("div", { class: "pane" }, h("section", { class: "card reel-card" }, h("h2", {}, "Готовый ролик"), h("p", { class: "muted" }, ABOUT), actions, status, bar, stale, problem), file)
  player.addEventListener("play", hooks.playing)

  const later = (): void => {
    globalThis.clearTimeout(state.timer)
    state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }

  const show = (view: ReelView): void => {
    const busy = isBusy(view)
    make.disabled = busy || view.cut === 0 || state.dirty || hooks.pending()
    make.hidden = busy
    cancel.hidden = !busy
    cancel.disabled = false
    make.textContent = view.file === undefined ? "Собрать ролик" : "Собрать заново"
    status.textContent = statusOf(view)
    bar.hidden = view.job.state !== "running"
    bar.value = view.job.state === "running" ? view.job.done : 0
    if (view.job.state === "failed") problem.textContent = FAILED
    else if (busy) problem.textContent = ""
    file.hidden = view.file === undefined
    if (view.file !== undefined) {
      if (state.made !== view.file.made) {
        state.made = view.file.made
        player.src = Api.reelUrl(projectId, view.file.made)
      }
      facts.textContent = `Длина ${formatLength(view.file.seconds)} · ${formatSize(view.file.size)} · собран ${madeAt(view.file.made)}`
      stale.hidden = busy || (view.file.fresh && !state.dirty)
    }
    hooks.note({ note: "", done: view.file?.fresh === true })
    if (busy) later()
  }

  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    state.seen += 1
    const ticket = state.seen
    Effect.runFork(Api.getReel(projectId).pipe(
      Effect.map((view) => {
        if (ticket !== state.seen) return
        show(view)
      }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        if (ticket !== state.seen) return
        later()
      }))
    ))
  }

  const edited = (): void => {
    state.seen += 1
    state.dirty = true
    make.disabled = true
    hooks.note({ note: "", done: false })
    if (!file.hidden) stale.hidden = false
  }
  const settled = (ok: boolean): void => {
    if (!ok) {
      make.disabled = true
      if (!file.hidden) stale.hidden = false
      return
    }
    state.dirty = false
    refresh()
  }
  make.addEventListener("click", () => {
    make.disabled = true
    problem.textContent = ""
    void hooks.flush().then((ok) => {
      if (!node.isConnected) return
      if (!ok) {
        problem.textContent = NOT_SAVED
        return
      }
      state.seen += 1
      const ticket = state.seen
      Effect.runFork(Api.buildReel(projectId).pipe(
        Effect.map((view) => {
          if (ticket !== state.seen) return
          show(view)
        }),
        Effect.catchTag("Failed", (error) => Effect.sync(() => {
          if (ticket !== state.seen) return
          problem.textContent = error.message
          make.disabled = state.dirty || hooks.pending()
        }))
      ))
    })
  })

  cancel.addEventListener("click", () => {
    cancel.disabled = true
    state.seen += 1
    const ticket = state.seen
    Effect.runFork(Api.cancelReel(projectId).pipe(
      Effect.map((view) => {
        if (ticket !== state.seen) return
        show(view)
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        if (ticket !== state.seen) return
        problem.textContent = error.message
        cancel.disabled = false
      }))
    ))
  })

  return { node, refresh, pause: () => { player.pause() }, edited, settled }
}
