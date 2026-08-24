/**
 * Middleware для проверки авторизации пользователя
 */
export const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Требуется авторизация" });
};

/**
 * Middleware для проверки, что пользователь является правообладателем ресурса
 */
export const ensureOwner = (req, res, next) => {
  // Проверяет, что userId из тела запроса или params соответствует авторизованному пользователю
  const resourceUserId = req.body.userId || req.params.userId;
  
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  
  if (resourceUserId && resourceUserId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  
  next();
};