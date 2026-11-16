import { Effect } from "effect"
import { lengthOf, type Transcript } from "../shared/plan.ts"
import {
  arrange, assemble, chosenTake, clipsOf, MIN_PAUSE, NO_EDITS, playedSpans, withChoice, withDeleted, withPauses,
  type Edits, type Placed, type Take, type TimelineView
} from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { formatLength, formatPause } from "./format.ts"
import { montage, type Playing } from "./montage.ts"
import { blockDetail, deletedList, type DetailActions } from "./timeline-detail.ts"
import { blockRow, type RowActions } from "./timeline-row.ts"

const POLL_MS = 4000
const PLAY = "Смотреть монтаж"
const STOP = "Остановить"
const GATHER = "Собери блоки из всех видео и расставь дубли от лучшего к худшему."
const NOT_SAVED = "Изменение не сохранилось. Проверьте Wi-Fi: студия попробует сохранить его ещё раз сама."
const NO_SPEECH = "Блоки появятся, когда студия услышит первое видео."
const NO_TAKES = "Здесь появятся дубли блока: от лучшего к худшему, с причиной у каждого."
const NO_BLOCKS = "Блоков пока нет. Студия соберёт их из текста всех видео: дубли с одним смыслом попадут в один блок, лучший дубль встанет первым."

type Ready = Extract<TimelineView["timeline"], { readonly state: "ready" }>

interface Loaded {
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly view: TimelineView
}

const looksNote = (looks: TimelineView["looks"]): ReadonlyArray<HTMLElement> => {
  const named = (state: "waiting" | "failed"): string => looks.filter((look) => look.state === state).map((look) => look.video).join(", ")
  const waiting = named("waiting")
  const failed = named("failed")
  return [
    ...(waiting === "" ? [] : [h("p", { class: "muted", role: "status" },
      `Студия ещё измеряет взгляд в камеру в видео: ${waiting}. Когда закончит, попросите в чате расставить дубли заново.`)]),
    ...(failed === "" ? [] : [h("p", { class: "muted" },
      `Взгляд в камеру не удалось измерить в видео: ${failed}. Дубли из них расставлены только по речи.`)])
  ]
}

const notesOf = ({ transcripts, view }: Loaded, ask: (text: string) => void): ReadonlyArray<HTMLElement> => {
  if (transcripts.size === 0) return [h("p", { class: "muted" }, NO_SPEECH)]
  const gather = (label: string): HTMLElement => h("button", { type: "button", class: "end", click: () => { ask(GATHER) } }, label)
  const { timeline } = view
  if (timeline.state !== "ready") {
    return timeline.state === "none"
      ? [h("p", { class: "muted" }, NO_BLOCKS), gather("Собрать блоки")]
      : [h("p", { class: "error" }, "Блоки не прочитались. Попросите студию собрать их заново."), gather("Собрать блоки заново")]
  }
  const dropped = timeline.dropped === 0 ? [] : [h("p", { class: "muted" },
    `Студия пропустила дубли, которые не нашла в видео: ${timeline.dropped}. Попросите в чате собрать блоки заново.`)]
  return [...dropped, ...looksNote(view.looks)]
}

const summaryOf = (placed: ReadonlyArray<Placed>): string => {
  if (placed.length === 0) return "Все блоки удалены. Верните нужные ниже."
  const pauses = placed.flatMap((one) => one.pauses.filter((pause) => !pause.removed))
  const length = formatLength(lengthOf(placed.flatMap((one) => one.spans)))
  const kept = pauses.length === 0 ? "пауз нет" : `пауз: ${pauses.length} на ${formatLength(lengthOf(pauses))}`
  return `Блоков: ${placed.length} · длина ${length} · ${kept}. Паузой студия считает молчание от ${formatPause(MIN_PAUSE)}.`
}

const refocus = (root: HTMLElement, key: string | undefined): void => {
  if (key === undefined) return
  for (const node of root.querySelectorAll<HTMLElement>("[data-key]")) {
    if (node.dataset.key === key) node.focus({ preventScroll: true })
  }
}

const saver = (projectId: string, problem: HTMLElement, edits: () => Edits): { readonly save: () => void; readonly busy: () => boolean } => {
  const state = { saving: false, unsaved: false }
  const save = (): void => {
    if (state.saving) {
      state.unsaved = true
      return
    }
    state.saving = true
    state.unsaved = false
    Effect.runFork(Api.saveEdits(projectId, edits()).pipe(
      Effect.map(() => { problem.textContent = "" }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        problem.textContent = NOT_SAVED
        state.unsaved = true
      })),
      Effect.map(() => {
        state.saving = false
        if (!state.unsaved || !problem.isConnected) return
        if (problem.textContent === "") save()
        else globalThis.setTimeout(save, POLL_MS)
      })
    ))
  }
  return { save, busy: () => state.saving || state.unsaved }
}

