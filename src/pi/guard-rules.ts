export interface GuardScope {
  readonly project: string
  readonly readable: ReadonlyArray<string>
}

export type Verdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const READ_TOOLS = new Set(["read", "grep", "find", "ls"])
const WRITE_TOOLS = new Set(["write", "edit"])

const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/g
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

const normalize = (cwd: string, target: string): string => {
  const absolute = target.startsWith("/") ? target : `${cwd}/${target}`
  const parts: Array<string> = []
  for (const part of absolute.split("/")) {
    if (part === "..") parts.pop()
    else if (part !== "" && part !== ".") parts.push(part)
  }
  return `/${parts.join("/")}`
}

const inside = (root: string, target: string): boolean => target === root || target.startsWith(`${root}/`)

const refuse = (reason: string): Verdict => ({ allowed: false, reason })

export const judge = (scope: GuardScope, toolName: string, target: string | undefined): Verdict => {
  const cleaned = (target ?? ".").replace(UNICODE_SPACES, " ")
  const trimmed = cleaned.trimStart()
  if (trimmed.startsWith("~") || trimmed.startsWith("@") || SCHEME.test(trimmed)) {
    return refuse("Reading is limited to the project folder, the studio skills and the style profiles.")
  }
  const project = normalize("/", scope.project)
  const resolved = normalize(project, cleaned)
  if (READ_TOOLS.has(toolName)) {
    const roots = [project, ...scope.readable.map((root) => normalize("/", root))]
    return roots.some((root) => inside(root, resolved))
      ? { allowed: true }
      : refuse("Reading is limited to the project folder, the studio skills and the style profiles.")
  }
  if (!WRITE_TOOLS.has(toolName)) return refuse(`The tool ${toolName} is not available in the studio.`)
  if (!inside(project, resolved)) return refuse("Writing is limited to the project folder.")
  const top = resolved.slice(project.length + 1).split("/")[0] ?? ""
  if (top === ".pi" || top === ".agents") return refuse("Writing is limited to the project folder.")
  if (["source", "attached", "attached-views", "uploads", "chat", "transcripts", "preview", "work", "gaze", "project.json", "chat.jsonl", "timeline.json", "brief.md", "approval.json"].includes(top)) {
    return refuse(`The studio owns ${top}. Write notes, plan.md, plan.json and blocks.json next to it.`)
  }
  return { allowed: true }
}
