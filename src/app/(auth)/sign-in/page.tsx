"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)]">
        <h1 className="mb-[var(--space-6)] text-center text-2xl font-bold text-[var(--color-text-primary)]">
          Sign In
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
