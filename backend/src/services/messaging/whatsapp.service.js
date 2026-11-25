// whatsapp.service.js

import { assertNotificationDeliveryEnabled } from "../../config/runtime-safety.js";

export const sendWhatsApp = async () => {
  assertNotificationDeliveryEnabled();

  return {
    success: false,
    channel: "WHATSAPP",
    status: "MOCK_SENT",
    delivered: false,
    message: "Mock WhatsApp recorded. No real message was sent."
  };
};