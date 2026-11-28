import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  canAccessOrganizationBillingPortal,
  canViewOrganizationBillingPlans,
  canCheckoutOfficialPlan,
  getOfficialPlanChangeAction,
  getApprovedSubscriptionBillingCycles,
  getOfficialMonthlyPriceLabel,
  OFFICIAL_SAAS_PLANS,
} from '../services/subscription-plans';

const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export default function OrganizationSubscriptionPlans({
  role,
  plans,
  billingConfiguration,
  currentSubscription,
  billingCycle,
  onBillingCycleChange,
  isProcessing,
  isLoading,
  readOnly = false,
  customerPortalAccess = false,
  onCheckout,
  onToggleAutoRenew,
  onContactSales,
  bgCard,
  bgSurface,
  textMuted,
}) {
  const [autoRenewForNextCheckout, setAutoRenewForNextCheckout] = useState(false);
  const [billingPhone, setBillingPhone] = useState('');
  const canManageBilling =
    (customerPortalAccess || canAccessOrganizationBillingPortal(role)) &&
    !readOnly;

  if (!canViewOrganizationBillingPlans({ role, customerPortalAccess, readOnly })) {
    return (
      <div className={`rounded-2xl border p-5 text-sm ${bgCard}`} role="alert">
        Organization billing access is limited to organization administrators and owners.
      </div>
    );
  }

  const backendPlans = Array.isArray(plans) ? plans : [];
  const billingCycles = getApprovedSubscriptionBillingCycles(backendPlans);
  const activeBillingCycle = billingCycles.some((cycle) => cycle.value === billingCycle)
    ? billingCycle
    : 'MONTHLY';

  return (
    <section className="space-y-6" aria-labelledby="organization-plans-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="organization-plans-title" className="text-2xl font-extrabold">
            Organization Subscription Plans
          </h1>
          <p className={`mt-2 max-w-3xl text-sm ${textMuted}`}>
            Plans for your organization’s AURON COLLECT SaaS account. These are separate from customer loan repayments and payment transactions.
          </p>
        </div>
        {billingCycles.length > 1 ? (
          <label className={`text-xs font-semibold ${textMuted}`}>
            Billing cycle
            <select
              value={activeBillingCycle}
              onChange={(event) => onBillingCycleChange(event.target.value)}
              className={`mt-1 block rounded-lg border p-2 text-sm ${bgSurface}`}
            >
              {billingCycles.map((cycle) => (
                <option key={cycle.value} value={cycle.value}>{cycle.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className={`text-xs font-semibold ${textMuted}`}>Billing cycle: Monthly</p>
        )}
      </header>

      {isLoading && (
        <p className={`text-xs ${textMuted}`} role="status">
          Loading organization subscription details…
        </p>
      )}

      {canManageBilling ? (
        <div className={`rounded-xl border border-[#E50914]/30 p-4 text-xs ${bgCard}`}>
          <span className="font-bold">Current organization plan: </span>
          {currentSubscription?.plan?.name || 'No active subscription'}
          <span className={`mt-1 block ${textMuted}`}>
            {billingConfiguration?.available
              ? `Checkout uses Razorpay ${
                  typeof billingConfiguration.mode === 'string'
                    ? billingConfiguration.mode.toUpperCase()
                    : 'configured'
                } Mode.`
              : 'Checkout requires valid Razorpay Test or Live credentials for this environment.'}
          </span>
          {currentSubscription && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className={textMuted}>
                Auto-Renew: {currentSubscription.autoRenew
                  ? 'On'
                  : currentSubscription.autoRenewRequested
                    ? 'Pending next checkout'
                    : 'Off'}
                {' · '}Next renewal: {currentSubscription.nextRenewalDate
                  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(currentSubscription.nextRenewalDate))
                  : 'Not scheduled'}
                {' · '}Payment method: {currentSubscription.paymentMethod || 'Not saved'}
              </span>
              {currentSubscription.status === 'ACTIVE' && onToggleAutoRenew && (
                <button
                  type="button"
                  aria-pressed={Boolean(currentSubscription.autoRenew || currentSubscription.autoRenewRequested)}
                  disabled={isProcessing}
                  onClick={() => onToggleAutoRenew(
                    currentSubscription,
                    !(currentSubscription.autoRenew || currentSubscription.autoRenewRequested)
                  )}
                  className={`rounded-lg border px-3 py-2 font-semibold disabled:opacity-50 ${bgSurface}`}
                >
                  Auto-Renew {currentSubscription.autoRenew || currentSubscription.autoRenewRequested ? 'ON' : 'OFF'}
                </button>
              )}
            </div>
          )}
          {currentSubscription?.status !== 'ACTIVE' && (
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={autoRenewForNextCheckout}
                onChange={(event) => setAutoRenewForNextCheckout(event.target.checked)}
                disabled={isProcessing}
                className="mt-0.5 accent-[#E50914]"
              />
              <span>Enable auto-renew after this regular checkout.</span>
            </label>
          )}
          {(autoRenewForNextCheckout ||
            (currentSubscription?.autoRenewRequested && !currentSubscription?.autoRenew)) &&
            !customerPortalAccess && (
              <label className="mt-3 block max-w-sm">
                <span className={`text-[10px] ${textMuted}`}>Billing phone for Razorpay</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={billingPhone}
                  onChange={(event) => setBillingPhone(event.target.value)}
                  className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm ${bgSurface}`}
                />
              </label>
            )}
        </div>
      ) : (
        <div className={`rounded-xl border border-gray-500/20 p-4 text-xs ${bgCard} ${textMuted}`}>
          These are AURON COLLECT organization SaaS plans, separate from customer loan and payment subscriptions. Only organization admins and owners can manage billing in the staff portal.
        </div>
      )}

      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {OFFICIAL_SAAS_PLANS.map((plan) => {
          const backendPlan = backendPlans.find((candidate) => candidate?.code === plan.code);
          const limitsApproved = backendPlan?.limitsStatus === 'APPROVED';
          const hasApprovedAnnualPrice = canCheckoutOfficialPlan(
            plan,
            backendPlan,
            'YEARLY'
          );
          const isCheckoutAvailable =
            canManageBilling &&
            canCheckoutOfficialPlan(plan, backendPlan, activeBillingCycle) &&
            billingConfiguration?.available === true;
          const isEnterprise = plan.code === 'ENTERPRISE';
          const isCurrent = currentSubscription?.plan?.code === plan.code;
          const changeAction = getOfficialPlanChangeAction(
            plan.code,
            currentSubscription?.plan?.code
          );
          const monthlyPrice = getOfficialMonthlyPriceLabel(plan);
          const limitText = (value, label) => {
            if (!limitsApproved) return 'Not configured/approved';
            if (value == null) return `Unlimited ${label}`;
            const numericLimit = Number(value);
            return Number.isFinite(numericLimit) && numericLimit >= 0
              ? `${numericLimit.toLocaleString('en-IN')} ${label}`
              : 'Not configured/approved';
          };
          const hasApprovedGstTerms =
            backendPlan?.gstTermsStatus === 'APPROVED' &&
            typeof backendPlan?.gstTerms === 'string' &&
            backendPlan.gstTerms.trim().length > 0;

          return (
            <article
              key={plan.code}
              className={`portal-interactive-card flex h-full min-w-0 flex-col rounded-2xl border p-5 ${bgCard} ${
                isCurrent ? 'border-[#E50914] ring-1 ring-[#E50914]' : 'border-gray-500/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#E50914]">
                  {plan.name}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-500">
                    CURRENT PLAN
                  </span>
                )}
              </div>
              <h2 className="mt-4 text-xl font-extrabold">
                {isEnterprise
                  ? 'Custom pricing'
                  : `${monthlyPrice} / month`}
              </h2>
              <p className={`mt-2 text-xs ${textMuted}`}>
                Selected billing cycle: {activeBillingCycle === 'YEARLY' ? 'Annual' : 'Monthly'}
                {hasApprovedAnnualPrice
                  ? ` · Approved annual price: ${formatINR(backendPlan.yearlyPrice)}/year`
                  : ' · Annual pricing not configured'}
              </p>
              <p className={`mt-2 text-xs ${textMuted}`}>
                GST: {hasApprovedGstTerms ? backendPlan.gstTerms : 'No approved GST terms configured'}
              </p>
              <p className={`mt-4 text-xs ${textMuted}`}>
                {typeof backendPlan?.description === 'string' && backendPlan.description.trim()
                  ? backendPlan.description
                  : plan.description}
              </p>
              <ul className="mt-4 space-y-2">
                {(Array.isArray(plan.features) ? plan.features : []).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#E50914]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-gray-500/20 pt-3">
                <p className={`text-[10px] font-bold uppercase tracking-wide ${textMuted}`}>
                  Usage limits
                </p>
                <p className={`mt-2 text-xs ${textMuted}`}>
                  {limitText(backendPlan?.maxUsers, 'users')}
                </p>
                <p className={`mt-1 text-xs ${textMuted}`}>
                  {limitText(backendPlan?.maxCustomers, 'customers')}
                </p>
                <p className={`mt-1 text-xs ${textMuted}`}>
                  {limitText(backendPlan?.maxInvoicesPerMonth, 'invoices/month')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isEnterprise && canManageBilling) onContactSales?.();
                  else if (isCheckoutAvailable) onCheckout?.(backendPlan, activeBillingCycle, {
                    autoRenewRequested:
                      autoRenewForNextCheckout ||
                      Boolean(currentSubscription?.autoRenewRequested),
                    contact: billingPhone
                  });
                }}
                disabled={
                  !canManageBilling ||
                  (!isEnterprise && (isProcessing || isCurrent || !isCheckoutAvailable))
                }
                className="mt-auto w-full pt-5 disabled:opacity-50"
              >
                <span className="block rounded-xl bg-[#E50914] px-3 py-3 text-xs font-bold text-white">
                  {isEnterprise
                    ? canManageBilling
                      ? 'Contact Sales'
                      : 'Organization admins only'
                    : isCurrent
                      ? 'Current Plan'
                      : !canManageBilling
                        ? 'Organization admins only'
                      : isProcessing
                        ? 'Preparing checkout…'
                      : changeAction}
                </span>
              </button>
              {!isEnterprise && !isCurrent && !isCheckoutAvailable && (
                <p className={`mt-2 text-center text-[10px] ${textMuted}`}>
                  {!billingConfiguration?.available
                    ? 'Subscribe is unavailable because Razorpay is not configured for this environment.'
                    : !backendPlan
                      ? 'The built-in plan is missing from the backend catalog.'
                      : 'Checkout requires a matching official plan price and a valid plan record.'}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {canManageBilling && !isLoading && !backendPlans.length && (
        <p className={`text-xs ${textMuted}`} role="status">
          The backend returned no built-in plan records. The official plans remain visible, but checkout requires the predefined plan records and valid Razorpay configuration.
        </p>
      )}
    </section>
  );
}
