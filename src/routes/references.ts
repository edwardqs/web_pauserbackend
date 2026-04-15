import { Router } from "express";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, AuthRequest } from "../middleware/auth.ts";

const router = Router();

// Sedes
router.get("/sedes", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const sedes = await prisma.sede.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    res.json(sedes);
  } catch (error) {
    res.status(500).json({ error: "Error al listar sedes" });
  }
});

router.post("/sedes", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const sede = await prisma.sede.create({ data: req.body });
    res.json(sede);
  } catch (error) {
    res.status(500).json({ error: "Error al crear sede" });
  }
});

router.put("/sedes/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const sede = await prisma.sede.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(sede);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar sede" });
  }
});

router.delete("/sedes/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    await prisma.sede.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: "Sede desactivada" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar sede" });
  }
});

// Unidades de Negocio
router.get("/unidades", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const unidades = await prisma.unidadNegocio.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    res.json(unidades);
  } catch (error) {
    res.status(500).json({ error: "Error al listar unidades" });
  }
});

router.post("/unidades", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const unidad = await prisma.unidadNegocio.create({ data: req.body });
    res.json(unidad);
  } catch (error) {
    res.status(500).json({ error: "Error al crear unidad" });
  }
});

router.put("/unidades/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const unidad = await prisma.unidadNegocio.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(unidad);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar unidad" });
  }
});

router.delete("/unidades/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    await prisma.unidadNegocio.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: "Unidad desactivada" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar unidad" });
  }
});

// Cargos
router.get("/cargos", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const cargos = await prisma.cargo.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    res.json(cargos);
  } catch (error) {
    res.status(500).json({ error: "Error al listar cargos" });
  }
});

router.post("/cargos", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const cargo = await prisma.cargo.create({ data: req.body });
    res.json(cargo);
  } catch (error) {
    res.status(500).json({ error: "Error al crear cargo" });
  }
});

router.put("/cargos/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    const cargo = await prisma.cargo.update({ where: { id: parseInt(req.params.id) }, data: req.body });
    res.json(cargo);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar cargo" });
  }
});

router.delete("/cargos/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.user?.roleId !== 1) return res.status(403).json({ error: "Solo admins" });
    await prisma.cargo.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ message: "Cargo desactivado" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar cargo" });
  }
});

export default router;