
import prisma from "../config/prisma.js";
import {
  buildInvoiceDataWhere,
  buildTaskDataWhere,
} from "../services/dashboard-access.service.js";

const TASK_TYPES = ["CALL", "EMAIL", "VISIT", "OTHER"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const OUTCOMES = [
  "CONNECTED",
  "NO_ANSWER",
  "PROMISED_TO_PAY",
  "DISPUTED",
  "PARTIALLY_PAID",
  "PAID",
  "RESCHEDULED",
  "ESCALATED"
];

// CREATE TASK
export const createTask = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;

    const {
      title,
      description,
      taskType = "CALL",
      priority = "MEDIUM",
      dueDate,
      assignedExecutive,
      customerId,
      invoiceId
    } = req.body;

    if (!title || !customerId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: "Title, customerId and dueDate are required"
      });
    }

    if (!TASK_TYPES.includes(taskType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task type"
      });
    }

    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority"
      });
    }

    const parsedDueDate = new Date(dueDate);

    if (Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid dueDate"
      });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organisationId }
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

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description,
        taskType,
        priority,
        dueDate: parsedDueDate,
        assignedExecutive: access.assignedExecutive || assignedExecutive,
        customerId,
        invoiceId: invoiceId || null,
        organisationId
      },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      task
    });
  } catch (error) {
    console.error("Create task error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create task"
    });
  }
};

// GET ALL TASKS
export const getTasks = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { status, priority, customerId } = req.query;

    const where = {};

    if (status) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status filter"
        });
      }
      where.status = status;
    }

    if (priority) {
      if (!PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: "Invalid priority filter"
        });
      }
      where.priority = priority;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    const tasks = await prisma.task.findMany({
      where: buildTaskDataWhere(access, where),
      include: {
        customer: true,
        invoice: true,
        histories: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { dueDate: "asc" }
    });

    return res.status(200).json({
      success: true,
      count: tasks.length,
      tasks
    });
  } catch (error) {
    console.error("Get tasks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tasks"
    });
  }
};

// GET ONE TASK
export const getTaskById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const task = await prisma.task.findFirst({
      where: buildTaskDataWhere(access, { id: req.params.id }),
      include: {
        customer: true,
        invoice: true,
        histories: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    return res.status(200).json({
      success: true,
      task
    });
  } catch (error) {
    console.error("Get task error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch task"
    });
  }
};

// UPDATE TASK DETAILS
export const updateTask = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const taskId = req.params.id;
    if (
      access.assignedExecutive &&
      req.body.assignedExecutive !== undefined &&
      req.body.assignedExecutive !== access.assignedExecutive
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot reassign a task to another executive"
      });
    }

    const existingTask = await prisma.task.findFirst({
      where: buildTaskDataWhere(access, { id: taskId })
    });

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const {
      title,
      description,
      taskType,
      priority,
      status,
      dueDate,
      assignedExecutive,
      notes,
      nextAction
    } = req.body;

    if (taskType !== undefined && !TASK_TYPES.includes(taskType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task type"
      });
    }

    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority"
      });
    }

    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status"
      });
    }

    let parsedDueDate;

    if (dueDate !== undefined) {
      parsedDueDate = new Date(dueDate);

      if (Number.isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid dueDate"
        });
      }
    }

    const data = {};

    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (taskType !== undefined) data.taskType = taskType;
    if (priority !== undefined) data.priority = priority;
    if (status !== undefined) data.status = status;
    if (dueDate !== undefined) data.dueDate = parsedDueDate;
    if (assignedExecutive !== undefined) data.assignedExecutive = assignedExecutive;
    if (notes !== undefined) data.notes = notes;
    if (nextAction !== undefined) data.nextAction = nextAction;

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task: updatedTask
    });
  } catch (error) {
    console.error("Update task error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update task"
    });
  }
};

// RECORD FOLLOW-UP OUTCOME AND HISTORY
export const recordTaskOutcome = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;
    const taskId = req.params.id;

    const { outcome, notes, nextAction } = req.body;

    if (!outcome || !OUTCOMES.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: "A valid outcome is required",
        allowedOutcomes: OUTCOMES
      });
    }

    const task = await prisma.task.findFirst({
      where: buildTaskDataWhere(access, { id: taskId })
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const history = await tx.taskHistory.create({
        data: {
          taskId,
          organisationId,
          outcome,
          notes,
          nextAction
        }
      });

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          outcome,
          notes,
          nextAction,
          status: outcome === "RESCHEDULED" ? "PENDING" : "COMPLETED"
        },
        include: {
          customer: true,
          invoice: true
        }
      });

      return { history, task: updatedTask };
    });

    return res.status(200).json({
      success: true,
      message: "Follow-up outcome recorded successfully",
      ...result
    });
  } catch (error) {
    console.error("Record task outcome error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to record task outcome"
    });
  }
};