const partsOf = (): Parts => ({
  summary: h("p", { class: "muted" }),
  play: h("button", { type: "button", disabled: true, title: "Пробел запускает и останавливает просмотр" }, PLAY),
  strip: h("button", { type: "button", class: "secondary", hidden: true }),
  rowHolder: h("div", { class: "blocks-holder" }),
  detailHolder: h("div", { class: "details" })
})

interface Parts {
  readonly summary: HTMLElement
  readonly play: HTMLButtonElement
  readonly strip: HTMLButtonElement
  readonly rowHolder: HTMLElement
  readonly detailHolder: HTMLElement
}

interface Drawn {
  readonly loaded: Loaded
  readonly timeline: Ready
  readonly edits: Edits
  readonly selected: string | undefined
}

type Actions = RowActions & DetailActions & { readonly change: (edits: Edits) => void }

const drawReady = (parts: Parts, drawn: Drawn, actions: Actions): Placed | undefined => {
  const { edits, loaded, selected, timeline } = drawn
  const placed = assemble(timeline.blocks, edits, loaded.transcripts)
  const { deleted } = arrange(timeline.blocks, edits)
  const pauses = placed.flatMap((one) => one.pauses.map((pause) => ({ video: one.take.video, after: pause.after, removed: pause.removed })))
  const allRemoved = pauses.every((pause) => pause.removed)
  const index = Math.max(0, placed.findIndex((one) => one.block.id === selected))
  const open = placed[index]
  parts.summary.textContent = summaryOf(placed)
  parts.play.disabled = placed.length === 0
  parts.strip.hidden = pauses.length === 0
  parts.strip.textContent = allRemoved ? "Вернуть все паузы" : "Убрать все паузы"
  parts.strip.onclick = () => { actions.change(withPauses(edits, pauses, !allRemoved)) }
  const old = parts.rowHolder.firstElementChild
  const row = blockRow(placed, open?.block.id, actions)
  parts.rowHolder.replaceChildren(row)
  row.scrollLeft = old?.scrollLeft ?? 0
  row.scrollTop = old?.scrollTop ?? 0
  parts.detailHolder.replaceChildren(
    ...(open === undefined ? [] : [blockDetail(open.block, index + 1, chosenTake(open.block, edits), loaded.transcripts, edits, actions)]),
    ...(deleted.length === 0 ? [] : [deletedList(deleted, actions)]))
  return open
}

