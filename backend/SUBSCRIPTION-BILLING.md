# Subscription billing

## Built-in organization plans

The Starter, Growth, and Business organization plans have fixed monthly prices
of INR 999, INR 2,499, and INR 5,999. Their catalog prices are defined by the
backend and do not require a platform administrator to create or approve them.
The existing seeded `SubscriptionPlan` rows provide the foreign-key records
used by billing payments; their approval flags and proposed prices do not
override the built-in terms. No database rows are changed to publish these
prices.

Enterprise is custom-priced and cannot be purchased through normal checkout.
Annual prices, usage limits, and GST terms are not inferred. Limits remain
unconfigured until explicitly approved; the built-in monthly checkout does not
require limit approval. Other non-built-in platform plans continue to require
approved prices and limits.

## Razorpay configuration

Organization billing accepts either Test or Live mode when the backend
environment contains a matching mode, key ID prefix, and key secret:

```text
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<test secret>
```

For Live mode, use `RAZORPAY_MODE=live` and a matching `rzp_live_...` key ID.
The API exposes only whether the configuration is valid and its mode, never
the secret. If the mode or key pair is absent or mismatched, organization
checkout remains disabled. Webhook signature verification additionally
requires `RAZORPAY_WEBHOOK_SECRET`.

Customer subscription checkout remains Test Mode only and requires:

```text
CUSTOMER_RAZORPAY_MODE=test
CUSTOMER_RAZORPAY_KEY_ID=rzp_test_...
CUSTOMER_RAZORPAY_KEY_SECRET=<test secret>
CUSTOMER_RAZORPAY_WEBHOOK_SECRET=<test webhook secret>
```

## Customer Portal organization-plan checkout

The authenticated customer portal account maps to one `Customer`, whose
`organisationId` scopes organization billing. The portal checkout API derives
both IDs from that authenticated session; it does not accept a customer-
supplied organization ID or price. Only the official Starter, Growth, and
Business monthly plans are purchasable. Enterprise remains Contact Sales, and
no annual price is offered.

This organization-plan checkout uses the organization billing Razorpay
variables above, but accepts Test Mode only. The separate customer-facing
subscription-plan checkout continues to use the `CUSTOMER_RAZORPAY_*` variables.
Subscription and invoice records are created only after the backend verifies
the Razorpay signature and confirms a captured payment. Checkout requests and
payment records use idempotency and tenant scoping to prevent duplicate or
cross-organization processing.

Keep every Razorpay value in backend environment variables; never add secrets
to frontend configuration. Configure the organization webhook to call
`/api/subscriptions/razorpay/webhook` with the `payment.captured` event, and
the customer Test Mode webhook to call
`/api/customer-portal/subscriptions/razorpay/webhook` for customer billing with
`payment.captured` and `payment.failed`. Do not use Live credentials in
development or verification, or initiate real payments without production
authorization.

The Customer Portal assistant uses customer-scoped account records and does not
send billing data or chat prompts to an external AI provider. Its answers do
not authorize or initiate payments.

## Organization customer subscription plans

Organization `ADMIN` and `OWNER` users manage customer-facing plans through
`/api/customer-subscription-plans`. The authenticated user's organization is
the only tenant scope; organization identifiers supplied by clients are
ignored. A plan's prices and tax terms have independent proposal and approval
states. Only an organization `OWNER` can approve each proposal, and a plan
must have an approved price and approved tax terms before it can be activated.
Changing proposed prices or tax terms returns only that proposal category to
pending approval.

Plans may offer monthly, quarterly, half-yearly, and yearly pricing. An empty
eligible-customer-type list means all active customers in the organization;
otherwise a customer sees or purchases a plan only when their own active
customer type is listed. Features and usage limits are descriptive plan terms,
not application-enforced product quotas. Customer checkout continues to use
the existing Razorpay Test Mode flow and verifies the plan, cycle, tenant,
customer eligibility, amount, and payment on the backend.

Apply the organization customer-plan migration only to a verified development
database during development. Never apply it to `auron_collect_app`.

Set `COMPANY_BILLING_ADDRESS`, `COMPANY_GSTIN`, and `COMPANY_SUPPORT_EMAIL` in the backend
environment to include the verified company billing address and support contact
in downloadable documents. The legal company name and official logo are taken
from the application branding assets.

## Official customer subscription receipts

Provider-confirmed captured subscription payments produce one immutable receipt
and a private PDF stored with its receipt record. Checkout verification and
webhook processing share the same unique payment/receipt record; failed,
pending, mismatched, and duplicate payments do not issue another receipt.
Customers and organisation admins download PDFs through authenticated,
tenant-scoped endpoints. The QR code verifies receipt number, amount, and paid
status without exposing customer details.

These receipts cover subscription payments only. Loan account numbers, loan
principal, and loan outstanding balances are marked not applicable because this
project has no loan-account ledger. The next subscription renewal date is shown
instead of a loan due date.

Receipt email attempts are recorded and deduplicated. In production, customer
transactional email delivery and the reminder scheduler start automatically
when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` are
configured. No additional customer-email authorization flag is required.
Development and test runtimes do not send transactional customer email; tests
must use a stream/test transport. Configure `PUBLIC_API_URL` to the canonical
API origin so receipt verification QR codes resolve to the deployed service.

## Gmail SMTP configuration

For Gmail, set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=587`. Set
`SMTP_USER` to the sending Gmail address and `EMAIL_FROM` to that address,
optionally with the company display name. The transport requires STARTTLS and
TLS 1.2 or newer.

Create a Google App Password after enabling 2-Step Verification. Store it only
as `SMTP_PASS` in an ignored local env file for development or in the deployment
secret store for production. The development launcher loads `.env.local`; if
SMTP keys are absent there, the email service imports only the five SMTP keys
from `.env` and never imports its `DATABASE_URL` or other settings. Never use a
normal Gmail password, commit the App Password, or paste it into chat. Restart
the backend after changing the environment.

Automated email tests use Nodemailer's stream transport and do not send
messages externally. The application does not expose a runtime test-email
endpoint; test recipients belong only in automated test fixtures.

Automatic invoice reminders use the existing three stages: three days before
the due date, on the due date, and one day overdue. Each stage is scheduled for
9:00 AM in the customer's selected IANA time zone (default `Asia/Kolkata`).
Only the verified customer-portal email address is used. SMTP rejections with
an explicit temporary response are retried with bounded delays; ambiguous
submission outcomes are not resent automatically to avoid duplicate email.

## Database and billing behavior

Before deploying the billing migration, verify that `DATABASE_URL` targets
`auron_collect_app_dev`. Non-production Prisma CLI commands load
`backend/.env.local` and run the development database safety check; never point
a migration at the preserved `auron_collect_app` database.
Renewals are manual. A paid plan change starts at the current renewal date,
without proration. Billing PDFs show the charged amount without an inferred tax
calculation. No automatic payment mandates are created.
