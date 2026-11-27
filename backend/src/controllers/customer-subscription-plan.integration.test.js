import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import test from "node:test";
import prisma from "../config/prisma.js";
import customerSubscriptionPlanRoutes from "../routes/customer-subscription-plan.routes.js";

const app = express();
app.use(express.json());
app.use("/api/customer-subscription-plans", customerSubscriptionPlanRoutes);

test("organization customer plans enforce tenant isolation and separate owner approvals", async () => {
  const database = new URL(process.env.DATABASE_URL || "");
  const databaseName = decodeURIComponent(database.pathname.replace(/^\/+/, ""));
  assert.equal(databaseName, "auron_collect_app_dev", "integration tests require the development database");

  const originalJwtSecret = process.env.JWT_SECRET;
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = jwtSecret;
  let server;
  let organisation;
  let otherOrganisation;
  let owner;
  let admin;
  let otherOwner;
  let customer;
  const suffix = crypto.randomUUID();

  const createUser = (orgId, role, email) => prisma.user.create({
    data: {
      name: `${role} ${suffix}`,
      email,
      password: "integration-test-only",
      role,
      organisationId: orgId
    }
  });

  try {
    organisation = await prisma.organisation.create({
      data: { name: `Customer Plan Org ${suffix}` }
    });
    otherOrganisation = await prisma.organisation.create({
      data: { name: `Other Customer Plan Org ${suffix}` }
    });
    [owner, admin, otherOwner] = await Promise.all([
      createUser(organisation.id, "OWNER", `owner-${suffix}@example.invalid`),
      createUser(organisation.id, "ADMIN", `admin-${suffix}@example.invalid`),
      createUser(otherOrganisation.id, "OWNER", `other-owner-${suffix}@example.invalid`)
    ]);
    customer = await prisma.customer.create({
      data: {
        customerCode: `PLAN-${suffix}`,
        name: `Customer ${suffix}`,
        type: "BUSINESS",
        status: "ACTIVE",
        organisationId: organisation.id
      }
    });

    const listener = await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const baseUrl = `http://127.0.0.1:${listener.address().port}`;
    const tokenFor = (user) => jwt.sign({
      userId: user.id,
      organisationId: user.organisationId,
      sessionVersion: user.sessionVersion
    }, jwtSecret, { expiresIn: "10m" });
    const request = (method, path, user, body) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(user)}`,
        "Content-Type": "application/json"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    const createdResponse = await request(
      "POST",
      "/api/customer-subscription-plans",
      admin,
      {
        organisationId: otherOrganisation.id,
        code: `plan-${suffix.slice(0, 8)}`,
        name: "Integration Plan",
        currency: "INR",
        proposedQuarterlyPrice: "300.00",
        proposedTaxTerms: "GST as applicable",
        features: ["Priority support"],
        usageLimits: { seats: 5 },
        eligibleCustomerTypes: ["BUSINESS"]
      }
    );
    assert.equal(createdResponse.status, 201);
    const { plan: createdPlan } = await createdResponse.json();
    assert.equal(createdPlan.organisationId, organisation.id);
    assert.equal(createdPlan.isActive, false);
    assert.equal(createdPlan.pricingProposalStatus, "PENDING_APPROVAL");

    const deniedPriceApproval = await request(
      "POST",
      `/api/customer-subscription-plans/${createdPlan.id}/approvals/pricing`,
      admin,
      {}
    );
    assert.equal(deniedPriceApproval.status, 403);

    const priceApproval = await request(
      "POST",
      `/api/customer-subscription-plans/${createdPlan.id}/approvals/pricing`,
      owner,
      {}
    );
    assert.equal(priceApproval.status, 200);
    const taxApproval = await request(
      "POST",
      `/api/customer-subscription-plans/${createdPlan.id}/approvals/tax`,
      owner,
      {}
    );
    assert.equal(taxApproval.status, 200);

    const activation = await request(
      "PATCH",
      `/api/customer-subscription-plans/${createdPlan.id}`,
      admin,
      { isActive: true }
    );
    assert.equal(activation.status, 200);
    assert.equal((await activation.json()).plan.isActive, true);

    const revisedPricing = await request(
      "PATCH",
      `/api/customer-subscription-plans/${createdPlan.id}`,
      admin,
      { proposedQuarterlyPrice: "350.00", isActive: true }
    );
    assert.equal(revisedPricing.status, 200);
    const revisedPlan = (await revisedPricing.json()).plan;
    assert.equal(revisedPlan.pricingProposalStatus, "PENDING_APPROVAL");
    assert.equal(revisedPlan.taxProposalStatus, "APPROVED");

    const otherOrgList = await request(
      "GET",
      "/api/customer-subscription-plans",
      otherOwner
    );
    assert.equal(otherOrgList.status, 200);
    assert.deepEqual((await otherOrgList.json()).plans, []);

    const crossTenantUpdate = await request(
      "PATCH",
      `/api/customer-subscription-plans/${createdPlan.id}`,
      otherOwner,
      { name: "Unauthorized Plan" }
    );
    assert.equal(crossTenantUpdate.status, 404);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (organisation) {
      await prisma.auditLog.deleteMany({ where: { organisationId: organisation.id } });
      await prisma.customerSubscriptionPlan.deleteMany({ where: { organisationId: organisation.id } });
      if (customer) await prisma.customer.delete({ where: { id: customer.id } });
      await prisma.user.deleteMany({ where: { organisationId: organisation.id } });
      await prisma.organisation.delete({ where: { id: organisation.id } });
    }
    if (otherOrganisation) {
      await prisma.user.deleteMany({ where: { organisationId: otherOrganisation.id } });
      await prisma.organisation.delete({ where: { id: otherOrganisation.id } });
    }
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
