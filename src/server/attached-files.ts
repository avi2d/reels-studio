import { Array as Arr, Effect, FileSystem, Option, Schema } from "effect"
import { TaskChoices } from "../shared/brief.ts"
import { Message } from "../shared/chat.ts"
import { readText } from "./approval.ts"
import { readWebPages } from "./web-page-files.ts"

const decodeChoices = Schema.decodeUnknownOption(Schema.fromJsonString(TaskChoices))
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Message))

export const readAttached = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${dir}/attached`
  if (!(yield* fs.exists(folder))) return []
  return (yield* fs.readDirectory(folder)).toSorted()
})

const taskFiles = Effect.fnUntraced(function*(dir: string) {
  const text = yield* readText(`${dir}/task.json`)
  if (text === undefined) return []
  return Option.getOrElse(Option.map(decodeChoices(text), (choices) => choices.files), (): ReadonlyArray<string> => [])
})

const chatFiles = Effect.fnUntraced(function*(dir: string) {
  const text = yield* readText(`${dir}/chat.jsonl`)
  if (text === undefined) return []
  return Arr.getSomes(text.split("\n").map((line) => decodeMessage(line))).flatMap((message) => message.files ?? [])
})

// A file the person removed from the task stays in attached/ but is reachable only while the task, a chat message or a saved web page still names it.
export const readReachable = Effect.fnUntraced(function*(dir: string) {
  const saved = (yield* readWebPages(dir)).map((page) => page.file)
  const kept = new Set([...(yield* taskFiles(dir)), ...(yield* chatFiles(dir)), ...saved])
  return (yield* readAttached(dir)).filter((name) => kept.has(name))
})
