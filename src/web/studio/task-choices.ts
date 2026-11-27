import { Effect } from "effect"
import { APPS, type App, inAppOrder, type TaskFile } from "../../shared/brief.ts"
import { ACCEPTED_FILES, kindOfName, MAX_FILES } from "../../shared/chat.ts"
import * as Api from "../api.ts"
import { HAS_COVER, KIND_NAMES, thumb } from "../attach.ts"
import { h } from "../dom.ts"
import { formatSize } from "../format.ts"
import { attachmentShelf, upload } from "../upload.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

export type TaskEntry =
  | { readonly kind: "saved"; readonly name: string }
  | { readonly kind: "picked"; readonly file: File }

const entryName = (entry: TaskEntry): string => entry.kind === "saved" ? entry.name : entry.file.name

export const savedEntries = (names: ReadonlyArray<string>): ReadonlyArray<TaskEntry> =>
  names.map((name) => ({ kind: "saved", name }))

export const sameEntries = (entries: ReadonlyArray<TaskEntry>, names: ReadonlyArray<string>): boolean =>
  entries.length === names.length && entries.every((entry, index) => entry.kind === "saved" && entry.name === names[index])

export const sameApps = (left: ReadonlyArray<App>, right: ReadonlyArray<App>): boolean =>
  left.length === right.length && left.every((app, index) => app === right[index])

interface AppPicker {
  readonly node: HTMLElement
  readonly chosen: () => ReadonlyArray<App>
  readonly lock: (locked: boolean) => void
}

export const appPicker = (initial: ReadonlyArray<App>, changed: () => void): AppPicker => {
  const chosen = new Set(initial)
  const chips = APPS.map((app) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(chosen.has(app)) }, icon("check"), app)
    chip.addEventListener("click", () => {
      if (chosen.has(app)) chosen.delete(app)
      else chosen.add(app)
      chip.setAttribute("aria-pressed", String(chosen.has(app)))
      changed()
    })
    return chip
  })
  const node = h("fieldset", { class: "studio-plan__group" },
    h("legend", { class: "studio-plan__legend" }, "Куда"),
    h("div", { class: "chips" }, ...chips))
  return {
    node,
    chosen: () => inAppOrder(chosen),
    lock: (locked) => { for (const chip of chips) chip.disabled = locked }
  }
}

interface Row {
  readonly entry: TaskEntry
  readonly node: HTMLElement
  readonly status: HTMLElement
  readonly remove: HTMLButtonElement
}

interface FileRow {
  readonly node: HTMLElement
  readonly entries: () => ReadonlyArray<TaskEntry>
  readonly lock: (locked: boolean) => void
  readonly send: Effect.Effect<ReadonlyArray<TaskFile>, Api.Failed>
  readonly settle: (names: ReadonlyArray<string>) => void
  readonly reloadCovers: () => void
}

export const fileRow = (projectId: string, initial: ReadonlyArray<TaskEntry>, changed: () => void, onProblem: (message: string) => void): FileRow => {
  const list = h("ul", { class: "studio-plan__files", "aria-label": "Файлы к заданию" })
  const input = h("input", { class: "visually-hidden", type: "file", accept: ACCEPTED_FILES, multiple: true, tabindex: "-1", "aria-hidden": "true" })
  const pick = button("quiet", "Приложить", { class: "btn btn--quiet btn--sm btn--start" }, "attach")
  const rows: Array<Row> = []
  const uploaded = new WeakMap<File, string>()
  let locked = false

  const refresh = (): void => {
    list.hidden = rows.length === 0
    pick.disabled = locked || rows.length >= MAX_FILES
    for (const row of rows) row.remove.disabled = locked
  }

  const rowOf = (entry: TaskEntry): Row => {
    const name = entryName(entry)
    const kind = kindOfName(name)
    const cover = entry.kind === "saved" && HAS_COVER.has(kind) ? Api.coverUrl(projectId, name) : undefined
    const status = h("span", { class: "studio-plan__file-note" }, entry.kind === "saved" ? KIND_NAMES[kind] : formatSize(entry.file.size))
    const remove = button("plain", "", { class: "btn btn--plain btn--icon", title: `Убрать ${name}`, "aria-label": `Убрать ${name}` }, "close")
    const node = h("li", { class: "studio-plan__file" },
      thumb(kind, cover, () => icon("file")),
      h("span", { class: "studio-plan__file-text" }, h("b", {}, name), status),
      remove)
    const row: Row = { entry, node, status, remove }
    remove.addEventListener("click", () => {
      if (locked) return
      rows.splice(rows.indexOf(row), 1)
      node.remove()
      refresh()
      pick.focus()
      changed()
    })
    return row
  }

  const add = (files: ReadonlyArray<File>): void => {
    const listed = (file: File): boolean => rows.some((row) => entryName(row.entry) === file.name)
    const repeated = files.find(listed)
    if (repeated !== undefined) onProblem(`Файл «${repeated.name}» уже есть в списке.`)
    const fresh = files.filter((file) => !listed(file))
    const room = MAX_FILES - rows.length
    if (fresh.length > room) onProblem(`К заданию можно приложить не больше ${MAX_FILES} файлов.`)
    const kept = fresh.slice(0, room)
    const empty = kept.find((file) => file.size === 0)
    if (empty !== undefined) onProblem(`Файл «${empty.name}» пустой. Выберите другой.`)
    const added = kept.filter((file) => file.size > 0).map((file) => rowOf({ kind: "picked", file }))
    rows.push(...added)
    list.append(...added.map((row) => row.node))
    refresh()
    if (added.length > 0) changed()
  }

  pick.addEventListener("click", () => { input.click() })
  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })

  const sendRow = (row: Row): Effect.Effect<TaskFile, Api.Failed> => {
    if (row.entry.kind === "saved") return Effect.succeed({ name: row.entry.name })
    const { file } = row.entry
    const done = uploaded.get(file)
    if (done !== undefined) return Effect.succeed({ upload: done })
    return upload(attachmentShelf(projectId), file, (progress) => {
      row.status.textContent = progress.waiting ? "ждёт связи" : `${Math.floor((progress.sent / progress.total) * 100)}%`
    }).pipe(Effect.map((url) => {
      const id = url.split("/").at(-1) ?? ""
      uploaded.set(file, id)
      row.status.textContent = formatSize(file.size)
      return { upload: id }
    }), Effect.tapError(() => Effect.sync(() => { row.status.textContent = formatSize(file.size) })))
  }

  const showEntries = (entries: ReadonlyArray<TaskEntry>): void => {
    const fresh = entries.map(rowOf)
    rows.splice(0, rows.length, ...fresh)
    list.replaceChildren(...fresh.map((row) => row.node))
    refresh()
  }

  showEntries(initial)
  return {
    node: h("fieldset", { class: "studio-plan__group" }, h("legend", { class: "studio-plan__legend" }, "Файлы"), list, pick, input),
    entries: () => rows.map((row) => row.entry),
    lock: (on) => {
      locked = on
      refresh()
    },
    send: Effect.suspend(() => Effect.forEach([...rows], sendRow)),
    settle: (names) => { if (!sameEntries(rows.map((row) => row.entry), names)) showEntries(savedEntries(names)) },
    reloadCovers: () => { if (rows.every((row) => row.entry.kind === "saved")) showEntries(rows.map((row) => row.entry)) }
  }
}
