import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { NewLooks } from "../shared/looks.ts"
import { body, json, param, reply } from "./api-reply.ts"
import { looksView, orLooks, writeLooks } from "./looks.ts"
import { Projects } from "./projects.ts"

export const looksRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/looks", reply(Effect.gen(function*() {
    const dir = yield* (yield* Projects).folder(yield* param("id"))
    return json(yield* looksView(dir).pipe(orLooks))
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/looks", reply(Effect.gen(function*() {
    const dir = yield* (yield* Projects).folder(yield* param("id"))
    const change = yield* body(NewLooks)
    return json(yield* writeLooks(dir, change).pipe(orLooks))
  })))
)
