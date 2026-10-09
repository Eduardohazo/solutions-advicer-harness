import { getPublicCatalog } from "../services/diagnosis.service.js";

export function catalogController(req, res, next) {
  try {
    const catalog = getPublicCatalog();

    return res.status(200).json(catalog);
  } catch (error) {
    return next(error);
  }
}