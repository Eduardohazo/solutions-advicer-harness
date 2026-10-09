export default function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      error: "Origen no permitido por CORS."
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "El cuerpo de la solicitud contiene JSON inválido."
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "El cuerpo de la solicitud supera el tamaño permitido."
    });
  }

  const status = Number.isInteger(error.status)
    ? error.status
    : 500;

  console.error("Error de API:", error);

  return res.status(status).json({
    error: status >= 500
      ? "Ocurrió un error interno del servidor."
      : error.message
  });
}