import prisma from "./src/config/prisma.js";

const r = await prisma.reminder.findUnique({
  where: {
    id: "f754a1e4-f62d-41fc-8d4d-449cf75c0624"
  },
  select: {
    id: true,
    status: true,
    channel: true,
    scheduledFor: true,
    organisationId: true
  }
});

console.log(r);

await prisma.$disconnect();