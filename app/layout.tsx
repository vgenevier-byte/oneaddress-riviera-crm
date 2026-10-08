import type { Metadata } from "next";
import "./globals.css";
import "./mobile.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export const metadata: Metadata = {
  title: "OneAddress Riviera CRM",
  description: "CRM interne pour OneAddress Riviera"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
