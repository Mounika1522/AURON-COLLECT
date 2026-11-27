import { assertNotificationDeliveryEnabled } from "../../config/runtime-safety.js";

export const sendWhatsApp = async () => {
  assertNotificationDeliveryEnabled();

  const error = new Error("WhatsApp delivery is not supported; use email notifications.");
  error.code = "UNSUPPORTED_NOTIFICATION_CHANNEL";
  throw error;
};