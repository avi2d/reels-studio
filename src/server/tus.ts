import { Crypto, Effect, FileSystem, Path, Schema, Stream } from "effect"
import { HttpServerResponse, type HttpServerRequest } from "effect/http"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"

const TUS_VERSION = "1.0.0"
const OFFSET_TYPE = "application/offset+octet-stream"
const TUS_HEADERS = { "tus-resumable": TUS_VERSION }

const Folder = Schema.Literals(["source", "attached"])
export type Folder = typeof Folder.Type

const UploadMeta = Schema.fromJsonString(Schema.Struct({
  length: Schema.Finite,
  filename: Schema.String,
  into: Schema.optionalKey(Folder),
  completed: Schema.optionalKey(Schema.String)
}))
type UploadMeta = typeof UploadMeta.Type
const decodeMeta = Schema.decodeUnknownEffect(UploadMeta)
const encodeMeta = Schema.encodeEffect(UploadMeta)

const UPLOAD_ID = /^[0-9a-f-]{36}$/

const UNAVAILABLE = "Не удалось записать файл."

const orBroken = orUnavailable("the upload failed", UNAVAILABLE)

export const parseMetadata = (header: string | undefined): ReadonlyMap<string, string> => {
  const pairs = (header ?? "").split(",").map((pair) => pair.trim().split(" ")).filter((pair) => pair[0] !== "")
  return new Map(pairs.map(([key, value]) => [key ?? "", Buffer.from(value ?? "", "base64").toString("utf8")]))
}

const FORBIDDEN = new Set(["<", ">", ":", "\"", "|", "?", "*"])
const isPrintable = (char: string): boolean => (char.codePointAt(0) ?? 0) > 31 && !FORBIDDEN.has(char)

export const safeFileName = (name: string | undefined): string => {
  const base = (name ?? "").split(/[\\/]/).at(-1) ?? ""
  const clean = Array.from(base).filter(isPrintable).join("").replace(/^\.+/, "").trim().slice(0, 200)
  return clean === "" ? "video" : clean
}

export const numbered = (name: string, attempt: number): string => {
  if (attempt === 0) return name
  const dot = name.lastIndexOf(".")
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  return `${stem} (${attempt + 1})${extension}`
}

const wholeNumber = (value: string | undefined): number | undefined =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined

const requireVersion = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<void, ApiError> =>
  request.headers["tus-resumable"] === TUS_VERSION
    ? Effect.void
    : Effect.fail(new ApiError({ status: 412, message: `Нужен заголовок Tus-Resumable: ${TUS_VERSION}` }))

const paths = Effect.fnUntraced(function*(dir: string, uploadId: string) {
  const path = yield* Path.Path
  if (!UPLOAD_ID.test(uploadId)) return yield* notFound("Такой загрузки нет")
  return {
    meta: path.join(dir, "uploads", `${uploadId}.json`),
    part: path.join(dir, "uploads", `${uploadId}.part`)
  }
})

const readMeta = Effect.fnUntraced(function*(file: string) {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(file).pipe(orBroken)
  if (!exists) return yield* notFound("Такой загрузки нет")
  const text = yield* fs.readFileString(file).pipe(orBroken)
  return yield* decodeMeta(text).pipe(orBroken)
})

const writeMeta = Effect.fnUntraced(function*(file: string, meta: UploadMeta) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* encodeMeta(meta).pipe(orBroken)
  yield* fs.writeFileString(file, text).pipe(orBroken)
})

const offsetOf = Effect.fnUntraced(function*(part: string, meta: UploadMeta) {
  const fs = yield* FileSystem.FileSystem
  if (meta.completed !== undefined) return meta.length
  const info = yield* fs.stat(part).pipe(orBroken)
  return Number(info.size)
})

