// server/src/middleware/auth.js
import User from '../models/User.js'; // Добавим импорт модели

export const ensureAuthenticated = async (req, res, next) => {
  if (process.env.BYPASS_AUTH === 'true') {
    try {
      // Ищем или создаем тестового пользователя в БД
      let user = await User.findOne({ googleId: 'dev-user-id' });
      if (!user) {
        user = await User.create({
          googleId: 'dev-user-id',
          email: 'dev@local.host',
          displayName: 'Developer',
          picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop'
        });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Auth bypass error:', error);
      return res.status(500).json({ error: 'Auth bypass error' });
    }
  }

  if (req.isAuthenticated()) {
    return next();
  }
  
  res.status(401).json({ error: "Требуется авторизация" });
};

export const ensureOwner = async (req, res, next) => {
  if (process.env.BYPASS_AUTH === 'true') {
    try {
      // Используем того же тестового пользователя
      let user = await User.findOne({ googleId: 'dev-user-id' });
      if (!user) {
        user = await User.create({
          googleId: 'dev-user-id',
          email: 'dev@local.host',
          displayName: 'Developer',
          picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop'
        });
      }
      req.user = user;
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Auth bypass error' });
    }
  }

  const resourceUserId = req.body.userId || req.params.userId;
  
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  
  if (resourceUserId && resourceUserId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  
  next();
};