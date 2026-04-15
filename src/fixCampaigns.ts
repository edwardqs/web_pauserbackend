import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Dejar solo una campaña activa
    await pool.query('UPDATE "Campaign" SET "isActive" = false WHERE id != 4');
    
    // Verificar preguntas con configs
    const questions = await pool.query(`
      SELECT q.id, q.text, COUNT(qc.id) as config_count, COUNT(DISTINCT qc."cargoId") as cargo_count
      FROM "Question" q
      LEFT JOIN "QuestionConfig" qc ON q.id = qc."questionId"
      WHERE q."isActive" = true
      GROUP BY q.id
    `);
    console.log("Preguntas con configs:", questions.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);