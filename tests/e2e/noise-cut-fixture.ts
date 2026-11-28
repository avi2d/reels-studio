import { montage } from "../../src/web/montage.ts"

const playing = new Set<HTMLMediaElement>()
HTMLMediaElement.prototype.play = function(this: HTMLMediaElement): Promise<void> {
  playing.add(this)
  return Promise.resolve()
}
HTMLMediaElement.prototype.pause = function(this: HTMLMediaElement): void {
  playing.delete(this)
}

const frames: Array<FrameRequestCallback> = []
window.requestAnimationFrame = (callback) => frames.push(callback)
const advance = (): void => {
  const frame = frames.shift()
  if (frame === undefined) throw new Error("No playback frame queued")
  frame(0)
}

const player = montage("noise-cut", () => {}, () => 0, () => undefined)
document.body.append(player.node)
const first = { video: "first.mp4", block: "first", start: 0, end: 1 }
const second = { video: "second.mp4", block: "second", start: 0, end: 1 }
player.show(first)
player.play([first, second])
const video = (name: string): HTMLVideoElement => {
  const node = player.node.querySelector<HTMLVideoElement>(`video[data-video="${name}"]`)
  if (node === null) throw new Error(`Missing ${name}`)
  return node
}
const outgoing = video(first.video)
const incoming = video(second.video)
let incomingReady = false
Object.defineProperties(outgoing, { readyState: { get: () => 2 }, currentTime: { value: first.end, writable: true } })
Object.defineProperties(incoming, { readyState: { get: () => incomingReady ? 2 : 0 }, currentTime: { value: 0, writable: true } })

const voices = (): ReadonlyArray<string | undefined> => [...playing].map((node) => node.dataset.video)
const beforeCut = voices()
advance()
player.source((name) => `/cleaned/${name}`)
outgoing.dispatchEvent(new Event("loadeddata"))
const duringCut = voices()
incomingReady = true
incoming.dispatchEvent(new Event("loadeddata"))
advance()
document.body.textContent = JSON.stringify({ beforeCut, duringCut, afterCut: voices() })
player.stop()
