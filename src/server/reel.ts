import { DateTime, Effect, FileSystem, Option, Schema, type PlatformError } from "effect"
import { Face } from "../shared/face.ts"
import { faceLeft } from "../shared/framing.ts"
import { visualKey, type Shown } from "../shared/inserts.ts"
import { Frame, Push } from "../shared/timeline.ts"
import { Levelling, Sheet, VideoColour, type ColourView, type PictureSide, type ReelView } from "../shared/reel.ts"
import type { ReelChecks } from "../shared/reel-checks.ts"
import { lastFrameOf, partArgs, partsOf, pictureArgs, progressSeconds, sameParts, secondsOf, type Part } from "./media-commands.ts"
import { insertLayerOf } from "./insert-layers.ts"
import { hasCaptions, type Captions } from "../shared/captions.ts"
import { placeCaptions } from "./captions.ts"
import { finishArgs } from "./finish-commands.ts"
import { isHdrVideo, places, readGaze, tool } from "./media-jobs.ts"
import { readFace, retouchVideo } from "./face.ts"
import { Settings } from "./settings.ts"
import { concatParts, levelSound, partFileOf, renderedOf, SOUND_STEPS, type Rendered } from "./reel-sound.ts"
import { frameName, layFrames, moveFrames } from "./reel-sheet.ts"
import { colourJoins, coloursOf, gainOf, measureSkin } from "./skin.ts"
import type { Cut } from "./timeline-files.ts"


const Colour = Schema.Struct({ videos: Schema.Array(VideoColour), joins: Schema.Int })
type Colour = typeof Colour.Type

const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
type ShownInsert = typeof ShownInsert.Type

export const PartRecord = Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int, frame: Schema.optionalKey(Frame), pushes: Schema.optionalKey(Schema.Array(Push)) })

const CropWindow = Schema.Struct({ video: Schema.String, left: Schema.NullOr(Schema.Finite) })
type CropWindow = typeof CropWindow.Type

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(PartRecord),
  crops: Schema.optionalKey(Schema.Array(CropWindow)),
  colour: Schema.optionalKey(Colour),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  captions: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  face: Face.pipe(Schema.withDecodingDefaultKey(Effect.succeed("off" as const))),
  levelling: Schema.optionalKey(Levelling),
  sheet: Schema.optionalKey(Sheet)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export type ReelVersion = "after" | "before"

const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: visualKey(one.visual), start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

const captionsKey = (captions: Captions): string => hasCaptions(captions) ? String(Bun.hash(JSON.stringify(captions))) : ""

const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stemOf = (made: string): string => `reel-${made.replace(/:/g, "-")}`

export const videoOf = (made: string): string => `${stemOf(made)}.mp4`

const beforeOf = (made: string): string => `before-${made.replace(/:/g, "-")}.mp4`

const pictureName = (join: number, side: PictureSide): string => `join-${join}-${side}.jpg`

const pictureOf = (made: string, join: number, side: PictureSide): string => `${stemOf(made)}-${pictureName(join, side)}`

const frameOf = (made: string, index: number): string => `${stemOf(made)}-${frameName(index)}`

const publishedReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  const record = Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
  if (record === undefined) return undefined
  const target = place.video(record.video)
  if (!(yield* fs.exists(target))) return undefined
  return { target, record } as const
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

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string, version: ReelVersion) {
  return yield* builtFileAt(dir, version === "before" ? beforeOf(made) : videoOf(made))
})

export const reelPictureAt = Effect.fnUntraced(function*(dir: string, made: string, join: number, side: PictureSide) {
  return yield* builtFileAt(dir, pictureOf(made, join, side))
})

export const reelFrameAt = Effect.fnUntraced(function*(dir: string, made: string, index: number) {
  return yield* builtFileAt(dir, frameOf(made, index))
})

export const builtSound = Effect.fnUntraced(function*(dir: string) {
  const record = (yield* publishedReel(dir))?.record
  return record === undefined ? undefined : { seconds: secondsOf(record.parts), levelling: record.levelling }
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const record = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
    : undefined
  const pictures = record?.colour === undefined
    ? []
    : Array.from({ length: record.colour.joins }, (_, index) => [pictureOf(record.made, index + 1, "before"), pictureOf(record.made, index + 1, "after")]).flat()
  const frames = record?.sheet?.frames.map((_, index) => frameOf(record.made, index)) ?? []
  const kept = new Set<string | undefined>([record?.video, record?.levelling === undefined ? undefined : beforeOf(record.made), ...pictures, ...frames])
  if (!(yield* fs.exists(`${dir}/reel`))) return
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    (name.endsWith(".mp4") || name.endsWith(".jpg")) && !kept.has(name)
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

// The first video of the cut with a face, in cut order, is the one the others are brought to.
const measureColours = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, work: string) {
  const videos = [...new Set(parts.map((part) => part.video))]
  return coloursOf(yield* Effect.forEach(videos, (video) => Effect.map(measureSkin({ dir, name: video }, work), (skin) => ({ video, skin }))))
})

