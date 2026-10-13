import { useState } from "react";
import { supabase, supabaseAuthProblem } from "../supabase.js";

export default function AccountBar({ session, onSession }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (supabaseAuthProblem) {
    return <p className="account-message">{supabaseAuthProblem}</p>;
  }

  if (session?.user) {
    return (
      <div className="account">
        <span className="account-email">{session.user.email}</span>
        <button
          type="button"
          onClick={async () => {
            setMessage("");
            await supabase.auth.signOut();
            onSession(null);
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  async function signIn(event) {
    event.preventDefault();
    await runAuth(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));
  }

  async function signUp() {
    await runAuth(async () => {
      const result = await supabase.auth.signUp({ email: email.trim(), password });
      if (!result.error && !result.data.session) {
        setMessage("Check your email to confirm the account.");
      }
      return result;
    });
  }

  async function runAuth(action) {
    setMessage("");
    if (!email.trim() || password.length < 6) {
      setMessage("Use an email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await action();
      if (error) {
        setMessage(error.message);
        return;
      }
      if (data?.session) {
        onSession(data.session);
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account" onSubmit={signIn}>
      <label className="visually-hidden" htmlFor="account-email">
        Email
      </label>
      <input
        id="account-email"
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label className="visually-hidden" htmlFor="account-password">
        Password
      </label>
      <input
        id="account-password"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      <button type="button" onClick={signUp} disabled={busy}>
        Create account
      </button>
      {message && <p className="account-message">{message}</p>}
    </form>
  );
}
