import express from "express";
import rateLimit from "express-rate-limit";
import customerAuthMiddleware from "../middleware/customer-auth.middleware.js";
import {
  answerCustomerAssistant,
  getCustomerAssistantHistory
} from "../controllers/customer-assistant.controller.js";
import {
  changeCustomerPassword,
  getCustomerDashboard,
  getCustomerInvoicePdf,
  getCustomerInvoices,
  getCustomerNotifications,
  getCustomerProfile,
  getCustomerReceiptPdf,
  getCustomerReceipts,
  markAllCustomerNotificationsRead,
  markCustomerNotificationRead,
  updateCustomerProfile
} from "../controllers/customer-portal.controller.js";
import {
  cancelCustomerSubscription,
  createCustomerSubscriptionCheckout,
  disableCustomerSubscriptionAutoRenew,
  enableCustomerSubscriptionAutoRenew,
  getCustomerSubscriptionBilling,
  getCustomerSubscriptionInvoicePdf,
  getCustomerSubscriptionHistoryPdf,
  getCustomerSubscriptionPaymentPdf,
  getCustomerSubscriptionReceiptPdf,
  getCustomerSubscriptions,
  verifyCustomerSubscriptionCheckout
} from "../controllers/customer-subscription.controller.js";
import {
  createCustomerOrganizationSubscriptionOrder,
  disableCustomerOrganizationAutoRenew,
  downloadCustomerOrganizationSubscriptionReceipt,
  enableCustomerOrganizationAutoRenew,
  getCustomerOrganizationSubscription,
  verifyCustomerOrganizationSubscriptionOrder
} from "../controllers/customer-organization-subscription.controller.js";

const router = express.Router();
const customerAssistantLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Please wait a moment before asking Auron another question." }
});

router.use(customerAuthMiddleware);
router.get("/profile", getCustomerProfile);
router.patch("/profile", updateCustomerProfile);
router.patch("/profile/password", changeCustomerPassword);
router.get("/dashboard", getCustomerDashboard);
router.get("/invoices", getCustomerInvoices);
router.get("/invoices/:invoiceId/pdf", getCustomerInvoicePdf);
router.get("/receipts", getCustomerReceipts);
router.get("/receipts/:receiptId/pdf", getCustomerReceiptPdf);
router.get("/notifications", getCustomerNotifications);
router.patch("/notifications/read-all", markAllCustomerNotificationsRead);
router.patch("/notifications/:notificationId/read", markCustomerNotificationRead);
router.get("/subscriptions", getCustomerSubscriptions);
router.post("/subscriptions/checkout", createCustomerSubscriptionCheckout);
router.post("/subscriptions/verify", verifyCustomerSubscriptionCheckout);
router.post(
  "/subscriptions/:subscriptionId/enable-auto-renew",
  enableCustomerSubscriptionAutoRenew
);
router.post(
  "/subscriptions/:subscriptionId/disable-auto-renew",
  disableCustomerSubscriptionAutoRenew
);
router.get("/organization-subscription", getCustomerOrganizationSubscription);
router.post(
  "/organization-subscription/:subscriptionId/enable-auto-renew",
  enableCustomerOrganizationAutoRenew
);
router.post(
  "/organization-subscription/:subscriptionId/disable-auto-renew",
  disableCustomerOrganizationAutoRenew
);
router.post(
  "/organization-subscription/orders",
  createCustomerOrganizationSubscriptionOrder
);
router.post(
  "/organization-subscription/orders/verify",
  verifyCustomerOrganizationSubscriptionOrder
);
router.get(
  "/organization-subscription/payments/:paymentId/receipt.pdf",
  downloadCustomerOrganizationSubscriptionReceipt
);
router.post("/subscriptions/:subscriptionId/cancel", cancelCustomerSubscription);
router.get("/subscriptions/billing", getCustomerSubscriptionBilling);
router.get("/subscriptions/billing-history/pdf", getCustomerSubscriptionHistoryPdf);
router.get("/subscriptions/payments/:paymentId/pdf", getCustomerSubscriptionPaymentPdf);
router.get("/subscriptions/invoices/:invoiceId/pdf", getCustomerSubscriptionInvoicePdf);
router.get("/subscriptions/receipts/:receiptId/pdf", getCustomerSubscriptionReceiptPdf);
router.get("/assistant/history", customerAssistantLimit, getCustomerAssistantHistory);
router.post("/assistant/chat", customerAssistantLimit, answerCustomerAssistant);

export default router;
