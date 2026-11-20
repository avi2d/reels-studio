import { Effect } from "effect"
import { ACCEPTED_FILES, type FileKind, kindOfName, MAX_FILES } from "../shared/chat.ts"
import * as Api from "./api.ts"
import { icon, iconButton } from "./controls.ts"
import { h } from "./dom.ts"
import { formatSize } from "./format.ts"
import type { IconName } from "./kit.ts"
import { attachmentShelf, upload } from "./upload.ts"

const KIND_ICONS: Readonly<Record<FileKind, IconName>> = {
  picture: "picture",
  document: "document",
  video: "video",
  sound: "sound",
  other: "file"
}

const KIND_NAMES: Readonly<Record<FileKind, string>> = {
  picture: "Картинка",
  document: "Документ",
  video: "Видео",
  sound: "Звук",
  other: "Файл"
}

const HAS_COVER: ReadonlySet<FileKind> = new Set(["picture", "document", "video"])

const thumb = (kind: FileKind, source: string | undefined): HTMLElement => {
  const fallback = h("span", { class: "thumb" }, icon(KIND_ICONS[kind]))
  if (source === undefined) return fallback
  const picture = h("img", { class: "thumb", src: source, alt: "", loading: "lazy", decoding: "async" })
  picture.addEventListener("error", () => { picture.replaceWith(fallback) })
  return picture
}

const fileItem = (name: string, source: string | undefined): HTMLElement => {
  const kind = kindOfName(name)
  return h("li", { title: name },
    thumb(kind, source),
    h("span", { class: "visually-hidden" }, `${KIND_NAMES[kind]}: `),
    h("span", { class: "name" }, name))
}

const fileList = (items: ReadonlyArray<HTMLElement>): HTMLElement =>
  h("ul", { class: "attached", "aria-label": "Приложенные файлы" }, ...items)

export const sentFiles = (projectId: string, names: ReadonlyArray<string>): HTMLElement =>
  fileList(names.map((name) => fileItem(name, HAS_COVER.has(kindOfName(name)) ? Api.coverUrl(projectId, name) : undefined)))

interface Picked {
  readonly file: File
  readonly node: HTMLElement
  readonly status: HTMLElement
  readonly preview: string | undefined
}

export interface Tray {
  readonly node: HTMLElement
  readonly opener: HTMLElement
  readonly input: HTMLInputElement
  readonly add: (files: ReadonlyArray<File>) => void
  readonly count: () => number
  readonly send: Effect.Effect<ReadonlyArray<string>, Api.Failed>
  readonly sentView: () => HTMLElement
  readonly clear: () => void
  readonly lock: (locked: boolean) => void
}

const uploadId = (url: string): string => url.split("/").at(-1) ?? ""

export const attachTray = (projectId: string, onProblem: (message: string) => void): Tray => {
  const list = h("ul", { class: "tray", "aria-label": "Файлы к сообщению", hidden: true })
  const input = h("input", { class: "visually-hidden", type: "file", accept: ACCEPTED_FILES, multiple: true, tabindex: "-1", "aria-hidden": "true" })
  const opener = iconButton("plain", "attach", "Приложить файлы", { class: "attach" })
  opener.addEventListener("click", () => { input.click() })
  const picked: Array<Picked> = []
  const state = { locked: false }

  const refresh = (): void => { list.hidden = picked.length === 0 }

  const drop = (entry: Picked): void => {
    const index = picked.indexOf(entry)
    if (index >= 0) picked.splice(index, 1)
    entry.node.remove()
    if (entry.preview !== undefined) URL.revokeObjectURL(entry.preview)
    refresh()
    opener.focus()
  }

  const chip = (file: File): Picked => {
    const kind = kindOfName(file.name)
    const preview = kind === "picture" ? URL.createObjectURL(file) : undefined
    const status = h("span", { class: "size" }, formatSize(file.size))
    const remove = iconButton("plain", "close", `Убрать ${file.name}`, { class: "remove" })
    const node = h("li", {}, thumb(kind, preview), h("span", { class: "name", title: file.name }, file.name), status, remove)
    const entry: Picked = { file, node, status, preview }
    remove.addEventListener("click", () => { if (!state.locked) drop(entry) })
    return entry
  }

  const add = (files: ReadonlyArray<File>): void => {
    const fresh = files.filter((file) => !picked.some((entry) => entry.file === file))
    const room = MAX_FILES - picked.length
    if (fresh.length > room) onProblem(`К одному сообщению можно приложить не больше ${MAX_FILES} файлов.`)
    const empty = fresh.slice(0, room).filter((file) => file.size === 0)
    if (empty.length > 0) onProblem(`Файл «${empty[0]?.name ?? ""}» пустой. Выберите другой.`)
    const kept = fresh.slice(0, room).filter((file) => file.size > 0).map(chip)
    picked.push(...kept)
    list.append(...kept.map((entry) => entry.node))
    refresh()
  }

  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })

  const send: Effect.Effect<ReadonlyArray<string>, Api.Failed> = Effect.suspend(() =>
    Effect.forEach([...picked], (entry) =>
      upload(attachmentShelf(projectId), entry.file, (progress) => {
        entry.status.textContent = progress.waiting
          ? "ждёт связи"
          : `${Math.floor((progress.sent / progress.total) * 100)}%`
      }).pipe(
        Effect.map(uploadId),
        Effect.tapError(() => Effect.sync(() => { entry.status.textContent = formatSize(entry.file.size) }))
      )))

  const sentView = (): HTMLElement => fileList(picked.map((entry) => fileItem(entry.file.name, entry.preview)))

  const clear = (): void => {
    picked.splice(0, picked.length)
    list.replaceChildren()
    refresh()
  }

  const lock = (locked: boolean): void => {
    state.locked = locked
    opener.toggleAttribute("disabled", locked)
    list.classList.toggle("sending", locked)
  }

  return { node: list, opener, input, add, count: () => picked.length, send, sentView, clear, lock }
}
