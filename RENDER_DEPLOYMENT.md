# Первый деплой AI Hub на Render Free

Схема: один Render Web Service отдаёт React и API с одного HTTPS-адреса,
MongoDB Atlas хранит данные, Google Drive хранит файлы проектов.

## 1. MongoDB Atlas

1. Создайте бесплатный кластер M0.
2. В `Database Access` создайте отдельного пользователя приложения.
3. В `Network Access` временно разрешите `0.0.0.0/0`, потому что у Render Free
   нет постоянного исходящего IP. Используйте длинный уникальный пароль БД.
4. Скопируйте строку `mongodb+srv://...` и добавьте имя базы
   `aihub_production` перед параметрами запроса.

## 2. Render Blueprint

1. Подключите GitHub к Render.
2. Выберите `New > Blueprint` и репозиторий `Laos22/WebApp`.
3. Выберите ветку `feature/webapp-script-persistence`.
4. Render прочитает `render.yaml` и запросит секретные переменные.

Укажите:

- `MONGODB_URI` — строка Atlas;
- `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` — OAuth Web client;
- `GOOGLE_ALLOWED_EMAILS` — ваш Google email;
- `VITE_CLIENT_URL` и `VITE_SERVER_URL` — одинаковый адрес Render, например
  `https://aihub-webapp.onrender.com`.

Не добавляйте реальные секреты в `.env`, Git или `render.yaml`.

## 3. Google Cloud

1. Включите Google Drive API.
2. Оставьте OAuth consent screen в режиме Testing.
3. Добавьте свой Google email в Test users.
4. Создайте OAuth Client ID типа Web application.
5. Добавьте Redirect URI:

```text
https://ВАШ-СЕРВИС.onrender.com/auth/callback
```

6. Добавьте JavaScript origin:

```text
https://ВАШ-СЕРВИС.onrender.com
```

Если URL стал известен только после первого создания сервиса, заполните Google
Cloud и переменные Render, затем выполните `Manual Deploy > Deploy latest commit`.

## 4. Проверка

Откройте:

```text
https://ВАШ-СЕРВИС.onrender.com/api/health
```

Ожидается JSON со значениями `authMode: google` и
`storageProvider: google_drive`.

После этого проверьте вход Google, создание тестового проекта, появление папки
проекта на Drive, загрузку референса, аудио и изображения, а затем повторный вход.

## Ограничение Render Free

Сервис засыпает после простоя, поэтому первый запрос может выполняться около
минуты. Диск временный, но в режиме `google_drive` постоянные файлы проекта туда
не записываются. Для экономии памяти импортируйте Flow-архивы партиями до 50 МБ.
