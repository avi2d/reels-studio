import { defineConfig } from "@avi2dg/checks/config"

export default defineConfig({
  repositoryVisibility: "private",
  agentTests: { allowLocal: false },
  reach: { "tools/ci/{provide-media,test}.sh": ["tests/e2e/*.test.ts"] },
  browserRoutes: {
    "src/index.ts": ["/"],
    "src/web/app.ts": ["/"],
    "tools/ci/provide-media.sh": ["/"],
    "tools/ci/test.sh": [],
    "tools/pdf/test_page.py": [],
    "tools/pdf/page.py": [],
    "tools/pdf/pdf.py": [],
    "tools/pdf/pyproject.toml": [],
    "tools/pdf/uv.lock": []
  },
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
