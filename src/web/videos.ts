import { Effect } from "effect"
import { lengthOf, removedSpans, removedWords, skipTarget, type Span, type VideoView } from "../shared/plan.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"

type Heard = Extract<VideoView, { readonly state: "ready" }>

const POLL_MS = 4000

const skipRemoved = (player: HTMLVideoElement, spans: ReadonlyArray<Span>): void => {
  const jump = (): void => {
    const target = skipTarget(spans, player.currentTime)
    if (target !== undefined) player.currentTime = target
  }
  const watch = (): void => {
    if (player.paused || !player.isConnected) return
    jump()
    requestAnimationFrame(watch)
  }
  player.addEventListener("play", watch)
  player.addEventListener("seeked", jump)
}

const heardSection = (projectId: string, video: Heard): ReadonlyArray<HTMLElement> => {
  const { duration, words } = video.transcript
  const spans = removedSpans(video.transcript, video.plan)
  const removed = removedWords(words.length, video.plan)
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata", src: Api.previewUrl(projectId, video.name) })
  skipRemoved(player, spans)
  if (words.length === 0) return [player, h("p", { class: "muted" }, `Длина ${formatLength(duration)}. Студия не услышала в этом видео слов.`)]
  const summary = spans.length === 0
    ? `Длина ${formatLength(duration)}. Плана пока нет: напишите в чате, что убрать.`
    : `Длина ${formatLength(duration)}, без зачёркнутого ${formatLength(duration - lengthOf(spans))}. Зачёркнутое плеер пропускает.`
  const text = h("p", { class: "transcript" }, ...words.flatMap((word, index) => {
    const node = h("span", { class: "word", click: () => { player.currentTime = word.start } }, word.text)
    return [removed[index] === true ? h("del", {}, node) : node, " "]
  }))
  return [player, h("p", { class: "muted" }, summary), text, h("p", { class: "muted" }, "Нажмите на слово, и видео перейдёт к нему.")]
}

const section = (projectId: string, video: VideoView): HTMLElement => {
  const title = h("h3", {}, video.name)
  if (video.state === "ready") return h("div", { class: "video" }, title, ...heardSection(projectId, video))
  const note = video.state === "waiting"
    ? h("p", { class: "muted", role: "status" }, "Студия слушает видео. Текст появится здесь сам через несколько минут.")
    : h("p", { class: "error", role: "alert" }, "Студия не расслышала это видео. Загрузите его ещё раз.")
  return h("div", { class: "video" }, title, note)
}

export const videosCard = (projectId: string): { readonly node: HTMLElement; readonly refresh: () => void } => {
  const body = h("div", { class: "videos" })
  const node = h("section", { class: "card", hidden: true }, h("h2", {}, "Текст видео"), body)
  const shown = new Map<string, { readonly seen: string; readonly node: HTMLElement }>()
  const state = { timer: 0 }
  const later = (): void => { state.timer = Number(globalThis.setTimeout(refresh, POLL_MS)) }
  const render = (videos: ReadonlyArray<VideoView>): void => {
    node.hidden = videos.length === 0
    for (const video of videos) {
      const seen = JSON.stringify(video)
      const old = shown.get(video.name)
      if (old?.seen === seen) continue
      const fresh = section(projectId, video)
      shown.set(video.name, { seen, node: fresh })
      if (old === undefined) body.append(fresh)
      else old.node.replaceWith(fresh)
    }
    if (videos.some((video) => video.state === "waiting")) later()
  }
  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!node.isConnected) return
    Effect.runFork(Api.getVideos(projectId).pipe(
      Effect.map(({ videos }) => { render(videos) }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }
  return { node, refresh }
}
