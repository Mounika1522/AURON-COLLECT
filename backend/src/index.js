import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import prisma from "./config/prisma.js";
import { assertSafeDevelopmentDatabase } from "./config/runtime-safety.js";

import authRoutes from "./routes/auth.routes.js";
import authMiddleware from "./middleware/auth.middleware.js";
import customerAuthRoutes from "./routes/customer-auth.routes.js";
import customerPortalRoutes from "./routes/customer-portal.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import receiptRoutes from "./routes/receipt.routes.js";
import ageingRoutes from "./routes/ageing.routes.js";
import collectionRoutes from "./routes/collection.routes.js";
import taskRoutes from "./routes/task.routes.js";
import promiseRoutes from "./routes/promise.routes.js";
import disputeRoutes from "./routes/dispute.routes.js";
import communicationRoutes from "./routes/communication.routes.js";
import reminderRoutes from "./routes/reminder.routes.js";
import statementRoutes from "./routes/statement.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import customerSubscriptionPlanRoutes from "./routes/customer-subscription-plan.routes.js";
import creditAdjustmentRoutes from "./routes/credit-adjustment.routes.js";
import adminNotificationRoutes from "./routes/admin-notification.routes.js";

import { startReminderScheduler } from "./services/reminder.scheduler.js";
import emailTestRoutes from "./routes/email-test.routes.js";
import { handleRazorpayWebhook } from "./controllers/subscription-billing.controller.js";
import { handleCustomerSubscriptionWebhook } from "./controllers/customer-subscription.controller.js";
import { startCustomerSubscriptionScheduler } from "./services/customer-subscription.scheduler.js";

const app = express();

// ==============================
// SECURITY MIDDLEWARE
// ==============================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'", "https://checkout.razorpay.com"],
        "connect-src": [
          "'self'",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com"
        ],
        "frame-src": [
          "'self'",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com"
        ],
        "img-src": [
          "'self'",
          "data:",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com"
        ],
        "form-action": [
          "'self'",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com"
        ]
      }
    }
  })
);

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key"
    ]
  })
);

app.post(
  "/api/subscriptions/razorpay/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleRazorpayWebhook
);
app.post(
  "/api/customer-portal/subscriptions/razorpay/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleCustomerSubscriptionWebhook
);

// ==============================
// REQUEST BODY PARSING
// ==============================

app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb"
  })
);

// ==============================
// BODY VALIDATION
// ==============================

app.use((req, res, next) => {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    req.is("application/json") &&
    req.body === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid or missing JSON request body"
    });
  }

  next();
});

// ==============================
// HOME ROUTE
// ==============================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to Auron Collect Backend"
  });
});

// ==============================
// DATABASE HEALTH CHECK
// ==============================

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      message: "Backend and PostgreSQL are connected!"
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed"
    });
  }
});

// ==============================
// AUTHENTICATION ROUTES
// ==============================

app.use("/api/auth", authRoutes);
app.use("/api/customer-auth", customerAuthRoutes);
app.use("/api/customer-portal", customerPortalRoutes);

// Protected profile route
app.get("/api/auth/profile", authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: "You are authorized!",
    user: req.user
  });
});

// ==============================
// APPLICATION ROUTES
// ==============================

app.use("/api/customers", customerRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/ageing", ageingRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/promises", promiseRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/communications", communicationRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/statements", statementRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/customer-subscription-plans", customerSubscriptionPlanRoutes);
app.use("/api/credit-adjustments", creditAdjustmentRoutes);
app.use("/api/admin-notifications", adminNotificationRoutes);

// ==============================
// DEVELOPMENT EMAIL TEST
// ==============================

if (process.env.NODE_ENV !== "production") {
  app.use("/api/email-test", emailTestRoutes);
}

// ==============================
// 404 HANDLER
// ==============================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found"
  });
});

// ==============================
// GLOBAL ERROR HANDLER
// ==============================

app.use((error, req, res, next) => {
  console.error("Server Error:", error);

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed"
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request body is too large"
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body"
    });
  }

  res.status(error.status || 500).json({
    success: false,
    message: "Internal server error"
  });
});

// ==============================
// SERVER START
// ==============================

const PORT = process.env.PORT || 5000;

assertSafeDevelopmentDatabase();

const server = app.listen(PORT, "localhost", () => {
  console.log(`Server running on port ${PORT}`);

  // Start reminder scheduler only once
  startReminderScheduler();
  startCustomerSubscriptionScheduler();
});

// ==============================
// GRACEFUL SHUTDOWN
// ==============================

let isShuttingDown = false;

const shutdown = async (signal) => {
  if (isShuttingDown) return;

  isShuttingDown = true;

  console.log(`${signal} received. Shutting down server...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("Database disconnected successfully");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error);
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;