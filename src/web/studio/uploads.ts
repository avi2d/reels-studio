import { Effect } from "effect"
import type { UploadedVideo } from "../../shared/library.ts"
import * as Api from "../api.ts"
import { oneAfterAnother } from "../queue.ts"
import { BROKEN } from "../run.ts"
import { libraryShelf, upload } from "../upload.ts"
import type { Take } from "./takes.ts"

type SendTake = Extract<Take, { readonly kind: "queued" | "sending" | "offline" | "unsent" }>

export interface Sending {
  readonly key: string
  readonly file: File
  readonly take: SendTake
}

export type TakesChange =
  | { readonly kind: "moved" }
  | { readonly kind: "listed"; readonly uploaded: ReadonlyArray<UploadedVideo> }
  | { readonly kind: "unlisted" }
  | { readonly kind: "known"; readonly name: string }

const QUEUED: SendTake = { kind: "queued" }

let sending: ReadonlyArray<Sending> = []
const listeners = new Set<(change: TakesChange) => void>()

export const onTakesChanged = (listener: (change: TakesChange) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const changed = (change: TakesChange): void => {
  for (const listener of [...listeners]) listener(change)
}

export const sendingNow = (): ReadonlyArray<Sending> => sending

const without = (key: string): ReadonlyArray<Sending> => sending.filter((entry) => entry.key !== key)

const setTake = (key: string, take: SendTake): void => {
  sending = sending.map((entry) => entry.key === key ? { ...entry, take } : entry)
  changed({ kind: "moved" })
}

const libraryNow = (key: string): Effect.Effect<ReadonlyArray<UploadedVideo>, Api.Failed> =>
  Api.getUploadedForTransfer.pipe(
    Effect.map(({ videos }) => videos),
    Effect.catchTag("Offline", () => Effect.gen(function*() {
      setTake(key, { kind: "offline" })
      yield* Effect.sleep("3 seconds")
      return yield* libraryNow(key)
    }))
  )

// The finished row leaves together with the fresh list, so the recording never vanishes between the two.
const finish = (key: string): Effect.Effect<void> =>
  Effect.match(libraryNow(key), {
    onFailure: () => {
      sending = without(key)
      changed({ kind: "unlisted" })
    },
    onSuccess: (uploaded) => {
      sending = without(key)
      changed({ kind: "listed", uploaded })
    }
  })

const listedAlready = ({ key, file }: Sending): Effect.Effect<boolean> =>
  libraryNow(key).pipe(
    Effect.map((videos) => videos.some((video) => video.name === file.name && video.size === file.size)),
    Effect.orElseSucceed(() => false)
  )

const sendBytes = ({ key, file }: Sending): Effect.Effect<void> =>
  upload(libraryShelf, file, (progress) => {
    setTake(key, progress.waiting ? { kind: "offline" } : { kind: "sending", sent: progress.sent, total: progress.total })
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.sync(() => { setTake(key, { kind: "unsent", message: error.message }) }),
      onSuccess: () => finish(key)
    })
  )

const sendOne = (entry: Sending): Effect.Effect<void> =>
  Effect.gen(function*() {
    if (yield* listedAlready(entry)) {
      sending = without(entry.key)
      changed({ kind: "known", name: entry.file.name })
      return
    }
    yield* sendBytes(entry)
  }).pipe(
    Effect.catchDefect((defect) => Effect.sync(() => {
      console.error(defect)
      setTake(entry.key, { kind: "unsent", message: BROKEN })
    }))
  )

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)

const keyOf = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`

export const sendTakes = (files: ReadonlyArray<File>): void => {
  const busy = new Set(sending.filter((entry) => entry.take.kind !== "unsent").map((entry) => entry.key))
  const fresh = new Map(files.filter((file) => !busy.has(keyOf(file))).map((file) => [keyOf(file), file]))
  if (fresh.size === 0) return
  const made = [...fresh].map(([key, file]): Sending => ({ key, file, take: QUEUED }))
  sending = [...sending.filter((entry) => !fresh.has(entry.key)), ...made]
  changed({ kind: "moved" })
  enqueue(made.map(sendOne))
}

export const resend = (key: string): void => {
  const entry = sending.find((one) => one.key === key)
  if (entry !== undefined) sendTakes([entry.file])
}

export const dropTake = (key: string): void => {
  sending = without(key)
  changed({ kind: "moved" })
}
