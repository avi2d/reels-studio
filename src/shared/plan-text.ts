export interface PlanItem {
  text: string
  readonly children: PlanItem[]
}

export type PlanBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<PlanItem> }

const HEADING = /^План ролика:?$/u
const ITEM = /^-\s+(.*)$/u

interface PathEntry {
  readonly indent: number
  readonly item: PlanItem
}

const popDeeper = (path: PathEntry[], indent: number, floor: number): void => {
  while (path.length > floor && (path.at(-1)?.indent ?? 0) >= indent) path.pop()
}

const addItem = (list: PlanItem[], path: PathEntry[], indent: number, text: string): void => {
  popDeeper(path, indent, 0)
  const item: PlanItem = { text, children: [] }
  const siblings = path.at(-1)?.item.children ?? list
  siblings.push(item)
  path.push({ indent, item })
}

const continueItem = (path: ReadonlyArray<PathEntry>, text: string): void => {
  const item = path.at(-1)?.item
  if (item !== undefined) item.text += ` ${text}`
}

const withoutHeading = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const start = lines.findIndex((line) => line.trim() !== "")
  return start !== -1 && HEADING.test((lines[start] ?? "").trim()) ? lines.slice(start + 1) : lines
}

export const planBlocks = (text: string): ReadonlyArray<PlanBlock> => {
  const blocks: PlanBlock[] = []
  let list: PlanItem[] | undefined
  const path: PathEntry[] = []
  const close = (): void => {
    if (list !== undefined) blocks.push({ kind: "list", items: list })
    list = undefined
    path.length = 0
  }
  for (const line of withoutHeading(text.split(/\r?\n/u))) {
    const trimmed = line.trim()
    if (trimmed === "") {
      close()
      continue
    }
    const itemText = ITEM.exec(trimmed)?.[1]
    const indent = line.length - line.trimStart().length
    if (itemText !== undefined) {
      list ??= []
      addItem(list, path, indent, itemText)
      continue
    }
    if (list !== undefined && indent > 0) {
      continueItem(path, trimmed)
      continue
    }
    close()
    blocks.push({ kind: "paragraph", text: trimmed })
  }
  close()
  return blocks
}
