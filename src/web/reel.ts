import { Effect } from "effect"
import { judgeSound, LOUDNESS_TARGET, type Passage, type ReelView, type Sound } from "../shared/reel.ts"
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
const PASSAGE_LABEL = { quiet: "Тихий отрывок", loud: "Громкий отрывок" } as const
const VERSION_LABEL = { before: "До", after: "После" } as const

const lufs = (value: number): string => `${String(Math.round(value)).replace("-", "−")}\u00a0LUFS`

const decimal = (value: number): string => value.toFixed(1).replace("-", "−").replace(".", ",")

const SOUND_LABEL = { good: "Звук хороший", check: "Звук можно публиковать, но есть замечания", bad: "Звук плохой" } as const
const ISSUE_NOTE = {
  "off-target": "Громкость далеко от цели.",
  uneven: "Громкость меняется: тихие и громкие места звучат по-разному.",
  "over-peak": "Пики выше −1,5 dBTP.",
  clipping: "Срывы: пики выше 0 dBTP, звук будет обрезаться."
} as const

const soundNotes = (sound: Sound): ReadonlyArray<HTMLElement> => {
  const verdict = judgeSound(sound)
  return [
    h("p", {}, h("strong", {}, SOUND_LABEL[verdict.level])),
    h("p", { class: "muted" }, `Громкость ${decimal(sound.lufs)}\u00a0LUFS при цели ${decimal(LOUDNESS_TARGET)}. Диапазон ${decimal(sound.lra)}\u00a0LU, пик ${decimal(sound.truePeak)}\u00a0dBTP.`),
    ...verdict.issues.map((issue) => h("p", { class: "muted" }, ISSUE_NOTE[issue])),
    ...(verdict.issues.includes("clipping") ? [] : [h("p", { class: "muted" }, "Срывов нет.")])
  ]
}

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
  readonly passages: HTMLDivElement
  readonly stale: HTMLParagraphElement
  readonly save: ReturnType<typeof button>
  readonly file: HTMLDivElement
  readonly make: ReturnType<typeof button>
  readonly cancel: ReturnType<typeof button>
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

const passageRow = (pane: Pane, passage: Passage): HTMLElement => {
  const versions = (["before", "after"] as const).map((version) => {
    const play = button("quiet", {}, VERSION_LABEL[version])
    play.addEventListener("click", () => playPassage(pane, passage, version))
    return play
  })
  return h("div", { class: "passage" },
    h("span", {}, PASSAGE_LABEL[passage.name]),
    h("span", { class: "muted" }, `${lufs(passage.before)} → ${lufs(passage.after)}`),
    ...versions)
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
      state.src = Api.reelUrl(pane.projectId, view.file.made, "after")
      ui.player.src = state.src
      ui.save.setAttribute("href", Api.reelDownloadUrl(pane.projectId, view.file.made))
      ui.passages.replaceChildren(...view.file.passages.map((passage) => passageRow(pane, passage)))
      ui.passages.hidden = view.file.passages.length === 0
    }
    ui.facts.textContent = `Длина ${formatLength(view.file.seconds)} · ${formatSize(view.file.size)} · собран ${madeAt(view.file.made)}`
    ui.loudness.textContent = `Громкость ролика: до ${lufs(view.file.loudness.before)}, после ${lufs(view.file.loudness.after)}, цель ${lufs(LOUDNESS_TARGET)}`
    ui.verdict.replaceChildren(...soundNotes(view.file.sound))
    ui.stale.hidden = state.busy || (view.file.fresh && !state.dirty)
  }
  hooks.note({ note: "", done: view.file?.fresh === true && !state.dirty })
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
  readonly refresh: () => void
  readonly pause: () => void
  readonly edited: () => void
  readonly settled: (ok: boolean) => void
} => {
  const state: ReelState = { timer: 0, made: undefined, src: undefined, stopAt: undefined, dirty: false, busy: false, counter: 0, floor: 0, applied: 0 }
  const status = h("p", { class: "muted", role: "status" })
  const bar = h("progress", { max: "1", value: "0", hidden: true })
  const problem = h("p", { class: "error", role: "alert" })
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata" })
  const facts = h("p", { class: "muted" })
  const loudness = h("p", { class: "muted" })
  const verdict = h("div", { class: "verdict" })
  const passages = h("div", { class: "passages", hidden: true })
  const stale = h("p", { class: "stale", hidden: true }, STALE)
  const save = button("normal", { download: "" }, "Скачать")
  const file = h("div", { class: "built", hidden: true }, player, h("div", { class: "built-facts" }, facts, loudness, verdict, passages, save, h("p", { class: "muted" }, SAVE_HINT)))
  const make = button("primary", {}, "Собрать ролик")
  const cancel = button("quiet", { hidden: true }, "Остановить сборку")
  const actions = h("div", { class: "row" }, make, cancel)
  const node = h("div", { class: "pane" }, h("section", { class: "card reel-card" }, h("h2", {}, "Готовый ролик"), h("p", { class: "muted" }, ABOUT), actions, status, bar, stale, problem), file)
  const pane: Pane = { projectId, hooks, state, ui: { status, bar, problem, player, facts, loudness, verdict, passages, stale, save, file, make, cancel, node } }
  player.addEventListener("play", hooks.playing)
  player.addEventListener("timeupdate", () => {
    if (state.stopAt !== undefined && player.currentTime >= state.stopAt) {
      player.pause()
      state.stopAt = undefined
    }
  })

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

  return { node, refresh: () => refresh(pane), pause: () => { player.pause() }, edited, settled }
}
