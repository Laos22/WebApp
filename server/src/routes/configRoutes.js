import express from 'express';
import { getSettings, updateSettings } from '../services/configManager.js';

const router = express.Router();

/**
 * Получить все настройки
 */
router.get('/', (req, res) => {
    try {
        const settings = getSettings();
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

/**
 * Обновить настройки
 */
router.post('/', (req, res) => {
    try {
        const updatedSettings = updateSettings(req.body);
        res.json({ success: true, settings: updatedSettings });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

/**
 * Получить только системный промпт
 */
router.get('/prompt', (req, res) => {
    try {
        const settings = getSettings();
        res.json({ systemPrompt: settings.systemPrompt });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch prompt' });
    }
});

export default router;
