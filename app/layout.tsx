import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/services/store";
import { LangProvider } from "@/services/i18n";
import { LangToggle } from "@/components/LangToggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nuwa — 女娲智能合成数据平台",
  description: "Nuwa Intelligent Synthetic Data Platform — 智能合成数据生成工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gv-bg text-gv-text">
        <LangProvider>
          <StoreProvider>
            <div className="fixed top-4 right-4 z-50">
              <LangToggle />
            </div>
            {children}
          </StoreProvider>
        </LangProvider>
      </body>
    </html>
  );
}
