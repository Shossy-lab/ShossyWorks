# Auth & Security Research -- Clusters 1 & 2

**Date:** 2026-04-03
**Source:** consolidated-findings.md (20260406-0917 review)
**Scope:** Cluster 1 (Auth & Security, findings #1, #8, #9, #11, #16, #23, #25) + Cluster 2 (Database & Schema, findings #3, #23, #28, plus standalone DB findings)

---

## Cluster 1: Auth & Security

---

### Finding #1: Open Redirect in Auth Callback

**File:** `src/app/auth/callback/route.ts`, lines 7, 14
**Severity:** CRITICAL (7-agent consensus)
**Complexity:** Trivial

**Current code:**
```ts
const next = searchParams.get("next") ?? "/dashboard";
// ...
return NextResponse.redirect(`${origin}${next}`);
```

**Problem:** The `next` parameter is user-controlled. An attacker can craft `?next=//evil.com` or `?next=/\evil.com` which constructs a redirect to `https://myapp.com//evil.com` -- browsers interpret `//evil.com` as a protocol-relative URL, redirecting the user to `evil.com` after successful authentication. This is a textbook open-redirect vulnerability enabling phishing attacks.

**Best practice fix:**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Allowlist of valid redirect path prefixes
const ALLOWED_REDIRECTS = ["/dashboard", "/estimates", "/settings", "/projects"];

function isValidRedirect(path: string): boolean {
  // Must start with exactly one forward slash (no protocol-relative //)
  if (!path.startsWith("/") || path.startsWith("//")) return false;

  // Must not contain protocol schemes
  if (/^\/[a-z]+:/i.test(path)) return false;

  // Must not contain backslashes (path traversal on Windows)
  if (path.includes("\\")) return false;

  // Optional: restrict to known prefixes (defense-in-depth)
  return ALLOWED_REDIRECTS.some((prefix) => path.startsWith(prefix));
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";

  // Validate redirect target
  const next = isValidRedirect(rawNext) ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
}
```

**Key principles (from Auth.js/NextAuth pattern):**
1. Validate that the path starts with `/` but NOT `//`
2. Reject paths containing protocol schemes (`javascript:`, `data:`, etc.)
3. Reject backslash characters
4. Optionally use an allowlist of known path prefixes for defense-in-depth
5. Always fall back to a safe default (`/dashboard`)

**Dependencies:** None
**Prerequisites:** None

---

### Finding #8: Missing Security Headers in next.config.ts

**File:** `next.config.ts`
**Severity:** HIGH (3-agent consensus)
**Complexity:** Moderate

**Current code:**
```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

**Problem:** Zero security headers configured. The app is vulnerable to clickjacking (no X-Frame-Options), MIME type sniffing (no X-Content-Type-Options), and has no CSP, HSTS, or referrer policy.

**Best practice fix -- Option A: Static headers in next.config.ts** (simpler, no nonce):

```ts
import "./src/env";
import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // tighten later
      "style-src 'self' 'unsafe-inline'",                   // tighten later
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL} https://*.supabase.co`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

**Option B: CSP with nonce via middleware** (stronger, recommended for production):

Add to `src/middleware.ts`:
```ts
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Generate nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=()"
  );

  return response;
}
```

**Recommendation:** Start with Option A (static headers in next.config.ts) for Phase 0. The CSP is intentionally loose (`unsafe-inline`, `unsafe-eval`) because tightening it requires auditing all inline scripts/styles first. Migrate to nonce-based CSP (Option B) in a later phase when the design system stabilizes.

**Dependencies:** None
**Prerequisites:** Verify Supabase URL is correctly whitelisted in `connect-src`

---

### Finding #9: SKIP_ENV_VALIDATION Bypass

**File:** `src/env.ts`, line 43
**Severity:** HIGH (3-agent consensus)
**Complexity:** Trivial

**Current code:**
```ts
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```

**Problem:** Any environment (including production) can set `SKIP_ENV_VALIDATION=1` and bypass all environment variable validation. This defeats the purpose of the Zod schema entirely. Additionally, when `skipValidation` is true, default values from Zod are not applied, so `NODE_ENV` would be `undefined` instead of `"development"`.

**Best practice fix:**

```ts
skipValidation:
  !!process.env.SKIP_ENV_VALIDATION &&
  process.env.NODE_ENV !== "production",
```

