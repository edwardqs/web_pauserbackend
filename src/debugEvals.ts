import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver evaluaciones
    const evals = await pool.query(`
      SELECT e.*, u.name as user_name
      FROM "Evaluation" e
      JOIN "User" u ON e."userId" = u.id
    `);
    console.log("Evaluaciones:", evals.rows);

    // Ver respuestas con archivos
    const answers = await pool.query(`
      SELECT a.*, q.text as question_text
      FROM "Answer" a
      JOIN "Question" q ON a."questionId" = q.id
      WHERE a.id > 0
    `);
    console.log("Respuestas:", answers.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);