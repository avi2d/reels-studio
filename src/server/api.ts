import { Effect, Layer, Option, Schema, Stream } from "effect"
import { type App, NewTask } from "../shared/brief.ts"
import { CHAT_TURN_HEADER } from "../shared/chat.ts"
import { Pick } from "../shared/library.ts"
import { Post } from "../shared/posts.ts"
import { Face } from "../shared/face.ts"
import { RetouchPicture } from "../shared/retouch.ts"
import { Cleaned, Noise } from "../shared/noise.ts"
import { Effort, ProjectTitleInput } from "../shared/project.ts"
import { APP_FILE_NAME } from "../shared/reel.ts"
import { Edits, type TimelinePage } from "../shared/timeline.ts"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ApiError, notFound, orUnavailable } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { Brief } from "./brief.ts"
import { Chat } from "./chat.ts"
import { Gather } from "./gather.ts"
import { openLibrary } from "./library.ts"
import { allowedHosts, isAllowedHost, isHomeAddress, isSameOrigin } from "./home-network.ts"
import { Media } from "./media.ts"
import { Projects } from "./projects.ts"
import { readPosts, writePost } from "./posts.ts"
import { keepRule, undoChange } from "./rules.ts"
import { orRules, rulesPage } from "./rules-page.ts"
import { KeptInput, RuleId } from "../shared/rules.ts"
import { Settings } from "./settings.ts"
import { sendFile } from "./send-file.ts"
import * as Tus from "./tus.ts"
import { appOf, madeOf, pageOf, pictureOf, versionOf } from "./api-request.ts"
import { WebPages } from "./web-pages.ts"
import { body, json, param, reply } from "./api-reply.ts"
import { looksRoutes } from "./looks-api.ts"

const decodeRuleId = Schema.decodeUnknownOption(RuleId)

const SaveEdits = Schema.Struct({ base: Edits, edits: Edits })
const WebPageInput = Schema.Struct({ address: Schema.String })

const projects = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects", reply(Effect.gen(function*() {
    const store = yield* Projects
    return json({ projects: yield* store.list })
  }))),
  HttpRouter.add("POST", "/api/projects", reply(Effect.gen(function*() {
    const store = yield* Projects
    const input = yield* body(ProjectTitleInput)
    return json({ project: yield* store.create(input.title) }, 201)
  }))),
  HttpRouter.add("GET", "/api/projects/:id", reply(Effect.gen(function*() {
    const store = yield* Projects
    return json({ project: yield* store.get(yield* param("id")) })
  }))),
  HttpRouter.add("PATCH", "/api/projects/:id", reply(Effect.gen(function*() {
    const store = yield* Projects
    const input = yield* body(ProjectTitleInput)
    return json({ project: yield* store.rename(yield* param("id"), input.title) })
  }))),
  HttpRouter.add("DELETE", "/api/projects/:id", reply(Effect.gen(function*() {
    const store = yield* Projects
    const talk = yield* Chat
    const media = yield* Media
    const gather = yield* Gather
    const id = yield* param("id")
    const dir = yield* store.folder(id)
    yield* talk.withoutTurn(id, gather.withoutGather(id, media.withoutWork(dir, store.remove(id))))
    return json({ removed: id })
  })))
)

const NewMessage = Schema.Struct({
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.String)),
  model: Schema.String,
  effort: Effort
})


const brief = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/brief", reply(Effect.gen(function*() {
    const store = yield* Brief
    return json(yield* store.view(yield* param("id")))
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/brief", reply(Effect.gen(function*() {
    const store = yield* Brief
    const id = yield* param("id")
    yield* store.write(id, yield* body(NewTask))
    return json(yield* store.view(id))
  })))
)

