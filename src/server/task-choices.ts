import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect"
import { EVERY_APP, inAppOrder, type NewTask, TaskChoices } from "../shared/brief.ts"
import { MAX_FILES } from "../shared/chat.ts"
import { badRequest, notFound } from "./api-error.ts"
import { readText } from "./approval.ts"
import { readAttached } from "./attached-files.ts"
import { completedName } from "./tus.ts"

const ChoicesFile = Schema.fromJsonString(TaskChoices)
const decodeChoices = Schema.decodeUnknownOption(ChoicesFile)
const encodeChoices = Schema.encodeEffect(ChoicesFile)

const choicesFile = Effect.fnUntraced(function*(dir: string) {
  const path = yield* Path.Path
  return path.join(dir, "task.json")
})

export const readChoices = Effect.fnUntraced(function*(dir: string) {
  const saved = yield* readText(yield* choicesFile(dir))
  if (saved === undefined) return EVERY_APP
  const choices = Option.getOrUndefined(decodeChoices(saved))
  if (choices !== undefined) return choices
  yield* Effect.logError("the task choices are unreadable", dir)
  return EVERY_APP
})

const fileNames = Effect.fnUntraced(function*(dir: string, files: NonNullable<NewTask["files"]>) {
  if (files.length > MAX_FILES) return yield* badRequest(`Приложите к заданию не больше ${MAX_FILES} файлов`)
  const attached = yield* readAttached(dir)
  const names = yield* Effect.forEach(files, (file) => "upload" in file
    ? completedName(dir, file.upload, "attached")
    : attached.includes(file.name) ? Effect.succeed(file.name) : Effect.fail(notFound("Такого файла в ролике нет")))
  return Arr.dedupe(names)
})

export const writeChoices = Effect.fnUntraced(function*(dir: string, task: NewTask) {
  if (task.apps?.length === 0) return yield* badRequest("Выберите, куда пойдёт ролик")
  if (task.apps === undefined && task.files === undefined) return
  const saved = yield* readChoices(dir)
  const choices = {
    apps: task.apps === undefined ? saved.apps : inAppOrder(task.apps),
    files: task.files === undefined ? saved.files : yield* fileNames(dir, task.files)
  }
  const fs = yield* FileSystem.FileSystem
  const file = yield* choicesFile(dir)
  yield* fs.writeFileString(`${file}.new`, yield* encodeChoices(choices))
  yield* fs.rename(`${file}.new`, file)
})
