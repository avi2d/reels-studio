import { Effect } from "effect"
import type { UploadedVideo } from "../shared/library.ts"
import * as Api from "./api.ts"
import { button } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatSize } from "./format.ts"
import { oneAfterAnother } from "./queue.ts"
import { libraryShelf, upload, type Progress } from "./upload.ts"

const POLL_MS = 4000

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)
const rows: Array<HTMLElement> = []
const mounted: { reload: () => Effect.Effect<void, Api.Failed> } = { reload: () => Effect.void }

const uploadKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`

const forget = (gone: (row: HTMLElement) => boolean): void => {
  for (const row of rows.filter(gone)) {
    row.remove()
    rows.splice(rows.indexOf(row), 1)
  }
}

const uploadRow = (file: File) => {
  const bar = h("progress", { max: "1", value: "0" })
  const status = h("p", { class: "muted", role: "status" }, "Ждёт своей очереди.")
  const node = h("li", { class: "upload" },
    h("div", { class: "name" }, h("span", {}, file.name), h("span", {}, formatSize(file.size))), bar, status)
  node.dataset.key = uploadKey(file)
  const onProgress = (progress: Progress): void => {
    if (progress.waiting) {
      status.textContent = "Связь пропала. Загрузка продолжится сама, когда связь вернётся."
      return
    }
    bar.value = progress.sent / progress.total
    const percent = Math.floor((progress.sent / progress.total) * 100)
    status.textContent = `Загружено ${formatSize(progress.sent)} из ${formatSize(progress.total)}, ${percent}%`
  }
  const failUpload = (message: string): void => {
    node.dataset.failed = "true"
    status.className = "error"
    bar.hidden = file.size === 0
    status.textContent = file.size === 0
      ? message
      : `${message} Выберите тот же файл ещё раз, и загрузка продолжится с того же места.`
  }
  const work = upload(libraryShelf, file, onProgress).pipe(
    Effect.flatMap(() => mounted.reload().pipe(
      Effect.map(() => { forget((row) => row === node || row.dataset.uploaded === "true") }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        node.dataset.uploaded = "true"
        status.textContent = "Видео загружено. Список обновится при следующей загрузке."
      }))
    )),
    Effect.catch((error) => Effect.sync(() => {
      failUpload(error.message)
    })),
    Effect.catchDefect(() => Effect.sync(() => {
      failUpload("Не получилось загрузить.")
    }))
  )
  return { node, work }
}

type Retry = (name: string, onFailure: (message: string) => void) => void

const stateOf = (video: UploadedVideo, retry: Retry): ReadonlyArray<HTMLElement> => {
  if (video.state === "ready") return [h("p", { class: "muted" }, `Длина ${formatLength(video.duration)}. Видео можно добавить в ролик.`)]
  if (video.state === "waiting") return [h("p", { class: "muted", role: "status" }, "Студия слушает видео. Это займёт несколько минут.")]
  const trouble = h("p", { class: "error", role: "alert" })
  const again = button("normal", {
    class: "end",
    click: () => {
      again.disabled = true
      trouble.textContent = ""
      retry(video.name, (message) => {
        again.disabled = false
        trouble.textContent = message
      })
    }
  }, "Попробовать ещё раз")
  return [h("p", { class: "error" }, "Студия не расслышала это видео."), again, trouble]
}

const uploadedItem = (video: UploadedVideo, retry: Retry): HTMLElement =>
  h("li", { class: "upload" },
    h("div", { class: "name" }, h("span", {}, video.name), h("span", {}, formatSize(video.size))),
    ...stateOf(video, retry))

export interface UploadedPanel {
  readonly opener: HTMLElement
  readonly node: HTMLElement
}

export const uploadedPanel = (): UploadedPanel => {
  const input = h("input", { class: "visually-hidden", name: "videos", type: "file", accept: "video/*", multiple: true, tabindex: "-1", "aria-hidden": "true" })
  const open = button("normal", { click: () => { input.click() } }, "Загрузить видео")
  const uploads = h("ul", { class: "uploads" }, ...rows)
  const known = h("ul", { class: "uploads", "aria-labelledby": "uploaded-title" })
  const node = h("section", { class: "uploaded", "aria-labelledby": "uploaded-title", hidden: rows.length === 0 },
    h("h2", { id: "uploaded-title" }, "Загруженные видео"), uploads, known,
    h("p", { class: "muted" }, "Видео загружаются по очереди. Не закрывайте страницу, пока идёт загрузка. Чтобы взять видео в ролик, откройте ролик и нажмите «Выбрать видео». Исходные видео студия не меняет."))
  const state = { timer: 0 }
  const show = (videos: ReadonlyArray<UploadedVideo>): void => {
    known.replaceChildren(...videos.map((video) => uploadedItem(video, retry)))
    node.hidden = videos.length === 0 && rows.length === 0
    if (videos.some((video) => video.state === "waiting")) state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }
  const reload = (): Effect.Effect<void, Api.Failed> => Effect.suspend(() => {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return Effect.void
    return Effect.map(Api.getUploaded, ({ videos }) => { show(videos) })
  })
  function refresh(): void {
    Effect.runFork(reload().pipe(Effect.catchTag("Failed", () => Effect.sync(() => {
      state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
    }))))
  }
  const retry: Retry = (name, onFailure) => {
    Effect.runFork(Api.retryUploaded(name).pipe(
      Effect.andThen(reload()),
      Effect.catchTag("Failed", (error) => Effect.sync(() => { onFailure(error.message) }))
    ))
  }
  mounted.reload = reload
  const add = (chosen: ReadonlyArray<File>): void => {
    const made: Array<{ node: HTMLElement; work: Effect.Effect<void> }> = []
    for (const file of chosen) {
      const key = uploadKey(file)
      if (rows.some((row) => row.dataset.key === key && row.dataset.failed !== "true")) continue
      forget((row) => row.dataset.key === key)
      const row = uploadRow(file)
      rows.push(row.node)
      made.push(row)
    }
    if (made.length === 0) return
    uploads.append(...made.map((row) => row.node))
    node.hidden = false
    enqueue(made.map((row) => row.work))
  }
  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })
  queueMicrotask(refresh)
  return { opener: h("span", { class: "upload-open" }, open, input), node }
}
