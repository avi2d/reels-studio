import { expect, test } from "bun:test"
import { planBlocks } from "../../src/shared/plan-text.ts"

test("a heading repeated as the first line of the plan is dropped, not shown twice under the card title", () => {
  expect(planBlocks("План ролика\nТема ролика.")).toEqual([{ kind: "paragraph", text: "Тема ролика." }])
  expect(planBlocks("  План ролика:  \nТема ролика.")).toEqual([{ kind: "paragraph", text: "Тема ролика." }])
})

test("Markdown headings are preserved rather than stripped as the plain card heading", () => {
  for (const heading of ["# План ролика", "**План ролика**", "_План ролика_", "План ролика."]) {
    expect(planBlocks(`${heading}\nТема ролика.`)).toEqual([
      { kind: "paragraph", text: heading },
      { kind: "paragraph", text: "Тема ролика." }
    ])
  }
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
    { kind: "list", items: [{ text: "Заголовок", children: [] }, { text: "Мысль", children: [] }] }
  ])
})

test("nested dash items stay under their parent instead of becoming top-level siblings", () => {
  expect(planBlocks("- Части:\n - Заголовок: «…», шаблон title\n - Мысль: «…»")).toEqual([
    { kind: "list", items: [{ text: "Части:", children: [
      { text: "Заголовок: «…», шаблон title", children: [] },
      { text: "Мысль: «…»", children: [] }
    ] }] }
  ])
})

test("dedented continuations stay on the last nested item instead of moving above it", () => {
  expect(planBlocks("- Части:\n  - Заголовок\n    - Текст\n      на экране\n  - Мысль\n  по порядку\n- Паузы\n\n- Вопросы")).toEqual([
    { kind: "list", items: [
      { text: "Части:", children: [
        { text: "Заголовок", children: [{ text: "Текст на экране", children: [] }] },
        { text: "Мысль по порядку", children: [] }
      ] },
      { text: "Паузы", children: [] }
    ] },
    { kind: "list", items: [{ text: "Вопросы", children: [] }] }
  ])
})

test("an indented line under a dash item continues that item instead of starting a new one", () => {
  expect(planBlocks("- Заголовок на экране\n  без переносов.\n- Мысль")).toEqual([
    { kind: "list", items: [{ text: "Заголовок на экране без переносов.", children: [] }, { text: "Мысль", children: [] }] }
  ])
})

test("a blank line ends a list, so the next dash line starts a new list", () => {
  expect(planBlocks("- Первый\n\n- Второй")).toEqual([
    { kind: "list", items: [{ text: "Первый", children: [] }] },
    { kind: "list", items: [{ text: "Второй", children: [] }] }
  ])
})

test("a plan line that is not a dash item is not merged into the list before it", () => {
  expect(planBlocks("- Первый\nОткрытые вопросы:")).toEqual([
    { kind: "list", items: [{ text: "Первый", children: [] }] },
    { kind: "paragraph", text: "Открытые вопросы:" }
  ])
})

test("an empty plan has no blocks, so the card shows no empty paragraph", () => {
  expect(planBlocks("")).toEqual([])
  expect(planBlocks("  \n\nПлан ролика\n")).toEqual([])
})
