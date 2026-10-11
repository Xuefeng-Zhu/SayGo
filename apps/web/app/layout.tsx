import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SayGo · Harbor Burger",
  description:
    "Say it. See it. Go. Independent Alexa+ concept simulator with a local POS sandbox.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
