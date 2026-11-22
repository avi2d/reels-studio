import { Effect, FileSystem, Option, Schema } from "effect"
import { Face } from "../shared/face.ts"
import { retouchArgs, retouchedFrames } from "./media-commands.ts"
import { tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const FaceFile = Schema.fromJsonString(Schema.Struct({ face: Face }))
const decodeFace = Schema.decodeUnknownOption(FaceFile)
const encodeFace = Schema.encodeEffect(FaceFile)

const faceFile = (dir: string): string => `${dir}/looks.json`

// Only her own choice changes her face, so a missing or broken file reads as off.
export const faceOf = (text: string | undefined): Face =>
  text === undefined ? "off" : Option.match(decodeFace(text), { onNone: () => "off", onSome: (written) => written.face })

export const readFace = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = faceFile(dir)
  return faceOf((yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined)
})

export const writeFace = Effect.fnUntraced(function*(dir: string, face: Face) {
  const fs = yield* FileSystem.FileSystem
  const fresh = `${faceFile(dir)}.new`
  yield* fs.writeFileString(fresh, yield* encodeFace({ face }))
  yield* fs.rename(fresh, faceFile(dir))
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
