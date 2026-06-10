import type { Metadata } from "next";
import "./globals.css";
import { Agentation } from "agentation";

export const metadata: Metadata = {
  title: "Connect AI Web",
  description: "AI 1인 기업 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
