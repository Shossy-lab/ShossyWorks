"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="max-w-md p-[var(--space-8)] text-center">
        <h1 className="mb-[var(--space-2)] text-2xl font-bold text-[var(--color-text-primary)]">
          Something went wrong
        </h1>
        <p className="mb-[var(--space-6)] text-sm text-[var(--color-text-secondary)]">
          An unexpected error occurred. Please try again.
        </p>
        {process.env.NODE_ENV === "development" && error.digest && (
          <p className="mb-[var(--space-4)] font-mono text-xs text-[var(--color-text-tertiary)]">
            Digest: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          className="rounded-full bg-[var(--color-interactive)] px-[var(--space-6)] py-[var(--space-2)] text-sm font-medium text-[var(--color-interactive-text)] transition-[background] duration-100 hover:bg-[var(--color-interactive-hover)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
