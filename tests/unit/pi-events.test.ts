import { expect, test } from "bun:test"
import { toChatEvents } from "../../src/server/pi-events.ts"

const line = (record: unknown): string => JSON.stringify(record)

test("a text_delta becomes a delta, and other message updates are not shown as text", () => {
  expect(toChatEvents(line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Привет" } })))
    .toEqual([{ type: "delta", text: "Привет" }])
  expect(toChatEvents(line({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hm" } })))
    .toEqual([])
})

test("agent_end does not end the reply, only agent_settled does", () => {
  expect(toChatEvents(line({ type: "agent_end", messages: [] }))).toEqual([])
  expect(toChatEvents(line({ type: "agent_settled", aborted: false }))).toEqual([{ type: "done" }])
})

test("a rejected prompt ends the reply with the error instead of waiting forever", () => {
  expect(toChatEvents(line({ type: "response", command: "prompt", success: false, error: "Model not found: invalid/model" })))
    .toEqual([{ type: "error", message: "Model not found: invalid/model" }, { type: "done" }])
  expect(toChatEvents(line({ type: "response", command: "prompt", success: true }))).toEqual([])
})

test("a provider failure after acceptance is reported, not dropped as an empty answer", () => {
  const record = { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "OpenAI API error (400)" } }
  expect(toChatEvents(line(record))).toEqual([{ type: "error", message: "OpenAI API error (400)" }])
})

test("a tool start becomes a Russian step, not the tool's name", () => {
  expect(toChatEvents(line({ type: "tool_execution_start", toolName: "write" }))).toEqual([{ type: "step", text: "Записываю" }])
  expect(toChatEvents(line({ type: "tool_execution_start", toolName: "mystery" }))).toEqual([{ type: "step", text: "Работаю" }])
})

test("saving a web page is shown as opening a page, not as the generic step", () => {
  expect(toChatEvents(line({ type: "tool_execution_start", toolName: "save_web_page" })))
    .toEqual([{ type: "step", text: "Открываю страницу в интернете" }])
})

test("a new assistant message is a boundary event, not text the model wrote", () => {
  expect(toChatEvents(line({ type: "message_start", message: { role: "assistant" } })))
    .toEqual([{ type: "start" }])
  expect(toChatEvents(line({ type: "message_start", message: { role: "user" } }))).toEqual([])
})

test("a retry start clears the failed attempt while a final retry failure reports", () => {
  expect(toChatEvents(line({ type: "auto_retry_start", attempt: 1 })))
    .toEqual([{ type: "retry" }])
  expect(toChatEvents(line({ type: "auto_retry_end", success: true, attempt: 2 }))).toEqual([])
  expect(toChatEvents(line({ type: "auto_retry_end", success: false, attempt: 2, finalError: "overloaded" })))
    .toEqual([{ type: "error", message: "overloaded" }])
})

test("a handled prompt ends the reply instead of waiting for a run that never starts", () => {
  expect(toChatEvents(line({ type: "response", command: "prompt", success: true, data: { disposition: "handled" } })))
    .toEqual([{ type: "done" }])
  expect(toChatEvents(line({ type: "response", command: "prompt", success: true, data: { disposition: "started" } })))
    .toEqual([])
})

test("a line that is not JSON is skipped, not thrown", () => {
  expect(toChatEvents("not json")).toEqual([])
  expect(toChatEvents("")).toEqual([])
})
