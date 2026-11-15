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

test("a line that is not JSON is skipped, not thrown", () => {
  expect(toChatEvents("not json")).toEqual([])
  expect(toChatEvents("")).toEqual([])
})