const markPlaying = (parts: Parts, clock: HTMLElement, shown: { block: string | undefined }, playing: Playing | undefined): void => {
  parts.play.textContent = playing === undefined ? PLAY : STOP
  clock.textContent = playing === undefined ? "" : formatLength(playing.elapsed)
  if (shown.block === playing?.clip.block) return
  shown.block = playing?.clip.block
  for (const slot of parts.rowHolder.querySelectorAll<HTMLElement>(".slot")) {
    const current = slot.dataset.id === shown.block
    slot.classList.toggle("playing", current)
    if (current) slot.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
}

const TYPING = "input, textarea, select, button, a, video, dialog"

const onSpace = (anchor: HTMLElement, press: () => void): void => {
  const listen = (event: KeyboardEvent): void => {
    if (!anchor.isConnected) {
      document.removeEventListener("keydown", listen)
      return
    }
    if (event.code !== "Space" || (event.target instanceof Element && event.target.closest(TYPING) !== null)) return
    event.preventDefault()
    press()
  }
  document.addEventListener("keydown", listen)
}

interface Panels {
  readonly line: HTMLElement
  readonly player: HTMLElement
  readonly takes: HTMLElement
}

const textOf = (transcripts: ReadonlyMap<string, Transcript>, take: Take): string =>
  (transcripts.get(take.video)?.words ?? []).slice(take.from, take.to + 1).map((word) => word.text).join(" ")

interface Frame {
  readonly clock: HTMLElement
  readonly notes: HTMLElement
  readonly problem: HTMLElement
  readonly hint: HTMLElement
  readonly ready: HTMLElement
  readonly stage: HTMLElement
  readonly panels: Panels
}

const frameOf = (parts: Parts): Frame => {
  const clock = h("span", { class: "muted clock" })
  const notes = h("div", { class: "notes" })
  const problem = h("p", { class: "error", role: "alert" })
  const hint = h("p", { class: "muted" }, NO_TAKES)
  const ready = h("div", { class: "timeline", hidden: true }, parts.rowHolder, problem)
  const stage = h("div", { class: "stage" })
  const panels: Panels = {
    line: h("section", { class: "card p-line" }, h("div", { class: "line-head" }, h("h2", {}, "Монтаж"), parts.summary), notes, ready),
    player: h("section", { class: "card p-player", "aria-label": "Просмотр" }, stage, h("div", { class: "row" }, parts.play, parts.strip, clock)),
    takes: h("section", { class: "card p-takes", "aria-label": "Дубли" }, hint, parts.detailHolder)
  }
  return { clock, notes, problem, hint, ready, stage, panels }
}

const placedOf = (loaded: Loaded | undefined, edits: Edits): ReadonlyArray<Placed> => {
  const view = loaded?.view.timeline
  return loaded === undefined || view?.state !== "ready" ? [] : assemble(view.blocks, edits, loaded.transcripts)
}

export const timelineCard = (projectId: string, ask: (text: string) => void): { readonly panels: Panels; readonly refresh: () => void } => {
  const parts = partsOf()
  const { clock, notes, problem, hint, ready, stage, panels } = frameOf(parts)
  const shown: { block: string | undefined } = { block: undefined }
  const player = montage(projectId, (playing) => { markPlaying(parts, clock, shown, playing) })
  stage.append(player.node)
  const state: { loaded: Loaded | undefined; edits: Edits; selected: string | undefined; seen: string; timer: number } =
    { loaded: undefined, edits: NO_EDITS, selected: undefined, seen: "", timer: 0 }
  const saving = saver(projectId, problem, () => state.edits)
  const placedNow = (): ReadonlyArray<Placed> => placedOf(state.loaded, state.edits)

  const draw = (): void => {
    const loaded = state.loaded
    if (loaded === undefined) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined
    const { timeline } = loaded.view
    const isReady = timeline.state === "ready" && loaded.transcripts.size > 0
    ready.hidden = !isReady
    parts.summary.hidden = !isReady
    notes.replaceChildren(...notesOf(loaded, ask))
    const open = timeline.state === "ready" && isReady
      ? drawReady(parts, { loaded, timeline, edits: state.edits, selected: state.selected }, actions)
      : undefined
    hint.hidden = open !== undefined
    const first = open?.spans[0]
    if (open !== undefined && first !== undefined) player.show({ ...first, video: open.take.video, block: open.block.id })
    refocus(panels.line, active)
    refocus(panels.takes, active)
  }

  const change = (edits: Edits): void => {
    player.stop()
    state.edits = edits
    draw()
    saving.save()
  }

  const actions: Actions = {
    change,
    textOf: (take) => textOf(state.loaded?.transcripts ?? new Map(), take),
    select: (block) => {
      player.stop()
      state.selected = block
      draw()
    },
    reorder: (blocks) => { change({ ...state.edits, order: [...blocks] }) },
    setPause: (video, after, removed) => { change(withPauses(state.edits, [{ video, after }], removed)) },
    choose: (block, take) => { change(withChoice(state.edits, block, take)) },
    hear: (block, take) => {
      const transcript = state.loaded?.transcripts.get(take.video)
      if (transcript === undefined) return
      player.play(playedSpans(transcript, take, state.edits).map((span) => ({ ...span, video: take.video, block })))
    },
    playFrom: (block) => {
      const clips = clipsOf(placedNow())
      const first = clips.findIndex((clip) => clip.block === block)
      if (first !== -1) player.play(clips.slice(first))
    },
    setDeleted: (block, deleted) => { change(withDeleted(state.edits, block, deleted)) }
  }

  const toggle = (): void => {
    if (parts.play.textContent === STOP) player.stop()
    else if (!parts.play.disabled) player.play(clipsOf(placedNow()))
  }
  parts.play.addEventListener("click", toggle)
  onSpace(panels.line, toggle)

  const later = (): void => {
    globalThis.clearTimeout(state.timer)
    state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }

  const show = (loaded: Loaded): void => {
    const seen = JSON.stringify([loaded.view, [...loaded.transcripts.keys()]])
    if (seen === state.seen) return
    state.seen = seen
    state.loaded = loaded
    if (loaded.view.timeline.state === "ready" && !saving.busy()) state.edits = loaded.view.timeline.edits
    player.stop()
    draw()
  }

  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!panels.line.isConnected) return
    Effect.runFork(Effect.all([Api.getVideos(projectId), Api.getTimeline(projectId)], { concurrency: 2 }).pipe(
      Effect.map(([{ videos }, view]) => {
        const heard = videos.flatMap((video) => video.state === "ready" ? [[video.name, video.transcript] as const] : [])
        show({ transcripts: new Map(heard), view })
        if (videos.some((video) => video.state === "waiting") || view.looks.some((look) => look.state === "waiting")) later()
      }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }

  return { panels, refresh }
}
