import prisma from "../src/config/prisma.js";

const plans = [
  {
    name: "Starter",
    code: "STARTER",
    description: "Customer management, basic invoice tracking, manual receipts, basic ageing and dashboard.",
    proposedMonthlyPrice: "999.00",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    pricingStatus: "PENDING_APPROVAL",
    pricingProposalStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    limitsProposalStatus: "PENDING_APPROVAL",
    isActive: false,
    proposedMaxUsers: null,
    proposedMaxCustomers: null,
    proposedMaxInvoicesPerMonth: null,
    maxUsers: null,
    maxCustomers: null,
    maxInvoicesPerMonth: null
  },
  {
    name: "Growth",
    code: "GROWTH",
    description: "Excel imports, partial allocation, task assignment, promises, reminder templates, statements and advanced ageing.",
    proposedMonthlyPrice: "2499.00",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    pricingStatus: "PENDING_APPROVAL",
    pricingProposalStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    limitsProposalStatus: "PENDING_APPROVAL",
    isActive: false,
    proposedMaxUsers: null,
    proposedMaxCustomers: null,
    proposedMaxInvoicesPerMonth: null,
    maxUsers: null,
    maxCustomers: null,
    maxInvoicesPerMonth: null
  },
  {
    name: "Business",
    code: "BUSINESS",
    description: "Advanced workflows, prioritisation, disputes, team performance, dashboards and advanced reporting.",
    proposedMonthlyPrice: "5999.00",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    pricingStatus: "PENDING_APPROVAL",
    pricingProposalStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    limitsProposalStatus: "PENDING_APPROVAL",
    isActive: false,
    proposedMaxUsers: null,
    proposedMaxCustomers: null,
    proposedMaxInvoicesPerMonth: null,
    maxUsers: null,
    maxCustomers: null,
    maxInvoicesPerMonth: null
  },
  {
    name: "Enterprise",
    code: "ENTERPRISE",
    description: "Custom limits, multi-entity support, advanced access, API, custom reports and integrations.",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    pricingStatus: "PENDING_APPROVAL",
    pricingProposalStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    limitsProposalStatus: "PENDING_APPROVAL",
    isActive: false,
    proposedMaxUsers: null,
    proposedMaxCustomers: null,
    proposedMaxInvoicesPerMonth: null,
    maxUsers: null,
    maxCustomers: null,
    maxInvoicesPerMonth: null
  }
];

async function main() {
  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description
      },
      create: plan
    });

    console.log(`${plan.name} plan saved successfully`);
  }

  console.log("All 4 subscription plans seeded successfully!");
}

main()
  .catch((error) => {
    console.error("Subscription seed error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });