import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/nav/sidebar";
import { UserMenu } from "@/components/nav/user-menu";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("Auth error in protected layout:", error.message);
    redirect("/sign-in?error=service_unavailable");
  }

  if (!user) {
    redirect("/sign-in");
  }

  // Defense-in-depth: redirect pending users even if middleware missed it
  const role = (user.app_metadata?.user_role as string | undefined) ?? "pending";
  if (role === "pending") {
    redirect("/pending-approval");
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex h-[var(--header-height)] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-6)]"
        >
          <span className="text-lg font-semibold text-[var(--color-text-primary)]">
            ShossyWorks
          </span>
          <UserMenu email={user.email ?? ""} />
        </header>
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] p-[var(--space-6)]">
          {children}
        </main>
      </div>
    </div>
  );
}
