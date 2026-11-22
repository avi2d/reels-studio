import { expect, test } from "bun:test"
import { Schema } from "effect"
import { afterYes, Approval, approves, planView } from "../../src/shared/brief.ts"
import type { Transcript } from "../../src/shared/plan.ts"
import { NO_EDITS, withChoice, withManualPauses, withPauses, type Block } from "../../src/shared/timeline.ts"

const word = (start: number, end: number, text: string) => ({ start, end, text })

const spoken: Transcript = {
  duration: 10,
  words: [word(0, 0.5, "Аванс"), word(0.5, 1, "вернут."), word(2, 2.5, "Аванс"), word(2.5, 3, "вернут."), word(4, 4.5, "Задаток"), word(4.6, 5, "остаётся.")]
}
const transcripts = new Map([["a", spoken]])
const take = (from: number, to: number, reason: string) => ({ video: "a", from, to, reason })
const advance: Block = { id: "advance", title: "Аванс", takes: [take(2, 3, "Без запинок"), take(0, 1, "Смотрит в сторону")] }
const deposit: Block = { id: "deposit", title: "Задаток", takes: [take(4, 5, "Один дубль")] }

test("a yes with a full stop or another case counts, and a yes inside a longer message does not", () => {
  expect([approves("Согласна"), approves(" согласен! "), approves("СОГЛАСНА."), approves("Согласна, но убери конец"), approves("да")])
    .toEqual([true, true, true, false, false])
})

test("a plan changed after the yes waits for a new yes instead of showing as approved", () => {
  const approval = { plan: "старый", texts: null, at: "2026-11-20T10:00:00.000Z", done: [] }
  expect(planView("новый", undefined, approval).state).toBe("proposed")
  expect(planView("старый", undefined, approval).state).toBe("approved")
  expect(planView("  ", undefined, approval).state).toBe("none")
})

test("changing, adding or removing on-screen text revokes the yes instead of keeping the plan approved", () => {
  const texts = '{"texts":[]}'
  const approval = { plan: "план", texts, at: "2026-11-20T10:00:00.000Z", done: [] }
  expect(planView("план", texts, approval).state).toBe("approved")
  for (const changed of [undefined, "", '{"texts": []}']) {
    expect(planView("план", changed, approval).state).toBe("proposed")
  }
  const withoutTexts = { ...approval, texts: null }
  expect(planView("план", undefined, withoutTexts).state).toBe("approved")
  expect(planView("план", texts, withoutTexts).state).toBe("proposed")
})

test("an approval saved before text snapshots stays approved without texts.json instead of failing to read", () => {
  const saved = Schema.decodeSync(Schema.fromJsonString(Approval))('{"plan":"план","at":"2026-11-20T10:00:00.000Z","done":[]}')
  expect(saved.texts).toBeNull()
  expect(planView("план", undefined, saved).state).toBe("approved")
  expect(planView("план", '{"texts":[]}', saved).state).toBe("proposed")
})

test("after the yes the studio pins the shown take as the person chose", () => {
  const { edits, done } = afterYes([advance, deposit], NO_EDITS, transcripts)
  expect(edits.chosen).toEqual([{ block: "advance", video: "a", from: 2 }, { block: "deposit", video: "a", from: 4 }])
  expect(edits.pauses).toEqual([{ video: "a", after: 3 }, { video: "a", after: 5 }])
  expect(done).toEqual([
    { kind: "take", block: "Аванс", take: 1, of: 2, reason: "Без запинок" },
    { kind: "take", block: "Задаток", take: 1, of: 1, reason: "Один дубль" },
    { kind: "pauses", count: 2, seconds: expect.closeTo(5.6, 6) }
  ])
})

test("after the yes a take the person chose stays chosen rather than going back to the first ranked", () => {
  const picked = withChoice(NO_EDITS, "advance", take(0, 1, "Смотрит в сторону"))
  const { edits, done } = afterYes([advance], picked, transcripts)
  expect(edits.chosen).toEqual(picked.chosen)
  expect(done[0]).toEqual({ kind: "take", block: "Аванс", take: 2, of: 2, reason: "Смотрит в сторону" })
})

test("after the yes a pause the person returned stays long instead of being shortened again", () => {
  const returned = withManualPauses(NO_EDITS, [{ video: "a", after: 3 }], false)
  const { edits, done } = afterYes([advance], returned, transcripts)
  expect(edits.chosen).toEqual([{ block: "advance", video: "a", from: 2 }])
  expect(edits.pauses).toEqual([])
  expect(done[done.length - 1]).toEqual({ kind: "pauses", count: 0, seconds: expect.closeTo(0, 6) })
})

test("a yes with no blocks changes nothing and says so instead of listing an empty cut", () => {
  expect(afterYes([], NO_EDITS, transcripts)).toEqual({ edits: NO_EDITS, done: [{ kind: "no-blocks" }] })
})

test("after the yes the list counts pauses the studio already shortened instead of reporting none", () => {
  const shortened = withPauses(NO_EDITS, [{ video: "a", after: 3 }, { video: "a", after: 5 }], true)
  const { edits, done } = afterYes([advance, deposit], shortened, transcripts)
  expect(edits.pauses).toEqual(shortened.pauses)
  expect(done[done.length - 1]).toEqual({ kind: "pauses", count: 2, seconds: expect.closeTo(5.6, 6) })
})
