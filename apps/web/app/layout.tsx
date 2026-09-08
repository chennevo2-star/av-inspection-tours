import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";

export const metadata: Metadata = {
  title: "AV Inspection Tours",
  description: "ניהול סיורי פיקוח עליון בתחום המולטימדיה",
  manifest: "/manifest.json",
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
      </body>
    </html>
  );
}
