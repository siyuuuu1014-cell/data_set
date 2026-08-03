import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { StoreProvider } from "@/services/store";
import { LangProvider } from "@/services/i18n";
import { LangToggle } from "@/components/LangToggle";
import { ConfirmProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Nuwa — 女娲智能合成数据平台",
  description: "Nuwa Intelligent Synthetic Data Platform — 智能合成数据生成工具",
  icons: {
    icon: [{ url: "/brand/nuwa-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/nuwa-mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gv-bg text-gv-text">
        <LangProvider>
          <ConfirmProvider>
            <StoreProvider>
              <div className="fixed bottom-4 right-4 z-50">
                <LangToggle hideOnHome hideOnManual />
              </div>
              {children}
            </StoreProvider>
          </ConfirmProvider>
        </LangProvider>
      </body>
    </html>
  );
}
