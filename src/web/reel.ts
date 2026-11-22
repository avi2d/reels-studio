import { Effect } from "effect"
import type { Face } from "../shared/face.ts"
import { jumpsOf, LOUDNESS_TARGET, type ColourView, type Jump, type Levelling, type Passage, type PictureSide, type ReelView, type Sound } from "../shared/reel.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatSize } from "./format.ts"
import { loudnessChart } from "./loudness-chart.ts"
import { lufs, verdictWords } from "./sound-verdict.ts"
import type { StageNote } from "./stages.ts"

const POLL_MS = 1000
const IDLE_MS = 3000

const ABOUT = "Студия соберёт ролик из исходных видео: выбранные дубли в порядке блоков, без убранных пауз, с мягким звуком на каждой склейке. Исходные видео не меняются."
const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и ролик можно будет собрать."
const FAILED = "Ролик не собрался. Подробности в журнале студии. Нажмите «Собрать ролик», чтобы попробовать ещё раз."
const NOT_SAVED = "Монтаж ещё не сохранился. Проверьте Wi-Fi: студия сохраняет его сама."
const STALE = "Монтаж изменился после сборки. Соберите ролик заново, чтобы файл совпал с монтажом."
const FACE_STALE = "На вкладке «Внешность» выбрано другое лицо, чем в файле. Соберите ролик заново, чтобы файл совпал с выбором."

export const staleText = (view: ReelView, dirty: boolean): string =>
  !dirty && view.file !== undefined && view.file.face !== view.face ? FACE_STALE : STALE
const UNLEVELLED = "Этот ролик собран до выравнивания громкости. Соберите его заново, чтобы выровнять звук."
const PASSAGE_LABEL = { quiet: "Тихий отрывок", loud: "Громкий отрывок" } as const
const VERSION_LABEL = { before: "До", after: "После" } as const

const decimal = (value: number): string => value.toFixed(1).replace("-", "−").replace(".", ",")

const CHART_LABEL = "График громкости по времени: до и после выравнивания"
const CHART_KEY = "Серая линия — до выравнивания, оранжевая — после. Пунктир — цель. Красные полосы — скачки громкости."

const verdictNotes = (sound: Sound, jumps: ReadonlyArray<Jump>): ReadonlyArray<HTMLElement> => {
  const words = verdictWords(sound, jumps)
  return [h("p", {}, h("strong", {}, words.label)), ...words.notes.map((note) => h("p", { class: "muted" }, note))]
}

const beforeLine = (before: number): string => `До выравнивания: громкость ${decimal(before)}\u00a0LUFS.`

const measuredLine = (sound: Sound): string =>
  `Измерено: громкость ${decimal(sound.lufs)}\u00a0LUFS при цели ${decimal(LOUDNESS_TARGET)}, диапазон ${decimal(sound.lra)}\u00a0LU, пик ${decimal(sound.truePeak)}\u00a0dBTP.`

const SAVE_HINT = "На айфоне откройте скачанный файл и выберите «Сохранить видео»: ролик появится в «Фото», и Instagram его найдёт."

const MATCHED = "Студия измерила цвет кожи в каждом видео ролика и подогнала остальные видео к первому видео с лицом. На каждой картинке слева последний кадр одного видео, справа первый кадр следующего."
const NO_FACE = "Студия не нашла лицо хотя бы в одном видео, и цвет этого видео остался как есть."

export const faceSetting = (face: Face): string => face === "light"
  ? "Лицо в ролике: выровнять кожу и белки глаз. Выключить можно на вкладке «Внешность»."
  : "Лицо в ролике: не трогать. Выровнять кожу и белки глаз можно на вкладке «Внешность»."

export const faceFact = (face: Face): string => face === "light" ? "лицо слегка выровнено" : "лицо не тронуто"

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
  src: string | undefined
  stopAt: number | undefined
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
  readonly loudness: HTMLParagraphElement
  readonly verdict: HTMLDivElement
  readonly chart: HTMLDivElement
  readonly measured: HTMLParagraphElement
  readonly numbers: HTMLDetailsElement
  readonly passages: HTMLDivElement
  readonly unlevelled: HTMLParagraphElement
  readonly stale: HTMLParagraphElement
  readonly face: HTMLParagraphElement
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

const playPassage = (pane: Pane, passage: Passage, version: keyof typeof VERSION_LABEL): void => {
  const { state, ui } = pane
  const src = Api.reelUrl(pane.projectId, state.made ?? "", version)
  const start = (): void => {
    ui.player.currentTime = passage.from
    void ui.player.play().catch(() => undefined)
  }
  state.stopAt = passage.to
  if (state.src === src) {
    start()
    return
  }
  state.src = src
  ui.player.src = src
  ui.player.addEventListener("loadedmetadata", start, { once: true })
}

const playAfter = (pane: Pane, made: string): void => {
  const src = Api.reelUrl(pane.projectId, made, "after")
  if (pane.state.src === src) return
  pane.state.src = src
  pane.ui.player.src = src
}

