import { Effect } from "effect"
import type { App } from "../../shared/brief.ts"
import { emptyPost, MAX_POST, type Post } from "../../shared/posts.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { button } from "./ui.ts"

const SAVE_MS = 600
const NOTE_MS = 2000

const TEXT_HINT = "Напишите подпись к публикации"
const TAGS_HINT = "#юрист #аванс"
const COPIED = "Скопировано"
const SELECTED = "Текст выделен, скопируйте его"

type Control = HTMLTextAreaElement | HTMLInputElement
type Part = "text" | "tags"

export interface PostPanel {
  readonly node: HTMLElement
  readonly show: (app: App) => void
  readonly flush: () => void
}

const copiedField = (part: Part, label: string, control: Control, copy: () => void): HTMLElement =>
  h("div", { class: "copied" },
    h("div", { class: "copied__head" },
      h("label", { class: "group__title", for: `done-post-${part}` }, label),
      button("plain", "Скопировать", { class: "btn btn--plain btn--sm", click: copy }, "copy")),
    control)

export const postPanel = (projectId: string): PostPanel => {
  const state: { app: App | undefined; loaded: boolean; note: number } = { app: undefined, loaded: false, note: 0 }
  const posts = new Map<App, Post>()
  const timers = new Map<App, number>()
  const controls = {
    text: h("textarea", { class: "field", id: "done-post-text", rows: "4", maxlength: String(MAX_POST), placeholder: TEXT_HINT, disabled: true }),
    tags: h("input", { class: "field", id: "done-post-tags", maxlength: String(MAX_POST), placeholder: TAGS_HINT, autocapitalize: "off", disabled: true })
  }
  const note = h("p", { class: "hint", role: "status" })
  const problem = h("p", { class: "error", role: "alert" })

  const say = (text: string): void => {
    globalThis.clearTimeout(state.note)
    note.textContent = text
    state.note = Number(globalThis.setTimeout(() => { note.textContent = "" }, NOTE_MS))
  }

  // A plain http address on the home network has no clipboard, so the text is selected for the person to copy.
  const copy = (part: Part): void => {
    const control = controls[part]
    if (control.value === "") return
    navigator.clipboard.writeText(control.value).then(() => { say(COPIED) }, () => {
      control.focus()
      control.select()
      say(SELECTED)
    })
  }

  const save = (app: App): void => {
    globalThis.clearTimeout(timers.get(app))
    timers.delete(app)
    const post = posts.get(app)
    if (post === undefined) return
    Effect.runFork(Api.savePost(projectId, post).pipe(
      Effect.tap(() => Effect.sync(() => { problem.textContent = "" })),
      Effect.catchTag("Failed", (error) => Effect.sync(() => { problem.textContent = error.message }))
    ))
  }

  const edit = (part: Part): void => {
    const app = state.app
    if (app === undefined) return
    posts.set(app, { ...posts.get(app) ?? emptyPost(app), [part]: controls[part].value })
    globalThis.clearTimeout(timers.get(app))
    timers.set(app, Number(globalThis.setTimeout(() => { save(app) }, SAVE_MS)))
  }

  const paint = (): void => {
    const app = state.app
    if (app === undefined) return
    const post = posts.get(app) ?? emptyPost(app)
    controls.text.value = post.text
    controls.tags.value = post.tags
    controls.text.disabled = !state.loaded
    controls.tags.disabled = !state.loaded
  }

  for (const part of ["text", "tags"] as const) controls[part].addEventListener("input", () => { edit(part) })

  Effect.runFork(Api.getPosts(projectId).pipe(
    Effect.map((loaded) => {
      for (const post of loaded.posts) posts.set(post.app, post)
      state.loaded = true
      paint()
    }),
    Effect.catchTag("Failed", (error) => Effect.sync(() => { problem.textContent = error.message }))
  ))

  return {
    node: h("section", { class: "group done-post", "aria-label": "Подпись к публикации" },
      h("h2", { class: "done-post__title" }, "Подпись"),
      copiedField("text", "Текст", controls.text, () => { copy("text") }),
      copiedField("tags", "Хештеги", controls.tags, () => { copy("tags") }),
      note, problem),
    show: (app) => {
      if (state.app === app) return
      state.app = app
      note.textContent = ""
      paint()
    },
    flush: () => { for (const app of [...timers.keys()]) save(app) }
  }
}
