# Subscription billing

## Approval requirements

Global platform SaaS plan prices and usage limits are management proposals
until a `SUPER_ADMIN` explicitly approves each category. The product-spec
monthly amounts are seeded as proposals only; annual prices and numeric limits
are not inferred. A platform plan is not purchasable until both pricing and
limits have been approved.

## Test-only Razorpay configuration

Organisation and customer subscription checkout remain unavailable until the
backend environment contains their respective Test Mode credentials. Customer
checkout requires:

```text
CUSTOMER_RAZORPAY_MODE=test
CUSTOMER_RAZORPAY_KEY_ID=rzp_test_...
CUSTOMER_RAZORPAY_KEY_SECRET=<test secret>
CUSTOMER_RAZORPAY_WEBHOOK_SECRET=<test webhook secret>
```

Organisation billing uses the corresponding `RAZORPAY_MODE`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` variables. Keep every
Razorpay value in backend environment variables; never add secrets to frontend
configuration. Configure Razorpay Test Mode webhooks to call
`/api/subscriptions/razorpay/webhook` for organisation billing with the
`payment.captured` event, and
`/api/customer-portal/subscriptions/razorpay/webhook` for customer billing with
`payment.captured` and `payment.failed`. Live keys and live mode are rejected
for both flows. Development and verification must use Razorpay Test Mode only;
do not initiate real payments.

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

## Database and billing behavior

Before deploying the billing migration, verify that `DATABASE_URL` targets
`auron_collect_app_dev`. Never point this migration at `auron_collect_app`.
Renewals are manual. A paid plan change starts at the current renewal date,
without proration. Billing PDFs show the charged amount without an inferred tax
calculation. No automatic payment mandates are created.
