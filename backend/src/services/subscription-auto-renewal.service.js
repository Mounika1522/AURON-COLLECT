export const MAX_RENEWAL_ATTEMPTS = 3;
export const RENEWAL_RETRY_DELAY_DAYS = 3;
export const TOKEN_EXPIRY_TIMESTAMP = 4102444799;

export const atAsiaKolkataRenewalTime = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    2
  ) - 330 * 60 * 1000);
};

export const buildTokenizedCheckoutOptions = ({
  amount,
  currency,
  customerId,
  receipt,
  notes = {}
}) => ({
  amount,
  currency,
  customer_id: customerId,
  method: "card",
  token: {
    max_amount: amount,
    expire_at: TOKEN_EXPIRY_TIMESTAMP,
    frequency: "as_presented"
  },
  receipt,
  notes
});

export const buildRecurringPaymentRequest = ({
  amount,
  currency,
  orderId,
  customerId,
  tokenId,
  email,
  contact,
  description,
  notes = {}
}) => ({
  amount,
  currency,
  order_id: orderId,
  customer_id: customerId,
  token: tokenId,
  recurring: true,
  email,
  contact,
  description,
  notes
});

export const getRenewalFailureState = (attempts, now = new Date()) => {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("Renewal attempts must be a positive integer.");
  }
  if (attempts >= MAX_RENEWAL_ATTEMPTS) {
    return {
      autoRenew: false,
      autoRenewRequested: false,
      lastRenewalStatus: "PAST_DUE",
      nextRenewalDate: null,
      renewalAttempts: attempts,
      subscriptionStatus: "PAST_DUE"
    };
  }

  const retryDate = new Date(now);
  retryDate.setUTCDate(retryDate.getUTCDate() + RENEWAL_RETRY_DELAY_DAYS);
  const nextRenewalDate = atAsiaKolkataRenewalTime(retryDate);
  return {
    lastRenewalStatus: "FAILED",
    nextRenewalDate,
    renewalAttempts: attempts
  };
};

export const isRenewalDue = (subscription, now = new Date()) =>
  subscription.autoRenew === true &&
  subscription.status === "ACTIVE" &&
  subscription.nextRenewalDate instanceof Date &&
  subscription.nextRenewalDate <= now &&
  Boolean(subscription.razorpayCustomerId && subscription.razorpayTokenId);
