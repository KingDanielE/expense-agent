import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Agent",
  description: "A permission-aware AI agent that reviews expense receipts, with an auditable run log and decision evals.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
