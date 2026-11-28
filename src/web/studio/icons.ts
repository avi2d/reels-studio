import check from "lucide-static/icons/check.svg" with { type: "text" }
import left from "lucide-static/icons/chevron-left.svg" with { type: "text" }
import right from "lucide-static/icons/chevron-right.svg" with { type: "text" }
import down from "lucide-static/icons/chevron-down.svg" with { type: "text" }
import download from "lucide-static/icons/download.svg" with { type: "text" }
import more from "lucide-static/icons/ellipsis.svg" with { type: "text" }
import film from "lucide-static/icons/film.svg" with { type: "text" }
import plus from "lucide-static/icons/plus.svg" with { type: "text" }
import retry from "lucide-static/icons/rotate-ccw.svg" with { type: "text" }
import trash from "lucide-static/icons/trash-2.svg" with { type: "text" }
import pencil from "lucide-static/icons/pencil.svg" with { type: "text" }
import pin from "lucide-static/icons/pin.svg" with { type: "text" }
import upload from "lucide-static/icons/upload.svg" with { type: "text" }
import close from "lucide-static/icons/x.svg" with { type: "text" }
import chat from "lucide-static/icons/message-square.svg" with { type: "text" }
import attach from "lucide-static/icons/paperclip.svg" with { type: "text" }
import file from "lucide-static/icons/file-text.svg" with { type: "text" }
import send from "lucide-static/icons/arrow-up.svg" with { type: "text" }
import stop from "lucide-static/icons/square.svg" with { type: "text" }
import play from "lucide-static/icons/play.svg" with { type: "text" }
import undo from "lucide-static/icons/undo-2.svg" with { type: "text" }
import redo from "lucide-static/icons/redo-2.svg" with { type: "text" }
import up from "lucide-static/icons/arrow-up.svg" with { type: "text" }
import lower from "lucide-static/icons/arrow-down.svg" with { type: "text" }

const ICONS = { attach, chat, check, close, down, download, file, film, left, lower, more, pencil, pin, play, plus, redo, retry, right, send, stop, trash, undo, up, upload }

export type IconName = keyof typeof ICONS

export const icon = (name: IconName): HTMLElement => {
  const node = document.createElement("span")
  node.className = "ic"
  node.setAttribute("aria-hidden", "true")
  node.innerHTML = ICONS[name]
  return node
}
