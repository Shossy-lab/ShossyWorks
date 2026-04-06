"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAuthErrorMessage } from "@/lib/auth/error-messages";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });

      if (authError) {
        setError(getAuthErrorMessage(authError));
        return;
      }

      // If session exists, email verification is disabled — redirect immediately
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      // No session means email verification is enabled — show confirmation
      setShowConfirmation(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (showConfirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
        <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
          <h1 className="mb-[var(--space-4)] text-center text-2xl font-bold text-[var(--color-text-primary)]">
            Check Your Email
          </h1>
          <p className="mb-[var(--space-6)] text-center text-sm text-[var(--color-text-secondary)]">
            We sent a verification link to{" "}
            <span className="font-medium text-[var(--color-text-primary)]">
              {email}
            </span>
            . Please check your inbox and click the link to verify your account.
          </p>
          <p className="text-center text-sm text-[var(--color-text-secondary)]">
            Already verified?{" "}
            <Link
              href="/sign-in"
              className="font-medium text-[var(--color-text-link)] underline"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
        <h1 className="mb-[var(--space-6)] text-center text-2xl font-bold text-[var(--color-text-primary)]">
          Create Account
        </h1>

        <form onSubmit={handleSubmit} className="space-y-[var(--space-4)]">
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
              minLength={6}
              className="mt-[var(--space-1)] block w-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[var(--color-interactive)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--color-interactive-text)] transition-[background] duration-100 hover:bg-[var(--color-interactive-hover)] focus:outline-none disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-[var(--space-4)] text-center text-sm text-[var(--color-text-secondary)]">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-[var(--color-text-link)] underline"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
