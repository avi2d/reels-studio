import type { App } from "../../shared/brief.ts"
import { h } from "../dom.ts"

export interface AppTabs {
  readonly node: HTMLElement
  readonly draw: (apps: ReadonlyArray<App>) => void
  readonly mark: (app: App) => void
}

const appOfTab = (tab: Element): string | null => tab.getAttribute("data-app")

export const appTabs = (choose: (app: App) => void): AppTabs => {
  const state: { apps: ReadonlyArray<App>; chosen: App | undefined } = { apps: [], chosen: undefined }
  const node = h("div", { class: "tabs", role: "tablist", "aria-label": "Приложение" })

  const mark = (app: App): void => {
    state.chosen = app
    for (const tab of node.children) {
      const chosen = appOfTab(tab) === app
      tab.setAttribute("aria-selected", String(chosen))
      tab.setAttribute("tabindex", chosen ? "0" : "-1")
    }
  }

  const draw = (apps: ReadonlyArray<App>): void => {
    node.hidden = apps.length < 2
    if (apps.length === state.apps.length && apps.every((app, index) => app === state.apps[index])) return
    state.apps = apps
    node.replaceChildren(...apps.map((app) => h("button", {
      class: "tab", type: "button", role: "tab", "data-app": app, "aria-selected": "false", tabindex: "-1",
      click: () => { choose(app) }
    }, app)))
    if (state.chosen !== undefined) mark(state.chosen)
  }

  node.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" || state.chosen === undefined) return
    const { apps } = state
    const step = event.key === "ArrowRight" ? 1 : -1
    const next = apps[(apps.indexOf(state.chosen) + step + apps.length) % apps.length]
    if (next === undefined) return
    event.preventDefault()
    choose(next)
    const tab = [...node.children].find((one) => appOfTab(one) === next)
    if (tab instanceof HTMLElement) tab.focus()
  })

  return { node, draw, mark }
}
