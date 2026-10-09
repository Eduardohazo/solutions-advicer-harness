import express from "express";
import cors from "cors";

import chatRoutes from "./routes/chat.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import resetRoutes from "./routes/reset.routes.js";

import notFound from "./middlewares/notFound.js";
import errorHandler from "./middlewares/errorHandler.js";

import { env } from "./config/env.js";

const app = express();

const allowedOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8080",
    "https://solutions-advicer.netlify.app"
];

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        const error = new Error("Not allowed by CORS");
        error.status = 403;

        return callback(error);
    },

    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "Consejero Cero Uno API",
        model: env.primaryModel
    });
});

app.use("/api/chat", chatRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/reset", resetRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;