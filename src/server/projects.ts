import { Array as Arr, Context, Crypto, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ApiError, badRequest, notFound } from "./api-error.ts"
import { Settings } from "./settings.ts"

const ProjectId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))

const Project = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  createdAt: Schema.String,
  model: Schema.optionalKey(Schema.String)
})
type Project = typeof Project.Type

type Stage = "created" | "uploaded"

export interface ProjectView extends Project {
  readonly stage: Stage
  readonly files: ReadonlyArray<{ readonly name: string; readonly size: number }>
}

const ProjectFile = Schema.fromJsonString(Project)
const decodeProject = Schema.decodeUnknownEffect(ProjectFile)
const encodeProject = Schema.encodeEffect(ProjectFile)
const decodeId = Schema.decodeUnknownEffect(ProjectId)

const UNAVAILABLE = "Папка проектов недоступна. Попробуйте открыть страницу ещё раз."

const orBroken = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, ApiError> =>
  effect.pipe(
    Effect.catch((cause) =>
      Effect.as(Effect.logError("the projects failed", cause), new ApiError({ status: 500, message: UNAVAILABLE })))
  )

export class Projects extends Context.Service<Projects, {
  readonly list: Effect.Effect<ReadonlyArray<ProjectView>, ApiError>
  readonly create: (title: string) => Effect.Effect<ProjectView, ApiError>
  readonly get: (id: string) => Effect.Effect<ProjectView, ApiError>
  readonly folder: (id: string) => Effect.Effect<string, ApiError>
  readonly setModel: (id: string, model: string) => Effect.Effect<void, ApiError>
}>()("reels-studio/Projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const settings = yield* Settings

      const folder = Effect.fn("Projects.folder")(function*(id: string) {
        const valid = yield* decodeId(id).pipe(Effect.mapError(() => notFound("Такого ролика нет")))
        const dir = path.join(settings.projectsDir, valid)
        const exists = yield* fs.exists(path.join(dir, "project.json")).pipe(orBroken)
        if (!exists) return yield* notFound("Такого ролика нет")
        return dir
      })

      const read = Effect.fn("Projects.read")(function*(dir: string) {
        const text = yield* fs.readFileString(path.join(dir, "project.json"))
        return yield* decodeProject(text)
      }, orBroken)

      const write = Effect.fn("Projects.write")(function*(dir: string, project: Project) {
        const text = yield* encodeProject(project)
        yield* fs.writeFileString(path.join(dir, "project.json"), text)
      }, orBroken)

      const view = Effect.fn("Projects.view")(function*(dir: string) {
        const project = yield* read(dir)
        const source = path.join(dir, "source")
        const names = yield* fs.readDirectory(source).pipe(orBroken)
        const files = yield* Effect.forEach(names.toSorted(), (name) =>
          fs.stat(path.join(source, name)).pipe(
            Effect.map((info) => ({ name, size: Number(info.size) })),
            orBroken
          ))
        const stage: Stage = files.length > 0 ? "uploaded" : "created"
        return { ...project, stage, files }
      })

      const get = (id: string) => Effect.flatMap(folder(id), view)

      const list = Effect.gen(function*() {
        yield* fs.makeDirectory(settings.projectsDir, { recursive: true }).pipe(orBroken)
        const names = yield* fs.readDirectory(settings.projectsDir).pipe(orBroken)
        const views = yield* Effect.forEach(names, (name) => Effect.option(get(name)))
        return Arr.getSomes(views).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      })

      const create = Effect.fn("Projects.create")(function*(title: string) {
        const trimmed = title.trim()
        if (trimmed.length === 0 || trimmed.length > 120) {
          return yield* badRequest("Назовите ролик: от 1 до 120 знаков")
        }
        const now = yield* DateTime.now
        const uuid = yield* crypto.randomUUIDv4.pipe(orBroken)
        const id = `${DateTime.formatIso(now).slice(0, 10)}-${uuid.slice(0, 8)}`
        const dir = path.join(settings.projectsDir, id)
        yield* fs.makeDirectory(path.join(dir, "source"), { recursive: true }).pipe(orBroken)
        yield* fs.makeDirectory(path.join(dir, "uploads"), { recursive: true }).pipe(orBroken)
        yield* write(dir, { id, title: trimmed, createdAt: DateTime.formatIso(now) })
        return yield* view(dir)
      })

      const setModel = Effect.fn("Projects.setModel")(function*(id: string, model: string) {
        const dir = yield* folder(id)
        const project = yield* read(dir)
        yield* write(dir, { ...project, model })
      })

      return Projects.of({ list, create, get, folder, setModel })
    })
  )
}
