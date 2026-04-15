import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Insertar unidades de negocio
    const unidades = ["OPL", "BACKUS", "MONDELEZ", "CBC(Bebidas)", "PURINA", "ADMINISTRACIÓN", "MULTIMARCA"];
    
    for (const u of unidades) {
      await pool.query('INSERT INTO "UnidadNegocio" (name) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    }
    console.log("Unidades de negocio insertadas:", unidades);

    console.log("¡Datos actualizados!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);