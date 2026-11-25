import { Data, Effect, FileSystem, Layer, Path } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { HOME_PATH, PROJECT_PREFIX, STUDIO_PATH, VIDEOS_PATH } from "../shared/page.ts"
import { Settings } from "./settings.ts"

class BundleFailed extends Data.TaggedError("BundleFailed")<{ readonly message: string }> {}

const bundle = (entry: string): Effect.Effect<string, BundleFailed> =>
  Effect.tryPromise({
    try: () => Bun.build({ entrypoints: [entry], target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' } }).then((built) => built.outputs[0]?.text() ?? ""),
    catch: (cause) => new BundleFailed({ message: `The page file ${entry} did not build: ${String(cause)}` })
  })

const NO_STORE = { "cache-control": "no-store" }
const KEEP_A_DAY = { "cache-control": "public, max-age=86400" }
const SHEETS = ["fonts.css", "app.css", "work.css", "timeline.css", "chat.css"]
const STUDIO_SHEETS = ["fonts.css", "studio/studio.css"]
const FONTS = ["onest-cyrillic.woff2", "onest-latin.woff2", "unbounded-cyrillic.woff2", "unbounded-latin.woff2"]

export const pageRoutes = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const settings = yield* Settings
  const web = path.join(settings.root, "src", "web")
  const html = yield* fs.readFileString(path.join(web, "index.html"))
  const theme = yield* bundle(path.join(web, "theme.css"))
  const sheets = yield* Effect.forEach(SHEETS, (name) => fs.readFileString(path.join(web, name)))
  const css = [theme, ...sheets].join("\n")
  const script = yield* bundle(path.join(web, "app.ts"))
  const fonts = yield* Effect.forEach(FONTS, (name) =>
    Effect.map(fs.readFile(path.join(web, "fonts", name)), (bytes) =>
      HttpRouter.add("GET", `/fonts/${name}`, HttpServerResponse.uint8Array(bytes, { contentType: "font/woff2", headers: KEEP_A_DAY }))))
  const subtitleFont = yield* fs.readFile(path.join(settings.root, "brands", "azalia", "fonts", "NotoSerifDisplay-Regular.ttf"))
  const studioHtml = yield* fs.readFileString(path.join(web, "studio", "index.html"))
  const studioSheets = yield* Effect.forEach(STUDIO_SHEETS, (name) => fs.readFileString(path.join(web, name)))
  const studioScript = yield* bundle(path.join(web, "studio", "main.ts"))
  const page = HttpServerResponse.text(html, { contentType: "text/html; charset=utf-8", headers: NO_STORE })
  const studioPage = HttpServerResponse.text(studioHtml, { contentType: "text/html; charset=utf-8", headers: NO_STORE })
  return Layer.mergeAll(
    HttpRouter.add("GET", HOME_PATH, page),
    HttpRouter.add("GET", VIDEOS_PATH, page),
    HttpRouter.add("GET", `${PROJECT_PREFIX}:id`, page),
    HttpRouter.add("GET", STUDIO_PATH, studioPage),
    HttpRouter.add("GET", `${STUDIO_PATH}/:id`, studioPage),
    HttpRouter.add("GET", `${STUDIO_PATH}/:id/:step`, studioPage),
    HttpRouter.add("GET", "/studio.css", HttpServerResponse.text(studioSheets.join("\n"), { contentType: "text/css; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/studio.js", HttpServerResponse.text(studioScript, { contentType: "text/javascript; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.css", HttpServerResponse.text(css, { contentType: "text/css; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.js", HttpServerResponse.text(script, { contentType: "text/javascript; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/fonts/subtitle.ttf", HttpServerResponse.uint8Array(subtitleFont, { contentType: "font/ttf", headers: KEEP_A_DAY })),
    ...fonts
  )
}))
