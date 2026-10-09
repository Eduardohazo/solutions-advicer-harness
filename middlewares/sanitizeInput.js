export function sanitizeChatInput(req, res, next) {
  if (req.body && typeof req.body === "object") {
    if (typeof req.body.userId === "string") {
      req.body.userId = req.body.userId.trim();
    }

    if (typeof req.body.prompt === "string") {
      req.body.prompt = req.body.prompt.trim();
    }
  }

  next();
}

export function sanitizeUserId(req, res, next) {
  if (typeof req.body?.userId === "string") {
    req.body.userId = req.body.userId.trim();
  }

  next();
}