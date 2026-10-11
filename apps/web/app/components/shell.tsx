"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./api";
export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="restaurant-header">
      <Link href="/lane/lane-1" className="wordmark">
        Harbor Burger
      </Link>
      <div className="header-actions">{children}</div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="restaurant-footer">
      <span className="saygo-mark">SayGo</span>
      <span>Independent Alexa+ concept simulator</span>
      <span className="payment-note">Payment due at window.</span>
    </footer>
  );
}
export function Login({ done }: { done: () => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await api("/login", {
            username: d.get("username"),
            password: d.get("password"),
          });
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Operator sign in</h2>
      <p>
        Staff credentials are required to start a fictional customer session.
      </p>
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          defaultValue="admin"
          required
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button disabled={busy} className="primary">
        Sign in
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <small>Local demo: admin / harbor-demo-only</small>
    </form>
  );
}
export function StaffShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [auth, setAuth] = useState<"loading" | "yes" | "no">("loading");
  useEffect(() => {
    void api("/me")
      .then(() => setAuth("yes"))
      .catch(() => setAuth("no"));
  }, []);
  return (
    <>
      <Header>
        <span className="small-brand">SayGo operations</span>
      </Header>
      <nav className="staff-nav" aria-label="Operations">
        <Link href="/lane/lane-1">Order board</Link>
        <Link href="/crew">Crew</Link>
        <Link href="/kitchen">Kitchen</Link>
        <Link href="/admin">Menu & staff</Link>
        <Link href="/demo">Demo controls</Link>
        {auth === "yes" && (
          <button
            onClick={() => {
              void api("/logout", {}).then(() => setAuth("no"));
            }}
          >
            Sign out
          </button>
        )}
      </nav>
      <main className="operations">
        <div className="operations-heading">
          <h1>{title}</h1>
          <span className="sandbox">Fictional restaurant · POS sandbox</span>
        </div>
        {auth === "loading" ? (
          <p>Checking staff access…</p>
        ) : auth === "no" ? (
          <Login done={() => setAuth("yes")} />
        ) : (
          children
        )}
      </main>
      <Footer />
    </>
  );
}
