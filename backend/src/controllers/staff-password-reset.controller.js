import {
  requestStaffPasswordReset,
  resetStaffPassword as resetStaffPasswordService
} from "../services/staff-password-reset.service.js";

const FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, password reset instructions will be sent shortly.";
const INVALID_RESET_MESSAGE =
  "The password reset link is invalid, expired, or already used.";

export const createStaffPasswordResetHandlers = ({
  requestReset = requestStaffPasswordReset,
  resetPassword = resetStaffPasswordService,
  logger = console
} = {}) => ({
  forgot: async (req, res) => {
    try {
      await requestReset(req.body?.email);
      return res.status(202).json({
        success: true,
        message: FORGOT_PASSWORD_MESSAGE
      });
    } catch (error) {
      logger.error("Staff password reset request failed:", {
        code: error?.code || error?.name || "UNKNOWN"
      });
      return res.status(500).json({
        success: false,
        message: "Unable to process the password reset request."
      });
    }
  },
  reset: async (req, res) => {
    try {
      const result = await resetPassword(req.body || {});
      if (result.status !== "RESET") {
        return res.status(400).json({
          success: false,
          message: INVALID_RESET_MESSAGE
        });
      }
      return res.status(200).json({
        success: true,
        message: "Your password was reset. Sign in with your new password."
      });
    } catch (error) {
      logger.error("Staff password reset failed:", {
        code: error?.code || error?.name || "UNKNOWN"
      });
      return res.status(500).json({
        success: false,
        message: "Unable to reset the password. Please try again."
      });
    }
  }
});

const handlers = createStaffPasswordResetHandlers();
export const forgotStaffPassword = handlers.forgot;
export const resetStaffPassword = handlers.reset;