This ensures:
- Development/CI can skip validation (useful for Docker builds, lint-only CI steps)
- Production ALWAYS validates (the env schema is enforced in production)

**Alternative (stricter):** Only allow during build:
```ts
skipValidation:
  !!process.env.SKIP_ENV_VALIDATION &&
  process.env.NODE_ENV !== "production" &&
  typeof window === "undefined",  // only server-side/build
```

**Also fix:** Mark critical server vars as required (not `.optional()`):
```ts
server: {
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),  // required in production
  DATABASE_URL: z.string().startsWith("postgres"),  // required
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // ... keep optional ones optional if truly optional
},
```

**Dependencies:** None
**Prerequisites:** Ensure production deployment sets all required env vars before removing `.optional()`

---

### Finding #11: No Rate Limiting on Auth Endpoints

**File:** `src/middleware.ts`, `src/lib/supabase/middleware.ts`
**Severity:** HIGH (2-agent consensus)
**Complexity:** Moderate

**Problem:** No rate limiting at the application layer. While Supabase GoTrue has built-in rate limiting (configured in `config.toml` as 30 sign-ins per 5 minutes), this only protects the Supabase API -- it does not prevent an attacker from hammering the Next.js middleware with thousands of requests, consuming compute resources and potentially causing DoS.

**Best practice fix -- Option A: Upstash Redis rate limiting** (recommended for Vercel):

```bash
npm install @upstash/ratelimit @upstash/redis
```

Create `src/lib/rate-limit.ts`:
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const authRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),  // 5 attempts per minute
  analytics: true,
  prefix: "ratelimit:auth",
});
```

Add to `src/app/auth/callback/route.ts`:
```ts
import { authRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

export async function GET(request: Request) {
  // Rate limit by IP
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") ?? "127.0.0.1";
  const { success, remaining } = await authRateLimit.limit(ip);

  if (!success) {
    return new Response("Too many requests", { status: 429 });
  }

  // ... existing logic
}
```

**Option B: Simple in-memory rate limiting** (no external deps, works for single-instance):

Create `src/lib/rate-limit.ts`:
```ts
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60_000
): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxAttempts) {
    return false;
  }

  record.count++;
  return true;
}
```

**Option C: Rely on Supabase built-in rate limiting only** (already configured):

The `config.toml` already has:
```toml
[auth.rate_limit]
sign_in_sign_ups = 30  # per 5 minutes per IP
token_refresh = 150
token_verifications = 30
```

This is server-side protection at the Supabase level. For Phase 0, this may be sufficient, but adding application-level rate limiting (Option A or B) provides defense-in-depth.

**Recommendation:** For Phase 0 on Vercel, Option A (Upstash) is the production standard. Option C (rely on Supabase built-in) is acceptable as a temporary measure if the Upstash dependency is not wanted yet.

**Dependencies:**
- Option A: `@upstash/ratelimit`, `@upstash/redis`, Upstash Redis instance, env vars `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Option B: None (but does not work across multiple serverless instances)
- Option C: None (already configured)

**Prerequisites:** Upstash account and Redis database (free tier available)

---

### Finding #16: Sign-Up Redirects to Dashboard Before Email Verification

**File:** `src/app/(auth)/sign-up/page.tsx`, lines 30-33
**Severity:** CRITICAL (4-agent consensus)
**Complexity:** Moderate

**Current code:**
```ts
const { error } = await supabase.auth.signUp({ email, password, ... });
if (error) { setError(error.message); setLoading(false); return; }
router.push("/dashboard");
router.refresh();
```

**Problem:** After `signUp()`, the code unconditionally redirects to `/dashboard`. When email confirmation is enabled (recommended), `signUp()` returns `{ data: { user, session: null } }` -- session is null because the user has not confirmed their email. The middleware then bounces the user: sign-up -> dashboard -> middleware (no session) -> sign-in. This creates a confusing UX and, if confirmation is disabled, grants immediate access to unverified accounts.

**Best practice fix:**

```ts
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);
  setError(null);

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  });

  if (error) {
    // Map Supabase errors to user-friendly messages
    setError(mapAuthError(error.message));
    setLoading(false);
    return;
  }

  // If session is null, email confirmation is required
  if (!data.session) {
    setShowConfirmation(true);  // Show "check your email" UI
    setLoading(false);
    return;
  }

  // Session exists = confirmation disabled, user is authenticated
  router.push("/dashboard");
  router.refresh();
}
```