const readCrops = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>) {
  return yield* Effect.forEach([...new Set(parts.map((part) => part.video))], (video) => Effect.gen(function*() {
    const gaze = Option.getOrUndefined(yield* Effect.option(readGaze({ dir, name: video })))
    const left = gaze?.aspect === undefined ? undefined : faceLeft(gaze.heads, gaze.aspect)
    return { video, left: left ?? null } satisfies CropWindow
  }))
})

const sameCrops = (built: ReadonlyArray<CropWindow> | undefined, current: ReadonlyArray<CropWindow>): boolean =>
  built !== undefined && built.length === current.length && built.every((crop, index) =>
    crop.video === current[index]?.video && crop.left === current[index].left)

const lookOf = Effect.fnUntraced(function*(dir: string, video: string, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>, crops: ReadonlyArray<CropWindow>) {
  const source = places({ dir, name: video }).source
  const tone = hdr.get(video) ?? (yield* isHdrVideo(source))
  hdr.set(video, tone)
  return { source, look: { hdr: tone, gain: gainOf(colours, video), faceLeft: crops.find((crop) => crop.video === video)?.left ?? undefined } }
})

const makePictures = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>, crops: ReadonlyArray<CropWindow>) {
  const settings = yield* Settings
  const work = reelPlaces(dir).work
  const joins = colours.some((colour) => colour.state === "matched") ? colourJoins(parts) : []
  for (const [index, join] of joins.entries()) {
    const end = yield* lookOf(dir, join.end.video, colours, hdr, crops)
    const start = yield* lookOf(dir, join.start.video, colours, hdr, crops)
    const sides = [
      ["before", { ...end.look, gain: undefined }, { ...start.look, gain: undefined }],
      ["after", end.look, start.look]
    ] as const
    for (const [side, left, right] of sides) {
      const shots = [{ source: end.source, time: lastFrameOf(join.end), look: left }, { source: start.source, time: join.start.start, look: right }] as const
      yield* tool("ffmpeg", pictureArgs(shots[0], shots[1], `${work}/${pictureName(index + 1, side)}`), settings.heavy)
    }
  }
  return joins.length
})

const publishPictures = Effect.fnUntraced(function*(dir: string, made: string, joins: number) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  for (let join = 1; join <= joins; join++) {
    for (const side of ["before", "after"] as const) yield* fs.rename(`${place.work}/${pictureName(join, side)}`, place.video(pictureOf(made, join, side)))
  }
})

export const renderParts = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, work: string, output: string, onDone: (share: number) => Effect.Effect<void>) {
  const settings = yield* Settings
  const total = secondsOf(parts)
  const crops = yield* readCrops(dir, parts)
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const { source, look } = yield* lookOf(dir, part.video, colours, hdr, crops)
    const before = secondsOf(parts.slice(0, names.length))
    const name = partFileOf(names.length, "mov")
    yield* tool("ffmpeg", partArgs(source, part, look, settings.encoder, `${work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* concatParts(work, names, output, "picture-and-sound")
  return crops
})

// Written last: the record names only files that are already whole.
const publish = Effect.fnUntraced(function*(dir: string, record: typeof Record.Type) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord(record))
  yield* fs.rename(`${place.work}/joined.mp4`, place.video(beforeOf(record.made)))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(record.video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
})

const SHEET_SHARE = 0.05
const SOUND_SHARE = 0.2
const FACE_SHARE = 0.4
const INSERTS_SHARE = 0.25

type VideoStep =
  | { readonly kind: "face"; readonly from: string; readonly to: string }
  | { readonly kind: "inserts"; readonly from: string; readonly to: string }

interface VideoChain {
  readonly levelled: string
  readonly steps: ReadonlyArray<VideoStep>
}

// Her face is retouched before the inserts go on, so no attached picture is ever retouched.
export const videoChain = (work: string, face: Face, inserts: boolean): VideoChain => {
  const reel = `${work}/reel.mp4`
  const retouched = `${work}/retouched.mp4`
  const levelled = face === "off" && !inserts ? reel : `${work}/levelled.mp4`
  const faceStep: ReadonlyArray<VideoStep> = face === "light" ? [{ kind: "face", from: levelled, to: inserts ? retouched : reel }] : []
  const insertStep: ReadonlyArray<VideoStep> = inserts ? [{ kind: "inserts", from: face === "light" ? retouched : levelled, to: reel }] : []
  return { levelled, steps: [...faceStep, ...insertStep] }
}

const retouchStep = Effect.fnUntraced(function*(work: string, step: VideoStep, frames: number, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${work}/face`
  yield* fs.makeDirectory(folder, { recursive: true })
  yield* fs.rename(yield* retouchVideo({ before: step.from, folder, frames, closeUp: false }, onDone), step.to)
})

const freshWork = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const { work } = reelPlaces(dir)
  yield* fs.remove(work, { recursive: true, force: true })
  yield* fs.makeDirectory(work, { recursive: true })
  yield* sweepReel(dir)
})

