import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Limpiar Cargo
    await pool.query('DELETE FROM "Cargo"');
    
    const nuevosCargos = [
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
    
    for (const c of nuevosCargos) {
      await pool.query('INSERT INTO "Cargo" (name) VALUES ($1)', [c]);
    }
    
    const result = await pool.query('SELECT * FROM "Cargo" ORDER BY id');
    console.log("Cargos actualizados:", result.rows.length);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);