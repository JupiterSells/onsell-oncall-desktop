import { defineConfig } from "vitest/config";

// The rules only (src/**/*.test.ts): nothing here starts Electron.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
