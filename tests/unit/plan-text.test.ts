import { expect, test } from "bun:test"
import { planBlocks } from "../../src/shared/plan-text.ts"

test("a heading repeated as the first line of the plan is dropped, not shown twice under the card title", () => {
  expect(planBlocks("План ролика\nТема ролика.")).toEqual([{ kind: "paragraph", text: "Тема ролика." }])
  expect(planBlocks("# План ролика:\nТема ролика.")).toEqual([{ kind: "paragraph", text: "Тема ролика." }])
})

test("a heading-like line that is not the first line of the plan stays as written", () => {
  expect(planBlocks("Тема ролика.\nПлан ролика")).toEqual([
    { kind: "paragraph", text: "Тема ролика." },
    { kind: "paragraph", text: "План ролика" }
  ])
})

test("dash marks at the start of a plan line are not shown as text, the line becomes a list item", () => {
  expect(planBlocks("Части:\n- Заголовок\n- Мысль")).toEqual([
    { kind: "paragraph", text: "Части:" },
    { kind: "list", items: ["Заголовок", "Мысль"] }
  ])
})

test("an indented line under a dash item continues that item instead of starting a new one", () => {
  expect(planBlocks("- Заголовок на экране\n  без переносов.\n- Мысль")).toEqual([
    { kind: "list", items: ["Заголовок на экране без переносов.", "Мысль"] }
  ])
})

test("a blank line ends a list, so the next dash line starts a new list", () => {
  expect(planBlocks("- Первый\n\n- Второй")).toEqual([
    { kind: "list", items: ["Первый"] },
    { kind: "list", items: ["Второй"] }
  ])
})

test("a plan line that is not a dash item is not merged into the list before it", () => {
  expect(planBlocks("- Первый\nОткрытые вопросы:")).toEqual([
    { kind: "list", items: ["Первый"] },
    { kind: "paragraph", text: "Открытые вопросы:" }
  ])
})

test("an empty plan has no blocks, so the card shows no empty paragraph", () => {
  expect(planBlocks("")).toEqual([])
  expect(planBlocks("  \n\nПлан ролика\n")).toEqual([])
})
