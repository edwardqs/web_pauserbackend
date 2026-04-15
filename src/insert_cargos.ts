import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function insertCargos() {
  const client = await pool.connect();

  const cargos = [
    "ANALISTA ADMINISTRATIVO Y PROCESOS",
    "ANALISTA COMERCIAL",
    "ANALISTA DE CAJA Y BANCOS",
    "ANALISTA DE GENTE Y GESTIÓN",
    "ANALISTA DE GENTE Y GESTIÓN Y SST",
    "ANALISTA DE GESTIÓN ADMINISTRATIVA",
    "ANALISTA DE OPERACIONES",
    "ANALISTA DE PROCESOS",
    "ANALISTA DE SEGURIDAD Y SALUD EN EL TRABAJO",
    "COORDINADOR DE MEJORA CONTINUA",
    "COORDINADOR DE OPERACIONES",
    "COORDINADOR DE SEGURIDAD Y SALUD EN EL TRABAJO",
    "JEFE COMERCIAL",
    "JEFE DE ADMINISTRACIÓN Y FINANZAS",
    "JEFE DE GENTE Y GESTIÓN",
    "JEFE DE OPERACIONES",
    "JEFE DE VENTAS",
    "SUPERVISOR DE FLOTA",
    "SUPERVISOR DE OPERACIONES",
    "SUPERVISOR DE PLANEAMIENTO FINANCIERO",
    "SUPERVISOR DE RUTA",
    "SUPERVISOR DE TESORERÍA",
    "SUPERVISOR DE VENTAS",
    "SUPERVISOR DE VENTAS MAYORISTA",
  ];

  try {
    await client.query("BEGIN");

    // Eliminar cargos existentes
    await client.query(`DELETE FROM "Cargo";`);
    console.log("🗑️  Cargos existentes eliminados");

    // Insertar nuevos cargos
    for (let i = 0; i < cargos.length; i++) {
      await client.query(
        `INSERT INTO "Cargo" (id, name, "isActive") VALUES ($1, $2, true)`,
        [i + 1, cargos[i]]
      );
    }

    await client.query("COMMIT");
    console.log(`✅ ${cargos.length} cargos insertados exitosamente\n`);

    // Verificar
    const result = await client.query(`SELECT id, name FROM "Cargo" ORDER BY id`);
    
    console.log("=== CARGOS REGISTRADOS ===\n");
    result.rows.forEach((c) => {
      console.log(`${c.id}. ${c.name}`);
    });
    console.log(`\nTotal: ${result.rows.length} cargos`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", error);
  } finally {
    client.release();
    await pool.end();
  }
}

insertCargos();
