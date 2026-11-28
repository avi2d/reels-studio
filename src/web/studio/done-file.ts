import { DOWNLOAD_CLOSED, opensDownload } from "../../shared/reel-checks.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { factsOf, soundLineOf, type File } from "./done-model.ts"
import { icon } from "./icons.ts"
import { button } from "./ui.ts"

const SAVE_HINT = "На айфоне откройте скачанный файл и выберите «Сохранить видео»: ролик появится в «Фото», и Instagram его найдёт."
const LISTEN = "Послушать до и после"

type Version = "before" | "after"

export interface ReelFile {
  readonly node: HTMLElement
  readonly paint: (file: File, stale: boolean) => void
  readonly pause: () => void
}

export const reelFile = (projectId: string): ReelFile => {
  const state: { made: string | undefined } = { made: undefined }
  const player = h("video", { class: "done-player", controls: true, playsinline: true, preload: "metadata" })
  const versions = { before: button("quiet", "До"), after: button("main", "После") }
  const listen = h("div", { class: "done-listen" },
    h("span", { class: "group__title", id: "done-listen" }, LISTEN),
    h("div", { class: "seg", role: "group", "aria-labelledby": "done-listen" }, versions.before, versions.after))
  const sound = h("p", { class: "done-sound" })
  const facts = h("p", { class: "hint" })
  const download = h("a", { class: "btn btn--main btn--start", download: "" }, icon("download"), "Скачать")
  const closed = h("p", { class: "done-closed", hidden: true }, DOWNLOAD_CLOSED)
  const save = h("p", { class: "hint" }, SAVE_HINT)
  const node = h("div", { class: "done-file", hidden: true },
    h("div", { class: "done-viewer" }, player, listen),
    h("div", { class: "done-about" }, sound, facts, closed, download, save))

  const mark = (version: Version): void => {
    for (const [name, control] of [["before", versions.before], ["after", versions.after]] as const) {
      control.className = `btn btn--${name === version ? "main" : "quiet"}`
      control.setAttribute("aria-pressed", String(name === version))
    }
  }

  // Switching the source restarts the video, so the same file keeps its place and keeps playing.
  const load = (made: string, version: Version): void => {
    const at = player.currentTime
    const playing = !player.paused
    mark(version)
    if (state.made === made) {
      player.addEventListener("loadedmetadata", () => {
        player.currentTime = at
        if (playing) void player.play().catch(() => undefined)
      }, { once: true })
    }
    state.made = made
    player.src = Api.reelUrl(projectId, made, version)
  }

  for (const version of ["before", "after"] as const) {
    versions[version].addEventListener("click", () => { if (state.made !== undefined) load(state.made, version) })
  }
  mark("after")

  return {
    node,
    paint: (file, stale) => {
      const downloadOpen = opensDownload(file.checks)
      download.hidden = !downloadOpen
      save.hidden = !downloadOpen
      closed.hidden = downloadOpen || file.checks === undefined
      if (downloadOpen) download.href = Api.reelDownloadUrl(projectId, file.made)
      else download.removeAttribute("href")
      if (state.made !== file.made) load(file.made, "after")
      sound.textContent = soundLineOf(file)
      listen.hidden = file.levelling === undefined
      facts.textContent = factsOf(file)
      download.className = `btn btn--${stale ? "quiet" : "main"} btn--start`
    },
    pause: () => { player.pause() }
  }
}
