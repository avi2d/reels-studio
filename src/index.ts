import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { apiRoutes } from "./server/api.ts"
import { Chat } from "./server/chat.ts"
import { Media } from "./server/media.ts"
import { pageRoutes } from "./server/page.ts"
import { Projects } from "./server/projects.ts"
import { Settings } from "./server/settings.ts"

const services = Layer.mergeAll(Chat.layer, Media.layer).pipe(Layer.provideMerge(Projects.layer), Layer.provideMerge(Settings.layer))

const server = Layer.unwrap(Effect.gen(function*() {
  const settings = yield* Settings
  return HttpRouter.serve(Layer.mergeAll(apiRoutes, pageRoutes)).pipe(
    Layer.provide(BunHttpServer.layer({ hostname: settings.host, port: settings.port, idleTimeout: 120 }))
  )
}))

BunRuntime.runMain(Layer.launch(server.pipe(Layer.provide(services), Layer.provide(BunServices.layer))))
