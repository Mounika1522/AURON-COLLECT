const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const actionUrl = (parameter, token) => {
  const configuredOrigin = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  const origin = configuredOrigin || "http://localhost:5173";
  const url = new URL("/", origin);
  url.searchParams.set(parameter, token);
  return url.toString();
};

const customerPortalUrl = () => {
  const configuredOrigin = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  const origin = configuredOrigin || "http://localhost:5173";
  const url = new URL("/", origin);
  url.searchParams.set("customerPortal", "1");
  return url.toString();
};

const brandedEmail = ({ heading, greeting, message, actionLabel, url, details }) => {
  const safeGreeting = escapeHtml(greeting);
  const safeMessage = escapeHtml(message);
  const safeHeading = escapeHtml(heading);
  const safeDetails = details
    ? `<p style="color:#52525b;font-size:14px;line-height:1.6">${escapeHtml(details)}</p>`
    : "";
  const action = url
    ? `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="background:#e50914;border-radius:8px;color:#fff;display:inline-block;font-weight:600;padding:12px 20px;text-decoration:none">${escapeHtml(actionLabel)}</a></p><p style="color:#71717a;font-size:12px;line-height:1.6">If the button does not work, copy this link into your browser:<br>${escapeHtml(url)}</p>`
    : "";

  return {
    html: `<div style="background:#f4f4f5;padding:32px;font-family:Arial,sans-serif"><div style="background:#fff;border-radius:12px;margin:0 auto;max-width:560px;padding:32px"><p style="color:#e50914;font-size:12px;font-weight:700;letter-spacing:1px">ALPHA AURON COLLECT</p><h1 style="color:#18181b;font-size:22px">${safeHeading}</h1><p style="color:#27272a;font-size:14px;line-height:1.6">Hello ${safeGreeting},</p><p style="color:#52525b;font-size:14px;line-height:1.6">${safeMessage}</p>${safeDetails}${action}<hr style="border:0;border-top:1px solid #e4e4e7"><p style="color:#71717a;font-size:11px">Alpha Auron Collect · This message concerns your customer portal account.</p></div></div>`,
    text: `${heading}\n\nHello ${greeting},\n\n${message}${details ? `\n\n${details}` : ""}${url ? `\n\n${actionLabel}: ${url}` : ""}\n\nAlpha Auron Collect`
  };
};

export const customerEmailTemplate = (type, data) => {
  switch (type) {
    case "VERIFY_EMAIL":
      return {
        subject: "Verify your Alpha Auron Collect account",
        ...brandedEmail({
          heading: "Verify your email address",
          greeting: data.fullName,
          message: "Enter this one-time code to verify your email address and activate customer portal access. It expires in 5 minutes and can be used once.",
          details: `Verification code: ${data.otp}`
        })
      };
    case "RESET_PASSWORD":
      return {
        subject: "Reset your Alpha Auron Collect password",
        ...brandedEmail({
          heading: "Reset your password",
          greeting: data.fullName,
          message: "A password reset was requested for your customer portal account. The secure link can be used once and expires in 30 minutes.",
          actionLabel: "Reset password",
          url: actionUrl("customerReset", data.token)
        })
      };
    case "INVOICE_GENERATED":
      return {
        subject: `New invoice ${data.invoiceNumber} is available`,
        ...brandedEmail({
          heading: "A new invoice is available",
          greeting: data.fullName,
          message: `Invoice ${data.invoiceNumber} has been issued.`,
          details: `${data.currency} ${data.amount} · Due ${data.dueDate}`
        })
      };
    case "INVOICE_UPDATED":
      return {
        subject: `Invoice ${data.invoiceNumber} was updated`,
        ...brandedEmail({
          heading: "Your invoice was updated",
          greeting: data.fullName,
          message: `Invoice ${data.invoiceNumber} has been updated.`,
          details: `${data.currency} ${data.amount} · Due ${data.dueDate}`
        })
      };
    case "PAYMENT_RECEIVED":
      return {
        subject: `Payment received for receipt ${data.receiptNumber}`,
        ...brandedEmail({
          heading: "Payment received",
          greeting: data.fullName,
          message: `We recorded your payment under receipt ${data.receiptNumber}. A PDF copy of the receipt is attached.`,
          details: [
            `${data.currency} ${data.amount}`,
            data.paymentDate,
            data.paymentMethod,
            data.transactionReference
          ].filter(Boolean).join(" · "),
          actionLabel: "Download receipt",
          url: data.receiptDownloadUrl
        })
      };
    case "PAYMENT_RECEIPT":
      return {
        subject: `Official payment receipt ${data.receiptNumber}`,
        ...brandedEmail({
          heading: "Your official payment receipt",
          greeting: data.fullName,
          message: `Your verified subscription payment is recorded under receipt ${data.receiptNumber}. The official PDF receipt is attached.`,
          details: [
            `${data.currency} ${data.amount}`,
            data.paymentDate,
            data.paymentMethod,
            data.transactionReference
          ].filter(Boolean).join(" · ")
        })
      };
    case "SUBSCRIPTION_RENEWAL_FAILED":
      return {
        subject: "Subscription payment needs attention",
        ...brandedEmail({
          heading: "Subscription payment needs attention",
          greeting: data.fullName,
          message: data.message,
          details: data.details || null
        })
      };
    case "PAYMENT_REMINDER":
    case "OVERDUE_REMINDER": {
      const overdue = type === "OVERDUE_REMINDER";
      return {
        subject: data.subject || (overdue ? "Overdue payment reminder" : "Payment reminder"),
        ...brandedEmail({
          heading: overdue ? "Your payment is overdue" : "Payment reminder",
          greeting: data.fullName,
          message: data.message,
          details: data.details,
          actionLabel: "Open customer portal",
          url: customerPortalUrl()
        })
      };
    }
    default:
      throw new Error(`Unsupported customer email template: ${type}`);
  }
};
