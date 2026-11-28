import { Config, Context, Effect, Layer, Path, Schema } from "effect"

const DEFAULT_MODELS = [
  "claude-bridge/claude-opus-5-5",
  "claude-bridge/claude-sonnet-5-5",
  "openai/gpt-6.1-sol"
]

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const config = Config.all({
  host: Config.String("REELS_HOST").pipe(Config.withDefault("0.0.0.0")),
  port: Config.Port("REELS_PORT").pipe(Config.withDefault(8765)),
  projectsDir: Config.String("REELS_PROJECTS_DIR").pipe(Config.withDefault("projects")),
  pi: Config.String("REELS_PI").pipe(Config.withDefault("pi")),
  models: Config.Array(Schema.String, "REELS_MODELS").pipe(Config.withDefault(DEFAULT_MODELS)),
  heavy: Config.String("REELS_HEAVY").pipe(Config.withDefault("")),
  encoder: Config.String("REELS_ENCODER").pipe(Config.withDefault("libx264")),
  chrome: Config.String("REELS_CHROME").pipe(Config.withDefault(process.platform === "darwin" ? MAC_CHROME : "google-chrome"))
})

export interface StudioSettings {
  readonly host: string
  readonly port: number
  readonly projectsDir: string
  readonly pi: string
  readonly models: ReadonlyArray<string>
  readonly heavy: ReadonlyArray<string>
  readonly encoder: string
  readonly chrome: string
  readonly root: string
}

export class Settings extends Context.Service<Settings, StudioSettings>()("reels-studio/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const path = yield* Path.Path
      const values = yield* config
      const root = path.resolve(import.meta.dir, "..", "..")
      const heavy = values.heavy.split(" ").filter((part) => part !== "")
      return Settings.of({ ...values, heavy, projectsDir: path.resolve(values.projectsDir), root })
    })
  )
}
