import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getCurrentPeriod, isQuestionAvailableToday, parseId } from "../utils/frequency.ts";
import { calcDeadline } from "../utils/deadline.ts";
import { matchesTrigger } from "../utils/flowHelpers.ts";

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
    const { campaignId, answers, source = "EXCELENCIA", programId } = req.body;
    const userId = req.user!.id;

    console.log("DEBUG submit - userId:", userId, "campaignId:", campaignId, "source:", source, "programId:", programId);
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
        selectors: { include: { options: true } },
      },
    });

    const relevantQuestions = allQuestions.filter((q) => {
      if (q.cargos.length === 0) return false;
      return q.cargos.some((qc) => qc.cargoId === userCargoId);
    });

    // Get or create evaluation (now includes source and programId for MIS_PROGRAMAS)
    let evaluation;
    if (source === "MIS_PROGRAMAS" && programId) {
      // For MIS_PROGRAMAS, search by programId
      evaluation = await prisma.evaluation.findFirst({
        where: { userId, campaignId, source, programId },
        include: { answers: { include: { files: true } } },
      });
    } else {
      // For EXCELENCIA, use unique constraint (4 fields: userId, campaignId, source, programId)
      evaluation = await prisma.evaluation.findUnique({
        where: { userId_campaignId_source_programId: { userId, campaignId, source, programId: null } },
        include: { answers: { include: { files: true } } },
      });
    }

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
            const option = (question as any).options?.find((opt: any) => opt.id === selectedOptionId);
            if (option) {
              awardedScore = option.score || 0;
            }
          }

          // Calculate current period based on frequency
          const { periodStart, periodEnd } = getCurrentPeriod(
            question?.frequencyType || "UNICA",
            question?.frequencyDay || null,
            question?.frequencyInterval || null
          );

          totalScore += awardedScore;

          return {
            questionId: a.questionId,
            optionId: selectedOptionId,
            optionIds: Array.isArray(a.optionIds) ? a.optionIds.map(Number).filter((n: number) => !isNaN(n)) : [],
            detailText: a.detailText || null,
            awardedScore,
            hasEvidence: validFiles.length > 0,
            periodStart,
            periodEnd,
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
          programId: source === "MIS_PROGRAMAS" && programId ? programId : null,
          totalScore,
          maxScore,
          completedAt: new Date(),
          answers: {
            create: answersData,
          },
        },
        include: { answers: { include: { files: true } } },
      });

      // Create files separately for each answer
      for (let i = 0; i < answersData.length; i++) {
        const a = answersData[i];
        if (a.files && a.files.create) {
          const answer = await prisma.answer.findFirst({
            where: { evaluationId: evaluation.id, questionId: a.questionId, periodStart: a.periodStart },
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

        // Create selector responses
        const originalAnswer = answers.find((oa: any) => oa.questionId === a.questionId);
        if (originalAnswer?.selectorResponses && typeof originalAnswer.selectorResponses === 'object') {
          const answer = await prisma.answer.findFirst({
            where: { evaluationId: evaluation.id, questionId: a.questionId, periodStart: a.periodStart },
          });
          if (answer) {
            for (const [selectorIdStr, optionIds] of Object.entries(originalAnswer.selectorResponses)) {
              const selectorId = parseInt(selectorIdStr);
              if (!isNaN(selectorId) && Array.isArray(optionIds)) {
                await prisma.evaluationAnswerSelector.upsert({
                  where: {
                    answerId_selectorId: { answerId: answer.id, selectorId }
                  },
                  create: {
                    answerId: answer.id,
                    selectorId,
                    selectedOptionIds: optionIds.map(Number).filter((n: number) => !isNaN(n)),
                  },
                  update: {
                    selectedOptionIds: optionIds.map(Number).filter((n: number) => !isNaN(n)),
                  },
                });
              }
            }
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
          },
        });
      }

      // ================= DELEGATION LOGIC =================
      const allAnswersUpdated1 = await prisma.answer.findMany({
        where: { evaluationId: evaluation.id },
        include: { question: { include: { options: true, selectors: { include: { options: true } } } }, selectorResponses: true }
      });

for (const ans of allAnswersUpdated1) {
        if (!ans.periodStart) continue;

        const flowConfig = await prisma.questionFlowConfig.findUnique({
          where: { questionId: ans.questionId },
          include: { triggers: { orderBy: { id: 'asc' } } }
        });

        if (flowConfig && flowConfig.isActive && flowConfig.requiresDelegation && flowConfig.triggers.length > 0) {
          const selectedScore = ans.awardedScore || 0;
          let firedTrigger = null;

          const ansOption = (ans.question as any).options?.find((o: any) => o.id === ans.optionId);
          const selectorResponsesMap: { [selectorId: number]: number[] } = {};
          const selectorSemanticKeysMap: { [selectorId: number]: string[] } = {};

          const questionSelectors = (ans.question as any).selectors ?? [];
          const optionSemanticById = new Map<number, string>();
          for (const sel of questionSelectors) {
            for (const opt of sel.options ?? []) {
              if (opt.semanticKey) optionSemanticById.set(opt.id, opt.semanticKey);
            }
          }

          if ((ans as any).selectorResponses) {
            for (const sr of (ans as any).selectorResponses) {
              selectorResponsesMap[sr.selectorId] = sr.selectedOptionIds || [];
              selectorSemanticKeysMap[sr.selectorId] = (sr.selectedOptionIds || [])
                .map((id: number) => optionSemanticById.get(id))
                .filter((k: string | undefined): k is string => !!k);
            }
          }
          const answerForTrigger = {
            optionId: ans.optionId,
            optionIds: (ans as any).optionIds || [],
            awardedScore: selectedScore,
            optionSemanticKey: ansOption?.semanticKey || null,
            selectorResponses: selectorResponsesMap,
            selectorSemanticKeys: selectorSemanticKeysMap,
          };

          for (const trigger of flowConfig.triggers) {
            if (matchesTrigger(trigger as any, answerForTrigger)) {
              firedTrigger = trigger;
              break;
            }
          }

          if (firedTrigger) {
            const deadlineAt = calcDeadline(ans.periodStart, flowConfig.deadlineOffsetDays, flowConfig.deadlineBusinessDays);
            
            await prisma.answerDelegation.upsert({
              where: { answerId: ans.id },
              create: {
                answerId: ans.id,
                triggerId: firedTrigger.id,
                deadlineAt,
                status: "PENDIENTE"
              },
              update: {
                triggerId: firedTrigger.id,
                deadlineAt,
                status: "PENDIENTE",
                completedAt: null,
                completedByUserId: null
              }
            });
          }
        }
      }
      // ===================================================

      res.json(evaluation);
      return;
    } else {
      // Evaluation exists - handle both new questions AND re-submissions for frequency
      const now = new Date();
      let scoreDelta = 0;

      // Process each answer: upsert by [evaluationId, questionId, periodStart]
      for (const a of answers) {
        if (!a?.questionId) continue;

        const hasFiles = a.files && Array.isArray(a.files) && a.files.length > 0;
        const validFiles = hasFiles ? a.files.filter((f: any) => f && f.fileUrl) : [];
        const question = relevantQuestions.find((q) => q.id === a.questionId);

        const selectedOptionId = a.optionId ? parseInt(a.optionId) : null;
        let awardedScore = 0;

        if (selectedOptionId && question) {
          const option = (question as any).options?.find((opt: any) => opt.id === selectedOptionId);
          if (option) {
            awardedScore = option.score || 0;
          }
        }

        // Calculate current period
        const { periodStart, periodEnd } = getCurrentPeriod(
          question?.frequencyType || "UNICA",
          question?.frequencyDay || null,
          question?.frequencyInterval || null,
          now
        );

        const parsedOptionIds = Array.isArray(a.optionIds) ? a.optionIds.map(Number).filter((n: number) => !isNaN(n)) : [];
        const parsedDetailText = a.detailText || null;

        // Check if answer exists for this question AND period
        const existingAnswer = await prisma.answer.findFirst({
          where: {
            evaluationId: evaluation.id,
            questionId: a.questionId,
            periodStart: periodStart,
          },
        });

        if (existingAnswer) {
          // Update existing answer (re-submission in same period)
          const oldScore = existingAnswer.awardedScore || 0;
          await prisma.answer.update({
            where: { id: existingAnswer.id },
            data: {
              optionId: selectedOptionId,
              optionIds: parsedOptionIds,
              detailText: parsedDetailText,
              awardedScore,
              hasEvidence: validFiles.length > 0,
            },
          });
          scoreDelta += (awardedScore - oldScore);
        } else {
          await prisma.answer.create({
            data: {
              evaluationId: evaluation.id,
              questionId: a.questionId,
              optionId: selectedOptionId,
              optionIds: parsedOptionIds,
              detailText: parsedDetailText,
              awardedScore,
              hasEvidence: validFiles.length > 0,
              periodStart,
              periodEnd,
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
          scoreDelta += awardedScore;
        }

        // Register submission for frequency tracking
        if (question) {
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

      // Update total score
      const allAnswers = await prisma.answer.findMany({
        where: { evaluationId: evaluation.id },
      });
      const newTotalScore = allAnswers.reduce((sum, a) => sum + (a.awardedScore || 0), 0);

      evaluation = await prisma.evaluation.update({
        where: { id: evaluation.id },
        data: {
          totalScore: newTotalScore,
          completedAt: now,
        },
        include: { answers: { include: { files: true } } },
      });

      // ================= DELEGATION LOGIC =================
      const allAnswersUpdated2 = await prisma.answer.findMany({
        where: { evaluationId: evaluation.id },
        include: { question: { include: { options: true, selectors: { include: { options: true } } } }, selectorResponses: true }
      });

      for (const ans of allAnswersUpdated2) {
        if (!ans.periodStart) continue;

        const flowConfig = await prisma.questionFlowConfig.findUnique({
          where: { questionId: ans.questionId },
          include: { triggers: { orderBy: { id: 'asc' } } }
        });

        if (flowConfig && flowConfig.isActive && flowConfig.requiresDelegation && flowConfig.triggers.length > 0) {
          const selectedScore = ans.awardedScore || 0;
          let firedTrigger = null;

          const ansOption = (ans.question as any).options?.find((o: any) => o.id === ans.optionId);
          const selectorResponsesMap: { [selectorId: number]: number[] } = {};
          const selectorSemanticKeysMap: { [selectorId: number]: string[] } = {};

          const questionSelectors = (ans.question as any).selectors ?? [];
          const optionSemanticById = new Map<number, string>();
          for (const sel of questionSelectors) {
            for (const opt of sel.options ?? []) {
              if (opt.semanticKey) optionSemanticById.set(opt.id, opt.semanticKey);
            }
          }

          if ((ans as any).selectorResponses) {
            for (const sr of (ans as any).selectorResponses) {
              selectorResponsesMap[sr.selectorId] = sr.selectedOptionIds || [];
              selectorSemanticKeysMap[sr.selectorId] = (sr.selectedOptionIds || [])
                .map((id: number) => optionSemanticById.get(id))
                .filter((k: string | undefined): k is string => !!k);
            }
          }
          const answerForTrigger = {
            optionId: ans.optionId,
            optionIds: (ans as any).optionIds || [],
            awardedScore: selectedScore,
            optionSemanticKey: ansOption?.semanticKey || null,
            selectorResponses: selectorResponsesMap,
            selectorSemanticKeys: selectorSemanticKeysMap,
          };

          for (const trigger of flowConfig.triggers) {
            if (matchesTrigger(trigger as any, answerForTrigger)) {
              firedTrigger = trigger;
              break;
            }
          }

          if (firedTrigger) {
            const deadlineAt = calcDeadline(ans.periodStart, flowConfig.deadlineOffsetDays, flowConfig.deadlineBusinessDays);
            
            await prisma.answerDelegation.upsert({
              where: { answerId: ans.id },
              create: {
                answerId: ans.id,
                triggerId: firedTrigger.id,
                deadlineAt,
                status: "PENDIENTE"
              },
              update: {
                triggerId: firedTrigger.id,
                deadlineAt,
                status: "PENDIENTE",
                completedAt: null,
                completedByUserId: null
              }
            });
          }
        }
      }
      // ===================================================

      res.json(evaluation);
      return;
    }
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
    const { source = "EXCELENCIA", programId } = req.query;

    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
    });

    if (!campaign) {
      return res.json({ evaluation: null, message: "No hay campaña activa" });
    }

    // For MIS_PROGRAMAS with programId, search by program
    let evaluation;
    if (source === "MIS_PROGRAMAS" && programId) {
      evaluation = await prisma.evaluation.findFirst({
        where: { 
          userId, 
          campaignId: campaign.id, 
          source: source as string,
          programId: parseInt(programId as string),
        },
        include: {
          answers: {
            include: {
              question: {
                include: {
                  configs: true,
                  options: { orderBy: { label: "asc" } },
                  selectors: { include: { options: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
                }
              },
              option: true,
              files: true,
              selectorResponses: true,
            },
          },
        },
      });
    } else {
      // For EXCELENCIA: use 4-field unique constraint
      evaluation = await prisma.evaluation.findUnique({
        where: { userId_campaignId_source_programId: { userId, campaignId: campaign.id, source: source as string, programId: null } },
        include: {
          answers: {
            include: {
              question: {
                include: {
                  configs: true,
                  options: { orderBy: { label: "asc" } },
                  selectors: { include: { options: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
                }
              },
              option: true,
              files: true,
              selectorResponses: true,
            },
          },
        },
      });
    }

    if (!evaluation) {
      return res.json({ evaluation: null, campaign });
    }

    // Recalculate scores based on current questions
    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: { 
        cargos: true,
        options: true,
        selectors: true,
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

// ==================== CALIFICACIÓN FINAL ADMIN ====================
router.put("/:id/publish-result", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden calificar evaluaciones" });
    }

    const { id } = req.params;
    const { adminFinalScore, adminFinalComment } = req.body;

    if (adminFinalScore === undefined) {
      return res.status(400).json({ error: "El puntaje final es requerido" });
    }

    const evaluation = await prisma.evaluation.update({
      where: { id: parseId(id) },
      data: {
        adminFinalScore: parseInt(adminFinalScore),
        adminFinalComment: adminFinalComment || null,
        adminPublishedAt: new Date(),
      },
      include: {
        user: { select: { name: true, email: true } },
      }
    });

    res.json(evaluation);
  } catch (error) {
    console.error("Error al publicar resultado final:", error);
    res.status(500).json({ error: "Error al publicar resultado" });
  }
});

// ==================== EVALUACIONES - HISTORIAL POR PERÍODO (USUARIO) ====================
router.get("/my-history", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const userCargoId = req.user!.cargoId;
    const { source = "EXCELENCIA", programId } = req.query;

    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
    });

    if (!campaign) {
      return res.json({ evaluations: [], message: "No hay campaña activa" });
    }

// For MIS_PROGRAMAS with programId, search by program
    let evaluation;
    if (source === "MIS_PROGRAMAS" && programId) {
      evaluation = await prisma.evaluation.findFirst({
        where: { 
          userId, 
          campaignId: campaign.id, 
          source: source as string,
          programId: parseInt(programId as string),
        },
        include: {
          answers: {
            include: {
              question: { include: { options: true } },
              option: true,
              files: true,
              reviewedBy: { select: { id: true, name: true } },
            },
            orderBy: [{ questionId: "asc" }, { periodStart: "asc" }],
          },
        },
      });
    } else {
      // For EXCELENCIA: use 4-field unique constraint
      evaluation = await prisma.evaluation.findUnique({
        where: { userId_campaignId_source_programId: { userId, campaignId: campaign.id, source: source as string, programId: null } },
        include: {
          answers: {
            include: {
              question: { include: { options: true } },
              option: true,
              files: true,
              reviewedBy: { select: { id: true, name: true } },
            },
            orderBy: [{ questionId: "asc" }, { periodStart: "asc" }],
          },
        },
      });
    }

    if (!evaluation) {
      return res.json({ evaluations: [], campaign });
    }

    // Group answers by question
    const questionsMap = new Map();
    for (const answer of evaluation.answers) {
      const qId = answer.questionId;
      if (!questionsMap.has(qId)) {
        questionsMap.set(qId, {
          id: answer.question.id,
          text: answer.question.text,
          frequencyType: answer.question.frequencyType,
          points: answer.question.points,
          options: answer.question.options,
          periods: [],
          adminScore: null,
          adminComment: null,
          adminReviewedAt: null,
          reviewedBy: null,
        });
      }
      const qData = questionsMap.get(qId);
      qData.periods.push({
        id: answer.id,
        periodStart: answer.periodStart,
        periodEnd: answer.periodEnd,
        optionId: answer.optionId,
        optionLabel: answer.option?.label,
        awardedScore: answer.awardedScore,
        hasEvidence: answer.hasEvidence,
        files: answer.files,
      });
      // Keep latest admin review
      if (answer.adminScore !== null) {
        qData.adminScore = answer.adminScore;
        qData.adminComment = answer.adminComment;
        qData.adminReviewedAt = answer.adminReviewedAt;
        qData.reviewedBy = answer.reviewedBy;
      }
    }

    // Calculate totals per question
    const questions = Array.from(questionsMap.values()).map((q: any) => {
      const totalAuto = q.periods.reduce((sum: number, p: any) => sum + (p.awardedScore || 0), 0);
      return { ...q, totalAuto };
    });

    res.json({ evaluations: [{ ...evaluation, questions }], campaign });
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ error: "Error al obtener historial" });
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

    const evaluationId = parseId(req.params.id);

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
    if (req.user?.roleId !== 1 && req.user?.id !== parseId(req.params.userId)) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    const userId = parseId(req.params.userId);

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
router.put("/answers/:answerId/review", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden calificar" });
    }

    const answerId = parseId(req.params.answerId);
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

    const programId = parseId(req.params.programId);

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

// ==================== EVALUACIONES - DISPONIBILIDAD DE PREGUNTAS ====================
router.get("/question-availability", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { programId, source = "EXCELENCIA" } = req.query;
    const userId = req.user!.id;
    
    const campaign = await prisma.campaign.findFirst({ where: { isActive: true } });
    if (!campaign) return res.json({ questions: [], message: "No hay campaña activa" });

    // Obtener preguntas según source
    let questionIds: number[] = [];
    if (source === "MIS_PROGRAMAS" && programId) {
      const qps = await prisma.questionProgram.findMany({
        where: { programId: parseInt(programId as string) },
        select: { questionId: true },
      });
      questionIds = qps.map(qp => qp.questionId);
    } else {
      const userCargoId = req.user!.cargoId;
      const questions = await prisma.question.findMany({
        where: {
          cargos: { some: { cargoId: userCargoId || 0 } },
          targetType: { in: ["EXCELENCIA", "AMBOS"] },
          isActive: true,
        },
        select: { id: true },
      });
      questionIds = questions.map(q => q.id);
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds }, isActive: true },
      include: { options: { orderBy: { label: "asc" } }, configs: true, selectors: { include: { options: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } } },
    });

    const submissions = await prisma.questionSubmission.findMany({
      where: { userId, campaignId: campaign.id, questionId: { in: questionIds } },
      orderBy: { periodStart: "desc" },
    });

    const now = new Date();
    const availability = questions.map(q => {
      const qSubmissions = submissions.filter(s => s.questionId === q.id);

      if (q.frequencyType === "UNICA") {
        return { 
          ...q, 
          available: qSubmissions.length === 0, 
          isComplete: qSubmissions.length > 0,
          currentPeriod: null,
        };
      }

      const { periodStart, periodEnd } = getCurrentPeriod(
        q.frequencyType, q.frequencyDay, q.frequencyInterval, now
      );
      const answeredInPeriod = qSubmissions.some(
        s => new Date(s.periodStart).getTime() === periodStart.getTime()
      );

      return {
        ...q,
        available: !answeredInPeriod,
        isComplete: answeredInPeriod,
        currentPeriod: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
      };
    });

    res.json({ questions: availability });
  } catch (error) {
    console.error("Error al obtener disponibilidad:", error);
    res.status(500).json({ error: "Error al obtener disponibilidad" });
  }
});

