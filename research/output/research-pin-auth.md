# PIN-Based Authentication Research

**Date:** 2026-04-02
**Context:** Szostak Build construction estimating platform (Supabase + Next.js)
**Question:** Can we add an optional 6-digit PIN as a faster login alternative alongside email+password?

---

## Recommendation Summary

**Use Option C: PIN as a "Session Unlock" mechanism.** The PIN does not authenticate the user from scratch -- it unlocks a suspended session on a trusted device. Full email+password login via Supabase Auth remains the real authentication. The PIN is stored as a bcrypt hash in `user_profiles`, validated by a Next.js server action, and is scoped to the device where the user last did a full login.

This is the simplest, most secure, and most aligned approach for a construction estimating tool. It avoids fighting Supabase Auth's design, requires no custom auth hooks, and provides the phone-lock-screen UX the owner wants.

---

## 1. Supabase Auth Capabilities Assessment

### What Supabase Auth supports natively
- Email + password sign-in (`signInWithPassword`)
- Magic link (email OTP)
- Phone OTP
- Social login (Google, GitHub, etc.)
- MFA via TOTP (authenticator apps) and phone verification codes
- Custom Access Token Hook (add claims to JWT before issuance)
- Password Verification Hook (run custom logic during password verification)
- Session management with configurable lifetimes (time-boxed, inactivity timeout)
- Refresh tokens (single-use, no expiry by default)

### What Supabase Auth does NOT support
- **Custom authentication factors.** You cannot add "PIN" as a first-class auth factor. Supabase MFA is strictly TOTP or phone-delivered codes.
- **Custom signIn methods.** There is no `signInWithPIN()`. The auth system expects one of its supported methods.
- **Overriding the auth flow.** The Password Verification Hook lets you add logic *during* a password check, but you cannot replace the password with a PIN through this hook.

### Implication
Any PIN system must sit *alongside* Supabase Auth, not inside it. Supabase Auth handles real authentication (email+password). The PIN layer is an application-level convenience that operates on top of a valid, existing session.

