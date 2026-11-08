/**
 * Starter templates for Visual Studio modules.
 *
 * Every template is one complete, self-contained HTML document: inline CSS,
 * system fonts, no external resources and no scripts. Russian placeholders in
 * square brackets mark the spots the agent fills with the user's data, so the
 * layout survives republishing instead of being rebuilt from scratch.
 *
 * All three share one light visual language: warm paper background, ink text,
 * a single indigo accent, thin hairlines, 12-14 px radii and restrained
 * complexity (at most four blocks per row, at most two colour scales).
 */

export const TEMPLATE_MODULES = ['diagram', 'mockup', 'slide'];

export const TEMPLATES = {
  diagram: `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Схема процесса</title>
<style>
  :root {
    --bg: #fbfaf8;
    --card: #ffffff;
    --ink: #1d1d1b;
    --muted: #78756e;
    --line: #e5e2dc;
    --accent: #4d6bfe;
    --accent-soft: #eef1ff;
    --accent-ink: #3f56c8;
    --radius: 14px;
  }

  * {
    box-sizing: border-box;
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 56px 32px 64px;
  }

  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h1 {
    margin: 12px 0 0;
    font-size: clamp(30px, 4.4vw, 46px);
    font-weight: 650;
    line-height: 1.06;
    letter-spacing: -0.025em;
  }

  .lede {
    max-width: 58ch;
    margin: 14px 0 0;
    font-size: clamp(16px, 1.7vw, 19px);
    color: var(--muted);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 22px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    font-size: 13px;
    color: var(--muted);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 40px;
    align-items: start;
    margin-top: 40px;
  }

  .flow {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 18px;
  }

  .num {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--ink);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .num svg {
    width: 18px;
    height: 18px;
  }

  .link {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 18px;
    align-items: center;
    height: 46px;
  }

  .link svg {
    display: block;
    width: 16px;
    height: 30px;
    margin: 0 auto;
    color: #c8c4bb;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--card);
  }

  .card h2 {
    margin: 0;
    font-size: clamp(18px, 2vw, 21px);
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }

  .card p {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }

  .step--final .num {
    background: var(--accent);
  }

  .step--final .card {
    border-color: #d9e0ff;
    background: var(--accent-soft);
  }

  .step--final .card p {
    color: var(--accent-ink);
  }

  .context {
    padding: 18px 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--card);
  }

  .context-title {
    margin: 0 0 14px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .context-block + .context-block {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .context-label {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .context-value {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
  }

  .context-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .context-list li {
    position: relative;
    padding-left: 14px;
    font-size: 13.5px;
    line-height: 1.4;
  }

  .context-list li::before {
    content: "";
    position: absolute;
    top: 0.6em;
    left: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .footnote {
    margin: 32px 0 0;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    font-size: 13px;
    color: var(--muted);
  }

  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }

    .context {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 20px;
      align-items: start;
    }

    .context-title {
      grid-column: 1 / -1;
      margin-bottom: 0;
    }

    .context-block + .context-block {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }
  }

  @media (max-width: 560px) {
    .page {
      padding: 32px 18px 44px;
    }

    h1 {
      font-size: 27px;
    }

    .lede {
      font-size: 16px;
    }

    .layout {
      margin-top: 28px;
    }

    .step,
    .link {
      grid-template-columns: 36px minmax(0, 1fr);
      gap: 12px;
    }

    .num {
      width: 36px;
      height: 36px;
      font-size: 12px;
    }

    .num svg {
      width: 16px;
      height: 16px;
    }

    .link {
      height: 34px;
    }

    .link svg {
      height: 24px;
    }

    .card {
      padding: 15px 16px;
    }

    .context {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }

    .context-block + .context-block {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .footnote {
      margin-top: 26px;
    }
  }

  @media print {
    @page {
      margin: 14mm;
    }

    body {
      background: #ffffff;
    }

    .page {
      max-width: none;
      padding: 0;
    }

    .head h1 {
      font-size: 30px;
    }

    .lede {
      font-size: 15px;
    }

    .tags {
      margin-top: 14px;
    }

    .layout {
      gap: 20px;
      margin-top: 22px;
    }

    .step,
    .link {
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
    }

    .num {
      width: 34px;
      height: 34px;
      font-size: 12px;
    }

    .num svg {
      width: 15px;
      height: 15px;
    }

    .link {
      height: 30px;
    }

    .link svg {
      height: 22px;
    }

    .card {
      padding: 12px 16px;
    }

    .context {
      padding: 14px 16px;
    }

    .footnote {
      margin-top: 20px;
      padding-top: 12px;
    }

    .step,
    .link,
    .card,
    .context {
      break-inside: avoid;
    }

    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<main class="page">
  <header class="head">
    <p class="eyebrow">Схема процесса</p>
    <h1>[Название процесса]</h1>
    <p class="lede">[Одна строка: что происходит, для кого и зачем]</p>
    <div class="tags">
      <span class="tag">[Роль]</span>
      <span class="tag">[Срок]</span>
      <span class="tag">[Команда]</span>
    </div>
  </header>

  <div class="layout">
    <ol class="flow">
      <li class="step">
        <span class="num">01</span>
        <div class="card">
          <h2>[Шаг 1]</h2>
          <p>[Результат: короткая подпись]</p>
        </div>
      </li>
      <li class="link" aria-hidden="true">
        <svg viewBox="0 0 16 30" fill="none">
          <path d="M8 2v22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M3 19l5 6 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </li>
      <li class="step">
        <span class="num">02</span>
        <div class="card">
          <h2>[Шаг 2]</h2>
          <p>[Результат: короткая подпись]</p>
        </div>
      </li>
      <li class="link" aria-hidden="true">
        <svg viewBox="0 0 16 30" fill="none">
          <path d="M8 2v22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M3 19l5 6 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </li>
      <li class="step">
        <span class="num">03</span>
        <div class="card">
          <h2>[Шаг 3]</h2>
          <p>[Результат: короткая подпись]</p>
        </div>
      </li>
      <li class="link" aria-hidden="true">
        <svg viewBox="0 0 16 30" fill="none">
          <path d="M8 2v22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M3 19l5 6 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </li>
      <li class="step">
        <span class="num">04</span>
        <div class="card">
          <h2>[Шаг 4]</h2>
          <p>[Результат: короткая подпись]</p>
        </div>
      </li>
      <li class="link" aria-hidden="true">
        <svg viewBox="0 0 16 30" fill="none">
          <path d="M8 2v22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M3 19l5 6 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </li>
      <li class="step step--final">
        <span class="num">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 10.5l3.5 3.5L15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <div class="card">
          <h2>[Результат]</h2>
          <p>[Итог процесса — до пяти слов]</p>
        </div>
      </li>
    </ol>

    <aside class="context">
      <p class="context-title">Контекст</p>
      <div class="context-block">
        <p class="context-label">На входе</p>
        <ul class="context-list">
          <li>[Вход один]</li>
          <li>[Вход два]</li>
          <li>[Вход три]</li>
        </ul>
      </div>
      <div class="context-block">
        <p class="context-label">На выходе</p>
        <ul class="context-list">
          <li>[Выход один]</li>
          <li>[Выход два]</li>
        </ul>
      </div>
      <div class="context-block">
        <p class="context-label">Владелец</p>
        <p class="context-value">[Имя и роль]</p>
      </div>
    </aside>
  </div>

  <p class="footnote">[Подпись под схемой: кто владелец процесса и что считается завершением]</p>
</main>
</body>
</html>`,

  mockup: `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Мокап экрана</title>
<style>
  :root {
    --bg: #fbfaf8;
    --card: #ffffff;
    --ink: #1d1d1b;
    --muted: #78756e;
    --line: #e5e2dc;
    --soft: #f4f2ee;
    --accent: #4d6bfe;
    --accent-soft: #eef1ff;
    --radius: 14px;
  }

  * {
    box-sizing: border-box;
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 1120px;
    margin: 0 auto;
    padding: 48px 28px 56px;
  }

  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .caption-top {
    margin: 10px 0 0;
    font-size: 15px;
    color: var(--muted);
  }

  .frame {
    margin-top: 22px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--card);
    box-shadow: 0 1px 2px rgba(29, 29, 27, 0.04), 0 30px 70px -48px rgba(29, 29, 27, 0.5);
  }

  .chrome {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 42px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    background: var(--soft);
  }

  .dots {
    display: inline-flex;
    gap: 6px;
  }

  .dots i {
    display: block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #d5d1c8;
  }

  .addr {
    flex: 1;
    max-width: 460px;
    height: 26px;
    margin: 0 auto;
    padding: 0 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--card);
    color: #a5a19a;
    font-size: 11.5px;
    line-height: 24px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chrome-note {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .app {
    display: flex;
    flex-direction: column;
  }

  .app-head {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 58px;
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }

  .brand-name {
    overflow: hidden;
    font-size: 14.5px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-left: 10px;
  }

  .nav-item {
    font-size: 13.5px;
    color: var(--muted);
  }

  .nav-item.is-active {
    color: var(--ink);
    font-weight: 600;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: auto;
    border-radius: 50%;
    background: #eceae5;
    color: #5c5952;
    font-size: 11px;
    font-weight: 600;
  }

  .app-body {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    align-items: stretch;
  }

  .side {
    padding: 18px 12px;
    border-right: 1px solid var(--line);
    background: #fcfbf8;
  }

  .side-label {
    margin: 0 8px 10px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .side-item {
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 9px;
    font-size: 13px;
    color: var(--muted);
  }

  .side-item.is-active {
    border-color: var(--line);
    background: var(--card);
    color: var(--ink);
    font-weight: 600;
  }

  .screen {
    padding: 30px 32px 34px;
  }

  .screen-head h1 {
    margin: 8px 0 0;
    font-size: clamp(24px, 2.8vw, 32px);
    font-weight: 650;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  .screen-sub {
    max-width: 62ch;
    margin: 10px 0 0;
    font-size: 14.5px;
    color: var(--muted);
  }

  .form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 26px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field--wide {
    grid-column: 1 / -1;
  }

  .field-label {
    font-size: 12.5px;
    color: var(--muted);
  }

  .input {
    display: flex;
    align-items: center;
    min-height: 42px;
    padding: 0 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: #a5a19a;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .input.is-filled {
    color: var(--ink);
  }

  .input.area {
    min-height: 84px;
    align-items: flex-start;
    padding: 11px 12px;
    line-height: 1.45;
    white-space: normal;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 26px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 42px;
    padding: 0 18px;
    border: 1px solid transparent;
    border-radius: 10px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: default;
  }

  .btn-primary {
    background: var(--accent);
    color: #ffffff;
  }

  .btn-ghost {
    border-color: var(--line);
    background: transparent;
    color: var(--ink);
    font-weight: 500;
  }

  .hint {
    font-size: 12.5px;
    color: var(--muted);
  }

  .footnote {
    margin: 22px 0 0;
    font-size: 13px;
    color: var(--muted);
  }

  @media (max-width: 900px) {
    .app-body {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      display: none;
    }
  }

  @media (max-width: 700px) {
    .page {
      padding: 26px 14px 34px;
    }

    .caption-top {
      font-size: 14px;
    }

    .frame {
      margin-top: 16px;
      border-radius: 20px;
    }

    .chrome {
      min-height: 40px;
      padding: 0 10px;
    }

    .addr,
    .chrome-note,
    .nav {
      display: none;
    }

    .app-head {
      min-height: 54px;
      padding: 0 16px;
    }

    .screen {
      padding: 20px 16px 24px;
    }

    .form {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      margin-top: 22px;
    }

    .actions {
      gap: 8px;
      margin-top: 22px;
    }

    .hint {
      flex-basis: 100%;
    }

    .footnote {
      margin-top: 18px;
    }
  }

  @media print {
    @page {
      margin: 12mm;
    }

    body {
      background: #ffffff;
    }

    .page {
      max-width: none;
      padding: 0;
    }

    .frame {
      margin-top: 12px;
      box-shadow: none;
      break-inside: avoid;
    }

    .app-head,
    .screen-head,
    .form,
    .actions {
      break-inside: avoid;
    }

    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<main class="page">
  <header class="intro">
    <p class="eyebrow">Мокап экрана</p>
    <p class="caption-top">[Экран: название и состояние, например «Новая заявка» — пустая форма]</p>
  </header>

  <div class="frame" role="img" aria-label="Мокап экрана приложения">
    <div class="chrome">
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="addr">[адрес-сервиса.ру / раздел / экран]</span>
      <span class="chrome-note">[макет]</span>
    </div>

    <div class="app">
      <header class="app-head">
        <span class="logo">[Л]</span>
        <span class="brand-name">[Название сервиса]</span>
        <nav class="nav" aria-hidden="true">
          <span class="nav-item is-active">[Раздел]</span>
          <span class="nav-item">[Раздел]</span>
          <span class="nav-item">[Раздел]</span>
        </nav>
        <span class="avatar">[ИФ]</span>
      </header>

      <div class="app-body">
        <aside class="side">
          <p class="side-label">Разделы</p>
          <span class="side-item is-active">[Первый раздел]</span>
          <span class="side-item">[Второй раздел]</span>
          <span class="side-item">[Третий раздел]</span>
          <span class="side-item">[Настройки]</span>
        </aside>

        <section class="screen">
          <div class="screen-head">
            <p class="eyebrow">[Раздел]</p>
            <h1>[Заголовок экрана]</h1>
            <p class="screen-sub">[Одна строка: что можно сделать на этом экране]</p>
          </div>

          <div class="form">
            <div class="field">
              <span class="field-label">Название заявки</span>
              <span class="input is-filled">[Короткое название]</span>
            </div>
            <div class="field">
              <span class="field-label">Тип заявки</span>
              <span class="input">[Выберите тип]</span>
            </div>
            <div class="field">
              <span class="field-label">Ответственный</span>
              <span class="input">[Имя и фамилия]</span>
            </div>
            <div class="field">
              <span class="field-label">Дата старта</span>
              <span class="input">[дд.мм.гггг]</span>
            </div>
            <div class="field field--wide">
              <span class="field-label">Описание</span>
              <span class="input area">[Что нужно сделать — до двух строк]</span>
            </div>
          </div>

          <div class="actions">
            <button class="btn btn-primary" type="button">[Основное действие]</button>
            <button class="btn btn-ghost" type="button">[Отмена]</button>
            <span class="hint">[Что произойдёт после сохранения]</span>
          </div>
        </section>
      </div>
    </div>
  </div>

  <p class="footnote">[Подпись под макетом: экран, роль и состояние]</p>
</main>
</body>
</html>`,

  slide: `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Слайд 16:9</title>
<style>
  :root {
    --bg: #fbfaf8;
    --card: #ffffff;
    --ink: #1d1d1b;
    --muted: #78756e;
    --line: #e5e2dc;
    --accent: #4d6bfe;
    --accent-soft: #eef1ff;
    --radius: 14px;
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  ::selection {
    background: var(--accent-soft);
    color: var(--ink);
  }

  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    min-height: 100vh;
    padding: 44px 28px;
    background: radial-gradient(1200px 620px at 50% -8%, #ffffff 0%, var(--bg) 62%);
  }

  .slide {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 24px;
    width: 100%;
    max-width: 1120px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    padding: clamp(26px, 4.4vw, 56px);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: 0 30px 70px -50px rgba(29, 29, 27, 0.45);
  }

  .slide-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .top-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .topic {
    max-width: 180px;
    padding: 4px 9px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 10.5px;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .brand-mark::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--accent);
  }

  .slide-num {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  h1 {
    max-width: 26ch;
    margin: 12px 0 0;
    font-size: clamp(26px, 3.9vw, 46px);
    font-weight: 650;
    line-height: 1.06;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .lede {
    max-width: 54ch;
    margin: 14px 0 0;
    font-size: clamp(14px, 1.5vw, 18px);
    color: var(--muted);
    text-wrap: pretty;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(16px, 3vw, 36px);
  }

  .col {
    padding-top: 16px;
    border-top: 2px solid var(--accent);
  }

  .big {
    margin: 0;
    font-size: clamp(32px, 5.6vw, 68px);
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }

  .cap {
    max-width: 26ch;
    margin: 12px 0 0;
    font-size: clamp(12px, 1.3vw, 15px);
    line-height: 1.4;
    color: var(--muted);
  }

  .detail {
    max-width: 28ch;
    margin: 6px 0 0;
    font-size: 12.5px;
    line-height: 1.4;
    color: #8f8b83;
  }

  .slide-note {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .slide-progress {
    height: 2px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--line);
  }

  .slide-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
  }

  .slide-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--muted);
  }

  .sep {
    color: #c8c4bb;
  }

  .foot-right {
    margin-left: auto;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }

  @media (max-width: 900px) {
    h1 {
      font-size: clamp(22px, 3.4vw, 36px);
    }

    .lede {
      font-size: clamp(13px, 1.4vw, 16px);
    }

    .slide {
      gap: 10px;
      padding: 24px;
    }

    .big {
      font-size: clamp(26px, 4.2vw, 52px);
    }
  }

  @media (max-width: 760px) {
    .stage {
      justify-content: flex-start;
      min-height: 0;
      padding: 24px 16px 32px;
      gap: 14px;
    }

    .slide {
      max-width: 560px;
      aspect-ratio: auto;
      gap: 22px;
      padding: 24px 20px;
    }

    h1 {
      max-width: none;
      font-size: 26px;
    }

    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
    }

    .col {
      padding-top: 12px;
    }

    .big {
      font-size: 38px;
    }

    .cap {
      max-width: none;
    }

    .slide-foot {
      flex-wrap: wrap;
      row-gap: 6px;
    }
  }

  @media (min-width: 1500px) {
    .stage {
      padding: 56px 40px;
    }

    .slide {
      max-width: 1240px;
      gap: 28px;
      padding: 64px;
    }

    h1 {
      font-size: 50px;
    }

    .big {
      font-size: 76px;
    }

    .cap {
      font-size: 16px;
    }

    .detail {
      font-size: 13.5px;
    }
  }

  @media (max-width: 420px) {
    .stage {
      padding: 18px 12px 26px;
    }

    .slide {
      gap: 18px;
      padding: 20px 16px;
    }

    .topic {
      display: none;
    }

    h1 {
      font-size: 24px;
    }

    .lede {
      font-size: 14px;
    }

    .cols {
      gap: 16px;
    }

    .big {
      font-size: 34px;
    }

    .slide-note {
      font-size: 11px;
    }
  }

  @media print {
    @page {
      size: A4 landscape;
      margin: 10mm;
    }

    body {
      background: #ffffff;
    }

    .stage {
      display: block;
      min-height: 0;
      padding: 0;
      background: none;
    }

    .slide {
      width: 100%;
      max-width: none;
      aspect-ratio: 16 / 9;
      gap: 2.2vw;
      padding: 5vw;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      break-inside: avoid;
    }

    .cols {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 3vw;
    }

    .topic {
      display: inline-block;
    }

    .eyebrow,
    .brand-mark,
    .slide-num,
    .topic {
      font-size: 1.05vw;
    }

    h1 {
      max-width: 26ch;
      font-size: 4.4vw;
    }

    .lede {
      max-width: 54ch;
      font-size: 1.7vw;
    }

    .big {
      font-size: 6.2vw;
    }

    .cap {
      max-width: 26ch;
      font-size: 1.5vw;
    }

    .detail {
      max-width: 28ch;
      font-size: 1.25vw;
    }

    .slide-note,
    .slide-foot {
      font-size: 1.15vw;
    }

    .hint {
      display: none;
    }

    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<main class="stage">
  <section class="slide">
    <div class="slide-top">
      <div class="top-left">
        <span class="brand-mark">[Компания]</span>
        <span class="topic">[Раздел]</span>
      </div>
      <span class="slide-num">[01 / 07]</span>
    </div>

    <header class="slide-head">
      <p class="eyebrow">[Тема слайда]</p>
      <h1>[Главный тезис слайда]</h1>
      <p class="lede">[Одна строка контекста — до двенадцати слов]</p>
    </header>

    <div class="cols">
      <div class="col">
        <p class="big">[42%]</p>
        <p class="cap">[Название показателя]</p>
        <p class="detail">[Период и база сравнения]</p>
      </div>
      <div class="col">
        <p class="big">[3 нед.]</p>
        <p class="cap">[Название показателя]</p>
        <p class="detail">[Период и база сравнения]</p>
      </div>
      <div class="col">
        <p class="big">[18]</p>
        <p class="cap">[Название показателя]</p>
        <p class="detail">[Период и база сравнения]</p>
      </div>
    </div>

    <p class="slide-note">[Сноска: как считается показатель или откуда данные]</p>

    <div class="slide-progress" aria-hidden="true"><span style="width: 14%"></span></div>

    <footer class="slide-foot">
      <span>[Источник или автор]</span>
      <span class="sep">·</span>
      <span>[Дата]</span>
      <span class="foot-right">[Проект]</span>
    </footer>
  </section>

  <p class="hint">[Подпись под слайдом: как читать цифры]</p>
</main>
</body>
</html>`,
};

export function templateFor(module) {
  return TEMPLATES[module] ?? TEMPLATES.diagram;
}
