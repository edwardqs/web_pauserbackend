import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getCurrentPeriod, isQuestionAvailableToday } from "../utils/frequency.ts";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

const router = Router();

router.get("/campaigns/active", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
      orderBy: { startDate: "desc" },
    });
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener campaña" });
  }
});

// Endpoint para guardar drafts temporalmente
router.post("/upload", authMiddleware, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se subió archivo" });
    }
    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ fileUrl });
  } catch (error) {
    console.error("Error al subir archivo:", error);
    res.status(500).json({ error: "Error al subir archivo" });
  }
});

router.post("/submit", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { campaignId, answers, source = "EXCELENCIA" } = req.body;
    const userId = req.user!.id;

    console.log("DEBUG submit - userId:", userId, "campaignId:", campaignId, "source:", source);
    console.log("DEBUG submit - answers:", JSON.stringify(answers).slice(0, 500));

    if (!userId) {
      return res.status(401).json({ error: "Usuario no autenticado correctamente" });
    }

    if (!campaignId) {
      return res.status(400).json({ error: "Falta campaignId" });
    }

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: "Answers debe ser un array" });
    }

    if (!["EXCELENCIA", "MIS_PROGRAMAS"].includes(source)) {
      return res.status(400).json({ error: "Source debe ser EXCELENCIA o MIS_PROGRAMAS" });
    }

    // Verify campaign exists
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      return res.status(400).json({ error: "Campaña no encontrada" });
    }

    // Get all questions for this user's cargo
    const userCargoId = req.user!.cargoId;
    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: {
        cargos: true,
        options: true,
      },
    });

    const relevantQuestions = allQuestions.filter((q) => {
      if (q.cargos.length === 0) return false;
      return q.cargos.some((qc) => qc.cargoId === userCargoId);
    });

    // Get or create evaluation (now includes source)
    let evaluation = await prisma.evaluation.findUnique({
      where: { userId_campaignId_source: { userId, campaignId, source } },
      include: { answers: { include: { files: true } } },
    });

    const now = new Date();

    if (!evaluation) {
      // First submission - create evaluation
      let totalScore = 0;
      const answersData = answers
        .filter((a: any) => a?.questionId)
        .map((a: any) => {
          const hasFiles = a.files && Array.isArray(a.files) && a.files.length > 0;
          const validFiles = hasFiles ? a.files.filter((f: any) => f && f.fileUrl) : [];
          const question = relevantQuestions.find((q) => q.id === a.questionId);
          
          // Get selected option and calculate score
          const selectedOptionId = a.optionId ? parseInt(a.optionId) : null;
          let awardedScore = 0;
          
          if (selectedOptionId && question) {
            // Find the option and get its score
            const option = (question as any).options?.find((opt: any) => opt.id === selectedOptionId);
            if (option) {
              awardedScore = option.score || 0;
            }
          }
          
          totalScore += awardedScore;

          return {
            questionId: a.questionId,
            optionId: selectedOptionId,
            awardedScore,
            hasEvidence: validFiles.length > 0,
            files: validFiles.length > 0
              ? {
                  create: validFiles.map((f: any) => ({
                    fileType: String(f.fileType || ""),
                    fileName: String(f.fileName || ""),
                    fileUrl: String(f.fileUrl || ""),
                  })),
                }
              : undefined,
          };
        });

      const maxScore = relevantQuestions.reduce((sum, q) => {
        // Get max score from options, fallback to 0 if no options
        const maxOptionScore = (q as any).options?.length > 0 
          ? Math.max(...(q as any).options.map((opt: any) => opt.score || 0))
          : 0;
        return sum + maxOptionScore;
      }, 0);

      evaluation = await prisma.evaluation.create({
        data: {
          userId,
          campaignId,
          source,
          totalScore,
          maxScore,
          completedAt: new Date(),
          answers: {
            createMany: {
              data: answersData
                .filter((a: any) => a.questionId)
                .map((a: any) => ({
                  questionId: a.questionId,
                  optionId: a.optionId,
                  awardedScore: a.awardedScore,
                  hasEvidence: a.hasEvidence,
                }))
            }
          },
        },
        include: { answers: { include: { files: true } } },
      });

      // Create files separately for each answer
      for (const a of answersData) {
        if (a.files && a.files.create) {
          const answer = await prisma.answer.findFirst({
            where: { evaluationId: evaluation.id, questionId: a.questionId },
          });
          if (answer) {
            await prisma.answerFile.createMany({
              data: a.files.create.map((f: any) => ({
                answerId: answer.id,
                fileType: f.fileType,
                fileName: f.fileName,
                fileUrl: f.fileUrl,
              })),
            });
          }
        }
      }

      // Register submissions for frequency tracking
      for (const a of answersData) {
        const question = relevantQuestions.find((q) => q.id === a.questionId);
        if (!question) continue;

        const { periodStart, periodEnd } = getCurrentPeriod(
          question.frequencyType,
          question.frequencyDay,
          question.frequencyInterval,
          now
        );

        await prisma.questionSubmission.upsert({
          where: {
            questionId_userId_campaignId_periodStart: {
              questionId: a.questionId,
              userId,
              campaignId,
              periodStart,
            },
          },
          create: {
            questionId: a.questionId,
            userId,
            campaignId,
            submissionDate: now,
            periodStart,
            periodEnd,
          },
          update: {
            submissionDate: now,
            periodEnd,
          },
        });
      }
    } else {
      // Evaluation exists - check for new frequent questions
      const existingAnswerIds = evaluation.answers.map((a) => a.questionId);
      const newAnswers = answers.filter(
        (a: any) => a?.questionId && !existingAnswerIds.includes(a.questionId)
      );

      if (newAnswers.length === 0) {
        return res.status(400).json({ error: "Ya completaste esta evaluación. No hay nuevas preguntas pendientes." });
      }

      // Add new answers and update score
      let additionalScore = 0;
      for (const a of newAnswers) {
        const hasFiles = a.files && Array.isArray(a.files) && a.files.length > 0;
        const validFiles = hasFiles ? a.files.filter((f: any) => f && f.fileUrl) : [];
        const question = relevantQuestions.find((q) => q.id === a.questionId);
        
        // Get selected option and calculate score
        const selectedOptionId = a.optionId ? parseInt(a.optionId) : null;
        let awardedScore = 0;
        
        if (selectedOptionId && question) {
          const option = (question as any).options?.find((opt: any) => opt.id === selectedOptionId);
          if (option) {
            awardedScore = option.score || 0;
          }
        }
        
        additionalScore += awardedScore;

        const answer = await prisma.answer.create({
          data: {
            evaluationId: evaluation.id,
            questionId: a.questionId,
            optionId: selectedOptionId,
            awardedScore,
            hasEvidence: validFiles.length > 0,
            files: validFiles.length > 0
              ? {
                  create: validFiles.map((f: any) => ({
                    fileType: String(f.fileType || ""),
                    fileName: String(f.fileName || ""),
                    fileUrl: String(f.fileUrl || ""),
                  })),
                }
              : undefined,
          },
        });

        // Register submission
        if (question) {
          const { periodStart, periodEnd } = getCurrentPeriod(
            question.frequencyType,
            question.frequencyDay,
            question.frequencyInterval,
            now
          );

          await prisma.questionSubmission.upsert({
            where: {
              questionId_userId_campaignId_periodStart: {
                questionId: a.questionId,
                userId,
                campaignId,
                periodStart,
              },
            },
            create: {
              questionId: a.questionId,
              userId,
              campaignId,
              submissionDate: now,
              periodStart,
              periodEnd,
            },
            update: {
              submissionDate: now,
              periodEnd,
            },
          });
        }
      }

      // Update evaluation score
      evaluation = await prisma.evaluation.update({
        where: { id: evaluation.id },
        data: {
          totalScore: evaluation.totalScore + additionalScore,
          completedAt: new Date(),
        },
        include: { answers: { include: { files: true } } },
      });
    }

    res.json(evaluation);
  } catch (error: any) {
    console.error("Error al enviar evaluación:", error);
    res.status(500).json({ error: error.message || "Error al enviar evaluación" });
  }
});

