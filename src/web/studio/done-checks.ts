import { stepPath } from "../../shared/page.ts"
import { checkList, checkSentence, checkTitle, markOf, placeOf, type Mark, type ReelCheck, type ReelChecks } from "../../shared/reel-checks.ts"
import { h } from "../dom.ts"
import { icon } from "./icons.ts"

const MARK_LABEL = { pass: "Пройдена", fail: "Не пройдена", "after-build": "После сборки" } satisfies Record<Mark, string>

const fixPath = (projectId: string, check: ReelCheck): string => {
  const part = placeOf(check)
  const montage = stepPath(projectId, "montage")
  return part === undefined ? montage : `${montage}?part=${encodeURIComponent(part)}`
}

const hasPlace = (check: ReelCheck): boolean => !(check.id === "texts" && check.state === "unmeasured")

const markNode = (mark: Mark): HTMLElement => {
  const node = h("span", { class: `done-check__mark done-check__mark--${mark}`, role: "img", "aria-label": MARK_LABEL[mark] })
  if (mark === "pass") node.append(icon("check"))
  if (mark === "fail") node.append(icon("close"))
  return node
}

const row = (projectId: string, check: ReelCheck): HTMLElement => {
  const mark = markOf(check)
  const fix = mark === "fail" && hasPlace(check)
    ? h("a", { class: "btn btn--quiet btn--start done-check__fix", href: fixPath(projectId, check) }, "Исправить", icon("right"))
    : undefined
  return h("li", { class: `done-check done-check--${mark}`, "data-check": check.id },
    markNode(mark),
    h("div", { class: "done-check__text" },
      h("p", { class: "done-check__title" }, checkTitle(check)),
      h("p", { class: "hint" }, checkSentence(check))),
    ...fix === undefined ? [] : [fix])
}

export interface CheckList {
  readonly node: HTMLElement
  readonly paint: (checks: ReelChecks) => void
}

export const checkListView = (projectId: string): CheckList => {
  const list = h("ul", { class: "done-checks__list" })
  const node = h("section", { class: "done-checks", "aria-labelledby": "done-checks-title" },
    h("h2", { id: "done-checks-title" }, "Проверка перед скачиванием"), list)
  let painted = ""
  return {
    node,
    paint: (checks) => {
      const key = JSON.stringify(checks)
      if (key === painted) return
      painted = key
      list.replaceChildren(...checkList(checks).map((check) => row(projectId, check)))
    }
  }
}
