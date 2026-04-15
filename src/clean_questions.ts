import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function clean() {
  const client = await pool.connect();

  try {
    // 1. Ver estado actual
    const before = await client.query('SELECT id, text, "isActive" FROM "Question" ORDER BY id');
    console.log("=== Estado ANTES de la limpieza ===");
    console.log(`Total: ${before.rows.length} preguntas`);
    before.rows.forEach(r => console.log(`  [${r.id}] ${r.text.substring(0, 50)}... (active: ${r.isActive})`));

    // 2. Eliminar preguntas inactivas (soft delete)
    const deleted = await client.query('DELETE FROM "Question" WHERE "isActive" = false');
    console.log(`\n${deleted.rowCount} preguntas eliminadas.`);

    // 3. Ver estado después
    const after = await client.query('SELECT id, text FROM "Question" ORDER BY id');
    console.log("\n=== Estado DESPUÉS de la limpieza ===");
    after.rows.forEach(r => console.log(`  [${r.id}] ${r.text.substring(0, 50)}...`));

    // 4. Resetear la secuencia auto-incremental
    if (after.rows.length > 0) {
      const maxId = Math.max(...after.rows.map(r => r.id));
      await client.query(`ALTER SEQUENCE "Question_id_seq" RESTART WITH ${maxId + 1}`);
      console.log(`\nSecuencia reseteada. Next ID: ${maxId + 1}`);
    } else {
      await client.query('ALTER SEQUENCE "Question_id_seq" RESTART WITH 1');
      console.log("\nSecuencia reseteada. Next ID: 1");
    }

    console.log("\nLimpieza completada.");
  } finally {
    await pool.end();
  }
}

clean().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