router.get("/results", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver resultados" });
    }

    const evaluations = await prisma.evaluation.findMany({
      where: { completedAt: { not: null } },
      include: {
        user: { select: { id: true, name: true, email: true, cargoId: true } },
        campaign: { select: { id: true, name: true } },
        answers: { include: { files: true } },
      },
      orderBy: { totalScore: "desc" },
    });

    // Fetch all active questions with their cargo assignments and options
    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: { 
        cargos: true,
        options: true,
      },
    });

    // Fetch all submissions for recalculating scores
    const allSubmissions = await prisma.questionSubmission.findMany({});

    // Recalculate maxScore and totalScore dynamically based on current questions
    const results = evaluations.map((evaluation: any) => {
      const userCargoId = evaluation.user.cargoId;

      // Get questions that apply to this user's cargo
      const relevantQuestions = allQuestions.filter((q) => {
        if (q.cargos.length === 0) return false;
        return q.cargos.some((qc) => qc.cargoId === userCargoId);
      });

      // Calculate maxScore based on current questions and their max option scores
      const currentMaxScore = relevantQuestions.reduce((sum, q) => {
        const maxOptionScore = (q as any).options?.length > 0 
          ? Math.max(...(q as any).options.map((opt: any) => opt.score || 0))
          : 0;
        return sum + maxOptionScore;
      }, 0);

      // Recalculate totalScore: for frequent questions, use latest submission's score
      const userSubmissions = allSubmissions.filter(
        (s) => s.userId === evaluation.userId && s.campaignId === evaluation.campaignId
      );

      let currentTotalScore = 0;
      for (const q of relevantQuestions) {
        // Check if question has submissions (frequent) or just answers (unique)
        const questionSubmissions = userSubmissions.filter((s) => s.questionId === q.id);

        if (questionSubmissions.length > 0 && q.frequencyType !== "UNICA") {
          // For frequent questions, find the latest submission's score
          const answer = evaluation.answers.find((a: any) => a.questionId === q.id);
          if (answer) {
            currentTotalScore += answer.awardedScore || 0;
          }
        } else {
          // For unique questions, check if answered and get score
          const answer = evaluation.answers.find((a: any) => a.questionId === q.id);
          if (answer) {
            currentTotalScore += answer.awardedScore || 0;
          }
        }
      }

      const percentage = currentMaxScore > 0 ? Math.round((currentTotalScore / currentMaxScore) * 100) : 0;

      return {
        ...evaluation,
        totalScore: currentTotalScore,
        maxScore: currentMaxScore,
        percentage,
      };
    });

    // Sort by recalculated totalScore
    results.sort((a, b) => b.totalScore - a.totalScore);

    res.json(results);
  } catch (error) {
    console.error("Error al obtener resultados:", error);
    res.status(500).json({ error: "Error al obtener resultados" });
  }
});

