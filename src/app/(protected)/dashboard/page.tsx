import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/projects"
          className="rounded-lg border bg-white p-6 shadow-sm transition hover:shadow-md"
        >
          <h3 className="text-lg font-semibold text-gray-900">Projects</h3>
          <p className="mt-2 text-sm text-gray-600">Manage your construction projects</p>
        </Link>
        <Link
          href="/settings"
          className="rounded-lg border bg-white p-6 shadow-sm transition hover:shadow-md"
        >
          <h3 className="text-lg font-semibold text-gray-900">Settings</h3>
          <p className="mt-2 text-sm text-gray-600">Configure your account</p>
        </Link>
      </div>
    </div>
  );
}
