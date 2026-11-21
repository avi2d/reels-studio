import { Effect, FileSystem } from "effect"
import { orUnavailable } from "./api-error.ts"
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
