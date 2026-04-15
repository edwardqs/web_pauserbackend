import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";

const router = Router();

// GET /api/reports/monthly-comparison?month=2026-04&userId=X (admin) o solo month (user ve propio)
router.get("/monthly-comparison", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { month, userId } = req.query;
    const currentUserId = req.user!.id;
    const isAdmin = req.user!.roleId === 1;

    // month formato: "2026-04"
    if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month debe tener formato YYYY-MM" });
    }

    const [year, monthNum] = month.split("-").map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59);

    const targetUserId = isAdmin && userId ? parseInt(userId as string) : currentUserId;

    // Obtener evaluaciones de ambos sources para el usuario en el mes
    const evaluations = await prisma.evaluation.findMany({
      where: {
        userId: targetUserId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        campaign: { select: { id: true, name: true } },
        answers: {
          include: {
            question: {
              include: {
                options: true,
                configs: true,
              },
            },
            option: true,
            files: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const excelenciaEval = evaluations.find(e => e.source === "EXCELENCIA");
    const misProgramasEval = evaluations.find(e => e.source === "MIS_PROGRAMAS");

    // Obtener detalle por pregunta
    const getQuestionDetails = (evaluation: typeof excelenciaEval) => {
      if (!evaluation) return [];
      return evaluation.answers.map(a => ({
        questionId: a.questionId,
        questionText: a.question.text,
        awardedScore: a.awardedScore,
        optionSelected: a.option?.label || null,
        optionText: a.option?.text || null,
        maxScore: a.question.options.length > 0 ? Math.max(...a.question.options.map(o => o.score)) : 0,
        hasFiles: a.files.length > 0,
        files: a.files.map(f => ({ fileType: f.fileType, fileName: f.fileName })),
      }));
    };

    // Historial mensual (últimos 6 meses)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyHistory = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('month', "createdAt") as month,
        source,
        AVG("totalScore") as avg_score,
        AVG("maxScore") as max_score,
        COUNT(*) as count
      FROM "Evaluation"
      WHERE "userId" = ${targetUserId}
        AND "createdAt" >= ${sixMonthsAgo}
      GROUP BY DATE_TRUNC('month', "createdAt"), source
      ORDER BY month ASC
    `;

    // Estadísticas por cargo (admin)
    let cargoStats = null;
    if (isAdmin) {
      const allEvaluations = await prisma.evaluation.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              cargo: { select: { name: true } },
            },
          },
        },
      });

      const cargoMap: Record<string, { excelencia: number[], misProgramas: number[] }> = {};
      allEvaluations.forEach(e => {
        const cargoName = e.user.cargo?.name || "Sin cargo";
        if (!cargoMap[cargoName]) {
          cargoMap[cargoName] = { excelencia: [], misProgramas: [] };
        }
        if (e.source === "EXCELENCIA") {
          cargoMap[cargoName].excelencia.push(e.totalScore);
        } else if (e.source === "MIS_PROGRAMAS") {
          cargoMap[cargoName].misProgramas.push(e.totalScore);
        }
      });

      cargoStats = Object.entries(cargoMap).map(([cargo, scores]) => ({
        cargo,
        excelencia: {
          count: scores.excelencia.length,
          avg: scores.excelencia.length > 0 ? Math.round(scores.excelencia.reduce((a, b) => a + b, 0) / scores.excelencia.length) : 0,
        },
        misProgramas: {
          count: scores.misProgramas.length,
          avg: scores.misProgramas.length > 0 ? Math.round(scores.misProgramas.reduce((a, b) => a + b, 0) / scores.misProgramas.length) : 0,
        },
      }));
    }

    res.json({
      month,
      user: {
        id: targetUserId,
        name: excelenciaEval?.user?.name || misProgramasEval?.user?.name || null,
      },
      current: {
        excelencia: excelenciaEval ? {
          totalScore: excelenciaEval.totalScore,
          maxScore: excelenciaEval.maxScore,
          percentage: excelenciaEval.maxScore > 0 ? Math.round((excelenciaEval.totalScore / excelenciaEval.maxScore) * 100) : 0,
          completedAt: excelenciaEval.completedAt,
          questions: getQuestionDetails(excelenciaEval),
        } : null,
        misProgramas: misProgramasEval ? {
          totalScore: misProgramasEval.totalScore,
          maxScore: misProgramasEval.maxScore,
          percentage: misProgramasEval.maxScore > 0 ? Math.round((misProgramasEval.totalScore / misProgramasEval.maxScore) * 100) : 0,
          completedAt: misProgramasEval.completedAt,
          questions: getQuestionDetails(misProgramasEval),
        } : null,
      },
      difference: excelenciaEval && misProgramasEval
        ? excelenciaEval.totalScore - misProgramasEval.totalScore
        : null,
      history: monthlyHistory,
      cargoStats,
    });
  } catch (error: any) {
    console.error("Error al obtener comparativa mensual:", error);
    res.status(500).json({ error: error.message || "Error al obtener comparativa mensual" });
  }
});

// GET /api/reports/question-breakdown?month=2026-04&questionId=X
router.get("/question-breakdown", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { month, questionId } = req.query;

    if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month debe tener formato YYYY-MM" });
    }

    if (!questionId) {
      return res.status(400).json({ error: "Falta questionId" });
    }

    const [year, monthNum] = month.split("-").map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59);

    const qId = parseInt(questionId as string);

    // Obtener todas las respuestas para esta pregunta en el mes
    const answers = await prisma.answer.findMany({
      where: {
        questionId: qId,
        evaluation: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        evaluation: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                cargo: { select: { name: true } },
              },
            },
          },
        },
        question: {
          include: {
            options: true,
          },
        },
        option: true,
        files: true,
      },
    });

    // Agrupar por opción seleccionada
    const optionDistribution: Record<string, { count: number; users: string[] }> = {};
    answers.forEach(a => {
      const optionLabel = a.option?.label || "Sin respuesta";
      if (!optionDistribution[optionLabel]) {
        optionDistribution[optionLabel] = { count: 0, users: [] };
      }
      optionDistribution[optionLabel].count++;
      optionDistribution[optionLabel].users.push(a.evaluation.user.name || a.evaluation.user.email);
    });

    // Distribución por fuente
    const sourceDistribution = answers.reduce((acc, a) => {
      const source = a.evaluation.source;
      if (!acc[source]) acc[source] = { count: 0, totalScore: 0 };
      acc[source].count++;
      acc[source].totalScore += a.awardedScore;
      return acc;
    }, {} as Record<string, { count: number; totalScore: number }>);

    // Estadísticas
    const totalAnswers = answers.length;
    const avgScore = totalAnswers > 0 ? Math.round(answers.reduce((sum, a) => sum + a.awardedScore, 0) / totalAnswers) : 0;
    const withFiles = answers.filter(a => a.files.length > 0).length;

    res.json({
      question: {
        id: answers[0]?.question.id,
        text: answers[0]?.question.text,
        options: answers[0]?.question.options || [],
      },
      month,
      totalAnswers,
      avgScore,
      withFiles,
      withoutFiles: totalAnswers - withFiles,
      optionDistribution,
      sourceDistribution,
    });
  } catch (error: any) {
    console.error("Error al obtener detalle por pregunta:", error);
    res.status(500).json({ error: error.message || "Error al obtener detalle por pregunta" });
  }
});

export default router;
