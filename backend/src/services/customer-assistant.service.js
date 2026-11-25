const formatMoney = (amount, currency = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
};

const formatDate = (date) => {
  if (!date) return "not available";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(date));
};

export const buildCustomerAssistantReply = (message, context) => {
  const question = message.toLowerCase();
  const matchedInvoice = context.invoices.find((item) =>
    question.includes(item.invoiceNumber.toLowerCase())
  );
  const invoice = matchedInvoice || context.invoices[0];

  if (/\b(plan|pricing|price|upgrade|renew|subscription)\b/.test(question)) {
    if (context.plans.length === 0) {
      return "There are no approved subscription plans available for your organization right now. Please check again later or contact your account administrator.";
    }
    const cycle = /\b(half[- ]?yearly|semiannual|six[- ]?month)\b/.test(question)
      ? "HALF_YEARLY"
      : /\b(quarterly|three[- ]?month)\b/.test(question)
        ? "QUARTERLY"
        : /\b(year|annual|yearly)\b/.test(question)
          ? "YEARLY"
          : "MONTHLY";
    const cyclePrices = {
      MONTHLY: ["monthlyPrice", "month"],
      QUARTERLY: ["quarterlyPrice", "quarter"],
      HALF_YEARLY: ["halfYearlyPrice", "half-year"],
      YEARLY: ["yearlyPrice", "year"]
    };
    const [priceField, periodLabel] = cyclePrices[cycle];
    const choices = context.plans
      .map((plan) => {
        const price = plan[priceField];
        return price === null
          ? null
          : `${plan.name}: ${formatMoney(price, plan.currency)} per ${periodLabel}`;
      })
      .filter(Boolean);
    const current = context.subscription
      ? ` Your current subscription is ${context.subscription.plan.name} (${context.subscription.status.toLowerCase()}).`
      : "";
    return `${choices.length ? `Approved ${cycle.toLowerCase()} plans: ${choices.join("; ")}.` : `No approved ${cycle.toLowerCase()} prices are available.`}${current} You can review or renew from the Subscription tab; checkout requires your confirmation and never charges automatically.`;
  }

  if (/\b(balance|outstanding|owe|amount due|total due)\b/.test(question)) {
    const balances = Object.entries(context.outstandingByCurrency || {})
      .map(([currency, value]) => `${currency} ${formatMoney(value, currency)}`);
    const balanceText = balances.length ? balances.join("; ") : formatMoney(0);
    return `Your current outstanding invoice balance is ${balanceText} across ${context.openInvoiceCount} open invoice${context.openInvoiceCount === 1 ? "" : "s"}. This figure is calculated from your account's issued invoices, posted payments, and approved credits.`;
  }

  if (/\b(due date|when.*due|due soon|upcoming|overdue)\b/.test(question)) {
    if (!context.upcomingInvoice) {
      return context.overdueCount
        ? `You have ${context.overdueCount} overdue invoice${context.overdueCount === 1 ? "" : "s"}. Open Invoice history to review the due dates and remaining balances.`
        : "There are no unpaid invoices currently due in the next 30 days.";
    }
    return `Your next due invoice is ${context.upcomingInvoice.invoiceNumber}, due ${formatDate(context.upcomingInvoice.dueDate)} with ${formatMoney(context.upcomingInvoice.outstanding, context.upcomingInvoice.currency)} outstanding.`;
  }

  if (/\b(invoice|tax|gst|bill)\b/.test(question) || matchedInvoice) {
    if (!invoice) return "There are no issued invoices available in your account yet. New invoices appear in the Invoice history tab.";
    return `${invoice.invoiceNumber} is ${invoice.status.toLowerCase()}. Total ${formatMoney(invoice.total, invoice.currency)}; paid ${formatMoney(invoice.paid, invoice.currency)}; outstanding ${formatMoney(invoice.outstanding, invoice.currency)}. It was issued ${formatDate(invoice.invoiceDate)} and is due ${formatDate(invoice.dueDate)}. Download its PDF from Invoice history.`;
  }

  if (/\b(payment|paid|receipt|transaction|razorpay|failed|pending)\b/.test(question)) {
    const payment = context.payments.find((item) =>
      [item.id, item.razorpayPaymentId, item.razorpayOrderId]
        .filter(Boolean)
        .some((reference) => question.includes(reference.toLowerCase()))
    ) || context.payments[0];
    if (payment) {
      const date = payment.paidAt || payment.createdAt;
      const details = `Your latest subscription payment is ${payment.status.toLowerCase()} for ${formatMoney(payment.amount, payment.currency)}${date ? ` on ${formatDate(date)}` : ""}.`;
      if (payment.status === "FAILED") {
        return `${details} No subscription was activated for that payment. You can review its status in Subscription & billing and retry checkout when available.`;
      }
      if (payment.status === "PAID") {
        return `${details} The subscription was activated only after server-side provider verification. Download the receipt or transaction details from Subscription & billing → Billing history.`;
      }
      return `${details} A subscription is activated only after the payment is confirmed by the payment provider.`;
    }
    return context.receiptCount
      ? `Your account has ${context.receiptCount} posted invoice payment receipt${context.receiptCount === 1 ? "" : "s"}. Open Payment history to review posted receipts and their allocations.`
      : "No subscription payment or posted invoice receipt is recorded on your account yet.";
  }

  if (/\b(help|portal|download|where|how|support|contact)\b/.test(question)) {
    return "I can help explain plans, invoices, payment states, balances and due dates. Use Overview for account totals, Invoice history for invoice PDFs, Payment history for posted receipts, and Subscription & billing for plan details, subscription invoices, receipts and transaction downloads. Payments always require your explicit checkout confirmation.";
  }

  return "I can help with your subscription plans, invoice details, payment status, outstanding balance, due dates, receipts and portal navigation. Ask about a specific invoice number or payment reference for more detail.";
};
