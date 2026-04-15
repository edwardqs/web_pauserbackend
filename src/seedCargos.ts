import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Agregar datos de Cargo
    const cargos = ["Gerente", "Jefe", "Supervisor", "Analista", "Asistente", "Operario"];
    
    for (const c of cargos) {
      await pool.query('INSERT INTO "Cargo" (name) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
    }
    
    const result = await pool.query('SELECT * FROM "Cargo"');
    console.log("Cargos:", result.rows);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);