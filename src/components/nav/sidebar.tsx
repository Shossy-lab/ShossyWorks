"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{
        width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)",
        transition: `width var(--transition-normal)`,
      }}
    >
      <div
        className="flex items-center justify-between border-b border-[var(--color-border)] px-[var(--space-4)]"
        style={{ height: "var(--header-height)" }}
      >
        {!collapsed && (
          <span className="text-[var(--text-lg)] font-[var(--font-bold)] text-[var(--color-text-primary)]">
            SW
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-[var(--space-8)] w-[var(--space-8)] items-center justify-center text-[var(--color-text-secondary)] transition-[background] duration-[var(--transition-fast)] hover:bg-[var(--color-surface-hover)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "\u203A" : "\u2039"}
        </button>
      </div>
      <nav className="flex-1 p-[var(--space-2)]">
        <ul className="space-y-[var(--space-1)]">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] font-[var(--font-medium)] transition-[background,border-color] duration-[var(--transition-fast)] ${
                    isActive
                      ? "border-l-2 border-[var(--color-text-primary)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                      : "border-l-2 border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  {!collapsed && item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