// GET /api/evaluations/progress - Ver progreso de usuarios (admin)
router.get("/progress", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver avances" });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
      orderBy: { startDate: "desc" },
    });

    if (!campaign) {
      return res.json({ campaign: null, progress: [] });
    }

    const assignedUsers = await prisma.campaignUser.findMany({
      where: { campaignId: campaign.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, cargoId: true, cargo: { select: { name: true } } },
        },
      },
    });

    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: { configs: true, cargos: true },
    });

    // Fetch all submissions for this campaign in one query
    const allSubmissions = await prisma.questionSubmission.findMany({
      where: { campaignId: campaign.id },
    });

    console.log("DEBUG /progress - campaign:", campaign.id, "startDate:", campaign.startDate);
    console.log("DEBUG /progress - assignedUsers:", assignedUsers.length, "submissions:", allSubmissions.length);
    console.log("DEBUG /progress - questions:", allQuestions.length, "active");

    const progress = await Promise.all(
      assignedUsers.map(async (au) => {
        const userCargoId = au.user.cargoId;

        console.log(`DEBUG /progress - user ${au.userId}: cargoId=${userCargoId}`);

        // Solo contar preguntas que tienen cargo(s) asignados Y coinciden con el cargo del usuario
        const relevantQuestions = allQuestions.filter((q) => {
          if (q.cargos.length === 0) return false;
          return q.cargos.some((qc) => qc.cargoId === userCargoId);
        });

        console.log(`DEBUG /progress - user ${au.userId}: relevantQuestions=${relevantQuestions.length}`);

        // Calculate expected instances based on frequency
        const now = new Date();
        let totalExpectedInstances = 0;

        for (const q of relevantQuestions) {
          const freqType = q.frequencyType || "UNICA";
          if (freqType === "UNICA") {
            totalExpectedInstances += 1;
          } else {
            const questionStartDate = new Date(q.createdAt);
            const msInDay = 24 * 60 * 60 * 1000;

            if (freqType === "DIARIA") {
              const daysElapsed = Math.max(1, Math.floor((now.getTime() - questionStartDate.getTime()) / msInDay));
              totalExpectedInstances += daysElapsed;
            } else if (freqType === "SEMANAL") {
              const interval = q.frequencyInterval || 1;
              const weeksElapsed = Math.max(1, Math.floor((now.getTime() - questionStartDate.getTime()) / (7 * msInDay)));
              totalExpectedInstances += Math.ceil(weeksElapsed / interval);
            } else if (freqType === "MENSUAL") {
              const interval = q.frequencyInterval || 1;
              const monthsElapsed = Math.max(1, (now.getFullYear() - questionStartDate.getFullYear()) * 12 + now.getMonth() - questionStartDate.getMonth());
              totalExpectedInstances += Math.ceil(monthsElapsed / interval);
            } else {
              totalExpectedInstances += 1; // Fallback
            }
          }
        }

        console.log(`DEBUG /progress - user ${au.userId}: totalExpectedInstances=${totalExpectedInstances}`);

        // Get user's submissions
        const userSubmissions = allSubmissions.filter(
          (s) => s.userId === au.userId && s.campaignId === campaign.id
        );

        // Fetch the user's evaluations (both sources)
        const evaluations = await prisma.evaluation.findMany({
          where: { userId: au.userId, campaignId: campaign.id },
          include: { answers: { include: { files: true } } },
        });

        // Merge answers from both sources
        const mergedAnswers = evaluations.flatMap(e => e.answers);

        let totalAnsweredInstances = 0;
        if (mergedAnswers.length > 0) {
          const answeredQuestionIds = mergedAnswers
            .filter((a) => a.files && a.files.length > 0)
            .map((a) => a.questionId);

          console.log(`DEBUG /progress - user ${au.userId}: evaluation exists, answeredQuestionIds=${answeredQuestionIds.length}`);

          for (const q of relevantQuestions) {
            const isAnswered = answeredQuestionIds.includes(q.id);
            const freqType = q.frequencyType || "UNICA";

            if (freqType === "UNICA") {
              if (isAnswered) totalAnsweredInstances += 1;
            } else {
              const submissionCount = userSubmissions.filter((s) => s.questionId === q.id).length;
              if (submissionCount > 0) {
                const msInDay = 24 * 60 * 60 * 1000;
                const periodsForThisQuestion = Math.max(1, Math.floor((now.getTime() - new Date(q.createdAt).getTime()) / msInDay));
                totalAnsweredInstances += Math.min(submissionCount, periodsForThisQuestion);
              } else if (isAnswered) {
                // Legacy: answered but no submission record, count as 1
                totalAnsweredInstances += 1;
              }
            }
          }
        }

        console.log(`DEBUG /progress - user ${au.userId}: totalAnsweredInstances=${totalAnsweredInstances}`);

        const percentage = totalExpectedInstances > 0 ? Math.round((totalAnsweredInstances / totalExpectedInstances) * 100) : 0;
        const isFullyCompleted = totalAnsweredInstances >= totalExpectedInstances;

        return {
          userId: au.user.id,
          userName: au.user.name || au.user.email,
          cargo: au.user.cargo?.name || "-",
          totalQuestions: totalExpectedInstances,
          answered: totalAnsweredInstances,
          percentage,
          hasEvaluation: evaluations.length > 0,
          completedAt: isFullyCompleted && evaluations.length > 0 ? evaluations[0].completedAt : null,
        };
      })
    );

    res.json({ campaign, progress });
  } catch (error) {
    console.error("Error al obtener progreso:", error);
    res.status(500).json({ error: "Error al obtener progreso" });
  }
});

