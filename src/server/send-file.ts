import { Effect, FileSystem } from "effect"
import { HttpServerResponse } from "effect/http"
import { ApiError } from "./api-error.ts"
import { parseRange } from "./range.ts"

const UNREADABLE = new ApiError({ status: 500, message: "Видео недоступно. Попробуйте открыть страницу ещё раз." })

export const sendFile = Effect.fnUntraced(function*(target: string, contentType: string, rangeHeader: string | undefined, extra: Readonly<Record<string, string>> = {}) {
  const fs = yield* FileSystem.FileSystem
  const size = Number((yield* fs.stat(target)).size)
  const range = parseRange(rangeHeader, size)
  const headers = { "accept-ranges": "bytes", "cache-control": "no-store", ...extra }
  if (range.kind === "outside") {
    return HttpServerResponse.empty({ status: 416, headers: { ...headers, "content-range": `bytes */${size}` } })
  }
  if (range.kind === "whole") return yield* HttpServerResponse.file(target, { contentType, headers })
  return yield* HttpServerResponse.file(target, {
    status: 206,
    contentType,
    offset: range.start,
    bytesToRead: range.end - range.start + 1,
    headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}` }
  })
}, Effect.mapError((cause) => cause instanceof ApiError ? cause : UNREADABLE))
