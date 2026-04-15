import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
router.post("/register", async (req, res) => {
    try {
        const { email, password, role = "user", name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email y password son requeridos" });
        }
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: "El email ya está registrado" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                role,
                ...(name && { name }),
            },
        });
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        res.status(201).json({
            message: "Usuario creado exitosamente",
            token,
            user: { id: user.id, email: user.email, role: user.role },
        });
    }
    catch (error) {
        console.error("Error en register:", error);
        res.status(500).json({ error: "Error al crear usuario" });
    }
});
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email y password son requeridos" });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        res.json({
            message: "Login exitoso",
            token,
            user: { id: user.id, email: user.email, role: user.role },
        });
    }
    catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: "Error en el login" });
    }
});
export default router;
//# sourceMappingURL=auth.js.map