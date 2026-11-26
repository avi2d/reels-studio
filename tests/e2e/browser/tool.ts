#!/usr/bin/env bun
import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { createInterface } from "node:readline"
import { Schema } from "effect"
import type { Transcript } from "../../../src/shared/plan.ts"
import type { Blocks, Gaze } from "../../../src/shared/timeline.ts"
import { CHAT_PICTURE, CHAT_REPLY, FIRST_WORDS, PLAN_TASK, PLAN_TEXT, SLOW_MESSAGE, SOURCE_VIDEO } from "./scenario.ts"

const transcript = {
  duration: 7,
  words: [
    { text: "Первый", start: 0, end: 2 },
    { text: "Выбранный", start: 2, end: 2.5 },
    { text: "дубль", start: 4, end: 5 },
    { text: "Конец", start: 5, end: 7 }
  ]
} satisfies Transcript

const GAZE_SAMPLES = 35
const gaze = {
  step: 0.2,
  samples: Array.from({ length: GAZE_SAMPLES }, () => "camera" as const),
  // The drift keeps the head shift at the join above JUMP_STEP and the zoom that hides it within MAX_ZOOM.
  heads: Array.from({ length: GAZE_SAMPLES }, (_, index) => ({ x: 0.5, y: 0.3 + 0.0015 * index, size: 0.25 })),
  aspect: 9 / 16
} satisfies Gaze

const blocks = {
  blocks: [
    { id: "opening", title: "Начало", takes: [
      { video: SOURCE_VIDEO, from: 0, to: 0, reason: "Первый вариант" },
      { video: SOURCE_VIDEO, from: 1, to: 2, reason: "Другой вариант" }
    ] },
    { id: "ending", title: "Конец", takes: [{ video: SOURCE_VIDEO, from: 3, to: 3, reason: "Один вариант" }] }
  ]
} satisfies Blocks

const runUv = async (args: readonly string[]): Promise<void> => {
  const script = args.find((arg) => arg.endsWith(".py"))
  const output = args.at(-1)
  assert(output !== undefined, "uv must pass an output file")
  if (script?.endsWith("/transcribe.py") === true) {
    await Bun.write(output, JSON.stringify(transcript))
  } else if (script?.endsWith("/gaze.py") === true) {
    await Bun.write(output, JSON.stringify(gaze))
  } else {
    throw new Error(`Unexpected uv script: ${script}`)
  }
}

const readPrompt = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  type: Schema.Literal("prompt"),
  message: Schema.String,
  images: Schema.optionalKey(Schema.Array(Schema.Struct({
    type: Schema.Literal("image"),
    mimeType: Schema.Literal("image/jpeg"),
    data: Schema.NonEmptyString
  })))
})))

const delta = (text: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } })

const runPi = async (): Promise<void> => {
  const input = createInterface({ input: process.stdin })
  const { value } = await input[Symbol.asyncIterator]().next()
  input.close()
  process.stdin.pause()
  const { message, images } = readPrompt(value)
  let reply = CHAT_REPLY
  if (message === SLOW_MESSAGE) {
    console.log(JSON.stringify(delta(FIRST_WORDS)))
    await Bun.sleep(60_000)
    reply = "Вот конец ответа."
  } else if (message.startsWith("Собери блоки")) {
    await Bun.write("blocks.json", JSON.stringify(blocks))
    reply = "Блоки готовы."
  } else if (message.startsWith("Составь один план")) {
    assert(process.argv.some((arg) => arg.includes(PLAN_TASK)), "The prompt must include the saved task")
    const [video] = await readdir("source")
    assert(video !== undefined, "The plan needs the recording from step 1")
    await Bun.write("blocks.json", JSON.stringify({ blocks: blocks.blocks.map((block) => ({
      ...block, takes: block.takes.map((take) => ({ ...take, video }))
    })) }))
    await Bun.write("plan.md", PLAN_TEXT)
    reply = PLAN_TEXT
  } else if (message === "Согласна") {
    reply = "Приступаю."
  } else if (message.includes("gather the blocks now")) {
    reply = "Собрала блоки."
  } else {
    assert(message.includes(`attached/${CHAT_PICTURE}`), "The prompt did not name the attached picture")
    const picture = images?.[0]
    assert(picture !== undefined, "The prompt did not include the picture")
    const jpeg = Buffer.from(picture.data, "base64")
    assert.equal(jpeg.subarray(0, 2).toString("hex"), "ffd8", "The picture was not delivered as JPEG")
  }
  const events = [
    delta(reply),
    { type: "agent_settled" }
  ]
  console.log(events.map((event) => JSON.stringify(event)).join("\n"))
}

const [command, ...args] = process.argv.slice(2)
if (command === "ffmpeg") {
  process.exitCode = await Bun.spawn(["ffmpeg", ...args], { stdout: "inherit", stderr: "inherit" }).exited
} else if (command === "uv") {
  await runUv(args)
} else {
  assert.equal(command, "--mode", "Expected a media tool or the pi RPC command")
  await runPi()
  process.exit(0)
}
