import React, { useEffect, useState } from "react";
import { apiRequest } from "../services/api";

const initialForm = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: ""
};

export default function CustomerAuth({
  onLogin,
  onBackToStaff,
  bgSurface,
  textMuted,
  resetToken
}) {
  const [mode, setMode] = useState(resetToken ? "reset" : "login");
  const [form, setForm] = useState(initialForm);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setResendCooldown((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const runRequest = async (request, onSuccess) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await request();
      onSuccess(response);
    } catch (requestError) {
      setError(requestError.message || "The request could not be completed.");
      if (requestError.code === "EMAIL_VERIFICATION_REQUIRED") {
        setMode("resend");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitRegistration = (event) => {
    event.preventDefault();
    runRequest(
      () =>
        apiRequest("/api/customer-auth/register", {
          method: "POST",
          body: JSON.stringify(form)
        }),
      (response) => {
        setMessage(response.message);
        setEmail(form.email);
        setOtp("");
        setForm(initialForm);
        setResendCooldown(60);
        setMode("verify");
      }
    );
  };

  const submitLogin = (event) => {
    event.preventDefault();
    runRequest(
      () =>
        apiRequest("/api/customer-auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password: form.password })
        }),
      (response) => onLogin(response)
    );
  };

  const requestVerificationOtp = () =>
    runRequest(
      () =>
        apiRequest("/api/customer-auth/resend-verification", {
          method: "POST",
          body: JSON.stringify({ email })
        }),
      (response) => {
        setMessage(response.message);
        setOtp("");
        setResendCooldown(60);
        setMode("verify");
      }
    );

  const submitVerification = (event) => {
    event.preventDefault();
    runRequest(
      () =>
        apiRequest("/api/customer-auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ email, otp })
        }),
      (response) => {
        setMessage(response.message);
        setOtp("");
        setMode("login");
      }
    );
  };

  const submitRecovery = (event) => {
    event.preventDefault();
    if (mode === "resend") {
      requestVerificationOtp();
      return;
    }
    runRequest(
      () =>
        apiRequest("/api/customer-auth/password/forgot", {
          method: "POST",
          body: JSON.stringify({ email })
        }),
      (response) => setMessage(response.message)
    );
  };

  const submitPasswordReset = (event) => {
    event.preventDefault();
    runRequest(
      () =>
        apiRequest("/api/customer-auth/password/reset", {
          method: "POST",
          body: JSON.stringify({
            token: resetToken,
            password: newPassword,
            confirmPassword
          })
        }),
      (response) => {
        setMessage(response.message);
        setPasswordResetFields();
        setMode("login");
        const url = new URL(window.location.href);
        url.searchParams.delete("customerReset");
        window.history.replaceState({}, "", url);
      }
    );
  };

  const setPasswordResetFields = () => {
    setNewPassword("");
    setConfirmPassword("");
  };

  const fieldClass = `w-full rounded-xl border p-2.5 text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`;
  const buttonClass = "w-full rounded-xl bg-[#E50914] py-3 text-xs font-bold text-white transition hover:bg-[#B00020] disabled:opacity-60";

  return (
    <div>
      <div className="mb-5">
        <h2 key={mode} className="text-lg font-bold motion-fade-enter">
          {mode === "register"
            ? "Create your customer account"
            : mode === "verify"
              ? "Verify your email"
            : mode === "forgot"
              ? "Reset your password"
              : mode === "resend"
                ? "Request verification code"
                : mode === "reset"
                  ? "Choose a new password"
                  : "Customer sign in"}
        </h2>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Customer accounts are matched to an existing active CRM record.
        </p>
      </div>

      {message && (
        <div key={`message-${message}`} role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 motion-fade-enter">
          {message}
        </div>
      )}
      {error && (
        <div key={`error-${error}`} role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 motion-fade-enter">
          {error}
        </div>
      )}

      <div key={mode} className="motion-enter">
      {mode === "register" && (
        <form className="space-y-3" onSubmit={submitRegistration}>
          <label className="block text-xs font-semibold">
            Full name
            <input
              autoComplete="name"
              className={`${fieldClass} mt-1.5`}
              maxLength={120}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              required
              value={form.fullName}
            />
          </label>
          <label className="block text-xs font-semibold">
            Email address
            <input
              autoComplete="email"
              className={`${fieldClass} mt-1.5`}
              onChange={(event) => {
                setForm({ ...form, email: event.target.value });
                setEmail(event.target.value);
              }}
              required
              type="email"
              value={form.email}
            />
          </label>
          <label className="block text-xs font-semibold">
            Phone number
            <input
              autoComplete="tel"
              className={`${fieldClass} mt-1.5`}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              required
              type="tel"
              value={form.phone}
            />
          </label>
          <label className="block text-xs font-semibold">
            Password
            <input
              autoComplete="new-password"
              className={`${fieldClass} mt-1.5`}
              minLength={12}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
              type="password"
              value={form.password}
            />
          </label>
          <label className="block text-xs font-semibold">
            Confirm password
            <input
              autoComplete="new-password"
              className={`${fieldClass} mt-1.5`}
              minLength={12}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
              type="password"
              value={form.confirmPassword}
            />
          </label>
          <p className={`text-[11px] leading-relaxed ${textMuted}`}>
            Your email and phone must match the details on your CRM customer record. Registration does not create a CRM customer.
          </p>
          <button className={buttonClass} disabled={busy} type="submit">
            {busy ? "Creating account..." : "Create customer account"}
          </button>
          <button className={`w-full py-2 text-xs ${textMuted}`} onClick={() => setMode("login")} type="button">
            Already registered? Sign in
          </button>
        </form>
      )}

      {mode === "login" && (
        <form className="space-y-4" onSubmit={submitLogin}>
          <label className="block text-xs font-semibold">
            Email address
            <input
              autoComplete="email"
              className={`${fieldClass} mt-1.5`}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block text-xs font-semibold">
            Password
            <input
              autoComplete="current-password"
              className={`${fieldClass} mt-1.5`}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
              type="password"
              value={form.password}
            />
          </label>
          <button className={buttonClass} disabled={busy} type="submit">
            {busy ? "Signing in..." : "Sign in to customer portal"}
          </button>
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <button className="text-[#E50914] hover:underline" onClick={() => setMode("forgot")} type="button">
              Forgot password?
            </button>
            <button className="text-[#E50914] hover:underline" onClick={() => setMode("resend")} type="button">
              Resend verification code
            </button>
          </div>
          <button className={`w-full py-2 text-xs ${textMuted}`} onClick={() => setMode("register")} type="button">
            New to the portal? Create an account
          </button>
        </form>
      )}

      {mode === "verify" && (
        <form className="space-y-4" onSubmit={submitVerification}>
          <p className={`text-xs ${textMuted}`}>
            Enter the six-digit code sent to {email}.
          </p>
          <label className="block text-xs font-semibold">
            Email verification code
            <input
              autoComplete="one-time-code"
              className={`${fieldClass} mt-1.5 text-center tracking-[0.3em]`}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              pattern="[0-9]{6}"
              required
              value={otp}
            />
          </label>
          <button className={buttonClass} disabled={busy || otp.length !== 6} type="submit">
            {busy ? "Verifying..." : "Verify email"}
          </button>
          <button
            className={`w-full py-2 text-xs ${textMuted}`}
            disabled={busy || resendCooldown > 0}
            onClick={requestVerificationOtp}
            type="button"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
          </button>
          <button className={`w-full py-2 text-xs ${textMuted}`} onClick={() => setMode("login")} type="button">
            Return to customer sign in
          </button>
        </form>
      )}

      {(mode === "forgot" || mode === "resend") && (
        <form className="space-y-4" onSubmit={submitRecovery}>
          <label className="block text-xs font-semibold">
            Email address
            <input
              autoComplete="email"
              className={`${fieldClass} mt-1.5`}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <button className={buttonClass} disabled={busy} type="submit">
            {busy ? "Submitting..." : mode === "resend" ? "Request verification code" : "Request reset link"}
          </button>
          <button className={`w-full py-2 text-xs ${textMuted}`} onClick={() => setMode("login")} type="button">
            Return to customer sign in
          </button>
        </form>
      )}

      {mode === "reset" && (
        <form className="space-y-4" onSubmit={submitPasswordReset}>
          <label className="block text-xs font-semibold">
            New password
            <input
              autoComplete="new-password"
              className={`${fieldClass} mt-1.5`}
              minLength={12}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label className="block text-xs font-semibold">
            Confirm new password
            <input
              autoComplete="new-password"
              className={`${fieldClass} mt-1.5`}
              minLength={12}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          <button className={buttonClass} disabled={busy} type="submit">
            {busy ? "Updating..." : "Reset password"}
          </button>
        </form>
      )}
      </div>

      <button className={`mt-4 w-full py-2 text-xs ${textMuted}`} onClick={onBackToStaff} type="button">
        Return to staff login
      </button>
    </div>
  );
}
