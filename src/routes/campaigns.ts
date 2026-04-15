import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";
import { getCurrentPeriod } from "../utils/frequency.ts";

const router = Router();

// POST /api/campaigns - Crear campaña (admin)
router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden crear campañas" });
    }

    const { name, startDate, endDate, assignedUserIds } = req.body;

    await prisma.campaign.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        ...(assignedUserIds && assignedUserIds.length > 0 && {
          assignedUsers: {
            create: assignedUserIds.map((userId: number) => ({ userId })),
          },
        }),
      },
      include: {
        assignedUsers: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    });

    res.json(campaign);
  } catch (error) {
    console.error("Error al crear campaña:", error);
    res.status(500).json({ error: "Error al crear campaña" });
  }
});

// GET /api/campaigns - Listar campañas (admin)
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver campañas" });
    }

    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        assignedUsers: { 
          include: { 
            user: { select: { id: true, email: true, name: true, cargoId: true } } 
          } 
        },
        evaluations: { 
          include: { answers: { include: { files: true } } },
        },
      },
    });

    // Fetch all active questions with cargo assignments
    const allQuestions = await prisma.question.findMany({
      where: { isActive: true },
      include: { cargos: true },
    });

    const campaignsWithStats = campaigns.map((c) => {
      const totalAssigned = c.assignedUsers.length;
      const now = new Date();
      
      // Count how many assigned users have completed ALL their current questions
      let completed = 0;

      for (const au of c.assignedUsers) {
        const userCargoId = au.user.cargoId;

        // Get questions that apply to this user's cargo
        const relevantQuestions = allQuestions.filter((q) => {
          if (q.cargos.length === 0) return false;
          return q.cargos.some((qc) => qc.cargoId === userCargoId);
        });

        // Calculate total expected instances using frequency (same as /progress)
        let totalExpectedInstances = 0;
        for (const q of relevantQuestions) {
          const questionStartDate = new Date(q.createdAt);
          const msInDay = 24 * 60 * 60 * 1000;
          let periodsElapsed = 1;

          if (q.frequencyType === "DIARIA") {
            periodsElapsed = Math.max(1, Math.floor((now.getTime() - questionStartDate.getTime()) / msInDay));
          } else if (q.frequencyType === "SEMANAL") {
            const interval = q.frequencyInterval || 1;
            const weeksElapsed = Math.max(1, Math.floor((now.getTime() - questionStartDate.getTime()) / (7 * msInDay)));
            periodsElapsed = Math.ceil(weeksElapsed / interval);
          } else if (q.frequencyType === "MENSUAL") {
            const interval = q.frequencyInterval || 1;
            const monthsElapsed = Math.max(1, (now.getFullYear() - questionStartDate.getFullYear()) * 12 + now.getMonth() - questionStartDate.getMonth());
            periodsElapsed = Math.ceil(monthsElapsed / interval);
          }

          totalExpectedInstances += q.frequencyType === "UNICA" ? 1 : periodsElapsed;
        }

        if (totalExpectedInstances === 0) continue;

        // Check if user has an evaluation with answers for all relevant questions
        const evaluation = c.evaluations.find((e) => e.userId === au.userId && e.completedAt);

        if (evaluation) {
          const answeredQuestionIds = evaluation.answers
            .filter((a: any) => a.files && a.files.length > 0)
            .map((a: any) => a.questionId);

          // Count unique questions answered
          const answeredCount = relevantQuestions.filter((q) =>
            answeredQuestionIds.includes(q.id)
          ).length;

          // User is "completed" if they answered at least one instance of each question
          if (answeredCount >= relevantQuestions.length) {
            completed++;
          }
        }
      }

      return {
        ...c,
        stats: { totalAssigned, completed, pending: totalAssigned - completed },
      };
    });

    res.json(campaignsWithStats);
  } catch (error) {
    console.error("Error al listar campañas:", error);
    res.status(500).json({ error: "Error al listar campañas" });
  }
});

