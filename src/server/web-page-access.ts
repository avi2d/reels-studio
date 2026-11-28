import { lookup } from "node:dns/promises"
import { Context, Effect, Schema, Stream } from "effect"
import { badRequest } from "./api-error.ts"
import { checkedRequestAddress, isOutside, isSinkAddress } from "./web-page-commands.ts"

export const AT_HOME = "Этот адрес ведёт в домашнюю сеть. Студия открывает только страницы в интернете."
export const NOT_OPENED = "Страница не открылась. Проверьте адрес или попробуйте позже."

const outsideAddress = Effect.fnUntraced(function*(host: string) {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  const addresses = yield* Effect.tryPromise({
    try: () => lookup(bare, { all: true, order: "verbatim" }),
    catch: () => badRequest(NOT_OPENED)
  })
  const first = addresses[0]
  if (addresses.some((one) => !isOutside(one.address) && !isSinkAddress(one.address))) return yield* badRequest(AT_HOME)
  if (first === undefined || addresses.some((one) => isSinkAddress(one.address))) return yield* badRequest(NOT_OPENED)
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

const MAX_BODY = 16 * 1024 * 1024
const HOP_BY_HOP = /^(?:connection|transfer-encoding)$/iu
const OWN_HEADERS = /^(?:host|connection|content-length|transfer-encoding|accept-encoding)$/iu

const bodyOf = (response: Response) => {
  if (response.body === null) return Effect.succeed(Buffer.alloc(0))
  const stream = response.body
  let size = 0
  return Stream.fromReadableStream({ evaluate: () => stream, onError: () => badRequest(NOT_OPENED) }).pipe(
    Stream.mapEffect((chunk) => {
      size += chunk.length
      return size > MAX_BODY ? Effect.fail(badRequest(NOT_OPENED)) : Effect.succeed(chunk)
    }),
    Stream.runCollect,
    Effect.map((chunks) => Buffer.concat(chunks))
  )
}

// Connects to the address that was checked and verifies the certificate against the page's own name, so DNS cannot answer differently in between.
const fetchPinned = (url: URL, destination: { readonly address: string; readonly family: number }, request: PageRequest) => {
  const pinned = new URL(url)
  pinned.hostname = destination.family === 6 ? `[${destination.address}]` : destination.address
  const headers = new Headers({ host: url.host, "accept-encoding": "identity" })
  for (const [name, value] of Object.entries(request.headers)) if (!OWN_HEADERS.test(name)) headers.set(name, value)
  return Effect.tryPromise({
    try: (signal) => fetch(pinned, {
      method: request.method,
      headers,
      redirect: "manual",
      decompress: false,
      signal,
      tls: { serverName: url.hostname.replace(/^\[|\]$/gu, "") },
      ...request.method === "GET" || request.method === "HEAD" || request.postData === undefined ? {} : { body: request.postData }
    }),
    catch: () => badRequest(NOT_OPENED)
  }).pipe(
    Effect.flatMap((response) => bodyOf(response).pipe(
      Effect.map((body) => {
        const responseHeaders: Array<{ name: string; value: string }> = []
        response.headers.forEach((value, name) => {
          if (!HOP_BY_HOP.test(name)) responseHeaders.push({ name, value })
        })
        return { responseCode: response.status, responseHeaders, body: body.toString("base64") }
      })
    ))
  )
}

export const pageResponse = Effect.fnUntraced(function*(request: PageRequest) {
  const url = checkedRequestAddress(request.url)
  if (url === undefined) return yield* badRequest(NOT_OPENED)
  const destination = yield* (yield* WebPageAddress)(url.hostname)
  return yield* fetchPinned(url, destination, request)
})
