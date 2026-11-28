import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  CreditCard,
  Download,
  FileText,
  RefreshCw
} from "lucide-react";
import CustomerPortalHeader from "./CustomerPortalHeader";
import CustomerAuronAssistant from "./CustomerAuronAssistant";
import DataTableTools from "./DataTableTools";
import OrganizationSubscriptionPlans from "./OrganizationSubscriptionPlans";
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
  onOrganizationContactSales,
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
  const [organizationSubscription, setOrganizationSubscription] = useState({
    plans: [],
    billingConfiguration: { available: false, mode: null },
    currentSubscription: null,
    scheduledSubscription: null,
    payments: []
  });
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [autoRenewForNextCheckout, setAutoRenewForNextCheckout] = useState(false);
  const [renewalPhone, setRenewalPhone] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [profile, setProfile] = useState(null);
  const receiptDownloadRequested = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileTimeZone, setProfileTimeZone] = useState("Asia/Kolkata");
  const [profileNotice, setProfileNotice] = useState("");
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
      const [dashboardResponse, invoiceResponse, receiptResponse, notificationResponse, profileResponse, subscriptionResponse, subscriptionBillingResponse, organizationSubscriptionResponse] =
        await Promise.all([
          request("/api/customer-portal/dashboard"),
          request("/api/customer-portal/invoices"),
          request("/api/customer-portal/receipts"),
          request("/api/customer-portal/notifications"),
          request("/api/customer-portal/profile"),
          request("/api/customer-portal/subscriptions"),
          request("/api/customer-portal/subscriptions/billing"),
          request("/api/customer-portal/organization-subscription")
        ]);
      return {
        dashboard: dashboardResponse.dashboard,
        invoices: invoiceResponse.invoices || [],
        receipts: receiptResponse.receipts || [],
        notifications: notificationResponse.notifications || [],
        profile: profileResponse.profile,
        subscriptionData: subscriptionResponse,
        subscriptionBilling: subscriptionBillingResponse,
        organizationSubscription: organizationSubscriptionResponse
      };
  }, [request]);

  const applyPortalData = useCallback((data) => {
    setDashboard(data.dashboard);
    setInvoices(data.invoices);
    setReceipts(data.receipts);
    setNotifications(data.notifications);
    setProfile(data.profile);
    setProfileName(data.profile?.fullName || "");
    setProfileTimeZone(data.profile?.timeZone || "Asia/Kolkata");
    setRenewalPhone(data.profile?.customer?.phone || "");
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
    setOrganizationSubscription({
      plans: data.organizationSubscription?.plans || [],
      billingConfiguration: data.organizationSubscription?.billingConfiguration || {
        available: false,
        mode: null
      },
      currentSubscription: data.organizationSubscription?.currentSubscription || null,
      scheduledSubscription: data.organizationSubscription?.scheduledSubscription || null,
      payments: data.organizationSubscription?.payments || []
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

  const downloadOrganizationSubscriptionReceipt = async (payment) => {
    setBusy(true);
    setError("");
    try {
      const blob = await apiDownload(
        `/api/customer-portal/organization-subscription/payments/${encodeURIComponent(payment.id)}/receipt.pdf`,
        token
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `AURON-COLLECT-Subscription-Receipt-${String(
        payment.invoice?.invoiceNumber || payment.id
      ).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "The subscription receipt could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const downloadReceipt = useCallback(async (receipt) => {
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
  }, [onSessionExpired, token]);

  const requestedReceiptId = new URLSearchParams(window.location.search).get("receiptId");
  const requestedReceiptUnavailable = Boolean(
    requestedReceiptId &&
    !loading &&
    !receipts.some(({ id }) => id === requestedReceiptId)
  );
  useEffect(() => {
    if (!requestedReceiptId || loading || receiptDownloadRequested.current) return;

    receiptDownloadRequested.current = true;
    const receipt = receipts.find(({ id }) => id === requestedReceiptId);
    if (!receipt) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("receiptId");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
    void Promise.resolve().then(() => downloadReceipt(receipt));
  }, [downloadReceipt, loading, receipts, requestedReceiptId]);

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
        body: JSON.stringify({
          planId: plan.id,
          billingCycle,
          autoRenew:
            autoRenewForNextCheckout ||
            Boolean(currentSubscription?.autoRenewRequested),
          contact: renewalPhone
        })
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
        ...(order.autoRenewRequested
          ? { customer_id: order.customerId, recurring: true, method: "card" }
          : {}),
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

  const startOrganizationSubscriptionCheckout = async (plan) => {
    const billingConfiguration = organizationSubscription.billingConfiguration;
    if (!billingConfiguration?.available || billingConfiguration.mode !== "test") {
      setError("Razorpay Test Mode checkout is unavailable. No payment has been initiated.");
      return;
    }

    setBusy(true);
    setError("");
    setCheckoutStatus("");
    try {
      await loadRazorpayCheckout();
      const order = await request("/api/customer-portal/organization-subscription/orders", {
        method: "POST",
        headers: { "Idempotency-Key": `portal-${window.crypto.randomUUID()}` },
        body: JSON.stringify({
          planCode: plan.code,
          billingCycle: "MONTHLY",
          autoRenew:
            autoRenewForNextCheckout ||
            Boolean(organizationSubscription.currentSubscription?.autoRenewRequested),
          contact: renewalPhone
        })
      });
      if (order.alreadyPaid) {
        setCheckoutStatus("This organization subscription payment is already confirmed.");
        await refreshPortalData();
        setBusy(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        ...(order.autoRenewRequested
          ? { customer_id: order.customerId, recurring: true, method: "card" }
          : {}),
        amount: order.amount,
        currency: order.currency,
        name: "Auron Collect",
        description: `${order.planName} monthly organization subscription`,
        prefill: {
          name: user?.fullName || "",
          email: user?.email || ""
        },
        theme: { color: "#E50914" },
        handler: async (paymentResponse) => {
          setCheckoutStatus("Payment received. Verifying securely with Razorpay…");
          try {
            const verification = await request(
              "/api/customer-portal/organization-subscription/orders/verify",
              {
                method: "POST",
                body: JSON.stringify({
                  ...paymentResponse,
                  paymentId: order.paymentId
                })
              }
            );
            if (verification.status === "PENDING") {
              setCheckoutStatus("Payment is pending provider confirmation. Refresh shortly to check its status.");
            } else {
              const emailNotice = verification.receiptEmailStatus === "SMTP_ACCEPTED"
                ? " The official receipt was emailed to your verified portal address."
                : verification.receiptEmailStatus === "DISABLED"
                  ? " Receipt email delivery is disabled in this environment; the PDF is available in payment history."
                  : "";
              setCheckoutStatus(`Payment verified. Your organization subscription has been updated.${emailNotice}`);
            }
            await refreshPortalData();
          } catch (verificationError) {
            if (verificationError.status === 401) onSessionExpired();
            else {
              setCheckoutStatus("");
              setError(
                verificationError.message ||
                "Payment verification could not be completed. Refresh payment history before retrying."
              );
            }
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false)
        }
      });
      checkout.on("payment.failed", (paymentError) => {
        setCheckoutStatus("");
        setError(paymentError.error?.description || "Payment was not completed.");
        setBusy(false);
      });
      checkout.open();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to start the subscription checkout.");
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

  const setCustomerSubscriptionAutoRenew = async (subscription, enabled) => {
    setBusy(true);
    setError("");
    setCheckoutStatus("");
    try {
      const action = enabled ? "enable" : "disable";
      const response = await request(
        `/api/customer-portal/subscriptions/${encodeURIComponent(subscription.id)}/${action}-auto-renew`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setCheckoutStatus(response.message);
      setAutoRenewForNextCheckout(enabled);
      await refreshPortalData();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update auto-renew.");
    } finally {
      setBusy(false);
    }
  };

  const setOrganizationAutoRenew = async (subscription, enabled) => {
    setBusy(true);
    setError("");
    setCheckoutStatus("");
    try {
      const action = enabled ? "enable" : "disable";
      const response = await request(
        `/api/customer-portal/organization-subscription/${encodeURIComponent(subscription.id)}/${action}-auto-renew`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setCheckoutStatus(response.message);
      setAutoRenewForNextCheckout(enabled);
      await refreshPortalData();
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setError(requestError.message || "Unable to update auto-renew.");
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
        body: JSON.stringify({
          fullName: profileName,
          timeZone: profileTimeZone
        })
      });
      await loadPortal();
      setProfileNotice("Profile and reminder time zone updated.");
    } catch (requestError) {
      setProfileNotice("");
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

  const shellClass = `mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8`;
  const panelClass = `portal-interactive-card dashboard-card-enter rounded-2xl border p-5 sm:p-6 ${bgCard}`;
  const tableClass = "portal-data-table w-full min-w-[640px] text-left text-xs";
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
      <div className={`customer-portal-shell min-h-screen overflow-x-clip ${bgCanvas}`} data-theme={darkMode ? "dark" : "light"}>
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
        <main className={`${shellClass} space-y-6`}>
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
    <div className={`customer-portal-shell min-h-screen overflow-x-clip ${bgCanvas}`} data-theme={darkMode ? "dark" : "light"}>
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

      <main className={`${shellClass} space-y-7 pb-12 sm:space-y-8`}>
        {(error || requestedReceiptUnavailable) && (
          <div role="alert" className={`flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm ${darkMode ? "text-rose-300" : "text-rose-700"}`}>
            <span>{error || "That receipt is not available in this customer account."}</span>
            <button onClick={loadPortal} className="rounded-lg border border-rose-400/30 p-2" aria-label="Retry loading">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}

        <div key={activeTab} className="page-enter space-y-6 sm:space-y-7">
        {activeTab === "overview" && (
          <>
            <section className={`portal-welcome flex flex-col gap-5 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7 ${bgCard}`}>
              <div className="flex min-w-0 items-center gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#E50914]/10 text-lg font-extrabold text-[#E50914] sm:h-14 sm:w-14">
                  {(profile?.fullName || user?.fullName || "C").trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${textMuted}`}>
                    Customer account
                  </p>
                  <h1 className="mt-1 truncate text-xl font-extrabold tracking-tight sm:text-2xl">
                  Welcome, {profile?.fullName || user?.fullName}
                  </h1>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                  {dashboard?.customer?.name || "Your customer account"}
                  {dashboard?.customer?.customerCode ? ` · ${dashboard.customer.customerCode}` : ""}
                  </p>
                </div>
              </div>
              <button onClick={loadPortal} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl border px-4 text-xs font-semibold sm:self-auto ${bgSurface}`}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </section>
            <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4 kpi-stagger">
              {[
                { label: "Total invoices", value: dashboard?.totalInvoices, caption: "Invoices on your account", icon: FileText },
                { label: "Outstanding amount", value: formatCurrency(dashboard?.outstandingAmount), caption: "Current balance due", icon: CircleDollarSign },
                { label: "Paid amount", value: formatCurrency(dashboard?.paidAmount), caption: "Payments allocated", icon: CreditCard },
                { label: "Overdue amount", value: formatCurrency(dashboard?.overdueAmount), caption: "Past-due invoices", icon: AlertTriangle }
              ].map(({ label, value, caption, icon: Icon }) => (
                <section key={label} className={`${panelClass} flex min-h-36 flex-col justify-between`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${textMuted}`}>{label}</p>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E50914]/10 text-[#E50914]">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <div>
                    <p className="mt-4 break-words text-xl font-extrabold tabular-nums sm:text-2xl">{value ?? "—"}</p>
                    <p className={`mt-1 text-[11px] ${textMuted}`}>{caption}</p>
                  </div>
                </section>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className={`${panelClass} min-h-64`}>
                <div className="mb-4">
                  <h2 className="text-sm font-bold">Upcoming payments</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>Invoices due soon</p>
                </div>
                {(dashboard?.upcomingInvoices || []).length === 0 ? (
                  <p className={`text-xs ${textMuted}`}>No payments are due in the next 30 days.</p>
                ) : (
                  <div className="space-y-3">
                    {dashboard.upcomingInvoices.map((invoice) => (
                      <div key={invoice.id} className={`flex items-center justify-between gap-4 border-b border-gray-500/10 py-3 last:border-0 last:pb-0 first:pt-0`}>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">{invoice.invoiceNumber}</p>
                          <p className={`mt-1 text-[11px] ${textMuted}`}>Due {formatDate(invoice.dueDate)}</p>
                        </div>
                        <p className="shrink-0 text-xs font-bold tabular-nums">{amountFor(invoice.outstanding, invoice.currency)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className={`${panelClass} min-h-64`}>
                <div className="mb-4">
                  <h2 className="text-sm font-bold">Recent payments</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>Latest posted receipts</p>
                </div>
                {(dashboard?.recentReceipts || []).length === 0 ? (
                  <p className={`text-xs ${textMuted}`}>No posted payment receipts are available.</p>
                ) : (
                  <div className="space-y-3">
                    {dashboard.recentReceipts.slice(0, 5).map((receipt) => (
                      <div key={receipt.id} className="flex items-center justify-between gap-4 border-b border-gray-500/10 py-3 last:border-0 last:pb-0 first:pt-0">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{receipt.receiptNumber}</p>
                          <p className={`mt-1 text-[11px] ${textMuted}`}>{formatDate(receipt.receiptDate)}</p>
                        </div>
                        <p className="shrink-0 text-xs font-bold tabular-nums">{amountFor(receipt.amount, receipt.currency)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold">Recent invoices</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>Your latest billing activity</p>
                </div>
              </div>
              <DataTableTools
                rows={dashboard?.recentInvoices || []}
                searchLabel="invoices"
                getSearchText={(invoice) => [
                  invoice.invoiceNumber,
                  invoice.status,
                  invoice.invoiceDate,
                  invoice.dueDate,
                  invoice.total,
                  invoice.outstanding,
                ].join(" ")}
                filters={[
                  { key: "status", label: "status", getValue: (invoice) => invoice.status }
                ]}
                loading={loading}
                emptyText="No issued invoices are available."
              >
                {({ rows: pageInvoices, emptyMessage }) => (
                  <div className="max-w-full overflow-x-auto rounded-xl border">
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
                        {pageInvoices.map((invoice) => (
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
                        {pageInvoices.length === 0 && (
                          <tr><td className={`py-5 ${textMuted}`} colSpan={6}>{emptyMessage}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </DataTableTools>
            </section>
          </>
        )}

        {activeTab === "invoices" && (
          <section className={panelClass}>
            <div className="mb-5">
              <p className={`text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]`}>Account documents</p>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Invoice history</h1>
              <p className={`mt-1 text-xs ${textMuted}`}>Review balances, due dates and download invoice PDFs.</p>
            </div>
            <DataTableTools
              rows={invoices}
              searchLabel="invoices"
              getSearchText={(invoice) => [
                invoice.invoiceNumber,
                invoice.status,
                invoice.invoiceDate,
                invoice.dueDate,
                invoice.total,
                invoice.outstanding,
              ].join(" ")}
              filters={[
                { key: "status", label: "status", getValue: (invoice) => invoice.status }
              ]}
              loading={loading}
              emptyText="No issued invoices are available."
            >
              {({ rows: pageInvoices, emptyMessage }) => (
                <div className="max-w-full overflow-x-auto rounded-xl border">
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
                  {pageInvoices.map((invoice) => (
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
                  {pageInvoices.length === 0 && (
                    <tr><td className={`py-6 ${textMuted}`} colSpan={8}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                </div>
              )}
            </DataTableTools>
            <div className="mt-7 border-t pt-6">
              <div className="mb-4">
                <h2 className="text-sm font-bold">Subscription invoices</h2>
                <p className={`mt-1 text-[11px] ${textMuted}`}>Documents for your customer subscription.</p>
              </div>
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
          <div className="space-y-6">
            <div className="max-w-3xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]">Plans and records</p>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Subscription & billing</h1>
              <p className={`mt-2 text-sm ${textMuted}`}>
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
                    Auto-renew is opt-in. A card token is saved during your next regular checkout; there is no separate verification charge.
                  </p>
                </div>
                {currentSubscription?.status === "ACTIVE" && !currentSubscription.cancelAtPeriodEnd && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={Boolean(currentSubscription.autoRenew || currentSubscription.autoRenewRequested)}
                      className={`rounded-lg border px-3 py-2 text-xs ${bgSurface} disabled:opacity-60`}
                      disabled={busy}
                      onClick={() => setCustomerSubscriptionAutoRenew(
                        currentSubscription,
                        !(currentSubscription.autoRenew || currentSubscription.autoRenewRequested)
                      )}
                    >
                      Auto-Renew {currentSubscription.autoRenew || currentSubscription.autoRenewRequested ? "ON" : "OFF"}
                    </button>
                    <button
                      className={`rounded-lg border px-3 py-2 text-xs ${bgSurface} disabled:opacity-60`}
                      disabled={busy}
                      onClick={() => cancelSubscription(currentSubscription)}
                    >
                      Cancel at period end
                    </button>
                  </div>
                )}
              </div>
              {currentSubscription ? (
                <div className={`grid gap-4 rounded-xl p-4 sm:grid-cols-2 lg:grid-cols-5 ${bgSurface}`}>
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
                  <div>
                    <p className={`text-[10px] uppercase ${textMuted}`}>Auto-renew</p>
                    <p className="mt-1 text-xs font-semibold">
                      {currentSubscription.autoRenew
                        ? "On"
                        : currentSubscription.autoRenewRequested
                          ? "Pending next checkout"
                          : "Off"}
                    </p>
                    <p className={`mt-1 text-[10px] ${textMuted}`}>
                      Next charge: {currentSubscription.nextRenewalDate
                        ? formatDate(currentSubscription.nextRenewalDate)
                        : currentSubscription.autoRenewRequested
                          ? "Pending payment-method confirmation"
                          : "Not scheduled"}
                    </p>
                    <p className={`mt-1 text-[10px] ${textMuted}`}>
                      Payment method: {currentSubscription.paymentMethod || "Not saved"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className={`rounded-xl p-4 text-xs ${bgSurface} ${textMuted}`}>
                  No customer subscription is currently recorded for this account.
                </p>
              )}
              {currentSubscription?.status === "ACTIVE" && (
                <p className={`mt-3 text-[11px] ${textMuted}`}>
                  {currentSubscription.autoRenewRequested && !currentSubscription.autoRenew
                    ? "Auto-renew is requested and will activate after your next successful regular checkout saves a card token."
                    : currentSubscription.autoRenew
                      ? "Auto-renew is enabled. You can turn it off at any time."
                      : "Choosing a different plan below schedules the change for the current period end. Renewal remains manual unless you opt in."}
                </p>
              )}
              <div className={`mt-4 grid gap-3 rounded-xl p-3 sm:grid-cols-2 ${bgSurface}`}>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={autoRenewForNextCheckout || Boolean(currentSubscription?.autoRenewRequested)}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      if (currentSubscription?.status === "ACTIVE") {
                        void setCustomerSubscriptionAutoRenew(currentSubscription, enabled);
                      } else {
                        setAutoRenewForNextCheckout(enabled);
                      }
                    }}
                    disabled={busy}
                    className="mt-0.5 accent-[#E50914]"
                  />
                  <span>
                    Save my card and enable auto-renew after the next regular checkout.
                    No separate verification payment is charged.
                  </span>
                </label>
                <label className={`text-xs ${textMuted}`}>
                  Billing phone
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={renewalPhone}
                    onChange={(event) => setRenewalPhone(event.target.value)}
                    className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${bgCard}`}
                    placeholder="Enter a phone number for Razorpay"
                  />
                </label>
              </div>
            </section>

            <section className={panelClass}>
              <OrganizationSubscriptionPlans
                customerPortalAccess
                plans={organizationSubscription.plans}
                billingConfiguration={organizationSubscription.billingConfiguration}
                currentSubscription={organizationSubscription.currentSubscription}
                billingCycle="MONTHLY"
                isProcessing={busy}
                isLoading={loading}
                onCheckout={startOrganizationSubscriptionCheckout}
                onToggleAutoRenew={setOrganizationAutoRenew}
                onContactSales={onOrganizationContactSales}
                bgCard={bgCard}
                bgSurface={bgSurface}
                textMuted={textMuted}
              />
              {(organizationSubscription.currentSubscription ||
                organizationSubscription.scheduledSubscription) && (
                <div className={`mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-2 ${bgSurface}`}>
                  {organizationSubscription.currentSubscription && (
                    <div>
                      <p className={`text-[10px] uppercase ${textMuted}`}>Current organization subscription</p>
                      <p className="mt-1 text-xs font-semibold">
                        {organizationSubscription.currentSubscription.plan.name} · {organizationSubscription.currentSubscription.status}
                      </p>
                      <p className={`mt-1 text-[10px] ${textMuted}`}>
                        {formatBillingCycle(organizationSubscription.currentSubscription.billingCycle)} · {formatDate(organizationSubscription.currentSubscription.startsAt)} – {formatDate(organizationSubscription.currentSubscription.endsAt)}
                      </p>
                    </div>
                  )}
                  {organizationSubscription.scheduledSubscription && (
                    <div>
                      <p className={`text-[10px] uppercase ${textMuted}`}>Scheduled plan change</p>
                      <p className="mt-1 text-xs font-semibold">
                        {organizationSubscription.scheduledSubscription.plan.name} · {organizationSubscription.scheduledSubscription.status}
                      </p>
                      <p className={`mt-1 text-[10px] ${textMuted}`}>
                        Starts {formatDate(organizationSubscription.scheduledSubscription.startsAt)}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-5 border-t border-gray-500/20 pt-4">
                <h2 className="text-sm font-bold">Organization subscription payment history</h2>
                {organizationSubscription.payments.length === 0 ? (
                  <p className={`mt-3 text-xs ${textMuted}`}>No organization subscription payments are recorded.</p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {organizationSubscription.payments.map((payment) => (
                      <article
                        key={payment.id}
                        className={`portal-interactive-card flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3 ${bgSurface}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{payment.planName}</p>
                          <p className={`mt-1 text-[10px] ${textMuted}`}>
                            {payment.status.replaceAll("_", " ")} · {formatBillingCycle(payment.billingCycle)} · {formatDate(payment.paidAt || payment.createdAt)}
                          </p>
                          <p className={`mt-1 text-xs font-semibold ${textMuted}`}>
                            {amountFor(payment.amount, payment.currency)}
                          </p>
                          {payment.invoice?.invoiceNumber && (
                            <p className={`mt-1 truncate text-[10px] ${textMuted}`}>
                              Receipt reference: {payment.invoice.invoiceNumber}
                            </p>
                          )}
                        </div>
                        {payment.status === "PAID" && payment.invoice && (
                          <button
                            type="button"
                            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs"
                            disabled={busy}
                            onClick={() => downloadOrganizationSubscriptionReceipt(payment)}
                          >
                            <Download className="h-3.5 w-3.5" /> Receipt PDF
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {subscriptionData.plans.length > 0 && (
            <section className={panelClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">Customer payment plans</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>
                    Only customer plans with management-approved prices and tax terms are shown.
                  </p>
                </div>
                <div className={`flex flex-wrap gap-1 rounded-xl border p-1 ${bgSurface}`}>
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

              <div className="grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                      <article key={plan.id} className={`portal-interactive-card flex h-full flex-col rounded-2xl border p-5 ${bgSurface}`}>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold">{plan.name}</h3>
                          {plan.description && <p className={`mt-2 text-xs ${textMuted}`}>{plan.description}</p>}
                          <p className="mt-4 text-2xl font-extrabold tabular-nums">
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
            </section>
            )}

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
              <DataTableTools
                rows={subscriptionData.payments}
                searchLabel="subscription billing history"
                getSearchText={(payment) => [
                  payment.planName,
                  payment.billingCycle,
                  payment.status,
                  payment.razorpayPaymentId,
                  payment.razorpayOrderId,
                  payment.amount,
                ].join(" ")}
                filters={[
                  { key: "status", label: "status", getValue: (payment) => payment.status }
                ]}
                loading={loading}
                emptyText="No subscription payments are available."
              >
                {({ rows: pageSubscriptionPayments, emptyMessage }) => (
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
                    {pageSubscriptionPayments.map((payment) => (
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
                    {pageSubscriptionPayments.length === 0 && (
                      <tr><td className={`py-6 ${textMuted}`} colSpan={5}>{emptyMessage}</td></tr>
                    )}
                  </tbody>
                </table>
                  </div>
                )}
              </DataTableTools>
            </section>
          </div>
        )}

        {activeTab === "payments" && (
          <section className={panelClass}>
            <div className="mb-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]">Receipts and transactions</p>
              <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Payment history</h1>
              <p className={`mt-1 text-xs ${textMuted}`}>View posted receipts and payment allocations.</p>
            </div>
            <DataTableTools
              rows={receipts}
              searchLabel="payment history"
              getSearchText={(receipt) => [
                receipt.receiptNumber,
                receipt.paymentMethod,
                receipt.transactionReference,
                receipt.receiptDate,
                receipt.amount,
                receipt.allocations.map((allocation) => allocation.invoice?.invoiceNumber).join(" "),
              ].join(" ")}
              filters={[
                { key: "method", label: "payment method", getValue: (receipt) => receipt.paymentMethod }
              ]}
              loading={loading}
              emptyText="No posted receipts are available."
            >
              {({ rows: pageReceipts, emptyMessage }) => (
                <div className="max-w-full overflow-x-auto rounded-xl border">
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
                  {pageReceipts.map((receipt) => (
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
                  {pageReceipts.length === 0 && (
                    <tr><td className={`py-6 ${textMuted}`} colSpan={6}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                </div>
              )}
            </DataTableTools>
            <div className="mt-7 border-t pt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold">Subscription payments</h2>
                  <p className={`mt-1 text-[11px] ${textMuted}`}>Separate from customer loan repayments.</p>
                </div>
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
                    <article key={payment.id} className={`portal-interactive-card flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3 ${bgSurface}`}>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]">Account updates</p>
                <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Notifications</h1>
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
                  className={`portal-interactive-card notification-item rounded-xl border p-4 ${notification.readAt ? bgSurface : "border-[#E50914]/40 bg-[#E50914]/5"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{notification.title}</h2>
                      <p className={`mt-1 break-words text-xs ${textMuted}`}>{notification.message}</p>
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
          <div className="grid auto-rows-fr gap-5 lg:grid-cols-2">
            <section className={panelClass}>
              <div className="mb-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]">Personal settings</p>
                <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Account profile</h1>
              </div>
              <dl className={`mb-5 grid gap-x-5 gap-y-4 rounded-2xl p-4 text-xs sm:grid-cols-2 ${bgSurface}`}>
                {[
                  ["Email", profile?.email || user?.email || "—"],
                  ["Verification", profile?.emailVerifiedAt ? "Verified" : "Not verified"],
                  ["CRM customer", profile?.customer?.name || "—"],
                  ["Phone", profile?.customer?.phone || "—"],
                  ["Reminder time zone", profile?.timeZone || "Asia/Kolkata"]
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}>{label}</dt>
                    <dd className="mt-1 break-words font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <form className="space-y-4" onSubmit={saveProfile}>
                <label className="block text-xs font-semibold">
                  Portal display name
                  <input className={`portal-control mt-1.5 ${bgSurface} min-h-11 w-full rounded-xl border px-3 text-sm`} maxLength={120} onChange={(event) => {
                    setProfileName(event.target.value);
                    setProfileNotice("");
                  }} required value={profileName} />
                </label>
                <label className="block text-xs font-semibold">
                  Reminder time zone (IANA)
                  <input
                    className={`portal-control mt-1.5 ${bgSurface} min-h-11 w-full rounded-xl border px-3 text-sm`}
                    list="customer-portal-time-zones"
                    maxLength={100}
                    onChange={(event) => {
                      setProfileTimeZone(event.target.value);
                      setProfileNotice("");
                    }}
                    placeholder="Asia/Kolkata"
                    required
                    value={profileTimeZone}
                  />
                  <datalist id="customer-portal-time-zones">
                    {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "Pacific/Auckland"].map((timeZone) => (
                      <option key={timeZone} value={timeZone} />
                    ))}
                  </datalist>
                  <span className={`mt-1.5 block text-[11px] font-normal ${textMuted}`}>
                    Scheduled reminders arrive at 9:00 AM in this time zone.
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="portal-action min-h-11 rounded-xl bg-[#E50914] px-5 text-xs font-bold text-white disabled:opacity-60" disabled={busy} type="submit">
                    Save profile
                  </button>
                  {profileNotice && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-300">{profileNotice}</p>}
                </div>
              </form>
            </section>
            <section className={`${panelClass} flex flex-col`}>
              <div className="mb-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E50914]">Account security</p>
                <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Change password</h2>
                <p className={`mt-1 text-xs ${textMuted}`}>Use a strong password that you do not use elsewhere.</p>
              </div>
              <form className="flex flex-1 flex-col gap-4" onSubmit={changePassword}>
                <label className="block text-xs font-semibold">
                  Current password
                  <input autoComplete="current-password" className={`mt-1.5 ${bgSurface} min-h-11 w-full rounded-xl border px-3 text-sm`} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} />
                </label>
                <label className="block text-xs font-semibold">
                  New password
                  <input autoComplete="new-password" className={`mt-1.5 ${bgSurface} min-h-11 w-full rounded-xl border px-3 text-sm`} minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />
                </label>
                <label className="block text-xs font-semibold">
                  Confirm new password
                  <input autoComplete="new-password" className={`mt-1.5 ${bgSurface} min-h-11 w-full rounded-xl border px-3 text-sm`} minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
                </label>
                <button className="portal-action mt-auto min-h-11 self-start rounded-xl bg-[#E50914] px-5 text-xs font-bold text-white disabled:opacity-60" disabled={busy} type="submit">
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
