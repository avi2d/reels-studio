import { Effect } from "effect"
import { HOME_PATH, PROJECT_PREFIX, isStep, stepPath, type Step } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { run } from "../run.ts"
import { studioChat, type StudioChat } from "./chat.ts"
import { rail, stepName, topBar } from "./frame.ts"
import { listView } from "./list.ts"
import { doneStep } from "./done.ts"
import { lookStep } from "./look.ts"
import { montageStep } from "./montage.ts"
import { planStep, type TaskDraft } from "./plan.ts"
import { recordsStep } from "./records.ts"
import { hasRules, rulesPanel } from "./rules.ts"
import { uploaderSection } from "./uploader.ts"

type Page = { readonly kind: "list" } | { readonly kind: "reel"; readonly id: string; readonly step: Step | undefined }

const TITLE = "Студия Reels"

const app = document.querySelector("#app") ?? document.body
const drafts = new Map<string, TaskDraft>()
let room: { readonly id: string; readonly chat: StudioChat } | undefined
let leaveStep: (() => void) | undefined

const leaveChat = (): void => {
  room?.chat.dispose()
  room = undefined
}

const chatFor = (project: Api.ProjectView): StudioChat => {
  if (room?.id === project.id) return room.chat
  leaveChat()
  const chat = studioChat(project)
  room = { id: project.id, chat }
  return chat
}

const pageAt = (pathname: string): Page | undefined => {
  const path = pathname === HOME_PATH ? HOME_PATH : pathname.replace(/\/+$/u, "")
  if (path === HOME_PATH) return { kind: "list" }
  if (!path.startsWith(PROJECT_PREFIX)) return undefined
  const [id = "", step, ...rest] = path.slice(PROJECT_PREFIX.length).split("/")
  if (!/^[a-z0-9-]+$/u.test(id) || rest.length > 0) return undefined
  if (step === undefined) return { kind: "reel", id, step: undefined }
  return isStep(step) ? { kind: "reel", id, step } : undefined
}

const show = (kind: "home" | "reel", ...nodes: ReadonlyArray<Node>): void => {
  app.className = `app app--${kind}`
  app.replaceChildren(...nodes)
}

const showFailure = (message: string): void => {
  leaveChat()
  document.title = TITLE
  show("home", topBar(), h("main", { class: "main" }, h("div", { class: "body" },
    h("p", { class: "error", role: "alert" }, message),
    h("a", { class: "btn btn--quiet btn--start", href: HOME_PATH }, "К роликам"))))
}

const listPage = (): Effect.Effect<void, Api.Failed> =>
  Effect.map(Effect.all({ list: Api.listProjects, uploaded: Api.getUploaded }, { concurrency: "unbounded" }), ({ list, uploaded }) => {
    document.title = `Ролики · ${TITLE}`
    const onCreated = (id: string): void => { navigate(stepPath(id, "records")) }
    show("home", topBar(), h("main", { class: "main" }, listView(list.projects, onCreated, uploaderSection(uploaded.videos))))
  })

const reelPage = (id: string, step: Step): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const { project } = yield* Api.getProject(id)
    let steps = rail(project, step)
    let stage = project.stage
    const chat = chatFor(project)
    let body: HTMLElement
    let refreshRules: (() => void) | undefined
    if (step === "plan") {
      const saved = yield* Api.getBrief(id)
      const view = planStep(id, saved, {
        chat,
        draft: drafts.get(id),
        keepDraft: (value) => { if (value === undefined) drafts.delete(id); else drafts.set(id, value) },
        advance: () => { if (location.pathname === stepPath(id, "plan")) navigate(stepPath(id, "montage")) }
      })
      body = view.body
      leaveStep = view.dispose
    } else if (step === "look") {
      const view = lookStep(id)
      body = view.body
      leaveStep = view.dispose
    } else if (step === "done") {
      const view = doneStep(id)
      body = view.body
      leaveStep = view.dispose
    } else if (step === "montage") {
      const view = montageStep(id, chat)
      refreshRules = view.refresh
      body = view.body
      leaveStep = view.dispose
    } else {
      body = yield* recordsStep(project, (now) => {
        if (now.stage === stage) return
        const fresh = rail(now, step)
        steps.replaceWith(fresh)
        steps = fresh
        stage = now.stage
      })
    }
    if (hasRules(step)) {
      const rules = rulesPanel(id, step, chat, refreshRules)
      body.append(rules.node)
      const leave = leaveStep
      leaveStep = () => {
        leave?.()
        rules.dispose()
      }
    }
    const setPageTitle = (title: string): void => { document.title = `${stepName(step)} · ${title} · ${TITLE}` }
    setPageTitle(project.title)
    show("reel",
      topBar({ project, chat: chat.opener, renamed: setPageTitle, removed: () => {
        drafts.delete(id)
        navigate(HOME_PATH)
      } }),
      steps,
      h("main", { class: "main" }, body))
  })

let stopLoad: (() => void) | undefined

const route = (moved: boolean): void => {
  stopLoad?.()
  leaveStep?.()
  leaveStep = undefined
  const page = pageAt(location.pathname)
  if (page?.kind !== "reel" || room?.id !== page.id) leaveChat()
  if (page === undefined) {
    showFailure("Такой страницы в студии нет.")
    return
  }
  if (page.kind === "reel" && page.step === undefined) history.replaceState(history.state, "", stepPath(page.id, "records"))
  const view = page.kind === "list" ? listPage() : reelPage(page.id, page.step ?? "records")
  stopLoad = run(Effect.map(view, () => {
    if (!moved) return
    scrollTo(0, 0)
    app.querySelector("h1")?.focus({ preventScroll: true })
  }), showFailure)
}

function navigate(address: string): void {
  history.pushState(null, "", address)
  route(true)
}

const studioLink = (event: MouseEvent): string | undefined => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement)
  if (link === undefined || !link.hasAttribute("href") || (link.target !== "" && link.target !== "_self")) return
  const url = new URL(link.href)
  if (url.origin === location.origin && url.hash === "" && pageAt(url.pathname) !== undefined) return url.pathname
}

document.addEventListener("click", (event) => {
  const address = studioLink(event)
  if (address === undefined) return
  event.preventDefault()
  navigate(address)
})
// A dropped file opens in the tab and cancels the uploads in flight.
const refuseDrop = (event: DragEvent): void => {
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "none"
}
document.addEventListener("dragover", refuseDrop)
document.addEventListener("drop", refuseDrop)
globalThis.addEventListener("popstate", () => { route(true) })
route(false)
