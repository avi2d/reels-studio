import { Data, Effect, FileSystem, Layer, Path } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Settings } from "./settings.ts"

class BundleFailed extends Data.TaggedError("BundleFailed")<{ readonly message: string }> {}

const bundle = (entry: string): Effect.Effect<string, BundleFailed> =>
  Effect.tryPromise({
    try: () => Bun.build({ entrypoints: [entry], target: "browser", minify: true }).then((built) => built.outputs[0]?.text() ?? ""),
    catch: (cause) => new BundleFailed({ message: `The page script did not build: ${String(cause)}` })
  })

const NO_STORE = { "cache-control": "no-store" }
const KEEP_A_DAY = { "cache-control": "public, max-age=86400" }
const SHEETS = ["app.css", "work.css", "timeline.css", "chat.css"]
const FONTS = ["onest-cyrillic.woff2", "onest-latin.woff2", "unbounded-cyrillic.woff2", "unbounded-latin.woff2"]

export const pageRoutes = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const settings = yield* Settings
  const web = path.join(settings.root, "src", "web")
  const html = yield* fs.readFileString(path.join(web, "index.html"))
  const sheets = yield* Effect.forEach(SHEETS, (name) => fs.readFileString(path.join(web, name)))
  const css = sheets.join("\n")
  const script = yield* bundle(path.join(web, "app.ts"))
  const fonts = yield* Effect.forEach(FONTS, (name) =>
    Effect.map(fs.readFile(path.join(web, "fonts", name)), (bytes) =>
      HttpRouter.add("GET", `/fonts/${name}`, HttpServerResponse.uint8Array(bytes, { contentType: "font/woff2", headers: KEEP_A_DAY }))))
  return Layer.mergeAll(
    HttpRouter.add("GET", "/", HttpServerResponse.text(html, { contentType: "text/html; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.css", HttpServerResponse.text(css, { contentType: "text/css; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.js", HttpServerResponse.text(script, { contentType: "text/javascript; charset=utf-8", headers: NO_STORE })),
    ...fonts
  )
}))