Add confirmation UI state:
```ts
const [showConfirmation, setShowConfirmation] = useState(false);

// In the return JSX:
if (showConfirmation) {
  return (
    <div className="flex min-h-screen items-center justify-center ...">
      <div className="w-full max-w-md ...">
        <h1>Check Your Email</h1>
        <p>
          We sent a confirmation link to <strong>{email}</strong>.
          Click the link to activate your account.
        </p>
        <p>Did not receive the email? Check your spam folder.</p>
        <Link href="/sign-in">Back to Sign In</Link>
      </div>
    </div>
  );
}
```

**Also required:** Enable email confirmation in `supabase/config.toml`:
```toml
[auth.email]
enable_confirmations = true  # currently false
```

**And** create an email confirmation route handler at `src/app/auth/confirm/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "email" | "signup",
    });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=confirmation_failed`
  );
}
```

**Dependencies:** None
**Prerequisites:** Update Supabase email template to use token_hash format (see Supabase docs on email templates)

---

### Finding #23: Default Employee Role for Unregistered Users

**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 58-59
**Severity:** HIGH (2-agent consensus)
**Complexity:** Moderate

**Current code (in custom_access_token_hook):**
```sql
ELSE
  -- Default to 'employee' if no role record exists
  claims := jsonb_set(claims, '{app_metadata,user_role}', '"employee"');
END IF;
```

**Problem:** Any user who signs up automatically receives the `employee` role in their JWT, even without admin approval. For a construction estimating platform, this means anyone with a valid email can sign up and immediately access internal business data. The `employee` role should require explicit assignment by an `owner`.

**Best practice fix -- Pending role pattern:**

1. Add a `pending` value to the `app_role` enum:

```sql
-- New migration: add pending role
ALTER TYPE public.app_role ADD VALUE 'pending';
```

2. Update the hook to default to `pending` instead of `employee`:

```sql
ELSE
  -- Users without a role record are pending approval
  claims := jsonb_set(claims, '{app_metadata,user_role}', '"pending"');
END IF;
```

3. Add a `handle_new_user` trigger (see Cluster 2, Finding: handle_new_user) that creates a role record with `pending` status.

4. Update middleware/layouts to check for `pending` role and redirect to an "awaiting approval" page:

```ts
// In middleware or protected layout
const userRole = user?.app_metadata?.user_role;
if (userRole === "pending") {
  // Redirect to pending approval page
  const url = request.nextUrl.clone();
  url.pathname = "/pending-approval";
  return NextResponse.redirect(url);
}
```

5. Create an owner-only approval endpoint or admin page where owners can change a user from `pending` to `employee`.

**Alternative patterns:**
- **Invitation-only:** Disable public sign-up entirely; owners generate invite links. Best for small teams.
- **Domain restriction:** Only allow sign-up from specific email domains (e.g., `@company.com`). Good for single-company use.
- **Approval queue:** Allow sign-up but hold users in `pending` until approved. Good for growing teams.

**Recommendation:** For a single-company construction platform, **invitation-only** is the most secure. For Phase 0, implement the **pending role + approval queue** pattern as it requires less infrastructure and pairs well with the existing auth flow.

**Dependencies:** New migration for `pending` enum value, new "pending approval" page
**Prerequisites:** Must coordinate with email confirmation fix (#16) -- users should not reach dashboard until both email is confirmed AND role is approved

---

### Finding #25: .gitignore Does Not Exclude Base `.env` File

**File:** `.gitignore`
**Severity:** HIGH (1-agent, but objectively verifiable)
**Complexity:** Trivial

**Current .gitignore env section:**
```
# env files
.env.local
.env*.local
!.env.local.example
```

**Problem:** The base `.env` file is NOT excluded. If a developer runs `cp .env.local .env` or a tool generates a `.env` file, it will be tracked by git. The `.env` file typically contains the same secrets as `.env.local` (Supabase keys, database URLs, etc.).

**Best practice fix:**

```gitignore
# env files
.env
.env.*
!.env.example
!.env.test
```

This pattern:
- Excludes `.env` (base file)
- Excludes `.env.local`, `.env.development.local`, `.env.production.local`, etc.
- Preserves `.env.example` (template for developers)
- Preserves `.env.test` (non-secret test configuration, safe to commit per Next.js convention)

**Also recommended:** Add `.env.example` to the repo with placeholder values:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Dependencies:** None
**Prerequisites:** Verify no `.env` file exists in git history. If it does, the secrets in it are already compromised and must be rotated.

---

## Cluster 2: Database & Schema

---

### Finding #3: RLS Policy Grants Unrestricted Access

**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 32-35
**Severity:** CRITICAL (5-agent consensus)
**Complexity:** Trivial

**Current code:**
```sql
CREATE POLICY "Service role can manage all roles"
  ON public.user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
