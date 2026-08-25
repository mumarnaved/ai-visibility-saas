"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    name: "Overview",
    href: "/",
  },
  {
    name: "AI Visibility",
    href: "/ai-visibility",
  },
  {
    name: "Queries",
    href: "/queries",
  },
  {
    name: "Agents",
    href: "/agents",
  },
  {
    name: "Reports",
    href: "/reports",
  },
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-[#e5e7eb] bg-white lg:flex lg:flex-col">

      {/* LOGO */}

      <div className="border-b border-[#e5e7eb] px-6 py-5">
        <Link
          href="/"
          className="block"
        >
          <div className="text-lg font-bold text-[#111827]">
            AI Visibility
          </div>

          <div className="mt-1 text-xs text-[#6b7280]">
            AI search monitoring
          </div>
        </Link>
      </div>

      {/* NAVIGATION */}

      <nav className="flex-1 space-y-1 px-3 py-5">

        {navigation.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(
                  item.href
                );

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-[#111827] text-white"
                  : "text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
              }`}
            >
              {item.name}
            </Link>
          );
        })}

        <div className="my-4 border-t border-[#e5e7eb]" />

        <Link
          href="/settings"
          className={`flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            pathname.startsWith("/settings")
              ? "bg-[#111827] text-white"
              : "text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]"
          }`}
        >
          Settings
        </Link>

      </nav>

      {/* WORKSPACE */}

      <div className="border-t border-[#e5e7eb] p-4">

        <div className="rounded-lg bg-[#f7f8fa] p-3">

          <div className="text-xs text-[#6b7280]">
            Workspace
          </div>

          <div className="mt-1 truncate text-sm font-semibold text-[#111827]">
            SoftwareDome
          </div>

          <div className="mt-2 flex items-center gap-2">

            <span className="h-2 w-2 rounded-full bg-[#10b981]" />

            <span className="text-xs text-[#6b7280]">
              Connected
            </span>

          </div>

        </div>

      </div>

    </aside>
  );
}