// GET /api/campaigns/active - Obtener campaña activa
router.get("/active", authMiddleware, async (req: AuthRequest, res) => {
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

// GET /api/campaigns/active/assigned - Ver si usuario tiene campaña asignada
router.get("/active/assigned", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    
    const campaign = await prisma.campaign.findFirst({
      where: { isActive: true },
      orderBy: { startDate: "desc" },
    });

    if (!campaign) {
      return res.json({ assigned: false, campaign: null });
    }

    const assignment = await prisma.campaignUser.findUnique({
      where: { campaignId_userId: { campaignId: campaign.id, userId } },
    });

    res.json({ assigned: !!assignment, campaign });
  } catch (error) {
    res.status(500).json({ error: "Error al verificar asignación" });
  }
});

// GET /api/campaigns/:id - Ver campaña con detalles (admin)
router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden ver campañas" });
    }

    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id: parseInt(id) },
      include: {
        assignedUsers: { include: { user: { select: { id: true, email: true, name: true } } } },
        evaluations: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { totalScore: "desc" },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaña no encontrada" });
    }

    const pendingUsers = campaign.assignedUsers
      .filter((au) => !campaign.evaluations.some((e) => e.userId === au.userId))
      .map((au) => au.user);

    res.json({ ...campaign, pendingUsers });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener campaña" });
  }
});

// PUT /api/campaigns/:id - Actualizar campaña (admin)
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden modificar campañas" });
    }

    const { id } = req.params;
    const { name, startDate, endDate, assignedUserIds } = req.body;
    const campaignId = parseInt(id);

    if (assignedUserIds !== undefined) {
      await prisma.campaignUser.deleteMany({ where: { campaignId } });
      if (assignedUserIds.length > 0) {
        await prisma.campaignUser.createMany({
          data: assignedUserIds.map((userId: number) => ({ campaignId, userId })),
        });
      }
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(name && { name }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
      },
      include: {
        assignedUsers: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    });

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar campaña" });
  }
});

// POST /api/campaigns/:id/assign - Asignar usuarios a campaña (admin)
router.post("/:id/assign", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden asignar usuarios" });
    }

    const { id } = req.params;
    const { userIds } = req.body;
    const campaignId = parseInt(id);

    const newAssignments = userIds
      .filter((userId: number) => true)
      .map((userId: number) => ({ campaignId, userId }));

    if (newAssignments.length > 0) {
      await prisma.campaignUser.createMany({
        data: newAssignments,
        skipDuplicates: true,
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { assignedUsers: { include: { user: { select: { id: true, email: true, name: true } } } } },
    });

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: "Error al asignar usuarios" });
  }
});

// DELETE /api/campaigns/:id/assign/:userId - Desasignar usuario (admin)
router.delete("/:id/assign/:userId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden desasignar usuarios" });
    }

    const { id, userId } = req.params;
    await prisma.campaignUser.delete({
      where: { campaignId_userId: { campaignId: parseInt(id), userId: parseInt(userId) } },
    });

    res.json({ message: "Usuario desasignado" });
  } catch (error) {
    res.status(500).json({ error: "Error al desasignar usuario" });
  }
});


// DELETE /api/campaigns/:id - Eliminar campaña (admin)
router.delete("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) {
      return res.status(403).json({ error: "Solo admins pueden eliminar campañas" });
    }

    const { id } = req.params;
    const campaignId = parseInt(id);

    // Delete related records first
    await prisma.evaluation.deleteMany({ where: { campaignId } });
    await prisma.campaignUser.deleteMany({ where: { campaignId } });
    
    await prisma.campaign.delete({
      where: { id: campaignId },
    });

    res.json({ message: "Campaña eliminada" });
  } catch (error: any) {
    console.error("Error al eliminar campaña:", error);
    res.status(500).json({ error: error.message || "Error al eliminar campaña" });
  }
});

export default router;