export const create = Effect.fn("tus.create")(function*(
  request: HttpServerRequest.HttpServerRequest,
  dir: string,
  location: string,
  into: Folder
) {
  yield* requireVersion(request)
  const fs = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const length = wholeNumber(request.headers["upload-length"])
  if (length === undefined || length === 0) return yield* badRequest("Нужен заголовок Upload-Length с размером файла")
  const uploadId = yield* crypto.randomUUIDv4.pipe(orBroken)
  const files = yield* paths(dir, uploadId)
  const filename = safeFileName(parseMetadata(request.headers["upload-metadata"]).get("filename"))
  yield* fs.writeFile(files.part, new Uint8Array()).pipe(orBroken)
  yield* writeMeta(files.meta, { length, filename, into })
  return HttpServerResponse.empty({ status: 201, headers: { ...TUS_HEADERS, location: `${location}/${uploadId}` } })
})

export const head = Effect.fn("tus.head")(function*(
  request: HttpServerRequest.HttpServerRequest,
  dir: string,
  uploadId: string
) {
  yield* requireVersion(request)
  const files = yield* paths(dir, uploadId)
  const meta = yield* readMeta(files.meta)
  const offset = yield* offsetOf(files.part, meta)
  return HttpServerResponse.empty({
    status: 200,
    headers: {
      ...TUS_HEADERS,
      "upload-offset": String(offset),
      "upload-length": String(meta.length),
      "cache-control": "no-store"
    }
  })
})

const freeName = (source: string, name: string, attempt: number): Effect.Effect<string, ApiError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const candidate = numbered(name, attempt)
    const taken = yield* fs.exists(path.join(source, candidate)).pipe(orBroken)
    return taken ? yield* freeName(source, name, attempt + 1) : candidate
  })

const finish = Effect.fnUntraced(function*(dir: string, files: { meta: string; part: string }, meta: UploadMeta) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = path.join(dir, meta.into ?? "source")
  yield* fs.makeDirectory(target, { recursive: true }).pipe(orBroken)
  const name = yield* freeName(target, meta.filename, 0)
  yield* fs.rename(files.part, path.join(target, name)).pipe(orBroken)
  yield* writeMeta(files.meta, { ...meta, completed: name })
})

export const completedName = Effect.fn("tus.completedName")(function*(dir: string, uploadId: string, into: Folder) {
  const files = yield* paths(dir, uploadId)
  const meta = yield* readMeta(files.meta)
  if ((meta.into ?? "source") !== into || meta.completed === undefined) return yield* badRequest("Файл ещё не загружен. Прикрепите его ещё раз.")
  return meta.completed
})

export const patch = Effect.fn("tus.patch")(function*(
  request: HttpServerRequest.HttpServerRequest,
  dir: string,
  uploadId: string
) {
  yield* requireVersion(request)
  const fs = yield* FileSystem.FileSystem
  if (request.headers["content-type"] !== OFFSET_TYPE) {
    return yield* new ApiError({ status: 415, message: `Нужен Content-Type: ${OFFSET_TYPE}` })
  }
  const files = yield* paths(dir, uploadId)
  const meta = yield* readMeta(files.meta)
  const offset = yield* offsetOf(files.part, meta)
  if (wholeNumber(request.headers["upload-offset"]) !== offset) {
    return yield* new ApiError({ status: 409, message: `Сервер уже принял ${offset} байт` })
  }
  if (offset + (wholeNumber(request.headers["content-length"]) ?? 0) > meta.length) {
    return yield* new ApiError({ status: 413, message: "Часть больше, чем остаток файла" })
  }
  if (meta.completed === undefined) {
    yield* request.stream.pipe(Stream.run(fs.sink(files.part, { flag: "a" })), orBroken)
  }
  const written = yield* offsetOf(files.part, meta)
  if (written > meta.length) {
    yield* fs.truncate(files.part, offset).pipe(orBroken)
    return yield* new ApiError({ status: 413, message: "Часть больше, чем остаток файла" })
  }
  if (written === meta.length && meta.completed === undefined) yield* finish(dir, files, meta)
  return HttpServerResponse.empty({ status: 204, headers: { ...TUS_HEADERS, "upload-offset": String(written) } })
})
