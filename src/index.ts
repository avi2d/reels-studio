import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { apiRoutes } from "./server/api.ts"
import { Attachments } from "./server/attachments.ts"
import { Brief } from "./server/brief.ts"
import { Chat } from "./server/chat.ts"
import { Gather } from "./server/gather.ts"
import { GatherState } from "./server/gather-state.ts"
import { Media } from "./server/media.ts"
import { pageRoutes } from "./server/page.ts"
import { Projects } from "./server/projects.ts"
import { Settings } from "./server/settings.ts"
import { WebPages } from "./server/web-pages.ts"

const gatherStateLive = GatherState.layer
const mediaLive = Media.layer
const attachmentsLive = Attachments.layer
const briefLive = Brief.layer.pipe(Layer.provideMerge(mediaLive), Layer.provideMerge(gatherStateLive))
const chatLive = Chat.layer.pipe(Layer.provideMerge(briefLive), Layer.provideMerge(attachmentsLive))
const gatherLive = Gather.layer.pipe(Layer.provideMerge(chatLive), Layer.provideMerge(gatherStateLive))
const webPagesLive = WebPages.layer.pipe(Layer.provideMerge(attachmentsLive))
const services = Layer.mergeAll(gatherLive, chatLive, briefLive, mediaLive, attachmentsLive, webPagesLive, gatherStateLive).pipe(Layer.provideMerge(Projects.layer), Layer.provideMerge(Settings.layer))

const server = Layer.unwrap(Effect.gen(function*() {
  const settings = yield* Settings
  return HttpRouter.serve(Layer.mergeAll(apiRoutes, pageRoutes)).pipe(
    Layer.provide(BunHttpServer.layer({ hostname: settings.host, port: settings.port, idleTimeout: 120 }))
  )
}))

BunRuntime.runMain(Layer.launch(server.pipe(Layer.provide(services), Layer.provide(BunServices.layer))))
