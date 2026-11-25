import check from "lucide-static/icons/check.svg" with { type: "text" }
import left from "lucide-static/icons/chevron-left.svg" with { type: "text" }
import right from "lucide-static/icons/chevron-right.svg" with { type: "text" }
import more from "lucide-static/icons/ellipsis.svg" with { type: "text" }
import film from "lucide-static/icons/film.svg" with { type: "text" }
import plus from "lucide-static/icons/plus.svg" with { type: "text" }
import trash from "lucide-static/icons/trash-2.svg" with { type: "text" }

const ICONS = { check, film, left, more, plus, right, trash }

export type IconName = keyof typeof ICONS

export const icon = (name: IconName): HTMLElement => {
  const node = document.createElement("span")
  node.className = "ic"
  node.setAttribute("aria-hidden", "true")
  node.innerHTML = ICONS[name]
  return node
}