router.get("/my-result", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const userCargoId = req.user!.cargoId;
    const { source = "EXCELENCIA" } = req.query;

    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
    });

    if (!campaign) {
      return res.json({ evaluation: null, message: "No hay campaña activa" });
    }

    const evaluation = await prisma.evaluation.findUnique({
      where: { userId_campaignId_source: { userId, campaignId: campaign.id, source: source as string } },
      include: {
        answers: {
          include: {
            question: {
              include: {
                configs: true,
                options: { orderBy: { label: "asc" } },
              }
            },
            option: true,
            files: true,
          },
        },
      },
    });

    if (!evaluation) {
      return res.json({ evaluation: null, campaign });
    }

    // Recalculate scores based on current questions
    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: { 
        cargos: true,
        options: true,
      },
    });

    const relevantQuestions = allQuestions.filter((q) => {
      if (q.cargos.length === 0) return false;
      return q.cargos.some((qc) => qc.cargoId === userCargoId);
    });

    const currentMaxScore = relevantQuestions.reduce((sum, q) => {
      const maxOptionScore = (q as any).options?.length > 0 
        ? Math.max(...(q as any).options.map((opt: any) => opt.score || 0))
        : 0;
      return sum + maxOptionScore;
    }, 0);

    // Get submissions for this user
    const submissions = await prisma.questionSubmission.findMany({
      where: { userId, campaignId: campaign.id },
    });

    let currentTotalScore = 0;
    for (const q of relevantQuestions) {
      const questionSubmissions = submissions.filter((s) => s.questionId === q.id);

      if (questionSubmissions.length > 0 && q.frequencyType !== "UNICA") {
        // For frequent questions, check the answer's awarded score
        const answer = evaluation.answers.find((a) => a.questionId === q.id);
        if (answer) {
          currentTotalScore += answer.awardedScore || 0;
        }
      } else {
        // For unique questions, check the answer's awarded score
        const answer = evaluation.answers.find((a) => a.questionId === q.id);
        if (answer) {
          currentTotalScore += answer.awardedScore || 0;
        }
      }
    }

    const updatedEvaluation = {
      ...evaluation,
      totalScore: currentTotalScore,
      maxScore: currentMaxScore,
    };

    res.json({ evaluation: updatedEvaluation, campaign });
  } catch (error) {
    console.error("Error al obtener resultado:", error);
    res.status(500).json({ error: "Error al obtener resultado" });
  }
});

