import { Effect } from "effect"
import { type LibraryVideo, type Offer, pickOf } from "../shared/library.ts"
import * as Api from "./api.ts"
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { button, setExpanded } from "./controls.ts"
import { h } from "./dom.ts"
import { onLibrarySettled } from "./uploaded.ts"
import { addLabel, formatLength, formatSize, fromProjects, listeningNote } from "./format.ts"

const POLL_MS = 4000

type Entry = { readonly video: LibraryVideo; readonly node: HTMLElement }
type Chosen = Map<HTMLInputElement, Entry>
type Row = { readonly box: HTMLInputElement; readonly video: LibraryVideo; readonly node: HTMLElement }

const detailsOf = (video: LibraryVideo): string => {
  const facts = `${formatLength(video.duration)} · ${formatSize(video.size)}`
  return video.from === "library" ? facts : `${facts} · ${fromProjects(video.titles)}`
}

const choice = (video: LibraryVideo, onChange: () => void): { readonly node: HTMLElement; readonly box: HTMLInputElement } => {
  const box = h("input", { type: "checkbox", change: onChange })
  const node = h("li", {}, h("label", { class: "choice" }, box, h("span", {}, h("span", { class: "name" }, video.name), h("span", { class: "muted" }, detailsOf(video)))))
  return { node, box }
}

const rowKey = (video: LibraryVideo): string => JSON.stringify(pickOf(video))

const keepRow = (kept: Row | undefined, video: LibraryVideo, onChange: () => void): Row => {
  if (kept !== undefined && JSON.stringify(kept.video) === JSON.stringify(video)) return kept
  const fresh = choice(video, onChange)
  if (kept !== undefined) {
    kept.node.remove()
    fresh.box.checked = kept.box.checked
  }
  return { video, ...fresh }
}

const orderRows = (list: HTMLElement, made: ReadonlyArray<Row>): void => {
  let position = 0
  for (const { node } of made) {
    const current = list.children[position]
    if (current !== node) list.insertBefore(node, current ?? null)
    position += 1
  }
}

const syncRows = (list: HTMLElement, chosen: Chosen, videos: ReadonlyArray<LibraryVideo>, onChange: () => void): Chosen => {
  const previous = new Map<string, Row>()
  for (const [box, entry] of chosen) previous.set(rowKey(entry.video), { box, video: entry.video, node: entry.node })
  const made: Array<Row> = []
  for (const video of videos) {
    const key = rowKey(video)
    const kept = previous.get(key)
    previous.delete(key)
    made.push(keepRow(kept, video, onChange))
  }
  for (const entry of previous.values()) entry.node.remove()
  orderRows(list, made)
  return new Map(made.map(({ box, video, node }): [HTMLInputElement, Entry] => [box, { video, node }]))
}

interface AddRequest {
  readonly projectId: string
  readonly onAdded: () => Effect.Effect<void, Api.Failed>
  readonly state: { readonly chosen: Chosen; adding: boolean }
  readonly add: WaButton
  readonly problem: HTMLElement
  readonly recount: () => void
  readonly show: (shown: boolean) => void
  readonly reload: () => void
}

const submitAdd = ({ projectId, onAdded, state, add, problem, recount, show, reload }: AddRequest): void => {
  const picks = [...state.chosen].filter(([box]) => box.checked).map(([, entry]) => pickOf(entry.video))
  state.adding = true
  add.disabled = true
  add.textContent = "Добавляем…"
  problem.textContent = ""
  Effect.runFork(Api.addVideos(projectId, picks).pipe(
    Effect.andThen(onAdded()),
    Effect.map(() => {
      for (const box of state.chosen.keys()) box.checked = false
      state.adding = false
      recount()
      show(false)
      reload()
    }),
    Effect.catchTag("Failed", (error) =>
      Effect.andThen(
        Effect.catchTag(onAdded(), "Failed", () => Effect.void),
        Effect.sync(() => {
          state.adding = false
          problem.textContent = error.message
          reload()
          recount()
        })
      ))
  ))
}

export interface Picker {
  readonly open: WaButton
  readonly panel: HTMLElement
  readonly hint: HTMLElement
  readonly loadError: HTMLElement
  readonly reload: () => void
}

export const libraryPicker = (projectId: string, onAdded: () => Effect.Effect<void, Api.Failed>): Picker => {
  const open = button("primary", { hidden: true }, "Выбрать видео")
  setExpanded(open, false)
  const hint = h("p", { class: "muted hint", hidden: true }, "Загрузите видео на странице ", h("a", { href: "#/videos" }, "«Загруженные видео»"), ", и его можно будет добавить в ролик.")
  const list = h("ul", { class: "choices" })
  const listening = h("p", { class: "muted", role: "status" })
  const add = button("primary", { disabled: true }, addLabel(0))
  const cancel = button("quiet", {}, "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const loadError = h("p", { class: "error", role: "alert" })
  const panel = h("fieldset", { class: "picker", hidden: true },
    h("legend", {}, "Загруженные видео"),
    h("p", { class: "muted" }, "Студия уже прослушала эти видео. Отмеченные появятся в ролике сразу, вместе с текстом."),
    list, listening, h("div", { class: "row" }, add, cancel), problem)
  const state = { chosen: new Map<HTMLInputElement, Entry>(), shown: false, timer: 0, adding: false }
  const recount = (): void => {
    if (state.adding) {
      add.textContent = "Добавляем…"
      add.disabled = true
      return
    }
    const count = [...state.chosen.keys()].filter((box) => box.checked).length
    add.textContent = addLabel(count)
    add.disabled = count === 0
  }
  const show = (shown: boolean): void => {
    state.shown = shown
    panel.hidden = !shown
    setExpanded(open, shown)
    problem.textContent = ""
  }
  const fill = ({ videos, listening: waiting }: Offer): void => {
    state.chosen = syncRows(list, state.chosen, videos, recount)
    list.hidden = videos.length === 0
    listening.textContent = listeningNote(waiting)
    if (loadError.textContent !== "") loadError.textContent = ""
    const offered = videos.length > 0 || waiting > 0
    open.hidden = !offered
    hint.hidden = offered
    if (!offered) show(false)
    recount()
  }
  const reload = (): void => {
    globalThis.clearTimeout(state.timer)
    Effect.runFork(Api.getLibrary(projectId).pipe(
      Effect.map((offer) => {
        fill(offer)
        globalThis.clearTimeout(state.timer)
        if (offer.listening > 0 && open.isConnected) state.timer = Number(globalThis.setTimeout(reload, POLL_MS))
      }),
      Effect.catchTag("Failed", (error) => Effect.sync(() => {
        if (loadError.textContent !== error.message) loadError.textContent = error.message
        globalThis.clearTimeout(state.timer)
        if (open.isConnected) state.timer = Number(globalThis.setTimeout(reload, POLL_MS))
      }))
    ))
  }
  let stop: (() => void) | undefined
  stop = onLibrarySettled(() => {
    if (open.isConnected) reload()
    else stop?.()
  })
  open.addEventListener("click", () => { show(!state.shown) })
  cancel.addEventListener("click", () => { show(false) })
  add.addEventListener("click", () => {
    submitAdd({ projectId, onAdded, state, add, problem, recount, show, reload })
  })
  return { open, panel, hint, loadError, reload }
}
