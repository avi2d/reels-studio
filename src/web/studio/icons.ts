import check from "lucide-static/icons/check.svg" with { type: "text" }
import left from "lucide-static/icons/chevron-left.svg" with { type: "text" }
import right from "lucide-static/icons/chevron-right.svg" with { type: "text" }
import down from "lucide-static/icons/chevron-down.svg" with { type: "text" }
import more from "lucide-static/icons/ellipsis.svg" with { type: "text" }
import film from "lucide-static/icons/film.svg" with { type: "text" }
import plus from "lucide-static/icons/plus.svg" with { type: "text" }
import retry from "lucide-static/icons/rotate-ccw.svg" with { type: "text" }
import trash from "lucide-static/icons/trash-2.svg" with { type: "text" }
import pencil from "lucide-static/icons/pencil.svg" with { type: "text" }
import upload from "lucide-static/icons/upload.svg" with { type: "text" }
import close from "lucide-static/icons/x.svg" with { type: "text" }

const ICONS = { check, close, down, film, left, more, pencil, plus, retry, right, trash, upload }

export type IconName = keyof typeof ICONS

export const icon = (name: IconName): HTMLElement => {
  const node = document.createElement("span")
  node.className = "ic"
  node.setAttribute("aria-hidden", "true")
  node.innerHTML = ICONS[name]
  return node
}
