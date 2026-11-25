import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Users, FileText, Upload, Receipt, Clock,
  ShieldAlert, CheckSquare, Handshake, AlertTriangle, MessageSquare,
  FileSpreadsheet, BarChart3, Settings, Search, Bell, ChevronDown,
  Sparkles, Mic, Plus, ArrowUpRight, CheckCircle2, XCircle,
  Mail, MessageCircle, Send, Smartphone, Sun, Moon, Menu, X,
  Lock, Eye, EyeOff, LogOut, Building2, CreditCard, Download,
  Filter, RefreshCw, AlertCircle, UserCheck, Calendar, PhoneCall,
  FileCheck, DollarSign, Layers, Shield, HelpCircle
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell
} from 'recharts';

// --- INITIAL SEED DATA (ACID-LIKE FINANCIAL RECORDS) ---
const INITIAL_CUSTOMERS = [
  {
    id: 'CUST-1001',
    name: 'Alpha Tech Corp',
    code: 'ATC-01',
    contactPerson: 'Rohan Sharma',
    email: 'accounts@alphatech.in',
    phone: '+91 98490 11223',
    gstin: '36AABCA1234F1Z5',
    creditLimit: 500000,
    paymentTerms: 30,
    riskRating: 'Low',
    branch: 'Hyderabad HQ',
    category: 'Enterprise IT',
    executive: 'Priya Nair',
    status: 'Active'
  },
  {
    id: 'CUST-1002',
    name: 'Zenith Logistics Ltd',
    code: 'ZLL-02',
    contactPerson: 'Vikram Reddy',
    email: 'finance@zenithlogistics.in',
    phone: '+91 98480 44556',
    gstin: '37AABCZ9876M1Z2',
    creditLimit: 300000,
    paymentTerms: 15,
    riskRating: 'High',
    branch: 'Tirupati Hub',
    category: 'Supply Chain',
    executive: 'Karthik Rao',
    status: 'Active'
  },
  {
    id: 'CUST-1003',
    name: 'Nexus Retail Solutions',
    code: 'NRS-03',
    contactPerson: 'Ananya Verma',
    email: 'payables@nexusretail.co.in',
    phone: '+91 91234 56789',
    gstin: '29AABCN4567P1Z9',
    creditLimit: 400000,
    paymentTerms: 30,
    riskRating: 'Medium',
    branch: 'Bengaluru South',
    category: 'Retail',
    executive: 'Priya Nair',
    status: 'Active'
  },
  {
    id: 'CUST-1004',
    name: 'Vanguard Infra Projects',
    code: 'VIP-04',
    contactPerson: 'Suresh Menon',
    email: 'billing@vanguardinfra.com',
    phone: '+91 99887 76655',
    gstin: '36AABCV3210K1Z1',
    creditLimit: 800000,
    paymentTerms: 45,
    riskRating: 'Critical',
    branch: 'Hyderabad HQ',
    category: 'Construction',
    executive: 'Karthik Rao',
    status: 'Active'
  }
];

const INITIAL_INVOICES = [
  {
    id: 'INV-2026-101',
    customerId: 'CUST-1001',
    customerName: 'Alpha Tech Corp',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    totalAmount: 150000,
    taxAmount: 22881,
    status: 'Partially Paid',
    branch: 'Hyderabad HQ',
    category: 'Enterprise IT',
    executive: 'Priya Nair'
  },
  {
    id: 'INV-2026-102',
    customerId: 'CUST-1001',
    customerName: 'Alpha Tech Corp',
    invoiceDate: '2026-11-01',
    dueDate: '2026-12-01',
    totalAmount: 100000,
    taxAmount: 15254,
    status: 'Unpaid',
    branch: 'Hyderabad HQ',
    category: 'Enterprise IT',
    executive: 'Priya Nair'
  },
  {
    id: 'INV-2026-103',
    customerId: 'CUST-1002',
    customerName: 'Zenith Logistics Ltd',
    invoiceDate: '2026-09-10',
    dueDate: '2026-09-25',
    totalAmount: 180000,
    taxAmount: 27458,
    status: 'Overdue',
    branch: 'Tirupati Hub',
    category: 'Supply Chain',
    executive: 'Karthik Rao'
  },
  {
    id: 'INV-2026-104',
    customerId: 'CUST-1002',
    customerName: 'Zenith Logistics Ltd',
    invoiceDate: '2026-10-28',
    dueDate: '2026-11-12',
    totalAmount: 70000,
    taxAmount: 10678,
    status: 'Overdue',
    branch: 'Tirupati Hub',
    category: 'Supply Chain',
    executive: 'Karthik Rao'
  },
  {
    id: 'INV-2026-105',
    customerId: 'CUST-1003',
    customerName: 'Nexus Retail Solutions',
    invoiceDate: '2026-10-10',
    dueDate: '2026-11-09',
    totalAmount: 95000,
    taxAmount: 14491,
    status: 'Partially Paid',
    branch: 'Bengaluru South',
    category: 'Retail',
    executive: 'Priya Nair'
  },
  {
    id: 'INV-2026-106',
    customerId: 'CUST-1004',
    customerName: 'Vanguard Infra Projects',
    invoiceDate: '2026-08-01',
    dueDate: '2026-09-15',
    totalAmount: 240000,
    taxAmount: 36610,
    status: 'Overdue',
    branch: 'Hyderabad HQ',
    category: 'Construction',
    executive: 'Karthik Rao'
  }
];

const INITIAL_RECEIPTS = [
  {
    id: 'RCP-5001',
    customerId: 'CUST-1001',
    customerName: 'Alpha Tech Corp',
    date: '2026-11-02',
    amount: 90000,
    mode: 'NEFT / RTGS',
    reference: 'UTR992837461',
    status: 'Posted',
    allocations: [{ invoiceId: 'INV-2026-101', amount: 90000 }]
  },
  {
    id: 'RCP-5002',
    customerId: 'CUST-1002',
    customerName: 'Zenith Logistics Ltd',
    date: '2026-10-15',
    amount: 60000,
    mode: 'UPI Corporate',
    reference: 'UPI445123890',
    status: 'Posted',
    allocations: [{ invoiceId: 'INV-2026-103', amount: 60000 }]
  },
  {
    id: 'RCP-5003',
    customerId: 'CUST-1003',
    customerName: 'Nexus Retail Solutions',
    date: '2026-11-11',
    amount: 45000,
    mode: 'Bank Transfer',
    reference: 'HDFC88271625',
    status: 'Posted',
    allocations: [{ invoiceId: 'INV-2026-105', amount: 45000 }]
  }
];

const INITIAL_CREDIT_NOTES = [
  {
    id: 'CN-201',
    customerId: 'CUST-1001',
    customerName: 'Alpha Tech Corp',
    invoiceId: 'INV-2026-101',
    amount: 10000,
    reason: 'SLA uptime credit adjustment',
    status: 'Approved',
    date: '2026-11-04'
  }
];

const INITIAL_PTPS = [
  {
    id: 'PTP-01',
    customerId: 'CUST-1002',
    customerName: 'Zenith Logistics Ltd',
    invoiceId: 'INV-2026-103',
    promisedAmount: 120000,
    promisedDate: '2026-11-14',
    createdDate: '2026-11-05',
    notes: 'CFO confirmed RTGS release before 4 PM today.',
    executive: 'Karthik Rao'
  },
  {
    id: 'PTP-02',
    customerId: 'CUST-1004',
    customerName: 'Vanguard Infra Projects',
    invoiceId: 'INV-2026-106',
    promisedAmount: 100000,
    promisedDate: '2026-11-10',
    createdDate: '2026-11-01',
    notes: 'Part payment committed against milestone billing.',
    executive: 'Karthik Rao'
  }
];

const INITIAL_DISPUTES = [
  {
    id: 'DSP-01',
    customerId: 'CUST-1004',
    customerName: 'Vanguard Infra Projects',
    invoiceId: 'INV-2026-106',
    disputedAmount: 40000,
    category: 'Quantity / Rate Mismatch',
    status: 'Under Review',
    createdDate: '2026-10-20',
    notes: 'Client requested revised BOQ sign-off from site engineer.'
  }
];

const INITIAL_TASKS = [
  {
    id: 'TSK-01',
    customerId: 'CUST-1002',
    customerName: 'Zenith Logistics Ltd',
    title: 'Follow up on ₹1,20,000 PTP due today',
    dueDate: '2026-11-14',
    priority: 'Critical',
    assignee: 'Karthik Rao',
    status: 'Open',
    outcome: 'Pending Call'
  },
  {
    id: 'TSK-02',
    customerId: 'CUST-1004',
    customerName: 'Vanguard Infra Projects',
    title: 'Escalate 60-day overdue invoice & resolve BOQ dispute',
    dueDate: '2026-11-14',
    priority: 'High',
    assignee: 'Karthik Rao',
    status: 'Open',
    outcome: 'Escalated to Sales'
  },
  {
    id: 'TSK-03',
    customerId: 'CUST-1003',
    customerName: 'Nexus Retail Solutions',
    title: 'Confirm balance ₹50,000 clearance date',
    dueDate: '2026-11-16',
    priority: 'Medium',
    assignee: 'Priya Nair',
    status: 'Completed',
    outcome: 'Promised by Nov 20'
  }
];

