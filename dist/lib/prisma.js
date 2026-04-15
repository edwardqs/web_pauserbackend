import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
const { Pool } = pg;
const createPrismaClient = () => {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
};
export const prisma = createPrismaClient();
export const disconnectPrisma = async () => {
    await prisma.$disconnect();
};
//# sourceMappingURL=prisma.js.map