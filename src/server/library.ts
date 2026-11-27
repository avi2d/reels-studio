import { Effect, FileSystem } from "effect"
import { notFound, orUnavailable } from "./api-error.ts"
import { places, previewFlag, type Job } from "./media-jobs.ts"
import { sourceNames } from "./reuse.ts"
import { Settings } from "./settings.ts"

// Inside the projects folder so a hard link into a reel never crosses file systems. The dot keeps it out of the reel ids.
export const libraryDir = (projectsDir: string): string => `${projectsDir}/.library`

export const openLibrary = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const dir = libraryDir(settings.projectsDir)
  yield* Effect.forEach(["source", "uploads"], (folder) => fs.makeDirectory(`${dir}/${folder}`, { recursive: true }), { discard: true }).pipe(
    orUnavailable("the library is unavailable", "Папка загруженных видео недоступна. Попробуйте ещё раз.")
  )
  return dir
})

export const uploadedJob = Effect.fnUntraced(function*(name: string) {
  const dir = yield* openLibrary
  if (!(yield* sourceNames(dir)).includes(name)) return yield* notFound("Такого загруженного видео нет")
  const job: Job = { dir, name }
  return job
})

export const removeFiles = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  yield* Effect.forEach([...Object.values(places(job)), previewFlag(job)], (path) => fs.remove(path, { recursive: true, force: true }), { discard: true })
})