const INITIAL_LOGS = [
  {
    id: 'LOG-101',
    customer: 'Zenith Logistics Ltd',
    invoiceId: 'INV-2026-104',
    channel: 'WhatsApp',
    gateway: 'Meta Cloud WhatsApp API',
    status: 'Delivered',
    timestamp: '2026-11-14 09:00 AM',
    trigger: 'Auto: Due Date +2 Days',
    message: 'Dear Zenith Logistics, Invoice INV-2026-104 for ₹70,000 was due on 12-Nov-2026. Pay securely via Auron Portal.'
  },
  {
    id: 'LOG-102',
    customer: 'Zenith Logistics Ltd',
    invoiceId: 'INV-2026-103',
    channel: 'Email',
    gateway: 'SendGrid Enterprise SMTP',
    status: 'Read',
    timestamp: '2026-11-14 09:01 AM',
    trigger: 'Auto: PTP Due Date Reminder',
    message: 'Statement of Account & PTP reminder attached for ₹1,20,000 scheduled today.'
  },
  {
    id: 'LOG-103',
    customer: 'Vanguard Infra Projects',
    invoiceId: 'INV-2026-106',
    channel: 'SMS',
    gateway: 'Twilio DLT India Gateway',
    status: 'Delivered',
    timestamp: '2026-11-14 09:05 AM',
    trigger: 'Auto: >45 Days Overdue Escalation',
    message: 'AURON COLLECT: Overdue balance of ₹2,40,000 on INV-2026-106 requires urgent attention.'
  }
];

const RBAC_ROLES = [
  'Super Admin',
  'Business Owner',
  'Finance Admin',
  'Accounts Receivable Executive',
  'Collection Manager',
  'Collection Executive',
  'Sales Manager',
  'Auditor / Viewer'
];

const MONTHLY_TREND_DATA = [
  { month: 'Jun', billed: 420000, collected: 385000 },
  { month: 'Jul', billed: 490000, collected: 430000 },
  { month: 'Aug', billed: 540000, collected: 475000 },
  { month: 'Sep', billed: 610000, collected: 510000 },
  { month: 'Oct', billed: 580000, collected: 530000 },
  { month: 'Nov', billed: 835000, collected: 640000 }
];

const SYSTEM_DATE = new Date('2026-11-14T11:00:00');

