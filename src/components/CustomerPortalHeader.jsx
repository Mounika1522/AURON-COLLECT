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
    <header className={`customer-portal-header sticky top-0 z-30 border-b ${bgCard}`}>
      <div className="relative mx-auto flex min-h-[4.5rem] max-w-7xl items-center gap-2 px-3 sm:min-h-[4.75rem] sm:gap-3 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-2.5 sm:gap-3">
          <img
            src="/auron-logo.png"
            alt="Auron Collect"
            className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
          />
          <div className="min-w-0 leading-tight">
            <span className="block truncate text-[11px] font-extrabold tracking-[0.08em] sm:text-xs">
              AURON COLLECT
            </span>
            <span className={`mt-1 block text-[9px] font-bold uppercase tracking-[0.12em] ${darkMode ? "text-blue-300" : "text-blue-700"}`}>
              CUSTOMER PORTAL
            </span>
          </div>
        </div>

        <nav aria-label="Customer navigation" className="hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto px-1 xl:flex">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              aria-current={customerPortalTab === id ? "page" : undefined}
              onClick={() => {
                setCustomerPortalTab(id);
                setShowMobileMenu(false);
              }}
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg border px-3 text-[11px] font-semibold transition-colors duration-200 ease-out ${
                customerPortalTab === id
                  ? "border-[#E50914]/20 bg-[#E50914]/10 text-[#E50914]"
                  : `${bgSurface} hover:border-[#E50914]/30 hover:text-[#E50914]`
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

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-2">
          <button
            type="button"
            className={`grid h-9 w-9 place-items-center rounded-xl border sm:h-10 sm:w-10 xl:hidden ${bgSurface}`}
            aria-label={showMobileMenu ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={showMobileMenu}
            onClick={() => setShowMobileMenu((open) => !open)}
          >
            {showMobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="hidden min-w-0 items-center gap-2 border-l pl-3 lg:flex">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E50914]/10 text-xs font-extrabold text-[#E50914]">
              {(user?.fullName || "C").trim().charAt(0).toUpperCase()}
            </span>
            <span className="max-w-36 truncate text-xs font-semibold">
              {user?.fullName}
            </span>
          </div>
          <div className="relative shrink-0" ref={notificationRoot}>
            <button
              ref={notificationTrigger}
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
              aria-expanded={showNotifications}
              aria-controls="customer-notifications-dropdown"
              onClick={() => setShowNotifications((open) => !open)}
              className={`relative grid h-9 w-9 place-items-center rounded-xl border sm:h-10 sm:w-10 ${bgSurface}`}
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
          <div className="grid h-9 w-9 shrink-0 place-items-center sm:h-10 sm:w-10">
            <ThemeToggle
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              bgSurface={bgSurface}
            />
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={onLogout}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border sm:h-10 sm:w-10 ${bgSurface}`}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {showMobileMenu && (
          <nav aria-label="Customer navigation" className={`absolute inset-x-0 top-full z-40 grid grid-cols-2 gap-2 border-t p-3 shadow-xl sm:grid-cols-3 xl:hidden ${bgCard}`}>
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={customerPortalTab === id ? "page" : undefined}
                onClick={() => {
                  setCustomerPortalTab(id);
                  setShowMobileMenu(false);
                }}
                className={`min-h-11 rounded-xl border px-3 text-left text-xs font-semibold ${
                  customerPortalTab === id
                    ? "border-[#E50914]/20 bg-[#E50914]/10 text-[#E50914]"
                    : `${bgSurface} hover:border-[#E50914]/30`
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
