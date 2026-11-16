import { Effect } from "effect"
import { lengthOf, type Transcript } from "../shared/plan.ts"
import {
  arrange, assemble, chosenTake, clipsOf, MIN_PAUSE, NO_EDITS, playedSpans, withChoice, withDeleted, withPauses,
  type Edits, type Placed, type TimelineView
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

const notesOf = (view: TimelineView, ask: (text: string) => void): ReadonlyArray<HTMLElement> => {
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
  play: h("button", { type: "button" }, PLAY),
  strip: h("button", { type: "button", class: "secondary" }),
  rowHolder: h("div", {}),
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

const drawReady = (parts: Parts, drawn: Drawn, actions: Actions): void => {
  const { edits, loaded, selected, timeline } = drawn
  const placed = assemble(timeline.blocks, edits, loaded.transcripts)
  const { deleted } = arrange(timeline.blocks, edits)
  const pauses = placed.flatMap((one) => one.pauses.map((pause) => ({ video: one.take.video, after: pause.after, removed: pause.removed })))
  const allRemoved = pauses.every((pause) => pause.removed)
  parts.summary.textContent = summaryOf(placed)
  parts.play.disabled = placed.length === 0
  parts.strip.hidden = pauses.length === 0
  parts.strip.textContent = allRemoved ? "Вернуть все паузы" : "Убрать все паузы"
  parts.strip.onclick = () => { actions.change(withPauses(edits, pauses, !allRemoved)) }
  const scroll = parts.rowHolder.firstElementChild?.scrollLeft ?? 0
  const row = blockRow(placed, selected, actions)
  parts.rowHolder.replaceChildren(row)
  row.scrollLeft = scroll
  const index = placed.findIndex((one) => one.block.id === selected)
  const open = placed[index]
  parts.detailHolder.replaceChildren(
    ...(open === undefined ? [] : [blockDetail(open.block, index + 1, chosenTake(open.block, edits), loaded.transcripts, edits, actions)]),
    ...(deleted.length === 0 ? [] : [deletedList(deleted, actions)]))
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

export const timelineCard = (projectId: string, ask: (text: string) => void): { readonly node: HTMLElement; readonly refresh: () => void } => {
  const parts = partsOf()
  const clock = h("span", { class: "muted clock" })
  const notes = h("div", { class: "notes" })
  const problem = h("p", { class: "error", role: "alert" })
  const shown: { block: string | undefined } = { block: undefined }
  const player = montage(projectId, (playing) => { markPlaying(parts, clock, shown, playing) })
  const ready = h("div", { class: "timeline", hidden: true },
    parts.summary, h("div", { class: "row" }, parts.play, parts.strip, clock), parts.rowHolder, player.node, parts.detailHolder, problem)
  const node = h("section", { class: "card", hidden: true }, h("h2", {}, "Монтаж"), notes, ready)
  const state: { loaded: Loaded | undefined; edits: Edits; selected: string | undefined; seen: string; timer: number } =
    { loaded: undefined, edits: NO_EDITS, selected: undefined, seen: "", timer: 0 }
  const saving = saver(projectId, problem, () => state.edits)

  const placedNow = (): ReadonlyArray<Placed> => {
    const view = state.loaded?.view.timeline
    return state.loaded === undefined || view?.state !== "ready" ? [] : assemble(view.blocks, state.edits, state.loaded.transcripts)
  }

  const draw = (): void => {
    const loaded = state.loaded
    if (loaded === undefined) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined
    const { timeline } = loaded.view
    node.hidden = loaded.transcripts.size === 0
    ready.hidden = timeline.state !== "ready"
    notes.replaceChildren(...notesOf(loaded.view, ask))
    if (timeline.state === "ready") drawReady(parts, { loaded, timeline, edits: state.edits, selected: state.selected }, actions)
    refocus(node, active)
  }

  const change = (edits: Edits): void => {
    player.stop()
    state.edits = edits
    draw()
    saving.save()
  }

  const actions: Actions = {
    change,
    select: (block) => {
      state.selected = state.selected === block ? undefined : block
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
    setDeleted: (block, deleted) => {
      if (deleted && state.selected === block) state.selected = undefined
      change(withDeleted(state.edits, block, deleted))
    }
  }

  parts.play.addEventListener("click", () => {
    if (parts.play.textContent === STOP) player.stop()
    else player.play(clipsOf(placedNow()))
  })

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
    if (!node.isConnected) return
    Effect.runFork(Effect.all([Api.getVideos(projectId), Api.getTimeline(projectId)], { concurrency: 2 }).pipe(
      Effect.map(([{ videos }, view]) => {
        const heard = videos.flatMap((video) => video.state === "ready" ? [[video.name, video.transcript] as const] : [])
        show({ transcripts: new Map(heard), view })
        if (videos.some((video) => video.state === "waiting") || view.looks.some((look) => look.state === "waiting")) later()
      }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }

  return { node, refresh }
}
