import { Data, Effect, Option, Schema } from "effect"
import { type App, BriefView, type NewTask } from "../shared/brief.ts"
import type { Visual } from "../shared/inserts.ts"
import { Message } from "../shared/chat.ts"
import { Offer, type Pick, UploadedVideo } from "../shared/library.ts"
import { VideoView } from "../shared/plan.ts"
import { ProjectView, type Effort } from "../shared/project.ts"
import { APP_FILE_NAME, ReelView, SoundCheck, type PictureSide } from "../shared/reel.ts"
import { type Post, Posts } from "../shared/posts.ts"
import type { Face } from "../shared/face.ts"
import { RetouchView, type RetouchPicture } from "../shared/retouch.ts"
import { NoiseView, type Cleaned, type Noise } from "../shared/noise.ts"
import { LooksView, type NewLooks } from "../shared/looks.ts"
import { Edits, TimelinePage } from "../shared/timeline.ts"
import { RulesView, type RuleId } from "../shared/rules.ts"

export class Failed extends Data.TaggedError("Failed")<{ readonly message: string }> {}
export class Offline extends Data.TaggedError("Offline")<{}> {}

export type { Effort, ProjectView } from "../shared/project.ts"

export type { Message } from "../shared/chat.ts"

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

const request = <A>(schema: Schema.ConstraintDecoder<A>, url: string, init?: RequestInit): Effect.Effect<A, Failed | Offline> =>
  Effect.gen(function*() {
    const response = yield* send(url, init)
    if (!response.ok) return yield* Effect.flatMap(failure(response), Effect.fail)
    const body = yield* readJson(response)
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new Failed({ message: "Студия ответила непонятно" }))
    )
  })