```

**Problem:** This policy applies to ALL Postgres roles that match, not just `service_role`. Combined with `GRANT SELECT ON TABLE public.user_roles TO authenticated` (line 76), authenticated users can read ALL rows in `user_roles` (not just their own), because:
1. The "Users can read their own role" policy allows SELECT where `auth.uid() = user_id`
2. The "Service role can manage all roles" policy allows ALL (including SELECT) for everyone (`USING(true)`)
3. RLS policies are ORed together for the same operation -- so any user passes the SELECT check

The `service_role` Postgres role has `BYPASSRLS` attribute, meaning it already bypasses all RLS policies automatically. The policy is both redundant AND dangerous.

**Best practice fix -- Remove the policy entirely:**

```sql
-- Drop the overpermissive policy (service_role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role can manage all roles" ON public.user_roles;

-- The existing "Users can read their own role" policy is sufficient for SELECT
-- The GRANT/REVOKE statements already prevent INSERT/UPDATE/DELETE from authenticated
```

**Alternative -- If you need a non-service-role admin to manage roles:**

```sql
-- Replace with a properly scoped policy
DROP POLICY IF EXISTS "Service role can manage all roles" ON public.user_roles;

CREATE POLICY "Owners can manage all roles"
  ON public.user_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'owner'
    )
  );
```

**Recommendation:** For Phase 0, simply DROP the policy. The `service_role` bypasses RLS, and no client-side admin operations are needed yet. Add owner-scoped admin policies when the admin UI is built.

**Dependencies:** New migration file (do not modify the existing migration)
**Prerequisites:** None

---

### Finding #28: custom_access_token_hook Lacks SECURITY DEFINER / search_path

**File:** `supabase/migrations/00000000000001_auth_roles.sql`, lines 39-64
**Severity:** CRITICAL (1-agent, aligns with Supabase docs)
**Complexity:** Trivial

**Current code:**
```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
```

**Problem:** The function lacks `SET search_path` pinning. Without it, the function is vulnerable to search_path injection attacks (CVE-2018-1058 class). A malicious user could create a schema with a function named `jsonb_set` or `jsonb_build_object` that shadows the built-in, executing arbitrary code in the context of the hook.

**Supabase's current recommendation (2025-2026):** Supabase docs now recommend AGAINST using `SECURITY DEFINER` for hook functions. Instead, they recommend:
1. Do NOT add `SECURITY DEFINER`
2. Explicitly GRANT permissions to `supabase_auth_admin`
3. REVOKE from `authenticated`, `anon`, `public`
4. Still set `search_path` for defense-in-depth

**Best practice fix:**

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims JSONB;
  user_role public.app_role;
BEGIN
  claims := event->'claims';

  SELECT ur.role
  INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = (event->>'user_id')::UUID;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata,user_role}', to_jsonb(user_role::TEXT));
  ELSE
    claims := jsonb_set(claims, '{app_metadata,user_role}', '"pending"');
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Permissions (already present but listed for completeness)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

**Key changes:**
1. Added `SET search_path = ''` -- forces all references to use fully qualified names. Since the function body already uses `public.user_roles` and `public.app_role`, no other changes needed.
2. No `SECURITY DEFINER` -- follows Supabase's updated recommendation. The function runs as the calling role (`supabase_auth_admin`), which has the necessary GRANTs.
3. Changed default role from `'employee'` to `'pending'` (per Finding #23)

**Also missing:** The `GRANT USAGE ON SCHEMA public TO supabase_auth_admin` statement:
```sql
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
```
This ensures `supabase_auth_admin` can access objects in the `public` schema. Without it, the hook may fail silently in some Supabase configurations.

**Dependencies:** New migration (do not modify existing migration in place)
**Prerequisites:** None

---

### handle_new_user Trigger (Standalone DB Finding)

**Severity:** HIGH
**Complexity:** Moderate

**Problem:** There is no trigger to auto-create a `user_roles` row when a user signs up. The `custom_access_token_hook` handles the case with a fallback default, but this means:
1. No explicit role record exists in the database for new users
2. The hook's ELSE branch runs on every token refresh for new users (slight perf cost)
3. There is no `created_at` timestamp for when the user was assigned a role

**Best practice fix:**

```sql
-- Create trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Permissions
REVOKE EXECUTE ON FUNCTION public.handle_new_user FROM authenticated, anon, public;
```

**Why SECURITY DEFINER here (unlike the hook):** This trigger runs in the context of the auth schema, which needs to insert into `public.user_roles`. The `supabase_auth_admin` role owns the trigger context, but using `SECURITY DEFINER` with `SET search_path = ''` ensures the function has the necessary permissions to write to `public.user_roles` regardless of the calling context.

**Important:** Test thoroughly -- if this trigger fails, it blocks ALL signups. Add an `EXCEPTION WHEN OTHERS` block if you want defensive behavior:

```sql
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but do not block signup
  RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
