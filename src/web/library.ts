import { Effect } from "effect"
import type { LibraryVideo } from "../shared/library.ts"
import * as Api from "./api.ts"
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { button, setExpanded } from "./controls.ts"
import { h } from "./dom.ts"
import { addLabel, formatLength, formatSize, fromProjects } from "./format.ts"

const choice = (video: LibraryVideo, onChange: () => void): { readonly node: HTMLElement; readonly box: HTMLInputElement } => {
  const box = h("input", { type: "checkbox", change: onChange })
  const details = `${formatLength(video.duration)} · ${formatSize(video.size)} · ${fromProjects(video.titles)}`
  const node = h("li", {}, h("label", { class: "choice" }, box, h("span", {}, h("span", { class: "name" }, video.name), h("span", { class: "muted" }, details))))
  return { node, box }
}

export const libraryPicker = (
  projectId: string,
  onAdded: () => Effect.Effect<void, Api.Failed>
): { readonly open: WaButton; readonly panel: HTMLElement; readonly reload: () => void } => {
  const open = button("quiet", { hidden: true, "aria-expanded": "false" }, "Взять из других роликов")
  setExpanded(open, false)
  const list = h("ul", { class: "choices" })
  const add = button("normal", { disabled: true }, addLabel(0))
  const cancel = button("quiet", {}, "Отмена")
  const problem = h("p", { class: "error", role: "alert" })
  const panel = h("fieldset", { class: "picker", hidden: true },
    h("legend", {}, "Видео из других роликов"),
    h("p", { class: "muted" }, "Студия уже прослушала эти видео. Они появятся в этом ролике сразу, вместе с текстом, без новой загрузки."),
    list, h("div", { class: "row" }, add, cancel), problem)
  const state = { chosen: new Map<HTMLInputElement, LibraryVideo>(), shown: false }
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
  const fill = (videos: ReadonlyArray<LibraryVideo>): void => {
    const made = videos.map((video) => ({ video, ...choice(video, recount) }))
    state.chosen = new Map(made.map(({ box, video }) => [box, video]))
    list.replaceChildren(...made.map(({ node }) => node))
    open.hidden = videos.length === 0
    if (videos.length === 0 && problem.textContent === "") show(false)
    recount()
  }
  const reload = (): void => {
    Effect.runFork(Api.getLibrary(projectId).pipe(
      Effect.map(({ videos }) => { fill(videos) }),
      Effect.catchTag("Failed", () => Effect.void)
    ))
  }
  open.addEventListener("click", () => { show(!state.shown) })
  cancel.addEventListener("click", () => { show(false) })
  add.addEventListener("click", () => {
    const picks = [...state.chosen].filter(([box]) => box.checked).map(([, video]) => ({ project: video.project, name: video.name }))
    add.disabled = true
    add.textContent = "Добавляем…"
    problem.textContent = ""
    Effect.runFork(Api.addVideos(projectId, picks).pipe(
      Effect.andThen(onAdded()),
      Effect.map(() => {
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
  return { open, panel, reload }
}
