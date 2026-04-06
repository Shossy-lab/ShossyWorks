export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-[var(--space-4)] focus:top-[var(--space-4)] focus:z-50 focus:rounded-full focus:bg-[var(--color-interactive)] focus:px-[var(--space-4)] focus:py-[var(--space-2)] focus:text-[var(--color-interactive-text)]"
    >
      Skip to content
    </a>
  );
}
