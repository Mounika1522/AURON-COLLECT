import {
  DashboardAccessError,
  getDashboardDataAccess,
} from "../services/dashboard-access.service.js";

const dashboardAccessMiddleware = (req, res, next) => {
  try {
    req.dashboardAccess = getDashboardDataAccess(req.user);
    return next();
  } catch (error) {
    if (error instanceof DashboardAccessError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Dashboard access check failed:", error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to verify data access.",
    });
  }
};

export default dashboardAccessMiddleware;
