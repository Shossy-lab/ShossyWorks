import { defineConfig } from "vitest/config";
import path from "path";

const sharedConfig = {
  globals: true,
  environment: "node" as const,
  setupFiles: ["./tests/setup.ts"],
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
      thresholds: {
        statements: 20,
        branches: 20,
        functions: 20,
        lines: 20,
      },
    },
  },
});
