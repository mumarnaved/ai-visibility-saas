"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { isAuthenticated } from "../lib/auth";

export const PUBLIC_PATHS = ["/login", "/signup"];

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [ready, setReady] =
    useState(false);

  useEffect(() => {
    function checkAuth() {
      if (PUBLIC_PATHS.includes(pathname)) {
        setReady(true);
        return;
      }

      if (!isAuthenticated()) {
        router.replace("/login");
        return;
      }

      setReady(true);
    }

    checkAuth();
  }, [pathname, router]);

  if (!ready) {
    return null;
  }

  return <>{children}</>;
}
