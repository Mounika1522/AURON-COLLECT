import React, { useEffect, useRef, useState } from "react";
import { Bell, Check, LogOut, Menu, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

const tabs = [
  ["overview", "Overview"],
  ["subscriptions", "Subscription"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["notifications", "Notifications"],
  ["profile", "Profile"]
];

function DropdownPresence({ open, children }) {
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
      const exitDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
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
      data-open={entered && open ? "true" : "false"}
      className="dropdown-motion absolute right-0 top-12 z-50 w-80 max-w-[90vw] overflow-hidden rounded-xl border shadow-2xl"
    >
      {children}
    </div>
  );
}

const formatNotificationDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
};

export default function CustomerPortalHeader({
  user,
  unreadCount,
  darkMode,
  setDarkMode,
  bgCard,
  bgSurface,
  customerPortalTab,
  setCustomerPortalTab,
  notifications = [],
  onMarkRead,
  onLogout
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const notificationRoot = useRef(null);
  const notificationTrigger = useRef(null);
  const recentNotifications = notifications.slice(0, 5);

  useEffect(() => {
    if (!showNotifications) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!notificationRoot.current?.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setShowNotifications(false);
        notificationTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showNotifications]);

  return (
    <header className={`sticky top-0 z-30 border-b px-4 sm:px-6 ${bgCard}`}>
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/auron-logo.png"
            alt="Auron Collect"
            className="h-9 w-9 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <span className="block truncate text-xs font-bold tracking-wide">
              AURON COLLECT
            </span>
            <span className={`text-[10px] font-semibold ${darkMode ? "text-blue-400" : "text-blue-700"}`}>
              CUSTOMER PORTAL
            </span>
          </div>
        </div>

        <nav className="hidden w-full flex-col gap-1 border-t py-2 sm:order-none sm:flex sm:w-auto sm:flex-row sm:border-0 sm:py-0">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              aria-current={customerPortalTab === id ? "page" : undefined}
              onClick={() => {
                setCustomerPortalTab(id);
                setShowMobileMenu(false);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors duration-200 ease-out ${
                customerPortalTab === id
                  ? "bg-[#E50914] text-white"
                  : `${bgSurface} border`
              }`}
            >
              {label}
              {id === "notifications" && unreadCount > 0 && (
                <span data-active="true" className="unread-indicator ml-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] text-[#E50914]">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={`grid min-h-11 min-w-11 place-items-center rounded-lg border sm:hidden ${bgSurface}`}
            aria-label={showMobileMenu ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={showMobileMenu}
            onClick={() => setShowMobileMenu((open) => !open)}
          >
            {showMobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <span className="hidden max-w-32 truncate text-xs sm:block">
            {user?.fullName}
          </span>
          <div className="relative" ref={notificationRoot}>
            <button
              ref={notificationTrigger}
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
              aria-expanded={showNotifications}
              aria-controls="customer-notifications-dropdown"
              onClick={() => setShowNotifications((open) => !open)}
              className={`relative rounded-lg border p-2 ${bgSurface}`}
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span data-active="true" className="unread-indicator absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#E50914]" />
              )}
            </button>
            <DropdownPresence open={showNotifications}>
              <div id="customer-notifications-dropdown" className={bgCard}>
                <div className="flex items-center justify-between border-b p-3">
                  <div>
                    <h2 className="text-xs font-bold">Notifications</h2>
                    <p className="mt-1 text-[10px] opacity-70">{unreadCount} unread</p>
                  </div>
                  <button
                    type="button"
                    className="notification-action rounded-md px-2 py-1 text-[10px] font-semibold text-[#E50914]"
                    onClick={() => {
                      setCustomerPortalTab("notifications");
                      setShowNotifications(false);
                      notificationTrigger.current?.focus();
                    }}
                  >
                    View all
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {recentNotifications.map((notification) => (
                    <article
                      key={notification.id}
                      data-read={Boolean(notification.readAt)}
                      className={`notification-item border-b p-3 ${
                        notification.readAt ? "" : "bg-[#E50914]/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold">{notification.title}</h3>
                          <p className="mt-1 text-[11px] opacity-75">{notification.message}</p>
                          <p className="mt-1 text-[10px] opacity-60">
                            {formatNotificationDate(notification.createdAt)}
                          </p>
                          {(notification.invoice || notification.receipt) && (
                            <button
                              type="button"
                              className="notification-action mt-2 rounded-sm text-[10px] font-semibold text-[#E50914]"
                              onClick={() => {
                                setCustomerPortalTab(notification.invoice ? "invoices" : "payments");
                                setShowNotifications(false);
                                notificationTrigger.current?.focus();
                              }}
                            >
                              View {notification.invoice
                                ? `invoice ${notification.invoice.invoiceNumber}`
                                : `receipt ${notification.receipt.receiptNumber}`}
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Mark notification as read"
                          aria-hidden={Boolean(notification.readAt)}
                          tabIndex={notification.readAt ? -1 : 0}
                          disabled={Boolean(notification.readAt)}
                          className="notification-action dropdown-item shrink-0 rounded-lg border p-1.5"
                          onClick={() => onMarkRead?.(notification)}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </article>
                  ))}
                  {recentNotifications.length === 0 && (
                    <p className="p-4 text-center text-xs opacity-70">You have no notifications.</p>
                  )}
                </div>
              </div>
            </DropdownPresence>
          </div>
          <ThemeToggle
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            bgSurface={bgSurface}
          />
          <button
            aria-label="Sign out"
            onClick={onLogout}
            className={`rounded-lg border p-2 ${bgSurface}`}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {showMobileMenu && (
          <nav aria-label="Customer navigation" className={`order-3 flex w-full flex-col gap-1 border-t py-2 sm:hidden ${darkMode ? "border-[#333]" : "border-slate-200"}`}>
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={customerPortalTab === id ? "page" : undefined}
                onClick={() => {
                  setCustomerPortalTab(id);
                  setShowMobileMenu(false);
                }}
                className={`min-h-11 rounded-lg px-3 text-left text-xs font-semibold ${
                  customerPortalTab === id ? "bg-[#E50914] text-white" : bgSurface
                }`}
              >
                {label}
                {id === "notifications" && unreadCount > 0 ? ` (${unreadCount})` : ""}
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
