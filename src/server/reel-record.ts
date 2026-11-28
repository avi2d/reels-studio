import { Array as Arr, Effect, FileSystem, Option, Schema, type PlatformError } from "effect"
import { App } from "../shared/brief.ts"
import { hasCaptions, type Captions } from "../shared/captions.ts"
import { Face } from "../shared/face.ts"
import { visualKey, type Shown } from "../shared/inserts.ts"
import { APP_FILE_NAME, Levelling, Sheet, VideoColour, type PictureSide } from "../shared/reel.ts"
import { BuildChecks, opensDownload, type ReelChecks } from "../shared/reel-checks.ts"
import { loudnessCheck } from "./reel-checks.ts"
import { frameName } from "./reel-sheet.ts"
import { Frame, Push } from "../shared/timeline.ts"

export const Colour = Schema.Struct({ videos: Schema.Array(VideoColour), joins: Schema.Int })
export type Colour = typeof Colour.Type

export const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
export type ShownInsert = typeof ShownInsert.Type

export const PartRecord = Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int, frame: Schema.optionalKey(Frame), pushes: Schema.optionalKey(Schema.Array(Push)) })

export const CropWindow = Schema.Struct({ video: Schema.String, left: Schema.NullOr(Schema.Finite) })
export type CropWindow = typeof CropWindow.Type

const AppFile = Schema.Struct({ app: App, video: Schema.String })
type AppFile = typeof AppFile.Type

const recordFields = {
  made: Schema.String,
  parts: Schema.Array(PartRecord),
  crops: Schema.optionalKey(Schema.Array(CropWindow)),
  colour: Schema.optionalKey(Colour),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  captions: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  face: Face.pipe(Schema.withDecodingDefaultKey(Effect.succeed("off" as const))),
  levelling: Schema.optionalKey(Levelling),
  buildChecks: Schema.optionalKey(BuildChecks),
  loudnessPart: Schema.optionalKey(Schema.String),
  sheets: Schema.Array(Sheet).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])))
}
export const Record = Schema.Struct({ ...recordFields, files: Schema.NonEmptyArray(AppFile) })
export type Record = typeof Record.Type
const OneFileRecord = Schema.Struct({ ...recordFields, video: Schema.String })
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Union([Record, OneFileRecord])))
export const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(Record))

// A reel built before one file per app holds its one file, fitted to Instagram.
const decodeRecord = (text: string): Record | undefined => Option.match(decodeStored(text), {
  onNone: () => undefined,
  onSome: (stored) => {
    if ("files" in stored) return stored
    const { video, ...rest } = stored
    return { ...rest, files: [{ app: "Instagram", video }] }
  }
})

export type ReelVersion = "after" | "before"

export const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: visualKey(one.visual), start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

export const captionsKey = (captions: Captions): string => hasCaptions(captions) ? String(Bun.hash(JSON.stringify(captions))) : ""

export const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stemOf = (made: string): string => `reel-${made.replace(/:/g, "-")}`

export const videoOf = (made: string, app: App): string => `${stemOf(made)}-${APP_FILE_NAME[app]}.mp4`

export const workVideoOf = (work: string, app: App): string => `${work}/reel-${APP_FILE_NAME[app]}.mp4`

export const beforeOf = (made: string): string => `before-${made.replace(/:/g, "-")}.mp4`

export const pictureName = (join: number, side: PictureSide): string => `join-${join}-${side}.jpg`

export const pictureOf = (made: string, join: number, side: PictureSide): string => `${stemOf(made)}-${pictureName(join, side)}`

export const frameOf = (made: string, app: App, index: number): string => `${stemOf(made)}-${frameName(app, index)}`

export const recordOf = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  return decodeRecord(yield* fs.readFileString(place.record))
})

export const publishedReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const record = yield* recordOf(dir)
  if (record === undefined) return undefined
  const targets = Arr.map(record.files, (file) => ({ app: file.app, target: reelPlaces(dir).video(file.video) }))
  for (const { target } of targets) if (!(yield* fs.exists(target))) return undefined
  return { targets, record } as const
})

export const hasPublishedReel = (dir: string): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.map(publishedReel(dir), (reel) => reel !== undefined)

export const builtFace = Effect.fnUntraced(function*(dir: string) {
  return (yield* publishedReel(dir))?.record.face
})

const builtFileAt = Effect.fnUntraced(function*(dir: string, name: string) {
  const fs = yield* FileSystem.FileSystem
  const target = reelPlaces(dir).video(name)
  if (!(yield* fs.exists(target))) return undefined
  return target
})

// With no app named, the first app's file answers, as the page that shows one file asks.
export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string, version: ReelVersion, app: App | undefined) {
  if (version === "before") return yield* builtFileAt(dir, beforeOf(made))
  const record = yield* recordOf(dir)
  if (record?.made !== made) return undefined
  const file = app === undefined ? record.files[0] : record.files.find((one) => one.app === app)
  return file === undefined ? undefined : yield* builtFileAt(dir, file.video)
})

export const fileChecks = (record: Record): ReelChecks | undefined =>
  record.buildChecks === undefined ? undefined : { ...record.buildChecks, loudness: loudnessCheck(record.levelling, record.loudnessPart) }

export const reelDownloadAt = Effect.fnUntraced(function*(dir: string, made: string, app: App | undefined) {
  const reel = yield* publishedReel(dir)
  if (reel === undefined || reel.record.made !== made) return { state: "missing" } as const
  const file = app === undefined ? reel.targets[0] : reel.targets.find((one) => one.app === app)
  if (file === undefined) return { state: "missing" } as const
  return opensDownload(fileChecks(reel.record)) ? { state: "ready", target: file.target } as const : { state: "closed" } as const
})

export interface SheetFrame {
  readonly made: string
  readonly app: App
  readonly index: number
}

export const reelFrameAt = (dir: string, frame: SheetFrame): ReturnType<typeof builtFileAt> =>
  builtFileAt(dir, frameOf(frame.made, frame.app, frame.index))

export interface Picture {
  readonly made: string
  readonly join: number
  readonly side: PictureSide
}

export const reelPictureAt = Effect.fnUntraced(function*(dir: string, picture: Picture) {
  return yield* builtFileAt(dir, pictureOf(picture.made, picture.join, picture.side))
})
