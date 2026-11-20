import { Data, Effect, Option, Schema } from "effect"
import { LibraryVideo, type Pick } from "../shared/library.ts"
import { VideoView } from "../shared/plan.ts"
import { ReelView } from "../shared/reel.ts"
import { TimelineView, type Edits } from "../shared/timeline.ts"

export class Failed extends Data.TaggedError("Failed")<{ readonly message: string }> {}
export class Offline extends Data.TaggedError("Offline")<{}> {}

const Effort = Schema.Literals(["low", "medium", "high"])
export type Effort = typeof Effort.Type

const ProjectView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Effort),
  stage: Schema.Literals(["created", "uploaded"]),
  files: Schema.Array(Schema.Struct({ name: Schema.String, size: Schema.Finite })),
  cover: Schema.optionalKey(Schema.String)
})
export type ProjectView = typeof ProjectView.Type

const Message = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  failed: Schema.optionalKey(Schema.String)
})
export type Message = typeof Message.Type

export const ChatEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("delta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("step"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({ type: Schema.Literal("retry") }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("done") })
])
export type ChatEvent = typeof ChatEvent.Type

const ErrorBody = Schema.Struct({ error: Schema.String })
const decodeError = Schema.decodeUnknownOption(ErrorBody)

export const send = (url: string, init?: RequestInit): Effect.Effect<Response, Offline> =>
  Effect.tryPromise({ try: (signal) => fetch(url, { ...init, signal }), catch: () => new Offline() })

const readJson = (response: Response): Effect.Effect<unknown, Failed> =>
  Effect.tryPromise({ try: () => response.json(), catch: () => new Failed({ message: "Студия ответила непонятно" }) })

export const failure = (response: Response): Effect.Effect<Failed> =>
  readJson(response).pipe(
    Effect.map((body) => {
      const known = Option.getOrUndefined(decodeError(body))
      return new Failed({ message: known?.error ?? `Студия ответила ошибкой ${response.status}` })
    }),
    Effect.catch((error) => Effect.succeed(error))
  )

const call = <A>(schema: Schema.ConstraintDecoder<A>, url: string, init?: RequestInit): Effect.Effect<A, Failed> =>
  Effect.gen(function*() {
    const response = yield* send(url, init)
    if (!response.ok) return yield* Effect.flatMap(failure(response), Effect.fail)
    const body = yield* readJson(response)
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new Failed({ message: "Студия ответила непонятно" }))
    )
  }).pipe(
    Effect.catchTag("Offline", () => Effect.fail(new Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." })))
  )

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
})

const OneProject = Schema.Struct({ project: ProjectView })
const Messages = Schema.Struct({ messages: Schema.Array(Message) })

export const listProjects = call(Schema.Struct({ projects: Schema.Array(ProjectView) }), "/api/projects")
export const getModels = call(Schema.Struct({ models: Schema.Array(Schema.String) }), "/api/models")

export const createProject = (title: string): Effect.Effect<typeof OneProject.Type, Failed> =>
  call(OneProject, "/api/projects", post({ title }))

export const getProject = (id: string): Effect.Effect<typeof OneProject.Type, Failed> =>
  call(OneProject, `/api/projects/${id}`)

export const getChat = (id: string): Effect.Effect<typeof Messages.Type, Failed> =>
  call(Messages, `/api/projects/${id}/chat`)

const Videos = Schema.Struct({ videos: Schema.Array(VideoView) })

export const getVideos = (id: string): Effect.Effect<typeof Videos.Type, Failed> =>
  call(Videos, `/api/projects/${id}/videos`)

export const retryVideo = (id: string, name: string): Effect.Effect<void, Failed> =>
  call(Schema.Struct({ video: VideoView }), `/api/projects/${id}/videos/${encodeURIComponent(name)}/retry`, { method: "POST" }).pipe(Effect.asVoid)

export const previewUrl = (id: string, name: string): string =>
  `/api/projects/${id}/videos/${encodeURIComponent(name)}/preview`

export const getTimeline = (id: string): Effect.Effect<TimelineView, Failed> =>
  call(TimelineView, `/api/projects/${id}/timeline`)

export const saveEdits = (id: string, edits: Edits): Effect.Effect<{ readonly saved: string }, Failed> =>
  call(Schema.Struct({ saved: Schema.String }), `/api/projects/${id}/timeline`, { ...post(edits), method: "PUT" })

const Library = Schema.Struct({ videos: Schema.Array(LibraryVideo) })

export const getLibrary = (id: string): Effect.Effect<typeof Library.Type, Failed> =>
  call(Library, `/api/projects/${id}/library`)

export const addVideos = (id: string, videos: ReadonlyArray<Pick>): Effect.Effect<typeof OneProject.Type, Failed> =>
  call(OneProject, `/api/projects/${id}/videos`, post({ videos }))

export const getReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel`)

export const buildReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel`, { method: "POST" })

export const cancelReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel/build`, { method: "DELETE" })

export const reelUrl = (id: string, made: string): string =>
  `/api/projects/${id}/reel/file?made=${encodeURIComponent(made)}`

export const reelDownloadUrl = (id: string): string =>
  `/api/projects/${id}/reel/download`

export const removeProject = (id: string): Effect.Effect<{ readonly removed: string }, Failed> =>
  call(Schema.Struct({ removed: Schema.String }), `/api/projects/${id}`, { method: "DELETE" })

export const postChat = (id: string, text: string, model: string, effort: Effort): Effect.Effect<Response, Offline> =>
  send(`/api/projects/${id}/chat`, post({ text, model, effort }))
