import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const denied = sp.denied === "1";
  const failed = sp.error === "link";

  return (
    <div className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-white">CRM - Dan Fishburn</h1>
      <p className="mb-6 text-[15px] text-neutral-600 dark:text-neutral-300">
        Sign in with your email. No password — you&apos;ll get a link.
      </p>
      {failed && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          That sign-in link didn&apos;t work or has expired. Request a new one.
        </p>
      )}
      <LoginForm next={next} denied={denied} />
    </div>
  );
}
