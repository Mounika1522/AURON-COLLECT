import express from "express";

import {
  createCommunication,
  getCommunications,
  getCommunicationById
} from "../controllers/communication.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createCommunication);
router.get("/", getCommunications);
router.get("/:id", getCommunicationById);

export default router;