# 🔐 Google OAuth 2.0 Setup Guide

## Пошаговая инструкция по настройке Google OAuth 2.0

---

## Шаг 1: Создание Google Cloud Project

### 1.1 Перейти в Google Cloud Console
- Откройте https://console.cloud.google.com
- Если нет аккаунта Google - создайте его

### 1.2 Создать новый проект
1. В левом меню нажмите на "Project" (текущее имя проекта)
2. Нажмите кнопку "NEW PROJECT"
3. Заполните форму:
   - **Project name**: `WebApp Video Creator` (или любое другое имя)
   - Нажмите "CREATE"
4. Дождитесь создания проекта (может занять минуту)

### 1.3 Переключиться на новый проект
- В верхней части найдите dropdown "Select a project"
- Выберите ваш новый проект

---

## Шаг 2: Включить необходимые API

### 2.1 Включить Google+ API
1. В левом меню нажмите "APIs & Services" → "Enabled APIs & Services"
2. Нажмите "ENABLE APIS AND SERVICES" (синяя кнопка вверху)
3. В поле поиска введите: `Google+ API`
4. Нажмите на результат
5. Нажмите кнопку "ENABLE"

### 2.2 Включить OAuth 2.0 API
1. Вернитесь на страницу "APIs & Services"
2. Нажмите "ENABLE APIS AND SERVICES"
3. Введите: `OAuth 2.0 API`
4. Нажмите "ENABLE" (если еще не включен)

---

## Шаг 3: Создать OAuth 2.0 Credentials

### 3.1 Создать OAuth consent screen
1. В левом меню: "APIs & Services" → "OAuth consent screen"
2. Выберите "External" (для тестирования)
3. Нажмите "CREATE"
4. Заполните форму:
   - **App name**: `WebApp Video Creator`
   - **User support email**: Ваша почта Google
   - **Developer contact information**: Ваша почта
5. Нажмите "SAVE AND CONTINUE"

### 3.2 Добавить Scopes
1. В разделе "Scopes" нажмите "ADD OR REMOVE SCOPES"
2. Найдите и выберите:
   - `profile` (для получения профиля пользователя)
   - `email` (для получения почты)
3. Нажмите "UPDATE"
4. Нажмите "SAVE AND CONTINUE"

### 3.3 Добавить тестовых пользователей
1. В разделе "Test users" нажмите "ADD USERS"
2. Добавьте Вашу Google почту
3. Нажмите "ADD"
4. Нажмите "SAVE AND CONTINUE"

---

## Шаг 4: Создать Web Application Credentials

### 4.1 Перейти в Credentials
1. В левом меню: "APIs & Services" → "Credentials"
2. Нажмите кнопку "CREATE CREDENTIALS" (сверху)
3. Выберите "OAuth 2.0 Client IDs"

### 4.2 Если это первый раз
- Вам может быть предложено сначала создать "OAuth consent screen"
- Следуйте инструкциям выше (Шаг 3)

### 4.3 Создать Web Application
1. Выберите тип приложения: **Web application**
2. Заполните форму:

#### Authorized JavaScript origins (где будет ваше приложение):
```
http://localhost:5173
http://localhost:5000
http://localhost:3000
https://yourdomain.com
```

#### Authorized redirect URIs (куда Google перенаправит после входа):
```
http://localhost:5000/auth/google/callback
http://localhost:5173/auth/callback
https://yourdomain.com/auth/google/callback
```

3. Нажмите "CREATE"

### 4.4 Скопировать Client ID и Secret
После нажатия "CREATE" вы увидите модальное окно с:
- **Client ID** (выглядит как: `xxx.apps.googleusercontent.com`)
- **Client Secret** (секретный ключ)

**ВНИМАНИЕ:** 
- ✅ Скопируйте оба значения
- ❌ НИКОГДА не публикуйте Client Secret в GitHub
- ✅ Добавьте их только в `.env` файлы (которые в `.gitignore`)

---

## Шаг 5: Добавить Credentials в ваше приложение

