import { Effect, Option, Schema } from "effect"
import type { HttpServerRequest } from "effect/http"
import { APPS, type App } from "../shared/brief.ts"
import { APP_FILE_NAME, PictureSide } from "../shared/reel.ts"
import { badRequest, type ApiError } from "./api-error.ts"
import type { Picture, ReelVersion } from "./reel-record.ts"

const queryOf = (request: HttpServerRequest.HttpServerRequest, name: string): string =>
  new URL(request.url, "http://localhost").searchParams.get(name) ?? ""

export const madeOf = (request: HttpServerRequest.HttpServerRequest): string => queryOf(request, "made")

const decodeSide = Schema.decodeUnknownOption(PictureSide)

export const pictureOf = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<Picture, ApiError> => {
  const join = Number(queryOf(request, "join"))
  const side = Option.getOrUndefined(decodeSide(queryOf(request, "side")))
  return Number.isInteger(join) && join >= 1 && side !== undefined
    ? Effect.succeed({ made: madeOf(request), join, side })
    : badRequest("Такой картинки нет")
}

export const pageOf = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<{ readonly page: number; readonly quote: string }, ApiError> => {
  const page = Number(queryOf(request, "page"))
  const quote = queryOf(request, "quote")
  return Number.isInteger(page) && page >= 1 && quote.trim() !== "" ? Effect.succeed({ page, quote }) : badRequest("Такой страницы нет")
}

export const appOf = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<App | undefined, ApiError> => {
  const name = queryOf(request, "app")
  if (name === "") return Effect.undefined
  const app = APPS.find((one) => APP_FILE_NAME[one] === name)
  return app === undefined ? badRequest("Такого приложения нет") : Effect.succeed(app)
}

export const versionOf = (request: HttpServerRequest.HttpServerRequest): ReelVersion =>
  new URL(request.url, "http://localhost").searchParams.get("version") === "before" ? "before" : "after"