const passageRow = (pane: Pane, passage: Passage): HTMLElement => {
  const versions = (["before", "after"] as const).map((version) => {
    const play = button("quiet", {}, VERSION_LABEL[version])
    play.addEventListener("click", () => playPassage(pane, passage, version))
    return play
  })
  return h("div", { class: "passage" },
    h("span", {}, PASSAGE_LABEL[passage.name]),
    h("span", { class: "muted" }, `${lufs(passage.before)} → ${lufs(passage.after)}`),
    h("span", { class: "versions passage-plays" }, ...versions))
}

const showLevelling = (pane: Pane, levelling: Levelling | undefined, seconds: number): void => {
  const { ui } = pane
  ui.unlevelled.hidden = levelling !== undefined
  ui.chart.hidden = levelling === undefined
  ui.verdict.hidden = levelling === undefined
  ui.numbers.hidden = levelling === undefined
  ui.passages.hidden = levelling === undefined || levelling.passages.length === 0
  if (levelling === undefined) return
  ui.passages.replaceChildren(...levelling.passages.map((passage) => passageRow(pane, passage)))
  const jumps = jumpsOf(levelling.series.after, seconds)
  ui.chart.replaceChildren(loudnessChart(levelling.series, jumps, seconds, CHART_LABEL), h("p", { class: "muted" }, CHART_KEY))
  ui.verdict.replaceChildren(...verdictNotes(levelling.after, jumps))
  ui.measured.textContent = measuredLine(levelling.after)
  ui.loudness.textContent = beforeLine(levelling.before)
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
  ui.face.textContent = faceSetting(view.face)
  ui.status.textContent = statusOf(view)
  ui.bar.hidden = view.job.state !== "running"
  ui.bar.value = view.job.state === "running" ? view.job.done : 0
  if (view.job.state === "failed") ui.problem.textContent = FAILED
  else if (state.busy) ui.problem.textContent = ""
  ui.file.hidden = view.file === undefined
  if (view.file !== undefined) {
    if (state.made !== view.file.made) {
      state.made = view.file.made
      playAfter(pane, view.file.made)
      ui.save.setAttribute("href", Api.reelDownloadUrl(pane.projectId, view.file.made))
      showLevelling(pane, view.file.levelling, view.file.seconds)
    }
    ui.facts.textContent = `Длина ${formatLength(view.file.seconds)} · ${formatSize(view.file.size)} · собран ${madeAt(view.file.made)} · ${faceFact(view.file.face)}`
    ui.stale.hidden = state.busy || (view.file.fresh && !state.dirty)
    ui.stale.textContent = staleText(view, state.dirty)
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
  readonly build: () => void
} => {
  const state: ReelState = { timer: 0, made: undefined, src: undefined, stopAt: undefined, dirty: false, busy: false, counter: 0, floor: 0, applied: 0 }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata" })
  const facts = h("p", { class: "muted" })
  const loudness = h("p", { class: "muted" })
  const verdict = h("div", { class: "verdict" })
  const chart = h("div", { class: "loudness-chart" })
  const measured = h("p", { class: "muted" })
  const numbers = h("details", { class: "numbers" }, h("summary", {}, "Цифры"), measured, loudness)
  const passages = h("div", { class: "passages", hidden: true })
  const unlevelled = h("p", { class: "muted", hidden: true }, UNLEVELLED)
  const stale = h("p", { class: "stale", hidden: true }, STALE)
  const face = h("p", { class: "face-setting" })
  const save = button("normal", { download: "" }, "Скачать")
  const file = h("div", { class: "built", hidden: true }, player, h("div", { class: "built-facts" }, facts, unlevelled, chart, verdict, passages, numbers, save, h("p", { class: "muted" }, SAVE_HINT)))
  const make = button("primary", {}, "Собрать ролик")
  const cancel = button("quiet", { hidden: true }, "Остановить сборку")
  const colour = h("section", { class: "card colour-card", hidden: true })
  const node = h("div", { class: "pane" }, h("section", { class: "card reel-card" }, h("h2", {}, "Готовый ролик"), h("p", { class: "muted" }, ABOUT), face, h("div", { class: "row" }, make, cancel), status, bar, stale, problem), file)
  const pane: Pane = { projectId, hooks, state, ui: { status, bar, problem, player, facts, loudness, verdict, chart, measured, numbers, passages, unlevelled, stale, face, save, file, make, cancel, colour, node } }
  player.addEventListener("play", hooks.playing)
  player.addEventListener("timeupdate", () => {
    if (state.stopAt !== undefined && player.currentTime >= state.stopAt) {
      player.pause()
      state.stopAt = undefined
      if (state.made !== undefined) playAfter(pane, state.made)
    }
  })

  const edited = (): void => {
    invalidate(pane)
    state.dirty = true
    make.disabled = true
    hooks.note({ note: "", done: false })
    stale.textContent = STALE
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

  const build = (): void => { if (!make.disabled) make.click() }

  return { node, colour, refresh: () => refresh(pane), pause: () => { player.pause() }, edited, settled, build }
}
