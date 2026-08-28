# 📡 API Endpoints Reference

## 🚀 Базовая информация

- **Base URL:** `http://localhost:5000` (разработка) или `https://api.yourdomain.com` (production)
- **Auth Header:** `Authorization: Bearer {JWT_TOKEN}`
- **Content-Type:** `application/json`

---

## 🔐 Аутентификация

### 1. Google OAuth Login
**GET** `/auth/google`

**Описание:** Инициирует процесс логина через Google.

**Параметры:** Нет

**Ответ:**
- Перенаправляет на Google login страницу

**Пример:**
```javascript
// Клиент (фронтенд)
window.location.href = `${process.env.VITE_SERVER_URL}/auth/google`;
```

---

### 2. Google OAuth Callback
**GET** `/auth/google/callback?code=...`

**Описание:** Callback URL, куда Google перенаправляет пользователя после логина.

**Параметры:**
- `code` (query) - Authorization code от Google

**Ответ:** 
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "User Name",
    "picture": "https://..."
  },
  "redirectUrl": "http://localhost:5173/projects"
}
```

**Примечание:** Сервер устанавливает JWT в cookie, затем перенаправляет на `/projects`

---

### 3. Logout
**GET** `/auth/logout`

**Описание:** Выход пользователя из приложения.

**Параметры:** Нет

**Header:** 
```
Authorization: Bearer {JWT_TOKEN}
```

**Ответ:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## 🎬 Проекты (Projects)

### 4. Получить все проекты пользователя
**GET** `/api/projects`

**Описание:** Получить список всех проектов текущего пользователя.

**Header:** 
```
Authorization: Bearer {JWT_TOKEN}
```

**Параметры:** Нет

**Ответ:**
```json
{
  "success": true,
  "projects": [
    {
      "id": "project_id",
      "title": "My Project",
      "shortTitle": "My",
      "topic": "AI Video Generation",
      "description": "Creating AI-powered video content",
      "keywords": "AI, video, generation",
      "coverImage": "https://...",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-15T10:30:00Z"
    }
  ]
}
```

---

### 5. Получить проект по ID
**GET** `/api/projects/:id`

**Описание:** Получить детали конкретного проекта.

**Header:** 
```
Authorization: Bearer {JWT_TOKEN}
```

**URL Parameters:**
- `id` (required) - ID проекта

**Ответ:**
```json
{
  "success": true,
  "project": {
    "id": "project_id",
    "title": "My Project",
    "shortTitle": "My",
    "topic": "AI Video Generation",
    "description": "Creating AI-powered video content",
    "keywords": "AI, video, generation",
    "coverImage": "https://...",
    "script": "Detailed script content here...",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T10:30:00Z"
  }
}
```

---

### 6. Генерировать тему проекта
**POST** `/api/projects/generate-topic`

**Описание:** Генерирует новую тему проекта на основе ключевых слов используя Gemini API.

**Header:** 
```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

**Body:**
```json
{
  "keywords": "AI, machine learning, Python"
}
```

**Ответ:**
```json
{
  "success": true,
  "topic": "Building Your First AI Model with Python: A Beginner's Guide",
  "description": "Learn step-by-step how to create your first machine learning model using Python. We'll explore the fundamentals of AI and practical implementation...",
  "keywords": "Python, machine learning, AI, beginner, tutorial"
}
```

**Ошибки:**
- `400` - Missing keywords
- `500` - Gemini API error

---

## 🏥 Health Check

### 7. Проверить статус сервера
**GET** `/api/health`

**Описание:** Проверяет, что сервер работает и доступен.

**Параметры:** Нет

**Ответ:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-15T10:30:00Z",
  "environment": "development"
}
```

---

## 📋 Таблица всех endpoints

| Метод | Endpoint | Описание | Auth |
|-------|----------|---------|------|
| GET | `/auth/google` | Логин через Google | ❌ |
| GET | `/auth/google/callback` | Google callback | ❌ |
| GET | `/auth/logout` | Выход | ✅ |
| GET | `/api/projects` | Получить все проекты | ✅ |
| GET | `/api/projects/:id` | Получить проект | ✅ |
| POST | `/api/projects/generate-topic` | Генерировать тему | ✅ |
| GET | `/api/health` | Проверка здоровья | ❌ |

---

## 🔄 Примеры использования (JavaScript/Fetch)

### Пример 1: Получить проекты
```javascript
const token = localStorage.getItem('token');

const response = await fetch(`${process.env.VITE_SERVER_URL}/api/projects`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log(data.projects);
```

### Пример 2: Обработка ошибок
```javascript
try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }

  const data = await response.json();
  
  if (!data.success) {
    console.error('API Error:', data.message);
  } else {
    console.log('Success:', data);
  }
} catch (error) {
  console.error('Network or parsing error:', error);
}
```

---

## 🔑 HTTP Status Codes

| Status | Описание |
|--------|---------|
| `200` | OK - Успешный запрос |
| `201` | Created - Ресурс создан |
| `400` | Bad Request - Неверные параметры |
| `401` | Unauthorized - Требуется аутентификация |
| `403` | Forbidden - Нет доступа |
| `404` | Not Found - Ресурс не найден |
| `500` | Internal Server Error - Ошибка сервера |
