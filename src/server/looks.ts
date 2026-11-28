import { Effect, FileSystem, Option, Schema, Semaphore } from "effect"
import { ExampleLook, Looks, NO_LOOKS, type LooksView, type NewLooks } from "../shared/looks.ts"
import { badRequest, orUnavailable } from "./api-error.ts"
import { readText } from "./approval.ts"
import { reportUnreadable } from "./unreadable.ts"

const LooksFile = Schema.fromJsonString(Looks)
const decodeLooks = Schema.decodeUnknownOption(LooksFile)
const encodeLooks = Schema.encodeEffect(LooksFile)
const decodeExample = Schema.decodeUnknownOption(Schema.fromJsonString(ExampleLook))

const looksFile = (dir: string): string => `${dir}/looks.json`
const exampleFile = (dir: string): string => `${dir}/example.json`

// Only the person's own choice changes the face or the subtitles, so a missing or broken file reads as the defaults.
export const looksOf = (text: string | undefined): Looks =>
  text === undefined ? NO_LOOKS : Option.getOrElse(decodeLooks(text), () => NO_LOOKS)

export const readLooks = Effect.fnUntraced(function*(dir: string) {
  return looksOf(yield* readText(looksFile(dir)))
})

// The face and the subtitle look are saved from two requests into one file, so a write without the lock can drop the other.
const writing = Semaphore.makeUnsafe(1)

const replaceLooks = Effect.fnUntraced(function*(dir: string, change: (looks: Looks) => Looks) {
  const fs = yield* FileSystem.FileSystem
  const looks = change(yield* readLooks(dir))
  const fresh = `${looksFile(dir)}.new`
  yield* fs.writeFileString(fresh, yield* encodeLooks(looks))
  yield* fs.rename(fresh, looksFile(dir))
  return looks
})

export const updateLooks = Effect.fnUntraced(function*(dir: string, change: (looks: Looks) => Looks) {
  return yield* replaceLooks(dir, change).pipe(Semaphore.withPermit(writing))
})

export const readExample = Effect.fnUntraced(function*(dir: string) {
  const file = exampleFile(dir)
  const text = yield* readText(file)
  const example = text === undefined ? undefined : Option.getOrUndefined(decodeExample(text))
  yield* reportUnreadable(file, example === undefined ? text : undefined, "the look of the example is unreadable")
  return example
})

export const looksView = Effect.fnUntraced(function*(dir: string) {
  const looks = yield* readLooks(dir)
  const example = yield* readExample(dir)
  return {
    subtitles: looks.subtitles,
    plate: looks.plate,
    ...(example === undefined ? {} : { example })
  } satisfies LooksView
})

export const orLooks = orUnavailable("the looks failed", "Оформление недоступно. Попробуйте ещё раз.")

const NO_EXAMPLE = "Сначала приложите пример ролика к заданию или в чате."

export const writeLooks = Effect.fnUntraced(function*(dir: string, change: NewLooks) {
  if (change.subtitles?.style === "example" && (yield* readExample(dir)) === undefined) return yield* badRequest(NO_EXAMPLE)
  yield* updateLooks(dir, (looks) => ({
    ...looks,
    ...(change.subtitles === undefined ? {} : { subtitles: change.subtitles }),
    ...(change.plate === undefined ? {} : { plate: { shown: change.plate.shown, text: change.plate.text.replace(/\s+/gu, " ").trim() } })
  }))
  return yield* looksView(dir)
})
