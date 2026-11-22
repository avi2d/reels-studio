import { Effect } from "effect"
import type { ColourView, PictureSide, ReelView } from "../shared/reel.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatSize } from "./format.ts"
import type { StageNote } from "./stages.ts"

const POLL_MS = 1000
const IDLE_MS = 3000

const ABOUT = "Студия соберёт ролик из исходных видео: выбранные дубли в порядке блоков, без убранных пауз, с мягким звуком на каждой склейке. Исходные видео не меняются."
const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и ролик можно будет собрать."
const FAILED = "Ролик не собрался. Подробности в журнале студии. Нажмите «Собрать ролик», чтобы попробовать ещё раз."
const NOT_SAVED = "Монтаж ещё не сохранился. Проверьте Wi-Fi: студия сохраняет его сама."
const STALE = "Монтаж изменился после сборки. Соберите ролик заново, чтобы файл совпал с монтажом."
const SAVE_HINT = "На айфоне откройте скачанный файл и выберите «Сохранить видео»: ролик появится в «Фото», и Instagram его найдёт."

const MATCHED = "Студия измерила цвет кожи в каждом видео ролика и подогнала остальные видео к первому видео с лицом. На каждой картинке слева последний кадр одного видео, справа первый кадр следующего."
const NO_FACE = "Студия не нашла лицо хотя бы в одном видео, и цвет этого видео остался как есть."

export const colourNote = (colour: ColourView): string | undefined => {
  if (colour.matched > 0) return colour.unmeasured > 0 ? `${MATCHED} ${NO_FACE}` : MATCHED
  return colour.unmeasured > 0 ? NO_FACE : undefined
}

const SIDES: ReadonlyArray<readonly [PictureSide, string]> = [["before", "До"], ["after", "После"]]

const colourPictures = (projectId: string, made: string, joins: number): ReadonlyArray<HTMLElement> =>
  Array.from({ length: joins }, (_, index) => {
    const join = index + 1
    const figures = SIDES.map(([side, label]) => h("figure", {},
      h("img", { src: Api.reelPictureUrl(projectId, made, join, side), alt: `Склейка ${label.toLowerCase()} подгонки цвета`, loading: "lazy", width: "1080", height: "960" }),
      h("figcaption", {}, label)))
    return h("div", { class: "colour-join" }, ...(joins > 1 ? [h("h3", {}, `Склейка ${join}`)] : []), h("div", { class: "colour-pair" }, ...figures))
  })

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

interface ReelHooks {
  readonly note: (note: StageNote) => void
  readonly playing: () => void
  readonly flush: () => Promise<boolean>
  readonly pending: () => boolean
}

interface ReelState {
  timer: number
  made: string | undefined
  dirty: boolean
  busy: boolean
  counter: number
  floor: number
  applied: number
}

interface ReelUi {
  readonly status: HTMLParagraphElement
  readonly bar: HTMLProgressElement
  readonly problem: HTMLParagraphElement
  readonly player: HTMLVideoElement
  readonly facts: HTMLParagraphElement
  readonly stale: HTMLParagraphElement
  readonly save: ReturnType<typeof button>
  readonly file: HTMLDivElement
  readonly make: ReturnType<typeof button>
  readonly cancel: ReturnType<typeof button>
  readonly colour: HTMLElement
  readonly node: HTMLDivElement
}

interface Pane {
  readonly projectId: string
  readonly hooks: ReelHooks
  readonly state: ReelState
  readonly ui: ReelUi
}

const invalidate = (pane: Pane): void => {
  pane.state.floor = (pane.state.counter += 1)
}

const show = (pane: Pane, view: ReelView): void => {
  const { hooks, state, ui } = pane
  state.busy = isBusy(view)
  ui.make.disabled = state.busy || view.cut === 0 || state.dirty || hooks.pending()
  ui.make.hidden = state.busy
  ui.cancel.hidden = !state.busy
  ui.cancel.disabled = false
  ui.make.textContent = view.file === undefined ? "Собрать ролик" : "Собрать заново"
  ui.status.textContent = statusOf(view)
  ui.bar.hidden = view.job.state !== "running"
  ui.bar.value = view.job.state === "running" ? view.job.done : 0
  if (view.job.state === "failed") ui.problem.textContent = FAILED
  else if (state.busy) ui.problem.textContent = ""
  ui.file.hidden = view.file === undefined
  if (view.file !== undefined) {
    if (state.made !== view.file.made) {
      state.made = view.file.made
      ui.player.src = Api.reelUrl(pane.projectId, view.file.made)
      ui.save.setAttribute("href", Api.reelDownloadUrl(pane.projectId, view.file.made))
    }
    ui.facts.textContent = `Длина ${formatLength(view.file.seconds)} · ${formatSize(view.file.size)} · собран ${madeAt(view.file.made)}`
    ui.stale.hidden = state.busy || (view.file.fresh && !state.dirty)
  }
  showColour(pane, view)
  hooks.note({ note: "", done: view.file?.fresh === true && !state.dirty })
}

