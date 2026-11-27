import React, { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Bell,
  UserCircle,
  ChevronDown,
  Settings,
  LockKeyhole,
  LogOut,
  X,
} from 'lucide-react';

import ThemeToggle from './ThemeToggle';
import { apiRequest } from '../services/api';

function DropdownPresence({ open, className, children }) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let frameId;
    let timeoutId;
    if (open) {
      if (!mounted) frameId = window.requestAnimationFrame(() => setMounted(true));
      else frameId = window.requestAnimationFrame(() => setEntered(true));
    } else if (mounted) {
      frameId = window.requestAnimationFrame(() => setEntered(false));
      const exitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
      timeoutId = window.setTimeout(() => setMounted(false), exitDuration);
    }
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      data-open={entered && open ? 'true' : 'false'}
      className={`dropdown-motion ${className}`}
    >
      {children}
    </div>
  );
}

export default function AdminHeader({
  orgSettings,
  currentRole,
  currentUser,
  authToken,
  onLogout,
  onPasswordChanged,
  onOpenSettings,
  onOpenCustomerPortal,
  darkMode,
  setDarkMode,
  bgCard,
  bgSurface,
  textMuted,
    primaryColor,
  setMobileMenuOpen,
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [markingNotification, setMarkingNotification] = useState('');
  const notificationsRoot = useRef(null);
  const profileRoot = useRef(null);
  const notificationsTrigger = useRef(null);
  const profileTrigger = useRef(null);

  useEffect(() => {
    if (!authToken) return undefined;

    let active = true;
    const loadNotifications = async () => {
      if (active) setNotificationsLoading(true);
      try {
        const response = await apiRequest('/api/admin-notifications', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!active) return;
        setNotifications(response.notifications || []);
        setUnreadCount(Number(response.unreadCount || 0));
        setNotificationError('');
      } catch (error) {
        if (!active) return;
        console.error('Admin notifications API Error:', error);
        setNotificationError(error.message || 'Unable to load notifications.');
      } finally {
        if (active) setNotificationsLoading(false);
      }
    };

    loadNotifications();
    const intervalId = window.setInterval(loadNotifications, 60_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [authToken]);

  const handleMarkNotificationRead = async (notification) => {
    if (!notification.unread || markingNotification) return;

    setMarkingNotification(notification.id);
    try {
      await apiRequest(`/api/admin-notifications/${encodeURIComponent(notification.id)}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setNotifications((previous) => previous.map((item) =>
        item.id === notification.id ? { ...item, unread: false, readAt: new Date().toISOString() } : item
      ));
      setUnreadCount((previous) => Math.max(0, previous - 1));
      setNotificationError('');
    } catch (error) {
      console.error('Mark notification read API Error:', error);
      setNotificationError(error.message || 'Unable to mark notification as read.');
    } finally {
      setMarkingNotification('');
    }
  };

  useEffect(() => {
    if (!showNotifications && !showProfile) return undefined;

    const closeOnOutsideClick = (event) => {
      if (
        !notificationsRoot.current?.contains(event.target) &&
        !profileRoot.current?.contains(event.target)
      ) {
        setShowNotifications(false);
        setShowProfile(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setShowNotifications(false);
        setShowProfile(false);
        if (showProfile) profileTrigger.current?.focus();
        else notificationsTrigger.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showNotifications, showProfile]);

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    if (passwordChanging) return;

    setPasswordChanging(true);
    setPasswordChangeError("");
    try {
      const response = await apiRequest("/api/auth/change-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(passwordForm),
      });
      if (!response.token) {
        throw new Error("Password changed, but your session could not be refreshed. Sign in again.");
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setShowPasswordChange(false);
      onPasswordChanged?.(response.token);
    } catch (error) {
      setPasswordChangeError(error.message || "Unable to change your password.");
    } finally {
      setPasswordChanging(false);
    }
  };

  return (
    <header
      className={`app-admin-header sticky top-0 z-30 h-16 border-b px-4 flex items-center justify-between ${bgCard}`}
    >
      {/* LEFT SIDE */}
      <div className="flex items-center space-x-3 min-w-0">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={`lg:hidden p-2 rounded-lg border ${bgSurface}`}
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center space-x-2">
          <img
  src={orgSettings.logoUrl || "/auron-logo.png"}
  alt={orgSettings.companyName || "Auron Collect"}
  className="w-9 h-9 object-contain"
/>
          <span className="font-extrabold text-sm tracking-wider whitespace-nowrap">
  {orgSettings.companyName || 'AURON COLLECT'}
</span>
        </div>

        <span
          className={`hidden xl:inline-block text-[11px] px-2.5 py-1 rounded-md border ${bgSurface} ${textMuted}`}
        >
          {orgSettings.companyName}
        </span>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex items-center space-x-2">

        {/* THEME */}
        <ThemeToggle
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          bgSurface={bgSurface}
        />

        {/* NOTIFICATIONS */}
        <div className="relative" ref={notificationsRoot}>
          <button
            ref={notificationsTrigger}
            aria-expanded={showNotifications}
            aria-controls="admin-notifications-dropdown"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowProfile(false);
            }}
            className={`relative p-2.5 rounded-lg border ${bgSurface}`}
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span
  data-active={unreadCount > 0 ? 'true' : 'false'}
  style={{ backgroundColor: primaryColor }}
  className="unread-indicator absolute -top-1 -right-1 w-4 h-4 rounded-full text-white text-[9px] flex items-center justify-center font-bold"
>
                  {unreadCount > 99 ? '99+' : unreadCount}
</span>
            )}
          </button>

          <DropdownPresence
            open={showNotifications}
            className={`absolute right-0 top-12 w-80 max-w-[90vw] rounded-xl border shadow-2xl z-50 overflow-hidden ${bgCard}`}
          >
              <div id="admin-notifications-dropdown" className="max-h-[min(70vh,28rem)] overflow-y-auto">
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold">Notifications</h3>
                  <p className={`text-[10px] ${textMuted}`}>
                    {unreadCount} unread notifications
                  </p>
                </div>
              </div>

              {notificationError && (
                <p className="p-3 text-xs text-rose-400" role="alert">{notificationError}</p>
              )}
              {notificationsLoading && notifications.length === 0 ? (
                <p className={`p-4 text-xs ${textMuted}`}>Loading notifications…</p>
              ) : notifications.length === 0 ? (
                <p className={`p-4 text-xs ${textMuted}`}>
                  {notificationError ? 'Notifications are unavailable.' : 'No notifications.'}
                </p>
              ) : notifications.map((item) => {
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => handleMarkNotificationRead(item)}
                    disabled={markingNotification === item.id}
                    className={`notification-item w-full text-left p-3 border-b flex gap-3 hover:bg-black/5 ${item.unread ? 'bg-[#E50914]/5' : ''}`}
                    aria-label={`${item.unread ? 'Mark as read: ' : ''}${item.title}`}
                  >
                    <div
  style={{
    backgroundColor: `${primaryColor}1A`,
    color: primaryColor
  }}
  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold">{item.title}</p>
                      <p className={`text-[11px] mt-1 ${textMuted}`}>
                        {item.message}
                      </p>
                      <p className={`text-[10px] mt-1 ${textMuted}`}>
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                      </p>
                    </div>
                    {item.unread && (
                      <span
  style={{ backgroundColor: primaryColor }}
  className="w-2 h-2 rounded-full mt-1 shrink-0"
/>
                    )}
                  </button>
                );
              })}
              </div>
          </DropdownPresence>
        </div>

        {/* CUSTOMER PORTAL */}
        <button
  onClick={onOpenCustomerPortal}
  style={{ backgroundColor: primaryColor }}
  className="px-3 py-2 rounded-lg text-white text-[11px] font-semibold transition whitespace-nowrap"
>
  Customer Portal
</button>

        {/* PROFILE */}
        <div className="relative" ref={profileRoot}>
          <button
            ref={profileTrigger}
            aria-expanded={showProfile}
            aria-controls="admin-profile-dropdown"
            onClick={() => {
              setShowProfile(!showProfile);
              setShowNotifications(false);
            }}
            className={`flex items-center gap-2 p-1.5 rounded-lg border ${bgSurface}`}
          >
           <div
  style={{
    backgroundColor: `${primaryColor}26`,
    color: primaryColor
  }}
  className="w-8 h-8 rounded-full flex items-center justify-center"
>
              <UserCircle className="w-5 h-5" />
            </div>

            <div className="hidden sm:block text-left">
              <p className="text-[11px] font-bold">{currentUser?.name || 'Account'}</p>
              <p className={`text-[9px] ${textMuted}`}>{currentRole}</p>
            </div>

            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          <DropdownPresence
            open={showProfile}
            className={`absolute right-0 top-12 w-64 rounded-xl border shadow-2xl z-50 overflow-hidden ${bgCard}`}
          >
              <div id="admin-profile-dropdown">
              <div className="p-4 border-b">
                <p className="text-sm font-bold">{currentUser?.name || 'Account'}</p>
                <p className={`text-[10px] mt-1 ${textMuted}`}>
                  {currentUser?.email || ''}
                </p>
                <span
  style={{
    backgroundColor: `${primaryColor}1A`,
    color: primaryColor
  }}
  className="inline-block mt-2 px-2 py-1 rounded-md text-[10px] font-bold"
>
                  {currentRole}
                </span>
              </div>

              <div className="p-2 space-y-1">
                <button
                  onClick={() => {
                    setShowProfile(false);
                    setShowProfileDetails(true);
                  }}
                  className={`dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs ${bgSurface}`}
                >
                  <UserCircle className="w-4 h-4" />
                  My Profile
                </button>

                <button
                  onClick={() => {
                    setShowProfile(false);
                    onOpenSettings?.();
                  }}
                  className={`dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs ${bgSurface}`}
                >
                  <Settings className="w-4 h-4" />
                  Account Settings
                </button>

                <button
                  onClick={() => {
                    setShowProfile(false);
                    setPasswordForm({
                      currentPassword: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                    setPasswordChangeError("");
                    setShowPasswordChange(true);
                  }}
                  className={`dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs ${bgSurface}`}
                >
                  <LockKeyhole className="w-4 h-4" />
                  Change Password
                </button>

                <button
                  onClick={onLogout}
                  className="dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs text-[#E50914] hover:bg-[#E50914]/10"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
              </div>
          </DropdownPresence>
        </div>
      </div>
      {showProfileDetails && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowProfileDetails(false);
          }}
        >
          <section
            aria-labelledby="staff-profile-title"
            aria-modal="true"
            className={`app-profile-dialog w-full max-w-md rounded-2xl border p-6 shadow-2xl ${bgCard}`}
            role="dialog"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#E50914]">Staff account</p>
                <h2 id="staff-profile-title" className="mt-1 text-lg font-bold">Profile details</h2>
              </div>
              <button
                type="button"
                aria-label="Close profile details"
                onClick={() => setShowProfileDetails(false)}
                className={`rounded-lg border p-2 ${bgSurface}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-3">
              {[
                ["Name", currentUser?.name || "—"],
                ["Work email", currentUser?.email || "—"],
                ["Role", currentRole || "—"],
                ["Organisation", orgSettings.companyName || "—"],
              ].map(([label, value]) => (
                <div key={label} className={`flex flex-wrap justify-between gap-2 rounded-xl border p-3 ${bgSurface}`}>
                  <dt className={`text-xs ${textMuted}`}>{label}</dt>
                  <dd className="max-w-[65%] break-all text-right text-xs font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
      {showPasswordChange && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !passwordChanging) {
              setShowPasswordChange(false);
            }
          }}
        >
          <section
            aria-labelledby="staff-password-title"
            aria-modal="true"
            className={`app-profile-dialog w-full max-w-md rounded-2xl border p-6 shadow-2xl ${bgCard}`}
            role="dialog"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#E50914]">Staff account</p>
                <h2 id="staff-password-title" className="mt-1 text-lg font-bold">Change password</h2>
              </div>
              <button
                type="button"
                aria-label="Close change password"
                disabled={passwordChanging}
                onClick={() => setShowPasswordChange(false)}
                className={`rounded-lg border p-2 ${bgSurface}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handlePasswordChange}>
              <label className="block text-xs font-medium">
                Current password
                <input
                  autoComplete="current-password"
                  className={`mt-1.5 w-full rounded-xl border p-3 text-sm ${bgSurface}`}
                  name="currentPassword"
                  onChange={(event) => setPasswordForm((form) => ({ ...form, currentPassword: event.target.value }))}
                  required
                  type="password"
                  value={passwordForm.currentPassword}
                />
              </label>
              <label className="block text-xs font-medium">
                New password
                <input
                  autoComplete="new-password"
                  className={`mt-1.5 w-full rounded-xl border p-3 text-sm ${bgSurface}`}
                  maxLength={72}
                  minLength={12}
                  name="newPassword"
                  onChange={(event) => setPasswordForm((form) => ({ ...form, newPassword: event.target.value }))}
                  required
                  type="password"
                  value={passwordForm.newPassword}
                />
              </label>
              <label className="block text-xs font-medium">
                Confirm new password
                <input
                  autoComplete="new-password"
                  className={`mt-1.5 w-full rounded-xl border p-3 text-sm ${bgSurface}`}
                  maxLength={72}
                  minLength={12}
                  name="confirmPassword"
                  onChange={(event) => setPasswordForm((form) => ({ ...form, confirmPassword: event.target.value }))}
                  required
                  type="password"
                  value={passwordForm.confirmPassword}
                />
              </label>
              <p className={`text-[11px] leading-relaxed ${textMuted}`}>
                Use at least 12 characters and 3 of these: lowercase, uppercase, number, and symbol. New passwords are limited to 72 UTF-8 bytes.
              </p>
              {passwordChangeError && (
                <p className="text-xs text-rose-500" role="alert">{passwordChangeError}</p>
              )}
              <p className={`text-[11px] leading-relaxed ${textMuted}`} role="status">
                Other active sessions will be signed out after the change.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={passwordChanging}
                  onClick={() => setShowPasswordChange(false)}
                  className={`rounded-lg border px-4 py-2.5 text-xs font-semibold ${bgSurface}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordChanging}
                  className="rounded-lg bg-[#E50914] px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {passwordChanging ? "Changing..." : "Change password"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </header>
  );
}