### 5.1 Server-side: `server/.env`
```env
GOOGLE_CLIENT_ID=your_client_id_from_google.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_from_google
```

### 5.2 Client-side: `client/.env`
```env
VITE_GOOGLE_CLIENT_ID=your_client_id_from_google.apps.googleusercontent.com
```

### 5.3 Перезагрузить сервисы
```bash
# Остановить оба сервера (Ctrl+C в каждом терминале)
# Перезапустить:

# Терминал 1:
cd server && npm run dev

# Терминал 2:
cd client && npm run dev
```

---

## Шаг 6: Тестирование

### 6.1 Тест локально
1. Откройте http://localhost:5173
2. Найдите кнопку "Login with Google"
3. Нажмите на нее
4. Выберите вашу Google почту (ту, что добавили как тестовый пользователь)
5. Предоставьте разрешения
6. Должны быть перенаправлены обратно в приложение

### 6.2 Если не работает
- Проверьте консоль браузера (F12 → Console)
- Проверьте logs сервера
- Убедитесь, что переменные окружения загружены (`console.log` в коде)
- Проверьте, что redirect URI точно совпадает

---

## Шаг 7: Production (при развертывании)

### Когда будете деплоить на production:

1. **Создать new OAuth credentials для production:**
   - Перейти в Credentials
   - Нажать "CREATE CREDENTIALS" → "OAuth 2.0 Client IDs"
   - Выбрать "Web application"
   - Добавить ваш production domain

2. **Production redirect URIs:**
```
https://yourdomain.com/auth/google/callback
https://yourdomain.com
https://api.yourdomain.com/auth/google/callback
```

3. **Production credentials в `.env`:**
```env
GOOGLE_CLIENT_ID=production_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=production_client_secret
NODE_ENV=production
CLIENT_URL=https://yourdomain.com
```

---

## 🔐 Безопасность: Чек-лист

- [ ] Client Secret **НИКОГДА** не коммитится в Git
- [ ] Используется `.gitignore` для `.env` файлов
- [ ] Client ID можно безопасно использовать на фронтенде
- [ ] Все API запросы идут через сервер (не напрямую с клиента)
- [ ] JWT токены используются для аутентификации после OAuth логина
- [ ] HTTPS используется на production
- [ ] Refresh tokens безопасно хранятся на сервере

---

## 🐛 Решение проблем

### Ошибка: "redirect_uri_mismatch"
- **Причина:** URL после Google логина не совпадает с настройками в Google Cloud
- **Решение:** 
  1. Проверьте точное совпадение (включая http/https, www, порты)
  2. В Google Cloud Console добавьте точный URI

### Ошибка: "invalid_client"
- **Причина:** Client ID или Secret неправильные
- **Решение:** 
  1. Скопируйте еще раз с Google Console
  2. Проверьте, что нет пробелов в начале/конце

### Ошибка: "access_denied"
- **Причина:** Пользователь не в списке тестовых пользователей (для External consent screen)
- **Решение:**
  1. Добавьте почту в "Test users" (Шаг 3.3)
  2. Или измените на "Internal" (только для организации Google Workspace)

### Ошибка: "The OAuth client was not found"
- **Причина:** Client ID не существует или принадлежит другому проекту
- **Решение:**
  1. Проверьте, что выбран правильный project в Google Cloud Console
  2. Создайте новый Client ID если нужно

### Сервер запущен, но логин не работает
- Проверьте logs: `console.log(process.env.GOOGLE_CLIENT_ID)`
- Убедитесь, что сервер перезагружен после добавления `.env`
- Проверьте сетевые запросы в DevTools (F12 → Network)

---

## 📚 Дополнительная информация

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Sign-In for Web](https://developers.google.com/identity/sign-in/web)
- [Passport.js Google Strategy](http://www.passportjs.org/packages/passport-google-oauth20/)

---

## Готово! ✅

Если всё прошло успешно:
- [ ] Google логин работает локально
- [ ] Пользователи могут авторизоваться
- [ ] JWT токены генерируются
- [ ] Данные пользователя сохраняются в MongoDB

Дальше можете запускать остальную часть приложения! 🚀