// ==================== ADMIN - OBTENER TODAS LAS EVALUACIONES DE UN USUARIO (DETALLE) ====================
router.get("/user/:userId/campaign/:campaignId/details", authMiddleware, async (req, res) => {
  try {
    const { userId, campaignId } = req.params;

    const evaluations = await prisma.evaluation.findMany({
      where: {
        userId: parseId(userId),
        campaignId: parseId(campaignId),
      },
      include: {
        user: { include: { cargo: true, sede: true, unidadNegocio: true } },
        campaign: true,
        program: true,
        answers: {
          include: {
            question: { include: { options: true } },
            option: true,
            files: true,
            reviewedBy: { select: { id: true, name: true } }
          },
          orderBy: [{ questionId: 'asc' }, { periodStart: 'asc' }]
        }
      }
    });

    res.json(evaluations);
  } catch (error) {
    console.error("Error fetching user combined details:", error);
    res.status(500).json({ error: "Error al obtener detalle combinado de evaluaciones" });
  }
});

// ==================== HELPER: Recompute Evaluation Progress ====================
type ProgressResult = {
  answered: number;
  expected: number;
  percentage: number;
  isComplete: boolean;
};

async function recomputeEvaluationProgress(evaluationId: number): Promise<ProgressResult> {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
    include: {
      user: { select: { cargoId: true } },
      program: { select: { id: true } },
      campaign: { select: { id: true } },
      answers: {
        where: { status: { in: ["ANSWERED", "COMPLETED"] } },
        include: { question: { include: { configs: true, cargos: true } } }
      }
    }
  });

  if (!evaluation) throw new Error("Evaluation not found");

  const userCargoId = evaluation.user.cargoId;
  const programId = evaluation.program?.id;
  const campaignId = evaluation.campaign.id;
  const now = new Date();

  let relevantQuestions: any[] = [];
  if (programId) {
    const qps = await prisma.questionProgram.findMany({
      where: { programId },
      select: { questionId: true }
    });
    const questionIds = qps.map(qp => qp.questionId);
    relevantQuestions = await prisma.question.findMany({
      where: { id: { in: questionIds }, isActive: true },
      include: { configs: true, cargos: true }
    });
  } else {
    relevantQuestions = await prisma.question.findMany({
      where: {
        cargos: { some: { cargoId: userCargoId || 0 } },
        targetType: { in: ["EXCELENCIA", "AMBOS"] },
        isActive: true
      },
      include: { configs: true, cargos: true }
    });
  }

  let expected = 0;
  let answered = 0;

  for (const q of relevantQuestions) {
    const { periodStart, periodEnd } = getCurrentPeriod(
      q.frequencyType,
      q.frequencyDay,
      q.frequencyInterval,
      now
    );

    if (periodStart > now) continue;

    expected += 1;

    const answer = evaluation.answers.find(
      a => a.questionId === q.id && a.periodStart?.getTime() === periodStart.getTime()
    );

    if (answer && answer.status === "ANSWERED" || answer?.status === "COMPLETED") {
      answered += 1;
    }
  }

  const percentage = expected > 0 ? Math.round((answered / expected) * 100) : 0;
  const hasPending = evaluation.answers.some(a =>
    a.status === "PENDING_DELEGATION" || a.status === "PENDING_APPROVAL"
  );
  const isComplete = answered === expected && !hasPending;

  if (isComplete) {
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { completedAt: now }
    });
  } else {
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { completedAt: null }
    });
  }

  return { answered, expected, percentage, isComplete };
}

