# Cross-Service Authentication & API Flow

> Research output for ShossyWorks env/secrets bootstrap  
> Researcher: auth-flow-researcher  
> Date: 2026-04-03

---

## Table of Contents

1. [Service Topology](#1-service-topology)
2. [Supabase Key Types](#2-supabase-key-types)
3. [Client Creation Patterns](#3-client-creation-patterns)
4. [Auth Lifecycle](#4-auth-lifecycle)
5. [JWT Handling](#5-jwt-handling)
6. [Custom Access Token Hook (Role Injection)](#6-custom-access-token-hook)
7. [Middleware / Proxy Route Protection](#7-middleware--proxy-route-protection)
8. [Server Actions Auth Pattern](#8-server-actions-auth-pattern)
9. [Service Role (Admin) Operations](#9-service-role-admin-operations)
10. [Realtime Channel Authentication](#10-realtime-channel-authentication)
11. [RLS Policy Patterns](#11-rls-policy-patterns)
12. [CORS Configuration](#12-cors-configuration)
13. [Environment Variables Summary](#13-environment-variables-summary)
14. [Next.js 16 Migration Notes](#14-nextjs-16-migration-notes)

---

## 1. Service Topology

Every connection in the ShossyWorks stack, what credential it uses, and which env var provides it:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (Client)                            │
│  supabase-js (createBrowserClient)                                  │
│  Credentials: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY │
│  Protocol: HTTPS (REST API) + WSS (Realtime)                       │
└──────┬──────────────────────────┬───────────────────────────────────┘
       │                          │
       │ HTTP requests            │ WebSocket (Realtime)
       │ (pages, server actions)  │ (Broadcast + Presence)
       │                          │
       ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────────────────┐
│ Next.js on Vercel    │   │ Supabase Realtime Server                 │
│ (Server Components,  │   │ Auth: User JWT from WebSocket upgrade    │
│  Server Actions,     │   │ RLS: realtime.messages table policies    │
│  Route Handlers,     │   │ Caching: policies cached per connection, │
│  Middleware/Proxy)   │   │   re-evaluated on token refresh          │
│                      │   └──────────────────────────────────────────┘
│ SSR Client:          │
│  createServerClient  │
│  Creds: same anon key│
│  + cookies()         │
│                      │
│ Admin Client:        │
│  createClient (js)   │
│  Creds: SERVICE_ROLE │
│  No cookie handling  │
└──────┬───────────────┘
       │
       │ HTTPS (PostgREST / Auth API)
       │ Auth header: Bearer <user_jwt> or Bearer <service_role_key>
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Supabase Project                                                  │
│                                                                    │
│ ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│ │ Auth Server   │  │ PostgREST    │  │ Realtime Server       │    │
│ │ (GoTrue)      │  │ (REST API)   │  │ (Elixir/Phoenix)      │    │
│ │               │  │              │  │                       │    │
│ │ Handles:      │  │ Handles:     │  │ Handles:              │    │
│ │ - signup      │  │ - CRUD via   │  │ - Broadcast           │    │
│ │ - login       │  │   REST       │  │ - Presence            │    │
│ │ - JWT issue   │  │ - RLS        │  │ - Postgres Changes    │    │
│ │ - token       │  │   enforced   │  │ - Channel auth via    │    │
│ │   refresh     │  │              │  │   RLS on              │    │
│ │ - Custom      │  │              │  │   realtime.messages   │    │
│ │   Access      │  │              │  │                       │    │
│ │   Token Hook  │  │              │  │                       │    │
│ └──────┬────────┘  └──────┬───────┘  └───────────────────────┘    │
│        │                  │                                        │
│        ▼                  ▼                                        │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ PostgreSQL Database                                          │   │
│ │ - RLS policies enforce access per role                       │   │
│ │ - auth schema (managed by GoTrue)                            │   │
│ │ - public schema (application tables)                         │   │
│ │ - realtime schema (realtime.messages for channel auth)       │   │
│ └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Azure Key Vault                                                      │
│ Stores: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, etc.        │
│ Access: az keyvault secret show (CI/CD or runtime)                   │
│ Env vars injected into Vercel via CI or Vercel env settings          │
└─────────────────────────────────────────────────────────────────────┘
```

### Connection Table

| From | To | Credential | Env Var | Protocol |
|------|----|-----------|---------|----------|
| Browser | Supabase Auth/REST | Anon/Publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | HTTPS |
| Browser | Supabase Realtime | User JWT (from auth session) | (derived from auth session) | WSS |
| Browser | Next.js Server | Session cookie | (HTTP-only cookie, auto) | HTTPS |
| Next.js Server (SSR) | Supabase Auth/REST | Anon key + user JWT (from cookie) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | HTTPS |
| Next.js Server (Admin) | Supabase Auth/REST | Service role key | `SUPABASE_SERVICE_ROLE_KEY` | HTTPS |
| Next.js Middleware | Supabase Auth | Anon key + user JWT (from cookie) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | HTTPS |
| Vercel CI/CD | GitHub | Deploy hook / GitHub App | (Vercel-managed) | HTTPS |
| Vercel Runtime | Azure Key Vault | Service principal or managed identity | (build-time injection) | HTTPS |

---

## 2. Supabase Key Types

Supabase has three types of API credentials. Understanding when to use each is critical:

### Anon Key (aka Publishable Key)

```
Format (legacy): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  (long-lived JWT)
Format (new):    sb_publishable_...
```

- **Purpose**: Public-facing key, safe to expose in browser
- **Privileges**: Respects RLS policies — can only access data allowed by policies
- **Lifespan**: 10 years (legacy JWT) or until rotated (new format)
- **Used by**: Browser client, SSR client (as the base key)
- **Env var**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Service Role Key (aka Secret Key)

```
Format (legacy): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  (long-lived JWT with service_role)
Format (new):    sb_secret_...
```

- **Purpose**: Server-only admin key that **bypasses ALL RLS policies**
- **Privileges**: Full database access, no RLS enforcement
- **Lifespan**: 10 years (legacy) or until rotated (new)
- **Used by**: Server Actions for admin operations, webhooks, cron jobs
- **Env var**: `SUPABASE_SERVICE_ROLE_KEY` (NEVER prefix with `NEXT_PUBLIC_`)
- **CRITICAL**: Never expose in browser. Never use with `@supabase/ssr` cookie-based client.

### JWT Secret

- **Purpose**: Signs the legacy JWT-based API keys; used to verify JWTs
- **Used by**: Custom JWT verification (rare), webhook signature verification
- **Env var**: `SUPABASE_JWT_SECRET`
- **Note**: Modern approach uses asymmetric keys via JWKS endpoint instead

### Key Migration Note

Supabase is transitioning from JWT-based keys (anon/service_role) to prefixed keys (publishable/secret). Both work simultaneously during transition. The new `sb_secret_` key adds a security improvement: it returns HTTP 401 if accidentally used in a browser, unlike the legacy service_role JWT which would silently work.

---

## 3. Client Creation Patterns

### 3a. Browser Client (`utils/supabase/client.ts`)

Used in Client Components (anything with `'use client'`):

```typescript
// utils/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Key points:**
- Singleton-safe: `createBrowserClient` returns the same instance if called multiple times
- Manages auth state in memory + cookies automatically
- Handles token refresh automatically
- Use for: UI interactions, realtime subscriptions, client-side data fetching

### 3b. Server Client (`utils/supabase/server.ts`)

Used in Server Components, Server Actions, and Route Handlers:

```typescript
// utils/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component (read-only context).
            // Safe to ignore if middleware handles session refresh.
          }
        },
      },
    }
  )
}
```

**Key points:**
- Must be created fresh for every request (cookies change per request)
- The `try/catch` in `setAll` is intentional — Server Components are read-only for cookies
- This client carries the user's JWT from cookies, so RLS policies apply per-user
- Use for: data fetching in server components, server action auth checks

### 3c. Middleware Client (`utils/supabase/middleware.ts`)

Used in Next.js middleware/proxy to refresh auth tokens:

```typescript
// utils/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Update request cookies (for downstream server components)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Create new response with updated request
          supabaseResponse = NextResponse.next({ request })
          // Set cookies on response (for browser)
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Use getClaims() or getUser() — never getSession() on server
  // getClaims() is faster (local JWT validation via JWKS)
  // getUser() is more thorough (network call to auth server)
  const { data: { user } } = await supabase.auth.getUser()

  // Route protection logic
  const isAuthPage = request.nextUrl.pathname.startsWith('/login') ||
                     request.nextUrl.pathname.startsWith('/signup')
  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard') ||
                           request.nextUrl.pathname.startsWith('/estimates')

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  if (isAuthPage && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}
```

### 3d. Service Role Client (`utils/supabase/admin.ts`)

Used for admin operations that need to bypass RLS:

```typescript
// utils/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
```

**CRITICAL**: 
- Use `@supabase/supabase-js` `createClient` directly — NOT `@supabase/ssr` `createServerClient`
- The SSR client uses cookies, which could inject user session into a service role client
- Never use in Client Components or expose the service role key to the browser
- `persistSession: false` prevents any cookie/storage interaction

---

## 4. Auth Lifecycle

Complete flow from signup through authenticated data access:

```
SIGNUP FLOW
===========
1. User submits signup form (Client Component)
2. Browser client calls supabase.auth.signUp({ email, password })
3. Supabase Auth (GoTrue) creates user in auth.users
4. If email confirmation enabled: sends confirmation email
5. User confirms email → session created
6. Supabase Auth issues JWT (access_token + refresh_token)
7. @supabase/ssr stores tokens in HTTP-only cookies
8. Custom Access Token Hook fires → injects role claim into JWT

LOGIN FLOW
==========
1. User submits login form (Client Component)
2. Browser client calls supabase.auth.signInWithPassword({ email, password })
3. Supabase Auth validates credentials
4. Custom Access Token Hook fires → injects user_role into JWT
5. Auth returns: access_token (JWT), refresh_token, user object
6. @supabase/ssr stores both tokens in HTTP-only cookies
7. Redirect to protected page

SESSION LIFECYCLE
=================
1. Every request hits middleware/proxy
2. Middleware creates server client with request cookies
3. Calls supabase.auth.getUser() or getClaims()
   - getUser(): network call to Auth server, validates session exists
   - getClaims(): local JWT validation via JWKS, faster but doesn't catch logout
4. If token expired but refresh_token valid:
   - Supabase client automatically refreshes
   - New tokens set via setAll() cookie handler
   - Updated cookies forwarded to response
5. If refresh_token also expired: session invalid, redirect to login

PROTECTED ROUTE ACCESS
======================
1. Middleware validates session (step above)
2. Server Component creates server client with cookies
3. Server client includes user JWT in Authorization header
4. PostgREST receives request → extracts JWT → sets Postgres config vars
5. RLS policies evaluate using auth.uid(), auth.jwt() claims
6. Data returned only if policies allow

SERVER ACTION (MUTATION)
========================
1. Client Component calls server action
2. Server action creates server client with cookies()
3. Calls supabase.auth.getUser() to verify auth
4. Executes mutation (insert/update/delete)
5. PostgREST enforces RLS based on user JWT
6. Returns structured result { success, data } or { success: false, error }

REALTIME CONNECTION
===================
1. Client Component creates browser client (already authenticated)
2. Calls supabase.channel('room-name', { config: { private: true } })
3. supabase-js opens WebSocket with user JWT in upgrade headers
4. Realtime server verifies JWT
5. Evaluates RLS on realtime.messages table for channel authorization
6. Caches policy result for connection duration
7. Re-evaluates on token refresh (access_token message)
```

---

## 5. JWT Handling

### JWT Structure

A Supabase access token JWT contains these claims:

```json
{
  "iss": "https://<project-ref>.supabase.co/auth/v1",
  "aud": "authenticated",
  "exp": 1714444800,
  "iat": 1714441200,
  "sub": "uuid-of-user",
  "role": "authenticated",
  "aal": "aal1",
  "session_id": "uuid-of-session",
  "email": "user@example.com",
  "phone": "",
  "is_anonymous": false,
  "app_metadata": {
    "provider": "email",
    "providers": ["email"],
    "user_role": "owner"          // <-- injected by Custom Access Token Hook
  },
  "user_metadata": {
    "full_name": "John Doe"
  },
  "amr": [
    { "method": "password", "timestamp": 1714441200 }
  ]
}
```

### Key Claim Fields

| Claim | Type | Purpose |
|-------|------|---------|
| `sub` | UUID | User ID — used in RLS as `auth.uid()` |
| `role` | string | Postgres role: `authenticated`, `anon`, or `service_role` |
| `aal` | string | Auth assurance level: `aal1` (single factor) or `aal2` (MFA) |
| `exp` | number | Token expiry (Unix timestamp) |
| `app_metadata` | object | Server-controlled metadata (includes custom role) |
| `user_metadata` | object | User-editable metadata |
| `session_id` | UUID | Current session identifier |

### How the Three Keys Relate to JWTs

```
anon_key         → Pre-signed JWT with role="anon", 10-year expiry
                   Used as default Authorization header before user logs in
                   PostgREST sees role=anon → applies anon RLS policies

service_role_key → Pre-signed JWT with role="service_role", 10-year expiry
                   Has BYPASSRLS privilege → skips ALL policies
                   Used for admin operations only

jwt_secret       → The shared secret used to sign both keys above
                   Also used to verify user JWTs (legacy method)
                   Modern: verify via JWKS endpoint instead

User JWT         → Short-lived token (default 1 hour)
                   role="authenticated"
                   Contains user-specific claims (sub, email, app_metadata)
                   RLS policies use auth.uid() and auth.jwt() to access claims
```

### Token Refresh Lifecycle

```
1. Access token expires (default: 3600 seconds / 1 hour)
2. supabase-js detects expiry before making API call
3. Sends refresh_token to Auth server
4. Auth server validates refresh_token
5. Custom Access Token Hook fires again (re-reads role from DB)
6. New access_token + refresh_token issued
7. @supabase/ssr updates cookies via setAll()
8. Middleware forwards updated cookies to browser
```

### JWT Verification Methods

```typescript
// Method 1: getClaims() — fast, local validation
// Verifies JWT signature against JWKS endpoint (cached)
// Does NOT check if session was revoked server-side
const { data } = await supabase.auth.getClaims()
const claims = data?.claims // includes custom claims

// Method 2: getUser() — thorough, network call
// Sends JWT to Auth server for full validation
// Catches revoked sessions and logouts
const { data: { user } } = await supabase.auth.getUser()

// Method 3: getSession() — CLIENT ONLY
// Reads from local storage/memory, no verification
// NEVER use on server — insecure, can be spoofed
const { data: { session } } = await supabase.auth.getSession() // client only!

// Method 4: Manual JWKS verification (advanced)
import { jwtVerify, createRemoteJWKSet } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL('https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json')
)

async function verifyJWT(jwt: string) {
  const { payload } = await jwtVerify(jwt, JWKS)
  return payload // verified claims
}
```

**Recommendation for ShossyWorks:**
- **Middleware**: Use `getUser()` (thorough, catches revoked sessions)
- **Server Actions**: Use `getUser()` for mutations, `getClaims()` acceptable for reads
- **Server Components**: `getClaims()` for data fetching (faster, acceptable risk)

---

## 6. Custom Access Token Hook

The Custom Access Token Hook is a PostgreSQL function that runs before every JWT is issued. It injects the user's application role into the JWT claims.

### SQL Implementation for ShossyWorks Roles

```sql
-- Step 1: Create the role enum
CREATE TYPE public.app_role AS ENUM ('owner', 'employee', 'client');

-- Step 2: Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID NOT NULL,
  role app_role NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- Step 3: Create the Custom Access Token Hook function
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims JSONB;
  user_role public.app_role;
  user_org_id UUID;
BEGIN
  -- Extract current claims from the event
  claims := event->'claims';

  -- Look up the user's role (use their primary/default org)
  SELECT ur.role, ur.organization_id
  INTO user_role, user_org_id
  FROM public.user_roles ur
  WHERE ur.user_id = (event->>'user_id')::UUID
  ORDER BY ur.created_at ASC
  LIMIT 1;

  -- Inject role into app_metadata claims
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(
      claims,
      '{app_metadata, user_role}',
      to_jsonb(user_role::TEXT)
    );
    claims := jsonb_set(
      claims,
      '{app_metadata, org_id}',
      to_jsonb(user_org_id::TEXT)
    );
  ELSE
    -- Default to 'client' if no role assigned
    claims := jsonb_set(
      claims,
      '{app_metadata, user_role}',
      '"client"'
    );
  END IF;

  -- Return modified claims
  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Step 4: Grant permissions (CRITICAL for security)
-- Auth admin needs access to read user_roles
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;

-- Revoke from all other roles to prevent users from modifying their own role
REVOKE ALL ON TABLE public.user_roles FROM authenticated, anon, public;

-- Grant execute on the hook function
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

### Enabling the Hook

1. Go to Supabase Dashboard → Authentication → Hooks (Beta)
2. Enable "Custom Access Token" hook
3. Select the `public.custom_access_token_hook` function from the dropdown
4. Save

### Reading Custom Claims in Application Code

```typescript
// Server-side: via getClaims()
const { data } = await supabase.auth.getClaims()
const userRole = data?.claims?.app_metadata?.user_role as 'owner' | 'employee' | 'client'
const orgId = data?.claims?.app_metadata?.org_id

// Server-side: via getUser() (user object includes app_metadata)
const { data: { user } } = await supabase.auth.getUser()
const userRole = user?.app_metadata?.user_role

// Client-side: decode the JWT from session
import { jwtDecode } from 'jwt-decode'

const { data: { session } } = await supabase.auth.getSession()
if (session?.access_token) {
  const decoded = jwtDecode(session.access_token)
  const userRole = decoded.app_metadata?.user_role
}
```

### Important Caveats

1. **The hook only modifies the access token JWT** — it does NOT modify the auth response object. To read custom claims client-side, you must decode the JWT.
2. **The hook re-fires on every token refresh** — so role changes take effect within the token expiry window (default 1 hour).
3. **Required claims cannot be removed**: `iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`.
4. **Keep the hook function fast** — it runs on every auth operation. Simple lookups only.

---

## 7. Middleware / Proxy Route Protection

### Next.js 15 (middleware.ts)

```typescript
// middleware.ts (project root)
import { updateSession } from '@/utils/supabase/middleware'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### Next.js 16+ (proxy.ts)

Next.js 16 renamed `middleware.ts` to `proxy.ts` and the exported function from `middleware` to `proxy`. The behavior is identical:

```typescript
// proxy.ts (project root) — Next.js 16+
import { updateSession } from '@/utils/supabase/middleware'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### Three-Layer Security Architecture

Route protection should NOT rely on middleware alone. ShossyWorks uses three independent layers:

```
Layer 1: Middleware/Proxy (Route-level)
  → Redirects unauthenticated users away from protected pages
  → Refreshes session cookies
  → CANNOT be the only layer (can be bypassed via direct API calls)

Layer 2: Server Actions (Operation-level)
  → Verifies identity on every mutation
  → Checks role-based permissions
  → Never assumes middleware already validated

Layer 3: Row Level Security (Database-level)
  → Last line of defense
  → Even a misconfigured server action can't leak data
  → Tables locked by RLS policies — no policy = no access
```

### Role-Based Route Protection in Middleware

```typescript
// utils/supabase/middleware.ts — with role-based routing
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Public routes — no auth needed
  const publicRoutes = ['/', '/login', '/signup', '/about', '/pricing']
  if (publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    // Redirect logged-in users away from auth pages
    if (user && (pathname === '/login' || pathname === '/signup')) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return supabaseResponse
  }

  // All other routes require authentication
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // Role-based route restrictions (optional — primary enforcement is in RLS)
  const userRole = user.app_metadata?.user_role
  const adminRoutes = ['/admin', '/settings/organization']
  if (adminRoutes.some(r => pathname.startsWith(r)) && userRole === 'client') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}
```

---

## 8. Server Actions Auth Pattern

Every server action must independently verify authentication. Never rely on middleware.

### Basic Auth Check Pattern

```typescript
'use server'

import { createClient } from '@/utils/supabase/server'

export async function updateEstimate(estimateId: string, data: EstimateUpdate) {
  const supabase = await createClient()

  // Step 1: Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Step 2: Check role if needed
  const userRole = user.app_metadata?.user_role as 'owner' | 'employee' | 'client'
  if (userRole === 'client') {
    return { success: false, error: 'Clients cannot modify estimates' }
  }

  // Step 3: Perform mutation (RLS provides additional protection)
  const { data: result, error } = await supabase
    .from('estimates')
    .update(data)
    .eq('id', estimateId)
    .select()
    .single()

  if (error) {
    return { success: false, error: 'Failed to update estimate' }
  }

  return { success: true, data: result }
}
```

### Role Helper Pattern

```typescript
// utils/auth.ts — reusable auth helpers for server actions
import { createClient } from '@/utils/supabase/server'

type AppRole = 'owner' | 'employee' | 'client'

interface AuthResult {
  user: User
  role: AppRole
  orgId: string
}

export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error('Not authenticated')
  }

  return {
    user,
    role: (user.app_metadata?.user_role as AppRole) ?? 'client',
    orgId: user.app_metadata?.org_id ?? '',
  }
}

export async function requireRole(...allowedRoles: AppRole[]): Promise<AuthResult> {
  const auth = await requireAuth()
  if (!allowedRoles.includes(auth.role)) {
    throw new Error(`Requires role: ${allowedRoles.join(' or ')}`)
  }
  return auth
}
```

### Using the Helper

```typescript
'use server'

import { requireRole } from '@/utils/auth'

export async function deleteEstimate(estimateId: string) {
  // Only owner and employee can delete
  const { user } = await requireRole('owner', 'employee')

  const supabase = await createClient()
  const { error } = await supabase
    .from('estimates')
    .delete()
    .eq('id', estimateId)

  if (error) {
    return { success: false, error: 'Failed to delete estimate' }
  }

  return { success: true }
}
```

---

## 9. Service Role (Admin) Operations

Use the service role client when you need to:
- Bypass RLS for administrative operations
- Access data across organizations
- Perform system-level operations (user management, bulk operations)

### Creating the Admin Client

```typescript
// utils/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

// IMPORTANT: Use @supabase/supabase-js directly, NOT @supabase/ssr
// The SSR client uses cookies that could inject user sessions
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
```

### Usage Examples

```typescript
'use server'

import { createAdminClient } from '@/utils/supabase/admin'
import { requireRole } from '@/utils/auth'

// Example: Owner invites a new user
export async function inviteUser(email: string, role: AppRole, orgId: string) {
  // Still verify the CALLER is authorized
  await requireRole('owner')

  const admin = createAdminClient()

  // Use admin client to create invitation (bypasses RLS)
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { invited_to_org: orgId, assigned_role: role }
  })

  if (error) {
    return { success: false, error: 'Failed to invite user' }
  }

  // Insert role assignment (bypasses RLS on user_roles table)
  await admin.from('user_roles').insert({
    user_id: data.user.id,
    organization_id: orgId,
    role,
  })

  return { success: true }
}

// Example: System-level data aggregation
export async function getSystemStats() {
  await requireRole('owner')

  const admin = createAdminClient()

  // Query across all organizations (bypasses RLS)
  const { data, error } = await admin
    .from('estimates')
    .select('organization_id, status, count')

  return { success: !error, data }
}
```

### When to Use Service Role vs User Client

| Scenario | Client | Why |
|----------|--------|-----|
| User reads their own estimates | Server client (SSR) | RLS filters automatically |
| User updates an estimate | Server client (SSR) | RLS validates ownership |
| Owner invites new user | Admin client | Needs to write to auth + user_roles |
| Webhook processes external event | Admin client | No user session available |
| Cron job runs nightly cleanup | Admin client | System operation, no user context |
| User views shared estimate | Server client (SSR) | RLS policy handles sharing logic |

---

## 10. Realtime Channel Authentication

### Overview

Supabase Realtime has two auth models:

1. **Postgres Changes**: Automatically respects RLS on the table being listened to
2. **Broadcast + Presence**: Requires explicit RLS on `realtime.messages` table + `private: true` flag

ShossyWorks uses Broadcast + Presence for collaborative editing, so explicit Realtime authorization is required.

### Setting Up Realtime Authorization

```sql
-- Step 1: Create RLS policy for receiving broadcasts
CREATE POLICY "Users can receive broadcasts for their estimates"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- extension must be 'broadcast' for broadcast messages
  realtime.messages.extension = 'broadcast'
  AND EXISTS (
    SELECT 1 FROM public.estimate_collaborators ec
    WHERE ec.user_id = auth.uid()
    AND ec.estimate_id = (realtime.topic())::UUID
  )
);

-- Step 2: Create RLS policy for sending broadcasts
CREATE POLICY "Users can send broadcasts to their estimates"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND EXISTS (
    SELECT 1 FROM public.estimate_collaborators ec
    WHERE ec.user_id = auth.uid()
    AND ec.estimate_id = (realtime.topic())::UUID
    -- Only owner/employee can send, not clients
    AND ec.role IN ('owner', 'employee')
  )
);

-- Step 3: Create RLS policy for presence
CREATE POLICY "Users can publish presence for their estimates"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension = 'presence'
  AND EXISTS (
    SELECT 1 FROM public.estimate_collaborators ec
    WHERE ec.user_id = auth.uid()
    AND ec.estimate_id = (realtime.topic())::UUID
  )
);

CREATE POLICY "Users can receive presence for their estimates"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'presence'
  AND EXISTS (
    SELECT 1 FROM public.estimate_collaborators ec
    WHERE ec.user_id = auth.uid()
    AND ec.estimate_id = (realtime.topic())::UUID
  )
);
```

### Client-Side Channel Creation

```typescript
// hooks/use-realtime-estimate.ts
import { createClient } from '@/utils/supabase/client'
import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function useRealtimeEstimate(estimateId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabase = createClient()

  useEffect(() => {
    // Channel name = estimate ID (matches realtime.topic() in RLS)
    const channel = supabase.channel(estimateId, {
      config: { private: true },  // REQUIRED for auth enforcement
    })

    channel
      .on('broadcast', { event: 'line-item-update' }, (payload) => {
        // Handle incoming edit from another user
        handleRemoteUpdate(payload)
      })
      .on('presence', { key: 'users' }, (payload) => {
        // Handle presence updates (who's online)
        handlePresenceChange(payload)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track this user's presence
          await channel.track({
            user_id: supabase.auth.getUser().then(r => r.data.user?.id),
            online_at: new Date().toISOString(),
          })
        }
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [estimateId])

  // Function to broadcast local edits
  function broadcastEdit(event: string, payload: unknown) {
    channelRef.current?.send({
      type: 'broadcast',
      event,
      payload,
    })
  }

  return { broadcastEdit }
}
```

### How Realtime Auth Works Internally

```
1. Client calls supabase.channel('estimate-123', { config: { private: true } })
2. supabase-js upgrades HTTP to WebSocket, includes user JWT in headers
3. Realtime server receives WebSocket connection
4. When channel.subscribe() is called:
   a. Server extracts JWT claims
   b. Sets Postgres config vars (request.jwt.claims, etc.)
   c. Runs SELECT query against realtime.messages with the user's context
   d. If RLS policies pass → subscription allowed
   e. Result is CACHED for the duration of the connection
5. On token refresh (new access_token):
   a. Client sends 'access_token' message via WebSocket
   b. Server re-evaluates RLS policies with new claims
   c. Cache is updated
6. No actual data is stored in realtime.messages — it's just used for policy evaluation
```

### Important Notes

- `private: true` is REQUIRED for production. Without it, any authenticated user can join any channel.
- For Postgres Changes, authorization uses the table's own RLS policies (no `realtime.messages` needed).
- Realtime re-checks policies on token refresh, so role changes take effect within the token expiry window.
- Use `realtime.topic()` in RLS policies to reference the channel name.

---

## 11. RLS Policy Patterns

### Accessing JWT Claims in RLS

```sql
-- Get the current user's UUID
auth.uid()
-- Returns: the 'sub' claim from the JWT

-- Get the full JWT payload
auth.jwt()
-- Returns: JSONB of all claims

-- Access specific claims
(auth.jwt() ->> 'email')                              -- user email
(auth.jwt() -> 'app_metadata' ->> 'user_role')        -- custom role
(auth.jwt() -> 'app_metadata' ->> 'org_id')           -- custom org ID

-- Using current_setting (lower-level)
current_setting('request.jwt.claims', true)::JSONB -> 'app_metadata' ->> 'user_role'
```

### ShossyWorks RLS Pattern (Three Roles)

```sql
-- Helper function to extract role (avoids repeating JSONB navigation)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'user_role',
    'client'
  );
$$;

-- Estimates table policies
-- Owner and Employee: full access
CREATE POLICY "owner_employee_all" ON public.estimates
FOR ALL
TO authenticated
USING (
  get_user_role() IN ('owner', 'employee')
  AND organization_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::UUID
)
WITH CHECK (
  get_user_role() IN ('owner', 'employee')
  AND organization_id = (auth.jwt() -> 'app_metadata' ->> 'org_id')::UUID
);

-- Client: filtered read-only (only estimates shared with them)
CREATE POLICY "client_read" ON public.estimates
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'client'
  AND EXISTS (
    SELECT 1 FROM public.estimate_shares es
    WHERE es.estimate_id = estimates.id
    AND es.client_user_id = auth.uid()
  )
);

-- Line items: inherit estimate access
CREATE POLICY "line_items_via_estimate" ON public.line_items
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = line_items.estimate_id
    -- This triggers the estimate's own RLS policies
  )
);
```

---

## 12. CORS Configuration

### Supabase Dashboard Settings

- **Site URL**: Set to your production URL (e.g., `https://shossyworks.com`)
  - Location: Dashboard → Authentication → URL Configuration → Site URL
  - Used for: email confirmation links, password reset links
- **Redirect URLs**: Add all valid redirect destinations
  - `https://shossyworks.com/**`
  - `http://localhost:3000/**` (for development)
  - `https://*.vercel.app/**` (for preview deployments)

### CORS for the REST API

Supabase's REST API (PostgREST) handles CORS automatically. You do NOT need to configure CORS for standard supabase-js calls. The Supabase CDN manages the `Access-Control-Allow-Origin` headers.

### CORS for Edge Functions

If using Supabase Edge Functions, you must handle CORS manually:

```typescript
// supabase/functions/my-function/index.ts
import { corsHeaders } from '@supabase/supabase-js/dist/module/lib/constants'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Your function logic...
  return new Response(JSON.stringify({ data: 'hello' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
```

### Next.js API Routes

For any custom API routes in Next.js that Supabase calls (webhooks, etc.), configure CORS in `next.config.js`:

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_SUPABASE_URL! },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'authorization, apikey, content-type' },
        ],
      },
    ]
  },
}
```

---

## 13. Environment Variables Summary

### Required for All Environments

| Variable | Public? | Source | Purpose |
|----------|---------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase Dashboard → Settings → API | Base URL for all Supabase API calls |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase Dashboard → Settings → API | Publishable/anon key for client + SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | **NO** | Azure Key Vault | Admin operations, RLS bypass |
| `SUPABASE_JWT_SECRET` | **NO** | Azure Key Vault | JWT verification (legacy) |

### Connection Pattern by Variable

```
NEXT_PUBLIC_SUPABASE_URL
├── Browser client (createBrowserClient)
├── Server client (createServerClient)
├── Admin client (createClient with service role)
└── Middleware client (createServerClient)

