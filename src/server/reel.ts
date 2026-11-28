import { Array as Arr, DateTime, Effect, FileSystem, Option } from "effect"
import { App } from "../shared/brief.ts"
import { Face } from "../shared/face.ts"
import type { Noise } from "../shared/noise.ts"
import { faceLeft } from "../shared/framing.ts"
import { APP_FILE_NAME, Levelling, LOUDNESS_TARGET, SERIES_STEP, VideoColour, type AppSize, type ColourView, type ReelView } from "../shared/reel.ts"
import { curveOf, gainsOf, levelArgs, partGainsOf, type PartLevel } from "./level-curve.ts"
import {
  joinList, lastFrameOf, partArgs, partsOf, passagesOf, pictureArgs, progressSeconds, sameParts, secondsOf, type Part, type Span
} from "./media-commands.ts"
import { clipSoundArgs, type InsertLayer } from "./insert-commands.ts"
import { insertLayerOf } from "./insert-layers.ts"
import { sampledAt } from "./loudness-meter.ts"
import { joinArgs, type Streams } from "./sound-commands.ts"
import { hasCaptions } from "../shared/captions.ts"
import { placeCaptions } from "./captions.ts"
import { finishArgs } from "./finish-commands.ts"
import { isHdrVideo, measureLoudness, measurePart, places, readGaze, shortTermLoudness, tool } from "./media-jobs.ts"
import { readFace, retouchVideo } from "./face.ts"
import { readNoise } from "./looks.ts"
import { Settings } from "./settings.ts"
import { readApps } from "./task-choices.ts"
import { colourJoins, coloursOf, gainOf, measureSkin } from "./skin.ts"
import type { Cut } from "./timeline-files.ts"
import {
  beforeOf, captionsKey, CropWindow, encodeRecord, pictureName, pictureOf, publishedReel, recorded, recordOf, reelPlaces, sameInserts, videoOf, workVideoOf,
  type Colour, type Record
} from "./reel-record.ts"

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const record = yield* recordOf(dir)
  const pictures = record?.colour === undefined
    ? []
    : Array.from({ length: record.colour.joins }, (_, index) => [pictureOf(record.made, index + 1, "before"), pictureOf(record.made, index + 1, "after")]).flat()
  const kept = new Set<string | undefined>([...record?.files.map((file) => file.video) ?? [], record?.levelling === undefined ? undefined : beforeOf(record.made), ...pictures])
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

export const renderParts = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, noise: Noise, work: string, output: string, onDone: (share: number) => Effect.Effect<void>) {
  const settings = yield* Settings
  const total = secondsOf(parts)
  const crops = yield* readCrops(dir, parts)
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const { source, look } = yield* lookOf(dir, part.video, colours, hdr, crops)
    const before = secondsOf(parts.slice(0, names.length))
    const name = partFileOf(names.length, "mov")
    yield* tool("ffmpeg", partArgs(source, part, look, noise, settings.encoder, `${work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* concatParts(work, names, output, "picture-and-sound")
  return crops
})

const measurePassages = Effect.fnUntraced(function*(work: string, levelled: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(levelled, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

const levelReel = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<PartLevel>, offset: number, output: string, streams: Streams) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const curve = `${work}/curve.txt`
  const gains = gainsOf(parts, offset)
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
const publish = Effect.fnUntraced(function*(dir: string, record: Record) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord(record))
  yield* fs.rename(`${place.work}/joined.mp4`, place.video(beforeOf(record.made)))
  for (const file of record.files) yield* fs.rename(workVideoOf(place.work, file.app), place.video(file.video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
})

export type Rendered = Part & PartLevel & { readonly name: string }

export const partFileOf = (index: number, extension: "mov" | "wav"): string => `part-${String(index + 1).padStart(3, "0")}.${extension}`

export const renderedOf = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<Part>, index: number, part: Part, name: string) {
  const [from, to] = [secondsOf(parts.slice(0, index)), secondsOf(parts.slice(0, index + 1))]
  const lufs = (yield* measurePart(`${work}/${name}`, to - from)).lufs
  return { ...part, name, from, to, lufs } satisfies Rendered
})

export const SOUND_STEPS = 5

const joinSound = Effect.fnUntraced(function*(work: string, rendered: ReadonlyArray<Rendered>, layers: ReadonlyArray<InsertLayer>, streams: Streams) {
  const joined = `${work}/joined.mp4`
  const mix = clipSoundArgs(`${work}/voice.mp4`, layers, joined, streams)
  yield* concatParts(work, rendered.map((part) => part.name), mix === undefined ? joined : `${work}/voice.mp4`, streams)
  if (mix !== undefined) yield* tool("ffmpeg", mix, (yield* Settings).heavy)
})

export const levelSound = Effect.fnUntraced(function*(
  work: string, rendered: ReadonlyArray<Rendered>, levelledFile: string, streams: Streams, soundDone: (step: number) => Effect.Effect<void>,
  layers: ReadonlyArray<InsertLayer>
) {
  const total = secondsOf(rendered)
  yield* joinSound(work, rendered, layers, streams)
  const heard = yield* measureLoudness(`${work}/joined.mp4`)
  const moments = yield* shortTermLoudness(`${work}/joined.mp4`, `${work}/moments.txt`)
  yield* soundDone(1)
  const trial = yield* levelReel(work, rendered, 0, `${work}/trial.mp4`, streams)
  yield* soundDone(2)
  const { sound: changed, gains } = yield* levelReel(work, rendered, LOUDNESS_TARGET - trial.sound.lufs, levelledFile, streams)
  yield* soundDone(3)
  const changedMoments = yield* shortTermLoudness(levelledFile, `${work}/moments-after.txt`)
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

interface Step {
  readonly from: string
  readonly to: string
}

// "same" links one encoded file under the app's name: with nothing drawn on it, every app gets the same frames.
interface AppStep extends Step {
  readonly kind: "finish" | "same"
  readonly app: App
}

interface VideoChain {
  readonly levelled: string
  readonly face: Step | undefined
  readonly apps: ReadonlyArray<AppStep>
}

// Her face is retouched before the inserts and texts go on, so no attached picture is ever retouched.
export const videoChain = (work: string, face: Face, finishing: boolean, apps: ReadonlyArray<App>): VideoChain => {
  const levelled = `${work}/levelled.mp4`
  const faceStep = face === "light" ? { from: levelled, to: `${work}/retouched.mp4` } : undefined
  const base = faceStep?.to ?? levelled
  return { levelled, face: faceStep, apps: apps.map((app) => ({ kind: finishing ? "finish" : "same", app, from: base, to: workVideoOf(work, app) })) }
}

const retouchStep = Effect.fnUntraced(function*(work: string, step: Step, frames: number, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${work}/face`
  yield* fs.makeDirectory(folder, { recursive: true })
  yield* fs.rename(yield* retouchVideo({ before: step.from, folder, frames, closeUp: false }, onDone), step.to)
})

const finishApps = Effect.fnUntraced(function*(
  work: string, steps: ReadonlyArray<AppStep>, captions: ReadonlyMap<App, string | undefined>, pictures: ReadonlyArray<InsertLayer>, total: number, progress: { readonly from: number; readonly share: number },
  onDone: (share: number) => Effect.Effect<void>
) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const appShare = progress.share / steps.length
  for (const [index, step] of steps.entries()) {
    if (step.kind === "same") {
      yield* fs.link(step.from, step.to)
      continue
    }
    const before = progress.from + appShare * index
    yield* tool("ffmpeg", finishArgs(step.from, pictures, captions.get(step.app), settings.encoder, step.to), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(before + appShare * Math.min(1, seconds / total))
    })
  }
})

