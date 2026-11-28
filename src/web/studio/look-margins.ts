import { Option, Schema } from "effect"
import { App, APPS } from "../../shared/brief.ts"
import type { Platform } from "../../shared/zones.ts"
import { h } from "../dom.ts"
import { styleOf } from "../margins.ts"
import { button } from "./ui.ts"

type MarginsChoice =
  | { readonly kind: "none" }
  | { readonly kind: "app"; readonly app: App; readonly ads: boolean }

const NONE: MarginsChoice = { kind: "none" }

const PRESETS = {
  Instagram: { plain: "Instagram", ads: "Instagram, реклама" },
  "YouTube Shorts": { plain: "YouTube Shorts", ads: "YouTube Shorts, реклама" },
  TikTok: { plain: "TikTok", ads: "TikTok, реклама" }
} as const satisfies Record<App, { readonly plain: Platform; readonly ads: Platform }>

const platformOf = (choice: MarginsChoice): Platform | undefined =>
  choice.kind === "none" ? undefined : PRESETS[choice.app][choice.ads ? "ads" : "plain"]

const Kept = Schema.fromJsonString(Schema.Struct({ app: App, ads: Schema.Boolean }))
const decodeKept = Schema.decodeUnknownOption(Kept)

const parseChoice = (text: string | null): MarginsChoice =>
  Option.match(text === null ? Option.none() : decodeKept(text), {
    onNone: () => NONE,
    onSome: ({ app, ads }) => ({ kind: "app", app, ads })
  })

const storageKey = (projectId: string): string => `studio-margins:${projectId}`

const readChoice = (projectId: string): MarginsChoice => parseChoice(localStorage.getItem(storageKey(projectId)))

const keepChoice = (projectId: string, choice: MarginsChoice): void => {
  if (choice.kind === "none") localStorage.removeItem(storageKey(projectId))
  else localStorage.setItem(storageKey(projectId), JSON.stringify({ app: choice.app, ads: choice.ads }))
}

const BANDS = ["top", "bottom", "left", "right", "buttons"] as const

export interface LookMargins {
  readonly overlay: HTMLElement
  readonly controls: HTMLElement
}

const mark = (node: HTMLButtonElement, on: boolean): void => {
  node.className = `btn btn--${on ? "main" : "quiet"}`
  node.setAttribute("aria-pressed", String(on))
}

export const lookMargins = (projectId: string): LookMargins => {
  let choice = readChoice(projectId)
  const overlay = h("div", { class: "look-zones", "aria-hidden": "true" }, ...BANDS.map((band) => h("div", { class: `look-zone look-zone--${band}` })))
  const none = button("quiet", "Без полей", { click: () => { pick(NONE) } })
  const apps = APPS.map((app) => [app, button("quiet", app, { click: () => { pick({ kind: "app", app, ads: choice.kind === "app" && choice.ads }) } })] as const)
  const ads = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, "С рекламой")
  ads.addEventListener("click", () => { if (choice.kind === "app") pick({ ...choice, ads: !choice.ads }) })
  const controls = h("div", { class: "look-margins" },
    h("span", { class: "group__title", id: "look-margins-title" }, "Поля приложения"),
    h("div", { class: "seg", role: "group", "aria-labelledby": "look-margins-title" }, none, ...apps.map(([, node]) => node)),
    ads)
  const paint = (): void => {
    const platform = platformOf(choice)
    overlay.hidden = platform === undefined
    if (platform !== undefined) overlay.setAttribute("style", styleOf(platform))
    mark(none, choice.kind === "none")
    for (const [app, node] of apps) mark(node, choice.kind === "app" && choice.app === app)
    ads.hidden = choice.kind === "none"
    ads.setAttribute("aria-pressed", String(choice.kind === "app" && choice.ads))
  }
  const pick = (next: MarginsChoice): void => {
    choice = next
    keepChoice(projectId, choice)
    paint()
  }
  paint()
  return { overlay, controls }
}