// ==================== POST /evaluations/answer (per-question save) ====================
router.post("/answer", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { campaignId, programId, source = "MIS_PROGRAMAS", questionId, optionId, optionIds, files, selectorResponses, detailText } = req.body;
    const userId = req.user!.id;

    if (!campaignId || !questionId) {
      return res.status(400).json({ error: "Falta campaignId o questionId" });
    }

    if (!["EXCELENCIA", "MIS_PROGRAMAS"].includes(source)) {
      return res.status(400).json({ error: "Source inválido" });
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        options: true,
        selectors: { include: { options: true } },
        configs: true,
        cargos: true,
        flowConfig: { include: { triggers: { orderBy: { id: "asc" } } } }
      }
    });

    if (!question) {
      return res.status(404).json({ error: "Pregunta no encontrada" });
    }

    const { periodStart, periodEnd } = getCurrentPeriod(
      question.frequencyType,
      question.frequencyDay,
      question.frequencyInterval
    );

    let evaluation;
    if (source === "MIS_PROGRAMAS" && programId) {
      evaluation = await prisma.evaluation.findFirst({
        where: { userId, campaignId, source, programId }
      });
      if (!evaluation) {
        evaluation = await prisma.evaluation.create({
          data: { userId, campaignId, source, programId }
        });
      }
    } else {
      evaluation = await prisma.evaluation.findFirst({
        where: { userId, campaignId, source, programId: null }
      });
      if (!evaluation) {
        evaluation = await prisma.evaluation.create({
          data: { userId, campaignId, source, programId: null }
        });
      }
    }

    const selectedOptionId = optionId ? parseInt(optionId) : null;
    let awardedScore = 0;
    if (selectedOptionId) {
      const option = question.options.find(o => o.id === selectedOptionId);
      if (option) awardedScore = option.score || 0;
    }

    const parsedOptionIds = Array.isArray(optionIds)
      ? optionIds.map(Number).filter(n => !isNaN(n))
      : [];
    const parsedDetailText = detailText || null;

    const hasFiles = files && Array.isArray(files) && files.length > 0;
    const validFiles = hasFiles ? files.filter((f: any) => f && f.fileUrl) : [];

    const existingAnswer = await prisma.answer.findFirst({
      where: { evaluationId: evaluation.id, questionId, periodStart }
    });

    let answer;
    if (existingAnswer) {
      answer = await prisma.answer.update({
        where: { id: existingAnswer.id },
        data: {
          optionId: selectedOptionId,
          optionIds: parsedOptionIds,
          detailText: parsedDetailText,
          awardedScore,
          hasEvidence: validFiles.length > 0,
          status: "ANSWERED"
        }
      });

      if (validFiles.length > 0) {
        await prisma.answerFile.createMany({
          data: validFiles.map((f: any) => ({
            answerId: answer.id,
            fileType: String(f.fileType || ""),
            fileName: String(f.fileName || ""),
            fileUrl: String(f.fileUrl || "")
          }))
        });
      }
    } else {
      answer = await prisma.answer.create({
        data: {
          evaluationId: evaluation.id,
          questionId,
          optionId: selectedOptionId,
          optionIds: parsedOptionIds,
          detailText: parsedDetailText,
          awardedScore,
          hasEvidence: validFiles.length > 0,
          periodStart,
          periodEnd,
          status: "ANSWERED",
          files: validFiles.length > 0 ? {
            create: validFiles.map((f: any) => ({
              fileType: String(f.fileType || ""),
              fileName: String(f.fileName || ""),
              fileUrl: String(f.fileUrl || "")
            }))
          } : undefined
        }
      });
    }

    if (selectorResponses && typeof selectorResponses === "object") {
      for (const [selectorIdStr, optionIdsArr] of Object.entries(selectorResponses)) {
        const selectorId = parseInt(selectorIdStr);
        if (!isNaN(selectorId) && Array.isArray(optionIdsArr)) {
          await prisma.evaluationAnswerSelector.upsert({
            where: { answerId_selectorId: { answerId: answer.id, selectorId } },
            create: {
              answerId: answer.id,
              selectorId,
              selectedOptionIds: (optionIdsArr as number[]).map(Number).filter(n => !isNaN(n))
            },
            update: {
              selectedOptionIds: (optionIdsArr as number[]).map(Number).filter(n => !isNaN(n))
            }
          });
        }
      }
    }

    await prisma.questionSubmission.upsert({
      where: {
        questionId_userId_campaignId_periodStart: { questionId, userId, campaignId, periodStart }
      },
      create: { questionId, userId, campaignId, submissionDate: new Date(), periodStart, periodEnd },
      update: { submissionDate: new Date(), periodEnd }
    });

    let delegation: any = null;
    let firedTrigger: any = null;

    if (question.flowConfig && question.flowConfig.isActive && question.flowConfig.requiresDelegation) {
      const questionSelectors = question.selectors || [];
      const optionSemanticById = new Map<number, string>();
      for (const sel of questionSelectors) {
        for (const opt of sel.options || []) {
          if (opt.semanticKey) optionSemanticById.set(opt.id, opt.semanticKey);
        }
      }

      const selectorResponsesMap: { [selectorId: number]: number[] } = {};
      const selectorSemanticKeysMap: { [selectorId: number]: string[] } = {};

      if (selectorResponses && typeof selectorResponses === "object") {
        for (const [selectorIdStr, optIds] of Object.entries(selectorResponses)) {
          const selectorId = parseInt(selectorIdStr);
          if (!isNaN(selectorId) && Array.isArray(optIds)) {
            selectorResponsesMap[selectorId] = optIds;
            selectorSemanticKeysMap[selectorId] = (optIds as number[])
              .map(id => optionSemanticById.get(id))
              .filter((k): k is string => !!k);
          }
        }
      }

      const ansOption = question.options.find(o => o.id === selectedOptionId);
      const answerForTrigger = {
        optionId: selectedOptionId,
        optionIds: parsedOptionIds,
        awardedScore,
        optionSemanticKey: ansOption?.semanticKey || null,
        selectorResponses: selectorResponsesMap,
        selectorSemanticKeys: selectorSemanticKeysMap
      };

      for (const trigger of question.flowConfig.triggers) {
        if (matchesTrigger(trigger as any, answerForTrigger)) {
          firedTrigger = trigger;
          break;
        }
      }

      if (firedTrigger) {
        const existingDelegation = await prisma.answerDelegation.findUnique({
          where: { answerId: answer.id }
        });

        if (!existingDelegation || existingDelegation.status === "CANCELADA") {
          const deadlineAt = calcDeadline(periodStart, question.flowConfig.deadlineOffsetDays, question.flowConfig.deadlineBusinessDays);

          delegation = await prisma.answerDelegation.upsert({
            where: { answerId: answer.id },
            create: {
              answerId: answer.id,
              triggerId: firedTrigger.id,
              deadlineAt,
              status: "PENDIENTE"
            },
            update: {
              triggerId: firedTrigger.id,
              deadlineAt,
              status: "PENDIENTE",
              completedAt: null,
              completedByUserId: null
            }
          });

          await prisma.answer.update({
            where: { id: answer.id },
            data: { status: "PENDING_DELEGATION" }
          });
        }
      }
    }

    let approval: any = null;
    if (question.flowConfig && question.flowConfig.isActive && question.flowConfig.requiresApproval && !delegation) {
      const existingApproval = await prisma.answerApproval.findUnique({
        where: { answerId: answer.id }
      });

      if (!existingApproval) {
        approval = await prisma.answerApproval.create({
          data: {
            answerId: answer.id,
            approverCargoId: question.flowConfig.approvalCargoId!,
            status: "PENDIENTE"
          }
        });

        await prisma.answer.update({
          where: { id: answer.id },
          data: { status: "PENDING_APPROVAL" }
        });
      }
    }

    const progress = await recomputeEvaluationProgress(evaluation.id);

    res.json({
      answer,
      delegation,
      approval,
      progress: {
        answered: progress.answered,
        expected: progress.expected,
        percentage: progress.percentage,
        isComplete: progress.isComplete
      }
    });
  } catch (error: any) {
    console.error("Error en POST /evaluations/answer:", error);
    res.status(500).json({ error: error.message || "Error al guardar respuesta" });
  }
});

export default router;