// ==================== EVALUACIONES - LISTAR TODAS ====================
router.get("/all", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver todas las evaluaciones" });
    }

    const { source, programId, userId, campaignId } = req.query;

    const where: any = {};
    if (source) where.source = source as string;
    if (programId) where.programId = parseInt(programId as string);
    if (userId) where.userId = parseInt(userId as string);
    if (campaignId) where.campaignId = parseInt(campaignId as string);

    const evaluations = await prisma.evaluation.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, cargo: { select: { name: true } } } },
        campaign: { select: { id: true, name: true } },
        program: { select: { id: true, name: true } },
        answers: { select: { id: true, questionId: true, awardedScore: true, adminScore: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = evaluations.map((ev) => {
      const autoScore = ev.answers.reduce((sum, a) => sum + (a.awardedScore || 0), 0);
      const adminScore = ev.answers.reduce((sum, a) => sum + (a.adminScore || 0), 0);
      const reviewedCount = ev.answers.filter((a) => a.adminScore !== null).length;
      
      return {
        ...ev,
        autoScore,
        adminScore: adminScore > 0 ? adminScore : null,
        reviewedCount,
        totalAnswers: ev.answers.length,
        isComplete: ev.completedAt !== null,
      };
    });

    res.json(result);
  } catch (error) {
    console.error("Error al listar evaluaciones:", error);
    res.status(500).json({ error: "Error al listar evaluaciones" });
  }
});

