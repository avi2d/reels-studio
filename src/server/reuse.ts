import { Crypto, Effect, FileSystem, Option, type PlatformError, Predicate } from "effect"
import type { LibraryVideo } from "../shared/library.ts"
import { badRequest } from "./api-error.ts"
import { gazeText, transcriptText } from "./media-commands.ts"
import { places, previewFlag, readGaze, readTranscript, type Job } from "./media-jobs.ts"
import { numbered } from "./tus.ts"

export interface Found {
  readonly key: string
  readonly project: string
  readonly title: string
  readonly name: string
  readonly size: number
  readonly duration: number
}

export const gatherLibrary = (here: ReadonlySet<string>, found: ReadonlyArray<Found>): ReadonlyArray<LibraryVideo> => {
  const byKey = new Map<string, LibraryVideo>()
  for (const video of found) {
    if (here.has(video.key)) continue
    const known = byKey.get(video.key)
    if (known === undefined) {
      byKey.set(video.key, { project: video.project, name: video.name, size: video.size, duration: video.duration, titles: [video.title] })
    } else if (!known.titles.includes(video.title)) {
      byKey.set(video.key, { ...known, titles: [...known.titles, video.title] })
    }
  }
  return [...byKey.values()]
}

export const sourceNames = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* fs.readDirectory(`${dir}/source`)
  return names.toSorted()
})

const HEAD_BYTES = 1024 * 1024

// Not the inode: the same video uploaded into two projects is two files.
const keyOf = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const file = yield* fs.open(places(job).source)
  const size = Number((yield* file.stat).size)
  const head = Option.getOrElse(yield* file.readAlloc(HEAD_BYTES), () => new Uint8Array())
  const digest = yield* crypto.digest("SHA-256", head)
  return `${size}:${Buffer.from(digest).toString("hex")}`
}, Effect.scoped)

export const keysIn = Effect.fnUntraced(function*(dir: string) {
  const names = yield* sourceNames(dir)
  return new Set(yield* Effect.forEach(names, (name) => keyOf({ dir, name })))
})

const isHeard = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const place = places(job)
  return (yield* fs.exists(place.transcript)) && (yield* fs.exists(place.preview))
})

export const heardIn = Effect.fnUntraced(function*(project: { readonly id: string; readonly title: string }, dir: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* sourceNames(dir)
  const found = yield* Effect.forEach(names, (name) => Effect.gen(function*() {
    const job = { dir, name }
    if (!(yield* isHeard(job))) return []
    const info = yield* fs.stat(places(job).source)
    const transcript = yield* readTranscript(job)
    const video: Found = {
      key: yield* keyOf(job),
      project: project.id,
      title: project.title,
      name,
      size: Number(info.size),
      duration: transcript.duration
    }
    return [video]
  }))
  return found.flat()
})

const isTaken = Effect.fnUntraced(function*(dir: string, name: string) {
  const fs = yield* FileSystem.FileSystem
  const place = places({ dir, name })
  const taken = yield* Effect.forEach([place.source, place.transcript, place.preview, place.gaze], (file) => fs.exists(file))
  return taken.some(Boolean)
})

const freeName = (dir: string, name: string, attempt: number): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const candidate = numbered(name, attempt)
    return (yield* isTaken(dir, candidate)) ? yield* freeName(dir, name, attempt + 1) : candidate
  })

const alreadyExists = (error: PlatformError.PlatformError): boolean => Predicate.isTagged(error.reason, "AlreadyExists")

// Not recursive: a recursive make would bring back the folder of a project being removed.
const existingFolder = Effect.fnUntraced(function*(folder: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(folder).pipe(Effect.catchIf(alreadyExists, () => Effect.void))
})

export const reuse = Effect.fnUntraced(function*(from: Job, dir: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* isHeard(from))) return yield* badRequest("Студия ещё слушает это видео. Возьмите его, когда в его ролике появится текст.")
  if ((yield* keysIn(dir)).has(yield* keyOf(from))) return
  const name = yield* freeName(dir, from.name, 0)
  const source = places(from)
  const target = places({ dir, name })
  yield* existingFolder(`${dir}/transcripts`)
  yield* existingFolder(`${dir}/preview`)
  const transcript = yield* readTranscript(from)
  yield* fs.link(source.preview, target.preview)
  if (yield* fs.exists(previewFlag(from))) yield* fs.copyFile(previewFlag(from), previewFlag({ dir, name }))
  yield* fs.writeFileString(target.text, transcriptText(name, transcript))
  yield* fs.copyFile(source.transcript, target.transcript)
  if (yield* fs.exists(source.gaze)) {
    yield* existingFolder(`${dir}/gaze`)
    yield* fs.writeFileString(target.gazeText, gazeText(name, transcript, yield* readGaze(from)))
    yield* fs.copyFile(source.gaze, target.gaze)
  }
  // The source goes last: the media worker hears every source that has no transcript yet.
  yield* fs.link(source.source, target.source)
})
