import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import test from "node:test";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import authRoutes from "../routes/auth.routes.js";
import authMiddleware from "../middleware/auth.middleware.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.get("/api/auth/profile", authMiddleware, (req, res) =>
  res.status(200).json({ success: true, user: req.user }),
);

test("staff login validates passwords, JWT claims, roles, and profile isolation", async () => {
  const database = new URL(process.env.DATABASE_URL || "");
  const databaseName = decodeURIComponent(database.pathname.replace(/^\/+/, ""));
  assert.equal(databaseName, "auron_collect_app_dev", "integration tests require the development database");

  const originalJwtSecret = process.env.JWT_SECRET;
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = jwtSecret;

  let server;
  let organisation;
  const suffix = crypto.randomUUID();
  const password = "Auth-Test-Password-94!";
  const roleUsers = [];

  try {
    organisation = await prisma.organisation.create({
      data: { name: `Auth Integration ${suffix}` },
    });
    const passwordHash = await bcrypt.hash(password, 12);

    for (const role of ["SUPER_ADMIN", "ADMIN", "OWNER", "USER"]) {
      roleUsers.push(await prisma.user.create({
        data: {
          name: `${role} ${suffix}`,
          email: `${role.toLowerCase()}-${suffix}@example.invalid`,
          password: passwordHash,
          role,
          organisationId: organisation.id,
        },
      }));
    }

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const roleUser of roleUsers) {
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: roleUser.email, password }),
      });
      assert.equal(loginResponse.status, 200);

      const loginData = await loginResponse.json();
      assert.equal(loginData.user.id, roleUser.id);
      assert.equal(loginData.user.organisationId, organisation.id);
      assert.equal(loginData.user.role, roleUser.role);

      const decoded = jwt.verify(loginData.token, jwtSecret);
      assert.equal(decoded.userId, roleUser.id);
      assert.equal(decoded.organisationId, organisation.id);
      assert.equal(decoded.role, roleUser.role);

      const profileResponse = await fetch(`${baseUrl}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      assert.equal(profileResponse.status, 200);
      const profileData = await profileResponse.json();
      assert.equal(profileData.user.userId, roleUser.id);
      assert.equal(profileData.user.organisationId, organisation.id);
      assert.equal(profileData.user.role, roleUser.role);
    }

    const invalidPasswordResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: roleUsers[0].email, password: "wrong-password" }),
    });
    assert.equal(invalidPasswordResponse.status, 401);

    const nonexistentResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `missing-${suffix}@example.invalid`, password }),
    });
    assert.equal(nonexistentResponse.status, 401);
  } finally {
    await new Promise((resolve) => server?.close(resolve));
    await prisma.user.deleteMany({ where: { organisationId: organisation?.id } });
    if (organisation) {
      await prisma.organisation.delete({ where: { id: organisation.id } });
    }
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    await prisma.$disconnect();
  }
});
