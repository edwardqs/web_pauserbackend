import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "QuestionCargo" (
        id SERIAL PRIMARY KEY,
        "questionId" INTEGER NOT NULL,
        "cargoId" INTEGER NOT NULL,
        CONSTRAINT "QuestionCargo_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON DELETE CASCADE,
        CONSTRAINT "QuestionCargo_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo"(id),
        CONSTRAINT "QuestionCargo_questionId_cargoId_key" UNIQUE ("questionId", "cargoId")
      )
    `);
    console.log("Tabla QuestionCargo creada");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);