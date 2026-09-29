"use client";

import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

export default function AccountNav() {
  return (
    <div className="fixed right-4 top-4 z-[100] flex items-center gap-2 sm:right-6 sm:top-5">
      <SignedOut>
        <SignInButton>
          <button className="rounded-full border border-white/[0.10] bg-black/65 px-4 py-2.5 text-xs font-bold text-white/70 shadow-2xl backdrop-blur-2xl transition hover:border-[#F7D002]/30 hover:bg-white/[0.07] hover:text-white">
            Log in
          </button>
        </SignInButton>

        <SignUpButton>
          <button className="rounded-full bg-[#F7D002] px-4 py-2.5 text-xs font-black text-black shadow-[0_8px_35px_rgba(247,208,2,.16)] transition hover:brightness-110">
            Sign up
          </button>
        </SignUpButton>
      </SignedOut>

      <SignedIn>
        <Link
          href="/history"
          className="rounded-full border border-white/[0.10] bg-black/65 px-4 py-2.5 text-xs font-bold text-white/70 shadow-2xl backdrop-blur-2xl transition hover:border-[#F7D002]/30 hover:bg-white/[0.07] hover:text-white"
        >
          History
        </Link>

        <UserButton />
      </SignedIn>
    </div>
  );
}