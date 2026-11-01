import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { isHosted } from "@/lib/continuous/mode";

export const metadata: Metadata = {
  title: "Jarvis — Assistant",
  description:
    "Local command center for Jarvis: conversation, runs, approvals, leads, business, content and system health. Reads local files; nothing leaves the machine.",
};

export const viewport: Viewport = {
  themeColor: "#090d13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <div className="p-3 sm:p-5 pb-0 max-w-[1500px] mx-auto">
          <Nav hosted={isHosted()} />
        </div>
        <main id="main" tabIndex={-1}>{children}</main>
      </body>
    </html>
  );
}