const showColour = (pane: Pane, view: ReelView): void => {
  const { colour } = pane.ui
  const shown = view.file?.colour
  const note = shown === undefined ? undefined : colourNote(shown)
  const key = view.file === undefined || note === undefined ? "" : view.file.made
  if (colour.dataset["made"] === key) return
  colour.dataset["made"] = key
  colour.hidden = key === ""
  if (view.file === undefined || shown === undefined || note === undefined) return colour.replaceChildren()
  colour.replaceChildren(h("h2", {}, "Цвет кожи"), h("p", { class: "muted" }, note), ...colourPictures(pane.projectId, view.file.made, shown.joins))
}

const refresh = (pane: Pane): void => {
  const { state, ui } = pane
  globalThis.clearTimeout(state.timer)
  if (!ui.node.isConnected) return
  state.timer = Number(globalThis.setTimeout(() => refresh(pane), state.busy ? POLL_MS : IDLE_MS))
  const seq = (state.counter += 1)
  Effect.runFork(Api.getReel(pane.projectId).pipe(
    Effect.map((view) => {
      if (seq <= state.applied || seq <= state.floor) return
      state.applied = seq
      show(pane, view)
    }),
    Effect.catchTag("Failed", () => Effect.void)
  ))
}

const mutate = (pane: Pane, run: () => Effect.Effect<ReelView, Api.Failed>, fail: () => void): void => {
  invalidate(pane)
  const seq = (pane.state.counter += 1)
  Effect.runFork(run().pipe(
    Effect.map(() => {
      invalidate(pane)
      refresh(pane)
    }),
    Effect.catchTag("Failed", (error) => Effect.sync(() => {
      const current = seq > pane.state.floor
      invalidate(pane)
      if (current) {
        pane.ui.problem.textContent = error.message
        fail()
      }
      refresh(pane)
    }))
  ))
}

export const reelPane = (projectId: string, hooks: ReelHooks): {
  readonly node: HTMLElement
  readonly colour: HTMLElement
  readonly refresh: () => void
  readonly pause: () => void
  readonly edited: () => void
  readonly settled: (ok: boolean) => void
} => {
  const state: ReelState = { timer: 0, made: undefined, dirty: false, busy: false, counter: 0, floor: 0, applied: 0 }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata" })
  const facts = h("p", { class: "muted" })
  const stale = h("p", { class: "stale", hidden: true }, STALE)
  const save = button("normal", { download: "" }, "Скачать")
  const file = h("div", { class: "built", hidden: true }, player, h("div", { class: "built-facts" }, facts, save, h("p", { class: "muted" }, SAVE_HINT)))
  const make = button("primary", {}, "Собрать ролик")
  const cancel = button("quiet", { hidden: true }, "Остановить сборку")
  const actions = h("div", { class: "row" }, make, cancel)
  const colour = h("section", { class: "card colour-card", hidden: true })
  const node = h("div", { class: "pane" }, h("section", { class: "card reel-card" }, h("h2", {}, "Готовый ролик"), h("p", { class: "muted" }, ABOUT), actions, status, bar, stale, problem), file)
  const pane: Pane = { projectId, hooks, state, ui: { status, bar, problem, player, facts, stale, save, file, make, cancel, colour, node } }
  player.addEventListener("play", hooks.playing)

  const edited = (): void => {
    invalidate(pane)
    state.dirty = true
    make.disabled = true
    hooks.note({ note: "", done: false })
    if (!file.hidden) stale.hidden = false
  }
  const settled = (ok: boolean): void => {
    invalidate(pane)
    if (!ok) {
      make.disabled = true
      if (!file.hidden) stale.hidden = false
    } else state.dirty = false
    refresh(pane)
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
      mutate(pane, () => Api.buildReel(projectId), () => {
        make.disabled = state.dirty || hooks.pending()
      })
    })
  })

  cancel.addEventListener("click", () => {
    cancel.disabled = true
    mutate(pane, () => Api.cancelReel(projectId), () => {
      cancel.disabled = false
    })
  })

  return { node, colour, refresh: () => refresh(pane), pause: () => { player.pause() }, edited, settled }
}