**Sources:**
- [Supabase Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Password Verification Hook](https://supabase.com/docs/guides/auth/auth-hooks/password-verification-hook)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [User Sessions](https://supabase.com/docs/guides/auth/sessions)

---

## 2. Security Analysis of 6-Digit PINs

### The math
- 6 digits = 1,000,000 possible combinations
- A determined attacker with no rate limiting could brute-force this in minutes
- Compare: an 8-character alphanumeric password = ~2.8 trillion combinations
- PINs are roughly **2.8 million times weaker** than a decent password

### Why this is acceptable for this use case
A 6-digit PIN is NOT the authentication boundary -- the full email+password login is. The PIN only unlocks a session that was already authenticated. This is the same security model as:
- iPhone Face ID / PIN (the real auth is your Apple ID password)
- Banking apps (PIN unlocks a device-bound session; the real auth was account setup)
- Windows Hello PIN (bound to TPM on the device; the real auth is Microsoft account)

### Required mitigations (non-negotiable)

| Control | Recommendation |
|---------|---------------|
| **Rate limiting** | 5 failed attempts = 15-minute lockout. 15 failures in 24 hours = PIN disabled, require full re-auth. |
| **Device binding** | PIN only works on devices where the user has previously done a full email+password login. Enforced via an httpOnly secure cookie (`device_trust_token`). |
| **PIN hashing** | bcrypt with cost factor 10. Never store PINs in plaintext. bcrypt's constant-time comparison prevents timing attacks. |
| **Lockout notification** | After 5 failed attempts, optionally notify the user by email (nice-to-have, not MVP). |
| **PIN expiry** | Force full re-auth every 30 days regardless of PIN usage. Configurable per deployment. |
| **Brute-force ceiling** | With 5-attempt lockout and 15-minute cooldown, an attacker gets 480 attempts/day = 0.048% chance of guessing per day. At this rate, expected time to crack is ~5.7 years. Acceptable for a construction estimating tool. |

### What NOT to worry about
- **Replay attacks:** The PIN is never transmitted to the client. Server action validates it server-side, returns a session cookie. HTTPS protects in transit.
- **Offline cracking:** Even if the bcrypt hash leaks, 1M combinations at bcrypt cost 10 takes ~28 hours on a single GPU. Combined with the device trust requirement, this is a very low risk.
- **Shoulder surfing:** 6 digits entered on a masked input field is reasonably safe. Not a banking app.

**Sources:**
- [LoginRadius: PIN Authentication Security](https://www.loginradius.com/blog/identity/what-is-pin-authentication)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Auth0: Hashing in Action (bcrypt)](https://auth0.com/blog/hashing-in-action-understanding-bcrypt/)

---

## 3. Implementation Approach Analysis

### Option A: PIN as custom credential (REJECTED)
Store PIN hash in `user_profiles`, validate via server action, issue a fresh Supabase session on success.

**Problem:** You cannot programmatically create a valid Supabase Auth session from a server action. `supabase.auth.admin.createSession()` does not exist. You would need to store the user's password to call `signInWithPassword()` on their behalf, which is a security disaster. You could issue your own JWT, but then you are maintaining a parallel auth system alongside Supabase Auth, doubling complexity and attack surface.

**Verdict:** Over-engineered, security risks, fights Supabase's design.

### Option B: Supabase custom auth hook (REJECTED)
Use the Password Verification Hook or a custom hook to accept PIN as a factor.

**Problem:** The Password Verification Hook runs *during* a password check -- it cannot replace the password. There is no "custom factor" hook. You could theoretically abuse the hook to accept a PIN in the password field, but this would:
1. Bypass Supabase's password strength requirements
2. Confuse the auth audit trail
3. Break if Supabase changes hook behavior
4. Store the PIN in `auth.users` alongside the password, mixing concerns

**Verdict:** Hacky, fragile, abuses the API's intended design.

### Option C: PIN as session unlock (RECOMMENDED)
The PIN does not create a session -- it *unlocks* one. The flow:

1. User does full email+password login via Supabase Auth (normal flow)
2. Supabase Auth creates a session with access + refresh tokens
3. App stores session tokens in httpOnly cookies (standard `@supabase/ssr` behavior)
4. App also sets a `device_trust_token` (random UUID, stored in `user_profiles.trusted_devices` jsonb column)
5. On the client, app sets a "session locked" state after inactivity timeout (e.g., 15 min)
6. Locked state shows PIN entry screen instead of the app
7. PIN submission goes to a server action that:
   a. Checks `device_trust_token` cookie against `user_profiles.trusted_devices`
   b. Validates PIN hash against `user_profiles.pin_hash`
   c. Checks attempt counter for rate limiting
   d. If valid: unlocks the UI (the Supabase session was valid the whole time)
   e. If invalid: increments failure counter, enforces lockout rules
8. If the Supabase session itself has expired (refresh token revoked, user signed out elsewhere), PIN unlock fails gracefully and redirects to full login

**Why this works:**
- Supabase Auth session is the real security boundary -- never bypassed
- PIN is just a UI lock, like a phone lock screen
- No custom auth hooks, no fighting Supabase's design
- Server action validates PIN server-side (never trust the client)
- Device trust prevents PIN from working on unknown devices
- If the underlying Supabase session is invalid, PIN unlock fails automatically

**Verdict:** Simple, secure, works with Supabase instead of against it.

---

## 4. User Experience Flow (Detailed)

### First-time setup
```
1. User signs up or logs in with email + password (standard Supabase Auth)
2. After successful login, app shows: "Set a 6-digit PIN for quick access"
3. User enters PIN twice (confirmation)
4. Server action:
   - Hashes PIN with bcrypt (cost 10)
   - Stores hash in user_profiles.pin_hash
   - Generates device_trust_token (crypto.randomUUID())
   - Stores token in user_profiles.trusted_devices jsonb array
   - Sets device_trust_token as httpOnly secure cookie (30-day expiry)
5. User proceeds to app
```

### Returning visit (same device, session valid)
```
1. User navigates to app
2. Middleware checks: valid Supabase session? Yes. Device trust cookie? Yes. PIN set? Yes.
3. App renders PIN entry screen (not the full login page)
4. User enters 6-digit PIN
5. Server action validates:
   - device_trust_token cookie matches a trusted_devices entry for this user
   - PIN matches pin_hash (bcrypt compare)
   - Attempt count < 5 (rate limiting)
6. Success: app unlocks, user sees their dashboard
7. Failure: attempt counter increments, show error, after 5 failures lock out for 15 min
```

### Session expired or new device
```
1. User navigates to app
2. Middleware checks: valid Supabase session? No (or no device trust cookie)
3. Full email + password login page shown
4. After successful login:
   - If no device trust cookie: generate new one, add to trusted_devices
   - If PIN not set: prompt to set PIN
   - If PIN already set: user can proceed (PIN will be used next time)
```

### Forgot PIN
```
1. PIN entry screen has "Forgot PIN?" link
2. Clicking it redirects to full email + password login
3. After successful re-auth, user is prompted to set a new PIN
4. Old pin_hash is overwritten
```

### Explicit sign-out
```
1. User clicks "Sign out"
2. Supabase Auth session destroyed (standard signOut())
3. device_trust_token cookie cleared
4. Optionally: remove this device from trusted_devices array
5. Next visit requires full email + password login
```

---

## 5. Multi-User Roles

### Recommended approach: `user_profiles` table with `role` column + Custom Access Token Hook

Supabase supports two mechanisms for roles. Here is why a hybrid approach is best:

#### Role storage: `user_profiles.role` column
```sql
create type public.user_role as enum ('owner', 'employee', 'client');

-- user_profiles table (you likely already need this for PIN storage)
create table public.user_profiles (
  id uuid references auth.users on delete cascade primary key,
  role user_role not null default 'employee',
  full_name text,
  pin_hash text,                    -- bcrypt hash of 6-digit PIN
  pin_attempts int default 0,       -- failed attempt counter
  pin_locked_until timestamptz,     -- lockout timestamp
  trusted_devices jsonb default '[]', -- array of device trust tokens
  pin_set_at timestamptz,           -- for PIN expiry enforcement
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_profiles enable row level security;
```

#### Inject role into JWT: Custom Access Token Hook
This is the recommended Supabase pattern. A Postgres function runs before every token issuance and adds the role to `app_metadata.user_role` in the JWT. This means:
- RLS policies can read the role directly from `auth.jwt() -> 'app_metadata' ->> 'user_role'`
- Client-side code can read the role from the session without an extra DB query
- Role changes take effect on next token refresh (within minutes)

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_role public.user_role;
begin
  -- Get the user's role from user_profiles
  select role into user_role 
  from public.user_profiles 
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if user_role is not null then
    -- Set the role in app_metadata
    claims := jsonb_set(
      claims, 
      '{app_metadata, user_role}', 
      to_jsonb(user_role::text)
    );
  else
    -- Default to 'employee' if no profile exists yet
    claims := jsonb_set(
      claims, 
      '{app_metadata, user_role}', 
      '"employee"'
    );
  end if;

  -- Update the claims in the event
  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Grant necessary permissions
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant all on table public.user_profiles to supabase_auth_admin;
```

Then enable the hook in Supabase Dashboard > Authentication > Hooks > Custom Access Token.

#### RLS policies using the role
```sql
-- Example: only owner can access billing settings
create policy "Owner access to billing"
  on billing_settings for all
  using (
    (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'owner'
  );

-- Example: clients can only see their own project estimates
create policy "Clients see own project estimates"
  on estimates for select
  using (
    (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'client'
    and project_id in (
      select project_id from client_projects 
      where client_id = auth.uid()
    )
  );

-- Example: owner and employees can see all estimates
create policy "Staff access to all estimates"
  on estimates for select
  using (
    (auth.jwt() -> 'app_metadata' ->> 'user_role') in ('owner', 'employee')
  );
```

### Role permissions matrix

| Capability | Owner | Employee | Client |
|-----------|-------|----------|--------|
| View all estimates | Yes | Yes | No (own projects only) |
| Create/edit estimates | Yes | Yes | No |
| View catalog/items | Yes | Yes | No |
| Edit catalog/items | Yes | Yes | No |
| Billing & payments | Yes | No | No |
| Company settings | Yes | No | No |
| User management | Yes | No | No |
| View their project estimates | Yes | Yes | Yes (filtered) |
| Export/print estimates | Yes | Yes | Yes (own projects) |

### Why NOT use Supabase `user_roles` + `role_permissions` tables
The Supabase RBAC guide shows a full role-permission-mapping pattern with separate `user_roles` and `role_permissions` tables. This is overkill for 3 fixed roles. A single `role` enum column on `user_profiles` is simpler, faster, and easier to reason about. If you later need granular permissions (e.g., "employee can edit estimates but not delete them"), you can add a permissions table then.

**Sources:**
- [Custom Claims & RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)
- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

---

## 6. What NOT to Build (MVP Boundaries)

### Do not build
- **Biometric auth** -- Browser WebAuthn/FIDO2 is complex, poorly supported on older devices, and overkill for a construction estimating tool
- **SMS-based PIN delivery** -- You are not building MFA. The PIN is set by the user, not generated and sent. No SMS provider needed.
- **Custom JWT signing** -- Never roll your own JWT system alongside Supabase Auth. Use Supabase sessions as-is.
- **PIN recovery via email** -- Just re-authenticate with email+password and set a new PIN. No separate recovery flow.
- **Per-device PIN** -- One PIN per user, not one per device. The device trust token handles device binding.
- **Complex session management** -- Use Supabase's built-in session management. Do not build your own session store.
- **Admin PIN reset** -- The owner should not be able to reset other users' PINs. Users reset their own by re-authenticating with email+password.

### Build later (not MVP)
- Email notification on 5+ failed PIN attempts (nice security signal, not critical)
- "Remember this device for 90 days" setting (use 30 days for MVP)
- PIN change without full re-auth (user enters current PIN + new PIN)
- Session activity log (who logged in, when, from where)

### Build now (MVP)
- Email + password login (standard Supabase Auth)
- Optional 6-digit PIN setup after first login
- PIN unlock screen for returning users on trusted devices
- Rate limiting (5 attempts, 15-min lockout)
- Device trust cookie
- `user_profiles` table with role, pin_hash, trusted_devices
- Custom Access Token Hook for role injection
- Basic RLS policies for owner/employee/client

---

## 7. Implementation Sketch

### Database schema additions
```sql
-- Migration: add PIN auth support to user_profiles

-- Type for user roles (if not already exists)
do $$ begin
  create type public.user_role as enum ('owner', 'employee', 'client');
exception
  when duplicate_object then null;
end $$;

-- Extend or create user_profiles
create table if not exists public.user_profiles (
  id uuid references auth.users on delete cascade primary key,
  role user_role not null default 'employee',
  full_name text,
  pin_hash text,
  pin_attempts int not null default 0,
  pin_locked_until timestamptz,
  pin_set_at timestamptz,
  trusted_devices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can read and update their own profile
create policy "Users can view own profile"
  on user_profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create profile on signup (trigger)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### Server action: PIN validation (Next.js)
```typescript
// lib/actions/pin-auth.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15
const PIN_EXPIRY_DAYS = 30

interface PinResult {
  success: boolean
  error?: string
  requiresFullAuth?: boolean
}

export async function validatePin(pin: string): Promise<PinResult> {
  const supabase = await createClient()
  
  // 1. Check that a valid Supabase session exists
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Session expired', requiresFullAuth: true }
  }

  // 2. Get device trust token from cookie
  const cookieStore = await cookies()
  const deviceToken = cookieStore.get('device_trust_token')?.value
  if (!deviceToken) {
    return { success: false, error: 'Device not trusted', requiresFullAuth: true }
  }

  // 3. Get user profile with PIN data
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('pin_hash, pin_attempts, pin_locked_until, pin_set_at, trusted_devices')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.pin_hash) {
    return { success: false, error: 'PIN not set', requiresFullAuth: true }
  }

  // 4. Check lockout
  if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
    const remaining = Math.ceil(
      (new Date(profile.pin_locked_until).getTime() - Date.now()) / 60000
    )
    return { success: false, error: `Too many attempts. Try again in ${remaining} minutes.` }
  }

  // 5. Check device trust
  const trustedDevices = (profile.trusted_devices as string[]) || []
  if (!trustedDevices.includes(deviceToken)) {
    return { success: false, error: 'Device not recognized', requiresFullAuth: true }
  }

  // 6. Check PIN expiry
  if (profile.pin_set_at) {
    const pinAge = Date.now() - new Date(profile.pin_set_at).getTime()
    if (pinAge > PIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
      return { success: false, error: 'PIN expired. Please sign in with your password.', requiresFullAuth: true }
    }
  }

  // 7. Validate PIN
  const pinValid = await bcrypt.compare(pin, profile.pin_hash)

  if (!pinValid) {
    const newAttempts = (profile.pin_attempts || 0) + 1
    const updateData: Record<string, unknown> = { pin_attempts: newAttempts }

    if (newAttempts >= MAX_ATTEMPTS) {
      updateData.pin_locked_until = new Date(
        Date.now() + LOCKOUT_MINUTES * 60 * 1000
      ).toISOString()
    }

    await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('id', user.id)

    const remaining = MAX_ATTEMPTS - newAttempts
    if (remaining <= 0) {
      return { success: false, error: `Too many attempts. Locked for ${LOCKOUT_MINUTES} minutes.` }
    }
    return { success: false, error: `Incorrect PIN. ${remaining} attempts remaining.` }
  }

  // 8. Success: reset attempt counter
  await supabase
    .from('user_profiles')
    .update({ pin_attempts: 0, pin_locked_until: null })
    .eq('id', user.id)

  return { success: true }
}

export async function setPin(pin: string): Promise<PinResult> {
  if (!/^\d{6}$/.test(pin)) {
    return { success: false, error: 'PIN must be exactly 6 digits' }
  }

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { success: false, error: 'Not authenticated', requiresFullAuth: true }
  }

  const pinHash = await bcrypt.hash(pin, 10)
  const deviceToken = crypto.randomUUID()

  // Get existing trusted devices
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('trusted_devices')
    .eq('id', user.id)
    .single()

  const trustedDevices = (profile?.trusted_devices as string[]) || []
  trustedDevices.push(deviceToken)

  // Keep only last 5 devices
  const trimmedDevices = trustedDevices.slice(-5)

  await supabase
    .from('user_profiles')
    .update({
      pin_hash: pinHash,
      pin_attempts: 0,
      pin_locked_until: null,
      pin_set_at: new Date().toISOString(),
      trusted_devices: trimmedDevices,
    })
    .eq('id', user.id)

  // Set device trust cookie (30 days)
  const cookieStore = await cookies()
  cookieStore.set('device_trust_token', deviceToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/',
  })

  return { success: true }
}
```

### Middleware: route to PIN or full login
```typescript
// middleware.ts (relevant excerpt)
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // ... standard Supabase session refresh logic ...

  const { data: { user } } = await supabase.auth.getUser()
  const deviceTrust = request.cookies.get('device_trust_token')?.value
  const isAuthPage = request.nextUrl.pathname.startsWith('/login')
  const isPinPage = request.nextUrl.pathname === '/pin'

  if (!user && !isAuthPage) {
    // No session at all: full login required
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && !isAuthPage && !isPinPage) {
    // User has a session. Check if PIN unlock is needed.
    // (The actual "is session locked" state would be managed
    //  via a short-lived cookie or session storage flag)
  }

  return response
}
```

### Key dependencies
- `bcryptjs` -- pure JS bcrypt implementation, works in Node.js server actions
- `@supabase/ssr` -- already required for Next.js + Supabase
- `@supabase/supabase-js` -- already required

No additional infrastructure needed. No SMS provider, no TOTP library, no external auth service.

---

## 8. Open Questions for Implementation

1. **Inactivity timeout before PIN lock:** How many minutes of inactivity before showing the PIN screen? Recommend 15 minutes as default, configurable by the owner.

2. **PIN on every visit vs. only after inactivity:** Should the PIN screen appear on every page load (if you closed the tab), or only after an inactivity timer? Recommend: show PIN screen if the tab was closed and reopened (detected via a session-storage flag that gets cleared on tab close).

3. **Client role onboarding:** How do clients get invited? Recommend: owner enters client email, system sends a Supabase invite link, client signs up, owner assigns the `client` role via an admin UI. Client's `user_profiles.role` is set to `'client'`, which the Custom Access Token Hook injects into the JWT.

4. **PIN optional for clients?** Clients use the system less frequently. Consider making PIN opt-in per-role. Employees get prompted to set a PIN; clients only see the option in settings.

5. **Tablet/shared device scenario:** On a job site, multiple employees might use the same tablet. The current design binds PIN to device -- should there be a "switch user" flow? Recommend: "Switch User" button on the PIN screen that goes to full email+password login and creates a new device trust token for the new user.

---

## 9. Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PIN architecture | Session unlock (Option C) | Works with Supabase, not against it |
| PIN length | 6 digits | Owner's preference, sufficient with rate limiting |
| PIN storage | bcrypt hash in user_profiles | Industry standard, constant-time comparison |
| Device binding | httpOnly cookie + trusted_devices array | Simple, no external dependencies |
| Rate limiting | 5 attempts / 15-min lockout | Brute-force ceiling of ~5.7 years |
| Role system | Enum column + Custom Access Token Hook | Simple for 3 fixed roles, JWT-embedded for RLS |
| RLS strategy | JWT app_metadata.user_role in policies | No extra DB queries per request |
| Session management | Supabase built-in + app-level lock | No custom session store needed |
