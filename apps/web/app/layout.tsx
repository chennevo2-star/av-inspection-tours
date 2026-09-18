import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";
import { SyncAutoRegister } from "./sync-auto-register";
import { SyncBadge } from "./sync-badge";

export const metadata: Metadata = {
  title: "AV Inspection Tours",
  description: "ניהול סיורי פיקוח עליון בתחום המולטימדיה",
  manifest: "/manifest.json",
  // iOS Safari doesn't read the web manifest's own `display`/`icons` fields for "Add to Home Screen" —
  // it needs its own apple-* meta/link tags (Next's Metadata API generates them from this). Without
  // this, installing on iPhone still works, but falls back to a page screenshot as the icon and opens
  // inside Safari's browser chrome instead of a real standalone app window — meaningful for the actual
  // field-use case (a supervisor opening this with no signal) since standalone mode is what makes it
  // feel/behave like an installed app rather than a bookmarked tab.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AV Inspection",
  },
  icons: {
    // SVG apple-touch-icon support varies by iOS version — verify on the real device after deploying;
    // swap for a real PNG (e.g. public/logo-lshachar.png resized to 180x180) if it doesn't render well.
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b1220",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {children}
        <ServiceWorkerRegister />
        <SyncAutoRegister />
        <SyncBadge />
      </body>
    </html>
  );
}
