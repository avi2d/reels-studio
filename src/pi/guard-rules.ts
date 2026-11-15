export interface GuardScope {
  readonly project: string
  readonly readable: ReadonlyArray<string>
}

export type Verdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const READ_TOOLS = new Set(["read", "grep", "find", "ls"])
const WRITE_TOOLS = new Set(["write", "edit"])

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
  const project = normalize("/", scope.project)
  const resolved = normalize(project, target ?? ".")
  if (READ_TOOLS.has(toolName)) {
    const roots = [project, ...scope.readable.map((root) => normalize("/", root))]
    return roots.some((root) => inside(root, resolved))
      ? { allowed: true }
      : refuse("Reading is limited to the project folder, the studio skills and the style profiles.")
  }
  if (!WRITE_TOOLS.has(toolName)) return refuse(`The tool ${toolName} is not available in the studio.`)
  if (!inside(project, resolved)) return refuse("Writing is limited to the project folder.")
  const top = resolved.slice(project.length + 1).split("/")[0] ?? ""
  if (["source", "uploads", "chat", "project.json", "chat.jsonl"].includes(top)) {
    return refuse(`The studio owns ${top}. Write notes and plan.md next to it.`)
  }
  return { allowed: true }
}
