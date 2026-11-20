import type WaSelect from "@awesome.me/webawesome/dist/components/select/select.js"
import type WaSwitch from "@awesome.me/webawesome/dist/components/switch/switch.js"
import { h } from "./dom.ts"

export const PLATFORMS = ["Instagram", "YouTube Shorts", "TikTok"] as const
export type Platform = (typeof PLATFORMS)[number]

export interface Cover {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export const COVER_PERCENT = {
  Instagram: { top: 14, bottom: 35, left: 6, right: 6 },
  "YouTube Shorts": { top: 10, bottom: 20, left: 6, right: 12 },
  TikTok: { top: 10, bottom: 20, left: 6, right: 15 }
} as const satisfies Readonly<Record<Platform, Cover>>

export const styleOf = (platform: Platform): string => {
  const cover = COVER_PERCENT[platform]
  return `--top: ${cover.top}%; --bottom: ${cover.bottom}%; --left: ${cover.left}%; --right: ${cover.right}%`
}

export interface Margins {
  readonly overlay: HTMLElement
  readonly controls: HTMLElement
}

const BANDS = ["top", "bottom", "left", "right"] as const

export const margins = (): Margins => {
  const overlay = h("div", { class: "zones", "aria-hidden": "true", style: styleOf(PLATFORMS[0]) },
    ...BANDS.map((band) => h("div", { class: `zone zone-${band}` })))
  const toggle: WaSwitch = h("wa-switch", {
    name: "zones",
    checked: true,
    change: () => { overlay.hidden = !toggle.checked }
  }, "Поля площадки")
  const pick: WaSelect = h("wa-select", {
    name: "platform",
    label: "Площадка",
    size: "s",
    value: PLATFORMS[0],
    change: () => { overlay.setAttribute("style", styleOf(PLATFORMS.find((name) => name === pick.value) ?? PLATFORMS[0])) }
  }, ...PLATFORMS.map((name) => h("wa-option", { value: name }, name)))
  return { overlay, controls: h("div", { class: "zone-bar" }, toggle, pick) }
}
