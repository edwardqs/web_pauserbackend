import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver usuarios y sus cargos
    const users = await pool.query(`
      SELECT u.id, u.email, u.name, c.name as cargo
      FROM "User" u
      LEFT JOIN "Cargo" c ON u."cargoId" = c.id
      ORDER BY u.id
    `);
    console.log("Usuarios:", users.rows);

    // Ver preguntas y sus cargos asignados
    const questions = await pool.query(`
      SELECT q.id, q.text, array_agg(c.name) as cargos
      FROM "Question" q
      LEFT JOIN "QuestionCargo" qc ON q.id = qc."questionId"
      LEFT JOIN "Cargo" c ON qc."cargoId" = c.id
      WHERE q."isActive" = true
      GROUP BY q.id
      ORDER BY q.id
    `);
    console.log("Preguntas:", questions.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);