const freshWork = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const { work } = reelPlaces(dir)
  yield* fs.remove(work, { recursive: true, force: true })
  yield* fs.makeDirectory(work, { recursive: true })
  yield* sweepReel(dir)
})

const encodeReel = Effect.fnUntraced(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const place = reelPlaces(dir)
  const parts = partsOf(cut.clips)
  const total = secondsOf(parts)
  const pictures = yield* Effect.forEach(cut.inserts, (insert) => insertLayerOf(dir, insert))
  const face = yield* readFace(dir)
  const noise = yield* readNoise(dir)
  const apps = yield* readApps(dir)
  const finishing = pictures.length > 0 || hasCaptions(cut.captions)
  const insertsShare = finishing ? INSERTS_SHARE : 0
  const faceShare = face === "light" ? FACE_SHARE : 0
  const partsShare = 1 - SOUND_SHARE - faceShare - insertsShare
  yield* freshWork(dir)
  const captions = new Map(yield* Effect.forEach(apps, (app) =>
    Effect.map(placeCaptions(place.work, cut.captions, total, app, APP_FILE_NAME[app]), (filter) => [app, filter] as const)))
  const colours = yield* measureColours(dir, parts, place.work)
  const crops = yield* renderParts(dir, parts, colours, noise, place.work, `${place.work}/joined.mp4`, (share) => onDone(share * partsShare))
  const joins = yield* makePictures(dir, parts, colours, new Map(), crops)
  const rendered = yield* Effect.forEach(parts, (part, index) => renderedOf(place.work, parts, index, part, partFileOf(index, "mov")))
  const chain = videoChain(place.work, face, finishing, apps)
  const { levelling } = yield* levelSound(place.work, rendered, chain.levelled, "picture-and-sound", (step) => onDone(partsShare + SOUND_SHARE * step / SOUND_STEPS), pictures)
  const frames = parts.reduce((sum, part) => sum + part.frames, 0)
  if (chain.face !== undefined) yield* retouchStep(place.work, chain.face, frames, (share) => onDone(partsShare + SOUND_SHARE + faceShare * share))
  yield* finishApps(place.work, chain.apps, captions, pictures, total, { from: 1 - insertsShare, share: insertsShare }, onDone)
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    files: Arr.map(apps, (app) => ({ app, video: videoOf(made, app) })),
    parts,
    crops,
    inserts: recorded(cut.inserts),
    captions: captionsKey(cut.captions),
    face,
    noise,
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
  const noise = yield* readNoise(dir)
  if (published === undefined) return { job, cut: seconds, face } satisfies ReelView
  const sizes = yield* Effect.forEach(published.targets, ({ app, target }) => Effect.map(fs.stat(target), (info) => ({ app, size: Number(info.size) }) satisfies AppSize))
  const { record } = published
  const crops = yield* readCrops(dir, parts)
  const apps = yield* readApps(dir)
  const sameApps = apps.length === record.files.length && apps.every((app, index) => record.files[index]?.app === app)
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    apps: sizes,
    fresh: sameApps && sameParts(record.parts, parts) && sameCrops(record.crops, crops) && sameInserts(record.inserts, recorded(cut.inserts)) && record.captions === captionsKey(cut.captions) && record.face === face && record.noise === noise,
    face: record.face,
    ...(record.colour === undefined ? {} : { colour: colourView(record.colour) }),
    ...(record.levelling === undefined ? {} : { levelling: record.levelling })
  }
  return { job, cut: seconds, face, file } satisfies ReelView
})
