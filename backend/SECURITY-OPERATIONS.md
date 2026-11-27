# Authentication rate limiting

The staff login and organization-registration routes share an in-memory limit
of 10 requests per IP address per 15-minute window. This is appropriate for
local development and a single backend process; counters reset when the process
restarts and are not shared between instances.

Before running multiple production instances, configure a shared,
failure-monitored rate-limit store for every instance. Do not add a store
dependency until the production deployment topology requires it.

When the API is behind a reverse proxy or load balancer, configure Express
`trust proxy` for the exact trusted proxy hops or addresses used by that
deployment. The proxy must replace or sanitize forwarded-client-IP headers.
Do not set `trust proxy` to `true` without verifying the proxy boundary: an
overly broad setting can allow clients to spoof their rate-limit IP, while no
trusted proxy configuration can make all users appear to share the proxy IP.

Keep the current process-local limiter for development. Validate the shared
store and trusted-proxy settings in the deployment environment before relying
on the limiter as a production abuse-control boundary.

## Staff password changes

Authenticated staff can change only their own password through
`POST /api/auth/change-password`. The endpoint verifies the current bcrypt
hash, requires a new password of at least 12 characters with at least three
character types, and enforces bcrypt's 72-byte input limit. It increments the
user's session version and returns a replacement token; tokens from the user's
other sessions are rejected afterward. Apply the
`20261130120000_staff_session_version` migration before deploying this backend
change.

## Reminder history deletion

`DELETE /api/reminders/:id` is restricted to organization `ADMIN` and `OWNER`
accounts. It deletes only an email reminder in `PENDING`, `CANCELLED`, or
`FAILED` status; sent or SMTP-accepted reminders remain available for audit
history, and a reminder claimed by the scheduler cannot be deleted. The status
condition is part of the database delete operation so a concurrent scheduler
claim wins instead of allowing deletion during processing. Related customer,
invoice, payment, and receipt records are not deleted.

## Manual reminder email delivery

`GET /api/reminders/:id/preview` and
`POST /api/reminders/:id/send-now` are restricted to organization `ADMIN` and
`OWNER` accounts. The preview resolves the customer's currently verified
portal email and uses the same content builder as delivery. Manual delivery
uses the scheduler's atomic `PENDING` to `PROCESSING` claim and tracked,
idempotent email-delivery attempt, so it remains safe to invoke while the
background scheduler is running. SMTP delivery continues to obey the existing
runtime safety and configuration gates.

An email attempt or reminder delivery status of `DISABLED` means the email
runtime gate rejected delivery; it does not mean the background scheduler was
turned off or that the reminder was cancelled. Disabling background schedulers
leaves due reminders pending and does not change their delivery status. Manual
sending bypasses scheduler polling, not the email runtime gate.

For local development only, set `ENABLE_DEV_EMAIL_DELIVERY=true` in the
backend's `.env.local` to permit user-requested SMTP delivery, including
staff password reset and the confirmed ADMIN/OWNER manual reminder-send route.
For registration/resend verification OTP only, use the separate
`ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL=true` opt-in. Both settings require
valid SMTP configuration; neither enables automatic reminder processing, which
requires the separate scheduler opt-in. Keep the settings `false` by default,
and never copy them into production configuration.

For isolated scheduler testing only, set
`ENABLE_DEV_REMINDER_SCHEDULER=true` in `.env.local`. This is a separate
development-only opt-in: it starts only the email reminder scheduler, leaves
all other background schedulers disabled when
`DISABLE_BACKGROUND_SCHEDULERS=true`, and permits automatic delivery only for
reminder emails. Valid SMTP configuration is required. At startup, reminders
already overdue remain pending and are counted in the backend log; review and
send them individually through the ADMIN/OWNER-confirmed Send Now flow.
Automatic reminders scheduled after scheduler startup are evaluated each
minute against their stored UTC instant, which was derived from the customer's
local time zone. Leave the setting unset or `false` by default and never copy
it into production configuration.
