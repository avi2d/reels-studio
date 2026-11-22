import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import type WaSelect from "@awesome.me/webawesome/dist/components/select/select.js"
import type WaSwitch from "@awesome.me/webawesome/dist/components/switch/switch.js"
import { iconButton } from "./controls.ts"
import { h } from "./dom.ts"
import { FRAME, PLATFORMS, ZONES, type Platform } from "../shared/zones.ts"

const across = (pixels: number): string => `${(pixels / FRAME.width * 100).toFixed(2)}%`
const down = (pixels: number): string => `${(pixels / FRAME.height * 100).toFixed(2)}%`

export const styleOf = (platform: Platform): string => {
  const { top, bottom, left, right, buttons } = ZONES[platform].bands
  const column = buttons ?? { left: FRAME.width - right, top }
  return `--top: ${down(top)}; --bottom: ${down(bottom)}; --left: ${across(left)}; --right: ${across(right)}; --buttons-left: ${across(column.left)}; --buttons-top: ${down(column.top)}`
}

export interface Margins {
  readonly overlay: HTMLElement
  readonly gear: WaButton
  readonly panel: HTMLDialogElement
}

const BANDS = ["top", "bottom", "left", "right", "buttons"] as const

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
    value: "0",
    change: () => { overlay.setAttribute("style", styleOf(PLATFORMS[Number(pick.value)] ?? PLATFORMS[0])) }
  }, ...PLATFORMS.map((name, index) => h("wa-option", { value: String(index) }, name)))
  const panel = h("dialog", { class: "settings", "aria-labelledby": "settings-title" },
    h("form", { class: "settings-head", method: "dialog" },
      h("h2", { id: "settings-title" }, "Настройки"),
      iconButton("plain", "close", "Закрыть настройки", { type: "submit" })),
    h("div", { class: "zone-bar" }, toggle, pick))
  const gear = iconButton("plain", "settings", "Настройки", { class: "gear", click: () => { panel.showModal() } })
  return { overlay, gear, panel }
}
