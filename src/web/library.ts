import { Effect } from "effect"
import { type LibraryVideo, type Offer, pickOf } from "../shared/library.ts"
import * as Api from "./api.ts"
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { button, setExpanded } from "./controls.ts"
import { h } from "./dom.ts"
import { onLibrarySettled } from "./uploaded.ts"
import { addLabel, formatLength, formatSize, fromProjects, listeningNote } from "./format.ts"

const POLL_MS = 4000

const detailsOf = (video: LibraryVideo): string => {
  const facts = `${formatLength(video.duration)} · ${formatSize(video.size)}`
  return video.from === "library" ? facts : `${facts} · ${fromProjects(video.titles)}`
}

const choice = (video: LibraryVideo, onChange: () => void): { readonly node: HTMLElement; readonly box: HTMLInputElement } => {
  const box = h("input", { type: "checkbox", change: onChange })
  const node = h("li", {}, h("label", { class: "choice" }, box, h("span", {}, h("span", { class: "name" }, video.name), h("span", { class: "muted" }, detailsOf(video)))))
  return { node, box }
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
  const hint = h("p", { class: "muted hint", hidden: true }, "Загрузите видео на ", h("a", { href: "#/" }, "главной странице"), ", и его можно будет добавить в ролик.")
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
  const state = { chosen: new Map<HTMLInputElement, { video: LibraryVideo; node: HTMLElement }>(), shown: false, timer: 0 }
  const recount = (): void => {
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
    const previous = new Map<string, { box: HTMLInputElement; video: LibraryVideo; node: HTMLElement }>()
    for (const [box, entry] of state.chosen) previous.set(JSON.stringify(pickOf(entry.video)), { box, video: entry.video, node: entry.node })
    const made: Array<{ box: HTMLInputElement; video: LibraryVideo; node: HTMLElement }> = []
    for (const video of videos) {
      const kept = previous.get(JSON.stringify(pickOf(video)))
      previous.delete(JSON.stringify(pickOf(video)))
      if (kept !== undefined && JSON.stringify(kept.video) === JSON.stringify(video)) made.push(kept)
      else {
        if (kept !== undefined) kept.node.remove()
        made.push({ video, ...choice(video, recount) })
      }
    }
    for (const entry of previous.values()) entry.node.remove()
    let position = 0
    for (const { node } of made) {
      const current = list.children[position]
      if (current !== node) list.insertBefore(node, current ?? null)
      position += 1
    }
    while (list.children.length > made.length) list.lastChild?.remove()
    state.chosen = new Map(made.map(({ box, video, node }): [HTMLInputElement, { video: LibraryVideo; node: HTMLElement }] => [box, { video, node }]))
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
    const picks = [...state.chosen].filter(([box]) => box.checked).map(([, entry]) => pickOf(entry.video))
    add.disabled = true
    add.textContent = "Добавляем…"
    problem.textContent = ""
    Effect.runFork(Api.addVideos(projectId, picks).pipe(
      Effect.andThen(onAdded()),
      Effect.map(() => {
        for (const box of state.chosen.keys()) box.checked = false
        show(false)
        reload()
      }),
      Effect.catchTag("Failed", (error) =>
        Effect.andThen(
          Effect.catchTag(onAdded(), "Failed", () => Effect.void),
          Effect.sync(() => {
            problem.textContent = error.message
            reload()
            recount()
          })
        ))
    ))
  })
  return { open, panel, hint, loadError, reload }
}
