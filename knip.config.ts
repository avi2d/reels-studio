import { defineConfig } from "@avi2dg/checks/knip";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/pi/project-guard.ts",
    "src/pi/web-page.ts",
    "src/web/studio/main.ts",
    "tests/e2e/law-review-fixture.ts",
    "tests/e2e/noise-cut-fixture.ts",
    "tests/e2e/browser/hooks.ts",
    "tests/e2e/browser/run.ts",
    "tests/e2e/browser/tool.ts"
  ]
});
