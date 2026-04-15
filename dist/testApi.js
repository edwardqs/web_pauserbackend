import "dotenv/config";
import express from "express";
import cors from "cors";
const app = express();
app.use(cors());
app.use(express.json());
const ports = [3000, 3001, 3002];
const testPort = 3001;
app.post("/test/register", (req, res) => {
    const { email, password, name } = req.body;
    console.log("📝 Register recibido:", { email, name });
    res.json({
        message: "Usuario creado exitosamente",
        token: "test_token_123",
        user: { id: 1, email, role: "user" }
    });
});
app.listen(testPort, () => {
    console.log(`🧪 Test server en puerto ${testPort}`);
});
//# sourceMappingURL=testApi.js.map