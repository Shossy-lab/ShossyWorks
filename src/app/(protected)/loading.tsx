export default function ProtectedLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
    </div>
  );
}
