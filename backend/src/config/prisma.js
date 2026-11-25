import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["error", "warn"]
});

console.log("Prisma client initialized");

export default prisma;