// ==================== EVALUACIONES - DETALLE COMPLETO ====================
router.get("/:id/details", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver detalles" });
    }

    const evaluationId = parseInt(req.params.id);

    const evaluation = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      include: {
        user: { include: { cargo: true, sede: true } },
        campaign: true,
        program: true,
        answers: {
          include: {
            question: { include: { options: true } },
            option: true,
            files: true,
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { question: { order: "asc" } },
        },
      },
    });

    if (!evaluation) {
      return res.status(404).json({ error: "Evaluación no encontrada" });
    }

    // Calculate totals
    const autoScore = evaluation.answers.reduce((sum, a) => sum + (a.awardedScore || 0), 0);
    const adminScore = evaluation.answers.reduce((sum, a) => sum + (a.adminScore || 0), 0);

    res.json({
      ...evaluation,
      autoScore,
      adminScore,
    });
  } catch (error) {
    console.error("Error al obtener detalles:", error);
    res.status(500).json({ error: "Error al obtener detalles" });
  }
});

// ==================== EVALUACIONES - HISTORIAL POR USUARIO ====================
router.get("/user/:userId/history", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1 && req.user?.id !== parseInt(req.params.userId)) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    const userId = parseInt(req.params.userId);

    const evaluations = await prisma.evaluation.findMany({
      where: { userId },
      include: {
        campaign: true,
        program: true,
        answers: {
          include: {
            question: { select: { id: true, text: true, frequencyType: true, points: true } },
            reviewedBy: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(evaluations);
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// ==================== EVALUACIONES - REVISAR RESPUESTA ====================
router.put("/answer/:answerId/review", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden calificar" });
    }

    const answerId = parseInt(req.params.answerId);
    const { adminScore, adminComment } = req.body;

    const answer = await prisma.answer.update({
      where: { id: answerId },
      data: {
        adminScore: adminScore ?? null,
        adminComment: adminComment ?? null,
        adminReviewedAt: new Date(),
        reviewedById: req.user.id,
      },
      include: {
        question: true,
        evaluation: { include: { answers: true } },
      },
    });

    // Recalculate total admin score for evaluation
    const evaluation = answer.evaluation;
    const totalAdminScore = evaluation.answers.reduce((sum, a) => {
      if (a.id === answerId) return sum + (adminScore || 0);
      return sum + (a.adminScore || 0);
    }, 0);

    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: { totalScore: totalAdminScore },
    });

    res.json({ message: "Calificación guardada", answer, totalAdminScore });
  } catch (error) {
    console.error("Error al calificar:", error);
    res.status(500).json({ error: "Error al calificar" });
  }
});

// ==================== EVALUACIONES - USUARIOS EN PROGRAMA ====================
router.get("/program/:programId/users", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins" });
    }

    const programId = parseInt(req.params.programId);

    // Get users assigned to this program
    const userPrograms = await prisma.userProgram.findMany({
      where: { programId },
      include: {
        user: { include: { cargo: true } },
      },
    });

    // Get evaluations for these users with this program
    const userIds = userPrograms.map((up) => up.userId);
    
    const evaluations = await prisma.evaluation.findMany({
      where: {
        userId: { in: userIds },
        programId,
      },
      include: {
        user: { select: { id: true, name: true, email: true, cargo: { select: { name: true } } } },
        answers: { select: { id: true, questionId: true, awardedScore: true, adminScore: true } },
      },
    });

    const result = userPrograms.map((up) => {
      const evalData = evaluations.find((e) => e.userId === up.user.id);
      const autoScore = evalData?.answers.reduce((sum, a) => sum + (a.awardedScore || 0), 0) || 0;
      const adminScore = evalData?.answers.reduce((sum, a) => sum + (a.adminScore || 0), 0) || 0;

      return {
        user: up.user,
        evaluation: evalData || null,
        autoScore,
        adminScore,
        hasEvaluation: !!evalData,
      };
    });

    res.json(result);
  } catch (error) {
    console.error("Error al obtener usuarios del programa:", error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

export default router;