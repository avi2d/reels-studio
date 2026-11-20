import { defineConfig } from "@avi2dg/checks/config"

export default defineConfig({
  localTests: "blocked",
  browser: {
    site: "node_modules/.cache/reels-browser",
    routes: [{ path: "/", locale: "ru" }],
    viewports: [{ name: "desktop", width: 1440, height: 900, device: "desktop" }],
    states: [{ name: "default" }],
    targets: [{ name: "studio page", selector: "body" }],
    checks: ["assets"],
    hooks: "tests/e2e/browser/hooks.ts"
  }
})
