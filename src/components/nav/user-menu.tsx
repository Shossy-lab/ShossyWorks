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
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">{email}</span>
      <button
        onClick={handleSignOut}
        className="rounded-md px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
      >
        Sign Out
      </button>
    </div>
  );
}
