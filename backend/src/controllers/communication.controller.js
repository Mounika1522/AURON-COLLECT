
import prisma from "../config/prisma.js";
import {
  buildCommunicationDataWhere,
  buildCustomerDataWhere,
  buildInvoiceDataWhere,
} from "../services/dashboard-access.service.js";

// CREATE COMMUNICATION
export const createCommunication = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;

    const {
      customerId,
      invoiceId,
      channel,
      direction,
      subject,
      message,
      outcome,
      deliveryStatus,
      occurredAt
    } = req.body;

    // Required field validation
    if (
      typeof customerId !== "string" ||
      !customerId.trim() ||
      typeof channel !== "string" ||
      !channel.trim() ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "customerId, channel and message are required"
      });
    }

    const normalizedChannel = channel.trim().toUpperCase();
    const normalizedDirection = direction
      ? String(direction).trim().toUpperCase()
      : "OUTBOUND";

    const allowedChannels = ["EMAIL"];

    const allowedDirections = ["INBOUND", "OUTBOUND"];

    if (!allowedChannels.includes(normalizedChannel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid communication channel"
      });
    }

    if (!allowedDirections.includes(normalizedDirection)) {
      return res.status(400).json({
        success: false,
        message: "Invalid communication direction"
      });
    }

    // Validate optional text fields
    if (
      subject !== undefined &&
      subject !== null &&
      typeof subject !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Subject must be a string"
      });
    }

    if (
      outcome !== undefined &&
      outcome !== null &&
      typeof outcome !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Outcome must be a string"
      });
    }

    if (
      deliveryStatus !== undefined &&
      deliveryStatus !== null &&
      typeof deliveryStatus !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Delivery status must be a string"
      });
    }

    // Validate occurrence date
    let communicationDate = new Date();

    if (occurredAt !== undefined && occurredAt !== null) {
      communicationDate = new Date(occurredAt);

      if (Number.isNaN(communicationDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid communication date"
        });
      }
    }

    // Check customer belongs to logged-in organisation
    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: customerId.trim() })
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    // Check optional invoice belongs to same customer and organisation
    if (invoiceId !== undefined && invoiceId !== null && invoiceId !== "") {
      if (typeof invoiceId !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid invoice ID"
        });
      }

      const invoice = await prisma.invoice.findFirst({
        where: buildInvoiceDataWhere(access, {
          id: invoiceId,
          customerId: customer.id
        })
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found for this customer"
        });
      }
    }

    const communication = await prisma.communication.create({
      data: {
        channel: normalizedChannel,
        direction: normalizedDirection,
        subject: subject?.trim() || null,
        message: message.trim(),
        outcome: outcome?.trim() || null,
        deliveryStatus: deliveryStatus?.trim() || "RECORDED",
        occurredAt: communicationDate,
        recordedBy: req.user.userId,
        organisationId,
        customerId: customer.id,
        invoiceId: invoiceId || null
      },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Communication recorded successfully",
      communication
    });
  } catch (error) {
    console.error("Create communication error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create communication"
    });
  }
};

// GET ALL COMMUNICATIONS
export const getCommunications = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { customerId, invoiceId, channel } = req.query;

    // Validate query parameters
    if (
      customerId !== undefined &&
      (typeof customerId !== "string" || !customerId.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID filter"
      });
    }

    if (
      invoiceId !== undefined &&
      (typeof invoiceId !== "string" || !invoiceId.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice ID filter"
      });
    }

    const filters = {
      channel: "EMAIL"
    };

    if (customerId) {
      filters.customerId = customerId;
    }

    if (invoiceId) {
      filters.invoiceId = invoiceId;
    }

    if (channel) {
      if (typeof channel !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid channel filter"
        });
      }

      const normalizedChannel = channel.trim().toUpperCase();

      const allowedChannels = ["EMAIL"];

      if (!allowedChannels.includes(normalizedChannel)) {
        return res.status(400).json({
          success: false,
          message: "Invalid channel filter"
        });
      }

      filters.channel = normalizedChannel;
    }

    const communications = await prisma.communication.findMany({
      where: buildCommunicationDataWhere(access, filters),
      include: {
        customer: true,
        invoice: true
      },
      orderBy: {
        occurredAt: "desc"
      }
    });

    return res.json({
      success: true,
      count: communications.length,
      communications
    });
  } catch (error) {
    console.error("Get communications error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch communications"
    });
  }
};

// GET COMMUNICATION BY ID
export const getCommunicationById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const communication = await prisma.communication.findFirst({
      where: buildCommunicationDataWhere(access, {
        id: req.params.id,
        channel: "EMAIL"
      }),
      include: {
        customer: true,
        invoice: true
      }
    });

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: "Communication not found"
      });
    }

    return res.json({
      success: true,
      communication
    });
  } catch (error) {
    console.error("Get communication error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch communication"
    });
  }
};
