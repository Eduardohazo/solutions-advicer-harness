export function validateRequest(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Los datos de entrada no son válidos.",
        details: result.error.issues.map(issue => ({
          field: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    req.validatedBody = result.data;
    next();
  };
}