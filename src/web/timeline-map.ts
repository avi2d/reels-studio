import { lengthOf } from "../shared/plan.ts"
import type { Placed } from "../shared/timeline.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"

export const cutMap = (placed: ReadonlyArray<Placed>, selected: string | undefined, select: (block: string) => void): ReadonlyArray<HTMLElement> =>
  placed.map((one, index) => {
    const length = lengthOf(one.spans)
    return h("li", { class: "map-slot", style: `flex-grow: ${Math.max(length, 1).toFixed(1)}` },
      h("button", {
        type: "button",
        class: one.block.id === selected ? "map-item selected" : "map-item",
        "data-id": one.block.id,
        "data-key": `map:${one.block.id}`,
        "aria-label": `Блок ${index + 1}. ${one.block.title}`,
        "aria-pressed": String(one.block.id === selected),
        title: `${index + 1}. ${one.block.title} · ${formatLength(length)}`,
        click: () => { select(one.block.id) }
      }, String(index + 1)))
  })