const formatINR = (num) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(num || 0));
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

  useEffect(() => {
    try {
      localStorage.setItem('auron_collect_theme', darkMode ? 'dark' : 'light');
    } catch {}
  }, [darkMode]);

  // Auth & Portal Mode: 'admin' | 'customer' | 'auth'
  const [portalMode, setPortalMode] = useState('admin');
  const [authTab, setAuthTab] = useState('staff'); // 'staff' | 'customer' | 'register'
  const [currentRole, setCurrentRole] = useState('Super Admin');
  const [staffEmail, setStaffEmail] = useState('admin@alphaauron.com');
  const [staffPassword, setStaffPassword] = useState('Auron@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  // Customer Portal Session
  const [activeCustomerId, setActiveCustomerId] = useState('CUST-1002');
  const [custLoginId, setCustLoginId] = useState('CUST-1002');
  const [custLoginEmail, setCustLoginEmail] = useState('finance@zenithlogistics.in');
  const [regForm, setRegForm] = useState({ name: '', email: '', phone: '', gstin: '', orgCode: 'AURON-HQ' });

  // Navigation & UI States
  const [activeModule, setActiveModule] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [selectedCustomerDrawer, setSelectedCustomerDrawer] = useState(null);

  // Dashboard Filters
  const [filterBranch, setFilterBranch] = useState('All');
  const [filterExecutive, setFilterExecutive] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');

  // Core Financial Ledger State
  const [customers, setCustomers] = useState(INITIAL_CUSTOMERS);
  const [invoices, setInvoices] = useState(INITIAL_INVOICES);
  const [receipts, setReceipts] = useState(INITIAL_RECEIPTS);
  const [creditNotes, setCreditNotes] = useState(INITIAL_CREDIT_NOTES);
  const [ptps, setPtps] = useState(INITIAL_PTPS);
  const [disputes, setDisputes] = useState(INITIAL_DISPUTES);
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [commLogs, setCommLogs] = useState(INITIAL_LOGS);

  // Automation Settings
  const [autoTriggers, setAutoTriggers] = useState({
    beforeDue3Days: true,
    onDueDate: true,
    overdue7Days: true,
    overdue15Days: true,
    channels: { whatsapp: true, email: true, sms: true }
  });

  // Org Setup State
  const [orgSettings, setOrgSettings] = useState({
    companyName: 'Alpha Auron Private Limited',
    gstin: '36AAACA8899L1Z4',
    currency: 'INR (₹)',
    fiscalYear: 'April - March (FY 2026-27)',
    defaultTerms: 'Net 30 Days',
    escalationDays: 15
  });

  // Modals & Forms State
  const [newReceiptModal, setNewReceiptModal] = useState(false);
  const [rcpForm, setRcpForm] = useState({
    customerId: 'CUST-1002',
    amount: '',
    mode: 'NEFT / RTGS',
    reference: '',
    allocations: {}
  });

  const [newInvoiceModal, setNewInvoiceModal] = useState(false);
  const [invForm, setInvForm] = useState({
    customerId: 'CUST-1001',
    invoiceDate: '2026-11-14',
    dueDate: '2026-12-14',
    totalAmount: ''
  });

  const [csvImportPreview, setCsvImportPreview] = useState(false);
  const [statementCustomerId, setStatementCustomerId] = useState('CUST-1002');
  const [activePlan, setActivePlan] = useState('Growth');

  // AI Assistant State
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState([
    {
      sender: 'ai',
      text: 'Hello! I am Auron AI, grounded directly in your live ledger. Ask me about overdue balances, customer statements, broken promises, or trigger reminder dispatches.'
    }
  ]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // --- SINGLE SOURCE OF TRUTH: DETERMINISTIC INVOICE LEDGER ENGINE ---
  const enrichedInvoices = useMemo(() => {
    return invoices.map((inv) => {
      // Sum posted receipt allocations
      const postedPaid = receipts
        .filter((r) => r.status === 'Posted')
        .reduce((sum, r) => {
          const match = r.allocations.find((a) => a.invoiceId === inv.id);
          return sum + (match ? Number(match.amount) : 0);
        }, 0);

      // Sum approved credit notes
      const approvedCredits = creditNotes
        .filter((cn) => cn.status === 'Approved' && cn.invoiceId === inv.id)
        .reduce((sum, cn) => sum + Number(cn.amount), 0);

      const outstanding = Math.max(0, Number((inv.totalAmount - postedPaid - approvedCredits).toFixed(2)));
      const due = new Date(inv.dueDate);
      const diffTime = SYSTEM_DATE.getTime() - due.getTime();
      const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      let derivedStatus = 'Unpaid';
      if (outstanding === 0) {
        derivedStatus = 'Paid';
      } else if (daysOverdue > 0) {
        derivedStatus = 'Overdue';
      } else if (postedPaid > 0 || approvedCredits > 0) {
        derivedStatus = 'Partially Paid';
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
        .filter((r) => r.status === 'Posted' && r.date >= ptp.createdDate)
        .reduce((sum, r) => {
          const match = r.allocations.find((a) => a.invoiceId === ptp.invoiceId);
          return sum + (match ? Number(match.amount) : 0);
        }, 0);

      let status = 'Open';
      if (paidSincePtp >= ptp.promisedAmount || (inv && inv.outstanding === 0)) {
        status = 'Fulfilled';
      } else if (paidSincePtp > 0) {
        status = 'Partially Fulfilled';
      } else if (new Date(ptp.promisedDate) < SYSTEM_DATE) {
        status = 'Broken';
      }

      return { ...ptp, paidSincePtp, status };
    });
  }, [ptps, receipts, enrichedInvoices]);

  // --- FILTERED DASHBOARD METRICS ---
  const filteredInvoices = useMemo(() => {
    return enrichedInvoices.filter((inv) => {
      if (filterBranch !== 'All' && inv.branch !== filterBranch) return false;
      if (filterExecutive !== 'All' && inv.executive !== filterExecutive) return false;
      if (filterCategory !== 'All' && inv.category !== filterCategory) return false;
      return true;
    });
  }, [enrichedInvoices, filterBranch, filterExecutive, filterCategory]);

  const kpis = useMemo(() => {
    const totalBilled = filteredInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalOutstanding = filteredInvoices.reduce((s, i) => s + i.outstanding, 0);
    const totalOverdue = filteredInvoices
      .filter((i) => i.derivedStatus === 'Overdue')
      .reduce((s, i) => s + i.outstanding, 0);
    const collectedThisMonth = receipts
      .filter((r) => r.status === 'Posted' && r.date.startsWith('2026-11'))
      .reduce((s, r) => s + r.amount, 0);
    const expectedCollections = enrichedPtps
      .filter((p) => p.status === 'Open' || p.status === 'Partially Fulfilled')
      .reduce((s, p) => s + (p.promisedAmount - p.paidSincePtp), 0);
    const promisesDue = enrichedPtps.filter((p) => p.promisedDate === '2026-11-14' && p.status !== 'Fulfilled').length;
    const brokenPromises = enrichedPtps.filter((p) => p.status === 'Broken').length;
    const tasksDueToday = tasks.filter((t) => t.dueDate === '2026-11-14' && t.status === 'Open').length;
    const totalPaidAll = filteredInvoices.reduce((s, i) => s + i.postedPaid, 0);
    const collectionRate = totalBilled > 0 ? Math.round((totalPaidAll / totalBilled) * 100) : 0;
    const dso = totalBilled > 0 ? Math.round((totalOutstanding / totalBilled) * 90) : 0;

    return {
      totalOutstanding,
      totalOverdue,
      collectedThisMonth,
      expectedCollections,
      promisesDue,
      brokenPromises,
      tasksDueToday,
      collectionRate,
      dso
    };
  }, [filteredInvoices, receipts, enrichedPtps, tasks]);

  // --- AGEING DISTRIBUTION DATA ---
  const ageingChartData = useMemo(() => {
    const buckets = ['Not Yet Due', '1-30 Days', '31-60 Days', '61-90 Days', '>90 Days'];
    return buckets.map((b) => ({
      name: b,
      amount: filteredInvoices
        .filter((i) => i.bucket === b)
        .reduce((sum, i) => sum + i.outstanding, 0)
    }));
  }, [filteredInvoices]);

  // --- COLLECTION PRIORITY SCORE QUEUE ---
  const priorityQueue = useMemo(() => {
    return customers
      .map((c) => {
        const custInvs = enrichedInvoices.filter((i) => i.customerId === c.id);
        const totalOut = custInvs.reduce((s, i) => s + i.outstanding, 0);
        const overdueAmt = custInvs.filter((i) => i.derivedStatus === 'Overdue').reduce((s, i) => s + i.outstanding, 0);
        const maxDays = Math.max(0, ...custInvs.map((i) => i.daysOverdue));
        const hasBrokenPtp = enrichedPtps.some((p) => p.customerId === c.id && p.status === 'Broken');

        // Weighted priority score out of 100
        let score = Math.min(45, Math.round((overdueAmt / 500000) * 45));
        score += Math.min(35, Math.round((maxDays / 90) * 35));
        if (hasBrokenPtp) score += 20;

        return {
          ...c,
          totalOut,
          overdueAmt,
          maxDays,
          hasBrokenPtp,
          priorityScore: Math.min(100, score)
        };
      })
      .filter((c) => c.totalOut > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }, [customers, enrichedInvoices, enrichedPtps]);

  // --- ACTIONS & HANDLERS ---
  const handlePostReceipt = (e) => {
    e.preventDefault();
    const amt = Number(rcpForm.amount);
    if (!amt || amt <= 0) {
      showToast('Please enter a valid positive receipt amount.');
      return;
    }

    const cust = customers.find((c) => c.id === rcpForm.customerId);
    const allocEntries = Object.entries(rcpForm.allocations)
      .map(([invoiceId, val]) => ({ invoiceId, amount: Number(val || 0) }))
      .filter((a) => a.amount > 0);

    const totalAllocated = allocEntries.reduce((s, a) => s + a.amount, 0);
    if (totalAllocated > amt) {
      showToast('Allocated total cannot exceed receipt amount!');
      return;
    }

    const newReceipt = {
      id: `RCP-${5001 + receipts.length}`,
      customerId: rcpForm.customerId,
      customerName: cust ? cust.name : 'Unknown',
      date: '2026-11-14',
      amount: amt,
      mode: rcpForm.mode,
      reference: rcpForm.reference || `REF${Date.now().toString().slice(-6)}`,
      status: 'Posted',
      allocations: allocEntries
    };

    setReceipts([newReceipt, ...receipts]);
    setNewReceiptModal(false);
    setRcpForm({ customerId: 'CUST-1002', amount: '', mode: 'NEFT / RTGS', reference: '', allocations: {} });
    showToast(`Receipt ${newReceipt.id} posted & allocated! Ledger balances updated immediately.`);
  };

  const handleReverseReceipt = (rcpId) => {
    setReceipts((prev) =>
      prev.map((r) => (r.id === rcpId ? { ...r, status: 'Reversed' } : r))
    );
    showToast(`Receipt ${rcpId} reversed. Outstanding invoice balances restored.`);
  };

  const handleCreateInvoice = (e) => {
    e.preventDefault();
    const amt = Number(invForm.totalAmount);
    if (!amt || amt <= 0) return;
    const cust = customers.find((c) => c.id === invForm.customerId);
    const newInv = {
      id: `INV-2026-${101 + invoices.length}`,
      customerId: cust.id,
      customerName: cust.name,
      invoiceDate: invForm.invoiceDate,
      dueDate: invForm.dueDate,
      totalAmount: amt,
      taxAmount: Math.round(amt * 0.18),
      status: 'Unpaid',
      branch: cust.branch,
      category: cust.category,
      executive: cust.executive
    };
    setInvoices([newInv, ...invoices]);
    setNewInvoiceModal(false);
    setInvForm({ customerId: 'CUST-1001', invoiceDate: '2026-11-14', dueDate: '2026-12-14', totalAmount: '' });
    showToast(`Invoice ${newInv.id} created for ${cust.name}.`);
  };

  const handleTriggerReminders = (channelFilter = 'ALL') => {
    const overdueList = enrichedInvoices.filter((i) => i.outstanding > 0 && i.daysOverdue >= 0);
    if (overdueList.length === 0) {
      showToast('No due or overdue invoices require reminders right now.');
      return;
    }

    const channelsToSend =
      channelFilter === 'ALL'
        ? ['WhatsApp', 'Email', 'SMS'].filter((ch) => autoTriggers.channels[ch.toLowerCase()])
        : [channelFilter];

    const newEntries = [];
    overdueList.slice(0, 3).forEach((inv, idx) => {
      channelsToSend.forEach((ch) => {
        newEntries.push({
          id: `LOG-${Date.now()}-${idx}-${ch}`,
          customer: inv.customerName,
          invoiceId: inv.id,
          channel: ch,
          gateway:
            ch === 'WhatsApp'
              ? 'Meta Cloud WhatsApp API'
              : ch === 'Email'
              ? 'SendGrid Enterprise SMTP'
              : 'Twilio DLT India Gateway',
          status: 'Delivered',
          timestamp: '2026-11-14 Just Now',
          trigger: channelFilter === 'ALL' ? 'Auto Due-Date Engine' : `Manual ${ch} Blast`,
          message: `Reminder: Invoice ${inv.id} balance ${formatINR(inv.outstanding)} (Due: ${inv.dueDate}). Pay via Auron Portal.`
        });
      });
    });

    setCommLogs([...newEntries, ...commLogs]);
    showToast(`Dispatched ${newEntries.length} automated reminder(s) via ${channelsToSend.join(', ')}!`);
  };

  const handleAskAI = (customPrompt) => {
    const q = (customPrompt || aiInput).trim();
    if (!q) return;

    const lower = q.toLowerCase();
    let reply = '';

    if (portalMode === 'customer') {
      const cust = customers.find((c) => c.id === activeCustomerId);
      const custInvs = enrichedInvoices.filter((i) => i.customerId === activeCustomerId);
      const billed = custInvs.reduce((s, i) => s + i.totalAmount, 0);
      const paid = custInvs.reduce((s, i) => s + i.postedPaid + i.approvedCredits, 0);
      const pending = custInvs.reduce((s, i) => s + i.outstanding, 0);
      const overdueInvs = custInvs.filter((i) => i.derivedStatus === 'Overdue');

      if (lower.includes('overdue') || lower.includes('why')) {
        reply =
          overdueInvs.length > 0
            ? `Account ${cust.name} (${cust.id}) has ${overdueInvs.length} overdue invoice(s): ${overdueInvs
                .map((i) => `${i.id} (${formatINR(i.outstanding)}, ${i.daysOverdue} days overdue)`)
                .join(', ')}.`
            : `Great news! ${cust.name} currently has zero overdue invoices.`;
      } else if (lower.includes('paid') || lower.includes('receipt')) {
        const custRcps = receipts.filter((r) => r.customerId === activeCustomerId && r.status === 'Posted');
        reply = `You have paid a total of ${formatINR(paid)} across ${custRcps.length} posted receipt(s): ${custRcps
          .map((r) => `${r.id} (${formatINR(r.amount)} on ${r.date})`)
          .join(', ')}.`;
      } else {
        reply = `Verified Ledger Summary for ${cust.name}: Total Billed is ${formatINR(billed)}, Total Paid/Credited is ${formatINR(
          paid
        )}, and your Total Pending Balance is ${formatINR(pending)}.`;
      }
    } else {
      // Admin Scoped Grounded AI
      if (lower.includes('overdue') || lower.includes('highest')) {
        const top = priorityQueue[0];
        reply = top
          ? `Highest priority overdue account is ${top.name} (${top.id}) with ${formatINR(
              top.overdueAmt
            )} overdue (${top.maxDays} days past due, Risk Score: ${top.priorityScore}/100). Total portfolio overdue stands at ${formatINR(
              kpis.totalOverdue
            )}.`
          : 'There are currently no overdue balances in the ledger.';
      } else if (lower.includes('promise') || lower.includes('ptp') || lower.includes('broken')) {
        const broken = enrichedPtps.filter((p) => p.status === 'Broken');
        const dueToday = enrichedPtps.filter((p) => p.promisedDate === '2026-11-14' && p.status !== 'Fulfilled');
        reply = `PTP Tracker: ${dueToday.length} promise(s) due today (${dueToday
          .map((p) => `${p.customerName}: ${formatINR(p.promisedAmount)}`)
          .join(', ')}), and ${broken.length} broken promise(s) flagged (${broken
          .map((p) => `${p.customerName}: ${formatINR(p.promisedAmount)}`)
          .join(', ')}).`;
      } else if (lower.includes('whatsapp') || lower.includes('remind') || lower.includes('send')) {
        handleTriggerReminders('ALL');
        reply =
          'I have triggered the Multi-Channel Due Date Reminder Engine across WhatsApp, Email, and SMS for all due/overdue accounts. Delivery receipts are logged in Communications.';
      } else {
        reply = `Live Portfolio Snapshot: Total Outstanding is ${formatINR(kpis.totalOutstanding)}, Overdue Balance is ${formatINR(
          kpis.totalOverdue
        )}, Collected This Month is ${formatINR(kpis.collectedThisMonth)}, and Collection Efficiency Rate is ${kpis.collectionRate}%.`;
      }
    }

    setAiMessages((prev) => [...prev, { sender: 'user', text: q }, { sender: 'ai', text: reply }]);
    setAiInput('');
  };

  // --- THEME CLASSES ---
  const bgCanvas = darkMode ? 'bg-[#111111] text-[#F5F5F5]' : 'bg-[#F5F5F5] text-[#111111]';
  const bgCard = darkMode ? 'bg-[#171717] border-[#222222]' : 'bg-white border-gray-200 shadow-sm';
  const bgSurface = darkMode ? 'bg-[#222222] border-[#333333]' : 'bg-gray-100 border-gray-200';
  const textMuted = darkMode ? 'text-[#808080]' : 'text-gray-500';
  const borderSubtle = darkMode ? 'border-[#222222]' : 'border-gray-200';

  // --- DUAL LOGIN & REGISTRATION VIEW ---
  if (portalMode === 'auth') {
    return (
      <div className={`min-h-screen flex flex-col justify-between p-4 sm:p-8 ${bgCanvas}`}>
        {/* Top Bar */}
        <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[#E50914] flex items-center justify-center font-black text-white text-lg shadow-lg shadow-[#E50914]/30">
              A
            </div>
            <div>
              <span className="font-extrabold tracking-wider text-base block leading-none">AURON COLLECT</span>
              <span className={`text-[11px] ${textMuted}`}>by Alpha Auron Private Limited</span>
            </div>
          </div>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2.5 rounded-xl border transition ${bgCard}`}
            title="Toggle Dark/Light Theme"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-gray-700" />}
          </button>
        </div>

        {/* Center Auth Card */}
        <div className={`max-w-lg w-full mx-auto my-8 rounded-2xl border p-6 sm:p-8 ${bgCard}`}>
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
          <div className={`grid grid-cols-3 gap-1 p-1 rounded-xl mb-6 ${bgSurface}`}>
            <button
              onClick={() => setAuthTab('staff')}
              className={`py-2 text-xs font-semibold rounded-lg transition ${
                authTab === 'staff' ? 'bg-[#E50914] text-white shadow' : textMuted
              }`}
            >
              Employee / Staff
            </button>
            <button
              onClick={() => setAuthTab('customer')}
              className={`py-2 text-xs font-semibold rounded-lg transition ${
                authTab === 'customer' ? 'bg-[#E50914] text-white shadow' : textMuted
              }`}
            >
              Customer Portal
            </button>
            <button
              onClick={() => setAuthTab('register')}
              className={`py-2 text-xs font-semibold rounded-lg transition ${
                authTab === 'register' ? 'bg-[#E50914] text-white shadow' : textMuted
              }`}
            >
              New Client Reg
            </button>
          </div>

          {authTab === 'staff' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPortalMode('admin');
                showToast(`Signed in as ${currentRole}`);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1.5">RBAC Role Selection</label>
                <select
                  value={currentRole}
                  onChange={(e) => setCurrentRole(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs font-medium focus:outline-none focus:border-[#E50914] ${bgSurface}`}
                >
                  {RBAC_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

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
                className="w-full py-3 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white font-bold text-xs transition shadow-lg shadow-[#E50914]/25"
              >
                Access Admin Workspace ({currentRole})
              </button>

              <div className="pt-3 border-t border-gray-800/30">
                <p className={`text-[11px] mb-2 font-medium ${textMuted}`}>One-Click Demo Role Access:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Super Admin', 'Finance Admin', 'Collection Manager', 'Auditor / Viewer'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setCurrentRole(r);
                        setPortalMode('admin');
                        showToast(`Logged in with ${r} permissions`);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] border hover:border-[#E50914] transition ${bgSurface}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          )}

          {authTab === 'customer' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const found = customers.find((c) => c.id === custLoginId) || customers[0];
                setActiveCustomerId(found.id);
                setPortalMode('customer');
                showToast(`Welcome to Customer Self-Service Portal, ${found.name}`);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1.5">Customer Account ID</label>
                <input
                  type="text"
                  required
                  value={custLoginId}
                  onChange={(e) => setCustLoginId(e.target.value)}
                  placeholder="e.g., CUST-1002"
                  className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Registered Billing Email</label>
                <input
                  type="email"
                  required
                  value={custLoginEmail}
                  onChange={(e) => setCustLoginEmail(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`}
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white font-bold text-xs transition"
              >
                Enter Customer Self-Service Portal
              </button>

              <div className="pt-3 border-t border-gray-800/30">
                <p className={`text-[11px] mb-2 font-medium ${textMuted}`}>One-Click Verified Client Demo:</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCustomerId('CUST-1001');
                      setPortalMode('customer');
                    }}
                    className={`p-2 rounded-xl border text-left text-xs hover:border-[#E50914] transition ${bgSurface}`}
                  >
                    <div className="font-bold">Alpha Tech Corp</div>
                    <div className={`text-[10px] ${textMuted}`}>ID: CUST-1001</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCustomerId('CUST-1002');
                      setPortalMode('customer');
                    }}
                    className={`p-2 rounded-xl border text-left text-xs hover:border-[#E50914] transition ${bgSurface}`}
                  >
                    <div className="font-bold">Zenith Logistics Ltd</div>
                    <div className={`text-[10px] ${textMuted}`}>ID: CUST-1002</div>
                  </button>
                </div>
              </div>
            </form>
          )}

          {authTab === 'register' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const newId = `CUST-${1001 + customers.length}`;
                const newCust = {
                  id: newId,
                  name: regForm.name || 'New Enterprise Client',
                  code: `NEW-${customers.length + 1}`,
                  contactPerson: 'Accounts Desk',
                  email: regForm.email,
                  phone: regForm.phone || '+91 90000 00000',
                  gstin: regForm.gstin || '36AABCN0000A1Z5',
                  creditLimit: 250000,
                  paymentTerms: 30,
                  riskRating: 'Low',
                  branch: 'Hyderabad HQ',
                  category: 'General',
                  executive: 'Priya Nair',
                  status: 'Active'
                };
                setCustomers([...customers, newCust]);
                setActiveCustomerId(newId);
                setPortalMode('customer');
                showToast(`Registered ${newCust.name} (${newId}) and linked to ${regForm.orgCode}!`);
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Company Legal Name</label>
                  <input
                    type="text"
                    required
                    value={regForm.name}
                    onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                    placeholder="Acme Industries Pvt Ltd"
                    className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Organisation Code</label>
                  <input
                    type="text"
                    required
                    value={regForm.orgCode}
                    onChange={(e) => setRegForm({ ...regForm, orgCode: e.target.value })}
                    className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Billing Email</label>
                <input
                  type="email"
                  required
                  value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  placeholder="billing@company.com"
                  className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">WhatsApp / Mobile</label>
                  <input
                    type="text"
                    required
                    value={regForm.phone}
                    onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">GSTIN</label>
                  <input
                    type="text"
                    value={regForm.gstin}
                    onChange={(e) => setRegForm({ ...regForm, gstin: e.target.value })}
                    placeholder="36AABCA1234F1Z5"
                    className={`w-full p-2 rounded-xl border text-xs ${bgSurface}`}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white font-bold text-xs transition mt-2"
              >
                Register & Launch Customer Portal
              </button>
            </form>
          )}
        </div>

        {/* Forgot Password Modal */}
        {showForgotModal && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className={`max-w-sm w-full rounded-2xl border p-6 ${bgCard}`}>
              <h3 className="text-base font-bold mb-2">Reset Staff Credentials</h3>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Enter your registered corporate email to receive a secure password reset OTP.
              </p>
              <input
                type="email"
                defaultValue={staffEmail}
                className={`w-full p-2.5 rounded-xl border text-xs mb-4 ${bgSurface}`}
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowForgotModal(false)}
                  className={`px-3 py-2 rounded-lg text-xs ${bgSurface}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowForgotModal(false);
                    showToast('Password reset link sent to your email.');
                  }}
                  className="px-4 py-2 rounded-lg bg-[#E50914] text-white text-xs font-semibold"
                >
                  Send Reset Link
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className={`text-center text-[11px] ${textMuted}`}>
          © 2026 Alpha Auron Private Limited • SOC2 & ISO-27001 Ready Financial Architecture
        </footer>
      </div>
    );
  }

  // --- ISOLATED CUSTOMER SELF-SERVICE PORTAL ---
  if (portalMode === 'customer') {
    const activeCustomer = customers.find((c) => c.id === activeCustomerId) || customers[0];
    const myInvoices = enrichedInvoices.filter((i) => i.customerId === activeCustomer.id);
    const myReceipts = receipts.filter((r) => r.customerId === activeCustomer.id);
    const myBilled = myInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const myPaid = myInvoices.reduce((s, i) => s + i.postedPaid + i.approvedCredits, 0);
    const myPending = myInvoices.reduce((s, i) => s + i.outstanding, 0);
    const upcomingInv = myInvoices.find((i) => i.outstanding > 0);

    return (
      <div className={`min-h-screen flex flex-col ${bgCanvas}`}>
        {/* Customer Portal Header */}
        <header className={`sticky top-0 z-30 border-b px-4 sm:px-6 h-16 flex items-center justify-between ${bgCard}`}>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#E50914] flex items-center justify-center font-black text-white text-sm">
              A
            </div>
            <div>
              <span className="font-bold text-sm tracking-wide">AURON COLLECT</span>
              <span className="ml-2 px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-bold">
                CLIENT PORTAL
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3">
            <select
              value={activeCustomerId}
              onChange={(e) => setActiveCustomerId(e.target.value)}
              className={`text-xs p-2 rounded-lg border font-medium hidden sm:block ${bgSurface}`}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  Viewing: {c.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-lg border ${bgSurface}`}
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setPortalMode('admin')}
              className="px-3 py-1.5 rounded-lg bg-[#E50914] text-white text-xs font-semibold hover:bg-[#B00020] transition"
            >
              Switch to Admin
            </button>

            <button
              onClick={() => setPortalMode('auth')}
              className={`p-2 rounded-lg border ${bgSurface}`}
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Customer Portal Content */}
        <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6 pb-24">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">{activeCustomer.name}</h1>
              <p className={`text-xs ${textMuted}`}>
                Account ID: {activeCustomer.id} • GSTIN: {activeCustomer.gstin} • Terms: Net {activeCustomer.paymentTerms} Days
              </p>
            </div>
            <button
              onClick={() => showToast(`Statement PDF downloaded for ${activeCustomer.name}`)}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-[#E50914] text-white text-xs font-semibold self-start"
            >
              <Download className="w-4 h-4" />
              <span>Download Account Statement</span>
            </button>
          </div>

          {/* 4 Financial Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Billed</p>
              <h3 className="text-2xl font-bold mt-2">{formatINR(myBilled)}</h3>
              <p className={`text-[11px] mt-1 ${textMuted}`}>{myInvoices.length} total invoices</p>
            </div>

            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Paid & Credited</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-2">{formatINR(myPaid)}</h3>
              <p className={`text-[11px] mt-1 ${textMuted}`}>{myReceipts.length} verified receipts</p>
            </div>

            <div className={`p-5 rounded-2xl border border-[#E50914]/50 ${bgCard}`}>
              <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Pending Balance</p>
              <h3 className="text-2xl font-bold text-[#E50914] mt-2">{formatINR(myPending)}</h3>
              <p className="text-[11px] text-[#E50914] mt-1">Auto-reminders active on WhatsApp & Email</p>
            </div>

            <div className={`p-5 rounded-2xl border ${bgCard}`}>
              <p className={`text-xs font-semibold uppercase ${textMuted}`}>Next / Earliest Due Date</p>
              <h3 className="text-xl font-bold mt-2">{upcomingInv ? upcomingInv.dueDate : 'All Settled'}</h3>
              <p className={`text-[11px] mt-1 ${textMuted}`}>
                {upcomingInv ? `Invoice ${upcomingInv.id}` : 'Zero pending dues'}
              </p>
            </div>
          </div>

          {/* Customer Scoped AI Assistant */}
          <div className={`p-5 sm:p-6 rounded-2xl border ${bgCard}`}>
            <div className="flex items-center space-x-2 mb-2">
              <Sparkles className="w-5 h-5 text-[#E50914]" />
              <h2 className="text-base font-bold">Customer Auron AI Billing Assistant</h2>
            </div>
            <p className={`text-xs mb-4 ${textMuted}`}>
              Ask questions strictly scoped to your verified billing, receipts, and pending dues.
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              {[
                'How much do I still need to pay?',
                'Which invoices are overdue and why?',
                'Show my payment receipt history'
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleAskAI(prompt)}
                  className={`px-3 py-1.5 rounded-full text-xs border hover:border-[#E50914] transition ${bgSurface}`}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="flex space-x-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                placeholder="Ask about your pending balance or invoice status..."
                className={`flex-1 p-3 rounded-xl border text-xs focus:outline-none focus:border-[#E50914] ${bgSurface}`}
              />
              <button
                onClick={() => handleAskAI()}
                className="px-5 py-2.5 rounded-xl bg-[#E50914] text-white text-xs font-bold hover:bg-[#B00020] transition"
              >
                Ask AI
              </button>
            </div>

            {aiMessages.length > 1 && (
              <div className={`mt-4 p-4 rounded-xl border space-y-2 max-h-48 overflow-y-auto ${bgSurface}`}>
                {aiMessages.slice(-4).map((m, idx) => (
                  <div key={idx} className="text-xs">
                    <span className={`font-bold ${m.sender === 'ai' ? 'text-[#E50914]' : 'text-blue-400'}`}>
                      {m.sender === 'ai' ? 'Auron AI: ' : 'You: '}
                    </span>
                    <span>{m.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invoices & Receipts Split Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h3 className="text-sm font-bold mb-4">My Invoices</h3>
              <table className="w-full text-left text-xs min-w-[450px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-2">Invoice #</th>
                    <th className="pb-2">Due Date</th>
                    <th className="pb-2">Total</th>
                    <th className="pb-2">Pending</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {myInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-3 font-semibold">{inv.id}</td>
                      <td className="py-3">{inv.dueDate}</td>
                      <td className="py-3">{formatINR(inv.totalAmount)}</td>
                      <td className="py-3 font-bold text-[#E50914]">{formatINR(inv.outstanding)}</td>
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
                          {inv.derivedStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h3 className="text-sm font-bold mb-4">My Payment Receipts</h3>
              <table className="w-full text-left text-xs min-w-[400px]">
                <thead>
                  <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                    <th className="pb-2">Receipt #</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Ref</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {myReceipts.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 font-semibold text-emerald-400">{r.id}</td>
                      <td className="py-3">{r.date}</td>
                      <td className="py-3">{r.mode}</td>
                      <td className="py-3 font-bold">{formatINR(r.amount)}</td>
                      <td className={`py-3 ${textMuted}`}>{r.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- ADMIN WORKSPACE NAVIGATION ITEMS (ALL 14 MODULES) ---
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'onboarding', label: 'Org Setup Wizard', icon: Building2 },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'invoices', label: 'Invoices & Bulk Import', icon: FileText },
    { id: 'receipts', label: 'Receipts & Allocation', icon: Receipt },
    { id: 'ageing', label: 'Ageing Engine', icon: Clock },
    { id: 'queue', label: 'Priority & Risk Queue', icon: ShieldAlert },
    { id: 'tasks', label: 'Tasks & Follow-ups', icon: CheckSquare },
    { id: 'promises', label: 'Promise-to-Pay (PTP)', icon: Handshake },
    { id: 'disputes', label: 'Disputes Management', icon: AlertTriangle },
    { id: 'communications', label: 'WhatsApp & Email Auto', icon: MessageSquare },
    { id: 'statements', label: 'Customer Statements', icon: FileSpreadsheet },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'billing', label: 'Subscription & Billing', icon: CreditCard }
  ];

  // --- MAIN ADMIN WORKSPACE ---
  return (
    <div className={`min-h-screen flex flex-col ${bgCanvas}`}>
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-16 right-4 z-50 bg-[#E50914] text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP HEADER BAR */}
      <header className={`sticky top-0 z-30 h-14 border-b px-4 flex items-center justify-between ${bgCard}`}>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`lg:hidden p-2 rounded-lg border ${bgSurface}`}
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-[#E50914] flex items-center justify-center font-black text-white text-sm">
              A
            </div>
            <span className="font-extrabold text-sm tracking-wider">AURON COLLECT</span>
          </div>

          <span className={`hidden md:inline-block text-[11px] px-2.5 py-0.5 rounded-md border ${bgSurface} ${textMuted}`}>
            {orgSettings.companyName}
          </span>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 rounded-lg border transition ${bgSurface}`}
            title="Switch Light / Dark Mode"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-gray-700" />}
          </button>

          <button
            onClick={() => setPortalMode('customer')}
            className="px-3 py-1.5 rounded-lg bg-[#E50914] hover:bg-[#B00020] text-white text-xs font-semibold transition"
          >
            Customer Portal
          </button>

          <button
            onClick={() => setPortalMode('auth')}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1 ${bgSurface}`}
            title="Switch Role / Login Screen"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Auth</span>
          </button>
        </div>
      </header>

      {/* BODY WRAPPER */}
      <div className="flex flex-1 overflow-hidden">
        {/* MOBILE SLIDE-OVER DRAWER */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex bg-black/70 backdrop-blur-xs">
            <div className={`w-72 h-full p-4 flex flex-col justify-between overflow-y-auto ${bgCard}`}>
              <div>
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-800/30">
                  <span className="font-extrabold text-sm text-[#E50914]">AURON COLLECT</span>
                  <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveModule(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
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
        )}

        {/* DESKTOP LEFT SIDEBAR */}
        <aside className={`w-64 border-r hidden lg:flex flex-col justify-between p-3 overflow-y-auto ${bgCard}`}>
          <div className="space-y-1">
            <p className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 ${textMuted}`}>
              14 Enterprise Modules
            </p>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveModule(item.id)}
                  className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    active
                      ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/20'
                      : `${textMuted} hover:bg-[#E50914]/10 hover:text-[#E50914]`
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className={`p-3 rounded-xl border mt-4 ${bgSurface}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold">RBAC Role</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold">
                Active
              </span>
            </div>
            <select
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value)}
              className={`w-full text-xs p-1.5 rounded-lg border focus:outline-none ${bgCard}`}
            >
              {RBAC_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </aside>

        {/* MAIN WORKSPACE VIEWPORT */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-28 space-y-6">
          {/* MODULE 1: EXECUTIVE DASHBOARD */}
          {activeModule === 'dashboard' && (
            <div className="space-y-6">
              {/* Top Controls & Filters */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">Accounts Receivable Command Center</h1>
                  <p className={`text-xs ${textMuted}`}>
                    Real-time ledger metrics • System Date: 14 Nov 2026 • Currency: INR (₹)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filterBranch}
                    onChange={(e) => setFilterBranch(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    <option value="All">All Branches</option>
                    <option value="Hyderabad HQ">Hyderabad HQ</option>
                    <option value="Tirupati Hub">Tirupati Hub</option>
                    <option value="Bengaluru South">Bengaluru South</option>
                  </select>

                  <select
                    value={filterExecutive}
                    onChange={(e) => setFilterExecutive(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    <option value="All">All Executives</option>
                    <option value="Priya Nair">Priya Nair</option>
                    <option value="Karthik Rao">Karthik Rao</option>
                  </select>

                  <button
                    onClick={() => handleTriggerReminders('ALL')}
                    className="px-3.5 py-2 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white text-xs font-bold flex items-center space-x-1.5 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Due Alerts</span>
                  </button>
                </div>
              </div>

              {/* 8 Computed KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Outstanding</p>
                    <DollarSign className="w-4 h-4 text-[#E50914]" />
                  </div>
                  <h3 className="text-2xl font-extrabold mt-2">{formatINR(kpis.totalOutstanding)}</h3>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>
                    Collection Rate: <span className="text-emerald-400 font-bold">{kpis.collectionRate}%</span>
                  </p>
                </div>

                <div className={`p-5 rounded-2xl border border-[#E50914]/50 relative overflow-hidden ${bgCard}`}>
                  <div className="absolute top-0 right-0 w-1.5 h-full bg-[#E50914]" />
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Total Overdue</p>
                    <AlertCircle className="w-4 h-4 text-[#E50914]" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-[#E50914] mt-2">{formatINR(kpis.totalOverdue)}</h3>
                  <p className="text-[11px] text-[#E50914] mt-1">Auto-WhatsApp & Email active</p>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Collected (Nov 2026)</p>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-emerald-400 mt-2">{formatINR(kpis.collectedThisMonth)}</h3>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>DSO: <span className="font-bold">{kpis.dso} Days</span></p>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex justify-between items-start">
                    <p className={`text-xs font-semibold uppercase ${textMuted}`}>Expected (Open PTPs)</p>
                    <Handshake className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-amber-400 mt-2">{formatINR(kpis.expectedCollections)}</h3>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>
                    {kpis.promisesDue} Due Today • <span className="text-[#E50914] font-bold">{kpis.brokenPromises} Broken</span>
                  </p>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`lg:col-span-2 p-5 rounded-2xl border ${bgCard}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold">Billed vs. Collected Recovery Trend</h3>
                      <p className={`text-xs ${textMuted}`}>Monthly cash inflow efficiency (INR)</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${bgSurface}`}>
                      6-Month View
                    </span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={MONTHLY_TREND_DATA}>
                        <defs>
                          <linearGradient id="billedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#E50914" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#E50914" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#222' : '#eee'} />
                        <XAxis dataKey="month" stroke="#808080" fontSize={11} />
                        <YAxis stroke="#808080" fontSize={11} tickFormatter={(v) => `₹${v / 1000}k`} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: darkMode ? '#171717' : '#fff',
                            borderColor: '#333',
                            borderRadius: '10px',
                            fontSize: '12px'
                          }}
                          formatter={(val) => formatINR(val)}
                        />
                        <Area type="monotone" dataKey="billed" stroke="#E50914" strokeWidth={2} fill="url(#billedGrad)" name="Billed" />
                        <Area type="monotone" dataKey="collected" stroke="#10B981" strokeWidth={2} fill="url(#collGrad)" name="Collected" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={`p-5 rounded-2xl border ${bgCard}`}>
                  <h3 className="text-sm font-bold mb-1">Ageing Bucket Distribution</h3>
                  <p className={`text-xs mb-4 ${textMuted}`}>Outstanding receivables by overdue days</p>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ageingChartData} layout="vertical">
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={85} stroke="#808080" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: darkMode ? '#171717' : '#fff',
                            borderColor: '#333',
                            borderRadius: '10px',
                            fontSize: '12px'
                          }}
                          formatter={(val) => formatINR(val)}
                        />
                        <Bar dataKey="amount" radius={[0, 6, 6, 0]} name="Outstanding">
                          {ageingChartData.map((entry, idx) => (
                            <Cell key={idx} fill={idx === 0 ? '#10B981' : idx < 3 ? '#F59E0B' : '#E50914'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Priority Accounts & Live Automated Dispatch Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold">Top Priority Collection Queue</h3>
                    <button
                      onClick={() => setActiveModule('queue')}
                      className="text-xs text-[#E50914] font-semibold hover:underline"
                    >
                      View Full Queue →
                    </button>
                  </div>
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
                          <td className="py-3 font-bold text-[#E50914]">{formatINR(c.overdueAmt)}</td>
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
                    {commLogs.slice(0, 3).map((log) => (
                      <div key={log.id} className={`p-3 rounded-xl border text-xs ${bgSurface}`}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold">{log.customer}</span>
                          <span className="px-2 py-0.5 rounded bg-[#E50914] text-white text-[10px] font-bold">
                            {log.channel} • {log.status}
                          </span>
                        </div>
                        <p className={`text-[11px] ${textMuted}`}>{log.message}</p>
                      </div>
                    ))}
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
                  {customers.map((c) => {
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
                            onClick={() => setSelectedCustomerDrawer(c)}
                            className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                          >
                            Open Profile
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                  <button
                    onClick={() => setCsvImportPreview(!csvImportPreview)}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 ${bgCard}`}
                  >
                    <Upload className="w-3.5 h-3.5 text-[#E50914]" />
                    <span>Bulk CSV/XLSX Import</span>
                  </button>
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
                    <h3 className="text-sm font-bold">Bulk ERP Import Staging & Duplicate Validation</h3>
                    <button
                      onClick={() => {
                        setCsvImportPreview(false);
                        showToast('Imported 2 valid invoices; skipped 1 duplicate invoice number.');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                    >
                      Commit Valid Rows
                    </button>
                  </div>
                  <p className={`text-xs mb-3 ${textMuted}`}>
                    Detected 3 rows from Tally/SAP export: 2 valid new invoices, 1 duplicate ID (INV-2026-101) flagged.
                  </p>
                </div>
              )}

              <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
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
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${borderSubtle}`}>
                    {enrichedInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-3 font-bold">{inv.id}</td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
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

              <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
                <table className="w-full text-left text-xs min-w-[750px]">
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
                    {receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 font-bold">{r.id}</td>
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
                          {r.status === 'Posted' && (
                            <button
                              onClick={() => handleReverseReceipt(r.id)}
                              className="px-2.5 py-1 rounded-lg border border-[#E50914]/40 text-[#E50914] text-[11px] hover:bg-[#E50914] hover:text-white transition"
                            >
                              Reverse
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODULE 6: AGEING ENGINE */}
          {activeModule === 'ageing' && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold">Receivables Ageing Analysis Engine</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {ageingChartData.map((b) => (
                  <div key={b.name} className={`p-4 rounded-2xl border ${bgCard}`}>
                    <p className={`text-[11px] font-semibold uppercase ${textMuted}`}>{b.name}</p>
                    <h4 className="text-lg font-extrabold mt-1">{formatINR(b.amount)}</h4>
                  </div>
                ))}
              </div>
              <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
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
                    {enrichedInvoices
                      .filter((i) => i.outstanding > 0)
                      .map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-3 font-bold">{inv.id}</td>
                          <td className="py-3">{inv.customerName}</td>
                          <td className="py-3">{inv.dueDate}</td>
                          <td className="py-3 font-bold">{inv.daysOverdue} Days</td>
                          <td className="py-3">
                            <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-semibold">
                              {inv.bucket}
                            </span>
                          </td>
                          <td className="py-3 font-extrabold">{formatINR(inv.outstanding)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODULE 7: COLLECTION PRIORITY & RISK QUEUE */}
          {activeModule === 'queue' && (
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h2 className="text-lg font-bold mb-1">Weighted Collection Priority & Risk Queue</h2>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Ranked dynamically by overdue exposure, maximum invoice age, and broken Promise-to-Pay flags.
              </p>
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
                  {priorityQueue.map((c, index) => (
                    <tr key={c.id}>
                      <td className="py-3 font-black text-[#E50914]">#{index + 1}</td>
                      <td className="py-3 font-bold">{c.name}</td>
                      <td className="py-3">{c.executive}</td>
                      <td className="py-3 font-bold text-[#E50914]">{formatINR(c.overdueAmt)}</td>
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
                          onClick={() => handleTriggerReminders('WhatsApp')}
                          className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                        >
                          Send WhatsApp Nudge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 8: TASKS & FOLLOW-UPS */}
          {activeModule === 'tasks' && (
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h2 className="text-lg font-bold mb-4">Collection Tasks & Call Follow-ups</h2>
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
                  {tasks.map((t) => (
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
                        {t.status === 'Open' && (
                          <button
                            onClick={() => {
                              setTasks((prev) =>
                                prev.map((item) => (item.id === t.id ? { ...item, status: 'Completed' } : item))
                              );
                              showToast(`Task ${t.id} marked completed.`);
                            }}
                            className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold"
                          >
                            Mark Done
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 9: PROMISE-TO-PAY (PTP) TRACKER */}
          {activeModule === 'promises' && (
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h2 className="text-lg font-bold mb-1">Promise-to-Pay (PTP) Commitment Engine</h2>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Automatically reconciles promised amounts against posted receipt allocations to detect Fulfilled vs. Broken commitments.
              </p>
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
                  </tr>
                </thead>
                <tbody className={`divide-y ${borderSubtle}`}>
                  {enrichedPtps.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 font-mono">{p.id}</td>
                      <td className="py-3 font-bold">{p.customerName}</td>
                      <td className="py-3">{p.invoiceId}</td>
                      <td className="py-3 font-bold">{formatINR(p.promisedAmount)}</td>
                      <td className="py-3">{p.promisedDate}</td>
                      <td className="py-3 text-emerald-400">{formatINR(p.paidSincePtp)}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 10: DISPUTES MANAGEMENT */}
          {activeModule === 'disputes' && (
            <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
              <h2 className="text-lg font-bold mb-1">Invoice Disputes & Credit Adjustment Workflow</h2>
              <p className={`text-xs mb-4 ${textMuted}`}>
                Disputed amounts are isolated from automated escalation without altering official receivable balances until a Credit Note is approved.
              </p>
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
                  {disputes.map((d) => (
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
                            onClick={() => {
                              setDisputes((prev) =>
                                prev.map((item) => (item.id === d.id ? { ...item, status: 'Resolved' } : item))
                              );
                              setCreditNotes((prev) => [
                                ...prev,
                                {
                                  id: `CN-${201 + prev.length}`,
                                  customerId: d.customerId,
                                  customerName: d.customerName,
                                  invoiceId: d.invoiceId,
                                  amount: d.disputedAmount,
                                  reason: `Dispute ${d.id} approved credit`,
                                  status: 'Approved',
                                  date: '2026-11-14'
                                }
                              ]);
                              showToast(`Dispute ${d.id} resolved & approved Credit Note issued!`);
                            }}
                            className="px-3 py-1 rounded-lg bg-[#E50914] text-white text-[11px] font-semibold"
                          >
                            Approve Credit Note
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MODULE 11: AUTOMATED WHATSAPP, EMAIL & SMS REMINDERS */}
          {activeModule === 'communications' && (
            <div className="space-y-6">
              <div className={`p-6 rounded-2xl border ${bgCard}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold">Automated Due-Date Notification & Dunning Engine</h2>
                    <p className={`text-xs ${textMuted}`}>
                      Automatically triggers personalized messages across WhatsApp, Email, and Normal SMS when due dates arrive or pass.
                    </p>
                  </div>
                  <button
                    onClick={() => handleTriggerReminders('ALL')}
                    className="px-4 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B00020] text-white text-xs font-bold flex items-center space-x-2 self-start"
                  >
                    <Send className="w-4 h-4" />
                    <span>Run All Due-Date Triggers Now</span>
                  </button>
                </div>

                {/* Channel Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className={`p-4 rounded-xl border ${bgSurface}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                        <MessageCircle className="w-5 h-5" />
                        <span>WhatsApp Business API</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoTriggers.channels.whatsapp}
                        onChange={(e) =>
                          setAutoTriggers({
                            ...autoTriggers,
                            channels: { ...autoTriggers.channels, whatsapp: e.target.checked }
                          })
                        }
                        className="accent-[#E50914]"
                      />
                    </div>
                    <p className={`text-xs mb-4 ${textMuted}`}>
                      Instant rich-template alerts with invoice PDF & one-click payment summary via Meta Cloud API.
                    </p>
                    <button
                      onClick={() => handleTriggerReminders('WhatsApp')}
                      className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
                    >
                      Dispatch WhatsApp Reminders
                    </button>
                  </div>

                  <div className={`p-4 rounded-xl border ${bgSurface}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2 text-blue-400 font-bold text-sm">
                        <Mail className="w-5 h-5" />
                        <span>Email Statement Dispatch</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoTriggers.channels.email}
                        onChange={(e) =>
                          setAutoTriggers({
                            ...autoTriggers,
                            channels: { ...autoTriggers.channels, email: e.target.checked }
                          })
                        }
                        className="accent-[#E50914]"
                      />
                    </div>
                    <p className={`text-xs mb-4 ${textMuted}`}>
                      Formal HTML SOA & tax invoice attachment sent automatically via SendGrid SMTP.
                    </p>
                    <button
                      onClick={() => handleTriggerReminders('Email')}
                      className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition"
                    >
                      Dispatch Email Reminders
                    </button>
                  </div>

                  <div className={`p-4 rounded-xl border ${bgSurface}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                        <Smartphone className="w-5 h-5" />
                        <span>Normal SMS Gateway</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoTriggers.channels.sms}
                        onChange={(e) =>
                          setAutoTriggers({
                            ...autoTriggers,
                            channels: { ...autoTriggers.channels, sms: e.target.checked }
                          })
                        }
                        className="accent-[#E50914]"
                      />
                    </div>
                    <p className={`text-xs mb-4 ${textMuted}`}>
                      DLT-registered transactional SMS alerts for immediate mobile reach without internet dependency.
                    </p>
                    <button
                      onClick={() => handleTriggerReminders('SMS')}
                      className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition"
                    >
                      Dispatch Normal SMS
                    </button>
                  </div>
                </div>

                {/* Automated Schedule Cadence */}
                <div className={`p-4 rounded-xl border ${bgSurface}`}>
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-3">Automated Due-Date Cadence Rules</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    {[
                      { key: 'beforeDue3Days', label: '3 Days Before Due Date (Gentle Courtesy)' },
                      { key: 'onDueDate', label: 'On Due Date Arrival (Instant Multi-Channel)' },
                      { key: 'overdue7Days', label: '7 Days Overdue (First Escalation Notice)' },
                      { key: 'overdue15Days', label: '15+ Days Overdue (Final Management Alert)' }
                    ].map((rule) => (
                      <label key={rule.key} className={`flex items-center space-x-2 p-2.5 rounded-lg border ${bgCard}`}>
                        <input
                          type="checkbox"
                          checked={autoTriggers[rule.key]}
                          onChange={(e) => setAutoTriggers({ ...autoTriggers, [rule.key]: e.target.checked })}
                          className="accent-[#E50914]"
                        />
                        <span>{rule.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Delivery Audit Logs */}
              <div className={`p-5 rounded-2xl border overflow-x-auto ${bgCard}`}>
                <h3 className="text-sm font-bold mb-4">Real-Time Multi-Channel Dispatch Audit Log</h3>
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
                    {commLogs.map((log) => (
                      <tr key={log.id}>
                        <td className={`py-3 ${textMuted}`}>{log.timestamp}</td>
                        <td className="py-3 font-bold">{log.customer}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded bg-[#E50914]/15 text-[#E50914] font-bold">
                            {log.channel}
                          </span>
                        </td>
                        <td className="py-3">{log.trigger}</td>
                        <td className="py-3 text-emerald-400 font-semibold">● {log.status}</td>
                        <td className="py-3 max-w-md truncate">{log.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <div className="flex items-center space-x-2">
                  <select
                    value={statementCustomerId}
                    onChange={(e) => setStatementCustomerId(e.target.value)}
                    className={`text-xs p-2 rounded-xl border ${bgCard}`}
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => showToast('Official Statement PDF exported & queued for email.')}
                    className="px-4 py-2 rounded-xl bg-[#E50914] text-white text-xs font-bold flex items-center space-x-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>

              {(() => {
                const stCust = customers.find((c) => c.id === statementCustomerId) || customers[0];
                const stInvs = enrichedInvoices.filter((i) => i.customerId === stCust.id);
                const stClosing = stInvs.reduce((s, i) => s + i.outstanding, 0);
                return (
                  <div className={`p-6 rounded-2xl border space-y-4 ${bgCard}`}>
                    <div className="flex justify-between items-start border-b pb-4 border-gray-800/30">
                      <div>
                        <span className="text-xs font-black text-[#E50914]">STATEMENT OF ACCOUNT</span>
                        <h3 className="text-xl font-bold mt-1">{stCust.name}</h3>
                        <p className={`text-xs ${textMuted}`}>GSTIN: {stCust.gstin} • {stCust.email}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs ${textMuted}`}>Closing Balance Due</p>
                        <p className="text-2xl font-extrabold text-[#E50914]">{formatINR(stClosing)}</p>
                      </div>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className={`border-b ${borderSubtle} ${textMuted}`}>
                          <th className="pb-2">Date</th>
                          <th className="pb-2">Document #</th>
                          <th className="pb-2">Billed</th>
                          <th className="pb-2">Paid / Credited</th>
                          <th className="pb-2">Balance</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${borderSubtle}`}>
                        {stInvs.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-2.5">{inv.invoiceDate}</td>
                            <td className="py-2.5 font-bold">{inv.id}</td>
                            <td className="py-2.5">{formatINR(inv.totalAmount)}</td>
                            <td className="py-2.5 text-emerald-400">
                              {formatINR(inv.postedPaid + inv.approvedCredits)}
                            </td>
                            <td className="py-2.5 font-bold">{formatINR(inv.outstanding)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          {/* MODULE 13: REPORTS & ANALYTICS */}
          {activeModule === 'reports' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { title: 'Executive AR Ageing Report', desc: 'Granular invoice-level ageing across 0-30, 31-60, 61-90, and >90 day buckets.' },
                { title: 'Collector Efficiency & PTP Fulfillment', desc: 'Track executive recovery velocity, call outcomes, and kept vs. broken promises.' },
                { title: 'Tax & Receipt Reconciliation Ledger', desc: 'Audit-ready register mapping bank UTR references to settled tax invoices.' }
              ].map((rep) => (
                <div key={rep.title} className={`p-5 rounded-2xl border flex flex-col justify-between ${bgCard}`}>
                  <div>
                    <h3 className="text-sm font-bold mb-2">{rep.title}</h3>
                    <p className={`text-xs mb-4 ${textMuted}`}>{rep.desc}</p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => showToast(`Exported ${rep.title} as CSV`)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-semibold ${bgSurface}`}
                    >
                      CSV
                    </button>
                    <button
                      onClick={() => showToast(`Exported ${rep.title} as Excel`)}
                      className="flex-1 py-2 rounded-lg bg-[#E50914] text-white text-xs font-semibold"
                    >
                      Excel / PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* MODULE 14: SUBSCRIPTION & BILLING */}
          {activeModule === 'billing' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { name: 'Starter', price: '₹999/mo', users: 'Up to 3 Users', invs: '500 Invoices/mo' },
                { name: 'Growth', price: '₹2,499/mo', users: 'Up to 10 Users', invs: '2,500 Invoices/mo' },
                { name: 'Business', price: '₹5,999/mo', users: 'Up to 30 Users', invs: '15,000 Invoices/mo' },
                { name: 'Enterprise', price: 'Custom', users: 'Unlimited Users', invs: 'Dedicated ERP API' }
              ].map((plan) => (
                <div
                  key={plan.name}
                  className={`p-5 rounded-2xl border flex flex-col justify-between ${
                    activePlan === plan.name ? 'border-[#E50914]' : ''
                  } ${bgCard}`}
                >
                  <div>
                    <span className="text-xs font-bold text-[#E50914] uppercase">{plan.name}</span>
                    <h3 className="text-2xl font-extrabold mt-2">{plan.price}</h3>
                    <ul className={`text-xs space-y-2 mt-4 ${textMuted}`}>
                      <li>• {plan.users}</li>
                      <li>• {plan.invs}</li>
                      <li>• WhatsApp, Email & SMS Engine</li>
                    </ul>
                  </div>
                  <button
                    onClick={() => {
                      setActivePlan(plan.name);
                      showToast(`Subscribed to AURON COLLECT ${plan.name} Plan`);
                    }}
                    className={`mt-6 w-full py-2 rounded-xl text-xs font-bold ${
                      activePlan === plan.name ? 'bg-emerald-600 text-white' : 'bg-[#E50914] text-white'
                    }`}
                  >
                    {activePlan === plan.name ? 'Current Active Plan' : 'Select Plan'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* CUSTOMER PROFILE SLIDE-OVER DRAWER */}
      {selectedCustomerDrawer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex justify-end">
          <div className={`max-w-md w-full h-full p-6 overflow-y-auto border-l ${bgCard}`}>
            <div className="flex justify-between items-center pb-4 border-b border-gray-800/30 mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedCustomerDrawer.name}</h3>
                <p className={`text-xs ${textMuted}`}>{selectedCustomerDrawer.id} • {selectedCustomerDrawer.branch}</p>
              </div>
              <button onClick={() => setSelectedCustomerDrawer(null)} className="p-1.5 rounded-lg">
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
              <button
                onClick={() => {
                  setActiveCustomerId(selectedCustomerDrawer.id);
                  setSelectedCustomerDrawer(null);
                  setPortalMode('customer');
                }}
                className="w-full py-2.5 rounded-xl bg-[#E50914] text-white font-bold"
              >
                Preview Client's Self-Service Portal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW RECEIPT & ALLOCATION MODAL */}
      {newReceiptModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
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
        </div>
      )}

      {/* NEW INVOICE MODAL */}
      {newInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
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
        </div>
      )}

      {/* FLOATING AURON AI ASSISTANT BAR */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-40">
        {aiOpen && (
          <div className={`mb-2 p-4 rounded-2xl border shadow-2xl ${bgCard}`}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold flex items-center space-x-1.5 text-[#E50914]">
                <Sparkles className="w-4 h-4" />
                <span>Auron AI Collection Copilot</span>
              </span>
              <button onClick={() => setAiOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2 mb-3 text-xs">
              {aiMessages.map((m, i) => (
                <div key={i} className={`p-2 rounded-xl ${m.sender === 'ai' ? bgSurface : 'bg-[#E50914]/15'}`}>
                  <span className="font-bold">{m.sender === 'ai' ? 'Auron AI: ' : 'You: '}</span>
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['Who has highest overdue?', 'Check broken promises', 'Send WhatsApp reminders'].map((p) => (
                <button
                  key={p}
                  onClick={() => handleAskAI(p)}
                  className={`px-2.5 py-1 rounded-full text-[11px] border hover:border-[#E50914] ${bgSurface}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`rounded-full border shadow-2xl px-4 py-2 flex items-center space-x-2 ${bgCard}`}>
          <button onClick={() => setAiOpen(!aiOpen)} className="text-[#E50914]">
            <Sparkles className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={aiInput}
            onFocus={() => setAiOpen(true)}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
            placeholder="Ask Auron AI about overdue accounts, PTPs, or send reminders..."
            className="flex-1 bg-transparent text-xs focus:outline-none"
          />
          <button
            onClick={() => handleAskAI()}
            className="p-2 rounded-full bg-[#E50914] text-white hover:bg-[#B00020] transition"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
