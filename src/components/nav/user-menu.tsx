"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function UserMenu({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">{email}</span>
      <button
        onClick={handleSignOut}
        className="rounded-full border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-sm)] text-[var(--color-text-secondary)] transition-[background] duration-[var(--transition-fast)] hover:bg-[var(--color-surface-hover)]"
      >
        Sign Out
      </button>
    </div>
  );
}
