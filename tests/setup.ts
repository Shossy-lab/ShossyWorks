import { vi } from "vitest";
import { config } from "dotenv";

// Load .env.local for tests
config({ path: ".env.local" });

// Mock next/headers (used by Supabase server client)
vi.mock("next/headers", () => ({
  cookies: () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

// Mock next/navigation (used by requireUser redirect)
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
