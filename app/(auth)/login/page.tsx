import { signIn } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { LockKeyhole, Stethoscope } from "lucide-react";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; redirect?: string }> }) {
  const params = await searchParams;

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <span>
            <Stethoscope size={26} />
          </span>
          <div>
            <strong>{APP_NAME}</strong>
            <small>Clinic finance workspace</small>
          </div>
        </div>

        <form action={signIn} className="form-card login-form">
          <div className="module-header compact">
            <span>Secure access</span>
            <h1>Sign in</h1>
            <p>Use your Klinik Afifi finance account to continue.</p>
          </div>
          {params.error ? <p className="form-error">{params.error}</p> : null}
          <label>
            Email
            <input name="email" placeholder="name@klinikafifi.com" type="email" required />
          </label>
          <label>
            Password
            <input name="password" placeholder="Password" type="password" required />
          </label>
          <input name="redirect" type="hidden" value={params.redirect ?? "/dashboard"} />
          <button className="primary-button" type="submit">
            <LockKeyhole size={17} />
            <span>Sign in</span>
          </button>
        </form>
      </section>
    </main>
  );
}
