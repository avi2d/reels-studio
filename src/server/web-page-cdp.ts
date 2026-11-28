import { Deferred, Effect, Queue, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ApiError, badRequest } from "./api-error.ts"
import { NOT_OPENED } from "./web-page-access.ts"
import { browserArgs } from "./web-page-commands.ts"

class BrowserCommandError extends Schema.TaggedError<BrowserCommandError>()("BrowserCommandError", {
  message: Schema.String
}) {}

const Event = Schema.Struct({
  method: Schema.String, params: Schema.Unknown, sessionId: Schema.optionalKey(Schema.String)
})
export type BrowserEvent = typeof Event.Type

const Message = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ id: Schema.Number, result: Schema.Unknown }),
  Schema.Struct({ id: Schema.Number, error: Schema.Struct({ message: Schema.String }) }),
  Event
]))
const decodeMessage = Schema.decodeUnknownEffect(Message)

export const openBrowser = Effect.fnUntraced(function*(chrome: string, profile: string) {
  const process = yield* ChildProcess.make(chrome, browserArgs(profile), {
    additionalFds: { fd3: { type: "input" }, fd4: { type: "output" } },
    stdout: "ignore", stderr: "ignore"
  })
  const outgoing = yield* Queue.unbounded<Uint8Array>()
  const events = yield* Queue.unbounded<typeof Event.Type>()
  const failed = yield* Deferred.make<never, ApiError>()
  const pending = new Map<number, Deferred.Deferred<unknown, BrowserCommandError>>()
  let next = 0
  const fail = () => Deferred.fail(failed, badRequest(NOT_OPENED))
  yield* Stream.fromQueue(outgoing).pipe(Stream.run(process.getInputFd(3)), Effect.catch((error) => Effect.logError("web page browser input failed", error).pipe(Effect.andThen(fail))), Effect.forkScoped)
  yield* process.getOutputFd(4).pipe(
    Stream.decodeText(),
    Stream.map((chunk) => chunk.replaceAll("\0", "\n")),
    Stream.splitLines,
    Stream.runForEach((line) => Effect.gen(function*() {
      const message = yield* decodeMessage(line).pipe(Effect.mapError(() => badRequest(NOT_OPENED)))
      if ("method" in message) {
        yield* Queue.offer(events, message)
      } else {
        const reply = pending.get(message.id)
        if (reply !== undefined) {
          if ("error" in message) {
            yield* Deferred.fail(reply, new BrowserCommandError({ message: message.error.message }))
          } else yield* Deferred.succeed(reply, message.result)
        }
      }
    })),
    Effect.matchEffect({ onFailure: fail, onSuccess: fail }),
    Effect.forkScoped
  )
  yield* process.exitCode.pipe(Effect.matchEffect({ onFailure: fail, onSuccess: fail }), Effect.forkScoped)

  const send = Effect.fnUntraced(function*(method: string, params: Readonly<Record<string, unknown>> = {}, sessionId?: string) {
    const id = ++next
    const reply = yield* Deferred.make<unknown, BrowserCommandError>()
    pending.set(id, reply)
    yield* Queue.offer(outgoing, new TextEncoder().encode(JSON.stringify({ id, method, params, ...sessionId === undefined ? {} : { sessionId } }) + "\0"))
    return yield* Deferred.await(reply).pipe(Effect.ensuring(Effect.sync(() => { pending.delete(id) })))
  })
  return { send, events, failed }
})
