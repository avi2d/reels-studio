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

export const pageRoutes = Layer.unwrap(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const settings = yield* Settings
  const web = path.join(settings.root, "src", "web")
  const html = yield* fs.readFileString(path.join(web, "index.html"))
  const css = yield* fs.readFileString(path.join(web, "app.css"))
  const script = yield* bundle(path.join(web, "app.ts"))
  return Layer.mergeAll(
    HttpRouter.add("GET", "/", HttpServerResponse.text(html, { contentType: "text/html; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.css", HttpServerResponse.text(css, { contentType: "text/css; charset=utf-8", headers: NO_STORE })),
    HttpRouter.add("GET", "/app.js", HttpServerResponse.text(script, { contentType: "text/javascript; charset=utf-8", headers: NO_STORE }))
  )
}))
