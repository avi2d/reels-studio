import { Config, Context, Effect, Layer, Path, Schema } from "effect"

const DEFAULT_MODELS = [
  "claude-bridge/claude-sonnet-5-5",
  "claude-bridge/claude-opus-5-5",
  "openai/gpt-6.1-sol",
  "openrouter/google/gemini-3.8-flash",
  "opencode-go/kimi-k3"
]

const config = Config.all({
  host: Config.String("REELS_HOST").pipe(Config.withDefault("0.0.0.0")),
  port: Config.Port("REELS_PORT").pipe(Config.withDefault(8765)),
  projectsDir: Config.String("REELS_PROJECTS_DIR").pipe(Config.withDefault("projects")),
  pi: Config.String("REELS_PI").pipe(Config.withDefault("pi")),
  models: Config.Array(Schema.String, "REELS_MODELS").pipe(Config.withDefault(DEFAULT_MODELS))
})

export interface StudioSettings {
  readonly host: string
  readonly port: number
  readonly projectsDir: string
  readonly pi: string
  readonly models: ReadonlyArray<string>
  readonly root: string
}

export class Settings extends Context.Service<Settings, StudioSettings>()("reels-studio/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function*() {
      const path = yield* Path.Path
      const values = yield* config
      const root = path.resolve(import.meta.dir, "..", "..")
      return Settings.of({ ...values, projectsDir: path.resolve(values.projectsDir), root })
    })
  )
}
