import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Conectando a la base de datos...");
  const program = await prisma.program.findFirst({
    where: { name: { contains: "WCDP", mode: "insensitive" } }
  });
  
  if (!program) {
    console.log("Programa WCDP no encontrado");
    return;
  }

  console.log("Programa:", program.name, "ID:", program.id);
  console.log("");

  const questions = await prisma.questionProgram.findMany({
    where: { programId: program.id },
    include: { 
      question: { 
        include: { 
          options: true, 
          configs: true,
          cargos: true 
        } 
      } 
    },
    orderBy: { question: { order: "asc" } }
  });

  console.log("Total preguntas:", questions.length);
  console.log("");
  
  questions.forEach((qp, i) => {
    const q = qp.question;
    console.log(`${i + 1}. ID: ${q.id}`);
    console.log(`   Texto: ${q.text}`);
    console.log(`   targetType: ${q.targetType}`);
    console.log(`   frequencyType: ${q.frequencyType}`);
    console.log(`   Opciones: ${q.options?.length || 0}`);
    console.log(`   Archivos: ${q.configs?.length || 0}`);
    console.log("");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});