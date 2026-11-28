import { Effect, FileSystem, Option, Schema } from "effect"
import { Face } from "../shared/face.ts"
import { Noise, NOISE_DEFAULT } from "../shared/noise.ts"
import { retouchArgs, retouchedFrames } from "./media-commands.ts"
import { tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const FaceFile = Schema.fromJsonString(Schema.Struct({ face: Face }))
const decodeFace = Schema.decodeUnknownOption(FaceFile)
const NoiseFile = Schema.fromJsonString(Schema.Struct({ noise: Noise }))
const decodeNoise = Schema.decodeUnknownOption(NoiseFile)
const LooksFile = Schema.fromJsonString(Schema.Struct({ face: Face, noise: Noise }))
const encodeLooks = Schema.encodeEffect(LooksFile)

const looksFile = (dir: string): string => `${dir}/looks.json`

// Only her own choice changes her face, so a missing or broken file reads as off.
export const faceOf = (text: string | undefined): Face =>
  text === undefined ? "off" : Option.match(decodeFace(text), { onNone: () => "off", onSome: (written) => written.face })

export const noiseOf = (text: string | undefined): Noise =>
  text === undefined ? NOISE_DEFAULT : Option.match(decodeNoise(text), { onNone: () => NOISE_DEFAULT, onSome: (written) => written.noise })

const readLooks = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = looksFile(dir)
  const text = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined
  return { face: faceOf(text), noise: noiseOf(text) }
})

export const readFace = Effect.fnUntraced(function*(dir: string) {
  return (yield* readLooks(dir)).face
})

export const readNoise = Effect.fnUntraced(function*(dir: string) {
  return (yield* readLooks(dir)).noise
})

const writeLooks = Effect.fnUntraced(function*(dir: string, change: { readonly face?: Face; readonly noise?: Noise }) {
  const fs = yield* FileSystem.FileSystem
  const fresh = `${looksFile(dir)}.new`
  yield* fs.writeFileString(fresh, yield* encodeLooks({ ...(yield* readLooks(dir)), ...change }))
  yield* fs.rename(fresh, looksFile(dir))
})

export const writeFace = Effect.fnUntraced(function*(dir: string, face: Face) {
  yield* writeLooks(dir, { face })
})

export const writeNoise = Effect.fnUntraced(function*(dir: string, noise: Noise) {
  yield* writeLooks(dir, { noise })
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
