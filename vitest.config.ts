import { defineConfig } from "vitest/config";
import path from "path";

const sharedConfig = {
  globals: true,
  environment: "node" as const,
  setupFiles: ["./tests/setup.ts"],
  alias: {
    "@": path.resolve(__dirname, "src"),
    "server-only": path.resolve(__dirname, "tests/helpers/server-only-mock.ts"),
  },
};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        test: {
          ...sharedConfig,
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedConfig,
          name: "smoke",
          include: ["tests/smoke/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedConfig,
          name: "security",
          include: ["tests/security/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedConfig,
          name: "db",
          include: ["tests/database/**/*.test.ts"],
        },
      },
      {
        test: {
          ...sharedConfig,
          name: "actions",
          include: ["tests/actions/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      // TODO: Raise thresholds after Phase 1A adds unit tests for server actions/triggers
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
