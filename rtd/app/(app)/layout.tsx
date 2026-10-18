import Link from "next/link";
import { getMe } from "@/lib/supabase";
import { NavLinks } from "./NavLinks";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();

  if (!me) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="brandmark"><span className="logo">RTD</span><span className="brandname">Retail Tenant<br />Directory</span></div>
          <h1>No access yet</h1>
          <p className="muted">You&apos;re signed in, but this email isn&apos;t on the RTD access list. Ask Dan Fishburn to add you.</p>
          <form action="/auth/signout" method="post"><button className="btn btn-outline">Sign out</button></form>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="RTD">
        <Link href="/" className="brandmark">
          <span className="logo">RTD</span>
          <span className="brandname">Retail Tenant<br />Directory</span>
        </Link>
        <NavLinks />
        <div className="navfoot">
          <span>Signed in as {me.display_name}</span>
          <form action="/auth/signout" method="post"><button>Sign out</button></form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
