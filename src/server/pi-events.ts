import { Option, Schema } from "effect"

export type ChatEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "step"; readonly text: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" }

const PiRecord = Schema.Struct({
  type: Schema.String,
  success: Schema.optionalKey(Schema.Boolean),
  error: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
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

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(PiRecord))

const STEPS: Readonly<Record<string, string>> = {
  read: "Читаю файлы ролика",
  ls: "Смотрю, что лежит в ролике",
  find: "Ищу файлы ролика",
  grep: "Ищу по тексту",
  write: "Записываю",
  edit: "Правлю запись"
}

// one stdout line of `pi --mode rpc` in, what the chat page shows out
export const toChatEvents = (line: string): ReadonlyArray<ChatEvent> => {
  const record = Option.getOrUndefined(decode(line))
  if (record === undefined) return []
  if (record.type === "response" && record.success === false) {
    return [{ type: "error", message: record.error ?? "Модель не приняла сообщение" }, { type: "done" }]
  }
  if (record.type === "message_update" && record.assistantMessageEvent?.type === "text_delta") {
    return [{ type: "delta", text: record.assistantMessageEvent.delta ?? "" }]
  }
  if (record.type === "tool_execution_start") {
    return [{ type: "step", text: STEPS[record.toolName ?? ""] ?? "Работаю" }]
  }
  if (record.type === "message_end" && record.message?.role === "assistant" && record.message.stopReason === "error") {
    return [{ type: "error", message: record.message.errorMessage ?? "Модель ответила ошибкой" }]
  }
  return record.type === "agent_settled" ? [{ type: "done" }] : []
}
