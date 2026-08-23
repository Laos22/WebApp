import express from 'express';
import { google } from 'googleapis';
import { saveTokens, getStoredTokens } from '../services/driveSync.js';

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.SERVER_URL}/auth/callback`
);

/**
 * Начало OAuth процесса
 */
router.get('/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/drive.file'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent' // Показывать окно согласия каждый раз
    });

    res.redirect(authUrl);
});

/**
 * Callback от Google
 */
router.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code not found' });
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        saveTokens(tokens);

        res.redirect(`${process.env.CLIENT_URL}/?drive=connected`);
    } catch (e) {
        console.error("Ошибка при получении токенов:", e);
        res.status(500).json({ error: 'Failed to authenticate' });
    }
});

/**
 * Проверка статуса подключения
 */
router.get('/status', (req, res) => {
    const tokens = getStoredTokens();
    res.json({
        connected: !!tokens,
        hasRefreshToken: tokens?.refresh_token ? true : false
    });
});

export default router;
