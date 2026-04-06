"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthErrorMessage } from "@/lib/auth/error-messages";
import Link from "next/link";

const URL_ERROR_MESSAGES: Record<string, string> = {
  service_unavailable: "The authentication service is temporarily unavailable. Please try again later.",
  session_expired: "Your session has expired. Please sign in again.",
};

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const urlErrorMessage = urlError ? URL_ERROR_MESSAGES[urlError] ?? "An error occurred. Please try again." : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(getAuthErrorMessage(authError));
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
        <h1 className="mb-[var(--space-6)] text-center text-2xl font-bold text-[var(--color-text-primary)]">
          Sign In
        </h1>

        <form onSubmit={handleSubmit} className="space-y-[var(--space-4)]">
          {urlErrorMessage && (
            <div className="bg-[var(--color-error-bg)] p-[var(--space-3)] text-sm text-[var(--color-error)]">
              {urlErrorMessage}
            </div>
          )}
          {error && (
            <div className="bg-[var(--color-error-bg)] p-[var(--space-3)] text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--color-text-secondary)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-[var(--space-1)] block w-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--color-text-secondary)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-[var(--space-1)] block w-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[var(--color-interactive)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--color-interactive-text)] transition-[background] duration-100 hover:bg-[var(--color-interactive-hover)] focus:outline-none disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-[var(--space-4)] text-center text-sm text-[var(--color-text-secondary)]">
          Don&apos;t have an account?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-[var(--color-text-link)] underline"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
