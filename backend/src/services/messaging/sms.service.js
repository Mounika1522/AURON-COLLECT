import axios from "axios";
import smsConfig from "../../config/sms.config.js";
import { assertNotificationDeliveryEnabled } from "../../config/runtime-safety.js";

export const sendSMS = async ({ to, message }) => {
  assertNotificationDeliveryEnabled();

  // Mock mode
  if (!smsConfig.enabled || smsConfig.provider !== "msg91") {
    console.log("========== SMS MOCK ==========");
    console.log("To:", to);
    console.log("Message:", message);
    console.log("Status: MOCK_SENT");
    console.log("============================");

    return {
      success: true,
      channel: "SMS",
      status: "MOCK_SENT",
      delivered: false
    };
  }

  const authkey = process.env.MSG91_AUTHKEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authkey || !templateId) {
    throw new Error("MSG91 authkey or template ID missing");
  }

  const mobile = String(to).replace(/\D/g, "");

  const response = await axios.post(
    "https://control.msg91.com/api/v5/flow",
    {
      template_id: templateId,
      short_url: "0",
      recipients: [
        {
          mobiles: mobile,
          VAR1: message
        }
      ]
    },
    {
      headers: {
        accept: "application/json",
        authkey,
        "content-type": "application/json"
      }
    }
  );

  console.log("MSG91 response:", response.data);

  return {
    success: true,
    channel: "SMS",
    status: "SUBMITTED",
    delivered: false,
    providerResponse: response.data
  };
};