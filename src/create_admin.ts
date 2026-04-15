import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createAdmin() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Crear roles si no existen
    await client.query(`INSERT INTO "Role" (id, name) VALUES (1, 'admin'), (2, 'user') ON CONFLICT (id) DO NOTHING;`);

    // 2. Crear sedes de ejemplo
    await client.query(`INSERT INTO "Sede" (id, name, "isActive") VALUES 
      (1, 'Sede Central', true),
      (2, 'Sede Norte', true),
      (3, 'Sede Sur', true)
      ON CONFLICT (id) DO NOTHING;`);

    // 3. Crear unidades de negocio
    await client.query(`INSERT INTO "UnidadNegocio" (id, name, "isActive") VALUES 
      (1, 'Operaciones', true),
      (2, 'Administración', true),
      (3, 'Logística', true)
      ON CONFLICT (id) DO NOTHING;`);

    // 4. Crear cargos
    await client.query(`INSERT INTO "Cargo" (id, name, "isActive") VALUES 
      (1, 'Supervisor', true),
      (2, 'Coordinador', true),
      (3, 'Analista', true),
      (4, 'Operador', true)
      ON CONFLICT (id) DO NOTHING;`);

    // 5. Crear usuario admin con bcrypt
    const hashedPassword = await bcrypt.hash("123456", 10);
    
    const adminExists = await client.query(`SELECT id FROM "User" WHERE email = $1`, ["admin@pauser.com"]);
    
    if (adminExists.rows.length > 0) {
      console.log("⚠️  El usuario admin ya existe, actualizando password...");
      await client.query(
        `UPDATE "User" SET password = $1 WHERE email = $2`,
        [hashedPassword, "admin@pauser.com"]
      );
    } else {
      await client.query(
        `INSERT INTO "User" (email, password, name, "roleId", "sedeId", "unidadId", "cargoId", "createdAt") 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        ["admin@pauser.com", hashedPassword, "Administrador", 1, 1, 1, 1]
      );
      console.log("✅ Usuario admin creado exitosamente");
    }

    await client.query("COMMIT");

    // Verificar
    const result = await client.query(`SELECT u.id, u.email, u.name, r.name as role FROM "User" u JOIN "Role" r ON u."roleId" = r.id WHERE u.email = $1`, ["admin@pauser.com"]);
    
    console.log("\n=== USUARIO ADMIN CREADO ===\n");
    console.log(`ID: ${result.rows[0].id}`);
    console.log(`Email: ${result.rows[0].email}`);
    console.log(`Nombre: ${result.rows[0].name}`);
    console.log(`Rol: ${result.rows[0].role}`);
    console.log(`\nContraseña: 123456`);
    console.log(`\n✅ Password hasheado correctamente con bcrypt`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", error);
  } finally {
    client.release();
    await pool.end();
  }
}

createAdmin();
