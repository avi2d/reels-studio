import { defineConfig } from "@avi2dg/checks/oxlint";

export default defineConfig({
  effect: true,
  overrides: [{ files: ["src/web/kit.ts"], rules: { "import/no-unassigned-import": "off" } }]
});
