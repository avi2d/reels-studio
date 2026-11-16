export type ByteRange =
  | { readonly kind: "whole" }
  | { readonly kind: "part"; readonly start: number; readonly end: number }
  | { readonly kind: "outside" }

const ONE_RANGE = /^bytes=(\d*)-(\d*)$/

export const parseRange = (header: string | undefined, size: number): ByteRange => {
  const match = ONE_RANGE.exec(header?.trim() ?? "")
  const first = match?.[1] ?? ""
  const last = match?.[2] ?? ""
  if (first === "" && last === "") return { kind: "whole" }
  if (first === "") {
    const length = Math.min(Number(last), size)
    return length === 0 ? { kind: "outside" } : { kind: "part", start: size - length, end: size - 1 }
  }
  const start = Number(first)
  if (start >= size) return { kind: "outside" }
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1)
  return end < start ? { kind: "whole" } : { kind: "part", start, end }
}
