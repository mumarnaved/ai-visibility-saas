import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

import AppShell from "../components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Visibility",
  description: "AI search visibility monitoring platform",
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#f7f8fa]">
        <AppShell>
          {children}
        </AppShell>

        <Toaster
          position="bottom-right"
          expand={false}
          gap={10}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                "glass-panel flex w-full items-start gap-3 rounded-xl px-4 py-3.5 text-sm text-ink shadow-lg",
              title: "font-medium text-ink",
              description: "text-ink-muted",
              success: "!border-success-border",
              error: "!border-danger-border",
              actionButton:
                "!bg-primary !text-white !rounded-lg !px-3 !py-1.5 !text-xs !font-medium",
              cancelButton:
                "!bg-muted !text-ink-secondary !rounded-lg !px-3 !py-1.5 !text-xs !font-medium",
            },
          }}
        />
      </body>
    </html>
  );
}