import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function run() {
  try {
    const q = await prisma.question.findMany();
    console.log("questions ok", q);
  } catch (e) { console.error("error", e); }
}
run();
