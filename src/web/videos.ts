import { Effect } from "effect"
import { lengthOf, removedSpans, removedWords, skipTarget, type Span, type VideoView } from "../shared/plan.ts"
import * as Api from "./api.ts"
import { retryPair, type Retry } from "./controls.ts"
import { h } from "./dom.ts"
import { formatLength } from "./format.ts"

type Heard = Extract<VideoView, { readonly state: "ready" }>

const POLL_MS = 4000

const skipRemoved = (player: HTMLVideoElement, spans: ReadonlyArray<Span>): ((time: number) => void) => {
  let exempt: Span | undefined
  const jump = (): void => {
    if (exempt !== undefined) {
      if (player.currentTime < exempt.end) return
      exempt = undefined
    }
    const target = skipTarget(spans, player.currentTime)
    if (target !== undefined) player.currentTime = target
  }
  const watch = (): void => {
    if (player.paused || !player.isConnected) return
    jump()
    requestAnimationFrame(watch)
  }
  const playFrom = (time: number): void => {
    exempt = spans.find((span) => time >= span.start && time < span.end)
    player.currentTime = time
  }
  player.addEventListener("play", watch)
  player.addEventListener("seeked", () => {
    exempt = spans.find((span) => player.currentTime >= span.start && player.currentTime < span.end)
  })
  return playFrom
}

const heardSection = (projectId: string, video: Heard): ReadonlyArray<HTMLElement> => {
  const { duration, words } = video.transcript
  const spans = video.plan === undefined || video.plan === "unreadable" ? [] : removedSpans(video.transcript, video.plan)
  const removed = video.plan === undefined || video.plan === "unreadable" ? words.map(() => false) : removedWords(words.length, video.plan)
  const player = h("video", { class: "player", controls: true, playsinline: true, preload: "metadata", src: Api.previewUrl(projectId, video.name) })
  const playFrom = skipRemoved(player, spans)
  if (words.length === 0) return [player, h("p", { class: "muted" }, `Длина ${formatLength(duration)}. Студия не услышала в этом видео слов.`)]
  let summary: string
  if (video.plan === undefined) summary = `Длина ${formatLength(duration)}. Плана пока нет: напишите в чате, что убрать.`
  else if (video.plan === "unreadable") summary = `Длина ${formatLength(duration)}. План не удалось прочитать: попросите в чате составить его заново.`
  else if (!removed.some((struck) => struck)) summary = `Длина ${formatLength(duration)}. По плану видео остаётся целым.`
  else summary = `Длина ${formatLength(duration)}, без зачёркнутого ${formatLength(duration - lengthOf(spans))}. Зачёркнутое плеер пропускает.`
  const text = h("p", { class: "transcript" }, ...words.flatMap((word, index) => {
    const node = h("span", { class: "word", click: () => { playFrom(word.start) } }, word.text)
    return [removed[index] === true ? h("del", {}, node) : node, " "]
  }))
  return [player, h("p", { class: "muted" }, summary), text, h("p", { class: "muted" }, "Нажмите на слово, и видео перейдёт к нему.")]
}

const section = (projectId: string, video: VideoView, retry: Retry): HTMLElement => {
  const title = h("h3", {}, video.name)
  if (video.state === "ready") return h("div", { class: "video" }, title, ...heardSection(projectId, video))
  if (video.state === "waiting") {
    return h("div", { class: "video" }, title, h("p", { class: "muted", role: "status" }, "Студия слушает видео. Текст появится здесь сам через несколько минут."))
  }
  const { again, trouble } = retryPair(video.name, retry)
  const note = h("p", { class: "error", role: "alert" }, "Студия не расслышала это видео. Нажмите «Попробовать ещё раз», чтобы она послушала его снова.")
  return h("div", { class: "video" }, title, note, again, trouble)
}

export const videosCard = (projectId: string): { readonly node: HTMLElement; readonly refresh: () => void } => {
  const body = h("div", { class: "videos" })
  const node = h("section", { class: "card", hidden: true }, h("h2", {}, "Текст видео"), body)
  const shown = new Map<string, { readonly seen: string; readonly node: HTMLElement }>()
  const state = { timer: 0 }
  const later = (): void => { state.timer = Number(globalThis.setTimeout(refresh, POLL_MS)) }
  const retry: Retry = (name, onFailure) => {
    Effect.runFork(Api.retryVideo(projectId, name).pipe(
      Effect.map(() => { const old = shown.get(name); if (old !== undefined) shown.set(name, { seen: "", node: old.node }); refresh() }),
      Effect.catch((error) => Effect.sync(() => { onFailure(error.message) }))
    ))
  }
  const render = (videos: ReadonlyArray<VideoView>): void => {
    node.hidden = videos.length === 0
    for (const video of videos) {
      const seen = JSON.stringify(video)
      const old = shown.get(video.name)
      if (old?.seen === seen) continue
      const fresh = section(projectId, video, retry)
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