const requireConnection = <A>(work: Effect.Effect<A, Failed | Offline>): Effect.Effect<A, Failed> =>
  work.pipe(Effect.catchTag("Offline", () => Effect.fail(new Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." }))))

const call = <A>(schema: Schema.ConstraintDecoder<A>, url: string, init?: RequestInit): Effect.Effect<A, Failed> =>
  requireConnection(request(schema, url, init))

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

export const renameProject = (id: string, title: string): Effect.Effect<typeof OneProject.Type, Failed> =>
  call(OneProject, `/api/projects/${id}`, { ...post({ title }), method: "PATCH" })

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

export const getTimeline = (id: string): Effect.Effect<TimelinePage, Failed> =>
  call(TimelinePage, `/api/projects/${id}/timeline`)

export const saveEdits = (id: string, base: Edits, edits: Edits): Effect.Effect<Edits, Failed> =>
  call(Edits, `/api/projects/${id}/timeline`, { ...post({ base, edits }), method: "PUT" })

export const getLibrary = (id: string): Effect.Effect<Offer, Failed> =>
  call(Offer, `/api/projects/${id}/library`)

const Uploaded = Schema.Struct({ videos: Schema.Array(UploadedVideo) })

export const getUploadedForTransfer = request(Uploaded, "/api/library")

export const getUploaded = requireConnection(getUploadedForTransfer)

export const retryUploaded = (name: string): Effect.Effect<void, Failed> =>
  call(Schema.Struct({ video: UploadedVideo }), `/api/library/${encodeURIComponent(name)}/retry`, { method: "POST" }).pipe(Effect.asVoid)

export const removeUploaded = (name: string): Effect.Effect<void, Failed> =>
  call(Schema.Struct({ removed: Schema.String }), `/api/library/${encodeURIComponent(name)}`, { method: "DELETE" }).pipe(Effect.asVoid)

export const uploadedPreviewUrl = (name: string): string =>
  `/api/library/${encodeURIComponent(name)}/preview`

export const addVideos = (id: string, videos: ReadonlyArray<Pick>): Effect.Effect<typeof OneProject.Type, Failed> =>
  call(OneProject, `/api/projects/${id}/videos`, post({ videos }))

export const getReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel`)

export const buildReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel`, { method: "POST" })

export const cancelReel = (id: string): Effect.Effect<ReelView, Failed> =>
  call(ReelView, `/api/projects/${id}/reel/build`, { method: "DELETE" })

export const getSound = (id: string): Effect.Effect<SoundCheck, Failed> =>
  call(SoundCheck, `/api/projects/${id}/sound`)

const appQuery = (app: App | undefined): string => app === undefined ? "" : `&app=${APP_FILE_NAME[app]}`

export const reelUrl = (id: string, made: string, version: "after" | "before", app?: App): string =>
  `/api/projects/${id}/reel/file?made=${encodeURIComponent(made)}&version=${version}${appQuery(app)}`

export const reelPictureUrl = (id: string, made: string, join: number, side: PictureSide): string =>
  `/api/projects/${id}/reel/picture?made=${encodeURIComponent(made)}&join=${join}&side=${side}`

export const reelDownloadUrl = (id: string, made: string, app?: App): string =>
  `/api/projects/${id}/reel/download?made=${encodeURIComponent(made)}${appQuery(app)}`

export const getPosts = (id: string): Effect.Effect<Posts, Failed> =>
  call(Posts, `/api/projects/${id}/posts`)

export const savePost = (id: string, one: Post): Effect.Effect<Posts, Failed> =>
  call(Posts, `/api/projects/${id}/posts`, { ...post(one), method: "PUT" })

export const getRetouch = (id: string): Effect.Effect<RetouchView, Failed> =>
  call(RetouchView, `/api/projects/${id}/retouch`)

export const startRetouch = (id: string): Effect.Effect<RetouchView, Failed> =>
  call(RetouchView, `/api/projects/${id}/retouch`, { method: "POST" })

export const setFace = (id: string, face: Face): Effect.Effect<RetouchView, Failed> =>
  call(RetouchView, `/api/projects/${id}/retouch/face`, { ...post({ face }), method: "PUT" })

export const getLooks = (id: string): Effect.Effect<LooksView, Failed> =>
  call(LooksView, `/api/projects/${id}/looks`)

export const setLooks = (id: string, change: NewLooks): Effect.Effect<LooksView, Failed> =>
  call(LooksView, `/api/projects/${id}/looks`, { ...post(change), method: "PUT" })

export const retouchUrl = (id: string, name: RetouchPicture, made: string): string =>
  `/api/projects/${id}/retouch/${name}?made=${encodeURIComponent(made)}`

export const getNoise = (id: string): Effect.Effect<NoiseView, Failed> =>
  call(NoiseView, `/api/projects/${id}/noise`)

export const startCleaning = (id: string): Effect.Effect<NoiseView, Failed> =>
  call(NoiseView, `/api/projects/${id}/noise`, { method: "POST" })

export const setNoise = (id: string, noise: Noise): Effect.Effect<NoiseView, Failed> =>
  call(NoiseView, `/api/projects/${id}/noise/choice`, { ...post({ noise }), method: "PUT" })

export const cleanedPreviewUrl = (id: string, noise: Cleaned, name: string, made: string): string =>
  `/api/projects/${id}/noise/${noise}/${encodeURIComponent(name)}?made=${encodeURIComponent(made)}`

export const removeProject = (id: string): Effect.Effect<{ readonly removed: string }, Failed> =>
  call(Schema.Struct({ removed: Schema.String }), `/api/projects/${id}`, { method: "DELETE" })

export const postChat = (id: string, text: string, files: ReadonlyArray<string>, model: string, effort: Effort): Effect.Effect<Response, Offline> =>
  send(`/api/projects/${id}/chat`, post({ text, files, model, effort }))

export const stopChat = (id: string, token: string): Effect.Effect<void, Failed> =>
  call(Schema.Struct({ ok: Schema.Literal(true) }), `/api/projects/${id}/chat/stop`, post({ token })).pipe(Effect.asVoid)

export const getBrief = (id: string): Effect.Effect<BriefView, Failed> =>
  call(BriefView, `/api/projects/${id}/brief`)

export const saveBrief = (id: string, task: NewTask): Effect.Effect<BriefView, Failed> =>
  call(BriefView, `/api/projects/${id}/brief`, { ...post(task), method: "PUT" })

export const getRules = (id: string): Effect.Effect<RulesView, Failed> =>
  call(RulesView, `/api/projects/${id}/rules`)

export const keepRule = (id: string, rule: RuleId, kept: boolean): Effect.Effect<RulesView, Failed> =>
  call(RulesView, `/api/projects/${id}/rules/${rule}/kept`, { ...post({ kept }), method: "PUT" })

export const undoRule = (id: string): Effect.Effect<RulesView, Failed> =>
  call(RulesView, `/api/projects/${id}/rules/undo`, post({}))

export const coverUrl = (id: string, name: string): string =>
  `/api/projects/${id}/attachments/${encodeURIComponent(name)}/cover`

const clipUrl = (id: string, name: string): string =>
  `/api/projects/${id}/attachments/${encodeURIComponent(name)}/clip`

const visualUrl = (id: string, visual: Visual): string =>
  visual.kind === "page"
    ? `/api/projects/${id}/attachments/${encodeURIComponent(visual.file)}/page?${new URLSearchParams({ page: String(visual.page), quote: visual.quote })}`
    : coverUrl(id, visual.file)

export interface InsertUrls {
  readonly pictureUrl: (name: string) => string
  readonly visualUrl: (visual: Visual) => string
  readonly clipUrl: (name: string) => string
}

export const insertUrls = (id: string): InsertUrls => ({
  pictureUrl: (name: string): string => coverUrl(id, name),
  visualUrl: (visual: Visual): string => visualUrl(id, visual),
  clipUrl: (name: string): string => clipUrl(id, name)
})
