export type PlanBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<string> }

const HEADING = /^[#*_\s]*План ролика[\s:.*_#]*$/u
const ITEM = /^-\s+(.*)$/u
const INDENTED = /^\s/u

export const planBlocks = (text: string): ReadonlyArray<PlanBlock> => {
  const lines = text.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() !== "")
  const body = start !== -1 && HEADING.test((lines[start] ?? "").trim()) ? lines.slice(start + 1) : lines
  const blocks: PlanBlock[] = []
  let list: ReadonlyArray<string> | undefined
  const close = (): void => {
    if (list !== undefined) blocks.push({ kind: "list", items: list })
    list = undefined
  }
  for (const line of body) {
    const trimmed = line.trim()
    if (trimmed === "") {
      close()
      continue
    }
    const item = ITEM.exec(trimmed)?.[1]
    if (item !== undefined) {
      list = [...(list ?? []), item]
      continue
    }
    if (list !== undefined && INDENTED.test(line)) {
      list = [...list.slice(0, -1), `${list.at(-1) ?? ""} ${trimmed}`]
      continue
    }
    close()
    blocks.push({ kind: "paragraph", text: trimmed })
  }
  close()
  return blocks
}
