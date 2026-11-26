import { Effect } from "effect"
import { Effort } from "../../shared/project.ts"
import * as Api from "../api.ts"
import { attachTray, type Tray } from "../attach.ts"
import { h } from "../dom.ts"
import { modelName } from "../format.ts"
import { run } from "../run.ts"
import { attachmentIcon, savedMessage, streamTurn, type Reply } from "./chat-turn.ts"
import { icon, type IconName } from "./icons.ts"
import { button } from "./ui.ts"

const EFFORT_NAMES = { low: "Низкая", medium: "Средняя", high: "Высокая" } satisfies Record<Effort, string>

type State =
  | { readonly kind: "loading" | "unavailable" | "ready" | "sending" }
  | { readonly kind: "streaming" | "stopping"; readonly token: string }

type ChatStatus = "loading" | "unavailable" | "ready" | "busy"

interface ChatAction {
  readonly text: string
  readonly prepare?: Effect.Effect<unknown, Api.Failed>
  readonly finish: (reply: Reply) => void
}

export interface StudioChat {
  readonly opener: HTMLButtonElement
  readonly open: () => void
  readonly status: () => ChatStatus
  readonly watch: (listener: () => void) => () => void
  readonly ask: (action: ChatAction) => boolean
  readonly dispose: () => void
}

const iconButton = (name: IconName, label: string, extra = ""): HTMLButtonElement =>
  h("button", { type: "button", class: `btn btn--quiet btn--icon ${extra}`.trim(), title: label, "aria-label": label }, icon(name))

const chatView = () => {
  const opener = button("quiet", "Чат", { "aria-haspopup": "dialog", "aria-controls": "studio-chat" }, "chat")
  const close = iconButton("close", "Закрыть чат")
  const header = h("header", { class: "studio-chat__head" }, h("h2", { id: "studio-chat-title" }, "Чат"), close)
  const thread = h("div", { class: "studio-chat__thread", role: "log", "aria-live": "off", "aria-label": "Сообщения", tabindex: "0" })
  const empty = h("p", { class: "hint" }, "Напишите, что изменить.")
  const model = h("select", { class: "field" })
  const effort = h("select", { class: "field" }, ...Effort.literals.map((id) => h("option", { value: id }, EFFORT_NAMES[id])))
  const settings = h("details", { class: "studio-chat__settings" },
    h("summary", {}, "Кто отвечает"),
    h("div", { class: "studio-chat__options" },
      h("label", { class: "label" }, "Модель", model),
      h("label", { class: "label" }, "Глубина размышления", effort)))
  const problem = h("p", { class: "error", role: "alert" })
  const status = h("p", { class: "hint studio-chat__status", role: "status" })
  const text = h("textarea", { rows: "2", class: "field", "aria-label": "Сообщение", enterkeyhint: "send", placeholder: "Что изменить?" })
  const send = iconButton("send", "Отправить", "studio-chat__send")
  send.type = "submit"
  const stop = button("quiet", "Остановить", {}, "stop")
  const reload = button("quiet", "Загрузить чат ещё раз", { hidden: true })
  const dialog = h("dialog", { class: "studio-chat", id: "studio-chat", "aria-labelledby": "studio-chat-title" })
  return { dialog, header, opener, close, thread, empty, model, effort, settings, problem, status, text, send, stop, reload }
}

const loadChat = (
  view: ReturnType<typeof chatView>,
  project: Api.ProjectView,
  set: (state: State) => void,
  say: (message: string) => void
): (() => void) => {
  say("")
  view.status.textContent = "Загружаю чат…"
  set({ kind: "loading" })
  return run(Effect.gen(function*() {
    const { history, models } = yield* Effect.all({ history: Api.getChat(project.id), models: Api.getModels }, { concurrency: "unbounded" })
    view.thread.replaceChildren(...history.messages.length === 0 ? [view.empty] : history.messages.map((message) => savedMessage(project.id, message)))
    view.thread.scrollTop = view.thread.scrollHeight
    if (models.models.length === 0) return yield* new Api.Failed({ message: "В студии нет моделей для чата." })
    view.model.replaceChildren(...models.models.map((id) => h("option", { value: id }, modelName(id))))
    view.model.value = models.models.find((id) => id === project.model) ?? models.models[0] ?? ""
    view.effort.value = project.effort ?? "medium"
    view.status.textContent = ""
    set({ kind: "ready" })
  }), (message) => {
    say(message)
    view.status.textContent = ""
    set({ kind: "unavailable" })
  })

}

