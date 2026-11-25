import prisma from "../config/prisma.js";
import {
  buildCustomerDataWhere,
  buildInvoiceDataWhere,
  buildReminderDataWhere,
} from "../services/dashboard-access.service.js";
import { validateReminderScheduleTime } from "../services/reminder-time.service.js";

const allowedChannels = ["EMAIL"];
const allowedStatuses = ["PENDING", "SENT", "FAILED", "CANCELLED"];

// CREATE REMINDER TEMPLATE
export const createReminderTemplate = async (req, res) => {
  try {
    const organisationId = req.user.organisationId;
    const { name, triggerStage, channel, subject, body } = req.body;

    if (!name || !triggerStage || !channel || !body) {
      return res.status(400).json({
        success: false,
        message: "name, triggerStage, channel and body are required"
      });
    }

    if (!allowedChannels.includes(channel.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Only email reminders are supported"
      });
    }

    const template = await prisma.reminderTemplate.create({
      data: {
        name,
        triggerStage,
        channel: channel.toUpperCase(),
        subject,
        body,
        organisationId
      }
    });

    return res.status(201).json({
      success: true,
      message: "Reminder template created successfully",
      template
    });
  } catch (error) {
    console.error("Create template error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A template with this name already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create reminder template"
    });
  }
};

// GET REMINDER TEMPLATES
export const getReminderTemplates = async (req, res) => {
  try {
    const templates = await prisma.reminderTemplate.findMany({
      where: {
        organisationId: req.user.organisationId,
        channel: "EMAIL",
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json({
      success: true,
      count: templates.length,
      templates
    });
  } catch (error) {
    console.error("Get templates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reminder templates"
    });
  }
};

// UPDATE REMINDER TEMPLATE
export const updateReminderTemplate = async (req, res) => {
  try {
    const organisationId = req.user.organisationId;
    const { name, triggerStage, channel, subject, body, isActive } = req.body;

    if (channel && !allowedChannels.includes(channel.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Only email reminders are supported"
      });
    }

    const existing = await prisma.reminderTemplate.findFirst({
      where: {
        id: req.params.id,
        organisationId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Reminder template not found"
      });
    }
    if (existing.channel !== "EMAIL") {
      return res.status(404).json({
        success: false,
        message: "Reminder template not found"
      });
    }

    const template = await prisma.reminderTemplate.update({
      where: { id: existing.id },
      data: {
        ...(name !== undefined && { name }),
        ...(triggerStage !== undefined && { triggerStage }),
        ...(channel !== undefined && { channel: channel.toUpperCase() }),
        ...(subject !== undefined && { subject }),
        ...(body !== undefined && { body }),
        ...(isActive !== undefined && { isActive })
      }
    });

    return res.json({
      success: true,
      message: "Reminder template updated successfully",
      template
    });
  } catch (error) {
    console.error("Update template error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A template with this name already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update reminder template"
    });
  }
};

// CREATE REMINDER
export const createReminder = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;

    const {
      customerId,
      invoiceId,
      templateId,
      scheduledFor,
      channel,
      subject,
      message,
      dedupeKey
    } = req.body;

    if (!customerId || !scheduledFor || !channel || !message || !dedupeKey) {
      return res.status(400).json({
        success: false,
        message: "customerId, scheduledFor, channel, message and dedupeKey are required"
      });
    }

    if (!allowedChannels.includes(channel.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Only email reminders are supported"
      });
    }

    const scheduleValidation = validateReminderScheduleTime(scheduledFor);
    if (scheduleValidation.error === "INVALID_DATE") {
      return res.status(400).json({
        success: false,
        message: "Invalid scheduledFor date"
      });
    }

    if (scheduleValidation.error === "PAST_DATE") {
      return res.status(400).json({
        success: false,
        message: "scheduledFor must be in the future"
      });
    }

    const scheduledDate = scheduleValidation.scheduledFor;

    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: customerId })
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    if (invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: buildInvoiceDataWhere(access, { id: invoiceId, customerId })
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found for this customer"
        });
      }
    }

    if (templateId) {
      const template = await prisma.reminderTemplate.findFirst({
        where: {
          id: templateId,
          organisationId,
          channel: "EMAIL",
          isActive: true
        }
      });

      if (!template) {
        return res.status(404).json({
          success: false,
          message: "Active reminder template not found"
        });
      }
    }

    const reminder = await prisma.reminder.create({
      data: {
        scheduledFor: scheduledDate,
        channel: channel.toUpperCase(),
        subject,
        message,
        dedupeKey,
        status: "PENDING",
        deliveryStatus: "PENDING",
        createdBy: req.user.userId,
        organisationId,
        customerId,
        invoiceId: invoiceId || null,
        templateId: templateId || null
      },
      include: {
        customer: true,
        invoice: true,
        template: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Reminder scheduled successfully",
      reminder
    });
  } catch (error) {
    console.error("Create reminder error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A reminder with this dedupeKey already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to schedule reminder"
    });
  }
};

// GET ALL REMINDERS
export const getReminders = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { customerId, invoiceId, status } = req.query;

    if (status && !allowedStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid reminder status"
      });
    }

    const reminders = await prisma.reminder.findMany({
      where: buildReminderDataWhere(access, {
        channel: "EMAIL",
        ...(customerId && { customerId }),
        ...(invoiceId && { invoiceId }),
        ...(status && { status: status.toUpperCase() })
      }),
      include: {
        customer: true,
        invoice: true,
        template: true
      },
      orderBy: { scheduledFor: "asc" }
    });

    return res.json({
      success: true,
      count: reminders.length,
      reminders
    });
  } catch (error) {
    console.error("Get reminders error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reminders"
    });
  }
};

// GET REMINDER BY ID
export const getReminderById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const reminder = await prisma.reminder.findFirst({
      where: buildReminderDataWhere(access, {
        id: req.params.id,
        channel: "EMAIL"
      }),
      include: {
        customer: true,
        invoice: true,
        template: true
      }
    });

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: "Reminder not found"
      });
    }

    return res.json({
      success: true,
      reminder
    });
  } catch (error) {
    console.error("Get reminder error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reminder"
    });
  }
};

// UPDATE REMINDER STATUS
export const updateReminderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (typeof status !== "string" || status.toUpperCase() !== "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Only pending reminders can be cancelled manually"
      });
    }

    const access = req.dashboardAccess;

    const existing = await prisma.reminder.findFirst({
      where: buildReminderDataWhere(access, {
        id: req.params.id,
        channel: "EMAIL"
      })
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Reminder not found"
      });
    }

    if (["CANCELLED", "SENT", "SMTP_ACCEPTED"].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        message: "A sent or cancelled reminder cannot be changed"
      });
    }

    const reminder = await prisma.reminder.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        deliveryStatus: "CANCELLED",
        sentAt: null
      },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.json({
      success: true,
      message: "Reminder status updated successfully",
      reminder
    });
  } catch (error) {
    console.error("Update reminder status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update reminder status"
    });
  }
};