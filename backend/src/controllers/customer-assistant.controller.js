import prisma from "../config/prisma.js";
import { buildCustomerAssistantReply } from "../services/customer-assistant.service.js";

export const getCustomerAssistantHistory = async (req, res) => {
  try {
    const messages = await prisma.customerAssistantMessage.findMany({
      where: {
        organisationId: req.customer.organisationId,
        customerId: req.customer.customerId
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, role: true, content: true, createdAt: true }
    });
    return res.status(200).json({ success: true, messages: messages.reverse() });
  } catch (error) {
    console.error("Customer Auron conversation history failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your Auron conversation history."
    });
  }
};

export const answerCustomerAssistant = async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: "Enter a question of up to 500 characters."
    });
  }

  const scope = {
    organisationId: req.customer.organisationId,
    customerId: req.customer.customerId
  };
  try {
    const now = new Date();
    const nextThirtyDays = new Date(now);
    nextThirtyDays.setDate(nextThirtyDays.getDate() + 30);
    const [invoices, payments, subscription, plans, receiptCount] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          ...scope,
          status: { notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"] }
        },
        include: {
          allocations: {
            where: {
              status: "POSTED",
              reversedAt: null,
              receipt: { status: "POSTED" }
            },
            select: { amount: true }
          },
          creditAdjustments: {
            where: { status: "APPROVED" },
            select: { amount: true }
          }
        },
        orderBy: [{ dueDate: "asc" }, { invoiceDate: "desc" }],
        take: 100
      }),
      prisma.customerSubscriptionPayment.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          planName: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          razorpayPaymentId: true,
          razorpayOrderId: true,
          paidAt: true,
          createdAt: true
        }
      }),
      prisma.customerSubscription.findFirst({
        where: { ...scope, status: { in: ["ACTIVE", "SCHEDULED"] } },
        include: { plan: { select: { name: true } } },
        orderBy: { startsAt: "desc" }
      }),
      prisma.customerSubscriptionPlan.findMany({
        where: {
          organisationId: req.customer.organisationId,
          isActive: true,
          pricingStatus: "APPROVED",
          pricingProposalStatus: "APPROVED",
          taxTermsStatus: "APPROVED",
          taxProposalStatus: "APPROVED",
          taxTerms: { not: null }
        },
        select: {
          name: true,
          monthlyPrice: true,
          quarterlyPrice: true,
          halfYearlyPrice: true,
          yearlyPrice: true,
          currency: true,
          eligibleCustomerTypes: true
        },
        orderBy: { name: "asc" }
      }),
      prisma.receipt.count({ where: { ...scope, status: "POSTED" } })
    ]);

    const mappedInvoices = invoices.map((invoice) => {
      const paid = invoice.allocations.reduce((sum, item) => sum + Number(item.amount), 0);
      const credits = invoice.creditAdjustments.reduce((sum, item) => sum + Number(item.amount), 0);
      const total = Number(invoice.total);
      const outstanding = Math.max(0, total - paid - credits);
      return {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        total,
        paid,
        outstanding,
        status: outstanding <= 0
          ? "Paid"
          : invoice.dueDate < now
            ? "Overdue"
            : "Open"
      };
    });
    const openInvoices = mappedInvoices.filter((invoice) => invoice.outstanding > 0);
    const outstandingByCurrency = openInvoices.reduce((balances, invoice) => {
      balances[invoice.currency] = (balances[invoice.currency] || 0) + invoice.outstanding;
      return balances;
    }, {});
    const upcomingInvoice = openInvoices
      .filter((invoice) => invoice.dueDate >= now && invoice.dueDate <= nextThirtyDays)
      .sort((left, right) => left.dueDate - right.dueDate)[0] || null;
    const plansForAssistant = plans
      .filter((plan) =>
        !plan.eligibleCustomerTypes?.length ||
        plan.eligibleCustomerTypes.includes(req.customer.customerType)
      )
      .map((plan) => ({
        ...plan,
        monthlyPrice: Number(plan.monthlyPrice) > 0 ? Number(plan.monthlyPrice) : null,
        quarterlyPrice: Number(plan.quarterlyPrice) > 0 ? Number(plan.quarterlyPrice) : null,
        halfYearlyPrice: Number(plan.halfYearlyPrice) > 0 ? Number(plan.halfYearlyPrice) : null,
        yearlyPrice: Number(plan.yearlyPrice) > 0 ? Number(plan.yearlyPrice) : null
      }))
      .filter((plan) =>
        [plan.monthlyPrice, plan.quarterlyPrice, plan.halfYearlyPrice, plan.yearlyPrice]
          .some((price) => price !== null)
      );

    const reply = buildCustomerAssistantReply(message.trim(), {
      invoices: mappedInvoices,
      outstandingByCurrency,
      openInvoiceCount: openInvoices.length,
      overdueCount: openInvoices.filter((invoice) => invoice.status === "Overdue").length,
      upcomingInvoice,
      payments,
      subscription,
      plans: plansForAssistant,
      receiptCount
    });
    const userMessageCreatedAt = new Date();
    const assistantMessageCreatedAt = new Date(userMessageCreatedAt.getTime() + 1);
    await prisma.$transaction([
      prisma.customerAssistantMessage.create({
        data: {
          ...scope,
          role: "user",
          content: message.trim(),
          createdAt: userMessageCreatedAt
        }
      }),
      prisma.customerAssistantMessage.create({
        data: {
          ...scope,
          role: "assistant",
          content: reply,
          createdAt: assistantMessageCreatedAt
        }
      })
    ]);
    return res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error("Customer Auron assistant request failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Auron could not answer right now. Please try again."
    });
  }
};
