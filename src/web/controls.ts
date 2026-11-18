import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js"
import { h, type Child, type Props } from "./dom.ts"
import type { IconName } from "./kit.ts"

const LOOKS = {
  primary: { appearance: "accent", variant: "brand" },
  normal: { appearance: "filled", variant: "neutral" },
  quiet: { appearance: "outlined", variant: "neutral" },
  plain: { appearance: "plain", variant: "neutral" },
  bright: { appearance: "accent", variant: "neutral" },
  danger: { appearance: "accent", variant: "danger" }
} as const satisfies Readonly<Record<string, { readonly appearance: WaButton["appearance"]; readonly variant: WaButton["variant"] }>>

export type Look = keyof typeof LOOKS

export const icon = (name: IconName, label?: string): HTMLElement =>
  h("wa-icon", label === undefined ? { name } : { name, label })

export const button = (look: Look, props: Props, ...children: ReadonlyArray<Child>): WaButton =>
  h("wa-button", { ...LOOKS[look], ...props }, ...children)

export const spoken = (visible: string, name: string): ReadonlyArray<Child> =>
  [h("span", { "aria-hidden": "true" }, visible), h("span", { class: "visually-hidden" }, name)]

export const iconButton = (look: Look, name: IconName, label: string, props: Props = {}): WaButton =>
  button(look, props, icon(name, label))

export const setExpanded = (target: WaButton, expanded: boolean): void => {
  const value = String(expanded)
  target.setAttribute("aria-expanded", value)
  const sync = (): void => {
    target.button?.setAttribute("aria-expanded", value)
  }
  sync()
  void (target as unknown as { readonly updateComplete?: Promise<void> }).updateComplete?.then(sync)
}

const TOOLTIP_TRIGGER = globalThis.matchMedia("(hover: hover)").matches ? "hover focus" : "manual"

export const tooltip = (target: HTMLElement, id: string, text: string): HTMLElement => {
  target.id = id
  return h("wa-tooltip", { for: id, trigger: TOOLTIP_TRIGGER }, text)
}
