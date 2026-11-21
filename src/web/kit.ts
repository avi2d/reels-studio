import "@awesome.me/webawesome/dist/components/button/button.js"
import "@awesome.me/webawesome/dist/components/icon/icon.js"
import "@awesome.me/webawesome/dist/components/option/option.js"
import "@awesome.me/webawesome/dist/components/select/select.js"
import "@awesome.me/webawesome/dist/components/switch/switch.js"
import "@awesome.me/webawesome/dist/components/tab-group/tab-group.js"
import "@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js"
import "@awesome.me/webawesome/dist/components/tab/tab.js"
import "@awesome.me/webawesome/dist/components/textarea/textarea.js"
import "@awesome.me/webawesome/dist/components/tooltip/tooltip.js"
import { registerIconLibrary } from "@awesome.me/webawesome/dist/components/icon/library.js"
import back from "lucide-static/icons/arrow-left.svg" with { type: "text" }
import fileText from "lucide-static/icons/file-text.svg" with { type: "text" }
import file from "lucide-static/icons/file.svg" with { type: "text" }
import video from "lucide-static/icons/film.svg" with { type: "text" }
import picture from "lucide-static/icons/image.svg" with { type: "text" }
import sound from "lucide-static/icons/music.svg" with { type: "text" }
import attach from "lucide-static/icons/paperclip.svg" with { type: "text" }
import send from "lucide-static/icons/arrow-up.svg" with { type: "text" }
import settings from "lucide-static/icons/settings.svg" with { type: "text" }
import grip from "lucide-static/icons/grip-vertical.svg" with { type: "text" }
import play from "lucide-static/icons/play.svg" with { type: "text" }
import redo from "lucide-static/icons/redo-2.svg" with { type: "text" }
import previous from "lucide-static/icons/skip-back.svg" with { type: "text" }
import next from "lucide-static/icons/skip-forward.svg" with { type: "text" }
import stop from "lucide-static/icons/square.svg" with { type: "text" }
import undo from "lucide-static/icons/undo-2.svg" with { type: "text" }
import close from "lucide-static/icons/x.svg" with { type: "text" }

const ICONS = { attach, back, close, document: fileText, file, grip, next, picture, play, previous, redo, send, settings, sound, stop, undo, video }

export type IconName = keyof typeof ICONS

const isIcon = (name: string): name is IconName => name in ICONS

export const startKit = (): void => {
  registerIconLibrary("default", {
    resolver: (name) => `data:image/svg+xml,${encodeURIComponent(isIcon(name) ? ICONS[name] : "")}`
  })
}
