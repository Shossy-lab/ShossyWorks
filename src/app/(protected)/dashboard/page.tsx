import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="mb-[var(--space-6)] text-2xl font-bold text-[var(--color-text-primary)]">
        Dashboard
      </h1>
      <div className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/projects"
          className="border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-6)] transition-[background] duration-100 hover:bg-[var(--color-surface-hover)]"
        >
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Projects
          </h3>
          <p className="mt-[var(--space-2)] text-sm text-[var(--color-text-secondary)]">
            Manage your construction projects
          </p>
        </Link>
        <Link
          href="/settings"
          className="border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-6)] transition-[background] duration-100 hover:bg-[var(--color-surface-hover)]"
        >
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Settings
          </h3>
          <p className="mt-[var(--space-2)] text-sm text-[var(--color-text-secondary)]">
            Configure your account
          </p>
        </Link>
      </div>
    </div>
  );
}
