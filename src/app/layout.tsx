import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Agent",
  description: "A permission-aware expense review agent with an auditable run log and evals.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
