// server/src/routes/projectRoutes.js
import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings from "../models/Settings.js";
import { generateVideoTopic } from "../services/geminiService.js";
import Project from "../models/Project.js";
import path from "path";
import fs from "fs";

const router = express.Router();

// Существующий route для генерации темы
router.post("/generate-topic", ensureAuthenticated, async (req, res) => {
  try {
    const { keywords } = req.body;

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    const generatedTopic = await generateVideoTopic(settings.systemPrompt, keywords);

    res.json({
      success: true,
      topic: generatedTopic,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Ошибка генерации темы:", error);
    res.status(500).json({
      error: error.message || "Ошибка при генерации темы видео",
    });
  }
});

// 👈 НОВЫЙ Route: Создание проекта из выбранной темы
router.post("/create-from-topic", ensureAuthenticated, async (req, res) => {
  try {
    const { topic, description, short_title, keywords } = req.body;

    if (!topic || !description) {
      return res.status(400).json({
        error: "Тема и описание темы обязательны",
      });
    }

    // 👈 Используем short_title из темы (или topic, если short_title пустой)
    const projectShortTitle = short_title || topic.split(' ').slice(0, 4).join(' ');

    // Генерируем уникальное имя папки на основе short_title
    const generateUniqueFolderName = (title) => {
      // Очищаем название: оставляем только буквы, цифры, пробелы и дефисы
      let cleanTitle = title
        .toLowerCase()
        .replace(/[!?@#$%^&*()+=,.;:"'""']/g, '') // Удаляем пунктуацию
        .replace(/[^\w\sа-яєїії'-]+/gi, '') // Оставляем только буквы, цифры, пробелы, дефисы
        .trim()
        .replace(/\s+/g, '_') // Заменяем пробелы на подчеркивания
        .substring(0, 30); // Ограничеваем длину

      // Добавляем timestamp и случайный суффикс для уникальности
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 5);
      
      return `${cleanTitle}_${timestamp.toString().slice(-6)}_${randomSuffix}`;
    };

    const folderName = generateUniqueFolderName(projectShortTitle);

    // Создаем проект в БД
    const project = await Project.create({
      userId: req.user._id,
      title: topic, // Название проекта = полное название темы
      videoTopic: topic,
      videoTopicDescription: description,
      shortTitle: projectShortTitle, // 👈 Сохраняем короткое название
      folderName: folderName,
      keywords: keywords || "",
      description: "",
    });

    // Создаем папку на диске
    const uploadsDir = path.join(process.cwd(), "uploads", folderName);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    res.json({
      success: true,
      projectId: project._id,
      folderName: folderName,
      shortTitle: projectShortTitle,
      message: "Проект успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка создания проекта:", error);
    res.status(500).json({
      error: error.message || "Ошибка при создании проекта",
    });
  }
});

export default router;