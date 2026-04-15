import { prisma } from "./lib/prisma.js";

async function main() {
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "adminScore" INTEGER`;
    console.log("Column 'adminScore' added");
  } catch (e: any) {
    console.log("adminScore:", e.message.includes("already exists") ? "already exists" : e.message);
  }
  
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "adminComment" TEXT`;
    console.log("Column 'adminComment' added");
  } catch (e: any) {
    console.log("adminComment:", e.message.includes("already exists") ? "already exists" : e.message);
  }
  
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "adminReviewedAt" TIMESTAMP`;
    console.log("Column 'adminReviewedAt' added");
  } catch (e: any) {
    console.log("adminReviewedAt:", e.message.includes("already exists") ? "already exists" : e.message);
  }
  
  try {
    await prisma.$executeRaw`ALTER TABLE "Answer" ADD COLUMN "reviewedById" INTEGER REFERENCES "User"(id)`;
    console.log("Column 'reviewedById' added");
  } catch (e: any) {
    console.log("reviewedById:", e.message.includes("already exists") ? "already exists" : e.message);
  }

  try {
    await prisma.$executeRaw`ALTER TABLE "Evaluation" ADD COLUMN "programId" INTEGER REFERENCES "Program"(id)`;
    console.log("Column 'programId' added to Evaluation");
  } catch (e: any) {
    console.log("programId (Evaluation):", e.message.includes("already exists") ? "already exists" : e.message);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });