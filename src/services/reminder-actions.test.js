import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCancelReminder,
  canDeleteReminder,
  canSendReminderNow,
} from './reminder-actions.js';

test('pending reminders can be cancelled and deleted by organization admins and owners', () => {
  const reminder = { status: 'Pending' };

  assert.equal(canCancelReminder(reminder), true);
  assert.equal(canDeleteReminder(reminder, 'ADMIN'), true);
  assert.equal(canDeleteReminder(reminder, 'OWNER'), true);
  assert.equal(canDeleteReminder(reminder, 'USER'), false);
});

test('cancelled and failed reminders can be deleted but sent or processing reminders cannot', () => {
  for (const status of ['Cancelled', 'Failed']) {
    assert.equal(canCancelReminder({ status }), false);
    assert.equal(canDeleteReminder({ status }, 'OWNER'), true);
  }

  for (const status of ['Sent', 'Processing']) {
    assert.equal(canDeleteReminder({ status }, 'OWNER'), false);
  }

  assert.equal(
    canDeleteReminder({ status: 'Failed', deliveryStatus: 'Smtp Accepted' }, 'OWNER'),
    false,
  );
});

test('only admins and owners can send pending reminders now', () => {
  const pending = { status: 'Pending', deliveryStatus: 'Pending' };
  assert.equal(canSendReminderNow(pending, 'ADMIN'), true);
  assert.equal(canSendReminderNow(pending, 'OWNER'), true);
  assert.equal(canSendReminderNow(pending, 'USER'), false);

  for (const status of ['Sent', 'Cancelled', 'Processing']) {
    assert.equal(
      canSendReminderNow({ status, deliveryStatus: status }, 'OWNER'),
      false,
    );
  }

  assert.equal(canSendReminderNow({
    status: 'Failed',
    deliveryStatus: 'Disabled',
    lastError: 'DELIVERY_DISABLED',
  }, 'ADMIN'), true);
  assert.equal(canSendReminderNow({
    status: 'Failed',
    deliveryStatus: 'Disabled',
    lastError: 'SMTP_SEND_FAILED',
  }, 'OWNER'), false);
});

test('reminders with active or accepted email delivery cannot be manually sent', () => {
  assert.equal(
    canSendReminderNow({ status: 'Pending', deliveryStatus: 'Processing' }, 'ADMIN'),
    false,
  );
  assert.equal(
    canSendReminderNow({ status: 'Pending', deliveryStatus: 'SMTP Accepted' }, 'ADMIN'),
    false,
  );
});
