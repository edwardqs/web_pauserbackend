import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Ver estado actual
    const sedes = await pool.query('SELECT * FROM "Sede" ORDER BY id');
    const unidades = await pool.query('SELECT * FROM "UnidadNegocio" ORDER BY id');
    
    console.log("Sedes actuales:", sedes.rows.map(r => r.name));
    console.log("Unidades actuales:", unidades.rows.map(r => r.name));

    // Limpiar y actualizar sedes
    await pool.query('DELETE FROM "Sede"');
    const nuevasSedes = ["AC", "TRUJILLO", "CHIMBOTE", "HUARAZ", "HUACHO", "CHINCHA", "DESAGUADERO", "LIMA", "ICA"];
    for (const s of nuevasSedes) {
      await pool.query('INSERT INTO "Sede" (name) VALUES ($1)', [s]);
    }
    console.log("Sedes actualizadas:", nuevasSedes);

    // Limpiar y actualizar unidades
    await pool.query('DELETE FROM "UnidadNegocio"');
    const nuevasUnidades = ["OPL", "MONDELEZ", "BACKUS", "PURINA", "CBC (Bebidas)", "MULTIMARCA"];
    for (const u of nuevasUnidades) {
      await pool.query('INSERT INTO "UnidadNegocio" (name) VALUES ($1)', [u]);
    }
    console.log("Unidades actualizadas:", nuevasUnidades);

    console.log("¡Done!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);