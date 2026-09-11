import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup } from "../components/BrandLockup";
import { signOutAction } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <BrandLockup href="/app" className="brandmark" size={24} />
        <nav style={{ display: "flex", gap: 16, alignItems: "center", marginLeft: 24, flex: 1 }}>
          <Link href="/app">Home</Link>
          <Link href="/lab">Lab</Link>
        </nav>
        <form action={signOutAction}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
