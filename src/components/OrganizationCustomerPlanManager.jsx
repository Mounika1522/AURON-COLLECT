import React, { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../services/api";

const cycleFields = [
  ["MONTHLY", "Monthly", "proposedMonthlyPrice"],
  ["QUARTERLY", "Quarterly", "proposedQuarterlyPrice"],
  ["HALF_YEARLY", "Half-yearly", "proposedHalfYearlyPrice"],
  ["YEARLY", "Yearly", "proposedYearlyPrice"]
];

const emptyDraft = () => ({
  code: "",
  name: "",
  description: "",
  currency: "INR",
  proposedMonthlyPrice: "",
  proposedQuarterlyPrice: "",
  proposedHalfYearlyPrice: "",
  proposedYearlyPrice: "",
  proposedTaxTerms: "",
  featuresText: "",
  usageLimitsText: "",
  eligibleCustomerTypes: [],
  isActive: false
});

const draftFromPlan = (plan) => ({
  code: plan.code,
  name: plan.name,
  description: plan.description || "",
  currency: plan.currency,
  proposedMonthlyPrice: plan.proposedMonthlyPrice ?? "",
  proposedQuarterlyPrice: plan.proposedQuarterlyPrice ?? "",
  proposedHalfYearlyPrice: plan.proposedHalfYearlyPrice ?? "",
  proposedYearlyPrice: plan.proposedYearlyPrice ?? "",
  proposedTaxTerms: plan.proposedTaxTerms || "",
  featuresText: (plan.features || []).join("\n"),
  usageLimitsText: Object.entries(plan.usageLimits || {})
    .map(([key, value]) => `${key}=${value == null ? "unlimited" : value}`)
    .join("\n"),
  eligibleCustomerTypes: plan.eligibleCustomerTypes || [],
  isActive: plan.isActive
});

const readPlanTerms = (draft) => {
  const usageLimits = {};
  for (const rawLine of draft.usageLimitsText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("Enter usage limits as one name=value pair per line.");
    }
    const name = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!name || !rawValue || Object.hasOwn(usageLimits, name)) {
      throw new Error("Usage limit names and values must be present and unique.");
    }
    if (rawValue.toLowerCase() === "unlimited") {
      usageLimits[name] = null;
    } else if (/^\d+$/.test(rawValue) && Number.isSafeInteger(Number(rawValue))) {
      usageLimits[name] = Number(rawValue);
    } else {
      throw new Error("Usage limit values must be non-negative integers or 'unlimited'.");
    }
  }
  return {
    features: draft.featuresText.split("\n").map((feature) => feature.trim()).filter(Boolean),
    usageLimits
  };
};

const statusClass = (status) => status === "APPROVED"
  ? "bg-emerald-500/10 text-emerald-600"
  : "bg-amber-500/10 text-amber-600";

const displayPrice = (value, currency) => {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
};

