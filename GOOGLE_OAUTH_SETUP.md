# Настройка Google OAuth для синхронизации с Google Drive

Этот гайд поможет вам настроить Google OAuth 2.0 для синхронизации конфигураций с Google Drive.

## Шаг 1: Создание проекта в Google Cloud Console

1. Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
2. Нажмите на список проектов вверху и создайте **новый проект**
3. Назовите его (например: "AI Hub")
4. Подождите, пока проект создастся

## Шаг 2: Включение Google Drive API

1. В боковом меню перейдите в **APIs & Services** → **Library**
2. Найдите **"Google Drive API"** в поиске
3. Нажмите на неё и нажмите кнопку **"Enable"**

## Шаг 3: Создание OAuth 2.0 Credentials

1. Перейдите в **APIs & Services** → **Credentials**
2. Нажмите **"+ CREATE CREDENTIALS"** → **OAuth client ID**
3. Если появится окно "Configure OAuth consent screen" - нажмите на него:
   - Выберите **External** (для личного использования)
   - Нажмите **Create**
   - Заполните основную информацию (название приложения)
   - Добавьте свой email
   - Нажмите **Save and Continue**
   - На шагах про scopes нажимайте **Continue** и **Save and Continue**
4. Вернитесь в **Credentials** и нажмите **"+ CREATE CREDENTIALS"** → **OAuth client ID**
5. Выберите тип: **Web application**
6. В поле **Authorized redirect URIs** добавьте:
   ```
   http://localhost:5001/auth/callback
   ```
   (и если будете деплоить: `https://yourdomain.com/auth/callback`)
7. Нажмите **Create**
8. Скопируйте **Client ID** и **Client Secret**

## Шаг 4: Добавление переменных окружения

В файл `server/.env` добавьте:

```env
GOOGLE_CLIENT_ID=ваш_client_id_здесь
GOOGLE_CLIENT_SECRET=ваш_client_secret_здесь
GOOGLE_DRIVE_FOLDER_ID=id_папки_здесь
VITE_SERVER_URL=http://localhost:5001
VITE_CLIENT_URL=http://localhost:5173
```

## Шаг 5: Создание папки на Google Drive

1. Откройте [Google Drive](https://drive.google.com)
2. Создайте новую папку (например: "AI Hub Config")
3. Откройте её и посмотрите на URL: `https://drive.google.com/drive/folders/FOLDER_ID_ЗДЕСЬ`
4. Скопируйте ID папки и вставьте в `GOOGLE_DRIVE_FOLDER_ID` в `.env`

## Шаг 6: Запуск приложения

```bash
# В одном терминале запустите сервер
cd server && npm run dev

# В другом терминале запустите клиент
cd client && npm run dev
```

## Использование

1. Перейдите в **Настройки** (⚙️)
2. Нажмите кнопку **"Подключить Google Drive"**
3. Вы будете перенаправлены на страницу согласия Google
4. Нажмите **"Разрешить"**
5. Вас вернет обратно в приложение
6. Теперь все ваши конфигурации будут автоматически синхронизироваться с Google Drive

## Устранение проблем

### "Invalid redirect URI"
- Убедитесь, что вы добавили `http://localhost:5001/auth/callback` в OAuth credentials
- Проверьте точность написания (без пробелов в конце)

### "Token not found"
- Это нормально при первом подключении. Нажмите кнопку подключения еще раз

### Синхронизация не работает
- Проверьте, что `GOOGLE_DRIVE_FOLDER_ID` правильный
- Откройте консоль браузера (F12) и посмотрите ошибки
- Проверьте логи сервера (`npm run dev` в папке server)

## Готово! 🎉

Теперь ваше приложение будет автоматически сохранять конфигурации на Google Drive!