```

**Dependencies:** The `pending` enum value must exist before this trigger is created (see Finding #23)
**Prerequisites:** Finding #23 migration must run first

---

### Password Policy (Standalone DB Finding)

**Severity:** HIGH
**Complexity:** Trivial

**Current config.toml:**
```toml
minimum_password_length = 6
password_requirements = ""
```

**Problem:** 6-character passwords with no complexity requirements are extremely weak. For a construction business platform handling financial data (estimates, bid packages, cost breakdowns), this is insufficient.

**NIST SP 800-63B Rev 4 (August 2025) recommendations:**
- Minimum 15 characters when password is sole authenticator; minimum 8 with MFA
- NO arbitrary composition rules (no "must have uppercase + number + symbol")
- Screen against breached password lists
- Allow all Unicode characters including spaces
- Support at least 64 characters maximum length
- Do NOT require periodic password rotation

**Best practice fix for config.toml:**

```toml
# Passwords - aligned with NIST SP 800-63B Rev 4
minimum_password_length = 12
password_requirements = "letters_digits"  # moderate baseline
```

**Rationale for 12 instead of 15:** NIST recommends 15 for password-only auth. Since Supabase does not currently support server-side breached password screening natively, 12 characters with `letters_digits` provides a reasonable baseline for a business platform. Plan to add MFA (TOTP) support in a future phase, which would allow relaxing to 8 characters.

**Also recommended -- Client-side password strength indicator:**
```ts
// src/lib/auth/password-strength.ts
export function getPasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  feedback: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password)) score++;

  const feedback = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score];
  return { score: score as 0 | 1 | 2 | 3 | 4, feedback };
}
```

**Dependencies:** None
**Prerequisites:** Communicate password policy change to any existing test users

---

### Email Confirmation Disabled (Standalone DB Finding)

**File:** `supabase/config.toml`, line 216
**Severity:** HIGH
**Complexity:** Trivial (config change)

**Current:**
```toml
enable_confirmations = false
```

**Problem:** Users can sign up with any email address (including typos, disposable emails, or emails they do not own) and immediately access the app. This means:
1. No proof of email ownership
2. Password reset will not work for typo'd emails
3. Any notification emails go to the wrong address

**Fix:**
```toml
enable_confirmations = true
```

**Must coordinate with:** Finding #16 (sign-up flow) and the auth/confirm route handler.

---

### Hook Not Enabled in config.toml (Standalone DB Finding)

**File:** `supabase/config.toml`, lines 274-276
**Severity:** HIGH (local dev parity)
**Complexity:** Trivial

**Current:**
```toml
# This hook runs before a token is issued and allows you to add additional claims based on the authentication method used.
# [auth.hook.custom_access_token]
# enabled = true
# uri = "pg-functions://<database>/<schema>/<hook_name>"
```

**Problem:** The custom access token hook migration exists and the function is deployed, but the hook is not enabled in the local development config. This means local development does not inject roles into JWTs, creating a dev/prod behavior mismatch.

**Fix:**
```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

**Dependencies:** None
**Prerequisites:** Run `supabase db reset` after enabling to ensure the hook is active locally

---

### Missing updated_at Trigger (Standalone DB Finding)

**Severity:** MEDIUM
**Complexity:** Trivial

