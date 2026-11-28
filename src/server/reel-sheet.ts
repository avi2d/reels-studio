import { Effect, FileSystem } from "effect"
import type { App } from "../shared/brief.ts"
import { coveredSpans, sheetTimes } from "../shared/face-cover.ts"
import { APP_FILE_NAME, type Sheet } from "../shared/reel.ts"
import { frameArgs } from "./media-commands.ts"
import { measureHeads, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

export const frameName = (app: App, index: number): string => `frame-${APP_FILE_NAME[app]}-${index + 1}.jpg`

export const layFrames = Effect.fnUntraced(function*(work: string, app: App, video: string, seconds: number, onDone: (share: number) => Effect.Effect<void>) {
  const settings = yield* Settings
  const covered = yield* measureHeads(video, `${work}/faces-${APP_FILE_NAME[app]}.json`).pipe(
    Effect.map((gaze) => coveredSpans(gaze, seconds, app)),
    Effect.catch((error) => Effect.as(Effect.logError("the face in the built reel was not looked for", app, error), undefined))
  )
  const frames = sheetTimes(seconds, covered ?? [])
  for (const [index, time] of frames.entries()) {
    yield* onDone(index / frames.length)
    yield* tool("ffmpeg", frameArgs(video, time, `${work}/${frameName(app, index)}`), settings.heavy)
  }
  return (covered === undefined ? { app, frames } : { app, frames, covered }) satisfies Sheet
})

export const moveFrames = Effect.fnUntraced(function*(work: string, sheet: Sheet, target: (index: number) => string) {
  const fs = yield* FileSystem.FileSystem
  for (const index of sheet.frames.keys()) yield* fs.rename(`${work}/${frameName(sheet.app, index)}`, target(index))
})
