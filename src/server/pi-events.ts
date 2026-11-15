import { Option, Schema } from "effect"

export type ChatEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "step"; readonly text: string }
  | { readonly type: "retry" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" }

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

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(PiRecord))

const STEPS: Readonly<Record<string, string>> = {
  read: "\u0427\u0438\u0442\u0430\u044e \u0444\u0430\u0439\u043b\u044b \u0440\u043e\u043b\u0438\u043a\u0430",
  ls: "\u0421\u043c\u043e\u0442\u0440\u044e, \u0447\u0442\u043e \u043b\u0435\u0436\u0438\u0442 \u0432 \u0440\u043e\u043b\u0438\u043a\u0435",
  find: "\u0418\u0449\u0443 \u0444\u0430\u0439\u043b\u044b \u0440\u043e\u043b\u0438\u043a\u0430",
  grep: "\u0418\u0449\u0443 \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u0443",
  write: "\u0417\u0430\u043f\u0438\u0441\u044b\u0432\u0430\u044e",
  edit: "\u041f\u0440\u0430\u0432\u043b\u044e \u0437\u0430\u043f\u0438\u0441\u044c"
}

export const toChatEvents = (line: string): ReadonlyArray<ChatEvent> => {
  const record = Option.getOrUndefined(decode(line))
  if (record === undefined) return []
  if (record.type === "response" && record.success === false) {
    return [{ type: "error", message: record.error ?? "\u041c\u043e\u0434\u0435\u043b\u044c \u043d\u0435 \u043f\u0440\u0438\u043d\u044f\u043b\u0430 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435" }, { type: "done" }]
  }
  if (record.type === "response" && record.success === true && record.data?.disposition === "handled") {
    return [{ type: "done" }]
  }
  if (record.type === "message_start" && record.message?.role === "assistant") {
    return [{ type: "delta", text: "\n\n" }]
  }
  if (record.type === "message_update" && record.assistantMessageEvent?.type === "text_delta") {
    return [{ type: "delta", text: record.assistantMessageEvent.delta ?? "" }]
  }
  if (record.type === "tool_execution_start") {
    return [{ type: "step", text: STEPS[record.toolName ?? ""] ?? "\u0420\u0430\u0431\u043e\u0442\u0430\u044e" }]
  }
  if (record.type === "auto_retry_start") return [{ type: "retry" }]
  if (record.type === "auto_retry_end" && record.success === false) {
    return [{ type: "error", message: record.finalError ?? record.error ?? "\u041c\u043e\u0434\u0435\u043b\u044c \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0430" }]
  }
  if (record.type === "auto_retry_end") return []
  if (record.type === "message_end" && record.message?.role === "assistant" && record.message.stopReason === "error") {
    return [{ type: "error", message: record.message.errorMessage ?? "\u041c\u043e\u0434\u0435\u043b\u044c \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0430 \u043e\u0448\u0438\u0431\u043a\u043e\u0439" }]
  }
  return record.type === "agent_settled" ? [{ type: "done" }] : []
}
