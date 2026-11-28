import type { App } from "../../shared/brief.ts"
import { DOWNLOAD_CLOSED, opensDownload } from "../../shared/reel-checks.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { appOf, downloadLabel, factsOf, saveHintOf, type File } from "./done-model.ts"
import { postPanel } from "./done-post.ts"
import { appTabs } from "./done-tabs.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

const REBUILD_TO_DOWNLOAD = "Для скачивания соберите ролик заново."

export interface ReelFile {
  readonly node: HTMLElement
  readonly downloadAll: HTMLButtonElement
  readonly paint: (file: File, stale: boolean) => void
  readonly pause: () => void
  readonly dispose: () => void
}

// Each link is clicked inside the press itself, since a browser refuses a download a timer starts.
const downloadEach = (urls: ReadonlyArray<string>): void => {
  for (const url of urls) {
    const link = h("a", { href: url, download: "", hidden: true })
    document.body.append(link)
    link.click()
    link.remove()
  }
}

export const reelFile = (projectId: string): ReelFile => {
  const state: { file: File | undefined; app: App | undefined } = { file: undefined, app: undefined }
  const player = h("video", { class: "done-player", controls: true, playsinline: true, preload: "metadata" })
  const facts = h("p", { class: "hint" })
  const download = h("a", { class: "btn btn--main btn--start", download: "" })
  const closed = h("p", { class: "done-closed", hidden: true })
  const saveHint = h("p", { class: "hint" })
  const post = postPanel(projectId)
  const downloadAll = button("main", "Скачать все", {}, "download")
  const tabs = appTabs((app) => { choose(app) })
  const node = h("div", { class: "done-file", hidden: true }, tabs.node,
    h("div", { class: "done-pane", role: "tabpanel", "aria-label": "Ролик" },
      h("div", { class: "done-viewer" }, player),
      h("div", { class: "done-about" }, facts, closed, download, saveHint, post.node)))

  // Switching the source restarts the video, so another app's file of the same build keeps its place and keeps playing.
  const load = (file: File, app: App): void => {
    const same = state.file?.made === file.made
    const at = player.currentTime
    const playing = !player.paused
    if (same) {
      player.addEventListener("loadedmetadata", () => {
        player.currentTime = at
        if (playing) void player.play().catch(() => undefined)
      }, { once: true })
    }
    player.src = Api.reelUrl(projectId, file.made, "after", app)
  }

  const paintApp = (file: File, app: App): void => {
    tabs.mark(app)
    facts.textContent = factsOf(file, app)
    download.replaceChildren(icon("download"), downloadLabel(file, app))
    const open = opensDownload(file.checks)
    download.hidden = !open
    saveHint.hidden = !open
    closed.hidden = open
    closed.textContent = file.checks === undefined ? REBUILD_TO_DOWNLOAD : DOWNLOAD_CLOSED
    if (open) download.href = Api.reelDownloadUrl(projectId, file.made, app)
    else download.removeAttribute("href")
    saveHint.textContent = saveHintOf(app)
    post.show(app)
  }

  const choose = (app: App): void => {
    const file = state.file
    if (file === undefined || state.app === app) return
    load(file, app)
    state.app = app
    paintApp(file, app)
  }

  downloadAll.addEventListener("click", () => {
    const file = state.file
    if (file !== undefined && opensDownload(file.checks)) downloadEach(file.apps.map((one) => Api.reelDownloadUrl(projectId, file.made, one.app)))
  })

  return {
    node,
    downloadAll,
    paint: (file, stale) => {
      tabs.draw(file.apps.map((one) => one.app))
      const app = appOf(file, state.app)
      if (state.file?.made !== file.made || state.app !== app) load(file, app)
      state.file = file
      state.app = app
      paintApp(file, app)
      download.className = `btn btn--${stale || file.apps.length > 1 ? "quiet" : "main"} btn--start`
      downloadAll.hidden = file.apps.length < 2 || !opensDownload(file.checks)
      downloadAll.className = `btn btn--${stale ? "quiet" : "main"}`
    },
    pause: () => { player.pause() },
    dispose: () => {
      player.pause()
      post.flush()
    }
  }
}
