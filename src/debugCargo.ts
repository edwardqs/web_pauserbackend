import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver cargoId del usuario
    const user = await pool.query(`
      SELECT id, email, name, "cargoId" FROM "User" WHERE email = 'bguarniz@pauserdistribuciones.com'
    `);
    console.log("Usuario:", user.rows);

    // Ver pregunta 1 y sus cargos
    const pq1 = await pool.query(`
      SELECT q.id, q.text, qc."cargoId", c.name as cargo_name
      FROM "Question" q
      LEFT JOIN "QuestionCargo" qc ON q.id = qc."questionId"
      LEFT JOIN "Cargo" c ON qc."cargoId" = c.id
      WHERE q.id = 1
    `);
    console.log("Pregunta 1:", pq1.rows);

    // Ver las preguntas que aplican a cargoId = 7 (COORDINADOR DE MEJORA CONTINUA)
    const aplicable = await pool.query(`
      SELECT q.id, q.text, array_agg(c.name) as cargos
      FROM "Question" q
      LEFT JOIN "QuestionCargo" qc ON q.id = qc."questionId"
      LEFT JOIN "Cargo" c ON qc."cargoId" = c.id
      WHERE q."isActive" = true
      GROUP BY q.id
      HAVING c.id = 7 OR c.id IS NULL
    `);
    console.log("Preguntas aplicables a cargo 7:", aplicable.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);