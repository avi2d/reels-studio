import { Effect } from "effect"
import type { UploadedVideo } from "../shared/library.ts"
import * as Api from "./api.ts"
import { button, focusWhenReady, iconButton, retryPair, tooltip, type Retry } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength, formatSize } from "./format.ts"
import { askToConfirmRemoval } from "./remove.ts"
import { oneAfterAnother } from "./queue.ts"
import { libraryShelf, upload, type Progress } from "./upload.ts"

const POLL_MS = 4000

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)
const rows: Array<HTMLElement> = []
const mounted: { reload: () => Effect.Effect<void, Api.Failed> } = { reload: () => Effect.void }
const settled = new Set<() => void>()
export const onLibrarySettled = (listener: () => void): (() => void) => {
  settled.add(listener)
  return () => {
    settled.delete(listener)
  }
}
const notifySettled = (): void => {
  for (const listener of [...settled]) listener()
}

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
      Effect.map(() => {
        forget((row) => row === node || row.dataset.uploaded === "true")
        notifySettled()
      }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        node.dataset.uploaded = "true"
        status.textContent = "Видео загружено. Список обновится при следующей загрузке."
        notifySettled()
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

const coverOf = (video: UploadedVideo): HTMLElement => {
  if (video.state === "ready") {
    const player = h("video", { playsinline: true, preload: "metadata", "aria-label": video.name, src: `${Api.uploadedPreviewUrl(video.name)}#t=0.5` })
    const cover = h("span", { class: "cover" }, player)
    const play = iconButton("normal", "play", `Посмотреть видео «${video.name}»`, {
      class: "play",
      pill: true,
      click: () => {
        play.remove()
        cover.classList.add("playing")
        player.controls = true
        void player.play()
        player.focus()
      }
    })
    cover.append(play)
    return cover
  }
  return h("span", { class: "cover" }, h("span", { class: "state" }, video.state === "waiting" ? "Студия слушает" : "Не расслышала"))
}

const factsOf = (video: UploadedVideo): string =>
  video.state === "ready" ? `${formatLength(video.duration)} · ${formatSize(video.size)}` : formatSize(video.size)

const troubleOf = (video: UploadedVideo, retry: Retry): ReadonlyArray<HTMLElement> => {
  if (video.state === "ready") return []
  if (video.state === "waiting") return [h("p", { class: "muted", role: "status" }, "Студия слушает видео. Это займёт несколько минут.")]
  const { again, trouble } = retryPair(video.name, retry)
  again.setAttribute("size", "s")
  return [h("p", { class: "error" }, "Студия не расслышала это видео."), again, trouble]
}

const askToRemoveVideo = (name: string, onRemoved: () => void): void => {
  askToConfirmRemoval({
    title: `Удалить видео «${name}»?`,
    what: "Видео пропадёт из загруженных. Вернуть его не получится.",
    note: "Ролики, в которые вы уже добавили это видео, сохранят его. Исходный файл на вашем устройстве студия не трогает.",
    label: "Удалить видео",
    remove: Api.removeUploaded(name),
    onRemoved
  })
}

const uploadedItem = (video: UploadedVideo, retry: Retry, onRemoved: () => void): HTMLElement =>
  h("li", { class: video.state === "ready" ? "tile footage" : "tile footage waits" },
    coverOf(video),
    h("b", {}, video.name),
    h("small", {}, factsOf(video)),
    ...troubleOf(video, retry),
    iconButton("normal", "close", `Удалить видео «${video.name}»`, {
      class: "del",
      size: "s",
      pill: true,
      title: "Удалить видео",
      click: () => { askToRemoveVideo(video.name, onRemoved) }
    }))

// Moving a playing video element out of the document pauses it, so only the items that changed are touched.
const placeInOrder = (parent: HTMLElement, nodes: ReadonlyArray<HTMLElement>): void => {
  const wanted = new Set<Element>(nodes)
  for (const child of [...parent.children]) if (!wanted.has(child)) child.remove()
  nodes.forEach((node, index) => {
    const here = parent.children[index]
    if (here !== node) parent.insertBefore(node, here ?? null)
  })
}

export const uploadedView = (): HTMLElement => {
  const input = h("input", { class: "visually-hidden", name: "videos", type: "file", accept: "video/*", multiple: true, tabindex: "-1", "aria-hidden": "true" })
  const open = button("primary", { click: () => { input.click() } }, "Загрузить видео")
  const afterRemoval = (): void => {
    refresh()
    focusWhenReady(open)
  }
  const uploads = h("ul", { class: "uploads queue" }, ...rows)
  const known = h("ul", { class: "grid" })
  const none = h("p", { class: "none", hidden: true }, "Видео пока нет. Нажмите «Загрузить видео» и выберите файлы.")
  const loadError = h("p", { class: "error", role: "alert" })
  const node = h("section", { class: "uploaded", "aria-label": "Загруженные видео" },
    loadError, uploads, known, none,
    h("p", { class: "none" }, "Видео загружаются по очереди. Загрузка продолжится, если перейти в ролик, но не закрывайте вкладку. Чтобы взять видео в ролик, откройте ролик и нажмите «Выбрать видео». Исходные видео студия не меняет."))
  const state = { timer: 0, items: new Map<string, { readonly signature: string; readonly node: HTMLElement }>() }
  const show = (videos: ReadonlyArray<UploadedVideo>): void => {
    const items = new Map(videos.map((video) => {
      const signature = JSON.stringify(video)
      const kept = state.items.get(video.name)
      return [video.name, kept?.signature === signature ? kept : { signature, node: uploadedItem(video, retry, afterRemoval) }] as const
    }))
    state.items = items
    placeInOrder(known, [...items.values()].map((item) => item.node))
    none.hidden = videos.length > 0 || rows.length > 0
    if (loadError.textContent !== "") loadError.textContent = ""
    globalThis.clearTimeout(state.timer)
    if (videos.some((video) => video.state === "waiting")) state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }
  const reload = (): Effect.Effect<void, Api.Failed> => Effect.suspend(() => {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return Effect.void
    return Effect.map(Api.getUploaded, ({ videos }) => { show(videos) })
  })
  function refresh(): void {
    Effect.runFork(reload().pipe(Effect.catchTag("Failed", (error) => Effect.sync(() => {
      if (loadError.textContent !== error.message) loadError.textContent = error.message
      globalThis.clearTimeout(state.timer)
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
    none.hidden = true
    enqueue(made.map((row) => row.work))
  }
  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })
  queueMicrotask(refresh)
  const back = iconButton("plain", "back", "Все ролики", { class: "back", href: "#/" })
  return h("div", { class: "home" },
    h("header", { class: "top" },
      back, tooltip(back, "videos-back", "Все ролики"), h("h1", { class: "brand fits" }, "Загруженные видео"),
      h("div", { class: "actions" }, open), input),
    node)
}