const encodeReel = Effect.fnUntraced(function*(dir: string, cut: Cut, onAll: (share: number) => Effect.Effect<void>) {
  const onDone = (share: number): Effect.Effect<void> => onAll(share * (1 - SHEET_SHARE))
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(cut.clips)
  const total = secondsOf(parts)
  const pictures = yield* Effect.forEach(cut.inserts, (insert) => insertLayerOf(dir, insert))
  const face = yield* readFace(dir)
  const finishing = pictures.length > 0 || hasCaptions(cut.captions)
  const insertsShare = finishing ? INSERTS_SHARE : 0
  const faceShare = face === "light" ? FACE_SHARE : 0
  const partsShare = 1 - SOUND_SHARE - faceShare - insertsShare
  yield* freshWork(dir)
  const captions = yield* placeCaptions(place.work, cut.captions, total)
  const colours = yield* measureColours(dir, parts, place.work)
  const crops = yield* renderParts(dir, parts, colours, place.work, `${place.work}/joined.mp4`, (share) => onDone(share * partsShare))
  const joins = yield* makePictures(dir, parts, colours, new Map(), crops)
  const rendered: Array<Rendered> = []
  for (const [index, part] of parts.entries()) {
    rendered.push(yield* renderedOf(place.work, parts, index, part, partFileOf(index, "mov")))
  }
  const chain = videoChain(place.work, face, finishing)
  const { levelling } = yield* levelSound(place.work, rendered, chain.levelled, "picture-and-sound", (step) => onDone(partsShare + SOUND_SHARE * step / SOUND_STEPS), pictures)
  const frames = parts.reduce((sum, part) => sum + part.frames, 0)
  yield* Effect.forEach(chain.steps, (step) => step.kind === "face"
    ? retouchStep(place.work, step, frames, (share) => onDone(partsShare + SOUND_SHARE + faceShare * share))
    : tool("ffmpeg", finishArgs(step.from, pictures, captions, settings.encoder, step.to), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(1 - insertsShare + insertsShare * Math.min(1, seconds / total))
    }), { discard: true })
  const sheet = yield* layFrames(place.work, `${place.work}/reel.mp4`, total, (share) => onAll(1 - SHEET_SHARE + SHEET_SHARE * share))
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    video: videoOf(made),
    parts,
    crops,
    inserts: recorded(cut.inserts),
    captions: captionsKey(cut.captions),
    face,
    colour: { videos: colours, joins },
    levelling,
    sheet
  }
  yield* publishPictures(dir, made, joins)
  yield* moveFrames(place.work, sheet, (index) => place.video(frameOf(made, index)))
  yield* publish(dir, record)
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = Effect.andThen(
    fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
      Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
    ),
    sweepReel(dir).pipe(
      Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
    )
  )
  yield* encodeReel(dir, cut, onDone).pipe(Effect.ensuring(cleanup))
})

const colourView = (colour: Colour): ColourView => ({
  joins: colour.joins,
  matched: colour.videos.filter((video) => video.state === "matched").length,
  unmeasured: colour.videos.filter((video) => video.state === "unmeasured").length
})

export const readReel = Effect.fnUntraced(function*(dir: string, cut: Cut, job: ReelView["job"], checks: ReelChecks) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(cut.clips)
  const seconds = secondsOf(parts)
  const published = yield* publishedReel(dir)
  const face = yield* readFace(dir)
  if (published === undefined) return { job, cut: seconds, face, checks } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const { record } = published
  const crops = yield* readCrops(dir, parts)
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    size,
    fresh: sameParts(record.parts, parts) && sameCrops(record.crops, crops) && sameInserts(record.inserts, recorded(cut.inserts)) && record.captions === captionsKey(cut.captions) && record.face === face,
    face: record.face,
    ...(record.colour === undefined ? {} : { colour: colourView(record.colour) }),
    ...(record.levelling === undefined ? {} : { levelling: record.levelling }),
    ...(record.sheet === undefined ? {} : { sheet: record.sheet })
  }
  return { job, cut: seconds, face, checks, file } satisfies ReelView
})
