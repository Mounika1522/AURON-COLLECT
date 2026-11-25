import React, { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Bell,
  UserCircle,
  ChevronDown,
  Settings,
  LockKeyhole,
  LogOut,
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

  return (
    <header
      className={`sticky top-0 z-30 h-16 border-b px-4 flex items-center justify-between ${bgCard}`}
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
                  onClick={() => window.alert('My Profile will be connected in the next development phase.')}
                  className={`dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs ${bgSurface}`}
                >
                  <UserCircle className="w-4 h-4" />
                  My Profile
                </button>

                <button
                  onClick={() => window.alert('Account Settings will be connected in the next development phase.')}
                  className={`dropdown-item w-full flex items-center gap-3 p-2.5 rounded-lg text-xs ${bgSurface}`}
                >
                  <Settings className="w-4 h-4" />
                  Account Settings
                </button>

                <button
                  onClick={() => window.alert('Change Password will be connected with backend authentication.')}
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
    </header>
  );
}