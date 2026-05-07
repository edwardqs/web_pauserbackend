import { prisma } from "../lib/prisma.ts";

export async function expireDelegations() {
  console.log("[expireDelegations] Running...");

  try {
    const result = await prisma.answerDelegation.updateMany({
      where: {
        status: "PENDIENTE",
        deadlineAt: {
          lt: new Date(),
        },
      },
      data: {
        status: "VENCIDO",
      },
    });

    console.log(`[expireDelegations] Marked ${result.count} delegations as VENCIDO`);
    return result.count;
  } catch (error) {
    console.error("[expireDelegations] Error:", error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  expireDelegations()
    .then((count) => {
      console.log(`Done: ${count} expired`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}