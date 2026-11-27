import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import authRoutes from "./auth.routes.js";

test("staff password reset endpoints are public but rate limited", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/auth/password/forgot`;
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "" })
      }));
    }

    assert.deepEqual(responses.slice(0, 5).map(({ status }) => status), [
      202, 202, 202, 202, 202
    ]);
    assert.equal(responses[5].status, 429);
    const acceptedBodies = await Promise.all(
      responses.slice(0, 5).map((response) => response.clone().json())
    );
    assert.ok(acceptedBodies.every((body) => body.message.includes("If an account exists")));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
