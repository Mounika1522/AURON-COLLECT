import ThemeToggle from './components/ThemeToggle';
import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiRequest } from './services/api';
import { getThemeClasses } from './theme';
import { resolveDashboardDateRange } from './services/dashboard-date-range';
import {
  canAccessOrganizationBillingPortal,
  getApprovedSubscriptionBillingCycles,
  OFFICIAL_SAAS_PLANS,
} from './services/subscription-plans';
import {
  mapCommunication,
  mapCreditAdjustment,
  mapCustomer,
  mapDispute,
  mapInvoice,
  mapPromise,
  mapReceipt,
  mapReminder,
  mapTask,
} from './services/backend-data';
import {
  formatReminderDateTime,
  getIstDateTimeLocalValue,
} from './services/reminder-time';
import {
  canCancelReminder,
  canDeleteReminder,
  canSendReminderNow,
} from './services/reminder-actions';
import AdminSidebar from './components/AdminSidebar';
import AdminHeader from './components/AdminHeader';
import StaffPasswordRecovery from './components/StaffPasswordRecovery';
import AIAssistant from './components/AIAssistant';
import DataTableTools from './components/DataTableTools';
import {
  LayoutDashboard, Users, FileText, Upload, Receipt, Clock,
  ShieldAlert, CheckSquare, Handshake, AlertTriangle, MessageSquare,
  FileSpreadsheet, BarChart3, Plus, CheckCircle2,
  Mail, Send, X,
  Eye, EyeOff, Building2, CreditCard, Download,
  RefreshCw, AlertCircle, DollarSign, Trash2
} from 'lucide-react';

const CustomerAuth = lazy(() => import('./components/CustomerAuth'));
const CustomerPortal = lazy(() => import('./components/CustomerPortal'));
const DashboardCharts = lazy(() => import('./components/DashboardCharts'));
const OrganizationSubscriptionPlans = lazy(
  () => import('./components/OrganizationSubscriptionPlans')
);
const OrganizationCustomerPlanManager = lazy(
  () => import('./components/OrganizationCustomerPlanManager')
);

const todayISO = () => new Date().toISOString().slice(0, 10);
const INITIAL_DASHBOARD_TODAY = todayISO();
const INITIAL_DASHBOARD_MONTH_START = `${INITIAL_DASHBOARD_TODAY.slice(0, 7)}-01`;
const DASHBOARD_UNASSIGNED_EXECUTIVE = '__UNASSIGNED__';

const readStaffPasswordResetToken = () => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.hash.slice(1)).get('staffReset') || '';
};

const removeStaffPasswordResetFragment = () => {
  const url = new URL(window.location.href);
  const parameters = new URLSearchParams(url.hash.slice(1));
  if (!parameters.has('staffReset')) return;
  parameters.delete('staffReset');
  url.hash = parameters.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
};

const formatINR = (num) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(num || 0));
};

