
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Token required."
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId || !decoded.organisationId) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token"
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        organisationId: decoded.organisationId
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        organisationId: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account not found or access revoked"
      });
    }

    req.user = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organisationId: user.organisationId
    };

    next();

  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token"
      });
    }

    console.error("Authentication error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication failed"
    });
  }
};

export default authMiddleware;
