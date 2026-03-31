import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hydra",
  description: "Multi-model AI orchestration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <body style={{ minHeight: "100%", display: "flex", flexDirection: "column", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