const formatDashboardCurrency = (amount, currency) => {
  const value = Number(amount);
  const code = String(currency || '').trim().toUpperCase();
  if (!Number.isFinite(value) || !code) return 'N/A';

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${code} ${value.toFixed(2)}`;
  }
};

const formatDashboardCurrencyBreakdown = (metrics, field) =>
  metrics?.length
    ? metrics
        .map((metric) => formatDashboardCurrency(metric[field], metric.currency))
        .join(' • ')
    : 'N/A';

const formatDashboardRateBreakdown = (metrics) =>
  metrics?.length
    ? metrics
        .map((metric) =>
          `${metric.currency}: ${metric.collectionRate === null ? 'N/A' : `${metric.collectionRate}%`}`,
        )
        .join(' • ')
    : 'N/A';

const formatDashboardDsoBreakdown = (metrics) =>
  metrics?.length
    ? metrics
        .map((metric) =>
          `${metric.currency}: ${metric.dsoDays === null ? 'N/A' : `${metric.dsoDays} days`}`,
        )
        .join(' • ')
    : 'N/A';

function AnimatedOverlay({ open, className, mode = 'dialog', onExited, children }) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const triggerRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    let frameId;
    let timeoutId;

    if (open) {
      if (!wasOpenRef.current) {
        const activeElement = document.activeElement;
        triggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      }
      wasOpenRef.current = true;
      if (!mounted) {
        frameId = window.requestAnimationFrame(() => setMounted(true));
      } else {
        frameId = window.requestAnimationFrame(() => setEntered(true));
      }
    } else if (mounted) {
      if (wasOpenRef.current && triggerRef.current?.isConnected) {
        triggerRef.current.focus();
      }
      triggerRef.current = null;
      wasOpenRef.current = false;
      frameId = window.requestAnimationFrame(() => setEntered(false));
      const exitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
      timeoutId = window.setTimeout(() => {
        setMounted(false);
        onExited?.();
      }, exitDuration);
    } else {
      wasOpenRef.current = false;
    }

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [open, mounted, onExited]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      data-open={entered && open ? 'true' : 'false'}
      data-motion={mode}
      className={`modal-layer ${className}`}
    >
      {children}
    </div>
  );
}

const loadAuronLogo = async () => {
  const response = await fetch('/auron-logo.png');
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;

    reader.readAsDataURL(blob);
  });
};
const createAuronWatermark = async (logoData) => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      ctx.globalAlpha = 0.07;
      ctx.drawImage(img, 0, 0);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = reject;
    img.src = logoData;
  });
};
const downloadReceiptPDF = async (receipt, customer) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  const logoData = await loadAuronLogo();
  const watermark = await createAuronWatermark(logoData);

  // Header
  doc.setFillColor(229, 9, 20);
  doc.rect(0, 0, 210, 35, 'F');

  // Company Logo
  const logoProps = doc.getImageProperties(logoData);
  const logoRatio = logoProps.width / logoProps.height;

  const logoW = logoRatio >= 1 ? 25 : 20;
  const logoH = logoW / logoRatio;

  doc.addImage(logoData, 'PNG', 12, 5, logoW, logoH);

  // Company Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('ALPHA AURON', 43, 17);

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text('OFFICIAL PAYMENT RECEIPT', 43, 25);

  // Watermark
  const wmProps = doc.getImageProperties(watermark);
  const wmRatio = wmProps.width / wmProps.height;
  const wmW = 90;
  const wmH = wmW / wmRatio;

  doc.addImage(
    watermark,
    'PNG',
    (210 - wmW) / 2,
    105,
    wmW,
    wmH
  );

  // Receipt Details
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Receipt Details', 15, 50);

  doc.setFontSize(11);

  const details = [
    ['Receipt ID', receipt.id],
    ['Customer Name', customer?.name || receipt.customerName],
    ['Customer ID', receipt.customerId],
    ['Payment Date', receipt.date],
    ['Payment Mode', receipt.mode],
    ['Transaction Reference', receipt.reference],
    ['Payment Status', receipt.status],
    ['Amount Received', `INR ${Number(receipt.amount).toLocaleString('en-IN')}`]
  ];

  let y = 65;

  details.forEach(([label, value]) => {
    doc.setFont(undefined, 'bold');
    doc.text(`${label}:`, 15, y);

    doc.setFont(undefined, 'normal');
    doc.text(String(value || '-'), 75, y);

    y += 12;
  });

  y += 8;

  doc.setFont(undefined, 'bold');
  doc.text('Invoice Allocations', 15, y);

  y += 10;
  doc.setFontSize(10);

  (receipt.allocations || []).forEach((allocation) => {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }

    doc.text(
      `${allocation.invoiceId} - INR ${Number(allocation.amount).toLocaleString('en-IN')}`,
      15,
      y
    );

    y += 9;
  });

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('ALPHA AURON | Generated by Auron Collect', 15, 280);
  doc.text('Confidential Document', 15, 286);

  doc.save(`${receipt.id}.pdf`);
};
const downloadInvoicePDF = async (invoice, customer, receipts) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  const logoData = await loadAuronLogo();
  const watermark = await createAuronWatermark(logoData);

  // Company Header
  doc.setFillColor(229, 9, 20);
  doc.rect(0, 0, 210, 35, 'F');

  const logoProps = doc.getImageProperties(logoData);
  const logoRatio = logoProps.width / logoProps.height;
  const logoW = 25;
  const logoH = logoW / logoRatio;

  doc.addImage(logoData, 'PNG', 12, 5, logoW, logoH);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('ALPHA AURON', 43, 17);

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text('OFFICIAL INVOICE SUMMARY', 43, 25);

  // Watermark
  const wmProps = doc.getImageProperties(watermark);
  const wmW = 90;
  const wmH = wmW / (wmProps.width / wmProps.height);

  doc.addImage(
    watermark,
    'PNG',
    (210 - wmW) / 2,
    110,
    wmW,
    wmH
  );

  // Invoice Details
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Invoice Details', 15, 50);

  const details = [
    ['Invoice ID', invoice.id],
    ['Customer Name', customer?.name || invoice.customerName],
    ['Customer ID', invoice.customerId],
    ['Invoice Date', invoice.invoiceDate],
    ['Due Date', invoice.dueDate],
    ['Category', invoice.category],
    ['Branch', invoice.branch],
    ['Executive', invoice.executive],
    ['Invoice Amount', `INR ${Number(invoice.totalAmount).toLocaleString('en-IN')}`],
    ['Tax Amount', `INR ${Number(invoice.taxAmount).toLocaleString('en-IN')}`],
    ['Paid Amount', `INR ${Number(invoice.postedPaid || 0).toLocaleString('en-IN')}`],
    ['Approved Credits', `INR ${Number(invoice.approvedCredits || 0).toLocaleString('en-IN')}`],
    ['Outstanding', `INR ${Number(invoice.outstanding || 0).toLocaleString('en-IN')}`],
    ['Status', invoice.derivedStatus]
  ];

  let y = 62;

  details.forEach(([label, value]) => {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(`${label}:`, 15, y);

    doc.setFont(undefined, 'normal');
    doc.text(String(value || '-'), 85, y);

    y += 9;
  });

  y += 8;

  if (y > 265) {
    doc.addPage();
    y = 20;
  }

  doc.setFont(undefined, 'bold');
  doc.text('Payment History', 15, y);

  y += 10;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);

  const payments = receipts.flatMap((r) =>
    (r.allocations || [])
      .filter((a) => a.invoiceId === invoice.id)
      .map((a) => ({
        id: r.id,
        date: r.date,
        mode: r.mode,
        amount: a.amount
      }))
  );

  payments.forEach((p) => {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }

    doc.text(
      `${p.id} | ${p.date} | ${p.mode} | INR ${Number(p.amount).toLocaleString('en-IN')}`,
      15,
      y
    );

    y += 9;
  });

  if (payments.length === 0) {
    doc.text('No payments recorded.', 15, y);
  }

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('ALPHA AURON | Generated by Auron Collect', 15, 280);
  doc.text('Confidential Document', 15, 286);

  doc.save(`${invoice.id}.pdf`);
};

export default function App() {
  // Theme Persistence
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('auron_collect_theme');
      return saved ? saved === 'dark' : true;
    } catch {
      return true;
    }
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    try {
      localStorage.setItem('auron_collect_theme', darkMode ? 'dark' : 'light');
    } catch {}
  }, [darkMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event) => setPrefersReducedMotion(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  // Auth & Portal Mode: 'admin' | 'customer' | 'auth'
  const [portalMode, setPortalMode] = useState('auth');
  const [authTab, setAuthTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('customerReset') || params.has('customerPortal') ? 'customer' : 'staff';
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [staffResetToken, setStaffResetToken] = useState(readStaffPasswordResetToken);
  const [showForgotModal, setShowForgotModal] = useState(
    () => Boolean(readStaffPasswordResetToken()),
  );
  const staffResetFlowRef = useRef(Boolean(readStaffPasswordResetToken()));
  const closeStaffPasswordRecovery = useCallback(() => {
    setShowForgotModal(false);
    setStaffResetToken('');
    removeStaffPasswordResetFragment();
  }, []);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
const [authToken, setAuthToken] = useState('');
  const [customerToken, setCustomerToken] = useState('');
  const [customerUser, setCustomerUser] = useState(null);
  const [customerDarkMode, setCustomerDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('auron_customer_portal_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
    } catch (error) {
      console.error('Unable to read customer portal theme preference:', error);
    }

    return darkMode;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        'auron_customer_portal_theme',
        customerDarkMode ? 'dark' : 'light'
      );
    } catch (error) {
      console.error('Unable to save customer portal theme preference:', error);
    }
  }, [customerDarkMode]);

  // Customer Portal Session
  const [regForm, setRegForm] = useState({
  name: '',
    ownerName: '',
  email: '',
  password: '',
  confirmPassword: ''
});
  // Navigation & UI States
  const [activeModule, setActiveModule] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const handleStaffLogin = async (e) => {
  e.preventDefault();

  if (isLoggingIn) return;

  setIsLoggingIn(true);

  try {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: staffEmail,
        password: staffPassword,
      }),
    });

    localStorage.removeItem('auron_customer_token');
    localStorage.removeItem('auron_customer_user');
    setCustomerToken('');
    setCustomerUser(null);
    localStorage.setItem('auron_collect_token', response.token);
    localStorage.setItem('auron_collect_user', JSON.stringify(response.user));
    setAuthToken(response.token);
    setCurrentRole(response.user.role);
    setCurrentUser(response.user);
    setActiveModule('dashboard');
    setPortalMode('admin');

    showToast(`Welcome, ${response.user.name}!`);
  } catch (error) {
    showToast(error.message || 'Login failed. Please try again.');
  } finally {
    setIsLoggingIn(false);
  }
};
const handleOrganizationRegistration = async (event) => {
  event.preventDefault();
  if (regForm.password !== regForm.confirmPassword) {
    showToast('Passwords do not match.');
    return;
  }

  setIsLoggingIn(true);
  try {
    const response = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: regForm.ownerName.trim(),
        email: regForm.email.trim(),
        password: regForm.password,
        organisationName: regForm.name.trim(),
      }),
    });

    localStorage.removeItem('auron_customer_token');
    localStorage.removeItem('auron_customer_user');
    setCustomerToken('');
    setCustomerUser(null);
    localStorage.setItem('auron_collect_token', response.token);
    localStorage.setItem('auron_collect_user', JSON.stringify(response.user));
    setAuthToken(response.token);
    setCurrentUser(response.user);
    setCurrentRole(response.user.role);
    setActiveModule('dashboard');
    setPortalMode('admin');
    showToast(`Organization account created. Welcome, ${response.user.name}.`);
  } catch (error) {
    console.error('Organization registration API Error:', error);
    showToast(error.message || 'Unable to create organization account.');
  } finally {
    setIsLoggingIn(false);
  }
};
  const [selectedCustomerDrawer, setSelectedCustomerDrawer] = useState(null);
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = useState(false);
  const clearSelectedCustomerDrawer = useCallback(
    () => setSelectedCustomerDrawer(null),
    [setSelectedCustomerDrawer]
  );
  const [backendDashboard, setBackendDashboard] = useState(null);
  const [backendAgeing, setBackendAgeing] = useState(null);
  const [dashboardCurrency, setDashboardCurrency] = useState('INR');
  const [dashboardPeriod, setDashboardPeriod] = useState('This Month');
  const [customDateFrom, setCustomDateFrom] = useState(INITIAL_DASHBOARD_MONTH_START);
  const [customDateTo, setCustomDateTo] = useState(INITIAL_DASHBOARD_TODAY);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [collectionQueue, setCollectionQueue] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [reminderToDelete, setReminderToDelete] = useState(null);
  const [deletingReminderId, setDeletingReminderId] = useState(null);
  const [reminderToSend, setReminderToSend] = useState(null);
  const [reminderEmailPreview, setReminderEmailPreview] = useState(null);
  const [loadingReminderPreviewId, setLoadingReminderPreviewId] = useState(null);
  const [sendingReminderId, setSendingReminderId] = useState(null);
  const [reminderTemplates, setReminderTemplates] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const availableSubscriptionPlans = Array.isArray(subscriptionPlans) ? subscriptionPlans : [];
  const [razorpayBillingConfiguration, setRazorpayBillingConfiguration] = useState({
    available: false,
    mode: null,
  });
  const [subscriptionPlanConfigs, setSubscriptionPlanConfigs] = useState([]);
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [subscriptionUsage, setSubscriptionUsage] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [subscriptionBillingCycle, setSubscriptionBillingCycle] = useState('MONTHLY');
  const approvedSubscriptionBillingCycles = useMemo(
    () => getApprovedSubscriptionBillingCycles(
      Array.isArray(subscriptionPlans) ? subscriptionPlans : []
    ),
    [subscriptionPlans]
  );
  const activeSubscriptionBillingCycle =
    approvedSubscriptionBillingCycles.some((cycle) => cycle.value === subscriptionBillingCycle)
      ? subscriptionBillingCycle
      : 'MONTHLY';
  const [isProcessingBilling, setIsProcessingBilling] = useState(false);
  const [planConfigDrafts, setPlanConfigDrafts] = useState({});
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataLoadError, setDataLoadError] = useState('');
  const [reportData, setReportData] = useState(null);
  const [selectedReport, setSelectedReport] = useState('invoices');
  const [statementData, setStatementData] = useState(null);
  const statementCurrencyEntries = Object.entries(
    statementData?.currencySummaries || {},
  );
  const [statementFromDate, setStatementFromDate] = useState(
    new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)
  );
  const [statementToDate, setStatementToDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [invoiceImportFile, setInvoiceImportFile] = useState(null);
  const [invoiceImportPreview, setInvoiceImportPreview] = useState(null);

  // Dashboard Filters
  const [filterExecutive, setFilterExecutive] = useState('All');
  const dashboardDateRange = useMemo(
    () => resolveDashboardDateRange(
      dashboardPeriod,
      customDateFrom,
      customDateTo,
    ),
    [dashboardPeriod, customDateFrom, customDateTo],
  );
  const dashboardFilterQuery = useMemo(() => {
    if (dashboardDateRange.error) return '';
    const params = new URLSearchParams({
      from: dashboardDateRange.from,
      to: dashboardDateRange.to,
    });
    if (filterExecutive !== 'All') {
      params.set('executive', filterExecutive);
    }
    return `?${params.toString()}`;
  }, [dashboardDateRange, filterExecutive]);
  const updateDashboardPeriod = (period) => {
    const range = resolveDashboardDateRange(period, customDateFrom, customDateTo);
    setIsLoadingDashboard(!range.error);
    setDashboardPeriod(period);
  };
  const updateDashboardCustomFrom = (date) => {
    const range = resolveDashboardDateRange('Custom Range', date, customDateTo);
    setIsLoadingDashboard(!range.error);
    setCustomDateFrom(date);
  };
  const updateDashboardCustomTo = (date) => {
    const range = resolveDashboardDateRange('Custom Range', customDateFrom, date);
    setIsLoadingDashboard(!range.error);
    setCustomDateTo(date);
  };
  const updateDashboardExecutive = (executive) => {
    setIsLoadingDashboard(!dashboardDateRange.error);
    setFilterExecutive(executive);
  };
  // Core Financial Ledger State
  const [customers, setCustomers] = useState([]);
  
  const [invoices, setInvoices] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [verifiedSubscriptionReceipts, setVerifiedSubscriptionReceipts] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [creditNotes, setCreditNotes] = useState([]);
  const [ptps, setPtps] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [commLogs, setCommLogs] = useState([]);
  const [recentAutomatedEmails, setRecentAutomatedEmails] = useState([]);
  const [isLoadingRecentAutomatedEmails, setIsLoadingRecentAutomatedEmails] = useState(false);
  const [recentAutomatedEmailsError, setRecentAutomatedEmailsError] = useState('');

  // Automation Settings
    // Org Setup State
const [orgSettings, setOrgSettings] = useState(() => {
  try {
    const savedSettings = localStorage.getItem('auron_collect_org_settings');

    return savedSettings
      ? { ...{
          companyName: 'Alpha Auron Private Limited',
          gstin: '36AAACA8899L1Z4',
          currency: 'INR (₹)',
          fiscalYear: 'April - March (FY 2026-27)',
          defaultTerms: 'Net 30 Days',
          escalationDays: 15,
          companyEmail: '',
          companyPhone: '',
          companyAddress: '',
          website: '',
          logoUrl: '',
          primaryColor: '#E50914',
          secondaryColor: '#94A3B8',
          sidebarColor: '#102038',
          themeMode: 'dark'
        }, ...JSON.parse(savedSettings) }
      : {
          companyName: 'Alpha Auron Private Limited',
          gstin: '36AAACA8899L1Z4',
          currency: 'INR (₹)',
          fiscalYear: 'April - March (FY 2026-27)',
          defaultTerms: 'Net 30 Days',
          escalationDays: 15,
          companyEmail: '',
          companyPhone: '',
          companyAddress: '',
          website: '',
          logoUrl: '',
          primaryColor: '#E50914',
          secondaryColor: '#94A3B8',
          sidebarColor: '#102038',
          themeMode: 'dark'
        };
  } catch {
    return {
      companyName: 'Alpha Auron Private Limited',
      gstin: '36AAACA8899L1Z4',
      currency: 'INR (₹)',
      fiscalYear: 'April - March (FY 2026-27)',
      defaultTerms: 'Net 30 Days',
      escalationDays: 15,
      companyEmail: '',
      companyPhone: '',
      companyAddress: '',
      website: '',
      logoUrl: '',
      primaryColor: '#E50914',
      secondaryColor: '#94A3B8',
      sidebarColor: '#102038',
      themeMode: 'dark'
    };
  }
});
  // Sync Organisation Theme with Dashboard Theme
useEffect(() => {
  setDarkMode(orgSettings.themeMode === 'dark');
}, [orgSettings.themeMode]);

// Keep Organisation Theme updated from Dashboard toggle
useEffect(() => {
  const currentMode = darkMode ? 'dark' : 'light';

  setOrgSettings((prev) =>
    prev.themeMode === currentMode
      ? prev
      : { ...prev, themeMode: currentMode }
  );
}, [darkMode]);

  // Modals & Forms State
  const [newReceiptModal, setNewReceiptModal] = useState(false);
  const [rcpForm, setRcpForm] = useState({
  customerId: '',
  receiptNumber: '',
  receiptDate: new Date().toISOString().slice(0, 10),
  amount: '',
  mode: 'NEFT / RTGS',
  reference: '',
  allocations: {}
});

  const [newInvoiceModal, setNewInvoiceModal] = useState(false);
  const [newCustomerModal, setNewCustomerModal] = useState(false);
  const [editCustomerModal, setEditCustomerModal] = useState(false);
const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [custForm, setCustForm] = useState({
  customerCode: '',
  name: '',
  type: 'BUSINESS',
  contactPerson: '',
  email: '',
  phone: '',
  billingAddress: '',
  shippingAddress: '',
  taxRegistration: '',
  paymentTerms: '',
  creditLimit: '',
  status: 'ACTIVE',
  riskLevel: 'LOW',
  notes: ''
});
  const [invForm, setInvForm] = useState({
    customerId: '',
    invoiceDate: todayISO(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    totalAmount: ''
  });
  const [taskForm, setTaskForm] = useState({
    title: '',
    customerId: '',
    invoiceId: '',
    dueDate: todayISO(),
    taskType: 'CALL',
    priority: 'MEDIUM',
    assignedExecutive: '',
  });
  const [promiseForm, setPromiseForm] = useState({
    customerId: '',
    invoiceId: '',
    promisedAmount: '',
    promisedDate: todayISO(),
    notes: '',
  });
  const [disputeForm, setDisputeForm] = useState({
    customerId: '',
    invoiceId: '',
    reason: '',
    description: '',
    disputedAmount: '',
    priority: 'MEDIUM',
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    invoiceId: '',
    amount: '',
    reason: '',
    notes: '',
  });
  const [reminderForm, setReminderForm] = useState({
    customerId: '',
    invoiceId: '',
    scheduledFor: '',
    subject: '',
    message: '',
  });
  const [templateForm, setTemplateForm] = useState({
    name: '',
    triggerStage: 'ON_DUE_DATE',
    channel: 'EMAIL',
    subject: '',
    body: '',
  });
  const [communicationForm, setCommunicationForm] = useState({
    customerId: '',
    invoiceId: '',
    channel: 'EMAIL',
    direction: 'OUTBOUND',
    message: '',
    outcome: '',
  });
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showPromiseForm, setShowPromiseForm] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showCommunicationForm, setShowCommunicationForm] = useState(false);
  const [csvImportPreview, setCsvImportPreview] = useState(false);
  const [statementCustomerId, setStatementCustomerId] = useState('');
  const [activePlan, setActivePlan] = useState('');

  useEffect(() => {
    if (staffResetFlowRef.current) removeStaffPasswordResetFragment();
  }, []);

  useEffect(() => {
    const hasOpenLayer = showForgotModal || newReceiptModal || newInvoiceModal ||
      newCustomerModal || editCustomerModal || showTaskForm || showPromiseForm ||
      showDisputeForm || showAdjustmentForm || showReminderForm || showTemplateForm ||
      showCommunicationForm || isCustomerDrawerOpen;
    if (!hasOpenLayer) return undefined;

    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (editCustomerModal) setEditCustomerModal(false);
      else if (showCommunicationForm) setShowCommunicationForm(false);
      else if (showTemplateForm) setShowTemplateForm(false);
      else if (showReminderForm) setShowReminderForm(false);
      else if (showAdjustmentForm) setShowAdjustmentForm(false);
      else if (showDisputeForm) setShowDisputeForm(false);
      else if (showPromiseForm) setShowPromiseForm(false);
      else if (showTaskForm) setShowTaskForm(false);
      else if (newInvoiceModal) setNewInvoiceModal(false);
      else if (newReceiptModal) setNewReceiptModal(false);
      else if (newCustomerModal) setNewCustomerModal(false);
      else if (isCustomerDrawerOpen) setIsCustomerDrawerOpen(false);
      else if (showForgotModal) closeStaffPasswordRecovery();
      else return;

      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [
    showForgotModal,
    newReceiptModal,
    newInvoiceModal,
    newCustomerModal,
    editCustomerModal,
    showTaskForm,
    showPromiseForm,
    showDisputeForm,
    showAdjustmentForm,
    showReminderForm,
    showTemplateForm,
    showCommunicationForm,
    isCustomerDrawerOpen,
    closeStaffPasswordRecovery
  ]);

  // AI Assistant State
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState([
    {
      sender: 'ai',
      text: 'Hello! I am Auron AI, grounded directly in your live ledger. Ask me about overdue balances, customer statements, broken promises, or trigger reminder dispatches.'
    }
  ]);

  const showToast = (msg, type = 'default') => {
    setToastMessage({ message: msg, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleStaffPasswordResetSuccess = () => {
    localStorage.removeItem('auron_collect_token');
    localStorage.removeItem('auron_collect_user');
    setAuthToken('');
    setCurrentUser(null);
    setCurrentRole('');
    setStaffPassword('');
    setAuthTab('staff');
    setPortalMode('auth');
    closeStaffPasswordRecovery();
    showToast('Your password was reset. Sign in with your new password.');
  };

  const handleStaffPasswordChanged = (token) => {
    localStorage.setItem('auron_collect_token', token);
    setAuthToken(token);
    showToast('Password updated. Other active sessions were signed out.');
  };

  const handleCustomerLogin = (response) => {
    localStorage.removeItem('auron_collect_token');
    localStorage.removeItem('auron_collect_user');
    localStorage.setItem('auron_customer_token', response.token);
    localStorage.setItem('auron_customer_user', JSON.stringify(response.user));
    setAuthToken('');
    setCurrentUser(null);
    setCurrentRole('');
    setCustomerToken(response.token);
    setCustomerUser(response.user);
    setActiveModule('dashboard');
    setPortalMode('customer');
  };

  const clearCustomerSession = (message) => {
    localStorage.removeItem('auron_customer_token');
    localStorage.removeItem('auron_customer_user');
    setCustomerToken('');
    setCustomerUser(null);
    setPortalMode('auth');
    setAuthTab('customer');
    if (message) showToast(message);
  };

  useEffect(() => {
    if (staffResetFlowRef.current) return undefined;
    const savedToken = localStorage.getItem('auron_collect_token');
    if (!savedToken) return undefined;

    let active = true;

    const validateSavedSession = async () => {
      try {
        const response = await apiRequest('/api/auth/profile', {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        const profile = response.user;

        if (!profile?.userId || !profile?.organisationId) {
          const error = new Error('The backend returned an invalid user profile.');
          error.status = 401;
          throw error;
        }

        if (!active) return;

        const user = {
          id: profile.userId,
          name: profile.name,
          email: profile.email,
          role: profile.role,
          organisationId: profile.organisationId,
        };

        localStorage.setItem('auron_collect_user', JSON.stringify(user));
        setCurrentUser(user);
        setCurrentRole(user.role);
        setAuthToken(savedToken);
        setPortalMode('admin');
      } catch (error) {
        if (!active) return;

        if (error.status === 401) {
          localStorage.removeItem('auron_collect_token');
          localStorage.removeItem('auron_collect_user');
          setCurrentUser(null);
          setCurrentRole('');
          showToast('Your saved session is invalid or expired. Please sign in again.');
          return;
        }

        console.error('Saved session validation failed:', error);
        showToast('Unable to verify your saved session. Check the backend connection and sign in again.');
      }
    };

    validateSavedSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (staffResetFlowRef.current) return undefined;
    if (localStorage.getItem('auron_collect_token')) return undefined;
    const savedToken = localStorage.getItem('auron_customer_token');
    if (!savedToken) return undefined;

    let active = true;
    const validateCustomerSession = async () => {
      try {
        const response = await apiRequest('/api/customer-portal/profile', {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (!response.profile?.emailVerifiedAt) {
          const error = new Error('Customer email verification is required.');
          error.status = 401;
          throw error;
        }
        if (!active) return;

        let savedUser = {};
        try {
          savedUser = JSON.parse(localStorage.getItem('auron_customer_user') || '{}');
        } catch {
          savedUser = {};
        }
        const user = {
          ...savedUser,
          accountId: response.profile.id,
          fullName: response.profile.fullName,
          email: response.profile.email,
        };
        localStorage.setItem('auron_customer_user', JSON.stringify(user));
        setCustomerUser(user);
        setCustomerToken(savedToken);
        setPortalMode('customer');
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          localStorage.removeItem('auron_customer_token');
          localStorage.removeItem('auron_customer_user');
          showToast('Your customer session has expired or is no longer active. Please sign in again.');
        } else {
          console.error('Saved customer session validation failed:', error);
          showToast('Unable to verify your customer session. Check the backend connection and sign in again.');
        }
      }
    };

    validateCustomerSession();
    return () => {
      active = false;
    };
  }, []);

  const reportLoadFailure = (resource, error) => {
    console.error(`${resource} API Error:`, error);
    setDataLoadError(`${resource} could not be loaded. Check the backend connection and refresh.`);
  };

  const refreshRecentAutomatedEmails = async () => {
    setIsLoadingRecentAutomatedEmails(true);
    try {
      const response = await apiRequest('/api/admin-notifications/recent-email-reminders', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setRecentAutomatedEmails(response.emailReminders || []);
      setRecentAutomatedEmailsError('');
    } catch (error) {
      setRecentAutomatedEmailsError(error.message || 'Unable to load automated email history.');
      throw error;
    } finally {
      setIsLoadingRecentAutomatedEmails(false);
    }
  };

  const refreshPortfolioSummaries = async () => {
    if (dashboardDateRange.error) {
      return;
    }

    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [dashboard, ageing, queue] = await Promise.all([
        apiRequest(`/api/dashboard${dashboardFilterQuery}`, { headers }),
        apiRequest(`/api/ageing${dashboardFilterQuery}`, { headers }),
        apiRequest(`/api/collections/queue${dashboardFilterQuery}`, { headers }),
      ]);
      setBackendDashboard(dashboard.dashboard || null);
      setBackendAgeing(ageing);
      setCollectionQueue(queue.queue || []);
    } catch (error) {
      reportLoadFailure('Portfolio summaries', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auron_collect_token');
    localStorage.removeItem('auron_collect_user');
    localStorage.removeItem('auron_customer_token');
    localStorage.removeItem('auron_customer_user');
    setAuthToken('');
    setCurrentUser(null);
    setCurrentRole('');
    setCustomerToken('');
    setCustomerUser(null);
    setCustomers([]);
    setInvoices([]);
    setReceipts([]);
    setVerifiedSubscriptionReceipts([]);
    setCreditNotes([]);
    setPtps([]);
    setDisputes([]);
    setTasks([]);
    setCommLogs([]);
    setRecentAutomatedEmails([]);
    setCollectionQueue([]);
    setReminders([]);
    setReminderTemplates([]);
    setSubscriptionPlans([]);
    setRazorpayBillingConfiguration({ available: false, mode: null });
    setSubscriptionPlanConfigs([]);
    setCurrentSubscription(null);
    setSubscriptionUsage(null);
    setBillingHistory([]);
    setPlanConfigDrafts({});
    setBackendDashboard(null);
    setBackendAgeing(null);
    setReportData(null);
    setStatementData(null);
    setDataLoadError('');
    setPortalMode('auth');
  };

  // --- SINGLE SOURCE OF TRUTH: DETERMINISTIC INVOICE LEDGER ENGINE ---
    const enrichedInvoices = useMemo(() => {
    return invoices.map((inv) => {
      const postedPaid = receipts
        .filter((receipt) =>
          receipt.status === 'Posted' && receipt.currency === inv.currency
        )
        .flatMap((receipt) => receipt.allocations || [])
        .filter((allocation) =>
          allocation.invoiceId === inv.id &&
          allocation.status === 'POSTED' &&
          !allocation.reversedAt
        )
        .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);

      // Sum approved credit notes
      const approvedCredits = creditNotes
        .filter((cn) => cn.status === 'Approved' && cn.invoiceId === inv.id)
        .reduce((sum, cn) => sum + Number(cn.amount), 0);

      const outstanding = Math.max(0, Number((inv.totalAmount - postedPaid - approvedCredits).toFixed(2)));
      const due = new Date(inv.dueDate);
      const today = new Date();
      const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const utcDue = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
      const diffTime = utcToday - utcDue;
      const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));

           let derivedStatus = 'Draft';

      if (inv.status === 'CANCELLED') {
        derivedStatus = 'Cancelled';
      } else if (inv.status === 'WRITTEN_OFF') {
        derivedStatus = 'Written Off';
      } else if (outstanding === 0) {
        derivedStatus = 'Paid';
      } else if (daysOverdue > 0 && inv.status !== 'DRAFT') {
        derivedStatus = 'Overdue';
      } else if (postedPaid > 0 || approvedCredits > 0) {
        derivedStatus = 'Partially Paid';
      } else if (inv.status === 'ISSUED') {
        derivedStatus = 'Issued';
      }

      let bucket = 'Not Yet Due';

      if (outstanding > 0 && daysOverdue > 0) {
        if (daysOverdue <= 30) bucket = '1-30 Days';
        else if (daysOverdue <= 60) bucket = '31-60 Days';
        else if (daysOverdue <= 90) bucket = '61-90 Days';
        else bucket = '>90 Days';
      }

      return {
        ...inv,
        postedPaid,
        approvedCredits,
        outstanding,
        daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
        derivedStatus,
        bucket
      };
    });
  }, [invoices, receipts, creditNotes]);

  // --- ENRICHED PTP ENGINE (AUTO-COMPARES AGAINST POSTED ALLOCATIONS) ---
  const enrichedPtps = useMemo(() => {
    return ptps.map((ptp) => {
      const inv = enrichedInvoices.find((i) => i.id === ptp.invoiceId);
      const paidSincePtp = receipts
        .filter((r) =>
          r.status === 'Posted' &&
          r.currency === ptp.currency &&
          r.dateTime >= ptp.createdAt
        )
        .reduce((sum, r) => {
          const validAmount = (r.allocations || [])
            .filter((allocation) =>
              allocation.invoiceId === ptp.invoiceId &&
              allocation.status === 'POSTED' &&
              !allocation.reversedAt
            )
            .reduce((total, allocation) => total + Number(allocation.amount || 0), 0);
          return sum + validAmount;
        }, 0);

      let status = ptp.status;
      if (status === 'KEPT' || paidSincePtp >= ptp.promisedAmount || (inv && inv.outstanding === 0)) {
        status = 'Fulfilled';
      } else if (status === 'CANCELLED') {
        status = 'Cancelled';
      } else if (status === 'BROKEN') {
        status = 'Broken';
      } else if (paidSincePtp > 0) {
        status = 'Partially Fulfilled';
      } else if (new Date(ptp.promisedDate) < new Date()) {
        status = 'Broken';
      } else {
        status = 'Open';
      }

      return { ...ptp, paidSincePtp, status };
    });
  }, [ptps, receipts, enrichedInvoices]);
  // Fetch Dashboard Data from Backend
useEffect(() => {
  if (!authToken) return;

  if (dashboardDateRange.error) {
    return;
  }

  let active = true;
  const headers = { Authorization: `Bearer ${authToken}` };
  Promise.all([
    apiRequest(`/api/dashboard${dashboardFilterQuery}`, { headers }),
    apiRequest(`/api/ageing${dashboardFilterQuery}`, { headers }),
    apiRequest(`/api/collections/queue${dashboardFilterQuery}`, { headers }),
  ])
    .then(([dashboard, ageing, queue]) => {
      if (!active) return;
      setBackendDashboard(dashboard.dashboard || null);
      setBackendAgeing(ageing);
      setCollectionQueue(queue.queue || []);
    })
    .catch((error) => {
      if (active) {
        setBackendDashboard(null);
        setBackendAgeing(null);
        setCollectionQueue([]);
        reportLoadFailure('Filtered dashboard', error);
      }
    })
    .finally(() => {
      if (active) setIsLoadingDashboard(false);
    });

  return () => {
    active = false;
  };
}, [authToken, dashboardFilterQuery, dashboardDateRange.error]);
  // Fetch Customers from Backend
  useEffect(() => {
    if (!authToken) return;

    const fetchCustomers = async () => {
      try {
        const response = await apiRequest('/api/customers', {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        const mappedCustomers = (response.customers || []).map(mapCustomer);

        setCustomers(mappedCustomers);
        setStatementCustomerId((current) => current || mappedCustomers[0]?.id || '');

setRcpForm((prev) => ({
  ...prev,
  customerId: mappedCustomers[0]?.id || '',
  allocations: {},
}));

      } catch (error) {
        reportLoadFailure('Customers', error);
      }
    };

    fetchCustomers();
  }, [authToken]);
  // Fetch Invoices from Backend
  useEffect(() => {
    if (!authToken) return;

    const fetchInvoices = async () => {
      try {
        const response = await apiRequest('/api/invoices', {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        const mappedInvoices = (response.invoices || []).map(mapInvoice);

        setInvoices(mappedInvoices);
      } catch (error) {
        reportLoadFailure('Invoices', error);
      }
    };

    fetchInvoices();
  }, [authToken]);
    // Fetch Receipts from Backend
  useEffect(() => {
    if (!authToken) return;

    const fetchReceipts = async () => {
      try {
        const response = await apiRequest('/api/receipts', {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        const mappedReceipts = (response.receipts || []).map(mapReceipt);

        setReceipts(mappedReceipts);
      } catch (error) {
        reportLoadFailure('Receipts', error);
      }
    };

    fetchReceipts();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchVerifiedSubscriptionReceipts = async () => {
      try {
        const response = await apiRequest('/api/receipts/customer-subscriptions', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        setVerifiedSubscriptionReceipts(response.receipts || []);
      } catch (error) {
        reportLoadFailure('Verified subscription receipts', error);
      }
    };

    fetchVerifiedSubscriptionReceipts();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchPromises = async () => {
      try {
        const response = await apiRequest('/api/promises', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const mappedPromises = (response.promises || []).map(mapPromise);

        setPtps(mappedPromises);
      } catch (error) {
        reportLoadFailure('Promises', error);
      }
    };

    fetchPromises();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchDisputes = async () => {
      try {
        const response = await apiRequest('/api/disputes', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const mappedDisputes = (response.disputes || []).map(mapDispute);

        setDisputes(mappedDisputes);
      } catch (error) {
        reportLoadFailure('Disputes', error);
      }
    };

    fetchDisputes();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchTasks = async () => {
      try {
        const response = await apiRequest('/api/tasks', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const mappedTasks = (response.tasks || []).map(mapTask);

        setTasks(mappedTasks);
      } catch (error) {
        reportLoadFailure('Tasks', error);
      }
    };

    fetchTasks();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchCreditAdjustments = async () => {
      try {
        const response = await apiRequest('/api/credit-adjustments', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const mappedCreditNotes = (response.adjustments || []).map(mapCreditAdjustment);

        setCreditNotes(mappedCreditNotes);
      } catch (error) {
        reportLoadFailure('Credit adjustments', error);
      }
    };

    fetchCreditAdjustments();
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;

    const fetchCommunications = async () => {
      try {
        const response = await apiRequest('/api/communications', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        const mappedLogs = (response.communications || []).map(mapCommunication);

        setCommLogs(mappedLogs);
      } catch (error) {
        reportLoadFailure('Communications', error);
      }
    };

    fetchCommunications();
  }, [authToken]);

  useEffect(() => {
    if (!authToken || activeModule !== 'dashboard') return undefined;
    let active = true;
    const fetchAutomatedEmails = async () => {
      setIsLoadingRecentAutomatedEmails(true);
      try {
        const response = await apiRequest('/api/admin-notifications/recent-email-reminders', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (active) {
          setRecentAutomatedEmails(response.emailReminders || []);
          setRecentAutomatedEmailsError('');
        }
      } catch (error) {
        if (active) {
          console.error('Automated email history API Error:', error);
          setRecentAutomatedEmailsError(error.message || 'Unable to load automated email history.');
        }
      } finally {
        if (active) setIsLoadingRecentAutomatedEmails(false);
      }
    };

    fetchAutomatedEmails();
    const intervalId = window.setInterval(fetchAutomatedEmails, 60_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [authToken, activeModule]);

  useEffect(() => {
    if (!authToken) return;

    let active = true;
    setIsLoadingData(true);

    const loadAuxiliaryData = async () => {
      const requests = [
        apiRequest('/api/reminders', {
          headers: { Authorization: `Bearer ${authToken}` },
        }).then((response) => {
          if (active) setReminders((response.reminders || []).map(mapReminder));
        }),
        apiRequest('/api/reminders/templates', {
          headers: { Authorization: `Bearer ${authToken}` },
        }).then((response) => {
          if (active) setReminderTemplates(response.templates || []);
        }),
        apiRequest('/api/subscriptions/plans', {
          headers: { Authorization: `Bearer ${authToken}` },
        }).then((response) => {
          if (!Array.isArray(response?.plans)) {
            throw new TypeError('Subscription plans API returned an invalid response.');
          }
          if (active) {
            setSubscriptionPlans(response.plans);
            const mode = response.billingConfiguration?.mode;
            const available =
              response.billingConfiguration?.available === true &&
              (mode === 'test' || mode === 'live');
            setRazorpayBillingConfiguration({
              available,
              mode: available ? mode : null,
            });
          }
        }),
      ];

      if (currentRole === 'SUPER_ADMIN') {
        requests.push(
          apiRequest('/api/subscriptions/plans/configuration', {
            headers: { Authorization: `Bearer ${authToken}` },
          }).then((response) => {
            if (!Array.isArray(response?.plans)) {
              throw new TypeError('Subscription plan configuration API returned an invalid response.');
            }
            if (active) {
              const plans = response.plans;
              setSubscriptionPlanConfigs(plans);
              setPlanConfigDrafts(Object.fromEntries(plans.map((plan) => [
                plan.code,
                {
                  proposedMonthlyPrice: plan.proposedMonthlyPrice ?? '',
                  proposedYearlyPrice: plan.proposedYearlyPrice ?? '',
                  proposedMaxUsers: plan.proposedMaxUsers ?? '',
                  proposedMaxCustomers: plan.proposedMaxCustomers ?? '',
                  proposedMaxInvoicesPerMonth: plan.proposedMaxInvoicesPerMonth ?? '',
                },
              ])));
            }
          }),
        );
      }

      const results = await Promise.allSettled(requests);
      const failedRequests = results.filter((result) => result.status === 'rejected');

      if (active && failedRequests.length) {
        failedRequests.forEach((result) => console.error('Backend data request failed:', result.reason));
        setDataLoadError('Some data could not be loaded. Check the backend connection and refresh.');
      }

      if (active) setIsLoadingData(false);
    };

    const loadSubscription = async () => {
      try {
        const historyResponse = await apiRequest('/api/subscriptions/billing/history', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!Array.isArray(historyResponse?.invoices)) {
          throw new TypeError('Subscription billing history API returned an invalid response.');
        }
        if (active) setBillingHistory(historyResponse.invoices);
      } catch (error) {
        if (active) {
          console.error('Billing history request failed:', error);
          setBillingHistory([]);
          setDataLoadError('Subscription billing history could not be loaded. Check the backend connection and refresh.');
        }
      }

      try {
        const [subscriptionResponse, usageResponse] = await Promise.all([
          apiRequest('/api/subscriptions/current', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
          apiRequest('/api/subscriptions/usage', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ]);
        if (active) {
          const subscription = subscriptionResponse?.subscription;
          setCurrentSubscription(
            subscription && typeof subscription === 'object' && !Array.isArray(subscription)
              ? subscription
              : null
          );
          setActivePlan(subscription?.plan?.name || '');
          const usage = usageResponse?.usage;
          setSubscriptionUsage(
            usage && typeof usage === 'object' && !Array.isArray(usage)
              ? usage
              : null
          );
        }
      } catch (error) {
        if (!active) return;
        setCurrentSubscription(null);
        setSubscriptionUsage(null);
        if (error.status !== 404) {
          console.error('Subscription data request failed:', error);
          setDataLoadError('Subscription details could not be loaded. Check the backend connection and refresh.');
        }
      }
    };

    loadAuxiliaryData();
    loadSubscription();

    return () => {
      active = false;
    };
  }, [authToken, currentRole]);

  const visibleDashboard = dashboardDateRange.error || isLoadingDashboard || isLoadingData
    ? null
    : backendDashboard;
  const visibleAgeing = dashboardDateRange.error || isLoadingDashboard || isLoadingData
    ? null
    : backendAgeing;

  const dashboardCurrencies = useMemo(() => {
    const values = [
      ...(visibleDashboard?.currencies || []).map((item) => item.currency),
      ...(visibleAgeing?.currencySummaries || []).map((item) => item.currency),
    ];
    return [...new Set(values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }, [visibleDashboard, visibleAgeing]);

  const dashboardExecutives = useMemo(() => {
    const assigned = [...new Set(
      invoices
        .map((invoice) => invoice.assignedExecutive)
        .filter((executive) => typeof executive === 'string' && executive.trim()),
    )].sort((left, right) => left.trim().localeCompare(right.trim()));
    const hasUnassigned = invoices.some((invoice) =>
      invoice.assignedExecutive === null ||
      invoice.assignedExecutive === undefined ||
      invoice.assignedExecutive === '',
    );
    return { assigned, hasUnassigned };
  }, [invoices]);

  const selectedDashboardCurrency = dashboardCurrencies.includes(dashboardCurrency)
    ? dashboardCurrency
    : dashboardCurrencies[0] || '';

  const kpis = useMemo(() => ({
    currencies: visibleDashboard?.currencies || [],
    promisesDue: visibleDashboard?.promisesDueInRange ?? null,
    brokenPromises: visibleDashboard?.brokenPromises ?? null,
  }), [visibleDashboard]);

  // --- AGEING DISTRIBUTION DATA ---
  const ageingChartData = useMemo(() => {
    const summary = visibleAgeing?.currencySummaries?.find(
      (item) => item.currency === selectedDashboardCurrency,
    )?.summary;
    if (!summary) return [];

    return [
      { name: 'Not Yet Due', amount: Number(summary.current?.amount || 0) },
      { name: '1-30 Days', amount: Number(summary.days1to30?.amount || 0) },
      { name: '31-60 Days', amount: Number(summary.days31to60?.amount || 0) },
      { name: '61-90 Days', amount: Number(summary.days61to90?.amount || 0) },
      { name: '>90 Days', amount: Number(summary.days90plus?.amount || 0) },
    ];
  }, [visibleAgeing, selectedDashboardCurrency]);

  const dashboardTrendData = useMemo(() => {
    const selected = visibleDashboard?.trend?.find(
      (item) => item.currency === selectedDashboardCurrency,
    );
    return (selected?.buckets || []).map((bucket) => ({
      month: bucket.label,
      billed: Number(bucket.billed),
      collected: Number(bucket.collected),
    }));
  }, [visibleDashboard, selectedDashboardCurrency]);

  // --- COLLECTION PRIORITY SCORE QUEUE ---
  const priorityQueue = useMemo(() => {
    return (dashboardDateRange.error || isLoadingDashboard || isLoadingData ? [] : collectionQueue).map((item) => ({
      id: item.invoiceId,
      name: item.customerName,
      executive: item.assignedExecutive || '',
      currency: item.currency,
      overdueAmt: Number(item.outstandingAmount || 0),
      maxDays: Number(item.overdueDays || 0),
      hasBrokenPtp: Number(item.scoringFactors?.promiseFailureScore || 0) > 0,
      priorityScore: Number(item.priorityScore || 0),
      invoiceNumber: item.invoiceNumber,
      priority: item.priority,
      customerRiskLevel: item.customerRiskLevel,
    }));
  }, [collectionQueue, dashboardDateRange.error, isLoadingDashboard, isLoadingData]);

  // --- ACTIONS & HANDLERS ---
  const handleCreateCustomer = async (e) => {
  e.preventDefault();

  if (!custForm.name.trim()) {
    showToast('Customer name is required.');
    return;
  }

  try {
    const response = await apiRequest('/api/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        ...custForm,
        customerCode: custForm.customerCode.trim() || null,
        creditLimit: custForm.creditLimit
          ? Number(custForm.creditLimit)
          : null,
      }),
    });

    const createdCustomer = mapCustomer(response.customer);
    setCustomers((previous) => [
      createdCustomer,
      ...previous.filter((customer) => customer.id !== createdCustomer.id),
    ]);

    setNewCustomerModal(false);

    setCustForm({
      customerCode: '',
      name: '',
      type: 'BUSINESS',
      contactPerson: '',
      email: '',
      phone: '',
      billingAddress: '',
      shippingAddress: '',
      taxRegistration: '',
      paymentTerms: '',
      creditLimit: '',
      status: 'ACTIVE',
      riskLevel: 'LOW',
      notes: '',
    });

    try {
      const customersResponse = await apiRequest('/api/customers', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const mappedCustomers = (
        Array.isArray(customersResponse)
          ? customersResponse
          : customersResponse.customers || []
      ).map(mapCustomer);

      setCustomers(mappedCustomers);
      showToast('Customer created successfully!');
    } catch (refreshError) {
      console.error('Refresh customers after creation failed:', refreshError);
      showToast('Customer was created, but the list could not be refreshed.');
    }
  } catch (error) {
    console.error('Create Customer API Error:', error);
    showToast(error.message || 'Unable to create customer.');
  }
};
const handleUpdateCustomer = async (e) => {
  e.preventDefault();

  if (!custForm.name.trim()) {
    showToast('Customer name is required.');
    return;
  }

  try {
    const response = await apiRequest(`/api/customers/${editingCustomerId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        ...custForm,
        creditLimit: custForm.creditLimit
          ? Number(custForm.creditLimit)
          : null,
      }),
    });

    const customer = response.customer;

    const updatedCustomer = mapCustomer(customer);

    setCustomers((prev) =>
      prev.map((c) =>
        c.id === editingCustomerId ? updatedCustomer : c
      )
    );

    setSelectedCustomerDrawer(updatedCustomer);
    setEditCustomerModal(false);
    setEditingCustomerId(null);

    showToast('Customer updated successfully!');
  } catch (error) {
    console.error('Update Customer API Error:', error);
    showToast(error.message || 'Unable to update customer.');
  }
};

