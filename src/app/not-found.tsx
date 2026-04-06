import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="max-w-md p-[var(--space-8)] text-center">
        <h1 className="mb-[var(--space-2)] text-2xl font-bold text-[var(--color-text-primary)]">
          404
        </h1>
        <p className="mb-[var(--space-6)] text-sm text-[var(--color-text-secondary)]">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-full bg-[var(--color-interactive)] px-[var(--space-6)] py-[var(--space-2)] text-sm font-medium text-[var(--color-interactive-text)] transition-[background] duration-100 hover:bg-[var(--color-interactive-hover)]"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
