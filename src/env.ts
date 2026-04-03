import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

export const env = createEnv({
  extends: [vercel()],

  server: {
    // Supabase server keys (at least one required)
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),

    // Database connections
    DATABASE_URL: z.string().startsWith("postgres").optional(),
    DIRECT_DATABASE_URL: z.string().startsWith("postgres").optional(),
    SUPABASE_DB_PASSWORD: z.string().min(1).optional(),
    SUPABASE_PROJECT_ID: z.string().min(1).optional(),

    // Auth
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),

    // AI
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // App
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CRON_SECRET: z.string().min(16).optional(),
  },

  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