const handleDeleteCustomer = async (customer) => {
  if (!window.confirm(`Delete ${customer.name}? This can fail if the customer has linked records.`)) {
    return;
  }

  try {
    await apiRequest(`/api/customers/${customer.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });

    setCustomers((previous) => previous.filter((item) => item.id !== customer.id));
    setInvoices((previous) => previous.filter((item) => item.customerId !== customer.id));
    setReceipts((previous) => previous.filter((item) => item.customerId !== customer.id));
    setIsCustomerDrawerOpen(false);
    showToast('Customer deleted successfully.');
  } catch (error) {
    console.error('Delete customer API Error:', error);
    showToast(error.message || 'Unable to delete customer.');
  }
};

const handleDeleteInvoice = async (invoice) => {
  if (!window.confirm(`Delete draft invoice ${invoice.invoiceNumber}?`)) return;

  try {
    await apiRequest(`/api/invoices/${invoice.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });

    setInvoices((previous) => previous.filter((item) => item.id !== invoice.id));
    setSelectedInvoice(null);
    showToast('Invoice deleted successfully.');
  } catch (error) {
    console.error('Delete invoice API Error:', error);
    showToast(error.message || 'Unable to delete invoice.');
  }
};

const handleCreateTask = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        ...taskForm,
        invoiceId: taskForm.invoiceId || undefined,
      }),
    });
    setTasks((previous) => [mapTask(response.task), ...previous]);
    setTaskForm({
      title: '',
      customerId: '',
      invoiceId: '',
      dueDate: todayISO(),
      taskType: 'CALL',
      priority: 'MEDIUM',
      assignedExecutive: '',
    });
    setShowTaskForm(false);
    await refreshPortfolioSummaries();
    showToast('Task created successfully.');
  } catch (error) {
    console.error('Create task API Error:', error);
    showToast(error.message || 'Unable to create task.');
  }
};

const handleCompleteTask = async (task) => {
  try {
    const response = await apiRequest(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    const updatedTask = mapTask(response.task);
    setTasks((previous) => previous.map((item) => item.id === task.id ? updatedTask : item));
    await refreshPortfolioSummaries();
    showToast('Task marked complete.');
  } catch (error) {
    console.error('Update task API Error:', error);
    showToast(error.message || 'Unable to update task.');
  }
};

const handleCreatePromise = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/promises', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(promiseForm),
    });
    setPtps((previous) => [mapPromise(response.promise), ...previous]);
    setPromiseForm({
      customerId: '',
      invoiceId: '',
      promisedAmount: '',
      promisedDate: todayISO(),
      notes: '',
    });
    setShowPromiseForm(false);
    await refreshPortfolioSummaries();
    showToast('Promise-to-Pay recorded.');
  } catch (error) {
    console.error('Create promise API Error:', error);
    showToast(error.message || 'Unable to record Promise-to-Pay.');
  }
};

const handlePromiseStatus = async (promise, status) => {
  try {
    const response = await apiRequest(`/api/promises/${promise.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status }),
    });
    const updatedPromise = mapPromise(response.promise);
    setPtps((previous) => previous.map((item) => item.id === promise.id ? updatedPromise : item));
    await refreshPortfolioSummaries();
    showToast(`Promise status updated to ${status.toLowerCase()}.`);
  } catch (error) {
    console.error('Update promise API Error:', error);
    showToast(error.message || 'Unable to update Promise-to-Pay.');
  }
};

const handleCreateDispute = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/disputes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        ...disputeForm,
        disputedAmount: disputeForm.disputedAmount || undefined,
      }),
    });
    setDisputes((previous) => [mapDispute(response.dispute), ...previous]);
    setDisputeForm({
      customerId: '',
      invoiceId: '',
      reason: '',
      description: '',
      disputedAmount: '',
      priority: 'MEDIUM',
    });
    setShowDisputeForm(false);
    await refreshPortfolioSummaries();
    showToast('Dispute recorded.');
  } catch (error) {
    console.error('Create dispute API Error:', error);
    showToast(error.message || 'Unable to create dispute.');
  }
};

const handleResolveDispute = async (dispute) => {
  const resolution = window.prompt('Enter the dispute resolution:');
  if (!resolution?.trim()) return;

  try {
    const response = await apiRequest(`/api/disputes/${dispute.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ resolution: resolution.trim() }),
    });
    const updatedDispute = mapDispute(response.dispute);
    setDisputes((previous) => previous.map((item) => item.id === dispute.id ? updatedDispute : item));
    await refreshPortfolioSummaries();
    showToast('Dispute resolved.');
  } catch (error) {
    console.error('Resolve dispute API Error:', error);
    showToast(error.message || 'Unable to resolve dispute.');
  }
};

const handleCreateAdjustment = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/credit-adjustments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(adjustmentForm),
    });
    setCreditNotes((previous) => [mapCreditAdjustment(response.adjustment), ...previous]);
    setAdjustmentForm({ invoiceId: '', amount: '', reason: '', notes: '' });
    setShowAdjustmentForm(false);
    showToast('Credit adjustment submitted for approval.');
  } catch (error) {
    console.error('Create credit adjustment API Error:', error);
    showToast(error.message || 'Unable to create credit adjustment.');
  }
};

const handleAdjustmentDecision = async (adjustment, decision) => {
  const body = decision === 'reject'
    ? { rejectionReason: window.prompt('Reason for rejecting this adjustment:') || '' }
    : undefined;
  if (decision === 'reject' && !body.rejectionReason.trim()) return;

  try {
    const response = await apiRequest(`/api/credit-adjustments/${adjustment.id}/${decision}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      ...(body && { body: JSON.stringify(body) }),
    });
    const updatedAdjustment = mapCreditAdjustment(response.adjustment);
    setCreditNotes((previous) => previous.map((item) =>
      item.id === adjustment.id ? updatedAdjustment : item
    ));
    await refreshPortfolioSummaries();
    showToast(`Credit adjustment ${decision === 'approve' ? 'approved' : 'rejected'}.`);
  } catch (error) {
    console.error('Credit adjustment decision API Error:', error);
    showToast(error.message || `Unable to ${decision} credit adjustment.`);
  }
};

const openReminderForm = (details = {}) => {
  setReminderForm((previous) => ({
    ...previous,
    ...details,
    scheduledFor: getIstDateTimeLocalValue(),
  }));
  setShowReminderForm(true);
};

const handleCreateReminder = async (event) => {
  event.preventDefault();
  try {
    const customer = customers.find((item) => item.id === reminderForm.customerId);
    const invoice = invoices.find((item) => item.id === reminderForm.invoiceId);
    if (!customer?.email || !invoice) {
      showToast('Choose an invoice with a customer email address.');
      return;
    }

    const response = await apiRequest('/api/reminders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        ...reminderForm,
        channel: 'EMAIL',
        scheduledFor: reminderForm.scheduledFor,
        dedupeKey: `manual:${invoice.id}:${reminderForm.scheduledFor}`,
        subject: reminderForm.subject || `Payment reminder: ${invoice.invoiceNumber}`,
        message: reminderForm.message || `Payment reminder for invoice ${invoice.invoiceNumber}. Outstanding balance: ${formatINR(enrichedInvoices.find((item) => item.id === invoice.id)?.outstanding || 0)}. Due date: ${invoice.dueDate}.`,
      }),
    });
    setReminders((previous) => [...previous, mapReminder(response.reminder)]);
    setShowReminderForm(false);
    showToast('Email reminder scheduled. Delivery status will update after processing.');
  } catch (error) {
    console.error('Create reminder API Error:', error);
    showToast(error.message || 'Unable to schedule reminder.');
  }
};

const handleReminderStatus = async (reminder, status) => {
  try {
    const response = await apiRequest(`/api/reminders/${reminder.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status }),
    });
    const updatedReminder = mapReminder(response.reminder);
    setReminders((previous) => previous.map((item) =>
      item.id === reminder.id ? updatedReminder : item
    ));
    showToast('Reminder status updated.');
  } catch (error) {
    console.error('Update reminder API Error:', error);
    showToast(error.message || 'Unable to update reminder.');
  }
};

const refreshReminderHistory = async () => {
  const response = await apiRequest('/api/reminders', {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  setReminders((response.reminders || []).map(mapReminder));
};

const handlePreviewReminderEmail = async (reminder) => {
  if (!canSendReminderNow(reminder, currentRole)) {
    showToast('Only organization admins and owners can send pending reminders.', 'error');
    return;
  }

  setReminderToSend(reminder);
  setReminderEmailPreview(null);
  setLoadingReminderPreviewId(reminder.id);
  try {
    const response = await apiRequest(`/api/reminders/${reminder.id}/preview`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setReminderEmailPreview(response.preview);
  } catch (error) {
    console.error('Preview reminder email API Error:', error);
    setReminderToSend(null);
    showToast(error.message || 'Unable to prepare reminder email preview.', 'error');
  } finally {
    setLoadingReminderPreviewId(null);
  }
};

const handleSendReminderNow = async () => {
  if (!reminderToSend || !reminderEmailPreview || !canSendReminderNow(reminderToSend, currentRole)) {
    showToast('This reminder is no longer eligible to send.', 'error');
    return;
  }

  const reminderId = reminderToSend.id;
  setSendingReminderId(reminderId);
  try {
    await apiRequest(`/api/reminders/${reminderId}/send-now`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setReminderToSend(null);
    setReminderEmailPreview(null);
    try {
      await refreshReminderHistory();
      showToast('Reminder email sent successfully.', 'success');
    } catch (refreshError) {
      console.error('Refresh reminder history API Error:', refreshError);
      showToast(
        'Reminder email was sent successfully, but history could not be refreshed. Refresh the page to verify.',
        'success',
      );
    }
  } catch (error) {
    console.error('Send reminder email API Error:', error);
    try {
      await refreshReminderHistory();
    } catch (refreshError) {
      console.error('Refresh reminder history API Error:', refreshError);
    }
    setReminderToSend(null);
    setReminderEmailPreview(null);
    showToast(error.message || 'Reminder email could not be sent.', 'error');
  } finally {
    setSendingReminderId(null);
  }
};

const handleDeleteReminder = async () => {
  if (!reminderToDelete || !canDeleteReminder(reminderToDelete, currentRole)) {
    showToast('Only organization admins and owners can delete eligible reminders.', 'error');
    return;
  }

  const reminderId = reminderToDelete.id;
  setDeletingReminderId(reminderId);
  try {
    await apiRequest(`/api/reminders/${reminderId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });

    setReminders((previous) => previous.filter((item) => item.id !== reminderId));
    setReminderToDelete(null);

    try {
      await refreshReminderHistory();
      showToast('Reminder deleted successfully.', 'success');
    } catch (refreshError) {
      console.error('Refresh reminder history API Error:', refreshError);
      showToast(
        'Reminder deleted successfully, but history could not be refreshed. Refresh the page to verify.',
        'error',
      );
    }
  } catch (error) {
    console.error('Delete reminder API Error:', error);
    showToast(error.message || 'Unable to delete reminder.', 'error');
  } finally {
    setDeletingReminderId(null);
  }
};

const handleCreateReminderTemplate = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/reminders/templates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ ...templateForm, channel: 'EMAIL' }),
    });
    setReminderTemplates((previous) => [response.template, ...previous]);
    setTemplateForm({ name: '', triggerStage: 'ON_DUE_DATE', channel: 'EMAIL', subject: '', body: '' });
    setShowTemplateForm(false);
    showToast('Reminder template created.');
  } catch (error) {
    console.error('Create reminder template API Error:', error);
    showToast(error.message || 'Unable to create reminder template.');
  }
};

const handleToggleReminderTemplate = async (template) => {
  try {
    const response = await apiRequest(`/api/reminders/templates/${template.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    setReminderTemplates((previous) => previous.map((item) =>
      item.id === template.id ? response.template : item
    ));
    showToast(`Reminder template ${response.template.isActive ? 'enabled' : 'disabled'}.`);
  } catch (error) {
    console.error('Update reminder template API Error:', error);
    showToast(error.message || 'Unable to update reminder template.');
  }
};

const handleCreateCommunication = async (event) => {
  event.preventDefault();
  try {
    const response = await apiRequest('/api/communications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        ...communicationForm,
        invoiceId: communicationForm.invoiceId || undefined,
      }),
    });
    setCommLogs((previous) => [mapCommunication(response.communication), ...previous]);
    setCommunicationForm({
      customerId: '',
      invoiceId: '',
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      message: '',
      outcome: '',
    });
    setShowCommunicationForm(false);
    showToast('Communication activity recorded.');
  } catch (error) {
    console.error('Create communication API Error:', error);
    showToast(error.message || 'Unable to record communication activity.');
  }
};

const handleTriggerReminders = async () => {
  const dueInvoices = enrichedInvoices.filter((invoice) =>
    invoice.outstanding > 0 &&
    invoice.status !== 'DRAFT' &&
    invoice.dueDate <= todayISO() &&
    customers.find((customer) => customer.id === invoice.customerId)?.email
  );
  if (!dueInvoices.length) {
    showToast('No due invoices with customer email addresses need reminders.');
    return;
  }

  let scheduledCount = 0;
  let failedCount = 0;
  for (const invoice of dueInvoices) {
    const customer = customers.find((item) => item.id === invoice.customerId);
    try {
      const response = await apiRequest('/api/reminders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          scheduledFor: new Date(Date.now() + 60000).toISOString(),
          channel: 'EMAIL',
          subject: `Payment reminder: Invoice ${invoice.invoiceNumber}`,
          message: `Dear ${customer.name}, invoice ${invoice.invoiceNumber} has an outstanding balance of ${formatINR(invoice.outstanding)} and was due on ${invoice.dueDate}.`,
          dedupeKey: `due-email:${invoice.id}:${todayISO()}`,
        }),
      });
      setReminders((previous) => [...previous, mapReminder(response.reminder)]);
      scheduledCount += 1;
    } catch (error) {
      console.error(`Schedule reminder for invoice ${invoice.id} failed:`, error);
      failedCount += 1;
    }
  }

  if (scheduledCount > 0) {
    try {
      await refreshRecentAutomatedEmails();
    } catch (error) {
      reportLoadFailure('Automated email history', error);
    }
  }

  showToast(
    `${scheduledCount} email reminder(s) scheduled; ${failedCount} failed. Check reminder history for delivery status.`
  );
};

const downloadProtectedFile = async (endpoint, fallbackName, print = false) => {
  const printWindow = print ? window.open('', '_blank') : null;
  if (print && !printWindow) throw new Error('Allow pop-ups to print the PDF.');

  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL || ''}${endpoint}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!response.ok) {
      let message = 'File download failed.';
      try {
        const errorBody = await response.json();
        message = errorBody.message || message;
      } catch {
        // Keep the explicit download failure when the response is not JSON.
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.focus();
        printWindow.print();
      }, { once: true });
      const releasePrintUrl = () => URL.revokeObjectURL(objectUrl);
      printWindow.addEventListener('afterprint', releasePrintUrl, { once: true });
      printWindow.addEventListener('beforeunload', releasePrintUrl, { once: true });
      printWindow.location.href = objectUrl;
      return;
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || fallbackName;
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    printWindow?.close();
    throw error;
  }
};

const handleDownloadReceipt = async (receipt, print = false) => {
  try {
    const receiptName = receipt.receiptNumber || receipt.id;
    await downloadProtectedFile(
      receipt.recordType === 'subscription'
        ? `/api/receipts/customer-subscriptions/${encodeURIComponent(receipt.id)}/pdf`
        : `/api/receipts/${encodeURIComponent(receipt.id)}/pdf`,
      `${receiptName}.pdf`,
      print
    );
    showToast(print ? `Receipt ${receiptName} opened for printing.` : `Receipt ${receiptName} downloaded.`);
  } catch (error) {
    console.error('Receipt PDF download error:', error);
    showToast(error.message || (print ? 'Unable to print receipt PDF.' : 'Unable to download receipt PDF.'));
  }
};

const handleLoadReport = async () => {
  try {
    const endpoint = selectedReport === 'ageing'
      ? `/api/ageing${dashboardFilterQuery}`
      : `/api/reports/${selectedReport}`;
    const response = await apiRequest(endpoint, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const reportKey = {
      invoices: 'invoices',
      collections: 'collections',
      outstanding: 'outstandingInvoices',
      overdue: 'invoices',
      customers: 'customers',
      credits: 'adjustments',
      ageing: 'invoices',
    }[selectedReport];
    setReportData({
      title: selectedReport,
      count: response.count ?? response.totalReceipts ?? response.overdueInvoices ?? response.totalInvoices ?? 0,
      total: response.totalOutstanding ?? response.totalOverdue ?? response.totalCollections,
      rows: response[reportKey] || [],
    });
  } catch (error) {
    console.error('Report API Error:', error);
    showToast(error.message || 'Unable to load report.');
  }
};

const handleExportReport = async (format) => {
  if (selectedReport === 'ageing' && (dashboardDateRange.error || !dashboardFilterQuery)) {
    showToast('Ageing data is unavailable for the selected filters.');
    return;
  }
  try {
    const query = new URLSearchParams({ format });
    if (selectedReport === 'ageing' && dashboardFilterQuery) {
      new URLSearchParams(dashboardFilterQuery.slice(1)).forEach((value, key) => query.set(key, value));
    }
    const endpoint = selectedReport === 'ageing'
      ? `/api/ageing?${query}`
      : `/api/reports/export/${selectedReport}?${query}`;
    await downloadProtectedFile(
      endpoint,
      `auron-${selectedReport}.${format}`
    );
    showToast(`${selectedReport} report downloaded.`);
  } catch (error) {
    console.error('Report export API Error:', error);
    showToast(error.message || 'Unable to export report.');
  }
};

const handlePrintReport = async () => {
  if (selectedReport === 'ageing' && (dashboardDateRange.error || !dashboardFilterQuery)) {
    showToast('Ageing data is unavailable for the selected filters.');
    return;
  }
  try {
    const query = new URLSearchParams({ format: 'pdf' });
    if (selectedReport === 'ageing' && dashboardFilterQuery) {
      new URLSearchParams(dashboardFilterQuery.slice(1)).forEach((value, key) => query.set(key, value));
    }
    const endpoint = selectedReport === 'ageing'
      ? `/api/ageing?${query}`
      : `/api/reports/export/${selectedReport}?${query}`;
    await downloadProtectedFile(endpoint, '', true);
  } catch (error) {
    console.error('Report PDF print error:', error);
    showToast(error.message || 'Unable to print report PDF.');
  }
};

const handleDownloadAgeingPdf = async (print = false) => {
  if (!visibleAgeing || dashboardDateRange.error) {
    showToast('Ageing data is unavailable for the selected filters.');
    return;
  }
  try {
    const query = new URLSearchParams(dashboardFilterQuery.slice(1));
    query.set('format', 'pdf');
    await downloadProtectedFile(`/api/ageing?${query}`, 'auron-ageing-report.pdf', print);
    if (!print) showToast('Ageing report PDF downloaded.');
  } catch (error) {
    console.error('Ageing report PDF error:', error);
    showToast(error.message || 'Unable to export ageing report PDF.');
  }
};

const handleGenerateStatement = async () => {
  if (!statementCustomerId || !statementFromDate || !statementToDate) {
    showToast('Choose a customer and statement date range.');
    return;
  }
  try {
    const query = new URLSearchParams({
      fromDate: statementFromDate,
      toDate: statementToDate,
    });
    const response = await apiRequest(
      `/api/statements/${statementCustomerId}?${query}`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    setStatementData(response.statement);
  } catch (error) {
    console.error('Customer statement API Error:', error);
    showToast(error.message || 'Unable to generate customer statement.');
  }
};

const handleDownloadStatement = async () => {
  if (!statementCustomerId) {
    showToast('Choose a customer first.');
    return;
  }
  const query = new URLSearchParams({
    fromDate: statementFromDate,
    toDate: statementToDate,
  });
  try {
    await downloadProtectedFile(
      `/api/statements/${statementCustomerId}/pdf?${query}`,
      'customer-statement.pdf'
    );
  } catch (error) {
    console.error('Customer statement PDF API Error:', error);
    showToast(error.message || 'Unable to download customer statement.');
  }
};

const handlePrintStatement = async () => {
  if (!statementCustomerId || !statementData) {
    showToast('Generate a customer statement before printing.');
    return;
  }
  const query = new URLSearchParams({
    fromDate: statementFromDate,
    toDate: statementToDate,
  });
  try {
    await downloadProtectedFile(
      `/api/statements/${statementCustomerId}/pdf?${query}`,
      '',
      true
    );
  } catch (error) {
    console.error('Customer statement PDF print error:', error);
    showToast(error.message || 'Unable to print customer statement.');
  }
};

const refreshBillingDetails = async () => {
  const historyResponse = await apiRequest('/api/subscriptions/billing/history', {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!Array.isArray(historyResponse?.invoices)) {
    throw new TypeError('Subscription billing history API returned an invalid response.');
  }
  setBillingHistory(historyResponse.invoices);

  try {
    const [subscriptionResponse, usageResponse] = await Promise.all([
      apiRequest('/api/subscriptions/current', {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
      apiRequest('/api/subscriptions/usage', {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    ]);
    const subscription = subscriptionResponse?.subscription;
    setCurrentSubscription(
      subscription && typeof subscription === 'object' && !Array.isArray(subscription)
        ? subscription
        : null
    );
    setActivePlan(subscription?.plan?.name || '');
    const usage = usageResponse?.usage;
    setSubscriptionUsage(
      usage && typeof usage === 'object' && !Array.isArray(usage)
        ? usage
        : null
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    setCurrentSubscription(null);
    setSubscriptionUsage(null);
  }
};

const loadRazorpayCheckout = async () => {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const finishLoading = () => {
      if (window.Razorpay) resolve();
      else reject(new Error('Payment checkout failed to load.'));
    };
    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        finishLoading();
        return;
      }
      existing.addEventListener('load', () => {
        existing.dataset.loaded = 'true';
        finishLoading();
      }, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => {
      script.dataset.loaded = 'true';
      finishLoading();
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
};

const handleSubscriptionCheckout = async (
  plan,
  billingCycle = activeSubscriptionBillingCycle,
  checkoutOptions = {}
) => {
  if (!canAccessOrganizationBillingPortal(currentRole)) {
    showToast('Only organization administrators and owners can manage SaaS billing.');
    return;
  }
  if (isProcessingBilling) return;
  const currentEnd = currentSubscription?.endsAt
    ? new Date(currentSubscription.endsAt).toLocaleDateString()
    : null;
  const effectiveMessage = currentEnd
    ? `Payment will be charged now; the selected plan starts at the current term's renewal (${currentEnd}). No proration is applied.`
    : 'The selected plan starts immediately after successful payment.';
  if (!window.confirm(`Continue with ${plan.name} (${billingCycle.toLowerCase()})?\n\n${effectiveMessage}`)) return;

  setIsProcessingBilling(true);
  try {
    const requestId = window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = `sub-${requestId}`;
    const order = await apiRequest('/api/subscriptions/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        planCode: plan.code,
        billingCycle,
        autoRenew: Boolean(checkoutOptions.autoRenewRequested),
        contact: checkoutOptions.contact || '',
      }),
    });

    await loadRazorpayCheckout();
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'Alpha Auron Collect',
      description: `${order.planName} subscription (${order.billingCycle.toLowerCase()})`,
      order_id: order.orderId,
      ...(order.autoRenewRequested
        ? { customer_id: order.customerId, recurring: true, method: 'card' }
        : {}),
      handler: async (gatewayPayment) => {
        try {
          await apiRequest('/api/subscriptions/orders/verify', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              billingPaymentId: order.paymentId,
              ...gatewayPayment,
            }),
          });
          await refreshBillingDetails();
          showToast('Payment verified. Subscription billing history updated.');
        } catch (error) {
          console.error('Subscription payment verification failed:', error);
          showToast(error.message || 'Unable to verify the subscription payment.');
        } finally {
          setIsProcessingBilling(false);
        }
      },
      modal: {
        ondismiss: () => setIsProcessingBilling(false),
      },
    });
    checkout.on('payment.failed', () => {
      setIsProcessingBilling(false);
      showToast('Test payment was not completed.');
    });
    checkout.open();
  } catch (error) {
    console.error('Subscription checkout failed:', error);
    showToast(error.message || 'Unable to start test-mode checkout.');
    setIsProcessingBilling(false);
  }
};

const handleOrganizationAutoRenew = async (subscription, enabled) => {
  if (!subscription?.id || isProcessingBilling) return;
  setIsProcessingBilling(true);
  try {
    const action = enabled ? 'enable' : 'disable';
    const response = await apiRequest(
      `/api/subscriptions/${encodeURIComponent(subscription.id)}/${action}-auto-renew`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({}),
      }
    );
    await refreshBillingDetails();
    showToast(response.message);
  } catch (error) {
    console.error('Organization auto-renew update failed:', error);
    showToast(error.message || 'Unable to update auto-renew.');
  } finally {
    setIsProcessingBilling(false);
  }
};

