import { Data, DateTime, Effect, FileSystem, Option, Schema } from "effect"
import { Face } from "../shared/face.ts"
import { shapeOf, type Shown } from "../shared/inserts.ts"
import { Frame } from "../shared/timeline.ts"
import { Levelling, LOUDNESS_TARGET, SERIES_STEP, VideoColour, type ColourView, type PictureSide, type ReelView } from "../shared/reel.ts"
import { pictureProbeArgs } from "./attachment-notes.ts"
import { curveOf, gainsOf, levelArgs, partGainsOf, type PartLevel } from "./level-curve.ts"
import {
  insertArgs, joinList, lastFrameOf, partArgs, partsOf, passagesOf, pictureArgs, progressSeconds, sameParts, sampledAt, secondsOf,
  type InsertPicture, type Moment, type Part, type Span
} from "./media-commands.ts"
import { joinArgs, type Streams } from "./sound-commands.ts"
import { isHdrVideo, measureLoudness, momentaryLoudness, places, tool } from "./media-jobs.ts"
import { readFace, retouchVideo } from "./face.ts"
import { Settings } from "./settings.ts"
import { colourJoins, coloursOf, gainOf, measureSkin } from "./skin.ts"
import type { Cut } from "./timeline-files.ts"


const Colour = Schema.Struct({ videos: Schema.Array(VideoColour), joins: Schema.Int })
type Colour = typeof Colour.Type

const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
type ShownInsert = typeof ShownInsert.Type

export const PartRecord = Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int, frame: Schema.optionalKey(Frame) })

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(PartRecord),
  colour: Schema.optionalKey(Colour),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  face: Face.pipe(Schema.withDecodingDefaultKey(Effect.succeed("off" as const))),
  levelling: Schema.optionalKey(Levelling)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export type ReelVersion = "after" | "before"

const PictureProbe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({ width: Schema.optionalKey(Schema.Finite), height: Schema.optionalKey(Schema.Finite) })),
  frames: Schema.optionalKey(Schema.Array(Schema.Struct({
    side_data_list: Schema.optionalKey(Schema.Array(Schema.Struct({ rotation: Schema.optionalKey(Schema.Finite) })))
  })))
}))
const decodePictureProbe = Schema.decodeUnknownEffect(PictureProbe)

const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: one.picture, start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

class PictureUnreadable extends Data.TaggedError("PictureUnreadable")<{ readonly picture: string }> {}

const insertPictureOf = Effect.fnUntraced(function*(dir: string, insert: Shown) {
  const file = `${dir}/attached/${insert.picture}`
  const probe = yield* decodePictureProbe(yield* tool("ffprobe", pictureProbeArgs(file), []))
  const stream = probe.streams.find((one) => one.width !== undefined)
  if (stream?.width === undefined || stream.height === undefined) return yield* new PictureUnreadable({ picture: insert.picture })
  const rotation = probe.frames?.[0]?.side_data_list?.find((one) => one.rotation !== undefined)?.rotation
  const upright = rotation !== undefined && Math.abs(rotation % 180) === 90
  const width = upright ? stream.height : stream.width
  const height = upright ? stream.width : stream.height
  return { file, shape: shapeOf(width, height), width, height, start: insert.start, end: insert.end } satisfies InsertPicture
})


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

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const record = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
    : undefined
  const pictures = record?.colour === undefined
    ? []
    : Array.from({ length: record.colour.joins }, (_, index) => [pictureOf(record.made, index + 1, "before"), pictureOf(record.made, index + 1, "after")]).flat()
  const kept = new Set<string | undefined>([record?.video, record?.levelling === undefined ? undefined : beforeOf(record.made), ...pictures])
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

const lookOf = Effect.fnUntraced(function*(dir: string, video: string, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>) {
  const source = places({ dir, name: video }).source
  const tone = hdr.get(video) ?? (yield* isHdrVideo(source))
  hdr.set(video, tone)
  return { source, look: { hdr: tone, gain: gainOf(colours, video) } }
})

