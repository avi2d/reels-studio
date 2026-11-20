import { expect, test } from "bun:test"
import { judge } from "../../src/pi/guard-rules.ts"

const scope = { project: "/data/projects/p1", readable: ["/app/skills"] }

test("a read outside the project and the skills is blocked, not allowed by default", () => {
  expect(judge(scope, "read", "/etc/hostname").allowed).toBe(false)
  expect(judge(scope, "read", "plan.md").allowed).toBe(true)
  expect(judge(scope, "read", "/app/skills/reels-plan/SKILL.md").allowed).toBe(true)
})

test("dot-dot segments are resolved before the check, so ../ does not escape", () => {
  expect(judge(scope, "read", "../p2/plan.md").allowed).toBe(false)
  expect(judge(scope, "write", "notes/../../p2/plan.md").allowed).toBe(false)
})

test("a sibling folder that shares the project's name prefix is outside", () => {
  expect(judge(scope, "read", "/data/projects/p10/plan.md").allowed).toBe(false)
})

test("a write to the original video is blocked, even through a dotted path", () => {
  expect(judge(scope, "write", "source/x.txt").allowed).toBe(false)
  expect(judge(scope, "edit", "./notes/../source/video.mp4").allowed).toBe(false)
  expect(judge(scope, "write", "plan.md").allowed).toBe(true)
})

test("a write to the skills is blocked, although reading them is allowed", () => {
  expect(judge(scope, "write", "/app/skills/reels-plan/SKILL.md").allowed).toBe(false)
})

test("a tool that is neither a read nor a write is blocked, not waved through", () => {
  expect(judge(scope, "bash", undefined).allowed).toBe(false)
})

test("a read with no path means the project folder itself and is allowed", () => {
  expect(judge(scope, "ls", undefined).allowed).toBe(true)
})

test("a home shortcut or scheme never reaches the project, even when joined with it", () => {
  expect(judge(scope, "read", "~/.bashrc").allowed).toBe(false)
  expect(judge(scope, "write", "~/.bashrc").allowed).toBe(false)
  expect(judge(scope, "read", "@/etc/passwd").allowed).toBe(false)
  expect(judge(scope, "read", "file:///etc/passwd").allowed).toBe(false)
  expect(judge(scope, "write", "~/projects/p1/notes.md").allowed).toBe(false)
})

test("a write into project-local trust folders is blocked, not just source and chat", () => {
  expect(judge(scope, "write", ".pi/extensions/evil.ts").allowed).toBe(false)
  expect(judge(scope, "write", ".agents/skills/x.md").allowed).toBe(false)
  expect(judge(scope, "write", "notes.md").allowed).toBe(true)
})

test("the chat model cannot overwrite the reel the studio built", () => {
  expect(judge(scope, "write", "/data/projects/p1/reel/reel.mp4").allowed).toBe(false)
})