const refreshPlanConfigurations = async () => {
  const [configResponse, plansResponse] = await Promise.all([
    apiRequest('/api/subscriptions/plans/configuration', {
      headers: { Authorization: `Bearer ${authToken}` },
    }),
    apiRequest('/api/subscriptions/plans', {
      headers: { Authorization: `Bearer ${authToken}` },
    }),
  ]);
  if (!Array.isArray(configResponse?.plans) || !Array.isArray(plansResponse?.plans)) {
    throw new TypeError('Subscription plan configuration API returned an invalid response.');
  }
  const configurations = configResponse.plans;
  setSubscriptionPlanConfigs(configurations);
  setSubscriptionPlans(plansResponse.plans);
  setPlanConfigDrafts(Object.fromEntries(configurations.map((item) => [
    item.code,
    {
      proposedMonthlyPrice: item.proposedMonthlyPrice ?? '',
      proposedYearlyPrice: item.proposedYearlyPrice ?? '',
      proposedMaxUsers: item.proposedMaxUsers ?? '',
      proposedMaxCustomers: item.proposedMaxCustomers ?? '',
      proposedMaxInvoicesPerMonth: item.proposedMaxInvoicesPerMonth ?? '',
    },
  ])));
};

const handleSavePlanProposal = async (plan) => {
  const draft = planConfigDrafts[plan.code] || {};
  const toNullableNumber = (value) => value === '' ? null : Number(value);
  try {
    await apiRequest(`/api/subscriptions/plans/${encodeURIComponent(plan.code)}/configuration`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proposedMonthlyPrice: toNullableNumber(draft.proposedMonthlyPrice),
        proposedYearlyPrice: toNullableNumber(draft.proposedYearlyPrice),
        proposedMaxUsers: toNullableNumber(draft.proposedMaxUsers),
        proposedMaxCustomers: toNullableNumber(draft.proposedMaxCustomers),
        proposedMaxInvoicesPerMonth: toNullableNumber(draft.proposedMaxInvoicesPerMonth),
      }),
    });
    await refreshPlanConfigurations();
    showToast(`${plan.name} proposal saved. Existing approved terms remain unchanged until approval.`);
  } catch (error) {
    console.error('Subscription plan proposal save failed:', error);
    showToast(error.message || 'Unable to save the plan proposal.');
  }
};

