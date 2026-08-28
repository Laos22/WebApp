# 🚀 WebApp - Полное руководство по настройке

## 📋 Содержание
1. [Быстрый старт](#быстрый-старт)
2. [Установка зависимостей](#установка-зависимостей)
3. [Конфигурация переменных окружения](#конфигурация-переменных-окружения)
4. [База данных (MongoDB)](#база-данных-mongodb)
5. [Google OAuth 2.0](#google-oauth-20)
6. [Gemini API](#gemini-api)
7. [Запуск приложения](#запуск-приложения)
8. [API Endpoints](#api-endpoints)
9. [Структура проекта](#структура-проекта)

---

## ⚡ Быстрый старт

На macOS / Linux:
```bash
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Терминал 1: Клиент
cd client && npm run dev

# Терминал 2: Сервер
cd server && npm run dev
```

---

## 🔐 Конфигурация переменных окружения

### Сервер: `server/.env`
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/webapp
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GEMINI_API_KEY=your_gemini_api_key
JWT_SECRET=your_secure_random_string
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5173
```

### Клиент: `client/.env`
```env
VITE_SERVER_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
```

---

## 🗄️ База данных (MongoDB)

### MongoDB Atlas (облако - РЕКОМЕНДУЕТСЯ):
1. Перейти на https://www.mongodb.com/cloud/atlas
2. Создать аккаунт и кластер
3. Получить строку подключения
4. Добавить IP адрес в Network Access
5. Вставить в `server/.env`

### Локальный MongoDB:
```bash
# macOS:
brew install mongodb-community
brew services start mongodb-community

# Docker:
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Строка подключения:
MONGODB_URI=mongodb://localhost:27017/webapp
```

---

## 🔐 Google OAuth 2.0

1. Перейти в https://console.cloud.google.com
2. Создать новый проект
3. Создать OAuth 2.0 Credentials (Web Application)
4. Добавить Authorized redirect URIs:
   - http://localhost:5000/auth/google/callback
   - http://localhost:5173/auth/callback
5. Копировать Client ID и Secret в `server/.env`

📖 Подробнее: читайте `GOOGLE_OAUTH_SETUP.md`

---

## 🤖 Gemini API

1. Перейти на https://aistudio.google.com
2. Нажать "Get API key" → "Create API key"
3. Копировать ключ в `server/.env`

Используется модель: **gemini-3.5-flash-lite**

---

## 🚀 Запуск приложения

### Режим разработки:
```bash
# Терминал 1 - Клиент (Vite):
cd client && npm run dev
# http://localhost:5173

# Терминал 2 - Сервер (Node.js):
cd server && npm run dev
# http://localhost:5000
```

### Проверка:
- Клиент: http://localhost:5173
- Сервер: http://localhost:5000
- API: http://localhost:5000/api/health

---

## 📡 API Endpoints

### 🔐 Аутентификация
- `GET /auth/google` - Вход через Google
- `GET /auth/google/callback` - Callback после входа
- `GET /auth/logout` - Выход

### 🎬 Проекты
- `GET /api/projects` - Получить все проекты (Auth)
- `GET /api/projects/:id` - Получить проект по ID (Auth)
- `POST /api/projects/generate-topic` - Генерировать тему (Auth)
  - Body: `{ "keywords": "AI, ML, Python" }`
- `POST /api/projects/create-from-topic` - Создать проект (Auth)
  - Body: `{ "topic": "...", "description": "...", "short_title": "...", "keywords": "..." }`
- `POST /api/projects/:id/generate-cover` - Генерировать обложку (Auth)
  - Body: `{ "prompt": "...", "projectTitle": "...", "projectDescription": "..." }`
- `DELETE /api/projects/:id` - Удалить проект (Auth)

### ⚙️ Конфигурация
- `GET /api/config/settings` - Получить настройки (Auth)
- `POST /api/config/update-prompt` - Обновить системный промпт (Auth)
  - Body: `{ "systemPrompt": "..." }`

---

## 📂 Структура проекта

```
WebApp/
├── client/                  # React фронтенд
│   ├── src/
│   │   ├── components/      # React компоненты
│   │   ├── pages/           # Страницы
│   │   ├── hooks/           # Custom hooks
│   │   ├── services/        # API сервисы
│   │   ├── utils/           # Утилиты
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── .env                 # ⚠️ Переменные окружения
│
├── server/                  # Node.js + Express сервер
│   ├── src/
│   │   ├── routes/          # Express маршруты
│   │   ├── controllers/     # Бизнес логика
│   │   ├── services/        # Сервисы (Gemini, DB, etc)
│   │   ├── models/          # Mongoose модели
│   │   ├── middleware/      # Express middleware
│   │   └── config/          # Конфигурация
│   ├── index.js             # Точка входа
│   ├── package.json
│   └── .env                 # ⚠️ Переменные окружения
│
├── SETUP_GUIDE.md           # Этот файл
└── GOOGLE_OAUTH_SETUP.md    # Гайд по OAuth

```

---

## 🐛 Решение проблем

### Ошибка: "Cannot find module"
```bash
# Убедитесь, что зависимости установлены:
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

### Ошибка: "MONGODB_URI not defined"
- Создайте `server/.env` файл
- Добавьте `MONGODB_URI=...`
- Перезагрузите сервер

### Ошибка: "GEMINI_API_KEY not found"
- Получите ключ на https://aistudio.google.com
- Добавьте в `server/.env`

### Ошибка: CORS при запросе с клиента
- Убедитесь, что `CLIENT_URL` в `server/.env` = `http://localhost:5173`
- Перезагрузите оба сервера

### Ошибка: "Port 5000 already in use"
```bash
# Найти процесс на порту:
lsof -i :5000

# Килить процесс (macOS):
kill -9 <PID>
```

---

## 📚 Дополнительные ресурсы

- React: https://react.dev
- Vite: https://vite.dev
- Express.js: https://expressjs.com
- MongoDB: https://docs.mongodb.com
- Tailwind CSS: https://tailwindcss.com
- Google Gemini: https://developers.google.com/gemini
- Passport.js: https://www.passportjs.org

---

## ✅ Чек-лист перед запуском

- [ ] Node.js установлен (`node -v`)
- [ ] MongoDB доступна (локальная или Atlas)
- [ ] `server/.env` создан со всеми переменными
- [ ] `client/.env` создан со всеми переменными
- [ ] Зависимости установлены (`npm install` в каждой папке)
- [ ] Google OAuth credentials созданы и добавлены
- [ ] Gemini API key добавлен
- [ ] Оба сервера запущены (клиент + сервер)
- [ ] Клиент доступен на http://localhost:5173
- [ ] Сервер отвечает на http://localhost:5000

Удачи! 🚀
