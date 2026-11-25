import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";

const customerAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Customer access token required."
      });
    }

    const token = authHeader.slice("Bearer ".length);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (
      decoded.tokenType !== "CUSTOMER_PORTAL" ||
      typeof decoded.accountId !== "string" ||
      typeof decoded.customerId !== "string" ||
      !Number.isInteger(decoded.sessionVersion)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid customer authentication token."
      });
    }

    const account = await prisma.customerPortalAccount.findFirst({
      where: {
        id: decoded.accountId,
        customerId: decoded.customerId,
        sessionVersion: decoded.sessionVersion,
        emailVerifiedAt: { not: null },
        customer: { status: "ACTIVE" }
      },
      select: {
        id: true,
        customerId: true,
        email: true,
        fullName: true,
        sessionVersion: true,
        customer: {
          select: {
            organisationId: true,
            type: true
          }
        }
      }
    });

    if (!account) {
      return res.status(401).json({
        success: false,
        message: "Customer access is unavailable or has been revoked."
      });
    }

    req.customer = {
      accountId: account.id,
      customerId: account.customerId,
      organisationId: account.customer.organisationId,
      customerType: account.customer.type,
      email: account.email,
      fullName: account.fullName,
      sessionVersion: account.sessionVersion
    };

    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired customer token."
      });
    }

    console.error("Customer authentication failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to authenticate customer."
    });
  }
};

export default customerAuthMiddleware;