const handleApprovePlan = async (plan, approval) => {
  const message = approval === 'pricingApproved'
    ? `Approve the configured price for ${plan.name}?`
    : `Approve the configured limits for ${plan.name}? Empty limits will mean unlimited.`;
  if (!window.confirm(message)) return;
  try {
    await apiRequest(`/api/subscriptions/plans/${encodeURIComponent(plan.code)}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ [approval]: true }),
    });
    await refreshPlanConfigurations();
    showToast(`${plan.name} approval saved.`);
  } catch (error) {
    console.error('Subscription plan approval failed:', error);
    showToast(error.message || 'Unable to approve the plan configuration.');
  }
};

   const handlePostReceipt = async (e) => {
  e.preventDefault();

  const amt = Number(rcpForm.amount);

  if (!amt || amt <= 0) {
    showToast('Please enter a valid positive receipt amount.');
    return;
  }

  const allocEntries = Object.entries(rcpForm.allocations)
    .map(([invoiceId, value]) => ({
      invoiceId,
      amount: Number(value || 0),
    }))
    .filter((allocation) => allocation.amount > 0);

  const totalAllocated = allocEntries.reduce(
    (sum, allocation) => sum + allocation.amount,
    0
  );

  if (totalAllocated > amt) {
    showToast('Allocated total cannot exceed receipt amount!');
    return;
  }

  let createdReceipt = null;
  try {
    // 1. Create receipt in backend
    const response = await apiRequest('/api/receipts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        receiptNumber: rcpForm.receiptNumber,
        receiptDate: rcpForm.receiptDate,
        customerId: rcpForm.customerId,
        paymentMethod: rcpForm.mode,
        amount: amt,
        currency: 'INR',
        transactionReference: rcpForm.reference,
      }),
    });

    createdReceipt = response.receipt;

    if (!createdReceipt?.id) {
      throw new Error('Receipt created, but backend did not return its ID.');
    }

    // 2. Allocate receipt to selected invoices
    for (const allocation of allocEntries) {
      await apiRequest('/api/receipts/allocate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          receiptId: createdReceipt.id,
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
        }),
      });
    }

    // 3. Refresh receipts from backend
    const receiptsResponse = await apiRequest('/api/receipts', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const mappedReceipts = (receiptsResponse.receipts || []).map(mapReceipt);

    setReceipts(mappedReceipts);

    // 4. Refresh invoices from backend
    const invoicesResponse = await apiRequest('/api/invoices', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    const mappedInvoices = (invoicesResponse.invoices || []).map(mapInvoice);

    setInvoices(mappedInvoices);

    // 5. Reset form and close modal
    setNewReceiptModal(false);

    setRcpForm({
      customerId: customers[0]?.id || '',
      receiptNumber: '',
      receiptDate: todayISO(),
      amount: '',
      mode: 'NEFT / RTGS',
      reference: '',
      allocations: {},
    });

    await refreshPortfolioSummaries();
    showToast(
      `Receipt ${createdReceipt.receiptNumber} posted successfully!`
    );

  } catch (error) {
    console.error('Post Receipt API Error:', error);
    if (createdReceipt?.id) {
      try {
        const [receiptsResponse, invoicesResponse] = await Promise.all([
          apiRequest('/api/receipts', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
          apiRequest('/api/invoices', {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ]);
        setReceipts((receiptsResponse.receipts || []).map(mapReceipt));
        setInvoices((invoicesResponse.invoices || []).map(mapInvoice));
      } catch (refreshError) {
        console.error('Refresh after partial receipt posting failed:', refreshError);
      }
      await refreshPortfolioSummaries();
      showToast(`Receipt ${createdReceipt.receiptNumber} was created, but a later allocation or refresh failed: ${error.message}`);
    } else {
      showToast(error.message || 'Unable to post receipt.');
    }
  }
};


  const handleReverseReceipt = async (receipt) => {
    const activeAllocations = receipt.allocations.filter(
      (allocation) => allocation.status === 'POSTED'
    );

    if (!activeAllocations.length) {
      showToast('This receipt has no active allocations to reverse.');
      return;
    }

    const reason = window.prompt('Reason for reversing this receipt allocation:');
    if (!reason?.trim()) return;

    try {
      for (const allocation of activeAllocations) {
        await apiRequest(`/api/receipts/allocations/${allocation.id}/reverse`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ reason: reason.trim() }),
        });
      }

      const [receiptResponse, invoiceResponse] = await Promise.all([
        apiRequest('/api/receipts', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        apiRequest('/api/invoices', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      setReceipts((receiptResponse.receipts || []).map(mapReceipt));
      setInvoices((invoiceResponse.invoices || []).map(mapInvoice));
      await refreshPortfolioSummaries();
      showToast('Receipt allocations reversed successfully.');
    } catch (error) {
      console.error('Reverse receipt allocation API Error:', error);
      showToast(error.message || 'Unable to reverse receipt allocations.');
    }
  };
  const handleIssueInvoice = async (invoiceToIssue = selectedInvoice) => {
    if (!invoiceToIssue || invoiceToIssue.status !== 'DRAFT') {
      showToast('Only draft invoices can be issued.');
      return;
    }

    try {
      const response = await apiRequest(
        `/api/invoices/${invoiceToIssue.id}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            status: 'ISSUED',
          }),
        }
      );

      const updatedInvoice = response.invoice;

      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === updatedInvoice.id
            ? { ...inv, status: updatedInvoice.status }
            : inv
        )
      );

      setSelectedInvoice((previous) => previous?.id === updatedInvoice.id
        ? { ...previous, status: updatedInvoice.status, derivedStatus: 'Issued' }
        : previous);

      await refreshPortfolioSummaries();
      showToast('Invoice issued successfully!');
    } catch (error) {
      console.error('Issue Invoice API Error:', error);
      showToast(error.message || 'Unable to issue invoice.');
    }
  };

  const uploadInvoiceImport = async (endpoint) => {
    if (!invoiceImportFile) {
      throw new Error('Choose a CSV or XLSX file first.');
    }

    const formData = new FormData();
    formData.append('file', invoiceImportFile);
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || ''}/api/invoices/import/${endpoint}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Invoice import failed.');
    return result;
  };

  const handlePreviewInvoiceImport = async () => {
    try {
      const preview = await uploadInvoiceImport('preview');
      setInvoiceImportPreview(preview);
      setCsvImportPreview(true);
      showToast(`Preview ready: ${preview.validCount} valid, ${preview.errorCount} with errors.`);
    } catch (error) {
      console.error('Invoice import preview API Error:', error);
      showToast(error.message || 'Unable to preview invoice import.');
    }
  };

  const handleConfirmInvoiceImport = async () => {
    try {
      const result = await uploadInvoiceImport('confirm');
      setInvoiceImportPreview(null);
      setInvoiceImportFile(null);
      setCsvImportPreview(false);
      showToast(`${result.importedCount} invoice(s) imported. ${result.skippedCount} row(s) skipped.`);

      try {
        const response = await apiRequest('/api/invoices', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        setInvoices((response.invoices || []).map(mapInvoice));
        await refreshPortfolioSummaries();
      } catch (refreshError) {
        reportLoadFailure('Invoices after import', refreshError);
        showToast(`${result.importedCount} invoice(s) imported, but the list could not be refreshed.`);
      }
    } catch (error) {
      console.error('Invoice import confirmation API Error:', error);
      showToast(error.message || 'Unable to import invoices.');
    }
  };
  
  const handleCreateInvoice = async (e) => {
    e.preventDefault();

    const amt = Number(invForm.totalAmount);
    if (!amt || amt <= 0) {
      showToast('Enter a valid invoice amount.');
      return;
    }

    const cust = customers.find((c) => c.id === invForm.customerId);

    if (!cust) {
      showToast('Please select a valid customer.');
      return;
    }

    try {
      const response = await apiRequest('/api/invoices', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          invoiceNumber: `INV-${new Date().getFullYear()}-${Date.now()}`,
          customerId: cust.id,
          invoiceDate: invForm.invoiceDate,
          dueDate: invForm.dueDate,
          subtotal: amt,
          currency: 'INR',
          tax: 0,
          discount: 0,
        }),
      });

      const invoice = response.invoice;

      const newInv = {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: cust.name,
        invoiceDate: invoice.invoiceDate?.slice(0, 10) || invForm.invoiceDate,
        dueDate: invoice.dueDate?.slice(0, 10) || invForm.dueDate,
        subtotal: Number(invoice.subtotal || 0),
        totalAmount: Number(invoice.total || 0),
        taxAmount: Number(invoice.tax || 0),
        discount: Number(invoice.discount || 0),
        currency: invoice.currency || 'INR',
        status: invoice.status || 'DRAFT',
        branch: '',
        category: '',
        executive: invoice.assignedExecutive || '',
      };

      setInvoices((prev) => [newInv, ...prev]);
      setNewInvoiceModal(false);

      setInvForm({
        customerId: cust.id,
        invoiceDate: todayISO(),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        totalAmount: '',
      });

      showToast(`Invoice ${newInv.invoiceNumber} created successfully!`);
    } catch (error) {
      console.error('Create Invoice API Error:', error);
      showToast(error.message || 'Unable to create invoice.');
    }
  };


  const handleAskAI = async (customPrompt) => {
    const q = (customPrompt || aiInput).trim();
    if (!q) return;

    const lower = q.toLowerCase();
    let reply = '';

    if (portalMode !== 'admin') return;

    {
      // Admin Scoped Grounded AI
      if (lower.includes('overdue') || lower.includes('highest')) {
        const top = priorityQueue.find(
          (item) => item.currency === selectedDashboardCurrency,
        );
        reply = top
          ? `Highest priority overdue account in ${top.currency} is ${top.name} (${top.id}) with ${formatDashboardCurrency(
              top.overdueAmt,
              top.currency,
            )} overdue (${top.maxDays} days past due, Risk Score: ${top.priorityScore}/100). Portfolio overdue by currency: ${formatDashboardCurrencyBreakdown(
              kpis.currencies,
              'overdueAmount',
            )}.`
          : `There are currently no overdue balances in ${selectedDashboardCurrency || 'the selected currency'}.`;
      } else if (lower.includes('promise') || lower.includes('ptp') || lower.includes('broken')) {
        const broken = enrichedPtps.filter((p) => p.status === 'Broken');
        const dueToday = enrichedPtps.filter((p) => p.promisedDate === todayISO() && p.status !== 'Fulfilled');
        reply = `PTP Tracker: ${dueToday.length} promise(s) due today (${dueToday
          .map((p) => `${p.customerName}: ${formatDashboardCurrency(p.promisedAmount, p.currency)}`)
          .join(', ')}), and ${broken.length} broken promise(s) flagged (${broken
          .map((p) => `${p.customerName}: ${formatDashboardCurrency(p.promisedAmount, p.currency)}`)
          .join(', ')}).`;
      } else if (
        (lower.includes('remind') || lower.includes('send')) &&
        !lower.includes('email')
      ) {
        reply = 'Only email reminders are available. No email was scheduled.';
      } else if (lower.includes('remind') || lower.includes('send')) {
        await handleTriggerReminders();
        reply =
          'Email reminders can be scheduled for due invoices. Check Communications for recorded delivery status.';
      } else {
        reply = `Portfolio snapshot by currency: Outstanding ${formatDashboardCurrencyBreakdown(
          kpis.currencies,
          'totalOutstanding',
        )}; overdue ${formatDashboardCurrencyBreakdown(
          kpis.currencies,
          'overdueAmount',
        )}; collected in ${dashboardDateRange.label.toLowerCase()} ${formatDashboardCurrencyBreakdown(
          kpis.currencies,
          'collectionsInRange',
        )}; collection rate ${formatDashboardRateBreakdown(kpis.currencies)}.`;
      }
    }

    setAiMessages((prev) => [...prev, { sender: 'user', text: q }, { sender: 'ai', text: reply }]);
    setAiInput('');
  };

  // --- THEME CLASSES ---
  const { bgCanvas, bgCard, bgSurface, textMuted, borderSubtle } =
    getThemeClasses(darkMode);
  const customerTheme = getThemeClasses(customerDarkMode);

  // --- DUAL LOGIN & REGISTRATION VIEW ---
  if (portalMode === 'auth') {
    return (
      <div
        className={`app-auth-screen min-h-screen flex flex-col justify-between p-4 sm:p-8 ${bgCanvas}`}
        data-theme={darkMode ? 'dark' : 'light'}
      >
        {/* Top Bar */}
        <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img
  src="/auron-logo.png"
  alt="Auron Collect Logo"
  className="w-12 h-12 object-contain"
/>
            <div>
              <span className="font-extrabold tracking-wider text-base block leading-none">AURON COLLECT</span>
              <span className={`text-[11px] ${textMuted}`}>by Alpha Auron Private Limited</span>
            </div>
          </div>

          <ThemeToggle
  darkMode={darkMode}
  setDarkMode={setDarkMode}
  bgSurface={bgCard}
/>
        </div>

        {/* Center Auth Card */}
        <div className={`app-auth-card max-w-lg w-full mx-auto my-8 rounded-2xl border p-6 sm:p-8 ${bgCard} motion-enter`}>
        <>
    <div className="mb-6">
         <span className="inline-block px-2.5 py-1 rounded-md bg-[#E50914]/15 text-[#E50914] text-xs font-bold mb-2">
              Enterprise AR & Collection OS
            </span>
            <h1 className="text-2xl font-bold">Sign in to Auron Collect</h1>
            <p className={`text-xs mt-1 ${textMuted}`}>
              Track Every Invoice. Follow Up Smarter. Collect Faster.
            </p>
          </div>
          
{/* Auth Tabs */}
<div className={`grid grid-cols-2 gap-2 p-1 rounded-xl mb-3 ${bgSurface}`}>
  <button
    onClick={() => setAuthTab('staff')}
    className={`py-3 text-xs font-semibold rounded-lg transition ${
      authTab === 'staff'
        ? 'bg-[#E50914] text-white shadow'
        : textMuted
    }`}
  >
    Staff Login
  </button>

  <button
    type="button"
    onClick={() => setAuthTab('customer')}
    className={`py-3 text-xs font-semibold rounded-lg transition ${
      authTab === 'customer'
        ? 'bg-[#E50914] text-white shadow'
        : textMuted
    }`}
  >
    Customer Portal
  </button>
</div>

{authTab !== 'customer' && <div className="text-center mb-6">
  <button
    onClick={() => setAuthTab('register')}
    className="text-xs font-semibold text-[#E50914] hover:underline"
  >
    Create an Organization Account
  </button>
</div>}

          <div
            key={authTab}
            className={authTab === 'customer' ? '' : 'motion-fade-enter'}
          >
          {authTab === 'customer' && (
            <Suspense fallback={<div className={`py-8 text-center text-xs ${textMuted}`} role="status">Loading customer sign-in…</div>}>
              <CustomerAuth
                onLogin={handleCustomerLogin}
                onBackToStaff={() => {
                  if (authToken && currentUser) {
                    setAuthTab('staff');
                    setPortalMode('admin');
                  } else {
                    setAuthTab('staff');
                  }
                }}
                bgSurface={bgSurface}
                textMuted={textMuted}
                resetToken={new URLSearchParams(window.location.search).get('customerReset')}
              />
            </Suspense>
          )}
          {authTab === 'customer' && authToken && currentUser && (
            <button
              type="button"
              onClick={() => {
                setAuthTab('staff');
                setPortalMode('admin');
              }}
              className={`mt-4 w-full rounded-xl border border-[#E50914]/40 py-2.5 text-xs font-semibold text-[#E50914] transition hover:bg-[#E50914]/10`}
            >
              Back to Admin Portal
            </button>
          )}

          {authTab === 'staff' && (
            <form
              onSubmit={handleStaffLogin}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1.5">Work Email</label>
                <input
                  type="email"
                  required
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold">Password</label>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className="text-[11px] text-[#E50914] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-2.5 ${textMuted}`}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
<button
  type="submit"
  disabled={isLoggingIn}
  className="w-full py-3 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white font-bold text-xs transition shadow-lg shadow-[#E50914]/25 disabled:opacity-60"
>
  {isLoggingIn ? 'Signing In...' : 'Access Admin Workspace'}
</button>
            </form>
          )}

          {authTab === 'register' && (
            <form onSubmit={handleOrganizationRegistration} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Organization Name</label>
                <input type="text" required value={regForm.name}
                  onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Account Owner Name</label>
                <input type="text" required value={regForm.ownerName}
                  onChange={(e) => setRegForm({ ...regForm, ownerName: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Work Email</label>
                <input type="email" required value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Password</label>
                <input type="password" required minLength={8} value={regForm.password}
                  onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Confirm Password</label>
                <input type="password" required minLength={8} value={regForm.confirmPassword}
                  onChange={(e) => setRegForm({ ...regForm, confirmPassword: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`} />
              </div>
              <button type="submit" disabled={isLoggingIn}
                className="w-full py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white font-bold text-xs transition mt-2 disabled:opacity-60">
                {isLoggingIn ? 'Creating Account...' : 'Create Organization Account'}
              </button>
              <button type="button" onClick={() => setAuthTab('staff')} className={`w-full text-xs ${textMuted}`}>
                Return to Staff Login
              </button>
            </form>
          )}
          </div>
          </>
        </div>
        <AnimatedOverlay
          open={showForgotModal}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <StaffPasswordRecovery
            resetToken={staffResetToken}
            initialEmail={staffEmail}
            onClose={closeStaffPasswordRecovery}
            onResetSuccess={handleStaffPasswordResetSuccess}
            bgCard={bgCard}
            bgSurface={bgSurface}
            textMuted={textMuted}
          />
        </AnimatedOverlay>

        <footer className={`text-center text-[11px] ${textMuted}`}>
          © {new Date().getFullYear()} Alpha Auron Private Limited
        </footer>
      </div>
    );
  }

  // --- AUTHENTICATED CUSTOMER PORTAL ---
  if (portalMode === 'customer') {
    if (!customerToken) return null;

    return (
      <Suspense fallback={<div className={`min-h-screen grid place-items-center ${customerTheme.bgCanvas}`} role="status">Loading customer portal…</div>}>
        <CustomerPortal
          token={customerToken}
          user={customerUser}
          onOrganizationContactSales={() => showToast('Contact Alpha Auron to discuss Enterprise pricing.')}
          onTokenChange={(token) => {
            localStorage.setItem('auron_customer_token', token);
            setCustomerToken(token);
          }}
          onSessionExpired={() => clearCustomerSession('Your customer session expired. Please sign in again.')}
          onLogout={(message) => clearCustomerSession(message || 'You have been signed out.')}
          darkMode={customerDarkMode}
          setDarkMode={setCustomerDarkMode}
          bgCanvas={customerTheme.bgCanvas}
          bgCard={customerTheme.bgCard}
          bgSurface={customerTheme.bgSurface}
          textMuted={customerTheme.textMuted}
          borderSubtle={customerTheme.borderSubtle}
        />
      </Suspense>
    );
  }
  // --- ADMIN WORKSPACE NAVIGATION ITEMS ---
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'onboarding', label: 'Org Setup Wizard', icon: Building2 },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'invoices', label: 'Invoices & Bulk Import', icon: FileText },
    { id: 'receipts', label: 'Payments & Receipts', icon: Receipt },
    { id: 'ageing', label: 'Ageing Reports', icon: Clock },
    { id: 'queue', label: 'Collection Queue', icon: ShieldAlert },
    { id: 'tasks', label: 'Tasks & Follow-ups', icon: CheckSquare },
    { id: 'promises', label: 'Promise-to-Pay (PTP)', icon: Handshake },
    { id: 'disputes', label: 'Disputes Management', icon: AlertTriangle },
    { id: 'communications', label: 'Email Communication', icon: MessageSquare },
    { id: 'statements', label: 'Customer Statements', icon: FileSpreadsheet },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'billing', label: 'Subscription & Billing', icon: CreditCard },
    {
      id: 'organization-plans',
      label: 'Subscription Plans',
      icon: CreditCard,
      allowedRoles: ['ADMIN', 'OWNER'],
    },
  ];
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.allowedRoles || item.allowedRoles.includes(currentRole)
  );

  // --- MAIN ADMIN WORKSPACE ---
  return (
    <div
      className={`app-admin-shell min-h-screen flex flex-col ${bgCanvas}`}
      data-theme={darkMode ? 'dark' : 'light'}
    >
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className={`app-toast fixed top-16 right-4 z-50 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-600'
              : toastMessage.type === 'error'
                ? 'bg-rose-700'
                : 'bg-[#E50914]'
          } text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center space-x-2`}
          role="status"
          aria-live="polite"
        >
          {toastMessage.type === 'error'
            ? <AlertCircle className="w-4 h-4 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{toastMessage.message}</span>
        </div>
      )}

      {/* TOP HEADER BAR */}
      <AdminHeader
  key={authToken || 'admin-header'}
  orgSettings={orgSettings}
  currentRole={currentRole}
  currentUser={currentUser}
  authToken={authToken}
  onLogout={handleLogout}
  onPasswordChanged={handleStaffPasswordChanged}
  onOpenSettings={() => {
    setActiveModule('onboarding');
    setMobileMenuOpen(false);
  }}
  onOpenCustomerPortal={() => {
    setAuthTab('customer');
    setPortalMode('auth');
  }}
  darkMode={darkMode}
  setDarkMode={setDarkMode}
  bgCard={bgCard}
  bgSurface={bgSurface}
  textMuted={textMuted}
  primaryColor={orgSettings.primaryColor}
  setMobileMenuOpen={setMobileMenuOpen}
/>

      {/* BODY WRAPPER */}
      <div className="flex flex-1 overflow-hidden">
        {/* MOBILE SLIDE-OVER DRAWER */}
        <div
          aria-hidden={!mobileMenuOpen}
          inert={!mobileMenuOpen}
          className={`app-mobile-navigation fixed inset-0 z-50 lg:hidden flex bg-black/70 backdrop-blur-xs transition-opacity duration-200 ease-out ${
            mobileMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
            <div className={`w-72 h-full p-4 flex flex-col justify-between overflow-y-auto transition-transform duration-200 ease-out ${bgCard} ${
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
            }`}>
              <div>
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-800/30">
                  <span className="font-extrabold text-sm text-[#E50914]">AURON COLLECT</span>
                  <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {visibleNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        aria-current={activeModule === item.id ? 'page' : undefined}
                        onClick={() => {
                          setActiveModule(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors duration-200 ease-out ${
                          activeModule === item.id
                            ? 'bg-[#E50914] text-white'
                            : `${textMuted} hover:text-[#E50914]`
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
        </div>

        {/* DESKTOP LEFT SIDEBAR */}
        {/* DESKTOP LEFT SIDEBAR */}
<AdminSidebar
  NAV_ITEMS={visibleNavItems}
  activeModule={activeModule}
  sidebarColor={orgSettings.sidebarColor}
primaryColor={orgSettings.primaryColor}
secondaryColor={orgSettings.secondaryColor}
  setActiveModule={setActiveModule}
  currentRole={currentRole}
  bgCard={bgCard}
  bgSurface={bgSurface}
  textMuted={textMuted}
/>

        {/* MAIN WORKSPACE VIEWPORT */}
        <main className="app-admin-main flex-1 overflow-y-auto p-4 sm:p-6 pb-28 space-y-6">
          {isLoadingData && (
            <div className={`flex items-center gap-2 text-xs ${textMuted}`} role="status">
              <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Loading account data…
            </div>
          )}
          {dataLoadError && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-300" role="status">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{dataLoadError}</span>
            </div>
          )}
          <div key={activeModule} className="page-enter">
          {/* MODULE 1: EXECUTIVE DASHBOARD */}
          {activeModule === 'dashboard' && (
            <div className="space-y-6">
              {/* Top Controls & Filters */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">Accounts Receivable Command Center</h1>
                  <p className={`text-xs ${textMuted}`}>
                    Ledger metrics • System Date: {new Date().toLocaleDateString('en-IN')} • Currencies: {dashboardCurrencies.join(', ') || 'N/A'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Dashboard date range"
                    value={dashboardPeriod}
                    onChange={(e) => updateDashboardPeriod(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    <option>Today</option>
                    <option>This Week</option>
                    <option>This Month</option>
                    <option>Last Month</option>
                    <option>This Quarter</option>
                    <option>Custom Range</option>
                  </select>

                  {dashboardPeriod === 'Custom Range' && (
                    <>
                      <label className={`flex items-center gap-1 text-[11px] ${textMuted}`}>
                        From
                        <input
                          aria-label="Custom range start date"
                          type="date"
                          value={customDateFrom}
                          max={INITIAL_DASHBOARD_TODAY}
                          onChange={(event) => updateDashboardCustomFrom(event.target.value)}
                          className={`text-xs p-2 rounded-xl border ${bgCard}`}
                        />
                      </label>
                      <label className={`flex items-center gap-1 text-[11px] ${textMuted}`}>
                        To
                        <input
                          aria-label="Custom range end date"
                          type="date"
                          value={customDateTo}
                          max={INITIAL_DASHBOARD_TODAY}
                          onChange={(event) => updateDashboardCustomTo(event.target.value)}
                          className={`text-xs p-2 rounded-xl border ${bgCard}`}
                        />
                      </label>
                    </>
                  )}

                  <select
                    aria-label="Assigned executive"
                    value={filterExecutive}
                    onChange={(e) => updateDashboardExecutive(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    <option value="All">All Executives</option>
                    {dashboardExecutives.assigned.map((executive) => (
                      <option key={executive} value={executive}>{executive.trim()}</option>
                    ))}
                    {dashboardExecutives.hasUnassigned && (
                      <option value={DASHBOARD_UNASSIGNED_EXECUTIVE}>Unassigned</option>
                    )}
                  </select>

                  {dashboardCurrencies.length > 1 && (
                    <label className="flex items-center gap-2">
                      <span className={`text-xs ${textMuted}`}>Chart currency</span>
                      <select
                        value={selectedDashboardCurrency}
                        onChange={(event) => setDashboardCurrency(event.target.value)}
                        className={`text-xs p-2 rounded-xl border ${bgCard}`}
                      >
                        {dashboardCurrencies.map((currency) => (
                          <option key={currency} value={currency}>{currency}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <button
                    onClick={() => handleTriggerReminders()}
                    className="px-3.5 py-2 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white text-xs font-bold flex items-center space-x-1.5 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Schedule Due Email Reminders</span>
                  </button>
                </div>
              </div>
              {dashboardDateRange.error && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-300" role="alert">
                  {dashboardDateRange.error}
                </div>
              )}
              {isLoadingDashboard && !dashboardDateRange.error && (
                <div className={`flex items-center gap-2 text-xs ${textMuted}`} role="status">
                  <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  Updating filtered dashboard…
                </div>
              )}

              {/* Financial KPIs are server-calculated and shown per currency. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 kpi-stagger">
                <div className={`p-5 rounded-2xl border ${bgCard} card-animate`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Outstanding</p>
                    <DollarSign className="w-4 h-4 text-[#E50914]" />
                  </div>
                  <h3 className="text-xl font-extrabold mt-2 break-words leading-7">
                    {formatDashboardCurrencyBreakdown(kpis.currencies, 'totalOutstanding')}
                  </h3>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>
                    <span title="Per currency for invoices issued in the selected date range: valid posted allocations divided by invoice totals less approved credit adjustments.">
                      Collection Rate:
                    </span>{' '}
                    <span className="text-emerald-400 font-bold">{formatDashboardRateBreakdown(kpis.currencies)}</span>
                  </p>
                </div>

                <div className={`p-5 rounded-2xl border border-[#E50914]/50 relative overflow-hidden ${bgCard} card-animate`}>
                  <div className="absolute top-0 right-0 w-1.5 h-full bg-[#E50914]" />
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Overdue</p>
                    <AlertCircle className="w-4 h-4 text-[#E50914]" />
                  </div>
                  <h3 className="text-xl font-extrabold text-[#E50914] mt-2 break-words leading-7">
                    {formatDashboardCurrencyBreakdown(kpis.currencies, 'overdueAmount')}
                  </h3>
                  <p className="text-[11px] text-[#E50914] mt-1">Open balances requiring collection</p>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard} card-animate`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Collected ({dashboardDateRange.label})</p>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-extrabold text-emerald-400 mt-2 break-words leading-7">
                    {formatDashboardCurrencyBreakdown(kpis.currencies, 'collectionsInRange')}
                  </h3>
                  <p
                    className={`text-[11px] mt-1 ${textMuted}`}
                    title={visibleDashboard?.dsoMethod || undefined}
                  >
                    Range DSO: <span className="font-bold">{formatDashboardDsoBreakdown(kpis.currencies)}</span>
                  </p>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard} card-animate`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Expected (PTPs in range)</p>
                    <Handshake className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="text-xl font-extrabold text-amber-400 mt-2 break-words leading-7">
                    {formatDashboardCurrencyBreakdown(kpis.currencies, 'expectedPromiseAmount')}
                  </h3>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>
                    {kpis.promisesDue ?? 'N/A'} Due in range • <span className="text-[#E50914] font-bold">{kpis.brokenPromises ?? 'N/A'} Broken</span>
                  </p>
                </div>
              </div>

              {/* Charts Row */}
              <Suspense
                fallback={
                  <div className={`grid min-h-64 place-items-center rounded-2xl border ${bgCard}`} role="status">
                    <span className={`text-xs ${textMuted}`}>Loading dashboard charts…</span>
                  </div>
                }
              >
                <DashboardCharts
                  ageingChartData={ageingChartData}
                  bgCard={bgCard}
                  bgSurface={bgSurface}
                  darkMode={darkMode}
                  dashboardDateRangeLabel={dashboardDateRange.label}
                  dashboardTrendData={dashboardTrendData}
                  formatDashboardCurrency={formatDashboardCurrency}
                  prefersReducedMotion={prefersReducedMotion}
                  selectedDashboardCurrency={selectedDashboardCurrency}
                  textMuted={textMuted}
                  visibleAgeing={visibleAgeing}
                />
              </Suspense>

              {/* Priority Accounts & Live Automated Dispatch Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={`min-w-0 p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold">Top Priority Collection Queue</h3>
                    <button
                      onClick={() => setActiveModule('queue')}
                      className="text-xs text-[#E50914] font-semibold hover:underline"
                    >
                      View Full Queue →
                    </button>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[420px]">
                      <thead>
                        <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                          <th className="pb-2">Customer</th>
                          <th className="pb-2">Overdue</th>
                          <th className="pb-2">Max Age</th>
                          <th className="pb-2">Risk Score</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${borderSubtle}`}>
                        {priorityQueue.map((c) => (
                          <tr key={c.id}>
                            <td className="py-3 font-semibold">{c.name}</td>
                            <td className="py-3 font-bold text-[#E50914]">{formatDashboardCurrency(c.overdueAmt, c.currency)}</td>
                            <td className="py-3">{c.maxDays}d</td>
                            <td className="py-3">
                              <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-bold">
                                {c.priorityScore}/100
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold">Recent Automated Reminders</h3>
                    <button
                      onClick={() => setActiveModule('communications')}
                      className="text-xs text-[#E50914] font-semibold hover:underline"
                    >
                      Configure Rules →
                    </button>
                  </div>
                  <div className="space-y-3">
                    {recentAutomatedEmails.slice(0, 3).map((email) => (
                      <div key={email.id} className={`p-3 rounded-xl border text-xs ${bgSurface}`}>
                        <div className="flex flex-wrap justify-between gap-2 mb-1">
                          <span className="font-bold">{email.customerName || email.recipient || 'Customer'}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${email.failureStatus ? 'bg-rose-500/15 text-rose-400' : 'bg-blue-500/15 text-blue-400'}`}>
                            {email.deliveryStatus}
                          </span>
                        </div>
                        <p className={`break-all text-[11px] ${textMuted}`}>
                          {email.recipient || 'Waiting for a verified portal email'}
                        </p>
                        <p className="mt-1 font-medium">{email.subject || 'Payment reminder'}</p>
                        <p className={`mt-1 text-[10px] ${textMuted}`}>
                          {email.sentAt
                            ? `${email.deliveryStatus === 'SMTP_ACCEPTED' ? 'Accepted' : 'Attempted'} ${formatReminderDateTime(email.sentAt, email.customerTimeZone)}`
                            : email.lastAttemptAt
                              ? `Attempted ${formatReminderDateTime(email.lastAttemptAt, email.customerTimeZone)}`
                              : email.nextAttemptAt
                                ? `Next attempt ${formatReminderDateTime(email.nextAttemptAt, email.customerTimeZone)}`
                                : `Scheduled ${formatReminderDateTime(email.scheduledFor, email.customerTimeZone)}`}
                          {email.invoiceNumber ? ` · ${email.invoiceNumber}` : ''}
                          {email.attemptCount ? ` · ${email.attemptCount} attempt${email.attemptCount === 1 ? '' : 's'}` : ''}
                        </p>
                        {email.failureStatus && <p className="mt-1 text-[11px] text-rose-400">{email.failureStatus}</p>}
                      </div>
                    ))}
                    {!recentAutomatedEmails.length && (
                      <p className={`py-3 text-xs ${textMuted}`}>
                        {isLoadingRecentAutomatedEmails
                          ? 'Loading automated email history…'
                          : recentAutomatedEmailsError || 'No automated email reminders recorded.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODULE 2: ORGANISATION ONBOARDING & SETUP WIZARD */}
          {activeModule === 'onboarding' && (
            <div className={`max-w-3xl p-6 rounded-2xl border space-y-5 ${bgCard}`}>
              <div>
                <h2 className="text-lg font-bold">Organisation Onboarding & Governance Setup</h2>
                <p className={`text-xs ${textMuted}`}>
                  Configure fiscal year, tax identifiers, default payment terms, and automated dunning escalation rules.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Legal Entity Name</label>
                  <input
                    type="text"
                    value={orgSettings.companyName}
                    onChange={(e) => setOrgSettings({ ...orgSettings, companyName: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Corporate GSTIN</label>
                  <input
                    type="text"
                    value={orgSettings.gstin}
                    onChange={(e) => setOrgSettings({ ...orgSettings, gstin: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Reporting Currency</label>
                  <input
                    type="text"
                    value={orgSettings.currency}
                    readOnly
                    className={`w-full p-2.5 rounded-xl border text-xs opacity-75 ${bgSurface}`}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  <div>
    <label className="block text-xs font-semibold mb-1">Legal Entity Name</label>
    <input
      type="text"
      value={orgSettings.companyName}
      onChange={(e) => setOrgSettings({ ...orgSettings, companyName: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Corporate GSTIN</label>
    <input
      type="text"
      value={orgSettings.gstin}
      onChange={(e) => setOrgSettings({ ...orgSettings, gstin: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Reporting Currency</label>
    <input
      type="text"
      value={orgSettings.currency}
      readOnly
      className={`w-full p-2.5 rounded-xl border text-xs opacity-75 ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Financial Year Cycle</label>
    <input
      type="text"
      value={orgSettings.fiscalYear}
      onChange={(e) => setOrgSettings({ ...orgSettings, fiscalYear: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Company Email</label>
    <input
      type="email"
      value={orgSettings.companyEmail}
      onChange={(e) => setOrgSettings({ ...orgSettings, companyEmail: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Company Phone</label>
    <input
      type="tel"
      value={orgSettings.companyPhone}
      onChange={(e) => setOrgSettings({ ...orgSettings, companyPhone: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Company Website</label>
    <input
      type="text"
      value={orgSettings.website}
      onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>
  

  <div className="sm:col-span-2">
    <label className="block text-xs font-semibold mb-1">Company Address</label>
    <textarea
      value={orgSettings.companyAddress}
      onChange={(e) => setOrgSettings({ ...orgSettings, companyAddress: e.target.value })}
      className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
      rows={3}
    />
  </div>
  <div className="sm:col-span-2">
  <label className="block text-xs font-semibold mb-2">Company Logo</label>

  <input
    type="file"
    accept="image/*"
    onChange={(e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setOrgSettings({
            ...orgSettings,
            logoUrl: reader.result
          });
        };
        reader.readAsDataURL(file);
      }
    }}
    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
  />

  {orgSettings.logoUrl && (
    <div className="mt-3">
      <p className="text-xs mb-2">Logo Preview</p>
      <img
        src={orgSettings.logoUrl}
        alt="Company Logo Preview"
        className="h-16 max-w-40 object-contain rounded-lg border p-2"
      />
    </div>
  )}
</div>
{/* BRANDING & THEME SETTINGS */}

<div className="sm:col-span-2 mt-4">
  <h3 className="text-sm font-bold mb-3">Branding & Theme Customisation</h3>
  <p className={`text-xs mb-4 ${textMuted}`}>
    Customise your organisation's brand colours and dashboard appearance.
  </p>
</div>

<div>
  <label className="block text-xs font-semibold mb-2">
    Primary Colour
  </label>
  <input
    type="color"
    value={orgSettings.primaryColor}
    onChange={(e) =>
      setOrgSettings({ ...orgSettings, primaryColor: e.target.value })
    }
    className="w-full h-11 rounded-xl cursor-pointer"
  />
</div>

<div>
  <label className="block text-xs font-semibold mb-2">
    Secondary Colour
  </label>
  <input
    type="color"
    value={orgSettings.secondaryColor}
    onChange={(e) =>
      setOrgSettings({ ...orgSettings, secondaryColor: e.target.value })
    }
    className="w-full h-11 rounded-xl cursor-pointer"
  />
</div>

<div>
  <label className="block text-xs font-semibold mb-2">
    Sidebar Colour
  </label>
  <input
    type="color"
    value={orgSettings.sidebarColor}
    onChange={(e) =>
      setOrgSettings({ ...orgSettings, sidebarColor: e.target.value })
    }
    className="w-full h-11 rounded-xl cursor-pointer"
  />
</div>

<div>
  <label className="block text-xs font-semibold mb-2">
    Dashboard Appearance
  </label>
  <select
    value={orgSettings.themeMode}
    onChange={(e) =>
      setOrgSettings({ ...orgSettings, themeMode: e.target.value })
    }
    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
  >
    <option value="dark">Dark Mode</option>
    <option value="light">Light Mode</option>
  </select>
</div>
</div>

<button
  onClick={() => {
  try {
    localStorage.setItem('auron_collect_org_settings', JSON.stringify(orgSettings));
    showToast('Organisation settings saved successfully.');
  } catch (error) {
    showToast('Unable to save settings.');
  }
}}
  className="px-5 py-2.5 rounded-xl bg-[#E50914] text-white text-xs font-bold"
>
  Save Configuration
</button>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Financial Year Cycle</label>
                  <input
                    type="text"
                    value={orgSettings.fiscalYear}
                    onChange={(e) => setOrgSettings({ ...orgSettings, fiscalYear: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
              </div>
                              <div>
                  <label className="block text-xs font-semibold mb-1">Company Email</label>
                  <input
                    type="email"
                    value={orgSettings.companyEmail}
                    onChange={(e) => setOrgSettings({ ...orgSettings, companyEmail: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Company Phone</label>
                  <input
                    type="text"
                    value={orgSettings.companyPhone}
                    onChange={(e) => setOrgSettings({ ...orgSettings, companyPhone: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Company Website</label>
                  <input
                    type="url"
                    value={orgSettings.website}
                    onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Company Address</label>
                  <input
                    type="text"
                    value={orgSettings.companyAddress}
                    onChange={(e) => setOrgSettings({ ...orgSettings, companyAddress: e.target.value })}
                    className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
              <button
                onClick={() => showToast('Organisation governance settings saved successfully.')}
                className="px-5 py-2.5 rounded-xl bg-[#E50914] text-white text-xs font-bold"
              >
                Save Configuration
              </button>
            </div>
          )}

          {/* MODULE 3: CUSTOMERS DIRECTORY */}
          {activeModule === 'customers' && (
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">Customer Master & Credit Risk Directory</h2>
                  <p className={`text-xs ${textMuted}`}>Click any customer to inspect full ledger exposure and profile drawer.</p>
                </div>
                           </div>
              <button
                onClick={() => setNewCustomerModal(true)}
                className="px-4 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold mb-4"
              >
                + Add Customer
              </button>
              <DataTableTools
                rows={customers}
                searchLabel="customers"
                getSearchText={(customer) => [
                  customer.id,
                  customer.name,
                  customer.contactPerson,
                  customer.email,
                  customer.phone,
                ].join(' ')}
                filters={[
                  { key: 'riskRating', label: 'risk rating', getValue: (customer) => customer.riskRating },
                  { key: 'branch', label: 'branch', getValue: (customer) => customer.branch },
                ]}
                loading={isLoadingData}
                emptyText="No customers were returned by the backend."
              >
                {({ rows: pageCustomers, emptyMessage }) => (
                  <table className="w-full text-left text-xs min-w-[700px]">
                    <thead>
                      <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                        <th className="pb-3">Customer ID</th>
                        <th className="pb-3">Account Name</th>
                        <th className="pb-3">Contact</th>
                        <th className="pb-3">Credit Limit</th>
                        <th className="pb-3">Total Outstanding</th>
                        <th className="pb-3">Risk Rating</th>
                        <th className="pb-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${borderSubtle}`}>
                      {pageCustomers.map((c) => {
                        const out = enrichedInvoices
                          .filter((i) => i.customerId === c.id)
                          .reduce((s, i) => s + i.outstanding, 0);
                        return (
                          <tr key={c.id} className="hover:bg-[#E50914]/5">
                            <td className="py-3 font-mono font-semibold">{c.id}</td>
                            <td className="py-3 font-bold">{c.name}</td>
                            <td className="py-3">
                              <div>{c.contactPerson}</div>
                              <div className={`text-[10px] ${textMuted}`}>{c.phone}</div>
                            </td>
                            <td className="py-3">{formatINR(c.creditLimit)}</td>
                            <td className="py-3 font-bold text-[#E50914]">{formatINR(out)}</td>
                            <td className="py-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  c.riskRating === 'Low'
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : c.riskRating === 'Medium'
                                    ? 'bg-amber-500/15 text-amber-400'
                                    : 'bg-[#E50914]/15 text-[#E50914]'
                                }`}
                              >
                                {c.riskRating}
                              </span>
                            </td>
                            <td className="py-3">
                              <button
                                onClick={() => {
                                  setSelectedCustomerDrawer(c);
                                  setIsCustomerDrawerOpen(true);
                                }}
                                className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                              >
                                Open Profile
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!pageCustomers.length && (
                        <tr><td colSpan="7" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </DataTableTools>
            </div>
          )}

          {/* MODULE 4: INVOICES & BULK CSV IMPORT */}
          {activeModule === 'invoices' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Invoices & Receivable Ledger</h2>
                  <p className={`text-xs ${textMuted}`}>
                    Formula: Outstanding = Invoice Total − Posted Receipt Allocations − Approved Credit Adjustments
                  </p>
                </div>
                <div className="flex space-x-2">
                  <label className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 cursor-pointer ${bgCard}`}>
                    <Upload className="w-3.5 h-3.5 text-[#E50914]" />
                    <span>{invoiceImportFile?.name || 'Choose CSV/XLSX'}</span>
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      className="hidden"
                      onChange={(event) => {
                        setInvoiceImportFile(event.target.files?.[0] || null);
                        setInvoiceImportPreview(null);
                        setCsvImportPreview(true);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setNewInvoiceModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold flex items-center space-x-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Invoice</span>
                  </button>
                </div>
              </div>

              {csvImportPreview && (
                <div className={`p-5 rounded-2xl border border-amber-500/40 ${bgCard}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold">Invoice Import Preview</h3>
                      {invoiceImportPreview && (
                        <p className={`text-xs mt-1 ${textMuted}`}>
                          {invoiceImportPreview.totalRows} rows • {invoiceImportPreview.validCount} valid • {invoiceImportPreview.errorCount} with errors
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePreviewInvoiceImport}
                        disabled={!invoiceImportFile}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-50 ${bgSurface}`}
                      >
                        Validate File
                      </button>
                      <button
                        onClick={handleConfirmInvoiceImport}
                        disabled={!invoiceImportFile || !invoiceImportPreview?.validCount}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Import Valid Rows
                      </button>
                    </div>
                  </div>
                  {!invoiceImportPreview ? (
                    <p className={`text-xs ${textMuted}`}>Choose a file and validate it. No records are written until you confirm the import.</p>
                  ) : (
                    <div className="max-h-64 overflow-auto space-y-2 text-xs">
                      {(invoiceImportPreview.errors || []).map((row) => (
                        <p key={`${row.row}-${row.invoiceNumber}`} className="text-rose-400">
                          Row {row.row} ({row.invoiceNumber || 'no invoice number'}): {row.errors.join('; ')}
                        </p>
                      ))}
                      {(invoiceImportPreview.preview || []).map((row) => (
                        <p key={row.invoiceNumber} className="text-emerald-400">
                          {row.invoiceNumber}: customer {row.customerId}, total {formatINR(row.total)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className={`p-5 rounded-2xl border ${bgCard}`}>
                <DataTableTools
                  rows={enrichedInvoices}
                  searchLabel="invoices"
                  getSearchText={(invoice) => [
                    invoice.invoiceNumber,
                    invoice.id,
                    invoice.customerName,
                    invoice.derivedStatus,
                  ].join(' ')}
                  filters={[
                    { key: 'status', label: 'status', getValue: (invoice) => invoice.derivedStatus },
                  ]}
                  loading={isLoadingData}
                  emptyText="No invoices were returned by the backend."
                >
                  {({ rows: pageInvoices, emptyMessage }) => (
                    <table className="w-full text-left text-xs min-w-[820px]">
                  <thead>
                    <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                      <th className="pb-3">Invoice #</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Due Date</th>
                      <th className="pb-3">Total Billed</th>
                      <th className="pb-3">Posted Paid</th>
                      <th className="pb-3">Credits</th>
                      <th className="pb-3">Outstanding</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {pageInvoices.map((inv) => (
                      <tr key={inv.id}>
                       <td className="py-3 font-bold">{inv.invoiceNumber || inv.id}</td>
                        <td className="py-3">{inv.customerName}</td>
                        <td className="py-3">{inv.dueDate}</td>
                        <td className="py-3">{formatINR(inv.totalAmount)}</td>
                        <td className="py-3 text-emerald-400">{formatINR(inv.postedPaid)}</td>
                        <td className="py-3 text-blue-400">{formatINR(inv.approvedCredits)}</td>
                        <td className="py-3 font-extrabold text-[#E50914]">{formatINR(inv.outstanding)}</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              inv.derivedStatus === 'Paid'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : inv.derivedStatus === 'Overdue'
                                ? 'bg-[#E50914]/15 text-[#E50914]'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}
                          >
                            {inv.derivedStatus} {inv.daysOverdue > 0 ? `(${inv.daysOverdue}d)` : ''}
                          </span>
                        </td>
                        <td className="py-3">
                          {inv.status === 'DRAFT' && (
                            <div className="flex gap-2">
                              <button onClick={() => handleIssueInvoice(inv)} className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white">Issue</button>
                              <button onClick={() => handleDeleteInvoice(inv)} className="rounded border border-rose-500/50 px-2 py-1 text-[10px] font-bold text-rose-400">Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!pageInvoices.length && <tr><td colSpan="9" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>}
                  </tbody>
                    </table>
                  )}
                </DataTableTools>
              </div>
            </div>
          )}

          {/* MODULE 5: RECEIPTS & PAYMENT ALLOCATION ENGINE */}
          {activeModule === 'receipts' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Receipt & Multi-Invoice Allocation Engine</h2>
                  <p className={`text-xs ${textMuted}`}>
                    Post customer payments, allocate across multiple open invoices, or reverse erroneous entries safely.
                  </p>
                </div>
                <button
                  onClick={() => setNewReceiptModal(true)}
                  className="px-4 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold flex items-center space-x-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record & Allocate Receipt</span>
                </button>
              </div>

              <div className={`p-5 rounded-2xl border ${bgCard}`}>
                <DataTableTools
                  rows={receipts}
                  searchLabel="payments and receipts"
                  getSearchText={(receipt) => [
                    receipt.receiptNumber,
                    receipt.customerName,
                    receipt.date,
                    receipt.mode,
                    receipt.reference,
                  ].join(' ')}
                  filters={[
                    { key: 'status', label: 'status', getValue: (receipt) => receipt.status },
                  ]}
                  loading={isLoadingData}
                  emptyText="No payment receipts were returned by the backend."
                >
                  {({ rows: pageReceipts, emptyMessage }) => (
                    <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[850px]">
                  <thead>
                    <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                      <th className="pb-3">Receipt #</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Date</th>
                      <th className="pb-3">Mode & Ref</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Allocations</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {pageReceipts.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 font-bold">{r.receiptNumber || r.id}</td>
                        <td className="py-3">{r.customerName}</td>
                        <td className="py-3">{r.date}</td>
                        <td className="py-3">
                          <div>{r.mode}</div>
                          <div className={`text-[10px] ${textMuted}`}>{r.reference}</div>
                        </td>
                        <td className="py-3 font-bold text-emerald-400">{formatINR(r.amount)}</td>
                        <td className="py-3">
                          {r.allocations.map((a, idx) => (
                            <span key={idx} className={`inline-block mr-1 px-2 py-0.5 rounded text-[10px] ${bgSurface}`}>
                              {a.invoiceId}: {formatINR(a.amount)}
                            </span>
                          ))}
                        </td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              r.status === 'Posted'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-gray-500/20 text-gray-400'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-col items-start gap-1.5">
                            <button
                              onClick={() => handleDownloadReceipt(r)}
                              aria-label={`Download receipt ${r.receiptNumber || r.id}`}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${bgSurface}`}
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download Receipt
                            </button>
                            <button
                              onClick={() => handleDownloadReceipt(r, true)}
                              aria-label={`Print receipt ${r.receiptNumber || r.id}`}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${bgSurface}`}
                            >
                              Print Receipt
                            </button>
                          {r.status === 'Posted' && (
                            <button
                              onClick={() => handleReverseReceipt(r)}
                              className="px-2.5 py-1 rounded-lg border border-[#E50914]/40 text-[#E50914] text-[11px] hover:bg-[#E50914] hover:text-white transition"
                            >
                              Reverse
                            </button>
                          )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!pageReceipts.length && (
                      <tr><td colSpan="8" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                    )}
                  </tbody>
                </table>
                    </div>
                  )}
                </DataTableTools>
              </div>
              <div className={`rounded-2xl border p-5 ${bgCard}`}>
                <div>
                  <h3 className="text-sm font-bold">Verified Subscription Receipts</h3>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                    Receipts are issued only after provider-confirmed payment capture.
                  </p>
                </div>
                <DataTableTools
                  rows={verifiedSubscriptionReceipts}
                  searchLabel="subscription receipts"
                  getSearchText={(receipt) => [
                    receipt.receiptNumber,
                    receipt.customerName,
                    receipt.customerEmail,
                    receipt.transactionId,
                    receipt.paymentMethod,
                  ].join(' ')}
                  filters={[
                    { key: 'emailStatus', label: 'email status', getValue: (receipt) => receipt.emailStatus },
                  ]}
                  loading={isLoadingData}
                  emptyText="No verified subscription receipts are available."
                >
                  {({ rows: pageSubscriptionReceipts, emptyMessage }) => (
                    <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-xs">
                    <thead>
                      <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                        <th className="pb-2">Receipt #</th>
                        <th className="pb-2">Customer</th>
                        <th className="pb-2">Payment date</th>
                        <th className="pb-2">Transaction ID</th>
                        <th className="pb-2">Amount</th>
                        <th className="pb-2">Email status</th>
                        <th className="pb-2">Download</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${borderSubtle}`}>
                      {pageSubscriptionReceipts.map((receipt) => (
                        <tr key={receipt.id}>
                          <td className="py-2 font-semibold">{receipt.receiptNumber}</td>
                          <td className="py-2">{receipt.customerName}</td>
                          <td className="py-2">{new Date(receipt.paidAt).toLocaleString()}</td>
                          <td className="py-2">{receipt.transactionId || '—'}</td>
                          <td className="py-2 font-bold">
                            {formatDashboardCurrency(receipt.amount, receipt.currency)}
                          </td>
                          <td className="py-2">{receipt.emailStatus}</td>
                          <td className="py-2">
                            <button
                              onClick={() => handleDownloadReceipt({
                                ...receipt,
                                recordType: 'subscription',
                              })}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold ${bgSurface}`}
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!pageSubscriptionReceipts.length && (
                        <tr>
                          <td colSpan="7" className={`py-4 ${textMuted}`}>
                            {emptyMessage}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                    </div>
                  )}
                </DataTableTools>
              </div>
            </div>
          )}

          {/* MODULE 6: AGEING ENGINE */}
          {activeModule === 'ageing' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Receivables Ageing Analysis Engine</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadAgeingPdf()}
                    disabled={!visibleAgeing || Boolean(dashboardDateRange.error)}
                    className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${bgSurface}`}
                  >
                    Download PDF
                  </button>
                  <button
                    onClick={() => handleDownloadAgeingPdf(true)}
                    disabled={!visibleAgeing || Boolean(dashboardDateRange.error)}
                    className="rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Print PDF
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {ageingChartData.map((b) => (
                  <div key={b.name} className={`p-4 rounded-2xl border ${bgCard}`}>
                    <p className={`text-[11px] font-semibold uppercase ${textMuted}`}>{b.name}</p>
                    <h4 className="text-lg font-extrabold mt-1">{formatDashboardCurrency(b.amount, selectedDashboardCurrency)}</h4>
                  </div>
                ))}
              </div>
              <div className={`p-5 rounded-2xl border ${bgCard}`}>
                <DataTableTools
                  rows={backendAgeing?.invoices || []}
                  searchLabel="ageing report rows"
                  getSearchText={(invoice) => [
                    invoice.invoiceNumber,
                    invoice.invoiceId,
                    invoice.customerName,
                    invoice.ageingCategory,
                    invoice.dueDate,
                  ].join(' ')}
                  filters={[
                    { key: 'bucket', label: 'ageing bucket', getValue: (invoice) => invoice.ageingCategory },
                  ]}
                  loading={isLoadingData}
                  emptyText="No ageing rows are available for the selected date range."
                >
                  {({ rows: pageAgeingInvoices, emptyMessage }) => (
                    <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[650px]">
                  <thead>
                    <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                      <th className="pb-3">Invoice</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Due Date</th>
                      <th className="pb-3">Days Overdue</th>
                      <th className="pb-3">Ageing Bucket</th>
                      <th className="pb-3">Open Balance</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {pageAgeingInvoices.map((inv) => (
                        <tr key={inv.id}>
                        <td className="py-3 font-bold">{inv.invoiceNumber || inv.invoiceId}</td>
                          <td className="py-3">{inv.customerName}</td>
                          <td className="py-3">{inv.dueDate?.slice(0, 10)}</td>
                          <td className="py-3 font-bold">{inv.overdueDays} Days</td>
                          <td className="py-3">
                            <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-semibold">
                              {inv.ageingCategory}
                            </span>
                          </td>
                          <td className="py-3 font-extrabold">{formatDashboardCurrency(inv.outstandingAmount, inv.currency)}</td>
                        </tr>
                    ))}
                    {!pageAgeingInvoices.length && (
                      <tr><td colSpan="6" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                    )}
                  </tbody>
                </table>
                    </div>
                  )}
                </DataTableTools>
              </div>
            </div>
          )}

          {/* MODULE 7: COLLECTION PRIORITY & RISK QUEUE */}
          {activeModule === 'queue' && (
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <h2 className="text-lg font-bold mb-1">Weighted Collection Priority & Risk Queue</h2>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Ranked dynamically by overdue exposure, maximum invoice age, and broken Promise-to-Pay flags.
              </p>
              <DataTableTools
                rows={priorityQueue}
                searchLabel="collection queue"
                getSearchText={(customer) => [
                  customer.name,
                  customer.executive,
                  customer.hasBrokenPtp ? 'Broken PTP' : 'Standard',
                ].join(' ')}
                filters={[
                  { key: 'executive', label: 'assigned executive', getValue: (customer) => customer.executive },
                  { key: 'ptp', label: 'PTP alert', getValue: (customer) => customer.hasBrokenPtp ? 'Broken PTP' : 'Standard' },
                ]}
                loading={isLoadingData}
                emptyText="No collection accounts match the selected dashboard filters."
              >
                {({ rows: pagePriorityQueue, startIndex, emptyMessage }) => (
                  <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-3">Rank</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Assigned Exec</th>
                    <th className="pb-3">Overdue Exposure</th>
                    <th className="pb-3">PTP Alert</th>
                    <th className="pb-3">Priority Score</th>
                    <th className="pb-3">Quick Action</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {pagePriorityQueue.map((c, index) => (
                    <tr key={c.id}>
                      <td className="py-3 font-black text-[#E50914]">#{startIndex + index + 1}</td>
                      <td className="py-3 font-bold">{c.name}</td>
                      <td className="py-3">{c.executive}</td>
                      <td className="py-3 font-bold text-[#E50914]">{formatDashboardCurrency(c.overdueAmt, c.currency)}</td>
                      <td className="py-3">
                        {c.hasBrokenPtp ? (
                          <span className="px-2 py-0.5 rounded bg-[#E50914] text-white text-[10px] font-bold">
                            Broken PTP
                          </span>
                        ) : (
                          <span className={`text-[11px] ${textMuted}`}>Standard</span>
                        )}
                      </td>
                      <td className="py-3 font-extrabold">{c.priorityScore} / 100</td>
                      <td className="py-3">
                        <button
                          onClick={() => {
                            const invoice = invoices.find((item) => item.id === c.id);
                            if (!invoice) {
                              showToast('Invoice details are unavailable. Refresh the queue.');
                              return;
                            }
                            openReminderForm({
                              customerId: invoice.customerId,
                              invoiceId: invoice.id,
                            });
                            setActiveModule('communications');
                          }}
                          className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                        >
                          Schedule Email
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!pagePriorityQueue.length && (
                    <tr><td colSpan="7" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                  </div>
                )}
              </DataTableTools>
            </div>
          )}

          {/* MODULE 8: TASKS & FOLLOW-UPS */}
          {activeModule === 'tasks' && (
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold">Collection Tasks & Call Follow-ups</h2>
                <button onClick={() => setShowTaskForm(true)} className="px-3 py-2 rounded-lg bg-[#E50914] text-white text-xs font-bold">
                  Create Task
                </button>
              </div>
              <DataTableTools
                rows={tasks}
                searchLabel="tasks"
                getSearchText={(task) => [
                  task.id,
                  task.customerName,
                  task.title,
                  task.dueDate,
                  task.priority,
                  task.status,
                ].join(' ')}
                filters={[
                  { key: 'status', label: 'status', getValue: (task) => task.status },
                  { key: 'priority', label: 'priority', getValue: (task) => task.priority },
                ]}
                loading={isLoadingData}
                emptyText="No collection tasks were returned by the backend."
              >
                {({ rows: pageTasks, emptyMessage }) => (
                  <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[650px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-3">Task ID</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Action Item</th>
                    <th className="pb-3">Due Date</th>
                    <th className="pb-3">Priority</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Complete</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {pageTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="py-3 font-mono">{t.id}</td>
                      <td className="py-3 font-bold">{t.customerName}</td>
                      <td className="py-3">{t.title}</td>
                      <td className="py-3">{t.dueDate}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-bold">
                          {t.priority}
                        </span>
                      </td>
                      <td className="py-3">{t.status}</td>
                      <td className="py-3">
                        {t.statusCode !== 'COMPLETED' && t.statusCode !== 'CANCELLED' && (
                          <button
                            onClick={() => handleCompleteTask(t)}
                            className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold"
                          >
                            Mark Done
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pageTasks.length && (
                    <tr><td colSpan="7" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                  </div>
                )}
              </DataTableTools>
            </div>
          )}

          {/* MODULE 9: PROMISE-TO-PAY (PTP) TRACKER */}
          {activeModule === 'promises' && (
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-bold">Promise-to-Pay (PTP) Commitment Engine</h2>
                <button onClick={() => setShowPromiseForm(true)} className="px-3 py-2 rounded-lg bg-[#E50914] text-white text-xs font-bold">
                  Record Promise
                </button>
              </div>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Reconciles promises against posted receipt allocations to track outcomes.
              </p>
              <DataTableTools
                rows={enrichedPtps}
                searchLabel="payment promises"
                getSearchText={(promise) => [
                  promise.id,
                  promise.customerName,
                  promise.invoiceId,
                  promise.promisedDate,
                  promise.status,
                  promise.promisedAmount,
                ].join(' ')}
                filters={[
                  { key: 'status', label: 'status', getValue: (promise) => promise.status },
                ]}
                loading={isLoadingData}
                emptyText="No payment promises were returned by the backend."
              >
                {({ rows: pagePromises, emptyMessage }) => (
                  <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-3">PTP ID</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Invoice</th>
                    <th className="pb-3">Promised Amount</th>
                    <th className="pb-3">Promised Date</th>
                    <th className="pb-3">Verified Paid</th>
                    <th className="pb-3">Auto Status</th>
                    <th className="pb-3">Update</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {pagePromises.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 font-mono">{p.id}</td>
                      <td className="py-3 font-bold">{p.customerName}</td>
                      <td className="py-3">{p.invoiceId}</td>
                      <td className="py-3 font-bold">{formatDashboardCurrency(p.promisedAmount, p.currency)}</td>
                      <td className="py-3">{p.promisedDate}</td>
                      <td className="py-3 text-emerald-400">{formatDashboardCurrency(p.paidSincePtp, p.currency)}</td>
                      <td className="py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            p.status === 'Fulfilled'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : p.status === 'Broken'
                              ? 'bg-[#E50914] text-white'
                              : 'bg-amber-500/15 text-amber-400'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3">
                        {p.status === 'Open' && (
                          <div className="flex gap-1">
                            <button onClick={() => handlePromiseStatus(p, 'KEPT')} className="px-2 py-1 rounded bg-emerald-600 text-white">Kept</button>
                            <button onClick={() => handlePromiseStatus(p, 'BROKEN')} className="px-2 py-1 rounded bg-rose-700 text-white">Broken</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pagePromises.length && (
                    <tr><td colSpan="8" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                  </div>
                )}
              </DataTableTools>
            </div>
          )}

          {/* MODULE 10: DISPUTES MANAGEMENT */}
          {activeModule === 'disputes' && (
            <div className="space-y-5">
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-bold">Invoice Disputes</h2>
                <button onClick={() => setShowDisputeForm(true)} className="px-3 py-2 rounded-lg bg-[#E50914] text-white text-xs font-bold">
                  Record Dispute
                </button>
              </div>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Review and resolve disputes through the backend workflow.
              </p>
              <DataTableTools
                rows={disputes}
                searchLabel="invoice disputes"
                getSearchText={(dispute) => [
                  dispute.id,
                  dispute.customerName,
                  dispute.invoiceId,
                  dispute.reason,
                  dispute.category,
                  dispute.status,
                ].join(' ')}
                filters={[
                  { key: 'status', label: 'status', getValue: (dispute) => dispute.status },
                ]}
                loading={isLoadingData}
                emptyText="No disputes were returned by the backend."
              >
                {({ rows: pageDisputes, emptyMessage }) => (
                  <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[680px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-3">Dispute ID</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Invoice</th>
                    <th className="pb-3">Disputed Amt</th>
                    <th className="pb-3">Reason</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Resolution</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {pageDisputes.map((d) => (
                    <tr key={d.id}>
                      <td className="py-3 font-mono">{d.id}</td>
                      <td className="py-3 font-bold">{d.customerName}</td>
                      <td className="py-3">{d.invoiceId}</td>
                      <td className="py-3 font-bold text-amber-400">{formatINR(d.disputedAmount)}</td>
                      <td className="py-3">{d.category}</td>
                      <td className="py-3">{d.status}</td>
                      <td className="py-3">
                        {d.status !== 'Resolved' && (
                          <button
                            onClick={() => handleResolveDispute(d)}
                            className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                          >
                            Resolve Dispute
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pageDisputes.length && (
                    <tr><td colSpan="7" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                  </div>
                )}
              </DataTableTools>
            </div>
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold">Credit Adjustments</h3>
                  <p className={`text-xs ${textMuted}`}>Approvals change outstanding balances only after the backend confirms approval.</p>
                </div>
                <button onClick={() => setShowAdjustmentForm(true)} className="px-3 py-2 rounded-lg bg-[#E50914] text-white text-xs font-bold">
                  Request Adjustment
                </button>
              </div>
              <DataTableTools
                rows={creditNotes}
                searchLabel="credit adjustments"
                getSearchText={(adjustment) => [
                  adjustment.adjustmentNumber,
                  adjustment.invoiceNumber,
                  adjustment.invoiceId,
                  adjustment.reason,
                  adjustment.status,
                  adjustment.amount,
                ].join(' ')}
                filters={[
                  { key: 'status', label: 'status', getValue: (adjustment) => adjustment.status },
                ]}
                loading={isLoadingData}
                emptyText="No credit adjustments were returned by the backend."
              >
                {({ rows: pageAdjustments, emptyMessage }) => (
                  <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead><tr className={`border-b ${borderSubtle} ${textMuted}`}>
                  <th className="pb-3">Adjustment</th><th className="pb-3">Invoice</th><th className="pb-3">Reason</th><th className="pb-3">Amount</th><th className="pb-3">Status</th><th className="pb-3">Decision</th>
                </tr></thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {pageAdjustments.map((adjustment) => (
                    <tr key={adjustment.id}>
                      <td className="py-3 font-mono">{adjustment.adjustmentNumber || adjustment.id}</td>
                      <td className="py-3">{adjustment.invoiceNumber || adjustment.invoiceId}</td>
                      <td className="py-3">{adjustment.reason}</td>
                      <td className="py-3 font-bold">{formatINR(adjustment.amount)}</td>
                      <td className="py-3">{adjustment.status}</td>
                      <td className="py-3">
                        {adjustment.status === 'Pending' && (
                          <div className="flex gap-1">
                            <button onClick={() => handleAdjustmentDecision(adjustment, 'approve')} className="px-2 py-1 rounded bg-emerald-600 text-white">Approve</button>
                            <button onClick={() => handleAdjustmentDecision(adjustment, 'reject')} className="px-2 py-1 rounded bg-rose-700 text-white">Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!pageAdjustments.length && (
                    <tr><td colSpan="6" className={`py-5 text-center ${textMuted}`}>{emptyMessage}</td></tr>
                  )}
                </tbody>
              </table>
                  </div>
                )}
              </DataTableTools>
            </div>
            </div>
          )}

          {/* MODULE 11: EMAIL REMINDERS AND INTERACTIONS */}
          {activeModule === 'communications' && (
            <div className="space-y-6">
              <div className={`p-6 rounded-2xl border ${bgCard}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold">Email Reminder Scheduling & Communication History</h2>
                    <p className={`text-xs ${textMuted}`}>
                      Schedule email reminders through the backend. Delivery status is shown only when the backend scheduler records it.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleTriggerReminders()}
                      className="px-4 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white text-xs font-bold flex items-center space-x-2 self-start"
                    >
                      <Send className="w-4 h-4" />
                      <span>Schedule Due Email Reminders</span>
                    </button>
                    <button onClick={() => setShowCommunicationForm(true)} className={`px-4 py-2.5 rounded-xl border text-xs font-bold ${bgSurface}`}>
                      Record Email Activity
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className={`p-4 rounded-xl border ${bgSurface}`}>
                    <div className="flex items-center gap-2 text-blue-400 font-bold text-sm"><Mail className="w-5 h-5" />Email</div>
                    <p className={`text-xs mb-4 ${textMuted}`}>
                      Schedule email notifications through the existing SMTP-backed reminder scheduler.
                    </p>
                    <button
                      onClick={() => openReminderForm()}
                      className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition"
                    >
                      Schedule Email Reminder
                    </button>
                  </div>

                  <div className={`p-4 rounded-xl border ${bgSurface}`}>
                    <div className="flex items-center gap-2 font-bold text-sm"><MessageSquare className="w-5 h-5" />Email activity</div>
                    <p className={`text-xs mt-3 ${textMuted}`}>Record email activity for the customer timeline. This form does not send email.</p>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border ${bgSurface}`}>
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-2">Due-Date Automation</h4>
                  <p className={`text-xs ${textMuted}`}>Cadence rules and automated notifications are controlled by the existing backend scheduler; this page does not simulate or modify its configuration.</p>
                </div>
              </div>

              <div className={`p-5 rounded-2xl border ${bgCard}`}>
                <h3 className="text-sm font-bold mb-4">Scheduled Email Reminder History</h3>
                <DataTableTools
                  rows={reminders}
                  searchLabel="email reminders"
                  getSearchText={(reminder) => [
                    reminder.customerName,
                    reminder.invoiceId,
                    reminder.channel,
                    reminder.status,
                    reminder.deliveryStatus,
                    reminder.scheduledFor,
                  ].join(' ')}
                  filters={[
                    { key: 'status', label: 'status', getValue: (reminder) => reminder.deliveryStatus || reminder.status },
                  ]}
                  loading={isLoadingData}
                  emptyText="No reminders were recorded."
                >
                  {({ rows: pageReminders, emptyMessage }) => (
                    <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead><tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-3">Scheduled</th><th className="pb-3">Customer</th><th className="pb-3">Invoice</th><th className="pb-3">Channel</th><th className="pb-3">Status</th><th className="pb-3">Action</th>
                  </tr></thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {pageReminders.map((reminder) => (
                      <tr key={reminder.id}>
                        <td className="py-3">{formatReminderDateTime(reminder.scheduledFor)}</td>
                        <td className="py-3">{reminder.customerName}</td>
                        <td className="py-3">{reminder.invoiceId || '-'}</td>
                        <td className="py-3">{reminder.channel}</td>
                        <td className={`py-3 ${reminder.deliveryStatus === 'Sent' ? 'text-emerald-400' : reminder.deliveryStatus === 'Failed' ? 'text-rose-400' : textMuted}`}>
                          <div>{reminder.deliveryStatus || reminder.status}</div>
                          {reminder.deliveryStatus === 'Disabled' && reminder.lastError === 'DELIVERY_DISABLED' && (
                            <div className="mt-1 max-w-[220px] text-[10px] leading-4 text-amber-400">
                              Email delivery is disabled for this runtime.
                            </div>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            {canSendReminderNow(reminder, currentRole) && (
                              <button
                                onClick={() => handlePreviewReminderEmail(reminder)}
                                disabled={loadingReminderPreviewId === reminder.id || sendingReminderId === reminder.id}
                                aria-label={`Preview and send reminder for ${reminder.customerName}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-sky-500/40 text-sky-400 hover:bg-sky-500/10 font-semibold disabled:opacity-50"
                              >
                                <Send className="w-3.5 h-3.5" />
                                {loadingReminderPreviewId === reminder.id ? 'Preparing…' : 'Send Now'}
                              </button>
                            )}
                            {canCancelReminder(reminder) && (
                              <button
                                onClick={() => handleReminderStatus(reminder, 'CANCELLED')}
                                className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 font-semibold"
                              >
                                Cancel
                              </button>
                            )}
                            {canDeleteReminder(reminder, currentRole) && (
                              <button
                                onClick={() => setReminderToDelete(reminder)}
                                disabled={deletingReminderId === reminder.id}
                                aria-label={`Delete reminder for ${reminder.customerName}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 font-semibold disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!pageReminders.length && <tr><td colSpan="6" className={`py-4 ${textMuted}`}>{emptyMessage}</td></tr>}
                  </tbody>
                </table>
                    </div>
                  )}
                </DataTableTools>
              </div>

              {reminderTemplates.length > 0 && (
                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-sm font-bold">Backend Reminder Templates</h3>
                    <button onClick={() => setShowTemplateForm(true)} className="rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white">Create Template</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {reminderTemplates.map((template) => (
                      <div key={template.id} className={`rounded-xl border p-3 ${bgSurface}`}>
                        <div className="flex justify-between gap-2">
                          <p className="text-xs font-bold">{template.name}</p>
                          <button onClick={() => handleToggleReminderTemplate(template)} className={`text-[10px] ${template.isActive ? 'text-emerald-400' : 'text-amber-400'}`}>{template.isActive ? 'Active' : 'Inactive'}</button>
                        </div>
                        <p className={`mt-1 text-[11px] ${textMuted}`}>{template.triggerStage} · Email</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!reminderTemplates.length && (
                <div className={`rounded-2xl border p-5 ${bgCard}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div><h3 className="text-sm font-bold">Reminder Templates</h3><p className={`mt-1 text-xs ${textMuted}`}>No backend templates are configured.</p></div>
                    <button onClick={() => setShowTemplateForm(true)} className="rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white">Create Template</button>
                  </div>
                </div>
              )}

              <div className={`p-5 rounded-2xl border ${bgCard}`}>
                <h3 className="text-sm font-bold mb-4">Email Communication History</h3>
                <DataTableTools
                  rows={commLogs}
                  searchLabel="email communication history"
                  getSearchText={(log) => [
                    log.customer,
                    log.channel,
                    log.trigger,
                    log.status,
                    log.message,
                    log.timestamp,
                  ].join(' ')}
                  filters={[
                    { key: 'channel', label: 'channel', getValue: (log) => log.channel },
                    { key: 'status', label: 'status', getValue: (log) => log.status },
                  ]}
                  loading={isLoadingData}
                  emptyText="No email communication records were returned by the backend."
                >
                  {({ rows: pageCommunicationLogs, emptyMessage }) => (
                    <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[750px]">
                  <thead>
                    <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                      <th className="pb-3">Timestamp</th>
                      <th className="pb-3">Customer</th>
                      <th className="pb-3">Channel</th>
                      <th className="pb-3">Trigger Rule</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Dispatched Content</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {pageCommunicationLogs.map((log) => (
                      <tr key={log.id}>
                        <td className={`py-3 ${textMuted}`}>{log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}</td>
                        <td className="py-3 font-bold">{log.customer}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-bold">
                            {log.channel}
                          </span>
                        </td>
                        <td className="py-3">{log.trigger}</td>
                        <td className={`py-3 font-semibold ${['Sent', 'Delivered'].includes(log.status) ? 'text-emerald-400' : ['Failed', 'Bounced'].includes(log.status) ? 'text-rose-400' : textMuted}`}>● {log.status}</td>
                        <td className="py-3 max-w-md truncate">{log.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                    {!pageCommunicationLogs.length && (
                      <p className={`pt-4 text-xs ${textMuted}`}>{emptyMessage}</p>
                    )}
                    </div>
                  )}
                </DataTableTools>
              </div>
            </div>
          )}

          {/* MODULE 12: CUSTOMER STATEMENTS */}
          {activeModule === 'statements' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Statement of Account (SOA) Generator</h2>
                  <p className={`text-xs ${textMuted}`}>Official ledger statement reconciled with posted receipts and credit notes.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={statementCustomerId}
                    onChange={(e) => setStatementCustomerId(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    <option value="">Choose customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                  <input type="date" value={statementFromDate} onChange={(e) => setStatementFromDate(e.target.value)} className={`text-xs p-2 rounded-xl border ${bgCard}`} />
                  <input type="date" value={statementToDate} onChange={(e) => setStatementToDate(e.target.value)} className={`text-xs p-2 rounded-xl border ${bgCard}`} />
                  <button
                    onClick={handleGenerateStatement}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold ${bgSurface}`}
                  >
                    Generate
                  </button>
                  <button
                    onClick={handleDownloadStatement}
                    disabled={!statementData}
                    className="px-4 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download PDF</span>
                  </button>
                  <button
                    onClick={handlePrintStatement}
                    disabled={!statementData}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold disabled:opacity-50 ${bgSurface}`}
                  >
                    Print PDF
                  </button>
                </div>
              </div>

              {statementData ? (
                <div className={`p-6 rounded-2xl border space-y-5 ${bgCard}`}>
                  <div className="flex flex-wrap justify-between items-start gap-3 border-b pb-4 border-gray-800/30">
                    <div>
                      <span className="text-xs font-black text-[#E50914]">STATEMENT OF ACCOUNT</span>
                      <h3 className="text-xl font-bold mt-1">{statementData.customer.name}</h3>
                      <p className={`text-xs ${textMuted}`}>{statementData.customer.email} · {new Date(statementData.period.fromDate).toLocaleDateString()} – {new Date(statementData.period.toDate).toLocaleDateString()}</p>
                    </div>
                    <p className={`text-xs ${textMuted}`}>Balances are shown separately by currency.</p>
                  </div>
                  {statementCurrencyEntries.length ? (
                    statementCurrencyEntries.map(([currency, summary]) => {
                      const currencyTransactions = statementData.transactions.filter(
                        (transaction) => transaction.currency === currency,
                      );

                      return (
                        <section key={currency} className={`rounded-xl border p-4 space-y-4 ${borderSubtle}`}>
                          <div className="flex flex-wrap justify-between items-start gap-3">
                            <div>
                              <h4 className="text-sm font-bold">{currency} Statement</h4>
                              <p className={`text-xs ${textMuted}`}>
                                Opening balance: {formatDashboardCurrency(summary.openingBalance, currency)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-xs ${textMuted}`}>Closing Balance Due</p>
                              <p className="text-xl font-extrabold text-[#E50914]">
                                {formatDashboardCurrency(summary.closingOutstanding, currency)}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {[
                              ["Invoices", summary.totalInvoices],
                              ["Receipts", summary.totalReceipts],
                              ["Credit adjustments", summary.adjustments],
                            ].map(([label, amount]) => (
                              <div key={label} className={`rounded-lg border p-3 ${borderSubtle}`}>
                                <p className={`text-xs ${textMuted}`}>{label}</p>
                                <p className="mt-1 text-sm font-bold">
                                  {formatDashboardCurrency(amount, currency)}
                                </p>
                              </div>
                            ))}
                          </div>
                          <DataTableTools
                            rows={currencyTransactions}
                            searchLabel={`${currency} statement transactions`}
                            getSearchText={(transaction) => [
                              transaction.reference,
                              transaction.description,
                              transaction.date,
                              transaction.debit,
                              transaction.credit,
                            ].join(' ')}
                            loading={isLoadingData}
                            emptyText="No transactions in this currency during the selected period."
                          >
                            {({ rows: pageCurrencyTransactions, emptyMessage }) => (
                              <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                                <th className="pb-2">Date</th>
                                <th className="pb-2">Document #</th>
                                <th className="pb-2">Debit</th>
                                <th className="pb-2">Credit</th>
                                <th className="pb-2">Balance</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${borderSubtle}`}>
                              {pageCurrencyTransactions.map((transaction, index) => (
                                <tr key={`${transaction.currency}-${transaction.reference}-${index}`}>
                                  <td className="py-2.5">{new Date(transaction.date).toLocaleDateString()}</td>
                                  <td className="py-2.5 font-bold">{transaction.reference} · {transaction.description}</td>
                                  <td className="py-2.5">{formatDashboardCurrency(transaction.debit, transaction.currency)}</td>
                                  <td className="py-2.5 text-emerald-400">
                                    {formatDashboardCurrency(transaction.credit, transaction.currency)}
                                  </td>
                                  <td className="py-2.5 font-bold">
                                    {formatDashboardCurrency(transaction.balance, transaction.currency)}
                                  </td>
                                </tr>
                              ))}
                              {!pageCurrencyTransactions.length && (
                                <tr>
                                  <td colSpan="5" className={`py-4 ${textMuted}`}>
                                    {emptyMessage}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                              </div>
                            )}
                          </DataTableTools>
                        </section>
                      );
                    })
                  ) : (
                    <p className={`py-4 text-xs ${textMuted}`}>
                      No balances or transactions in this statement period.
                    </p>
                  )}
                </div>
              ) : (
                <p className={`rounded-2xl border p-5 text-xs ${textMuted} ${bgCard}`}>Choose a customer and date range, then generate the backend statement.</p>
              )}
            </div>
          )}

          {/* MODULE 13: REPORTS & ANALYTICS */}
          {activeModule === 'reports' && (
            <div className={`space-y-5 rounded-2xl border p-5 ${bgCard}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Backend Reports & Analytics</h2>
                  <p className={`text-xs ${textMuted}`}>Load or export one of the reports supported by the backend.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={selectedReport} onChange={(event) => setSelectedReport(event.target.value)} className={`rounded-lg border p-2 text-xs ${bgSurface}`}>
                    {[
                      ['invoices', 'Invoices'],
                      ['collections', 'Collections / Payments'],
                      ['outstanding', 'Outstanding Accounts'],
                      ['overdue', 'Overdue Receivables'],
                      ['customers', 'Customer Accounts'],
                      ['credits', 'Credit Adjustments'],
                      ['ageing', 'Ageing']
                    ].map(([report, label]) => <option key={report} value={report}>{label}</option>)}
                  </select>
                  <button onClick={handleLoadReport} className="rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white">Load Report</button>
                  {selectedReport !== 'ageing' && (
                    <>
                      <button onClick={() => handleExportReport('csv')} className={`rounded-lg border px-3 py-2 text-xs font-bold ${bgSurface}`}>CSV</button>
                      <button onClick={() => handleExportReport('xlsx')} className={`rounded-lg border px-3 py-2 text-xs font-bold ${bgSurface}`}>Excel</button>
                    </>
                  )}
                  <button onClick={() => handleExportReport('pdf')} className={`rounded-lg border px-3 py-2 text-xs font-bold ${bgSurface}`}>Download PDF</button>
                  <button onClick={handlePrintReport} className="rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white">Print PDF</button>
                </div>
              </div>
              {reportData && (
                <div className="space-y-3">
                  <div className={`text-xs ${textMuted}`}>
                    {reportData.count} records{reportData.total !== undefined ? ` · Total ${formatINR(reportData.total)}` : ''}
                  </div>
                  <DataTableTools
                    rows={reportData.rows}
                    searchLabel="report results"
                    getSearchText={(row) => Object.values(row)
                      .map((value) => typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
                      .join(' ')}
                    emptyText="No report rows were returned by the backend."
                  >
                    {({ rows: pageReportRows, emptyMessage }) => (
                      <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-xs">
                      <thead><tr className={`border-b ${borderSubtle} ${textMuted}`}>
                        {(reportData.rows[0] ? Object.keys(reportData.rows[0]) : []).map((key) => <th key={key} className="pb-3 pr-4">{key}</th>)}
                      </tr></thead>
                      <tbody className={`divide-y ${borderSubtle}`}>
                        {pageReportRows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {Object.values(row).map((value, valueIndex) => <td key={valueIndex} className="py-3 pr-4">{value == null ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>)}
                          </tr>
                        ))}
                        {!pageReportRows.length && <tr><td className={`py-4 ${textMuted}`} colSpan="6">{emptyMessage}</td></tr>}
                      </tbody>
                    </table>
                      </div>
                    )}
                  </DataTableTools>
                </div>
              )}
            </div>
          )}

          {/* MODULE 14: SUBSCRIPTION & BILLING */}
          {activeModule === 'billing' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-extrabold">Subscription & Billing</h2>
                  <p className={'text-sm mt-1 ' + textMuted}>Management-approved plans, renewal dates, usage and billing documents.</p>
                </div>
                <span className={'px-4 py-2 rounded-xl text-xs font-bold ' + (currentSubscription ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-400')}>
                  {currentSubscription ? currentSubscription.status : 'NO ACTIVE SUBSCRIPTION'}
                </span>
              </div>

              <div className={'rounded-2xl p-6 border border-[#E50914]/40 ' + bgCard}>
                <p className={'text-xs font-bold uppercase tracking-wider ' + textMuted}>Current Subscription</p>
                <h3 className="text-3xl font-extrabold mt-2">{currentSubscription?.plan?.name || 'No plan assigned'}</h3>
                <p className={'text-sm mt-2 ' + textMuted}>
                  {currentSubscription
                    ? `${typeof currentSubscription.billingCycle === 'string' ? `${currentSubscription.billingCycle.toLowerCase()} billing` : 'Billing cycle unavailable'}${currentSubscription.billingAmount != null && Number.isFinite(Number(currentSubscription.billingAmount)) ? ` · ${currentSubscription.currency || 'INR'} ${Number(currentSubscription.billingAmount).toFixed(2)}` : ''}`
                    : 'No active organization subscription. Use Subscription Plans to review available plans.'}
                </p>
                {currentSubscription?.endsAt && (
                  <p className={'text-sm mt-2 ' + textMuted}>
                    Expires / renews: {new Date(currentSubscription.endsAt).toLocaleDateString()}
                  </p>
                )}
                {canAccessOrganizationBillingPortal(currentRole) && (
                  <button
                    type="button"
                    onClick={() => setActiveModule('organization-plans')}
                    className="mt-4 rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-bold text-white"
                  >
                    View subscription plans
                  </button>
                )}
              </div>

              <div>
                <h3 className="text-lg font-bold mb-3">Usage Overview</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Users', value: subscriptionUsage?.users },
                    { label: 'Customers', value: subscriptionUsage?.customers },
                    { label: 'Invoices This Month', value: subscriptionUsage?.monthlyInvoices },
                  ].map((item) => (
                    <div key={item.label} className={'p-5 rounded-2xl border ' + bgCard}>
                      <p className={'text-xs font-semibold ' + textMuted}>{item.label}</p>
                      <p className="text-lg font-bold mt-3">
                        {!item.value
                          ? 'Unavailable'
                          : !item.value.configured
                            ? `${item.value.used} · limits pending approval`
                            : `${item.value.used} / ${item.value.unlimited ? 'Unlimited' : item.value.limit}`}
                      </p>
                      {item.value?.configured && !item.value.unlimited && (
                        <p className={'text-[10px] mt-1 ' + textMuted}>{item.value.remaining} remaining</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {currentRole === 'SUPER_ADMIN' && (
                <section className={'rounded-2xl border p-5 space-y-4 ' + bgCard}>
                  <div>
                    <h3 className="text-lg font-bold">Management Plan Configuration</h3>
                    <p className={'text-xs mt-1 ' + textMuted}>Official Starter, Growth and Business monthly prices are fixed in the backend catalog and do not require pricing approval. Optional limit proposals remain subject to approval; blank limits are treated as unlimited only after approval.</p>
                  </div>
                  <div className="space-y-4">
                    {subscriptionPlanConfigs.map((plan) => {
                      const draft = planConfigDrafts[plan.code] || {};
                      const isBuiltInPlan = OFFICIAL_SAAS_PLANS.some(
                        (officialPlan) => officialPlan.code === plan.code
                      );
                      const updateDraft = (field, value) => setPlanConfigDrafts((existing) => ({
                        ...existing,
                        [plan.code]: { ...(existing[plan.code] || {}), [field]: value },
                      }));
                      const fields = [
                        ['proposedMonthlyPrice', 'Proposed monthly price (INR)'],
                        ['proposedYearlyPrice', 'Proposed annual price (INR)'],
                        ['proposedMaxUsers', 'Maximum users'],
                        ['proposedMaxCustomers', 'Maximum customers'],
                        ['proposedMaxInvoicesPerMonth', 'Invoices per month'],
                      ];
                      return (
                        <div key={plan.id} className="rounded-xl border border-gray-500/20 p-4">
                          <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                            <h4 className="font-bold">{plan.name}</h4>
                            <p className={'text-xs ' + textMuted}>
                              {isBuiltInPlan
                                ? 'Official built-in plan · pricing approval is not required'
                                : `Active pricing: ${plan.pricingStatus} · Proposed pricing: ${plan.pricingProposalStatus} · ${plan.isActive ? 'Purchasable' : 'Not purchasable'}`}
                              {` · Active limits: ${plan.limitsStatus} · Proposed limits: ${plan.limitsProposalStatus}`}
                            </p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
                            {fields.map(([field, label]) => (
                              <label key={field} className={'text-xs ' + textMuted}>
                                {label}
                                <input
                                  type="number"
                                  min="0"
                                  step={field.includes('Price') ? '0.01' : '1'}
                                  value={draft[field] ?? ''}
                                  onChange={(event) => updateDraft(field, event.target.value)}
                                  className={`block w-full mt-1 rounded-lg border p-2 text-sm ${bgSurface}`}
                                />
                              </label>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2 mt-4">
                            <button onClick={() => handleSavePlanProposal(plan)} className="rounded-lg bg-slate-600 px-3 py-2 text-xs font-bold text-white">Save proposal</button>
                            <button onClick={() => handleApprovePlan(plan, 'pricingApproved')} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">Approve pricing</button>
                            <button onClick={() => handleApprovePlan(plan, 'limitsApproved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Approve limits (blank = unlimited)</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <Suspense fallback={<div className={`rounded-2xl border p-5 text-xs ${bgCard} ${textMuted}`} role="status">Loading customer plans…</div>}>
                <OrganizationCustomerPlanManager
                  token={authToken}
                  role={currentRole}
                  active={activeModule === 'billing'}
                  bgCard={bgCard}
                  bgSurface={bgSurface}
                  textMuted={textMuted}
                />
              </Suspense>

              <div className={'rounded-2xl border p-5 ' + bgCard}>
                <h3 className="text-lg font-bold">Billing History</h3>
                <DataTableTools
                  rows={billingHistory}
                  searchLabel="billing history"
                  getSearchText={(invoice) => [
                    invoice.invoiceNumber,
                    invoice.planName,
                    invoice.billingCycle,
                    invoice.periodStart,
                    invoice.periodEnd,
                  ].join(' ')}
                  loading={isLoadingData}
                  emptyText="No subscription invoices yet."
                >
                  {({ rows: pageBillingHistory, emptyMessage }) => (
                    <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead><tr className={textMuted}><th className="p-2">Invoice</th><th className="p-2">Plan</th><th className="p-2">Period</th><th className="p-2">Amount</th><th className="p-2">Document</th></tr></thead>
                      <tbody>
                        {pageBillingHistory.map((invoice) => (
                          <tr key={invoice.id} className="border-t border-gray-500/20">
                            <td className="p-2">{invoice.invoiceNumber}</td>
                            <td className="p-2">{invoice.planName} ({invoice.billingCycle.toLowerCase()})</td>
                            <td className="p-2">{new Date(invoice.periodStart).toLocaleDateString()} – {new Date(invoice.periodEnd).toLocaleDateString()}</td>
                            <td className="p-2">{invoice.currency} {Number(invoice.amount).toFixed(2)}</td>
                            <td className="p-2">
                              <button
                                onClick={() => downloadProtectedFile(`/api/subscriptions/billing/invoices/${encodeURIComponent(invoice.id)}/pdf`, `${invoice.invoiceNumber}.pdf`)}
                                className="font-bold text-[#E50914]"
                              >
                                Download PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                        {!pageBillingHistory.length && (
                          <tr><td className={`p-4 ${textMuted}`} colSpan="5">{emptyMessage}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  )}
                </DataTableTools>
              </div>
            </div>
          )}

          {activeModule === 'organization-plans' && (
            <Suspense
              fallback={
                <div className={`rounded-2xl border p-5 text-xs ${bgCard} ${textMuted}`} role="status">
                  Loading organization subscription plans…
                </div>
              }
            >
              <OrganizationSubscriptionPlans
                role={currentRole}
                plans={availableSubscriptionPlans}
                billingConfiguration={razorpayBillingConfiguration}
                currentSubscription={currentSubscription}
                billingCycle={activeSubscriptionBillingCycle}
                onBillingCycleChange={setSubscriptionBillingCycle}
                isProcessing={isProcessingBilling}
                isLoading={isLoadingData}
                onCheckout={handleSubscriptionCheckout}
                onToggleAutoRenew={handleOrganizationAutoRenew}
                onContactSales={() => showToast('Contact Alpha Auron to discuss Enterprise pricing.')}
                bgCard={bgCard}
                bgSurface={bgSurface}
                textMuted={textMuted}
              />
            </Suspense>
          )}
          </div>
        </main>
      </div>

      <AnimatedOverlay
        open={showTaskForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateTask} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Create Collection Task</h3><button type="button" onClick={() => setShowTaskForm(false)}><X className="h-5 w-5" /></button></div>
            <input required placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <select required value={taskForm.customerId} onChange={(e) => setTaskForm({ ...taskForm, customerId: e.target.value, invoiceId: '' })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <select value={taskForm.invoiceId} onChange={(e) => setTaskForm({ ...taskForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">No invoice linked</option>{invoices.filter((invoice) => invoice.customerId === taskForm.customerId).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input required type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`} />
              <select value={taskForm.taskType} onChange={(e) => setTaskForm({ ...taskForm, taskType: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`}>
                {['CALL', 'EMAIL', 'VISIT', 'OTHER'].map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`}>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
              <input placeholder="Assigned executive" value={taskForm.assignedExecutive} onChange={(e) => setTaskForm({ ...taskForm, assignedExecutive: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`} />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Save Task</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={Boolean(reminderToSend)}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      >
        {reminderToSend && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-reminder-title"
            className={`w-full max-w-xl rounded-2xl border p-6 shadow-2xl ${bgCard}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-sky-500/10 p-2 text-sky-400">
                  <Send className="h-5 w-5" />
                </span>
                <div>
                  <h3 id="send-reminder-title" className="text-base font-bold">Preview reminder email</h3>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                    Review the verified recipient and email content before sending.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close reminder email preview"
                disabled={sendingReminderId === reminderToSend.id}
                onClick={() => {
                  setReminderToSend(null);
                  setReminderEmailPreview(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/5 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {loadingReminderPreviewId === reminderToSend.id ? (
              <p className={`mt-5 rounded-xl border p-4 text-sm ${bgSurface} ${textMuted}`}>
                Preparing the current reminder email preview…
              </p>
            ) : reminderEmailPreview ? (
              <div className="mt-5 space-y-3">
                <div>
                  <label className={`mb-1 block text-[10px] font-bold uppercase tracking-wider ${textMuted}`} htmlFor="reminder-preview-recipient">Recipient</label>
                  <div id="reminder-preview-recipient" className={`rounded-lg border p-3 text-xs ${bgSurface}`}>
                    {reminderEmailPreview.recipient}
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-[10px] font-bold uppercase tracking-wider ${textMuted}`} htmlFor="reminder-preview-subject">Subject</label>
                  <div id="reminder-preview-subject" className={`rounded-lg border p-3 text-xs ${bgSurface}`}>
                    {reminderEmailPreview.subject}
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-[10px] font-bold uppercase tracking-wider ${textMuted}`} htmlFor="reminder-preview-message">Message</label>
                  <pre id="reminder-preview-message" className={`max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3 font-sans text-xs ${bgSurface}`}>
                    {reminderEmailPreview.message}
                  </pre>
                </div>
                <p className={`rounded-xl border p-3 text-xs ${bgSurface} ${textMuted}`}>
                  Confirming sends this email immediately to the verified portal address above.
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={sendingReminderId === reminderToSend.id}
                onClick={() => {
                  setReminderToSend(null);
                  setReminderEmailPreview(null);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${bgSurface}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reminderEmailPreview || loadingReminderPreviewId === reminderToSend.id || sendingReminderId === reminderToSend.id}
                onClick={handleSendReminderNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {sendingReminderId === reminderToSend.id ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        )}
      </AnimatedOverlay>

      <AnimatedOverlay
        open={Boolean(reminderToDelete)}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      >
        {reminderToDelete && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-reminder-title"
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${bgCard}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-rose-500/10 p-2 text-rose-400">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <h3 id="delete-reminder-title" className="text-base font-bold">Delete email reminder?</h3>
                  <p className={`mt-1 text-xs ${textMuted}`}>
                    This will permanently remove the reminder for {reminderToDelete.customerName || 'this customer'}.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close delete reminder confirmation"
                disabled={deletingReminderId === reminderToDelete.id}
                onClick={() => setReminderToDelete(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/5 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`mt-4 rounded-xl border p-3 text-xs ${bgSurface} ${textMuted}`}>
              Sent reminders are retained for audit history. Customer, invoice, payment, and receipt records will not be deleted.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingReminderId === reminderToDelete.id}
                onClick={() => setReminderToDelete(null)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${bgSurface}`}
              >
                Keep Reminder
              </button>
              <button
                type="button"
                disabled={deletingReminderId === reminderToDelete.id}
                onClick={handleDeleteReminder}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingReminderId === reminderToDelete.id ? 'Deleting…' : 'Delete Reminder'}
              </button>
            </div>
          </div>
        )}
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showPromiseForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreatePromise} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Record Promise-to-Pay</h3><button type="button" onClick={() => setShowPromiseForm(false)}><X className="h-5 w-5" /></button></div>
            <select required value={promiseForm.customerId} onChange={(e) => setPromiseForm({ ...promiseForm, customerId: e.target.value, invoiceId: '' })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <select required value={promiseForm.invoiceId} onChange={(e) => setPromiseForm({ ...promiseForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose invoice</option>{enrichedInvoices.filter((invoice) => invoice.customerId === promiseForm.customerId && invoice.outstanding > 0).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {formatINR(invoice.outstanding)}</option>)}
            </select>
            <input required type="number" min="0.01" step="0.01" placeholder="Promised amount" value={promiseForm.promisedAmount} onChange={(e) => setPromiseForm({ ...promiseForm, promisedAmount: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <input required type="date" value={promiseForm.promisedDate} onChange={(e) => setPromiseForm({ ...promiseForm, promisedDate: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <textarea placeholder="Notes (optional)" value={promiseForm.notes} onChange={(e) => setPromiseForm({ ...promiseForm, notes: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Save Promise</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showDisputeForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateDispute} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Record Invoice Dispute</h3><button type="button" onClick={() => setShowDisputeForm(false)}><X className="h-5 w-5" /></button></div>
            <select required value={disputeForm.customerId} onChange={(e) => setDisputeForm({ ...disputeForm, customerId: e.target.value, invoiceId: '' })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <select required value={disputeForm.invoiceId} onChange={(e) => setDisputeForm({ ...disputeForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose invoice</option>{invoices.filter((invoice) => invoice.customerId === disputeForm.customerId).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}
            </select>
            <input required placeholder="Reason" value={disputeForm.reason} onChange={(e) => setDisputeForm({ ...disputeForm, reason: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <textarea required placeholder="Description" value={disputeForm.description} onChange={(e) => setDisputeForm({ ...disputeForm, description: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" min="0.01" step="0.01" placeholder="Disputed amount (optional)" value={disputeForm.disputedAmount} onChange={(e) => setDisputeForm({ ...disputeForm, disputedAmount: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`} />
              <select value={disputeForm.priority} onChange={(e) => setDisputeForm({ ...disputeForm, priority: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`}>
                {['LOW', 'MEDIUM', 'HIGH'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Save Dispute</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showAdjustmentForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateAdjustment} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Request Credit Adjustment</h3><button type="button" onClick={() => setShowAdjustmentForm(false)}><X className="h-5 w-5" /></button></div>
            <select required value={adjustmentForm.invoiceId} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose invoice</option>{enrichedInvoices.filter((invoice) => invoice.outstanding > 0).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.customerName}</option>)}
            </select>
            <input required type="number" min="0.01" step="0.01" placeholder="Adjustment amount" value={adjustmentForm.amount} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <input required placeholder="Reason" value={adjustmentForm.reason} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <textarea placeholder="Notes (optional)" value={adjustmentForm.notes} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Submit for Approval</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showReminderForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateReminder} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Schedule Email Reminder</h3><button type="button" onClick={() => setShowReminderForm(false)}><X className="h-5 w-5" /></button></div>
            <select required value={reminderForm.customerId} onChange={(e) => setReminderForm({ ...reminderForm, customerId: e.target.value, invoiceId: '' })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose customer</option>{customers.filter((customer) => customer.email).map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}
            </select>
            <select required value={reminderForm.invoiceId} onChange={(e) => setReminderForm({ ...reminderForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose invoice</option>{enrichedInvoices.filter((invoice) => invoice.customerId === reminderForm.customerId && invoice.outstanding > 0).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {formatINR(invoice.outstanding)}</option>)}
            </select>
            <input required type="datetime-local" value={reminderForm.scheduledFor} onChange={(e) => setReminderForm({ ...reminderForm, scheduledFor: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <input placeholder="Email subject (optional)" value={reminderForm.subject} onChange={(e) => setReminderForm({ ...reminderForm, subject: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <textarea placeholder="Message (optional)" value={reminderForm.message} onChange={(e) => setReminderForm({ ...reminderForm, message: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Schedule Reminder</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showTemplateForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateReminderTemplate} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Create Email Reminder Template</h3><button type="button" onClick={() => setShowTemplateForm(false)}><X className="h-5 w-5" /></button></div>
            <input required placeholder="Template name" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <select value={templateForm.triggerStage} onChange={(e) => setTemplateForm({ ...templateForm, triggerStage: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              {['BEFORE_DUE_3_DAYS', 'DUE_DATE', 'OVERDUE_1_DAY'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
            <input placeholder="Subject (optional)" value={templateForm.subject} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <textarea required placeholder="Message; supported placeholders: {{customerName}}, {{invoiceNumber}}, {{amount}}, {{dueDate}}" value={templateForm.body} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} className={`min-h-32 w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Save Email Template</button>
          </form>
      </AnimatedOverlay>

      <AnimatedOverlay
        open={showCommunicationForm}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      >
          <form onSubmit={handleCreateCommunication} className={`w-full max-w-lg space-y-3 rounded-2xl border p-6 ${bgCard}`}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Record Email Activity</h3><button type="button" onClick={() => setShowCommunicationForm(false)}><X className="h-5 w-5" /></button></div>
            <select required value={communicationForm.customerId} onChange={(e) => setCommunicationForm({ ...communicationForm, customerId: e.target.value, invoiceId: '' })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <select value={communicationForm.invoiceId} onChange={(e) => setCommunicationForm({ ...communicationForm, invoiceId: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`}>
              <option value="">No invoice linked</option>{invoices.filter((invoice) => invoice.customerId === communicationForm.customerId).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-lg border p-2 text-xs ${bgSurface}`}>Email</div>
              <select value={communicationForm.direction} onChange={(e) => setCommunicationForm({ ...communicationForm, direction: e.target.value })} className={`rounded-lg border p-2 text-xs ${bgSurface}`}>
                {['OUTBOUND', 'INBOUND'].map((direction) => <option key={direction} value={direction}>{direction}</option>)}
              </select>
            </div>
            <textarea required placeholder="Email activity notes" value={communicationForm.message} onChange={(e) => setCommunicationForm({ ...communicationForm, message: e.target.value })} className={`min-h-24 w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <input placeholder="Outcome (optional)" value={communicationForm.outcome} onChange={(e) => setCommunicationForm({ ...communicationForm, outcome: e.target.value })} className={`w-full rounded-lg border p-2 text-xs ${bgSurface}`} />
            <p className={`text-[11px] ${textMuted}`}>This records email activity only; it does not send email.</p>
            <button type="submit" className="w-full rounded-lg bg-[#E50914] py-2.5 text-xs font-bold text-white">Save Email Activity</button>
          </form>
      </AnimatedOverlay>

      {/* CUSTOMER PROFILE SLIDE-OVER DRAWER */}
      {selectedCustomerDrawer && (
        <AnimatedOverlay
          open={isCustomerDrawerOpen}
          mode="drawer"
          onExited={clearSelectedCustomerDrawer}
          className="fixed inset-0 z-50 bg-black/70 flex justify-end"
        >
          {selectedCustomerDrawer && <div className={`max-w-md w-full h-full p-6 overflow-y-auto border-l ${bgCard}`}>
            <div className="flex justify-between items-center pb-4 border-b border-gray-800/30 mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedCustomerDrawer.name}</h3>
                <p className={`text-xs ${textMuted}`}>{selectedCustomerDrawer.id} • {selectedCustomerDrawer.branch}</p>
              </div>
              <button onClick={() => setIsCustomerDrawerOpen(false)} className="p-1.5 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className={`p-3 rounded-xl border ${bgSurface}`}>
                <p className={textMuted}>Contact Person</p>
                <p className="font-bold">{selectedCustomerDrawer.contactPerson} ({selectedCustomerDrawer.phone})</p>
              </div>
              <div className={`p-3 rounded-xl border ${bgSurface}`}>
                <p className={textMuted}>Credit Limit & Terms</p>
                <p className="font-bold">{formatINR(selectedCustomerDrawer.creditLimit)} • Net {selectedCustomerDrawer.paymentTerms} Days</p>
              </div>
              <div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Customer Type</p>
  <p className="font-bold">{selectedCustomerDrawer.type || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Email</p>
  <p className="font-bold">{selectedCustomerDrawer.email || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>GSTIN / Tax Registration</p>
  <p className="font-bold">{selectedCustomerDrawer.gstin || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Billing Address</p>
  <p className="font-bold">{selectedCustomerDrawer.billingAddress || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Shipping Address</p>
  <p className="font-bold">{selectedCustomerDrawer.shippingAddress || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Risk Level</p>
  <p className="font-bold">{selectedCustomerDrawer.riskRating || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Status</p>
  <p className="font-bold">{selectedCustomerDrawer.status || 'Not provided'}</p>
</div>

<div className={`p-3 rounded-xl border ${bgSurface}`}>
  <p className={textMuted}>Notes</p>
  <p className="font-bold">{selectedCustomerDrawer.notes || 'No notes available'}</p>
</div>
<button
  onClick={() => {
    setEditingCustomerId(selectedCustomerDrawer.id);

    setCustForm({
      customerCode: selectedCustomerDrawer.code || '',
      name: selectedCustomerDrawer.name || '',
      type: selectedCustomerDrawer.type || 'BUSINESS',
      contactPerson: selectedCustomerDrawer.contactPerson || '',
      email: selectedCustomerDrawer.email || '',
      phone: selectedCustomerDrawer.phone || '',
      billingAddress: selectedCustomerDrawer.billingAddress || '',
      shippingAddress: selectedCustomerDrawer.shippingAddress || '',
      taxRegistration: selectedCustomerDrawer.gstin || '',
      paymentTerms: selectedCustomerDrawer.paymentTerms || '',
      creditLimit: String(selectedCustomerDrawer.creditLimit || ''),
      status: (selectedCustomerDrawer.status || 'ACTIVE').toUpperCase(),
      riskLevel: (selectedCustomerDrawer.riskRating || 'LOW').toUpperCase(),
      notes: selectedCustomerDrawer.notes || '',
    });

    setEditCustomerModal(true);
  }}
  className="w-full py-2.5 mb-2 rounded-xl border border-[#E50914] text-[#E50914] font-bold"
>
  Edit Customer
</button>
              <button
                onClick={() => handleDeleteCustomer(selectedCustomerDrawer)}
                className="w-full py-2.5 mb-2 rounded-xl border border-rose-500/50 text-rose-400 font-bold"
              >
                Delete Customer
              </button>
              <button
                onClick={() => {
                  showToast('Customer portal access is unavailable until customer authentication is provided by the backend.');
                }}
                className="w-full py-2.5 rounded-xl bg-[#E50914] text-white font-bold"
              >
                Customer Portal Access
              </button>
            </div>
          </div>}
        </AnimatedOverlay>
      )}
      {/* ADD CUSTOMER MODAL */}
<AnimatedOverlay
  open={newCustomerModal}
  className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
>
    <form
      onSubmit={handleCreateCustomer}
      className={`max-w-2xl w-full max-h-[90vh] overflow-y-auto rounded-2xl border p-6 space-y-4 ${bgCard}`}
    >
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold">Add New Customer</h3>
          <p className={`text-xs ${textMuted}`}>
            Enter customer details to create an account.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setNewCustomerModal(false)}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        <div>
          <label className="block text-xs font-semibold mb-1">Customer Code</label>
          <input
            value={custForm.customerCode}
            onChange={(e) => setCustForm({ ...custForm, customerCode: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Optional customer code"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Customer Name *</label>
          <input
            required
            value={custForm.name}
            onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Enter customer name"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Customer Type</label>
          <select
            value={custForm.type}
            onChange={(e) => setCustForm({ ...custForm, type: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
          >
            <option value="INDIVIDUAL">Individual</option>
            <option value="BUSINESS">Business</option>
            <option value="CORPORATE">Corporate</option>
            <option value="DISTRIBUTOR">Distributor</option>
            <option value="RETAILER">Retailer</option>
            <option value="CHANNEL_PARTNER">Channel Partner</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Contact Person</label>
          <input
            value={custForm.contactPerson}
            onChange={(e) => setCustForm({ ...custForm, contactPerson: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Contact person"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Email</label>
          <input
            type="email"
            value={custForm.email}
            onChange={(e) => setCustForm({ ...custForm, email: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="customer@example.com"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Phone</label>
          <input
            value={custForm.phone}
            onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Phone number"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Tax Registration / GSTIN</label>
          <input
            value={custForm.taxRegistration}
            onChange={(e) => setCustForm({ ...custForm, taxRegistration: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="GSTIN"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Payment Terms</label>
          <input
            value={custForm.paymentTerms}
            onChange={(e) => setCustForm({ ...custForm, paymentTerms: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Example: 30 Days"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Credit Limit</label>
          <input
            type="number"
            min="0"
            value={custForm.creditLimit}
            onChange={(e) => setCustForm({ ...custForm, creditLimit: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Enter credit limit"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Risk Level</label>
          <select
            value={custForm.riskLevel}
            onChange={(e) => setCustForm({ ...custForm, riskLevel: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Status</label>
          <select
            value={custForm.status}
            onChange={(e) => setCustForm({ ...custForm, status: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Billing Address</label>
          <input
            value={custForm.billingAddress}
            onChange={(e) => setCustForm({ ...custForm, billingAddress: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Billing address"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Shipping Address</label>
          <input
            value={custForm.shippingAddress}
            onChange={(e) => setCustForm({ ...custForm, shippingAddress: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            placeholder="Shipping address"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold mb-1">Notes</label>
          <textarea
            value={custForm.notes}
            onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })}
            className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
            rows="3"
            placeholder="Additional customer notes"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => setNewCustomerModal(false)}
          className={`px-4 py-2 rounded-xl border text-xs font-semibold ${borderSubtle}`}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="px-5 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold"
        >
          Create Customer
        </button>
      </div>
    </form>
  </AnimatedOverlay>
      {/* EDIT CUSTOMER MODAL */}
      <AnimatedOverlay
        open={editCustomerModal}
        className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      >
          <form
            onSubmit={handleUpdateCustomer}
            className={`max-w-2xl w-full max-h-[90vh] overflow-y-auto rounded-2xl border p-6 space-y-4 ${bgCard}`}
          >
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Edit Customer</h3>
                <p className={`text-xs ${textMuted}`}>
                  Update customer information.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditCustomerModal(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Customer Code</label>
                <input
                  value={custForm.customerCode}
                  onChange={(e) => setCustForm({ ...custForm, customerCode: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Customer Name *</label>
                <input
                  required
                  value={custForm.name}
                  onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Customer Type</label>
                <select
                  value={custForm.type}
                  onChange={(e) => setCustForm({ ...custForm, type: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                >
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="BUSINESS">Business</option>
                  <option value="CORPORATE">Corporate</option>
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="RETAILER">Retailer</option>
                  <option value="CHANNEL_PARTNER">Channel Partner</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Contact Person</label>
                <input
                  value={custForm.contactPerson}
                  onChange={(e) => setCustForm({ ...custForm, contactPerson: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Email</label>
                <input
                  type="email"
                  value={custForm.email}
                  onChange={(e) => setCustForm({ ...custForm, email: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Phone</label>
                <input
                  value={custForm.phone}
                  onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">GSTIN / Tax Registration</label>
                <input
                  value={custForm.taxRegistration}
                  onChange={(e) => setCustForm({ ...custForm, taxRegistration: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Payment Terms</label>
                <input
                  value={custForm.paymentTerms}
                  onChange={(e) => setCustForm({ ...custForm, paymentTerms: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Credit Limit</label>
                <input
                  type="number"
                  min="0"
                  value={custForm.creditLimit}
                  onChange={(e) => setCustForm({ ...custForm, creditLimit: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Risk Level</label>
                <select
                  value={custForm.riskLevel}
                  onChange={(e) => setCustForm({ ...custForm, riskLevel: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Status</label>
                <select
                  value={custForm.status}
                  onChange={(e) => setCustForm({ ...custForm, status: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Billing Address</label>
                <input
                  value={custForm.billingAddress}
                  onChange={(e) => setCustForm({ ...custForm, billingAddress: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Shipping Address</label>
                <input
                  value={custForm.shippingAddress}
                  onChange={(e) => setCustForm({ ...custForm, shippingAddress: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold mb-1">Notes</label>
                <textarea
                  value={custForm.notes}
                  onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })}
                  className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
                  rows="3"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditCustomerModal(false)}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold ${borderSubtle}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold"
              >
                Save Changes
              </button>
            </div>
          </form>
      </AnimatedOverlay>

      {/* NEW RECEIPT & ALLOCATION MODAL */}
      <AnimatedOverlay
        open={newReceiptModal}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      >
          <form onSubmit={handlePostReceipt} className={`max-w-lg w-full rounded-2xl border p-6 space-y-4 ${bgCard}`}>
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold">Record & Allocate Customer Receipt</h3>
              <button type="button" onClick={() => setNewReceiptModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Customer</label>
                <select
                  value={rcpForm.customerId}
                  onChange={(e) => setRcpForm({ ...rcpForm, customerId: e.target.value, allocations: {} })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Receipt Amount (INR)</label>
                <input
                  type="number"
                  required
                  value={rcpForm.amount}
                  onChange={(e) => setRcpForm({ ...rcpForm, amount: e.target.value })}
                  placeholder="50000"
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-3">
  <div>
    <label className="block text-xs font-semibold mb-1">Receipt Number</label>
    <input
      type="text"
      required
      value={rcpForm.receiptNumber}
      onChange={(e) => setRcpForm({ ...rcpForm, receiptNumber: e.target.value })}
      placeholder="REC-001"
      className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Receipt Date</label>
    <input
      type="date"
      required
      value={rcpForm.receiptDate}
      onChange={(e) => setRcpForm({ ...rcpForm, receiptDate: e.target.value })}
      className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">Payment Method</label>
    <select
      required
      value={rcpForm.mode}
      onChange={(e) => setRcpForm({ ...rcpForm, mode: e.target.value })}
      className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
    >
      <option value="NEFT / RTGS">NEFT / RTGS</option>
      <option value="UPI">UPI</option>
      <option value="Cash">Cash</option>
      <option value="Cheque">Cheque</option>
      <option value="Bank Transfer">Bank Transfer</option>
    </select>
  </div>
</div>
              <label className="block text-xs font-semibold mb-1">Allocate Across Open Invoices</label>
              <div className={`p-3 rounded-xl border space-y-2 max-h-40 overflow-y-auto ${bgSurface}`}>
                {enrichedInvoices
                  .filter((i) => i.customerId === rcpForm.customerId && i.outstanding > 0)
                  .map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-xs">
                      <span>
                        {inv.id} (Due: {formatINR(inv.outstanding)})
                      </span>
                      <input
                        type="number"
                        max={inv.outstanding}
                        placeholder="0"
                        value={rcpForm.allocations[inv.id] || ''}
                        onChange={(e) =>
                          setRcpForm({
                            ...rcpForm,
                            allocations: { ...rcpForm.allocations, [inv.id]: e.target.value }
                          })
                        }
                        className={`w-28 p-1.5 rounded border text-right ${bgCard}`}
                      />
                    </div>
                  ))}
              </div>
            </div>

            <button type="submit" className="w-full py-2.5 rounded-xl bg-[#E50914] text-white text-xs font-bold">
              Post Receipt & Update Ledger
            </button>
          </form>
      </AnimatedOverlay>

      {/* NEW INVOICE MODAL */}
      <AnimatedOverlay
        open={newInvoiceModal}
        className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      >
          <form onSubmit={handleCreateInvoice} className={`max-w-md w-full rounded-2xl border p-6 space-y-4 ${bgCard}`}>
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold">Create Receivable Invoice</h3>
              <button type="button" onClick={() => setNewInvoiceModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Customer</label>
              <select
                value={invForm.customerId}
                onChange={(e) => setInvForm({ ...invForm, customerId: e.target.value })}
                className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Invoice Date</label>
                <input
                  type="date"
                  value={invForm.invoiceDate}
                  onChange={(e) => setInvForm({ ...invForm, invoiceDate: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Due Date</label>
                <input
                  type="date"
                  value={invForm.dueDate}
                  onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })}
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Total Invoice Amount (INR)</label>
              <input
                type="number"
                required
                value={invForm.totalAmount}
                onChange={(e) => setInvForm({ ...invForm, totalAmount: e.target.value })}
                placeholder="75000"
                className={`w-full p-2.5 rounded-xl border text-xs ${bgSurface}`}
              />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-[#E50914] text-white text-xs font-bold">
              Post Invoice to Ledger
            </button>
          </form>
      </AnimatedOverlay>

      {/* FLOATING AURON AI ASSISTANT BAR */}
      <AIAssistant
  aiOpen={aiOpen}
  setAiOpen={setAiOpen}
  aiInput={aiInput}
  setAiInput={setAiInput}
  aiMessages={aiMessages}
  handleAskAI={handleAskAI}
  bgCard={bgCard}
  bgSurface={bgSurface}
/>
    </div>
  );

}
