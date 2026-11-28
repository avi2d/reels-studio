import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { Context, Effect, Schema } from "effect"
import { ApiError, badRequest } from "./api-error.ts"
import { checkedAddress, isOutside } from "./web-page-commands.ts"

export const AT_HOME = "Этот адрес ведёт в домашнюю сеть. Студия открывает только страницы в интернете."
export const NOT_OPENED = "Страница не открылась. Проверьте адрес или попробуйте позже."

const outsideAddress = Effect.fnUntraced(function*(host: string) {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  const addresses = yield* Effect.tryPromise({
    try: () => lookup(bare, { all: true, order: "verbatim" }),
    catch: () => badRequest(NOT_OPENED)
  })
  const first = addresses[0]
  if (first === undefined || !addresses.every((one) => isOutside(one.address))) return yield* badRequest(AT_HOME)
  return first
})

export const WebPageAddress = Context.Reference("reels-studio/WebPageAddress", {
  defaultValue: () => outsideAddress
})

export const PageRequest = Schema.Struct({
  url: Schema.String, method: Schema.String, headers: Schema.Record(Schema.String, Schema.String),
  postData: Schema.optionalKey(Schema.String)
})
export type PageRequest = typeof PageRequest.Type

export const pageResponse = Effect.fnUntraced(function*(request: PageRequest) {
  const url = checkedAddress(request.url)
  if (url === undefined) return yield* badRequest(NOT_OPENED)
  const destination = yield* (yield* WebPageAddress)(url.hostname)
  return yield* Effect.callback<{
    readonly responseCode: number
    readonly responseHeaders: ReadonlyArray<{ readonly name: string; readonly value: string }>
    readonly body: string
  }, ApiError>((resume) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest
    const headers = { ...request.headers, "accept-encoding": "identity" }
    const outgoing = send(url, {
      method: request.method, headers, agent: false, family: destination.family,
      lookup: (_host, _options, done) => done(null, destination.address, destination.family)
    }, (incoming) => {
      const chunks: Array<Buffer> = []
      incoming.on("data", (chunk: Buffer) => { chunks.push(chunk) })
      incoming.on("error", () => { resume(Effect.fail(badRequest(NOT_OPENED))) })
      incoming.on("end", () => {
        const responseHeaders: Array<{ name: string; value: string }> = []
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index]
          const value = incoming.rawHeaders[index + 1]
          if (name !== undefined && value !== undefined && !/^(?:connection|transfer-encoding)$/iu.test(name)) responseHeaders.push({ name, value })
        }
        resume(Effect.succeed({ responseCode: incoming.statusCode ?? 502, responseHeaders, body: Buffer.concat(chunks).toString("base64") }))
      })
    })
    outgoing.on("error", () => { resume(Effect.fail(badRequest(NOT_OPENED))) })
    outgoing.end(request.postData)
    return Effect.sync(() => { outgoing.destroy() })
  })
})
