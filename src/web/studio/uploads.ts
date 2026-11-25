import { Effect, Option, Schema } from "effect"
import type { UploadedVideo } from "../../shared/library.ts"
import * as Api from "../api.ts"
import { oneAfterAnother } from "../queue.ts"
import { BROKEN } from "../run.ts"
import { libraryShelf, upload } from "../upload.ts"
import { type Take, uploadedName } from "./takes.ts"

type SendTake = Extract<Take, { readonly kind: "queued" | "sending" | "offline" | "unsent" }>

export interface Sending {
  readonly key: string
  readonly file: File
  readonly take: SendTake
}

const QUEUED: SendTake = { kind: "queued" }

const sendingByReel = new Map<string, ReadonlyArray<Sending>>()
const problems = new Map<string, string>()
const joiners = new Set<string>()
const listeners = new Set<(settled: boolean) => void>()

export const onTakesChanged = (listener: (settled: boolean) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const changed = (settled: boolean): void => {
  for (const listener of [...listeners]) listener(settled)
}

export const sendingTo = (projectId: string): ReadonlyArray<Sending> => sendingByReel.get(projectId) ?? []

export const takeProblem = (projectId: string): string | undefined => {
  const problem = problems.get(projectId)
  problems.delete(projectId)
  return problem
}

const setTake = (projectId: string, key: string, take: SendTake | undefined): void => {
  const list = sendingTo(projectId)
  sendingByReel.set(projectId, take === undefined
    ? list.filter((entry) => entry.key !== key)
    : list.map((entry) => entry.key === key ? { ...entry, take } : entry))
  changed(take === undefined)
}

const decodeNames = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const joinKey = (projectId: string): string => `reels-joining:${projectId}`

// Kept in the browser so a recording still joins its reel after a reload while the studio hears it.
export const joiningTo = (projectId: string): ReadonlyArray<string> =>
  Option.getOrElse(decodeNames(localStorage.getItem(joinKey(projectId))), () => [])

const setJoining = (projectId: string, names: ReadonlyArray<string>): void => {
  if (names.length === 0) localStorage.removeItem(joinKey(projectId))
  else localStorage.setItem(joinKey(projectId), JSON.stringify(names))
}

const joinRound = (projectId: string): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    const names = joiningTo(projectId)
    if (names.length === 0) return false
    const { videos } = yield* Api.getUploaded
    const stateOf = (name: string): UploadedVideo["state"] | undefined => videos.find((video) => video.name === name)?.state
    const ready = names.filter((name) => stateOf(name) === "ready")
    if (ready.length > 0) {
      yield* Api.addVideos(projectId, ready.map((name) => ({ from: "library", name }))).pipe(
        Effect.catchTag("Failed", (error) => Effect.sync(() => { problems.set(projectId, error.message) }))
      )
    }
    const checked = new Set(names)
    const left = joiningTo(projectId).filter((name) => !checked.has(name) || stateOf(name) === "waiting")
    setJoining(projectId, left)
    if (ready.length > 0 || left.join("/") !== names.join("/")) changed(true)
    return left.length > 0
  }).pipe(Effect.catchTag("Failed", () => Effect.succeed(true)))

const joinLoop = (projectId: string): Effect.Effect<void> =>
  Effect.flatMap(joinRound(projectId), (again) => again ? Effect.andThen(Effect.sleep("4 seconds"), joinLoop(projectId)) : Effect.void)

export const keepJoining = (projectId: string): void => {
  if (joiners.has(projectId) || joiningTo(projectId).length === 0) return
  joiners.add(projectId)
  Effect.runFork(joinLoop(projectId).pipe(Effect.ensuring(Effect.sync(() => { joiners.delete(projectId) }))))
}

const NOT_LISTED = "Студия приняла файл, но не показала его. Обновите страницу."

const sendOne = (projectId: string, { key, file }: Sending): Effect.Effect<void> =>
  Effect.gen(function*() {
    const uploaded: typeof Api.getUploaded = Api.getUploadedForTransfer.pipe(
      Effect.catchTag("Offline", () => Effect.gen(function*() {
        setTake(projectId, key, { kind: "offline" })
        yield* Effect.sleep("3 seconds")
        return yield* uploaded
      }))
    )
    const before = new Set((yield* uploaded).videos.map((video) => video.name))
    yield* upload(libraryShelf, file, (progress) => {
      setTake(projectId, key, progress.waiting ? { kind: "offline" } : { kind: "sending", sent: progress.sent, total: progress.total })
    })
    const name = uploadedName(file, before, (yield* uploaded).videos)
    if (name === undefined) return yield* new Api.Failed({ message: NOT_LISTED })
    setJoining(projectId, [...joiningTo(projectId), name])
    setTake(projectId, key, undefined)
    keepJoining(projectId)
  }).pipe(
    Effect.catchTag("Failed", (error) => Effect.sync(() => { setTake(projectId, key, { kind: "unsent", message: error.message }) })),
    Effect.catchDefect((defect) => Effect.sync(() => {
      console.error(defect)
      setTake(projectId, key, { kind: "unsent", message: BROKEN })
    }))
  )

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)

const keyOf = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`

export const sendTakes = (projectId: string, files: ReadonlyArray<File>): void => {
  const list = sendingTo(projectId)
  const busy = new Set(list.filter((entry) => entry.take.kind !== "unsent").map((entry) => entry.key))
  const fresh = new Map(files.filter((file) => !busy.has(keyOf(file))).map((file) => [keyOf(file), file]))
  if (fresh.size === 0) return
  const made = [...fresh].map(([key, file]): Sending => ({ key, file, take: QUEUED }))
  sendingByReel.set(projectId, [...list.filter((entry) => !fresh.has(entry.key)), ...made])
  changed(false)
  enqueue(made.map((entry) => sendOne(projectId, entry)))
}

export const resend = (projectId: string, key: string): void => {
  const entry = sendingTo(projectId).find((one) => one.key === key)
  if (entry !== undefined) sendTakes(projectId, [entry.file])
}

export const dropTake = (projectId: string, key: string): void => {
  setTake(projectId, key, undefined)
}
