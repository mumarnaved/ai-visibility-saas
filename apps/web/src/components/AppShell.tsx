"use client";

import { usePathname } from "next/navigation";

import AppNavigation from "./AppNavigation";
import AuthGuard, { PUBLIC_PATHS } from "./AuthGuard";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isPublicPage =
    PUBLIC_PATHS.includes(pathname);

  return (
    <>
      <AppNavigation />

      <div
        className={
          isPublicPage
            ? "min-h-screen"
            : "min-h-screen lg:pl-64"
        }
      >
        <AuthGuard>
          {children}
        </AuthGuard>
      </div>
    </>
  );
}
