import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DB tests share one test database, so files run one at a time.
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "postgres://expense:expense@127.0.0.1:5434/expense_agent_test",
      ANTHROPIC_API_KEY: "test-key-never-used",
    },
  },
});
