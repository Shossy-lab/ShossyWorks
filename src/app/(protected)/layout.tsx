import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/nav/sidebar";
import { UserMenu } from "@/components/nav/user-menu";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex h-[var(--header-height)] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-6)]"
        >
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            ShossyWorks
          </h2>
          <UserMenu email={user.email ?? ""} />
        </header>
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] p-[var(--space-6)]">
          {children}
        </main>
      </div>
    </div>
  );
}
