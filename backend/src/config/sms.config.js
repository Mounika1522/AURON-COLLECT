const smsConfig = {
  enabled: process.env.SMS_ENABLED === "true",
  provider: process.env.SMS_PROVIDER || "mock"
};

export default smsConfig;