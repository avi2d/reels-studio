import { Option, Schema } from "effect"

const UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"]

export const formatSize = (bytes: number): string => {
  const power = bytes < 1 ? 0 : Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  const digits = power === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace(".", ",")} ${UNITS[power] ?? "Б"}`
}

export const formatLength = (seconds: number): string => {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export const formatPause = (seconds: number): string => `${seconds.toFixed(1).replace(".", ",")} с`

export const fromProjects = (titles: ReadonlyArray<string>): string =>
  `${titles.length === 1 ? "из ролика" : "из роликов"} ${titles.map((title) => `«${title}»`).join(", ")}`

export const addLabel = (count: number): string => count === 0 ? "Добавить видео" : `Добавить ${count} видео`

export const formatDay = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))

const MODEL_NAMES: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "gpt-6.1-sol": "GPT 6.1 Sol"
}

export const modelName = (model: string): string => {
  const id = model.split("/").at(-1) ?? model
  return MODEL_NAMES[id] ?? id
}

export const encodeMetadata = (filename: string): string => {
  const bytes = new TextEncoder().encode(filename)
  return `filename ${btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""))}`
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const parseEventBlock = (block: string): unknown => {
  const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n")
  return Option.getOrUndefined(decodeJson(data))
}
