import { Array as Arr, Context, Crypto, DateTime, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"
import { places } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const ProjectId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))

export const Effort = Schema.Literals(["low", "medium", "high"])
export type Effort = typeof Effort.Type

const Project = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  createdAt: Schema.String,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Effort)
})
type Project = typeof Project.Type

type Stage = "created" | "uploaded"

export interface ProjectView extends Project {
  readonly stage: Stage
  readonly files: ReadonlyArray<{ readonly name: string; readonly size: number }>
  readonly cover?: string
}

const ProjectFile = Schema.fromJsonString(Project)
const decodeProject = Schema.decodeUnknownEffect(ProjectFile)
const encodeProject = Schema.encodeEffect(ProjectFile)
const decodeId = Schema.decodeUnknownEffect(ProjectId)

const UNAVAILABLE = "Папка проектов недоступна. Попробуйте открыть страницу ещё раз."

const orBroken = orUnavailable("the projects failed", UNAVAILABLE)

export class Projects extends Context.Service<Projects, {
  readonly list: Effect.Effect<ReadonlyArray<ProjectView>, ApiError>
  readonly create: (title: string) => Effect.Effect<ProjectView, ApiError>
  readonly get: (id: string) => Effect.Effect<ProjectView, ApiError>
  readonly folder: (id: string) => Effect.Effect<string, ApiError>
  readonly setChoice: (id: string, model: string, effort: Effort) => Effect.Effect<void, ApiError>
  readonly remove: (id: string) => Effect.Effect<void, ApiError>
}>()("reels-studio/Projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const settings = yield* Settings
      const removing = yield* Ref.make<ReadonlySet<string>>(new Set())

      const folder = Effect.fn("Projects.folder")(function*(id: string) {
        const valid = yield* decodeId(id).pipe(Effect.mapError(() => notFound("Такого ролика нет")))
        if ((yield* Ref.get(removing)).has(valid)) return yield* notFound("Такого ролика нет")
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
        const watchable = yield* Effect.forEach(files, (file) => fs.exists(places({ dir, name: file.name }).preview).pipe(orBroken))
        const cover = files.find((_, index) => watchable[index] === true)?.name
        return { ...project, stage, files, ...(cover === undefined ? {} : { cover }) }
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

      const setChoice = Effect.fn("Projects.setChoice")(function*(id: string, model: string, effort: Effort) {
        const dir = yield* folder(id)
        const project = yield* read(dir)
        yield* write(dir, { ...project, model, effort })
      })

      const remove = Effect.fn("Projects.remove")(function*(id: string) {
        const dir = yield* folder(id)
        yield* Ref.update(removing, (set) => new Set([...set, id]))
        yield* fs.remove(dir, { recursive: true }).pipe(
          orUnavailable("the project was not removed", "Не получилось удалить ролик. Попробуйте ещё раз."),
          Effect.ensuring(Ref.update(removing, (set) => new Set([...set].filter((other) => other !== id))))
        )
      })

      return Projects.of({ list, create, get, folder, setChoice, remove })
    })
  )
}
