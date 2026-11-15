import { Effect, Schedule } from "effect"
import { Failed, failure, Offline, send } from "./api.ts"
import { encodeMetadata } from "./format.ts"

const CHUNK = 8 * 1024 * 1024
const TUS = { "tus-resumable": "1.0.0" }

export interface Progress {
  readonly sent: number
  readonly total: number
  readonly waiting: boolean
}

const offsetFrom = (response: Response): Effect.Effect<number, Failed> => {
  const offset = Number(response.headers.get("upload-offset") ?? "x")
  return Number.isInteger(offset) ? Effect.succeed(offset) : Effect.fail(new Failed({ message: "Студия не сказала, сколько уже принято" }))
}

const refuse = (response: Response) => Effect.flatMap(failure(response), Effect.fail)

const resumeOffset = Effect.fnUntraced(function*(url: string) {
  const response = yield* send(url, { method: "HEAD", headers: TUS })
  if (response.status === 404) return undefined
  if (!response.ok) return yield* refuse(response)
  return yield* offsetFrom(response)
})

const start = Effect.fnUntraced(function*(projectId: string, file: File) {
  const response = yield* send(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    headers: { ...TUS, "upload-length": String(file.size), "upload-metadata": encodeMetadata(file.name) }
  })
  const location = response.headers.get("location")
  if (response.status !== 201 || location === null) return yield* refuse(response)
  return location
})

const sendChunk = Effect.fnUntraced(function*(url: string, file: File, offset: number) {
  const response = yield* send(url, {
    method: "PATCH",
    headers: { ...TUS, "upload-offset": String(offset), "content-type": "application/offset+octet-stream" },
    body: file.slice(offset, offset + CHUNK)
  })
  if (response.status === 409) return yield* Effect.map(resumeOffset(url), (known) => known ?? 0)
  if (response.status !== 204) return yield* refuse(response)
  return yield* offsetFrom(response)
})

const sendRest = (
  url: string,
  file: File,
  offset: number,
  onProgress: (progress: Progress) => void
): Effect.Effect<void, Failed | Offline> =>
  Effect.gen(function*() {
    onProgress({ sent: offset, total: file.size, waiting: false })
    if (offset >= file.size) return
    const next = yield* sendChunk(url, file, offset)
    yield* sendRest(url, file, next, onProgress)
  })

export const upload = (
  projectId: string,
  file: File,
  onProgress: (progress: Progress) => void
): Effect.Effect<void, Failed> => {
  const key = `reels-upload:${projectId}:${file.name}:${file.size}:${file.lastModified}`
  const attempt = Effect.gen(function*() {
    const saved = localStorage.getItem(key)
    const known = saved === null ? undefined : yield* resumeOffset(saved)
    const url = saved !== null && known !== undefined ? saved : yield* start(projectId, file)
    localStorage.setItem(key, url)
    yield* sendRest(url, file, known ?? 0, onProgress)
    localStorage.removeItem(key)
  })
  if (file.size === 0) return Effect.fail(new Failed({ message: "Этот файл пустой. Выберите другой." }))
  return attempt.pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error instanceof Offline) onProgress({ sent: 0, total: file.size, waiting: true })
      })),
    Effect.retry({ while: (error) => error instanceof Offline, schedule: Schedule.spaced("3 seconds") }),
    Effect.catchTag("Offline", () => Effect.fail(new Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." })))
  )
}
