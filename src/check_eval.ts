import { prisma } from "./lib/prisma.js";

async function main() {
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "periodStart" TIMESTAMP`;
    console.log("Column 'periodStart' added");
  } catch (e: any) {
    console.log("periodStart:", e.message.includes("already exists") ? "already exists" : e.message);
  }
  
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "periodEnd" TIMESTAMP`;
    console.log("Column 'periodEnd' added");
  } catch (e: any) {
    console.log("periodEnd:", e.message.includes("already exists") ? "already exists" : e.message);
  }

  try {
    await prisma.$executeRaw`
      ALTER TABLE "Answer" DROP CONSTRAINT IF EXISTS "Answer_evaluationId_questionId_key"
    `;
    console.log("Dropped old unique constraint");
  } catch (e: any) {
    console.log("Drop constraint:", e.message);
  }

  try {
    await prisma.$executeRaw`
      ALTER TABLE "Answer" ADD CONSTRAINT "Answer_evaluationId_questionId_periodStart_key" UNIQUE ("evaluationId", "questionId", "periodStart")
    `;
    console.log("Added new unique constraint");
  } catch (e: any) {
    console.log("Add constraint:", e.message);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });