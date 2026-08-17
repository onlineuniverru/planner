-- Personal Planner — initial schema (Этап 2)
-- Однопользовательский сервис. Сущности: Project, Category, Task, TaskComment, AppUser(settings)

CREATE TABLE IF NOT EXISTS app_user (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Проекты
CREATE TABLE IF NOT EXISTS project (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Категории (общие или привязанные к проекту)
CREATE TABLE IF NOT EXISTS category (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  project_id  INT REFERENCES project(id) ON DELETE SET NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Задачи
CREATE TABLE IF NOT EXISTS task (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  project_id      INT REFERENCES project(id) ON DELETE SET NULL,
  category_id     INT REFERENCES category(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','DONE','CANCELLED')),
  priority        TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
  due_date        DATE,
  due_time        TIME,
  reminder_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  recurrence_rule TEXT, -- 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'WEEKLY:MO,WE,FR'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_due_date  ON task(due_date);
CREATE INDEX idx_task_status    ON task(status);
CREATE INDEX idx_task_project   ON task(project_id);

-- Комментарии (история записей)
CREATE TABLE IF NOT EXISTS task_comment (
  id         SERIAL PRIMARY KEY,
  task_id    INT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comment_task ON task_comment(task_id, created_at);

-- Лог отправленных напоминаний (защита от дублей)
CREATE TABLE IF NOT EXISTS reminder_log (
  id         SERIAL PRIMARY KEY,
  task_id    INT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel    TEXT NOT NULL DEFAULT 'telegram'
);
CREATE INDEX idx_remlog_task ON reminder_log(task_id);
