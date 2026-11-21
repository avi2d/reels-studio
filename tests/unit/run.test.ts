import { expect, test } from "bun:test"
import { Effect } from "effect"
import { BROKEN, run } from "../../src/web/run.ts"

test("a view that throws while building reports a failure instead of leaving the page empty", async () => {
  const thrown = new TypeError("Cannot read properties of undefined (reading 'querySelector')")
  const reported: Array<string> = []
  const logged: Array<unknown> = []
  const originalError = console.error
  console.error = (...values: Array<unknown>) => { logged.push(...values) }
  try {
    run(Effect.sync(() => { throw thrown }), (message) => { reported.push(message) })
    await Bun.sleep(0)
  } finally {
    console.error = originalError
  }
  expect(reported).toEqual([BROKEN])
  expect(logged).toEqual([thrown])
})
