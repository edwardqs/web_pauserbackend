import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.ts";
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
}));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
export default app;
//# sourceMappingURL=index.js.map