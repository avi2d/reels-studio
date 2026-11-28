import { Effect } from "effect"

const unreadableFiles = new Map<string, string>()

export const reportUnreadable = Effect.fnUntraced(function*(file: string, text: string | undefined, message: string) {
  if (text === undefined) {
    unreadableFiles.delete(file)
    return
  }
  if (unreadableFiles.get(file) === text) return
  if (unreadableFiles.size >= 100) unreadableFiles.delete(unreadableFiles.keys().next().value ?? "")
  unreadableFiles.set(file, text)
  yield* Effect.logError(message, file)
})
