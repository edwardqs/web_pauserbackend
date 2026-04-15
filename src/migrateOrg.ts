import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Crear tablas de referencia
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Sede" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS "UnidadNegocio" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS "Cargo" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true
      );
    `);
    console.log("Tablas de referencia creadas");

    // Agregar columnas a User
    await pool.query(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sedeId" INTEGER;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "unidadId" INTEGER;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cargoId" INTEGER;
      ALTER TABLE "User" ADD CONSTRAINT "User_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"(id);
      ALTER TABLE "User" ADD CONSTRAINT "User_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "UnidadNegocio"(id);
      ALTER TABLE "User" ADD CONSTRAINT "User_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo"(id);
    `);
    console.log("Columnas agregadas a User");

    // Insertar datos de ejemplo
    const sedes = ["Lima", "Arequipa", "Cusco", "Trujillo", "Chiclayo"];
    const unidades = ["Ventas", "Logística", "Administración", "Finanzas", "TI"];
    const cargos = ["Gerente", "Jefe", "Supervisor", "Analista", "Asistente", "Operario"];

    for (const s of sedes) {
      await pool.query('INSERT INTO "Sede" (name) VALUES ($1) ON CONFLICT DO NOTHING', [s]);
    }
    for (const u of unidades) {
      await pool.query('INSERT INTO "UnidadNegocio" (name) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
    }
    for (const c of cargos) {
      await pool.query('INSERT INTO "Cargo" (name) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
    }
    console.log("Datos de ejemplo insertados");

    console.log("¡Migración completada!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);