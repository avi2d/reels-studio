export interface PlanItem {
  text: string
  readonly children: PlanItem[]
}

export type PlanBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<PlanItem> }

const HEADING = /^План ролика:?$/u
const ITEM = /^-\s+(.*)$/u

export const planBlocks = (text: string): ReadonlyArray<PlanBlock> => {
  const lines = text.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() !== "")
  const body = start !== -1 && HEADING.test((lines[start] ?? "").trim()) ? lines.slice(start + 1) : lines
  const blocks: PlanBlock[] = []
  let list: PlanItem[] | undefined
  const path: { readonly indent: number; readonly item: PlanItem }[] = []
  const close = (): void => {
    if (list !== undefined) blocks.push({ kind: "list", items: list })
    list = undefined
    path.length = 0
  }
  for (const line of body) {
    const trimmed = line.trim()
    if (trimmed === "") {
      close()
      continue
    }
    const itemText = ITEM.exec(trimmed)?.[1]
    const indent = line.length - line.trimStart().length
    if (itemText !== undefined) {
      while (path.length > 0 && (path.at(-1)?.indent ?? 0) >= indent) path.pop()
      list ??= []
      const item: PlanItem = { text: itemText, children: [] }
      const siblings = path.at(-1)?.item.children ?? list
      siblings.push(item)
      path.push({ indent, item })
      continue
    }
    if (list !== undefined && indent > 0) {
      while (path.length > 1 && (path.at(-1)?.indent ?? 0) >= indent) path.pop()
      const item = path.at(-1)?.item
      if (item !== undefined) item.text += ` ${trimmed}`
      continue
    }
    close()
    blocks.push({ kind: "paragraph", text: trimmed })
  }
  close()
  return blocks
}
