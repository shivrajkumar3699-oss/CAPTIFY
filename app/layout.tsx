import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Captify — Turn long videos into viral reels",
  description: "Upload a long video, get 5-7 hook-driven, auto-captioned reels in one click.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-black text-white min-h-screen">
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}