import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <div className="login">
      <div className="login-card">
        <div className="brandmark">
          <span className="logo">RTD</span>
          <span className="brandname">Retail Tenant<br />Directory</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">No password. We&apos;ll email you a link — once per device.</p>
        {sp.error === "link" && <p className="error">That link didn&apos;t work or has expired. Request a new one.</p>}
        <LoginForm next={next} />
      </div>
    </div>
  );
}