NEXT_PUBLIC_SUPABASE_ANON_KEY
├── Browser client (default auth header)
├── Server client (base key, user JWT overrides via cookie)
└── Middleware client (base key, user JWT overrides via cookie)

SUPABASE_SERVICE_ROLE_KEY
└── Admin client ONLY (createClient with service role)
    Never in browser, never with NEXT_PUBLIC_ prefix

SUPABASE_JWT_SECRET
└── Manual JWT verification (optional, prefer JWKS instead)
```

---

## 14. Next.js 16 Migration Notes

Next.js 16 (released 2026) renamed `middleware.ts` to `proxy.ts`:

| Next.js 15 | Next.js 16+ | Notes |
|-------------|-------------|-------|
| `middleware.ts` | `proxy.ts` | File at project root |
| `export function middleware()` | `export function proxy()` | Function name change |
| `NextRequest` / `NextResponse` | Same | No API changes |
| `matcher` config | Same | No changes |

### Migration Steps

1. Rename `middleware.ts` → `proxy.ts`
2. Rename exported function `middleware` → `proxy`
3. The `utils/supabase/middleware.ts` helper file does NOT change (it's not a Next.js convention file)
4. Run `npx @next/codemod middleware-to-proxy` to auto-migrate

### Why the Rename?

"Proxy" better describes the capability — it operates at the network boundary in front of the app, unlike Express-style middleware that runs within the request pipeline. The behavior is identical.

---

## Sources

- [Creating a Supabase Client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Setting up Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [JSON Web Tokens (JWT)](https://supabase.com/docs/guides/auth/jwts)
- [JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields)
- [Understanding API Keys](https://supabase.com/docs/guides/api/api-keys)
- [Service Role with Next.js Backend (Discussion)](https://github.com/orgs/supabase/discussions/30739)
- [getClaims vs getUser vs getSession (Issue)](https://github.com/supabase/supabase/issues/40985)
- [getClaims API Reference](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [Next.js 16 proxy.ts Migration](https://nextjs.org/docs/messages/middleware-to-proxy)
- [Next.js + Supabase Cookie-Based Auth 2025 Guide](https://the-shubham.medium.com/next-js-supabase-cookie-based-auth-workflow-the-best-auth-solution-2025-guide-f6738b4673c1)
