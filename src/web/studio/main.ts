import { Effect } from "effect"
import { STUDIO_PATH, isStep, stepPath, type Step } from "../../shared/page.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { run } from "../run.ts"
import { rail, stepBody, stepName, topBar } from "./frame.ts"
import { listView } from "./list.ts"
import { recordsStep } from "./records.ts"

type Page = { readonly kind: "list" } | { readonly kind: "reel"; readonly id: string; readonly step: Step | undefined }

const TITLE = "Студия Reels"

const app = document.querySelector("#app") ?? document.body

const pageAt = (pathname: string): Page | undefined => {
  const path = pathname.replace(/\/+$/u, "")
  if (path === STUDIO_PATH) return { kind: "list" }
  if (!path.startsWith(`${STUDIO_PATH}/`)) return undefined
  const [id = "", step, ...rest] = path.slice(STUDIO_PATH.length + 1).split("/")
  if (!/^[a-z0-9-]+$/u.test(id) || rest.length > 0) return undefined
  if (step === undefined) return { kind: "reel", id, step: undefined }
  return isStep(step) ? { kind: "reel", id, step } : undefined
}

const show = (kind: "home" | "reel", ...nodes: ReadonlyArray<Node>): void => {
  app.className = `app app--${kind}`
  app.replaceChildren(...nodes)
}

const showFailure = (message: string): void => {
  document.title = TITLE
  show("home", topBar(), h("main", { class: "main" }, h("div", { class: "body" },
    h("p", { class: "error", role: "alert" }, message),
    h("a", { class: "btn btn--quiet btn--start", href: STUDIO_PATH }, "К роликам"))))
}

const listPage = (): Effect.Effect<void, Api.Failed> =>
  Effect.map(Api.listProjects, ({ projects }) => {
    document.title = `Ролики · ${TITLE}`
    show("home", topBar(), h("main", { class: "main" }, listView(projects, (id) => { navigate(stepPath(id, "records")) })))
  })

const stepView = (project: Api.ProjectView, step: Step, onProject: (project: Api.ProjectView) => void): Effect.Effect<HTMLElement, Api.Failed> =>
  step === "records" ? recordsStep(project, onProject) : Effect.succeed(stepBody(project, step))

const reelPage = (id: string, step: Step): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const { project } = yield* Api.getProject(id)
    let steps = rail(project, step)
    let stage = project.stage
    const body = yield* stepView(project, step, (now) => {
      if (now.stage === stage) return
      const fresh = rail(now, step)
      steps.replaceWith(fresh)
      steps = fresh
      stage = now.stage
    })
    const setPageTitle = (title: string): void => { document.title = `${stepName(step)} · ${title} · ${TITLE}` }
    setPageTitle(project.title)
    show("reel",
      topBar({ project, renamed: setPageTitle, removed: () => { navigate(STUDIO_PATH) } }),
      steps,
      h("main", { class: "main" }, body))
  })

let stopLoad: (() => void) | undefined

const route = (moved: boolean): void => {
  stopLoad?.()
  const page = pageAt(location.pathname)
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
