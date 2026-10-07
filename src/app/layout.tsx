import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/Toast";

/**
 * Shreex has its own root layout, and the thing it deliberately does NOT have
 * is site chrome.
 *
 * The layout this replaced wrapped every page in Techxfluence public Chrome —
 * the marketing nav, the footer, the newsletter signup — because the platform
 * used to live inside that site. A platform that runs several businesses must
 * not carry one of them in its frame. Each surface brings its own: the
 * business dashboard has OsShell, the platform console has PlatformTopBar, and
 * sign-in has neither.
 *
 * The role accent is gone with it. It recoloured the whole UI by role, which
 * made sense for one organisation with members and hosts; here the only
 * meaningful colour would be per BUSINESS, and that belongs to a later change
 * than this one.
 */

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Shreex",
    template: "%s · Shreex",
  },
  description:
    "Shreex runs businesses: their plan, people, events, money and compliance, each isolated from every other.",
  // Nothing in here is for the public. Every page is behind a sign-in, and an
  // invitation link is a secret.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ink text-fg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