export default function OrganizationCustomerPlanManager({
  token,
  role,
  active,
  bgCard,
  bgSurface,
  textMuted
}) {
  const [plans, setPlans] = useState([]);
  const [customerTypes, setCustomerTypes] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newDraft, setNewDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [savingPlanId, setSavingPlanId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = role === "OWNER";

  const request = useCallback((endpoint, options = {}) =>
    apiRequest(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    }), [token]);

  const loadPlans = useCallback(async () => {
    if (!active || !token) return;
    setLoading(true);
    setError("");
    try {
      const response = await request("/api/customer-subscription-plans");
      setPlans(response.plans || []);
      setCustomerTypes(response.customerTypes || []);
      setDrafts(Object.fromEntries((response.plans || []).map((plan) => [
        plan.id,
        draftFromPlan(plan)
      ])));
    } catch (requestError) {
      setError(requestError.message || "Unable to load organization customer plans.");
    } finally {
      setLoading(false);
    }
  }, [active, request, token]);

  useEffect(() => {
    if (!active || !token) return undefined;
    let mounted = true;
    request("/api/customer-subscription-plans")
      .then((response) => {
        if (!mounted) return;
        setPlans(response.plans || []);
        setCustomerTypes(response.customerTypes || []);
        setDrafts(Object.fromEntries((response.plans || []).map((plan) => [
          plan.id,
          draftFromPlan(plan)
        ])));
        setError("");
      })
      .catch((requestError) => {
        if (mounted) setError(requestError.message || "Unable to load organization customer plans.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [active, request, token]);

  const toggleEligibility = (draft, setDraft, customerType) => {
    const selected = draft.eligibleCustomerTypes.includes(customerType);
    setDraft({
      ...draft,
      eligibleCustomerTypes: selected
        ? draft.eligibleCustomerTypes.filter((type) => type !== customerType)
        : [...draft.eligibleCustomerTypes, customerType]
    });
  };

  const payloadFromDraft = (draft, includeCode) => {
    const { features, usageLimits } = readPlanTerms(draft);
    return {
      ...(includeCode ? { code: draft.code.trim() } : {}),
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      currency: draft.currency.trim().toUpperCase(),
      ...Object.fromEntries(cycleFields.map(([, , field]) => [
        field,
        draft[field] === "" ? null : draft[field]
      ])),
      proposedTaxTerms: draft.proposedTaxTerms.trim() || null,
      features,
      usageLimits,
      eligibleCustomerTypes: draft.eligibleCustomerTypes,
      isActive: draft.isActive
    };
  };

  const savePlan = async (planId, draft, includeCode = false) => {
    setSavingPlanId(planId || "new");
    setError("");
    setNotice("");
    try {
      const payload = payloadFromDraft(draft, includeCode);
      if (includeCode) {
        await request("/api/customer-subscription-plans", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setNewDraft(emptyDraft());
        setNotice("Plan created. Pricing and tax terms require separate owner approval.");
      } else {
        await request(`/api/customer-subscription-plans/${encodeURIComponent(planId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setNotice("Plan changes saved. Any changed pricing or tax terms are pending separate approval.");
      }
      await loadPlans();
    } catch (requestError) {
      setError(requestError.message || "Unable to save this customer plan.");
    } finally {
      setSavingPlanId("");
    }
  };

  const approve = async (plan, category) => {
    setSavingPlanId(plan.id);
    setError("");
    setNotice("");
    try {
      await request(
        `/api/customer-subscription-plans/${encodeURIComponent(plan.id)}/approvals/${category}`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setNotice(category === "pricing"
        ? "Pricing proposal approved."
        : "Tax terms approved.");
      await loadPlans();
    } catch (requestError) {
      setError(requestError.message || "Unable to approve this proposal.");
    } finally {
      setSavingPlanId("");
    }
  };

  const renderPlanFields = (draft, setDraft, plan = null) => (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!plan && (
          <label className={`text-xs ${textMuted}`}>
            Plan code
            <input
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
              placeholder="unique-plan-code"
              className={`mt-1 block min-h-10 w-full rounded-lg border p-2 text-sm ${bgSurface}`}
            />
          </label>
        )}
        <label className={`text-xs ${textMuted}`}>
          Plan name
          <input
            required
            maxLength={100}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className={`mt-1 block min-h-10 w-full rounded-lg border p-2 text-sm ${bgSurface}`}
          />
        </label>
        <label className={`text-xs ${textMuted}`}>
          Currency
          <input
            required
            maxLength={3}
            pattern="[A-Z]{3}"
            value={draft.currency}
            onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })}
            className={`mt-1 block min-h-10 w-full rounded-lg border p-2 text-sm ${bgSurface}`}
          />
        </label>
      </div>
      <label className={`block text-xs ${textMuted}`}>
        Description
        <textarea
          maxLength={1000}
          rows={2}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          className={`mt-1 block w-full rounded-lg border p-2 text-sm ${bgSurface}`}
        />
      </label>
      <div>
        <p className={`mb-2 text-xs font-semibold ${textMuted}`}>Proposed pricing by billing cycle</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cycleFields.map(([, label, field]) => (
            <label key={field} className={`text-xs ${textMuted}`}>
              {label}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={draft[field]}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                className={`mt-1 block min-h-10 w-full rounded-lg border p-2 text-sm ${bgSurface}`}
              />
            </label>
          ))}
        </div>
      </div>
      <label className={`block text-xs ${textMuted}`}>
        Proposed GST / tax terms
        <textarea
          maxLength={2000}
          rows={2}
          value={draft.proposedTaxTerms}
          onChange={(event) => setDraft({ ...draft, proposedTaxTerms: event.target.value })}
          className={`mt-1 block w-full rounded-lg border p-2 text-sm ${bgSurface}`}
        />
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className={`text-xs ${textMuted}`}>
          Features (one per line)
          <textarea
            rows={4}
            value={draft.featuresText}
            onChange={(event) => setDraft({ ...draft, featuresText: event.target.value })}
            className={`mt-1 block w-full rounded-lg border p-2 text-sm ${bgSurface}`}
          />
        </label>
        <label className={`text-xs ${textMuted}`}>
          Usage terms (one limit per line, e.g. seats=10; use unlimited when applicable)
          <textarea
            rows={4}
            value={draft.usageLimitsText}
            onChange={(event) => setDraft({ ...draft, usageLimitsText: event.target.value })}
            className={`mt-1 block w-full rounded-lg border p-2 text-sm ${bgSurface}`}
          />
        </label>
      </div>
      <fieldset>
        <legend className={`mb-2 text-xs font-semibold ${textMuted}`}>
          Eligible active customer types
        </legend>
        <div className="flex flex-wrap gap-3">
          {[...new Set([...customerTypes, ...draft.eligibleCustomerTypes])].map((customerType) => (
            <label key={customerType} className="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs">
              <input
                type="checkbox"
                checked={draft.eligibleCustomerTypes.includes(customerType)}
                onChange={() => toggleEligibility(draft, setDraft, customerType)}
              />
              {customerType}
            </label>
          ))}
          {!customerTypes.length && (
            <p className={`text-xs ${textMuted}`}>No active customer types were found; leaving this empty allows all active types.</p>
          )}
        </div>
        <p className={`mt-1 text-[10px] ${textMuted}`}>
          Leaving every type unchecked makes the plan available to all active customers in this organization.
        </p>
      </fieldset>
      {plan && (
        <label className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
          />
          Active and offered for eligible customers
        </label>
      )}
    </div>
  );

  if (!active || !["ADMIN", "OWNER"].includes(role)) return null;

  return (
    <section className={`space-y-5 rounded-2xl border p-4 sm:p-6 ${bgCard}`}>
      <div>
        <h3 className="text-lg font-bold">Organization Customer Plans</h3>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Configure plans for your own customers. Pricing and tax terms are reviewed separately by an organization owner; features and limits are descriptive terms. Pending pricing or tax changes temporarily hide an active plan until re-approved.
        </p>
      </div>
      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border p-3 text-xs ${
            error
              ? "border-rose-500/30 bg-rose-500/10 text-rose-600"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          }`}
        >
          {error || notice}
        </div>
      )}

      <div className={`rounded-xl border p-4 ${bgSurface}`}>
        <h4 className="mb-4 text-sm font-bold">Create customer plan</h4>
        {renderPlanFields(newDraft, setNewDraft)}
        <button
          type="button"
          disabled={savingPlanId === "new"}
          onClick={() => savePlan(null, newDraft, true)}
          className="mt-4 min-h-10 rounded-lg bg-[#E50914] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {savingPlanId === "new" ? "Creating…" : "Create plan"}
        </button>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-bold">Managed plans</h4>
        {loading ? (
          <p role="status" className={`text-xs ${textMuted}`}>Loading organization plans…</p>
        ) : plans.length === 0 ? (
          <p className={`rounded-xl border p-4 text-xs ${textMuted}`}>No organization customer plans yet.</p>
        ) : plans.map((plan) => {
          const draft = drafts[plan.id] || draftFromPlan(plan);
          const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(draftFromPlan(plan));
          const setDraft = (next) => setDrafts((existing) => ({
            ...existing,
            [plan.id]: next
          }));
          return (
            <article key={plan.id} className={`space-y-4 rounded-xl border p-4 ${bgSurface}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="font-bold">{plan.name}</h5>
                  <p className={`mt-1 text-[10px] ${textMuted}`}>Code: {plan.code} · {plan.isActive ? "Active" : "Inactive"}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
                  <span className={`rounded-full px-2 py-1 ${statusClass(plan.pricingProposalStatus)}`}>
                    Pricing: {plan.pricingProposalStatus}
                  </span>
                  <span className={`rounded-full px-2 py-1 ${statusClass(plan.taxProposalStatus)}`}>
                    Tax: {plan.taxProposalStatus}
                  </span>
                </div>
              </div>
              <div className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-2 ${bgCard}`}>
                <div>
                  <p className={`text-[10px] font-semibold uppercase ${textMuted}`}>Approved prices</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {[
                      ["Monthly", plan.monthlyPrice],
                      ["Quarterly", plan.quarterlyPrice],
                      ["Half-yearly", plan.halfYearlyPrice],
                      ["Yearly", plan.yearlyPrice]
                    ].map(([label, price]) => (
                      <span key={label}>{label}: {displayPrice(price, plan.currency)}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={`text-[10px] font-semibold uppercase ${textMuted}`}>Approved tax terms</p>
                  <p className={`mt-2 text-[11px] ${textMuted}`}>{plan.taxTerms || "Not approved"}</p>
                </div>
              </div>
              {renderPlanFields(draft, setDraft, plan)}
              <div className="flex flex-wrap gap-2 border-t border-gray-500/20 pt-4">
                <button
                  type="button"
                  disabled={savingPlanId === plan.id}
                  onClick={() => savePlan(plan.id, draft)}
                  className="min-h-10 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {savingPlanId === plan.id ? "Saving…" : "Save changes"}
                </button>
                {isOwner && plan.pricingProposalStatus === "PENDING_APPROVAL" && (
                  <button
                    type="button"
                    disabled={savingPlanId === plan.id || hasUnsavedChanges}
                    title={hasUnsavedChanges ? "Save changes before approving." : undefined}
                    onClick={() => approve(plan, "pricing")}
                    className="min-h-10 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Approve pricing
                  </button>
                )}
                {isOwner && plan.taxProposalStatus === "PENDING_APPROVAL" && (
                  <button
                    type="button"
                    disabled={savingPlanId === plan.id || hasUnsavedChanges}
                    title={hasUnsavedChanges ? "Save changes before approving." : undefined}
                    onClick={() => approve(plan, "tax")}
                    className="min-h-10 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Approve tax terms
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
