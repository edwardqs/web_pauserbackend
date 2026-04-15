import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Verificar si Role tiene datos
    const roles = await pool.query('SELECT id, name FROM "Role"');
    console.log("Roles actuales:", roles.rows);

    if (roles.rows.length === 0) {
      // Insertar roles
      await pool.query('INSERT INTO "Role" (name) VALUES (\'admin\'), (\'user\')');
      console.log("Roles insertados");
    }

    // Obtener IDs de roles
    const adminRole = await pool.query('SELECT id FROM "Role" WHERE name = $1', ['admin']);
    const userRole = await pool.query('SELECT id FROM "Role" WHERE name = $1', ['user']);
    
    console.log("Admin role ID:", adminRole.rows[0]?.id);
    console.log("User role ID:", userRole.rows[0]?.id);

    // Actualizar usuarios
    await pool.query('UPDATE "User" SET "roleId" = $1 WHERE email = $2', [adminRole.rows[0].id, 'admin@test.com']);
    await pool.query('UPDATE "User" SET "roleId" = $1 WHERE email = $2', [userRole.rows[0].id, 'bguarniz@pauserdistribuciones.com']);
    console.log("Usuarios actualizados");

    // Verificar
    const users = await pool.query('SELECT id, email, "roleId" FROM "User"');
    console.log("Users actualizados:", users.rows);

    console.log("¡Migración completada!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);