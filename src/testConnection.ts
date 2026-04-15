import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function testConnection() {
  try {
    console.log("🔄 Conectando a la base de datos...");

    await prisma.$connect();
    console.log("✅ Conexión exitosa a PostgreSQL");

    const users = await prisma.user.findMany();
    console.log(`📊 Usuarios encontrados: ${users.length}`);

    if (users.length > 0) {
      console.log("👤 Lista de usuarios:");
      users.forEach((u) => {
        console.log(`   - ID: ${u.id}, Email: ${u.email}, Role: ${u.role}`);
      });
    }

    await prisma.$disconnect();
    console.log("🔌 Conexión cerrada");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error de conexión:", error);
    process.exit(1);
  }
}

testConnection();