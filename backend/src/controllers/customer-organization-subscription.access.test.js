import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import test from "node:test";
import customerPortalRoutes from "../routes/customer-portal.routes.js";

test("organization subscription endpoints reject anonymous and staff-session requests", async () => {
  const originalSecret = process.env.JWT_SECRET;
  const jwtSecret = "customer-portal-access-test-secret";
  process.env.JWT_SECRET = jwtSecret;

  const app = express();
  app.use(express.json());
  app.use("/api/customer-portal", customerPortalRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const staffToken = jwt.sign({
      userId: "staff-user",
      organisationId: "staff-organisation",
      sessionVersion: 0
    }, jwtSecret);
    for (const token of [null, staffToken]) {
      const response = await fetch(
        `${baseUrl}/api/customer-portal/organization-subscription`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );
      assert.equal(response.status, 401);
    }

    const checkoutResponse = await fetch(
      `${baseUrl}/api/customer-portal/organization-subscription/orders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: "attacker-selected-organisation",
          planCode: "STARTER"
        })
      }
    );
    assert.equal(checkoutResponse.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
