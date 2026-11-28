import { Effect } from "effect"
import type { Face } from "../shared/face.ts"
import { retouchArgs, retouchedFrames } from "./media-commands.ts"
import { tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import { looksOf, readLooks, updateLooks } from "./looks.ts"

export const faceOf = (text: string | undefined): Face => looksOf(text).face

export const readFace = Effect.fnUntraced(function*(dir: string) {
  return (yield* readLooks(dir)).face
})

export const writeFace = Effect.fnUntraced(function*(dir: string, face: Face) {
  yield* updateLooks(dir, (looks) => ({ ...looks, face }))
})

export interface Retouch {
  readonly before: string
  readonly folder: string
  readonly frames: number
  readonly closeUp: boolean
}

// Writes `after.mp4` and `retouch.json` into the folder, and the face close-ups too when asked.
export const retouchVideo = Effect.fnUntraced(function*(retouch: Retouch, onDone: (share: number) => Effect.Effect<void>) {
  const settings = yield* Settings
  const looker = `${settings.root}/tools/gaze`
  yield* tool("uv", retouchArgs(looker, retouch, settings.encoder), settings.heavy, (line) => {
    const done = retouchedFrames(line)
    return done === undefined ? Effect.void : onDone(Math.min(1, done / Math.max(1, retouch.frames)))
  })
  return `${retouch.folder}/after.mp4`
})
