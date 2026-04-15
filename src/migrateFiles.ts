import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Crear tabla QuestionConfig
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "QuestionConfig" (
        id SERIAL PRIMARY KEY,
        "questionId" INTEGER NOT NULL,
        "fileType" TEXT NOT NULL,
        "maxFiles" INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT "QuestionConfig_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON DELETE CASCADE,
        CONSTRAINT "QuestionConfig_questionId_fileType_key" UNIQUE ("questionId", "fileType")
      )
    `);
    console.log("Tabla QuestionConfig creada");

    // Agregar columna maxScore a Evaluation
    await pool.query('ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "maxScore" INTEGER NOT NULL DEFAULT 0');
    console.log("Columna maxScore agregada a Evaluation");

    // Crear tabla AnswerFile
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "AnswerFile" (
        id SERIAL PRIMARY KEY,
        "answerId" INTEGER NOT NULL,
        "fileType" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "fileUrl" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "AnswerFile_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"(id) ON DELETE CASCADE
      )
    `);
    console.log("Tabla AnswerFile creada");

    // Migrar preguntas existentes a QuestionConfig
    const questions = await pool.query('SELECT id, "evidenceType" FROM "Question" WHERE "evidenceType" IS NOT NULL');
    for (const q of questions.rows) {
      await pool.query(
        'INSERT INTO "QuestionConfig" ("questionId", "fileType", "maxFiles") VALUES ($1, $2, 1) ON CONFLICT DO NOTHING',
        [q.id, q.evidenceType]
      );
    }
    console.log("Configs migradas de preguntas existentes");

    // Migrar respuestas existentes a AnswerFile (1 archivo por respuesta)
    const answers = await pool.query('SELECT id, "submittedFileType" FROM "Answer" WHERE "submittedFileType" IS NOT NULL');
    for (const a of answers.rows) {
      await pool.query(
        'INSERT INTO "AnswerFile" ("answerId", "fileType", "fileName", "fileUrl") VALUES ($1, $2, $2, $2)',
        [a.id, a.submittedFileType]
      );
    }
    console.log("Archivos migrados de respuestas existentes");

    // Calcular maxScore para evaluaciones existentes
    const evaluations = await pool.query('SELECT id FROM "Evaluation"');
    for (const e of evaluations.rows) {
      const result = await pool.query(
        `SELECT COUNT(*) as total FROM "Answer" WHERE "evaluationId" = $1`,
        [e.id]
      );
      const total = parseInt(result.rows[0].total) * 3;
      await pool.query('UPDATE "Evaluation" SET "maxScore" = $1 WHERE id = $2', [total, e.id]);
    }
    console.log("maxScore calculado para evaluaciones existentes");

    console.log("¡Migración completada!");
  } finally {
    await pool.end();
  }
}

main().catch(console.error);