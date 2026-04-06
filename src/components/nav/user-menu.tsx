"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function UserMenu({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        console.error("Sign-out error:", error.message);
      }
    } catch (err) {
      console.error("Sign-out failed:", err);
    }
    // Always redirect even on error — user wants to leave
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <span className="text-sm text-[var(--color-text-secondary)]">{email}</span>
      <button
        onClick={handleSignOut}
        className="rounded-full border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-1)] text-sm text-[var(--color-text-secondary)] transition-[background] duration-100 hover:bg-[var(--color-surface-hover)]"
      >
        Sign Out
      </button>
    </div>
  );
}
