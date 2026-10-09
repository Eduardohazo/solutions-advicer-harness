import { Router } from "express";
import { catalogController } from "../controllers/catalog.controller.js";

const router = Router();

router.get("/", catalogController);

export default router;