import assert from "node:assert/strict";
import test from "node:test";
import dashboardAccessMiddleware from "./dashboard-access.middleware.js";

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("dashboard access middleware resolves authenticated assignment and tenant", () => {
  const req = {
    user: {
      userId: "user-1",
      organisationId: "org-1",
      name: "Alex Morgan",
      role: "USER",
    },
  };
  const res = response();
  let nextCalled = false;

  dashboardAccessMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.dashboardAccess.organisationId, "org-1");
  assert.equal(req.dashboardAccess.assignedExecutive, "Alex Morgan");
});

test("dashboard access middleware rejects unsupported roles before controller access", () => {
  const req = {
    user: {
      userId: "user-1",
      organisationId: "org-1",
      name: "Alex Morgan",
      role: "FINANCE_MANAGER",
    },
  };
  const res = response();
  let nextCalled = false;

  dashboardAccessMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
