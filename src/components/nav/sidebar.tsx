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
      aria-label="Sidebar"
      className={`flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-200 ${
        collapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-width)]"
      }`}
    >
      <div
        className="flex h-[var(--header-height)] items-center justify-between border-b border-[var(--color-border)] px-[var(--space-4)]"
      >
        {!collapsed && (
          <span className="text-lg font-bold text-[var(--color-text-primary)]">
            SW
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-[var(--space-8)] w-[var(--space-8)] items-center justify-center text-[var(--color-text-secondary)] transition-[background] duration-100 hover:bg-[var(--color-surface-hover)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "\u203A" : "\u2039"}
        </button>
      </div>
      <nav aria-label="Main navigation" className="flex-1 p-[var(--space-2)]">
        <ul className="space-y-[var(--space-1)]">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium transition-[background,border-color] duration-100 ${
                    isActive
                      ? "border-l-2 border-[var(--color-text-primary)] bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                      : "border-l-2 border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={isActive ? "page" : undefined}
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
