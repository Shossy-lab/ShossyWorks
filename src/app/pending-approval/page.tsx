"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PendingApprovalPage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        console.error("Sign-out error:", error.message);
      }
    } catch (err) {
      console.error("Sign-out failed:", err);
    }
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-8)] shadow-[var(--shadow-md)]">
        <h1 className="mb-[var(--space-2)] text-2xl font-bold text-[var(--color-text-primary)]">
          Account Pending Approval
        </h1>
        <p className="mb-[var(--space-2)] text-sm text-[var(--color-text-secondary)]">
          Your account has been created but is awaiting approval from an administrator.
        </p>
        <p className="mb-[var(--space-6)] text-sm text-[var(--color-text-secondary)]">
          You'll be able to access ShossyWorks once your account is approved.
        </p>
        <button
          onClick={handleSignOut}
          className="rounded-full bg-[var(--color-interactive)] px-[var(--space-6)] py-[var(--space-2)] text-sm font-medium text-[var(--color-interactive-text)] transition-[background] duration-100 hover:bg-[var(--color-interactive-hover)]"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
