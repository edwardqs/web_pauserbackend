import "dotenv/config";
import { prisma } from "./lib/prisma.js";

async function run() {
  try {
    // Insert campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: "Campaña 2024",
        startDate: new Date(),
        endDate: new Date("2025-12-31"),
        isActive: true,
      },
    });
    console.log("Campaña creada:", campaign.id);

    // Insert questions
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

    console.log("Datos de prueba creados!");
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

run();