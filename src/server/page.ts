import { Data, Effect, FileSystem, Layer, Path } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { HOME_PATH, PROJECT_PREFIX, projectPath } from "../shared/page.ts"
import { Settings } from "./settings.ts"

class BundleFailed extends Data.TaggedError("BundleFailed")<{ readonly message: string }> {}

const bundle = (entry: string): Effect.Effect<string, BundleFailed> =>
  Effect.tryPromise({
    try: () => Bun.build({ entrypoints: [entry], target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' } }).then((built) => built.outputs[0]?.text() ?? ""),
    catch: (cause) => new BundleFailed({ message: `The page file ${entry} did not build: ${String(cause)}` })
  })

const NO_STORE = { "cache-control": "no-store" }
const KEEP_A_DAY = { "cache-control": "public, max-age=86400" }
const SHEETS = ["fonts.css", "frame.css", "studio/studio.css", "studio/planning.css", "studio/montage.css", "studio/look.css", "studio/done.css"]
const FONTS = ["onest-cyrillic.woff2", "onest-latin.woff2"]
const OLD_STUDIO_PATH = "/new"
const VIDEOS_PATH = "/videos"

const moved = (to: (params: Readonly<Record<string, string | undefined>>) => string) =>
  Effect.map(HttpRouter.params, (params) => HttpServerResponse.redirect(to(params), { status: 301, headers: NO_STORE }))

export const pageRoutes = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const settings = yield* Settings
  const web = path.join(settings.root, "src", "web")
  const html = yield* fs.readFileString(path.join(web, "studio", "index.html"))
  const sheets = yield* Effect.forEach(SHEETS, (name) => fs.readFileString(path.join(web, name)))
  const script = yield* bundle(path.join(web, "studio", "main.ts"))
  const fonts = yield* Effect.forEach(FONTS, (name) =>
    Effect.map(fs.readFile(path.join(web, "fonts", name)), (bytes) =>
      HttpRouter.add("GET", `/fonts/${name}`, HttpServerResponse.uint8Array(bytes, { contentType: "font/woff2", headers: KEEP_A_DAY }))))
  const subtitleFont = yield* fs.readFile(path.join(settings.root, "brands", "azalia", "fonts", "NotoSerifDisplay-Regular.ttf"))
  const page = HttpServerResponse.text(html, { contentType: "text/html; charset=utf-8", headers: NO_STORE })
  return Layer.mergeAll(
    HttpRouter.add("GET", HOME_PATH, page),
    HttpRouter.add("GET", `${PROJECT_PREFIX}:id`, page),
    HttpRouter.add("GET", `${PROJECT_PREFIX}:id/:step`, page),
    HttpRouter.add("GET", OLD_STUDIO_PATH, moved(() => HOME_PATH)),
    HttpRouter.add("GET", `${OLD_STUDIO_PATH}/:id`, moved(({ id = "" }) => projectPath(id))),
    HttpRouter.add("GET", `${OLD_STUDIO_PATH}/:id/:step`, moved(({ id = "", step = "" }) => `${projectPath(id)}/${step}`)),
    HttpRouter.add("GET", VIDEOS_PATH, moved(() => HOME_PATH)),
    HttpRouter.add("GET", "/studio.css", HttpServerResponse.text(sheets.join("\n"), { contentType: "text/css; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/studio.js", HttpServerResponse.text(script, { contentType: "text/javascript; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/fonts/subtitle.ttf", HttpServerResponse.uint8Array(subtitleFont, { contentType: "font/ttf", headers: KEEP_A_DAY })),
    ...fonts
  )
}))
