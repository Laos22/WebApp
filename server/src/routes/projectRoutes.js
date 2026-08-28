// server/src/routes/projectRoutes.js
import express from "express";
import { ensureAuthenticated } from "../middleware/auth.js";
import Settings from "../models/Settings.js";
import {
  generateVideoTopic,
  generateCoverData,
} from "../services/geminiService.js";
import {
  resolveProfile,
  logProfileUsage,
} from "../services/aiProfileResolver.js";
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

    // Выбираем дефолтный текстовый профиль и логируем, что именно применяется
    const textProfile = resolveProfile(settings, "text");
    logProfileUsage("generate-topic", textProfile, "text");

    const generatedTopic = await generateVideoTopic(
      settings.systemPrompt,
      keywords,
      textProfile,
    );

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

// 👈 НОВЫЙ Route: Получение всех проектов пользователя
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.user._id }).sort({
      updatedAt: -1,
    });
    res.json({ success: true, projects });
  } catch (error) {
    console.error("❌ Ошибка получения проектов:", error);
    res.status(500).json({ error: "Ошибка при получении списка проектов" });
  }
});

// GET проект по ID
router.get("/:id", ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!project) return res.status(404).json({ error: "Проект не найден" });
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при получении проекта" });
  }
});

// DELETE проект
router.delete("/:id", ensureAuthenticated, async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!project) return res.status(404).json({ error: "Проект не найден" });

    // Удаление папки с диска
    if (project.projectPath && fs.existsSync(project.projectPath)) {
      fs.rmSync(project.projectPath, { recursive: true, force: true });
    }

    await project.deleteOne();
    res.json({ success: true, message: "Проект удален" });
  } catch (error) {
    res.status(500).json({ error: "Ошибка при удалении проекта" });
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

    // Создаем папку на диске в папке server/uploads в режиме разработки
    // для продакшена нужно использовать синхронизацию с гугл драйв через сервис driveSync.js
    const uploadsDir = path.join(process.cwd(), "uploads", short_title);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      // Создаем  файл project_state.json в папке проекта
      const projectStateFile = path.join(uploadsDir, "project_state.json");
      if (!fs.existsSync(projectStateFile)) {
        fs.writeFileSync(projectStateFile, JSON.stringify({}));
        //записываем ту тему и описание, которая была сгенерирована в файл project_state.json
        fs.writeFileSync(
          projectStateFile,
          JSON.stringify({ topic, description, short_title }),
        );
      }
    }
    // если папка уже существует, то просто обновляем файл project_state.json
    else {
      const projectStateFile = path.join(uploadsDir, "project_state.json");
      fs.writeFileSync(
        projectStateFile,
        JSON.stringify({ short_title, topic, description }),
      );
    }

    // Создаем проект в БД
    const project = await Project.create({
      userId: req.user._id,
      title: topic, // Название проекта = полное название темы
      description: description,
      shortTitle: short_title,
      keywords: keywords || "",
      projectPath: uploadsDir, // добавляем путь к папке проекта на диске в БД
    });

    res.json({
      success: true,
      projectId: project._id,
      shortTitle: short_title,
      projectPath: uploadsDir,
      message: "Проект успешно создан",
    });
  } catch (error) {
    console.error("❌ Ошибка создания проекта:", error);
    res.status(500).json({
      error: error.message || "Ошибка при создании проекта",
    });
  }
});

// 👈 НОВЫЙ Route: Генерация данных обложки
router.post("/:id/generate-cover", ensureAuthenticated, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const project = await Project.findOne({
      _id: projectId,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    const settings = await Settings.findOne({ userId: req.user._id });

    if (!settings?.systemPrompt) {
      return res.status(400).json({
        error: "Системный промпт не найден. Установите его в настройках.",
      });
    }

    // Выбираем дефолтный текстовый профиль и логируем, что именно применяется
    const textProfile = resolveProfile(settings, "text");
    logProfileUsage("generate-cover", textProfile, "text");

    // Генерируем данные обложки
    const coverData = await generateCoverData(
      settings.systemPrompt,
      project.title,
      project.description,
      textProfile,
    );

    // Сохраняем данные в project_state.json
    const projectStateFile = path.join(
      project.projectPath,
      "project_state.json",
    );
    let projectState = {};

    if (fs.existsSync(projectStateFile)) {
      projectState = JSON.parse(fs.readFileSync(projectStateFile, "utf-8"));
    }

    projectState.coverData = coverData;
    fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2));

    res.json({
      success: true,
      coverData,
      message: "Данные обложки успешно сгенерированы",
    });
  } catch (error) {
    console.error("❌ Ошибка генерации обложки:", error);
    res.status(500).json({
      error: error.message || "Ошибка при генерации данных обложки",
    });
  }
});

export default router;
