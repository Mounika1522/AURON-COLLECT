import { assertNotificationDeliveryEnabled } from "../../config/runtime-safety.js";

export const sendSMS = async () => {
  assertNotificationDeliveryEnabled();

  const error = new Error("SMS delivery is not supported; use email notifications.");
  error.code = "UNSUPPORTED_NOTIFICATION_CHANNEL";
  throw error;
};