**Problem:** The `user_roles` table has an `updated_at` column but no trigger to auto-update it. Any UPDATE to the table will leave `updated_at` at its original value.

**Best practice fix using moddatetime extension:**

```sql
-- Enable moddatetime extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- Auto-update updated_at on user_roles
CREATE TRIGGER set_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

**Alternative -- Custom function (if moddatetime is not available):**

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
```

**Recommendation:** Use `moddatetime` -- it is a standard Postgres extension, available on Supabase, and avoids maintaining custom trigger functions. Use the same pattern for all tables with `updated_at`.

**Dependencies:** `moddatetime` extension (available by default on Supabase)
**Prerequisites:** None

---

### Redundant Index (Standalone DB Finding)

**File:** `supabase/migrations/00000000000001_auth_roles.sql`, line 23
**Severity:** LOW (informational)
**Complexity:** Trivial

**Current:**
```sql
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
```

**Problem:** The UNIQUE constraint on `user_id` (line 19) already creates an implicit unique index. This explicit index is redundant and wastes a small amount of storage and write overhead.

**Fix:**
```sql
-- Remove this line from the migration (or in a new migration):
DROP INDEX IF EXISTS idx_user_roles_user_id;
```

**Dependencies:** None
**Prerequisites:** Verify no queries depend on the index by name (unlikely)

---

## Implementation Priority

### Phase 0A -- Immediate (trivial fixes, same session)

| # | Finding | Complexity | Migration? |
|---|---------|-----------|-----------|
| 1 | Open redirect validation | Trivial | No |
| 9 | SKIP_ENV_VALIDATION guard | Trivial | No |
| 25 | .gitignore fix | Trivial | No |
| 3 | Drop overpermissive RLS policy | Trivial | Yes |
| 28 | Add SET search_path to hook | Trivial | Yes |
| -- | Enable hook in config.toml | Trivial | No |
| -- | Enable email confirmations | Trivial | No |
| -- | Password policy (config.toml) | Trivial | No |

### Phase 0B -- Short-term (moderate fixes, next session)

| # | Finding | Complexity | Migration? |
|---|---------|-----------|-----------|
| 16 | Sign-up confirmation flow | Moderate | No (code) |
| 23 | Pending role pattern | Moderate | Yes |
| -- | handle_new_user trigger | Moderate | Yes |
| 8 | Security headers | Moderate | No |
| -- | updated_at trigger | Trivial | Yes |

### Phase 1 -- Planned (with dependencies)

| # | Finding | Complexity | Dependencies |
|---|---------|-----------|-------------|
| 11 | Rate limiting | Moderate | Upstash account, env vars |
| 8 | Nonce-based CSP | Complex | Design system stabilization |

---

## Migration Ordering

New migration file: `supabase/migrations/00000000000002_auth_security_fixes.sql`

Must execute in this order:
1. Add `pending` enum value to `app_role`
2. Drop overpermissive RLS policy
3. Update `custom_access_token_hook` with `SET search_path = ''` and `pending` default
4. Add `GRANT USAGE ON SCHEMA public TO supabase_auth_admin`
5. Create `handle_new_user()` trigger function
6. Create `on_auth_user_created` trigger
7. Enable `moddatetime` extension and create `updated_at` trigger
8. Drop redundant index

---

## Sources

- [Next.js Security Headers](https://nextjs.org/docs/pages/api-reference/config/next-config-js/headers)
- [Next.js Content Security Policy Guide](https://nextjs.org/docs/app/guides/content-security-policy)
- [Supabase Auth Hooks Documentation](https://supabase.com/docs/guides/auth/auth-hooks)
- [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase signUp API Reference](https://supabase.com/docs/reference/javascript/auth-signup)
- [Upstash Rate Limiting for Next.js](https://upstash.com/blog/nextjs-ratelimiting)
- [Upstash Edge Rate Limiting](https://upstash.com/blog/edge-rate-limiting)
- [T3 Env Documentation](https://env.t3.gg/docs/nextjs)
- [NIST SP 800-63B Rev 4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [Complete Next.js Security Guide 2025](https://www.turbostarter.dev/blog/complete-nextjs-security-guide-2025-authentication-api-protection-and-best-practices)
- [Supabase Auto-Create User Profiles](https://daily-dev-tips.com/posts/supabase-automatically-create-user-profiles-on-sign-up/)
- [Supabase Custom Claims RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