const rules = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/rules", reply(param("id").pipe(Effect.flatMap(rulesPage), Effect.map(json)))),
  HttpRouter.add("PUT", "/api/projects/:id/rules/:rule/kept", reply(Effect.gen(function*() {
    const id = yield* param("id")
    const rule = Option.getOrUndefined(decodeRuleId(yield* param("rule")))
    if (rule === undefined) return yield* notFound("Такого правила нет")
    const { kept } = yield* body(KeptInput)
    yield* keepRule(yield* (yield* Projects).folder(id), (yield* Settings).projectsDir, rule, kept).pipe(orRules)
    return json(yield* rulesPage(id))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/rules/undo", reply(Effect.gen(function*() {
    const id = yield* param("id")
    yield* undoChange(yield* (yield* Projects).folder(id), (yield* Settings).projectsDir).pipe(orRules)
    return json(yield* rulesPage(id))
  })))
)

const KEEP_ALIVE = Stream.tick("15 seconds").pipe(Stream.map(() => ": \n\n"))

const chat = Layer.mergeAll(
  HttpRouter.add("GET", "/api/models", Effect.gen(function*() {
    const settings = yield* Settings
    return json({ models: settings.models })
  })),
  HttpRouter.add("GET", "/api/projects/:id/chat", reply(Effect.gen(function*() {
    const talk = yield* Chat
    return json({ messages: yield* talk.history(yield* param("id")) })
  }))),
  HttpRouter.add("POST", "/api/projects/:id/chat", reply(Effect.gen(function*() {
    const talk = yield* Chat
    const input = yield* body(NewMessage)
    const { token, events } = yield* talk.send(yield* param("id"), input.text, input.files ?? [], input.model, input.effort)
    const lines = events.pipe(
      Stream.catch((error) => Stream.make({ type: "error" as const, message: error.message }, { type: "done" as const })),
      Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`)
    )
    return HttpServerResponse.stream(
      Stream.merge(lines, KEEP_ALIVE, { haltStrategy: "left" }).pipe(Stream.encodeText),
      { contentType: "text/event-stream", headers: { "cache-control": "no-store", "x-accel-buffering": "no", [CHAT_TURN_HEADER]: token } }
    )
  }))),
  HttpRouter.add("POST", "/api/projects/:id/chat/stop", reply(Effect.gen(function*() {
    const talk = yield* Chat
    const { token } = yield* body(Schema.Struct({ token: Schema.NonEmptyString }))
    yield* talk.stop(yield* param("id"), token)
    return json({ ok: true })
  })))
)

interface Shelf {
  readonly dir: string
  readonly location: string
  readonly into: Tus.Folder
}

const projectFolder = Effect.gen(function*() {
  const store = yield* Projects
  return yield* store.folder(yield* param("id"))
})

const attachmentShelf = Effect.gen(function*() {
  const id = yield* param("id")
  const shelf: Shelf = { dir: yield* projectFolder, location: `/api/projects/${id}/attachments`, into: "attached" }
  return shelf
})

const libraryShelf = Effect.map(openLibrary, (dir): Shelf => ({ dir, location: "/api/library/uploads", into: "source" }))

const startUpload = <R>(shelf: Effect.Effect<Shelf, ApiError, R>) => (request: HttpServerRequest.HttpServerRequest) => reply(Effect.gen(function*() {
  if (request.method !== "POST") return yield* new ApiError({ status: 405, message: "Так загрузку не начать" })
  const { dir, location, into } = yield* shelf
  return yield* Tus.create(request, dir, location, into)
}))

const resumeUpload = <R>(folder: Effect.Effect<string, ApiError, R>) => (request: HttpServerRequest.HttpServerRequest) => reply(Effect.gen(function*() {
  const dir = yield* folder
  const upload = yield* param("upload")
  if (request.method === "HEAD") return yield* Tus.head(request, dir, upload)
  if (request.method === "PATCH") return yield* Tus.patch(request, dir, upload)
  return yield* new ApiError({ status: 405, message: "Так загрузку не продолжить" })
}))

const uploads = Layer.mergeAll(
  HttpRouter.add("*", "/api/library/uploads", startUpload(libraryShelf)),
  HttpRouter.add("*", "/api/library/uploads/:upload", resumeUpload(openLibrary)),
  HttpRouter.add("GET", "/api/library", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ videos: yield* media.uploaded })
  }))),
  HttpRouter.add("POST", "/api/library/:name/retry", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ video: yield* media.retryUploaded(yield* param("name")) })
  }))),
  HttpRouter.add("DELETE", "/api/library/:name", reply(Effect.gen(function*() {
    const media = yield* Media
    const name = yield* param("name")
    yield* media.removeUploaded(name)
    return json({ removed: name })
  }))),
  HttpRouter.add("GET", "/api/library/:name/preview", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    return yield* sendFile(yield* media.uploadedPreview(yield* param("name")), "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("*", "/api/projects/:id/attachments", startUpload(attachmentShelf)),
  HttpRouter.add("*", "/api/projects/:id/attachments/:upload", resumeUpload(projectFolder)),
  HttpRouter.add("GET", "/api/projects/:id/attachments/:name/cover", reply(Effect.gen(function*() {
    const attachments = yield* Attachments
    const target = yield* attachments.cover(yield* param("id"), yield* param("name"))
    return yield* HttpServerResponse.file(target, { contentType: "image/jpeg", headers: { "cache-control": "no-store" } }).pipe(
      Effect.mapError(() => new ApiError({ status: 500, message: "Файл недоступен. Попробуйте открыть страницу ещё раз." }))
    )
  }))),
  HttpRouter.add("GET", "/api/projects/:id/attachments/:name/clip", (request) => reply(Effect.gen(function*() {
    const attachments = yield* Attachments
    return yield* sendFile(yield* attachments.clip(yield* param("id"), yield* param("name")), "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("GET", "/api/projects/:id/attachments/:name/page", (request) => reply(Effect.gen(function*() {
    const attachments = yield* Attachments
    const { page, quote } = yield* pageOf(request)
    return yield* sendFile(yield* attachments.page(yield* param("id"), yield* param("name"), page, quote), "image/jpeg", request.headers["range"])
  }))),
  HttpRouter.add("POST", "/api/projects/:id/web-pages", reply(Effect.gen(function*() {
    return json(yield* (yield* WebPages).save(yield* param("id"), (yield* body(WebPageInput)).address))
  })))
)

// The ASCII name serves a browser that ignores filename*, which alone carries the Russian title.
export const attachment = (title: string, app?: App): string => {
  const stem = title.trim() || "reel"
  const [name, fallback] = app === undefined ? [stem, "reel"] : [`${stem} ${app}`, `reel-${APP_FILE_NAME[app]}`]
  return `attachment; filename="${fallback}.mp4"; filename*=UTF-8''${encodeURIComponent(`${name}.mp4`)}`
}

const reel = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/reel", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.reel(yield* param("id")))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/reel", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.buildReel(yield* param("id")), 202)
  }))),
  HttpRouter.add("DELETE", "/api/projects/:id/reel/build", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.cancelReel(yield* param("id")))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/sound", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.sound(yield* param("id")))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/reel/file", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const target = yield* media.reelFile(yield* param("id"), madeOf(request), versionOf(request), yield* appOf(request))
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("GET", "/api/projects/:id/reel/picture", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const target = yield* media.reelPicture(yield* param("id"), yield* pictureOf(request))
    return yield* sendFile(target, "image/jpeg", request.headers["range"])
  }))),
  HttpRouter.add("GET", "/api/projects/:id/reel/download", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const store = yield* Projects
    const id = yield* param("id")
    const app = yield* appOf(request)
    const target = yield* media.reelFile(id, madeOf(request), "after", app)
    const { title } = yield* store.get(id)
    return yield* sendFile(target, "video/mp4", request.headers["range"], { "content-disposition": attachment(title, app) })
  })))
)

const orPosts = orUnavailable("the posts failed", "Подписи недоступны. Попробуйте ещё раз.")

const posts = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/posts", reply(Effect.gen(function*() {
    const store = yield* Projects
    const dir = yield* store.folder(yield* param("id"))
    return json(yield* readPosts(dir).pipe(orPosts))
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/posts", reply(Effect.gen(function*() {
    const store = yield* Projects
    const dir = yield* store.folder(yield* param("id"))
    const post = yield* body(Post)
    return json(yield* writePost(dir, post).pipe(orPosts))
  })))
)

const NewFace = Schema.Struct({ face: Face })


const retouch = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/retouch", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.trial(yield* param("id")))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/retouch", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.startTrial(yield* param("id")), 202)
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/retouch/face", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    return json(yield* media.setFace(id, (yield* body(NewFace)).face))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/retouch/:name", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const name = yield* Schema.decodeUnknownEffect(RetouchPicture)(yield* param("name")).pipe(Effect.mapError(() => notFound("Такого файла в пробе нет")))
    const target = yield* media.trialFile(yield* param("id"), name)
    return yield* sendFile(target, name.endsWith(".jpg") ? "image/jpeg" : "video/mp4", request.headers["range"])
  })))
)

const NewNoise = Schema.Struct({ noise: Noise })

const noise = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/noise", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.noise(yield* param("id")))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/noise", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.startCleaning(yield* param("id")), 202)
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/noise/choice", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    return json(yield* media.setNoise(id, (yield* body(NewNoise)).noise))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/noise/:noise/:name", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const strength = yield* Schema.decodeUnknownEffect(Cleaned)(yield* param("noise")).pipe(Effect.mapError(() => notFound("Такой очистки звука нет")))
    const id = yield* param("id")
    const name = yield* param("name")
    const target = yield* media.cleanedFile(id, strength, name).pipe(
      Effect.catchTag("ApiError", (error) => error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error))
    )
    if (target === undefined) {
      yield* media.preview(id, name)
      return HttpServerResponse.empty({ status: 307, headers: {
        location: `/api/projects/${encodeURIComponent(id)}/videos/${encodeURIComponent(name)}/preview`,
        "cache-control": "no-store"
      } })
    }
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  })))
)

const NewVideos = Schema.Struct({ videos: Schema.Array(Pick).check(Schema.isMinLength(1)) })

const videos = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/videos", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ videos: yield* media.videos(yield* param("id")) })
  }))),
  HttpRouter.add("POST", "/api/projects/:id/videos", reply(Effect.gen(function*() {
    const media = yield* Media
    const store = yield* Projects
    const id = yield* param("id")
    const input = yield* body(NewVideos)
    yield* media.reuse(id, input.videos)
    return json({ project: yield* store.get(id) })
  }))),
  HttpRouter.add("GET", "/api/projects/:id/timeline", reply(Effect.gen(function*() {
    const media = yield* Media
    const gather = yield* Gather
    const id = yield* param("id")
    const gathering = yield* gather.running(id)
    const view = yield* media.timeline(id)
    return json({ ...view, gathering, gatherFailed: yield* gather.failed(id) } satisfies TimelinePage)
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/timeline", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    const input = yield* body(SaveEdits)
    return json(yield* media.mergeEdits(id, input.base, input.edits))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/library", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.library(yield* param("id")))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/videos/:name/preview", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const target = yield* media.preview(yield* param("id"), yield* param("name"))
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("POST", "/api/projects/:id/videos/:name/retry", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ video: yield* media.retry(yield* param("id"), yield* param("name")) })
  })))
)

const refuse = (message: string) => HttpServerResponse.jsonUnsafe({ error: message }, { status: 403 })

const homeOnly = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const settings = yield* Settings
      const remote = Option.getOrUndefined(request.remoteAddress)
      if (remote !== undefined && !isHomeAddress(remote)) {
        return refuse("Студия открывается только из домашней сети")
      }
      if (!isAllowedHost(request.headers["host"], allowedHosts(settings.port))) {
        return refuse("Студия открывается только из домашней сети")
      }
      if (!isSameOrigin(request.headers["origin"], request.headers["host"])) {
        return refuse("Запрос пришёл с чужой страницы")
      }
      return yield* httpEffect
    }),
  { global: true }
)

export const apiRoutes = Layer.mergeAll(projects, brief, rules, chat, uploads, videos, reel, posts, retouch, looksRoutes, noise, homeOnly)
