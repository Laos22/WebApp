// server/src/middleware/auth.js
import User from '../models/User.js';
import { isDeveloperAuth } from '../config/runtimeConfig.js';

export async function getOrCreateDeveloperUser() {
  const googleId = String(process.env.DEVELOPER_USER_ID || 'dev-user-id').trim();
  let user = await User.findOne({ googleId });
  if (!user) {
    user = await User.create({
      googleId,
      email: String(process.env.DEVELOPER_USER_EMAIL || 'dev@local.host').trim(),
      displayName: 'Developer',
      picture: '',
    });
  }
  return user;
}

export const ensureAuthenticated = async (req, res, next) => {
  if (isDeveloperAuth) {
    try {
      req.user = await getOrCreateDeveloperUser();
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
  if (isDeveloperAuth) {
    try {
      req.user = await getOrCreateDeveloperUser();
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
