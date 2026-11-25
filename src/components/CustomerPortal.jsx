import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Check, FileText, CreditCard } from "lucide-react";
import CustomerPortalHeader from "./CustomerPortalHeader";
import CustomerAuronAssistant from "./CustomerAuronAssistant";
import { apiDownload, apiRequest } from "../services/api";

const formatCurrency = (value, currency = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
};

const amountFor = (value, currency) => formatCurrency(value, currency || "INR");

const subscriptionCycles = [
  { value: "MONTHLY", label: "Monthly", price: "monthlyPrice" },
  { value: "QUARTERLY", label: "Quarterly", price: "quarterlyPrice" },
  { value: "HALF_YEARLY", label: "Half-yearly", price: "halfYearlyPrice" },
  { value: "YEARLY", label: "Yearly", price: "yearlyPrice" }
];
const formatBillingCycle = (cycle) =>
  subscriptionCycles.find(({ value }) => value === cycle)?.label || cycle;

const loadRazorpayCheckout = () => {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
    document.body.appendChild(script);
  });
};

export default function CustomerPortal({
  token,
  user,
  onTokenChange,
  onSessionExpired,
  onLogout,
  darkMode,
  setDarkMode,
  bgCanvas,
  bgCard,
  bgSurface,
  textMuted,
  borderSubtle
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [subscriptionData, setSubscriptionData] = useState({
    plans: [],
    subscriptions: [],
    payments: [],
    checkoutEnabled: false,
    checkoutUnavailableMessage: ""
  });
  const [subscriptionBilling, setSubscriptionBilling] = useState({
    invoices: [],
    receipts: []
  });
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const request = useCallback(
    (endpoint, options = {}) =>
      apiRequest(endpoint, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`
        }
      }),
    [token]
  );

  const fetchPortalData = useCallback(async () => {
      const [dashboardResponse, invoiceResponse, receiptResponse, notificationResponse, profileResponse, subscriptionResponse, subscriptionBillingResponse] =
        await Promise.all([
          request("/api/customer-portal/dashboard"),
          request("/api/customer-portal/invoices"),
          request("/api/customer-portal/receipts"),
          request("/api/customer-portal/notifications"),
          request("/api/customer-portal/profile"),
          request("/api/customer-portal/subscriptions"),
          request("/api/customer-portal/subscriptions/billing")
        ]);
      return {
        dashboard: dashboardResponse.dashboard,
        invoices: invoiceResponse.invoices || [],
        receipts: receiptResponse.receipts || [],
        notifications: notificationResponse.notifications || [],
        profile: profileResponse.profile,
        subscriptionData: subscriptionResponse,
        subscriptionBilling: subscriptionBillingResponse
      };
  }, [request]);

  const applyPortalData = useCallback((data) => {
    setDashboard(data.dashboard);
    setInvoices(data.invoices);
    setReceipts(data.receipts);
    setNotifications(data.notifications);
    setProfile(data.profile);
    setProfileName(data.profile?.fullName || "");
    setSubscriptionData({
      plans: data.subscriptionData?.plans || [],
      subscriptions: data.subscriptionData?.subscriptions || [],
      payments: data.subscriptionData?.payments || [],
      checkoutEnabled: Boolean(data.subscriptionData?.checkoutEnabled),
      checkoutUnavailableMessage: data.subscriptionData?.checkoutUnavailableMessage || ""
    });
    setSubscriptionBilling({
      invoices: data.subscriptionBilling?.invoices || [],
      receipts: data.subscriptionBilling?.receipts || []
    });
  }, []);

  const handleLoadError = useCallback((requestError) => {
      if (requestError.status === 401) {
        onSessionExpired();
      } else {
        console.error("Customer portal data request failed:", requestError);
        setError(requestError.message || "Unable to load your account data.");
      }
  }, [onSessionExpired]);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyPortalData(await fetchPortalData());
    } catch (requestError) {
      handleLoadError(requestError);
    } finally {
      setLoading(false);
    }
  }, [applyPortalData, fetchPortalData, handleLoadError]);

  useEffect(() => {
    let active = true;
    fetchPortalData()
      .then((data) => {
        if (!active) return;
        applyPortalData(data);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) return;
        handleLoadError(requestError);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyPortalData, fetchPortalData, handleLoadError]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );

  const downloadInvoice = async (invoice) => {
    setBusy(true);
    setError("");
    try {
      const blob = await apiDownload(
        `/api/customer-portal/invoices/${encodeURIComponent(invoice.id)}/pdf`,
        token
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(invoice.invoiceNumber || "invoice").replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "The invoice PDF could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const downloadSubscriptionDocument = async (type, item) => {
    const path = type === "invoice"
      ? `/api/customer-portal/subscriptions/invoices/${encodeURIComponent(item.id)}/pdf`
      : type === "receipt"
        ? `/api/customer-portal/subscriptions/receipts/${encodeURIComponent(item.id)}/pdf`
        : type === "payment"
          ? `/api/customer-portal/subscriptions/payments/${encodeURIComponent(item.id)}/pdf`
          : "/api/customer-portal/subscriptions/billing-history/pdf";
    const name = type === "invoice"
      ? item.invoiceNumber
      : type === "receipt"
        ? item.receiptNumber
        : type === "payment"
          ? `transaction-${item.id}`
          : "subscription-payment-history";
    setBusy(true);
    setError("");
    try {
      const blob = await apiDownload(path, token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(name || type).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "The billing document could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const downloadReceipt = async (receipt) => {
    setBusy(true);
    setError("");
    try {
      const blob = await apiDownload(
        `/api/customer-portal/receipts/${encodeURIComponent(receipt.id)}/pdf`,
        token
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(receipt.receiptNumber || "receipt").replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "The receipt PDF could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const refreshPortalData = async () => {
    try {
      applyPortalData(await fetchPortalData());
    } catch (requestError) {
      handleLoadError(requestError);
    }
  };

  const startSubscriptionCheckout = async (plan) => {
    if (!subscriptionData.checkoutEnabled) {
      setError(subscriptionData.checkoutUnavailableMessage || "Razorpay Test Mode checkout is not enabled.");
      return;
    }
    setBusy(true);
    setError("");
    setCheckoutStatus("");
    try {
      await loadRazorpayCheckout();
      const order = await request("/api/customer-portal/subscriptions/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": window.crypto.randomUUID() },
        body: JSON.stringify({ planId: plan.id, billingCycle })
      });
      if (order.alreadyPaid) {
        setCheckoutStatus("This subscription payment is already confirmed.");
        await refreshPortalData();
        setBusy(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Auron Collect",
        description: `${plan.name} ${billingCycle.toLowerCase()} subscription`,
        prefill: order.customer,
        theme: { color: "#E50914" },
        handler: async (paymentResponse) => {
          setCheckoutStatus("Payment received. Verifying securely with the server...");
          try {
            const verification = await request("/api/customer-portal/subscriptions/verify", {
              method: "POST",
              body: JSON.stringify(paymentResponse)
            });
            setCheckoutStatus(
              verification.status === "PENDING"
                ? "Payment is pending provider confirmation. Refresh shortly to check its status."
                : "Payment verified. Your subscription information has been updated."
            );
            await refreshPortalData();
          } catch (verificationError) {
            if (verificationError.status === 401) onSessionExpired();
            else setError(verificationError.message || "Payment verification could not be completed.");
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false)
        }
      });
      checkout.on("payment.failed", (paymentError) => {
        setBusy(false);
        setError(paymentError.error?.description || "Payment was not completed.");
      });
      checkout.open();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to start subscription checkout.");
      setBusy(false);
    }
  };

  const cancelSubscription = async (subscription) => {
    setBusy(true);
    setError("");
    setCheckoutStatus("");
    try {
      const response = await request(
        `/api/customer-portal/subscriptions/${encodeURIComponent(subscription.id)}/cancel`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setCheckoutStatus(response.message);
      await refreshPortalData();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update your subscription.");
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (notification) => {
    try {
      await request(
        `/api/customer-portal/notifications/${encodeURIComponent(notification.id)}/read`,
        { method: "PATCH", body: JSON.stringify({}) }
      );
      setNotifications((previous) =>
        previous.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item
        )
      );
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update the notification.");
    }
  };

  const markAllRead = async () => {
    try {
      await request("/api/customer-portal/notifications/read-all", {
        method: "PATCH",
        body: JSON.stringify({})
      });
      setNotifications((previous) =>
        previous.map((item) => ({
          ...item,
          readAt: item.readAt || new Date().toISOString()
        }))
      );
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update notifications.");
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request("/api/customer-portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName: profileName })
      });
      await loadPortal();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update your profile.");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/customer-portal/profile/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword
        })
      });
      onTokenChange(response.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
    } catch (requestError) {
      if (requestError.status === 401 && requestError.message.includes("token")) {
        onSessionExpired();
      } else {
        setError(requestError.message || "Unable to update your password.");
      }
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    let logoutMessage = "";
    try {
      await request("/api/customer-auth/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    } catch (requestError) {
      if (requestError.status !== 401) {
        logoutMessage = "The local session was cleared, but server-side sign-out could not be confirmed.";
      }
    }
    onLogout(logoutMessage);
  };

  const shellClass = `mx-auto w-full max-w-7xl p-4 sm:p-6`;
  const panelClass = `rounded-2xl border p-5 ${bgCard}`;
  const tableClass = "w-full min-w-[620px] text-left text-xs";
  const currentSubscription =
    subscriptionData.subscriptions.find((item) => item.status === "ACTIVE") ||
    subscriptionData.subscriptions.find((item) =>
      ["SCHEDULED", "PENDING", "PAYMENT_FAILED"].includes(item.status)
    );
  const statusClass = (status) =>
    status === "ACTIVE" || status === "PAID"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "PAYMENT_FAILED" || status === "FAILED"
        ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
        : "bg-amber-500/10 text-amber-700 dark:text-amber-300";

  if (loading) {
    return (
      <div className={`customer-portal-shell min-h-screen overflow-x-clip ${bgCanvas}`}>
        <CustomerPortalHeader
          user={user}
          unreadCount={0}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          bgCard={bgCard}
          bgSurface={bgSurface}
          customerPortalTab={activeTab}
          setCustomerPortalTab={setActiveTab}
          notifications={notifications}
          onMarkRead={markRead}
          onLogout={signOut}
        />
        <main className={`${shellClass} space-y-5`}>
          <div className={`h-7 w-48 animate-pulse rounded ${darkMode ? "bg-white/10" : "bg-slate-200"}`} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className={`h-28 animate-pulse rounded-2xl border ${bgCard}`} />
            ))}
          </div>
          <div className={`h-64 animate-pulse rounded-2xl border ${bgCard}`} />
        </main>
      </div>
    );
  }

  return (
    <div className={`customer-portal-shell min-h-screen overflow-x-clip ${bgCanvas}`}>
      <CustomerPortalHeader
        user={profile || user}
        unreadCount={unreadCount}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        bgCard={bgCard}
        bgSurface={bgSurface}
        customerPortalTab={activeTab}
        setCustomerPortalTab={setActiveTab}
        notifications={notifications}
        onMarkRead={markRead}
        onLogout={signOut}
      />

      <main className={`${shellClass} space-y-6 pb-12`}>
        {error && (
          <div role="alert" className={`flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs ${darkMode ? "text-rose-300" : "text-rose-700"}`}>
            <span>{error}</span>
            <button onClick={loadPortal} className="rounded-lg border border-rose-400/30 p-2" aria-label="Retry loading">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}

        <div key={activeTab} className="page-enter">
        {activeTab === "overview" && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">
                  Welcome, {profile?.fullName || user?.fullName}
                </h1>
                <p className={`mt-1 text-xs ${textMuted}`}>
                  {dashboard?.customer?.name || "Your customer account"}
                  {dashboard?.customer?.customerCode ? ` · ${dashboard.customer.customerCode}` : ""}
                </p>
              </div>
              <button onClick={loadPortal} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${bgSurface}`}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 kpi-stagger">
              {[
                ["Total invoices", dashboard?.totalInvoices, "Invoices on your account"],
                ["Outstanding amount", formatCurrency(dashboard?.outstandingAmount), "Current balance due"],
                ["Paid amount", formatCurrency(dashboard?.paidAmount), "Payments allocated"],
                ["Overdue amount", formatCurrency(dashboard?.overdueAmount), "Past-due invoices"]
              ].map(([label, value, caption]) => (
                <section key={label} className={`${panelClass} dashboard-card-enter`}>
                  <p className={`text-xs font-semibold uppercase ${textMuted}`}>{label}</p>
                  <p className="mt-3 text-2xl font-bold">{value ?? "—"}</p>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>{caption}</p>
                </section>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className={panelClass}>
                <h2 className="mb-4 text-sm font-bold">Upcoming payments</h2>
                {(dashboard?.upcomingInvoices || []).length === 0 ? (
                  <p className={`text-xs ${textMuted}`}>No payments are due in the next 30 days.</p>
                ) : (
                  <div className="space-y-3">
                    {dashboard.upcomingInvoices.map((invoice) => (
                      <div key={invoice.id} className={`flex items-center justify-between gap-3 border-b pb-3 last:border-0 ${bgSurface} rounded-lg p-3`}>
                        <div>
                          <p className="text-xs font-semibold">{invoice.invoiceNumber}</p>
                          <p className={`mt-1 text-[11px] ${textMuted}`}>Due {formatDate(invoice.dueDate)}</p>
                        </div>
                        <p className="text-xs font-bold">{amountFor(invoice.outstanding, invoice.currency)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className={panelClass}>
                <h2 className="mb-4 text-sm font-bold">Recent payments</h2>
                {(dashboard?.recentReceipts || []).length === 0 ? (
                  <p className={`text-xs ${textMuted}`}>No posted payment receipts are available.</p>
                ) : (
                  <div className="space-y-3">
                    {dashboard.recentReceipts.slice(0, 5).map((receipt) => (
                      <div key={receipt.id} className={`flex items-center justify-between gap-3 border-b pb-3 last:border-0 ${textMuted}`}>
                        <div>
                          <p className="text-xs font-semibold text-inherit">{receipt.receiptNumber}</p>
                          <p className="mt-1 text-[11px]">{formatDate(receipt.receiptDate)}</p>
                        </div>
                        <p className="text-xs font-bold">{amountFor(receipt.amount, receipt.currency)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className={panelClass}>
              <h2 className="mb-4 text-sm font-bold">Recent invoices</h2>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead className={textMuted}>
                    <tr className="border-b">
                      <th className="pb-3">Invoice</th>
                      <th className="pb-3">Due date</th>
                      <th className="pb-3">Total</th>
                      <th className="pb-3">Outstanding</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard?.recentInvoices || []).map((invoice) => (
                      <tr key={invoice.id} className={`border-b ${borderSubtle}`}>
                        <td className="py-3 font-semibold">{invoice.invoiceNumber}</td>
                        <td className="py-3">{formatDate(invoice.dueDate)}</td>
                        <td className="py-3">{amountFor(invoice.total, invoice.currency)}</td>
                        <td className="py-3">{amountFor(invoice.outstanding, invoice.currency)}</td>
                        <td className="py-3">{invoice.status}</td>
                        <td className="py-3">
                          <button
                            aria-label={`Download invoice ${invoice.invoiceNumber}`}
                            className="rounded-lg border p-2 hover:border-[#E50914]"
                            disabled={busy}
                            onClick={() => downloadInvoice(invoice)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(dashboard?.recentInvoices || []).length === 0 && (
                      <tr><td className={`py-5 ${textMuted}`} colSpan={6}>No issued invoices are available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === "invoices" && (
          <section className={panelClass}>
            <h1 className="mb-4 text-xl font-bold">Invoice history</h1>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className={textMuted}>
                  <tr className="border-b">
                    <th className="pb-3">Invoice</th>
                    <th className="pb-3">Invoice date</th>
                    <th className="pb-3">Due date</th>
                    <th className="pb-3">Total</th>
                    <th className="pb-3">Paid</th>
                    <th className="pb-3">Outstanding</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className={`border-b ${borderSubtle}`}>
                      <td className="py-3 font-semibold">{invoice.invoiceNumber}</td>
                      <td className="py-3">{formatDate(invoice.invoiceDate)}</td>
                      <td className="py-3">{formatDate(invoice.dueDate)}</td>
                      <td className="py-3">{amountFor(invoice.total, invoice.currency)}</td>
                      <td className="py-3">{amountFor(invoice.paid, invoice.currency)}</td>
                      <td className="py-3">{amountFor(invoice.outstanding, invoice.currency)}</td>
                      <td className="py-3">{invoice.status}</td>
                      <td className="py-3">
                        <button className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5" disabled={busy} onClick={() => downloadInvoice(invoice)}>
                          <Download className="h-3.5 w-3.5" /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr><td className={`py-6 ${textMuted}`} colSpan={8}>No issued invoices are available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-6 border-t pt-5">
              <h2 className="mb-3 text-sm font-bold">Subscription invoices</h2>
              {subscriptionBilling.invoices.length === 0 ? (
                <p className={`text-xs ${textMuted}`}>No subscription invoices are available.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {subscriptionBilling.invoices.map((invoice) => (
                    <article key={invoice.id} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3 ${bgSurface}`}>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{invoice.invoiceNumber}</p>
                        <p className={`mt-1 text-[10px] ${textMuted}`}>
                          {invoice.planName} · {formatDate(invoice.createdAt)} · {amountFor(invoice.amount, invoice.currency)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs"
                        disabled={busy}
                        onClick={() => downloadSubscriptionDocument("invoice", invoice)}
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "subscriptions" && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">Subscription & billing</h1>
              <p className={`mt-1 text-xs ${textMuted}`}>
                Manage your customer subscription, renewals, and billing documents.
              </p>
            </div>

            {checkoutStatus && (
              <div role="status" className={`rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs ${darkMode ? "text-emerald-300" : "text-emerald-800"}`}>
                {checkoutStatus}
              </div>
            )}

            {!subscriptionData.checkoutEnabled && (
              <div className={`rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs ${darkMode ? "text-amber-200" : "text-amber-900"}`}>
                {subscriptionData.checkoutUnavailableMessage || "Razorpay Test Mode checkout is not configured. No payment has been initiated."}
              </div>
            )}

            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">Current subscription</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>
                    Renewals are manual. No payment method is stored or charged automatically.
                  </p>
                </div>
                {currentSubscription?.status === "ACTIVE" && !currentSubscription.cancelAtPeriodEnd && (
                  <button
                    className={`rounded-lg border px-3 py-2 text-xs ${bgSurface} disabled:opacity-60`}
                    disabled={busy}
                    onClick={() => cancelSubscription(currentSubscription)}
                  >
                    Cancel at period end
                  </button>
                )}
              </div>
              {currentSubscription ? (
                <div className={`grid gap-4 rounded-xl p-4 sm:grid-cols-2 lg:grid-cols-4 ${bgSurface}`}>
                  <div>
                    <p className={`text-[10px] uppercase ${textMuted}`}>Plan</p>
                    <p className="mt-1 text-sm font-bold">{currentSubscription.plan.name}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] uppercase ${textMuted}`}>Status</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(currentSubscription.status)}`}>
                      {currentSubscription.status.replaceAll("_", " ")}
                    </span>
                    {currentSubscription.cancelAtPeriodEnd && (
                      <p className={`mt-1 text-[10px] ${textMuted}`}>Cancellation scheduled</p>
                    )}
                  </div>
                  <div>
                    <p className={`text-[10px] uppercase ${textMuted}`}>Billing</p>
                    <p className="mt-1 text-xs font-semibold">{formatBillingCycle(currentSubscription.billingCycle)}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] uppercase ${textMuted}`}>Start / renewal / expiry</p>
                    <p className="mt-1 text-xs font-semibold">
                      {formatDate(currentSubscription.startsAt)} / {formatDate(currentSubscription.renewalAt)}
                    </p>
                    <p className={`mt-1 text-[10px] ${textMuted}`}>Expires {formatDate(currentSubscription.expiresAt)}</p>
                  </div>
                </div>
              ) : (
                <p className={`rounded-xl p-4 text-xs ${bgSurface} ${textMuted}`}>
                  No customer subscription is currently recorded for this account.
                </p>
              )}
              {currentSubscription?.status === "ACTIVE" && (
                <p className={`mt-3 text-[11px] ${textMuted}`}>
                  Choosing a different plan below schedules the change for the current period end. The next period is paid manually when you submit checkout; it is not an automatic charge.
                </p>
              )}
            </section>

            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">Available plans</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>
                    Only customer plans with management-approved prices and tax terms are shown.
                  </p>
                </div>
                <div className={`flex flex-wrap gap-1 rounded-lg border p-1 ${bgSurface}`}>
                  {subscriptionCycles.map(({ value, label, price }) => {
                    const hasCyclePrice = subscriptionData.plans.some((plan) =>
                      plan[price] !== null && plan[price] !== undefined
                    );
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!hasCyclePrice}
                        aria-pressed={billingCycle === value}
                        onClick={() => setBillingCycle(value)}
                        className={`rounded-md px-3 py-1.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                          billingCycle === value ? "bg-[#E50914] text-white" : ""
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {subscriptionData.plans.length === 0 ? (
                <p className={`rounded-xl p-4 text-xs ${bgSurface} ${textMuted}`}>
                  No approved customer subscription plans are available yet. Management must configure and approve customer-specific plans, prices, and tax terms before checkout can be offered.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {subscriptionData.plans.map((plan) => {
                    const selectedCycle = subscriptionCycles.find(({ value }) => value === billingCycle);
                    const price = selectedCycle ? plan[selectedCycle.price] : null;
                    const isCurrentPlan = currentSubscription?.plan.id === plan.id &&
                      currentSubscription.billingCycle === billingCycle;
                    const hasPendingCheckout = subscriptionData.payments.some((payment) =>
                      payment.planId === plan.id &&
                      payment.billingCycle === billingCycle &&
                      ["CREATING", "CREATED"].includes(payment.status)
                    );
                    const hasScheduledSubscription = currentSubscription?.status === "SCHEDULED";
                    return (
                      <article key={plan.id} className={`flex flex-col rounded-xl border p-4 ${bgSurface}`}>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold">{plan.name}</h3>
                          {plan.description && <p className={`mt-2 text-xs ${textMuted}`}>{plan.description}</p>}
                          <p className="mt-4 text-2xl font-bold">
                            {price === null ? "Unavailable" : amountFor(price, plan.currency)}
                            {price !== null && <span className={`ml-1 text-[10px] font-medium ${textMuted}`}>/ {selectedCycle.label.toLowerCase()}</span>}
                          </p>
                          <p className={`mt-3 text-[10px] ${textMuted}`}>{plan.taxTerms}</p>
                          {!!plan.features?.length && (
                            <ul className={`mt-3 list-inside list-disc space-y-1 text-[11px] ${textMuted}`}>
                              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                            </ul>
                          )}
                          {!!Object.keys(plan.usageLimits || {}).length && (
                            <div className={`mt-3 space-y-1 text-[10px] ${textMuted}`}>
                              {Object.entries(plan.usageLimits).map(([name, limit]) => (
                                <p key={name}>{name}: {limit == null ? "Unlimited" : limit}</p>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={busy || !subscriptionData.checkoutEnabled || price === null || hasScheduledSubscription}
                          onClick={() => startSubscriptionCheckout(plan)}
                          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-[#E50914] px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          {hasPendingCheckout
                            ? "Continue checkout"
                            : isCurrentPlan
                              ? "Renew at period end"
                              : currentSubscription?.status === "ACTIVE"
                              ? "Pay & schedule plan"
                              : "Subscribe"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold">Subscription billing history</h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                  disabled={busy}
                  onClick={() => downloadSubscriptionDocument("history", {})}
                >
                  <Download className="h-3.5 w-3.5" /> Download history PDF
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead className={textMuted}>
                    <tr className="border-b">
                      <th className="pb-3">Plan</th>
                      <th className="pb-3">Cycle / period</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Invoice / receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptionData.payments.map((payment) => (
                      <tr key={payment.id} className={`border-b ${borderSubtle}`}>
                        <td className="py-3 font-semibold">{payment.planName}</td>
                        <td className="py-3">
                          {formatBillingCycle(payment.billingCycle)}
                          <span className={`block text-[10px] ${textMuted}`}>
                            {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
                          </span>
                        </td>
                        <td className="py-3">{amountFor(payment.amount, payment.currency)}</td>
                        <td className="py-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(payment.status)}`}>
                            {payment.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="py-3">
                          {payment.invoice && (
                            <button
                              className="mr-2 inline-flex items-center gap-1 rounded-lg border px-2 py-1.5"
                              disabled={busy}
                              onClick={() => downloadSubscriptionDocument(
                                "invoice",
                                payment.invoice
                              )}
                            >
                              <Download className="h-3 w-3" /> Invoice
                            </button>
                          )}
                          {payment.receipt && (
                            <button
                              className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5"
                              disabled={busy}
                              onClick={() => downloadSubscriptionDocument(
                                "receipt",
                                payment.receipt
                              )}
                            >
                              <Download className="h-3 w-3" /> Receipt
                            </button>
                          )}
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-1 rounded-lg border px-2 py-1.5"
                            disabled={busy}
                            onClick={() => downloadSubscriptionDocument("payment", payment)}
                          >
                            <Download className="h-3 w-3" /> Details
                          </button>
                        </td>
                      </tr>
                    ))}
                    {subscriptionData.payments.length === 0 && (
                      <tr><td className={`py-6 ${textMuted}`} colSpan={5}>No subscription payments are available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === "payments" && (
          <section className={panelClass}>
            <h1 className="mb-4 text-xl font-bold">Payment history</h1>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className={textMuted}>
                  <tr className="border-b">
                    <th className="pb-3">Receipt</th>
                    <th className="pb-3">Date</th>
                    <th className="pb-3">Method</th>
                    <th className="pb-3">Reference</th>
                    <th className="pb-3">Amount</th>
                    <th className="pb-3">Allocated invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className={`border-b ${borderSubtle}`}>
                      <td className="py-3 font-semibold">{receipt.receiptNumber}</td>
                      <td className="py-3">{formatDate(receipt.receiptDate)}</td>
                      <td className="py-3">{receipt.paymentMethod}</td>
                      <td className="py-3">{receipt.transactionReference || "—"}</td>
                      <td className="py-3">{amountFor(receipt.amount, receipt.currency)}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{receipt.allocations.map((allocation) => allocation.invoice?.invoiceNumber).filter(Boolean).join(", ") || "Unallocated"}</span>
                          <button
                            type="button"
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 py-1.5"
                            disabled={busy}
                            onClick={() => downloadReceipt(receipt)}
                          >
                            <Download className="h-3 w-3" /> PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {receipts.length === 0 && (
                    <tr><td className={`py-6 ${textMuted}`} colSpan={6}>No posted receipts are available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-6 border-t pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold">Subscription payments</h2>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                  disabled={busy}
                  onClick={() => downloadSubscriptionDocument("history", {})}
                >
                  <Download className="h-3.5 w-3.5" /> History PDF
                </button>
              </div>
              {subscriptionData.payments.length === 0 ? (
                <p className={`text-xs ${textMuted}`}>No subscription payment transactions are available.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {subscriptionData.payments.map((payment) => (
                    <article key={payment.id} className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3 ${bgSurface}`}>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{payment.planName}</p>
                        <p className={`mt-1 text-[10px] ${textMuted}`}>
                          {payment.status.replaceAll("_", " ")} · {formatDate(payment.paidAt || payment.createdAt)} · {amountFor(payment.amount, payment.currency)}
                        </p>
                        <p className={`mt-1 truncate text-[10px] ${textMuted}`}>
                          {payment.razorpayPaymentId || payment.razorpayOrderId || "No provider reference yet"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs"
                        disabled={busy}
                        onClick={() => downloadSubscriptionDocument("payment", payment)}
                      >
                        <Download className="h-3.5 w-3.5" /> Details
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "notifications" && (
          <section className={panelClass}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">Notifications</h1>
                <p className={`mt-1 text-xs ${textMuted}`}>{unreadCount} unread</p>
              </div>
              {unreadCount > 0 && (
                <button className={`rounded-lg border px-3 py-2 text-xs ${bgSurface}`} onClick={markAllRead}>
                  Mark all as read
                </button>
              )}
            </div>
            <div className="space-y-3">
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  data-read={Boolean(notification.readAt)}
                  className={`notification-item rounded-xl border p-4 ${notification.readAt ? bgSurface : "border-[#E50914]/40 bg-[#E50914]/5"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{notification.title}</h2>
                      <p className={`mt-1 text-xs ${textMuted}`}>{notification.message}</p>
                      <p className={`mt-2 text-[10px] ${textMuted}`}>{formatDate(notification.createdAt)}</p>
                      {(notification.invoice || notification.receipt) && (
                        <button
                          className="mt-2 text-xs font-semibold text-[#E50914] hover:underline"
                          onClick={() => setActiveTab(notification.invoice ? "invoices" : "payments")}
                        >
                          View {notification.invoice ? `invoice ${notification.invoice.invoiceNumber}` : `receipt ${notification.receipt.receiptNumber}`}
                        </button>
                      )}
                    </div>
                    <button
                      aria-label="Mark notification as read"
                      aria-hidden={Boolean(notification.readAt)}
                      tabIndex={notification.readAt ? -1 : 0}
                      disabled={Boolean(notification.readAt)}
                      className="notification-action rounded-lg border p-2"
                      onClick={() => markRead(notification)}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
              {notifications.length === 0 && (
                <p className={`py-8 text-center text-xs ${textMuted}`}>You have no notifications.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === "profile" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className={panelClass}>
              <h1 className="mb-4 text-xl font-bold">Account profile</h1>
              <div className={`mb-4 rounded-xl p-3 text-xs ${bgSurface}`}>
                <p><span className={textMuted}>Email:</span> {profile?.email || user?.email}</p>
                <p className="mt-2"><span className={textMuted}>Verification:</span> {profile?.emailVerifiedAt ? "Verified" : "Not verified"}</p>
                <p className="mt-2"><span className={textMuted}>CRM customer:</span> {profile?.customer?.name || "—"}</p>
                <p className="mt-2"><span className={textMuted}>Phone:</span> {profile?.customer?.phone || "—"}</p>
              </div>
              <form className="space-y-3" onSubmit={saveProfile}>
                <label className="block text-xs font-semibold">
                  Portal display name
                  <input className={`mt-1.5 ${bgSurface} w-full rounded-xl border p-2.5 text-xs`} maxLength={120} onChange={(event) => setProfileName(event.target.value)} required value={profileName} />
                </label>
                <button className="rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" disabled={busy} type="submit">
                  Save profile
                </button>
              </form>
            </section>
            <section className={panelClass}>
              <h2 className="mb-4 text-xl font-bold">Change password</h2>
              <form className="space-y-3" onSubmit={changePassword}>
                <label className="block text-xs font-semibold">
                  Current password
                  <input autoComplete="current-password" className={`mt-1.5 ${bgSurface} w-full rounded-xl border p-2.5 text-xs`} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} />
                </label>
                <label className="block text-xs font-semibold">
                  New password
                  <input autoComplete="new-password" className={`mt-1.5 ${bgSurface} w-full rounded-xl border p-2.5 text-xs`} minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />
                </label>
                <label className="block text-xs font-semibold">
                  Confirm new password
                  <input autoComplete="new-password" className={`mt-1.5 ${bgSurface} w-full rounded-xl border p-2.5 text-xs`} minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
                </label>
                <button className="rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" disabled={busy} type="submit">
                  Update password
                </button>
              </form>
            </section>
          </div>
        )}
        </div>

        <p className={`flex items-center gap-2 text-[10px] ${textMuted}`}>
          <FileText className="h-3.5 w-3.5" />
          Portal information is loaded from your authenticated customer account.
        </p>
      </main>
      <CustomerAuronAssistant
        token={token}
        darkMode={darkMode}
        onSessionExpired={onSessionExpired}
      />
    </div>
  );
}
