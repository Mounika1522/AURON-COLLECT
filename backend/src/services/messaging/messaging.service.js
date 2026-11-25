// messaging.service.js

import { sendSMS } from "./sms.service.js";
import { sendWhatsApp } from "./whatsapp.service.js";

export const sendMessage = async ({ channel, to, message }) => {
  switch (channel?.toUpperCase()) {
    case "SMS":
      return sendSMS({ to, message });

    case "WHATSAPP":
      return sendWhatsApp({ to, message });

    default:
      throw new Error(`Unsupported messaging channel: ${channel}`);
  }
};