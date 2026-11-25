const PAGE_SIZE = 5

export interface Page<T> {
  readonly items: ReadonlyArray<T>
  readonly page: number
  readonly pages: number
  readonly first: number
  readonly last: number
  readonly total: number
}

export const pageOf = <T>(items: ReadonlyArray<T>, wanted: number): Page<T> => {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const page = Math.min(Math.max(0, wanted), pages - 1)
  const start = page * PAGE_SIZE
  const shown = items.slice(start, start + PAGE_SIZE)
  return { items: shown, page, pages, first: start + 1, last: start + shown.length, total: items.length }
}
