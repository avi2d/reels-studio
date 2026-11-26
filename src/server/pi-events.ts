import { Option, Schema } from "effect"

import type { ChatEvent } from "../shared/chat.ts"

const PiRecord = Schema.Struct({
  type: Schema.String,
  success: Schema.optionalKey(Schema.Boolean),
  error: Schema.optionalKey(Schema.String),
  finalError: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Struct({
    disposition: Schema.optionalKey(Schema.String)
  })),
  assistantMessageEvent: Schema.optionalKey(Schema.Struct({
    type: Schema.String,
    delta: Schema.optionalKey(Schema.String)
  })),
  message: Schema.optionalKey(Schema.Struct({
    role: Schema.String,
    stopReason: Schema.optionalKey(Schema.String),
    errorMessage: Schema.optionalKey(Schema.String)
  }))
})

type PiRecordValue = typeof PiRecord.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(PiRecord))

const STEPS: Readonly<Record<string, string>> = {
  read: "Читаю файлы ролика",
  ls: "Смотрю, что лежит в ролике",
  find: "Ищу файлы ролика",
  grep: "Ищу по тексту",
  write: "Записываю",
  edit: "Правлю запись"
}

const responseEvents = (record: PiRecordValue): ReadonlyArray<ChatEvent> | undefined => {
  if (record.type !== "response") return undefined
  if (record.success === false) {
    return [{ type: "error", message: record.error ?? "Модель не приняла сообщение" }, { type: "done" }]
  }
  if (record.success === true && record.data?.disposition === "handled") return [{ type: "done" }]
  return undefined
}

const messageEvents = (record: PiRecordValue): ReadonlyArray<ChatEvent> | undefined => {
  if (record.type === "message_start" && record.message?.role === "assistant") return [{ type: "start" }]
  if (record.type === "message_update" && record.assistantMessageEvent?.type === "text_delta") {
    return [{ type: "delta", text: record.assistantMessageEvent.delta ?? "" }]
  }
  if (record.type === "message_end" && record.message?.role === "assistant" && record.message.stopReason === "error") {
    return [{ type: "error", message: record.message.errorMessage ?? "Модель ответила ошибкой" }]
  }
  return undefined
}

const toolEvents = (record: PiRecordValue): ReadonlyArray<ChatEvent> | undefined => {
  if (record.type !== "tool_execution_start") return undefined
  return [{ type: "step", text: STEPS[record.toolName ?? ""] ?? "Работаю" }]
}

const retryEvents = (record: PiRecordValue): ReadonlyArray<ChatEvent> | undefined => {
  if (record.type === "auto_retry_start") return [{ type: "retry" }]
  if (record.type === "auto_retry_end" && record.success === false) {
    return [{ type: "error", message: record.finalError ?? record.error ?? "Модель не ответила" }]
  }
  if (record.type === "auto_retry_end") return []
  return undefined
}

const settledEvents = (record: PiRecordValue): ReadonlyArray<ChatEvent> | undefined => {
  if (record.type !== "agent_settled") return undefined
  return [{ type: "done" }]
}

export const toChatEvents = (line: string): ReadonlyArray<ChatEvent> => {
  const record = Option.getOrUndefined(decode(line))
  if (record === undefined) return []
  return responseEvents(record)
    ?? messageEvents(record)
    ?? toolEvents(record)
    ?? retryEvents(record)
    ?? settledEvents(record)
    ?? []
}
