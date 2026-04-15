import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    // Crear roles
    const adminRole = await prisma.role.create({
      data: { name: "admin" },
    });
    const userRole = await prisma.role.create({
      data: { name: "user" },
    });
    console.log("Roles creados:", adminRole.id, userRole.id);

    // Crear usuarios de prueba
    const users = [
      { email: "admin@test.com", password: "admin123", name: "Admin", roleId: adminRole.id },
      { email: "user@test.com", password: "user123", name: "Usuario", roleId: userRole.id },
    ];

    for (const u of users) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      await prisma.user.create({
        data: {
          email: u.email,
          password: hashedPassword,
          name: u.name,
          roleId: u.roleId,
        },
      });
      console.log("Usuario creado:", u.email);
    }

    // Crear campaña
    const campaign = await prisma.campaign.create({
      data: {
        name: "Campaña 2024",
        startDate: new Date(),
        endDate: new Date("2025-12-31"),
        isActive: true,
      },
    });
    console.log("Campaña creada:", campaign.id);

    // Crear preguntas de prueba
    const questions = [
      { text: "¿Cuentas con el manual de funciones actualizado?", evidenceType: "PDF", order: 1 },
      { text: "¿Tienes el organigrama vigente publicado?", evidenceType: "IMAGEN", order: 2 },
      { text: "¿Presentas informe mensual de actividades?", evidenceType: "EXCEL", order: 3 },
      { text: "¿Cumples con el plan estratégico anual?", evidenceType: "PPT", order: 4 },
      { text: "¿Tienes certificados de capacitación del personal?", evidenceType: "PDF", order: 5 },
      { text: "¿Dispones de presupuesto aprobado?", evidenceType: "EXCEL", order: 6 },
    ];

    for (const q of questions) {
      await prisma.question.create({ data: q });
      console.log("Pregunta creada:", q.text);
    }

    console.log("¡Datos de prueba creados!");
  } finally {
    await prisma.$disconnect();
  }
}

main();