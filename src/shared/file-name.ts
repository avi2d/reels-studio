const FORBIDDEN = new Set(["<", ">", ":", "\"", "|", "?", "*"])
const isPrintable = (char: string): boolean => (char.codePointAt(0) ?? 0) > 31 && !FORBIDDEN.has(char)

export const safeFileName = (name: string | undefined): string => {
  const base = (name ?? "").split(/[\\/]/).at(-1) ?? ""
  const clean = Array.from(base).filter(isPrintable).join("").replace(/^\.+/, "").trim().slice(0, 200)
  return clean === "" ? "video" : clean
}