const makePictures = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>) {
  const settings = yield* Settings
  const work = reelPlaces(dir).work
  const joins = colours.some((colour) => colour.state === "matched") ? colourJoins(parts) : []
  for (const [index, join] of joins.entries()) {
    const end = yield* lookOf(dir, join.end.video, colours, hdr)
    const start = yield* lookOf(dir, join.start.video, colours, hdr)
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
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const { source, look } = yield* lookOf(dir, part.video, colours, hdr)
    const before = secondsOf(parts.slice(0, names.length))
    const name = partFileOf(names.length, "mov")
    yield* tool("ffmpeg", partArgs(source, part, look, settings.encoder, `${work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* concatParts(work, names, output, "picture-and-sound")
})

const measurePassages = Effect.fnUntraced(function*(work: string, levelled: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(levelled, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

// One gain curve over the whole reel, not per part, so quiet and loud passages share one target.
const levelReel = Effect.fnUntraced(function*(work: string, moments: ReadonlyArray<Moment>, parts: ReadonlyArray<PartLevel>, offset: number, output: string, streams: Streams) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const curve = `${work}/curve.txt`
  const gains = gainsOf(moments, parts, offset)
  yield* fs.writeFileString(curve, curveOf(gains))
  yield* tool("ffmpeg", levelArgs(`${work}/joined.mp4`, curve, output, streams), settings.heavy)
  return { sound: yield* measureLoudness(output), gains }
})

const concatParts = Effect.fnUntraced(function*(work: string, names: ReadonlyArray<string>, output: string, streams: Streams) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  yield* fs.writeFileString(`${work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${work}/parts.txt`, output, streams), settings.heavy)
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

export type Rendered = Part & PartLevel & { readonly name: string }

export const partFileOf = (index: number, extension: "mov" | "wav"): string => `part-${String(index + 1).padStart(3, "0")}.${extension}`

export const renderedOf = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<Part>, index: number, part: Part, name: string) {
  const lufs = (yield* measureLoudness(`${work}/${name}`)).lufs
  return { ...part, name, from: secondsOf(parts.slice(0, index)), to: secondsOf(parts.slice(0, index + 1)), lufs } satisfies Rendered
})

export const SOUND_STEPS = 5

export const levelSound = Effect.fnUntraced(function*(
  work: string, rendered: ReadonlyArray<Rendered>, levelledFile: string, streams: Streams, soundDone: (step: number) => Effect.Effect<void>
) {
  const total = secondsOf(rendered)
  yield* concatParts(work, rendered.map((part) => part.name), `${work}/joined.mp4`, streams)
  const heard = yield* measureLoudness(`${work}/joined.mp4`)
  const moments = yield* momentaryLoudness(`${work}/joined.mp4`, `${work}/moments.txt`)
  yield* soundDone(1)
  const trial = yield* levelReel(work, moments, rendered, 0, `${work}/trial.mp4`, streams)
  yield* soundDone(2)
  const { sound: changed, gains } = yield* levelReel(work, moments, rendered, LOUDNESS_TARGET - trial.sound.lufs, levelledFile, streams)
  yield* soundDone(3)
  const changedMoments = yield* momentaryLoudness(levelledFile, `${work}/moments-after.txt`)
  yield* soundDone(4)
  const passages = yield* measurePassages(work, levelledFile, passagesOf(rendered, rendered.map((part) => part.lufs)))
  yield* soundDone(5)
  const levelling = {
    before: heard.lufs,
    after: changed,
    series: { before: sampledAt(moments, SERIES_STEP, total), after: sampledAt(changedMoments, SERIES_STEP, total) },
    passages
  } satisfies Levelling
  return { levelling, parts: partGainsOf(gains, rendered) }
})

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

const encodeReel = Effect.fnUntraced(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(cut.clips)
  const total = secondsOf(parts)
  const pictures = yield* Effect.forEach(cut.inserts, (insert) => insertPictureOf(dir, insert))
  const face = yield* readFace(dir)
  const insertsShare = pictures.length === 0 ? 0 : INSERTS_SHARE
  const faceShare = face === "light" ? FACE_SHARE : 0
  const partsShare = 1 - SOUND_SHARE - faceShare - insertsShare
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  yield* sweepReel(dir)
  const colours = yield* measureColours(dir, parts, place.work)
  const joins = yield* makePictures(dir, parts, colours, new Map())
  yield* renderParts(dir, parts, colours, place.work, `${place.work}/joined.mp4`, (share) => onDone(share * partsShare))
  const rendered: Array<Rendered> = []
  for (const [index, part] of parts.entries()) {
    rendered.push(yield* renderedOf(place.work, parts, index, part, partFileOf(index, "mov")))
  }
  const chain = videoChain(place.work, face, pictures.length > 0)
  const { levelling } = yield* levelSound(place.work, rendered, chain.levelled, "picture-and-sound", (step) => onDone(partsShare + SOUND_SHARE * step / SOUND_STEPS))
  const frames = parts.reduce((sum, part) => sum + part.frames, 0)
  yield* Effect.forEach(chain.steps, (step) => step.kind === "face"
    ? retouchStep(place.work, step, frames, (share) => onDone(partsShare + SOUND_SHARE + faceShare * share))
    : tool("ffmpeg", insertArgs(step.from, pictures, settings.encoder, step.to), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(1 - insertsShare + insertsShare * Math.min(1, seconds / total))
    }), { discard: true })
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    video: videoOf(made),
    parts,
    inserts: recorded(cut.inserts),
    face,
    colour: { videos: colours, joins },
    levelling
  }
  yield* publishPictures(dir, made, joins)
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

export const readReel = Effect.fnUntraced(function*(dir: string, cut: Cut, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(cut.clips)
  const seconds = secondsOf(parts)
  const published = yield* publishedReel(dir)
  const face = yield* readFace(dir)
  if (published === undefined) return { job, cut: seconds, face } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const { record } = published
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    size,
    fresh: sameParts(record.parts, parts) && sameInserts(record.inserts, recorded(cut.inserts)) && record.face === face,
    face: record.face,
    ...(record.colour === undefined ? {} : { colour: colourView(record.colour) }),
    ...(record.levelling === undefined ? {} : { levelling: record.levelling })
  }
  return { job, cut: seconds, face, file } satisfies ReelView
})
