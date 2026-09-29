import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import AccountNav from "@/components/account-nav";

export const metadata: Metadata = {
  title: "CAPTIFYY — Turn long videos into viral reels",
  description:
    "Upload a long video, get 5-7 hook-driven, auto-captioned reels in one click.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white antialiased">
        <ClerkProvider>
          <AccountNav />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}