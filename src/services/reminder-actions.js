const normalizeStatus = (status) =>
  String(status || '').trim().toUpperCase().replaceAll(' ', '_');

export const canCancelReminder = (reminder) =>
  normalizeStatus(reminder?.status) === 'PENDING';

export const canDeleteReminder = (reminder, role) =>
  ['ADMIN', 'OWNER'].includes(String(role || '').trim().toUpperCase()) &&
  normalizeStatus(reminder?.deliveryStatus) !== 'SMTP_ACCEPTED' &&
  ['PENDING', 'CANCELLED', 'FAILED'].includes(normalizeStatus(reminder?.status));

export const canSendReminderNow = (reminder, role) => {
  const status = normalizeStatus(reminder?.status);
  const deliveryStatus = normalizeStatus(reminder?.deliveryStatus);
  const eligiblePending = status === 'PENDING';
  const eligibleDisabledFailure = status === 'FAILED' &&
    deliveryStatus === 'DISABLED' &&
    normalizeStatus(reminder?.lastError) === 'DELIVERY_DISABLED';

  return ['ADMIN', 'OWNER'].includes(String(role || '').trim().toUpperCase()) &&
    (eligiblePending || eligibleDisabledFailure) &&
    !['PROCESSING', 'SMTP_ACCEPTED'].includes(deliveryStatus);
};