const wireComposer = (
  view: ReturnType<typeof chatView>,
  form: HTMLFormElement,
  tray: Tray,
  open: () => void,
  render: () => void,
  send: (action: ChatAction, fromComposer: boolean) => boolean
): void => {
  view.opener.addEventListener("click", open)
  view.close.addEventListener("click", () => { view.dialog.close() })
  view.dialog.addEventListener("close", () => { if (!view.dialog.open) tray.input.remove() })
  view.text.addEventListener("input", render)
  view.text.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (!view.send.disabled) form.requestSubmit()
  })
  view.text.addEventListener("paste", (event) => {
    const pasted = [...(event.clipboardData?.files ?? [])]
    if (pasted.length === 0) return
    event.preventDefault()
    tray.add(pasted)
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!view.send.disabled) send({ text: view.text.value.trim(), finish: () => {} }, true)
  })
}

const wireStop = (
  view: ReturnType<typeof chatView>, projectId: string, current: () => State,
  set: (state: State) => void, say: (message: string) => void
): void => {
  view.stop.addEventListener("click", () => {
    const streaming = current()
    if (streaming.kind !== "streaming") return
    set({ kind: "stopping", token: streaming.token })
    say("")
    view.status.textContent = "Останавливаю ответ…"
    run(Api.stopChat(projectId, streaming.token), (message) => {
      const state = current()
      if (state.kind !== "stopping" || state.token !== streaming.token) return
      say(message)
      view.status.textContent = "Студия отвечает…"
      set(streaming)
    })
  })
}

export const studioChat = (project: Api.ProjectView): StudioChat => {
  const view = chatView()
  const listeners = new Set<() => void>()
  let state: State = { kind: "loading" }
  const say = (message: string): void => { view.problem.textContent = message }
  const tray = attachTray(project.id, say, {
    icon: attachmentIcon,
    pick: () => iconButton("attach", "Приложить файлы"),
    remove: (label) => iconButton("close", label, "remove"),
    changed: () => { render() }
  })
  const form = h("form", { class: "studio-chat__form" }, view.settings, tray.node,
    h("div", { class: "studio-chat__composer" }, tray.opener, view.text, view.send),
    h("div", { class: "studio-chat__actions" }, view.status, view.stop, view.reload), view.problem)
  view.dialog.append(view.header, view.thread, form)
  document.body.append(view.dialog)
  const status = (): ChatStatus => {
    if (state.kind === "sending" || state.kind === "streaming" || state.kind === "stopping") return "busy"
    return state.kind
  }
  const draft = (): string => view.text.value.trim()
  function render(): void {
    const ready = state.kind === "ready"
    const canStop = state.kind === "streaming" || state.kind === "stopping"
    view.send.disabled = !ready || (draft() === "" && tray.count() === 0)
    view.settings.hidden = view.model.options.length === 0
    view.model.disabled = !ready
    view.effort.disabled = !ready
    view.reload.hidden = state.kind !== "unavailable"
    if (!canStop && document.activeElement === view.stop) view.text.focus()
    view.stop.hidden = !canStop
    view.stop.disabled = state.kind === "stopping"
    tray.lock(!ready)
  }
  const set = (next: State): void => {
    state = next
    render()
    for (const listener of listeners) listener()
  }


  const send = (action: ChatAction, fromComposer: boolean): boolean => {
    if (state.kind !== "ready") return false
    const model = view.model.value
    const effort = Effort.literals.find((id) => id === view.effort.value) ?? "medium"
    const { text, prepare, finish } = action
    set({ kind: "sending" })
    say("")
    view.status.textContent = fromComposer && tray.count() > 0 ? "Загружаю файлы…" : "Отправляю…"
    const finished = (reply: Reply): void => {
      view.status.textContent = ""
      set({ kind: "ready" })
      finish(reply)
    }
    run(Effect.gen(function*() {
      if (prepare !== undefined) yield* prepare
      const files = fromComposer ? yield* tray.send : []
      const reply = yield* streamTurn({ projectId: project.id, text, model, effort, files }, {
        thread: view.thread, status: view.status, empty: view.empty,
        attachments: files.length === 0 ? undefined : tray.sentView(),
        accept: (token) => {
          if (fromComposer) {
            if (draft() === text) view.text.value = ""
            tray.clear()
          }
          set({ kind: "streaming", token })
        }
      })
      finished(reply)
    }), (message) => {
      if (fromComposer) say(message)
      finished({ kind: "failed", message })
    })
    return true
  }
  const open = (): void => {
    if (view.dialog.open) return
    form.append(tray.input)
    view.dialog.showModal()
    view.thread.scrollTop = view.thread.scrollHeight
    if (globalThis.matchMedia("(hover: hover) and (pointer: fine)").matches) view.text.focus()
  }
  wireComposer(view, form, tray, open, render, send)
  wireStop(view, project.id, () => state, set, say)
  const load = (): (() => void) => loadChat(view, project, set, say)
  let cancelLoad = load()
  view.reload.addEventListener("click", () => { cancelLoad = load() })
  const dispose = (): void => {
    cancelLoad()
    tray.dispose()
    listeners.clear()
    view.dialog.remove()
  }
  return {
    opener: view.opener, open, status,
    watch: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ask: (action) => send(action, false), dispose
  }
}
