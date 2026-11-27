import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiRequest } from "../services/api";
import { getStaffPasswordResetValidationError } from "../services/staff-password-reset";

const genericRequestMessage =
  "If an account exists for that email, password reset instructions will be sent shortly.";

export default function StaffPasswordRecovery({
  resetToken,
  initialEmail = "",
  onClose,
  onResetSuccess,
  bgCard,
  bgSurface,
  textMuted
}) {
  const [email, setEmail] = useState(initialEmail);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestReset = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);
    try {
      await apiRequest("/api/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() })
      });
      setNotice(genericRequestMessage);
    } catch (requestError) {
      setError(
        requestError.message ||
        "Unable to process the password reset request. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const validationError = getStaffPasswordResetValidationError(
      newPassword,
      confirmPassword
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/api/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: newPassword,
          confirmPassword
        })
      });
      onResetSuccess();
    } catch (requestError) {
      setError(
        requestError.message ||
        "The reset link could not be used. Request a new password reset link."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const visibilityButton = (visible, onToggle, label) => (
    <button
      type="button"
      aria-label={visible ? `Hide ${label}` : `Show ${label}`}
      onClick={onToggle}
      className={`absolute right-3 top-2.5 ${textMuted}`}
    >
      {visible
        ? <EyeOff className="h-4 w-4" />
        : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-password-recovery-title"
      className={`max-w-sm w-full rounded-2xl border p-6 ${bgCard}`}
    >
      <h2 id="staff-password-recovery-title" className="mb-2 text-base font-bold">
        {resetToken ? "Reset staff password" : "Forgot password?"}
      </h2>
      <p className={`mb-4 text-xs ${textMuted}`}>
        {resetToken
          ? "Choose a new password for your AURON COLLECT staff account."
          : "Enter the email address registered to your staff account."}
      </p>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600">
          {notice}
        </p>
      )}

      {resetToken ? (
        <form onSubmit={submitReset} className="space-y-3">
          <label className="block text-xs font-semibold">
            New Password
            <span className="relative mt-1 block">
              <input
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={`w-full rounded-xl border p-2.5 pr-10 text-xs ${bgSurface}`}
                aria-label="New Password"
              />
              {visibilityButton(
                showNewPassword,
                () => setShowNewPassword((value) => !value),
                "new password"
              )}
            </span>
          </label>
          <label className="block text-xs font-semibold">
            Confirm Password
            <span className="relative mt-1 block">
              <input
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={`w-full rounded-xl border p-2.5 pr-10 text-xs ${bgSurface}`}
                aria-label="Confirm Password"
              />
              {visibilityButton(
                showConfirmPassword,
                () => setShowConfirmPassword((value) => !value),
                "confirm password"
              )}
            </span>
          </label>
          <p className={`text-[10px] ${textMuted}`}>
            At least 12 characters, three character types, and no more than 72 UTF-8 bytes.
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? "Updating password…" : "Reset Password"}
          </button>
        </form>
      ) : (
        <form onSubmit={requestReset} className="space-y-3">
          <label className="block text-xs font-semibold">
            Registered Staff Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`mt-1 w-full rounded-xl border p-2.5 text-xs ${bgSurface}`}
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? "Sending…" : "Send Reset Link"}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={onClose}
        className={`mt-3 w-full rounded-xl border px-4 py-2.5 text-xs font-semibold ${bgSurface}`}
      >
        Return to Staff Login
      </button>
    </section>
  );
}
