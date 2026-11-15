import { Option, Schema } from "effect"

const UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"]

export const formatSize = (bytes: number): string => {
  const power = bytes < 1 ? 0 : Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  const digits = power === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace(".", ",")} ${UNITS[power] ?? "Б"}`
}

export const formatDay = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))

export const encodeMetadata = (filename: string): string => {
  const bytes = new TextEncoder().encode(filename)
  return `filename ${btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""))}`
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export const parseEventBlock = (block: string): unknown => {
  const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n")
  return Option.getOrUndefined(decodeJson(data))
}
