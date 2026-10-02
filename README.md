# Сайт «Reformas Baño Alicante»

Лендинг для заявок на ремонт ванных в Аликанте (ES / EN / RU), блог с SEO и админка. Один сервер на Node 18+, без зависимостей.

## Запуск на Railway
1. Загрузите папку в GitHub-репозиторий → Railway → New project → Deploy from repo.
2. Railway → схема проекта → правый клик по сервису → Attach volume → Mount path `/data`.
3. Variables:
   - `ADMIN_PASSWORD` — пароль для /admin и /seo (обязательно)
   - `PUBLIC_URL` — например `https://reformasbano-alicante.es`
   - `FAL_KEY` — ключ fal.ai (визуализатор, ИИ-статьи, обложки)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — заявки приходят в Telegram
4. Откройте `/admin` → «Компания»: телефон, адрес, NIF, ссылка на Google Business.

## Страницы
- `/`, `/en`, `/ru` — лендинг; `/blog`, `/en/blog`, `/ru/blog` — блог
- `/admin` — заявки, проекты «до/после», визуализатор, цены
- `/seo` — оценка сайта, статьи с ИИ, переводы, контент-план, перелинковка
- `/sitemap.xml`, `/robots.txt`, `/privacidad`
