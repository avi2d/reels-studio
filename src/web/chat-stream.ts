import { Effect, Option, Schema } from "effect"
import { ChatEvent } from "../shared/chat.ts"
import { Offline } from "./api.ts"
import { parseEventBlock } from "./format.ts"

const decodeEvent = Schema.decodeUnknownOption(ChatEvent)

export const readReply = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: ChatEvent) => void
): Effect.Effect<void> => {
  const decoder = new TextDecoder()
  const pump = (rest: string): Effect.Effect<void> =>
    Effect.gen(function*() {
      const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new Offline() }).pipe(
        Effect.catchTag("Offline", () => Effect.succeed({ done: true as const, value: undefined }))
      )
      if (chunk.done) return
      const blocks = (rest + decoder.decode(chunk.value, { stream: true })).split("\n\n")
      for (const block of blocks.slice(0, -1)) {
        const event = Option.getOrUndefined(decodeEvent(parseEventBlock(block)))
        if (event !== undefined) onEvent(event)
      }
      yield* pump(blocks.at(-1) ?? "")
    })
  return pump("")
}
