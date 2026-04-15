import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function updateSedes() {
  const client = await pool.connect();

  const sedes = [
    "AC",
    "TRUJILLO",
    "CHINCHA",
    "HUACHO",
    "HUARAZ",
    "DESAGUADERO",
    "LIMA",
    "CHIMBOTE",
  ];

  try {
    await client.query("BEGIN");

    // Eliminar todas las sedes existentes
    const deleteResult = await client.query(`DELETE FROM "Sede";`);
    console.log(`🗑️  ${deleteResult.rowCount} sedes eliminadas`);

    // Insertar las nuevas sedes
    for (let i = 0; i < sedes.length; i++) {
      await client.query(
        `INSERT INTO "Sede" (id, name, "isActive") VALUES ($1, $2, true)`,
        [i + 1, sedes[i]]
      );
    }

    await client.query("COMMIT");
    console.log(`\n✅ ${sedes.length} sedes insertadas exitosamente\n`);

    // Verificar
    const result = await client.query(`SELECT id, name, "isActive" FROM "Sede" ORDER BY id`);
    
    console.log("=== SEDES REGISTRADAS ===\n");
    result.rows.forEach((s) => {
      const status = s.isActive ? "✅ Activa" : "❌ Inactiva";
      console.log(`${s.id}. ${s.name} - ${status}`);
    });
    console.log(`\nTotal: ${result.rows.length} sedes`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", error);
  } finally {
    client.release();
    await pool.end();
  }
}

updateSedes();
