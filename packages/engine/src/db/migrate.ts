import { sqlDb } from './client';

/**
 * 首启建表（幂等，IF NOT EXISTS）。P0 用原生 DDL 而非 drizzle-kit push，
 * 以保证启动时自包含、零额外步骤。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  causation_id TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_agg ON events(aggregate_id);
CREATE INDEX IF NOT EXISTS idx_events_type_t ON events(type, occurred_at);

CREATE TABLE IF NOT EXISTS domains (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_quarter_focus INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  para_type TEXT NOT NULL,
  goal_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  pdca_state TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain_key TEXT NOT NULL REFERENCES domains(key),
  project_id TEXT REFERENCES projects(id),
  importance INTEGER NOT NULL DEFAULT 0,
  urgency INTEGER NOT NULL DEFAULT 0,
  is_mit INTEGER NOT NULL DEFAULT 0,
  mit_order INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',
  scheduled_start TEXT,
  scheduled_end TEXT,
  due_at TEXT,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completion_quality INTEGER,
  attention_peak INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(domain_key, status);
CREATE INDEX IF NOT EXISTS idx_tasks_mit ON tasks(is_mit, mit_order);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  links TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  embedded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_embedded ON notes(embedded_at);

CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  attention INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  domain_key TEXT,
  effort_budget TEXT NOT NULL DEFAULT 'tbd',
  status TEXT NOT NULL DEFAULT 'incubating',
  linked_task_id TEXT,
  linked_project_id TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  linked_note_count INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  converted_at TEXT,
  archived_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interest_status ON interests(status);
CREATE INDEX IF NOT EXISTS idx_interest_domain ON interests(domain_key);

CREATE VIEW IF NOT EXISTS task_quadrant AS
SELECT id,
  CASE WHEN importance = 1 AND urgency = 1 THEN 'q1'
       WHEN importance = 1 AND urgency = 0 THEN 'q2'
       WHEN importance = 0 AND urgency = 1 THEN 'q3'
       ELSE 'q4' END AS quadrant
FROM tasks;

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  creditor TEXT NOT NULL,
  principal REAL NOT NULL,
  apr REAL,
  min_payment REAL,
  due_day INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);

CREATE TABLE IF NOT EXISTS incomes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  received_at TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incomes_at ON incomes(received_at);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  merchant TEXT,
  occurred_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_at ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(kind);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  value REAL NOT NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_class ON assets(asset_class);

CREATE TABLE IF NOT EXISTS reminder_clocks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain_key TEXT NOT NULL REFERENCES domains(key),
  period_rule TEXT NOT NULL,
  lead_chain TEXT NOT NULL DEFAULT '[7,1,0]',
  note_linked TEXT,
  next_fire_at TEXT NOT NULL,
  last_fired_at TEXT,
  last_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_fire ON reminder_clocks(next_fire_at, status);

-- 心流仪表盘：专注时段记录（认知资源管理）
CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  domain_key TEXT REFERENCES domains(key),
  project_id TEXT REFERENCES projects(id),
  attention_type TEXT NOT NULL DEFAULT 'deep',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  score INTEGER,
  energy_start INTEGER,
  energy_end INTEGER,
  interruptions TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_started ON focus_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_focus_domain ON focus_sessions(domain_key);
CREATE INDEX IF NOT EXISTS idx_focus_project ON focus_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);
`;

export function migrate(): void {
  sqlDb!.exec(DDL);
  // 存量库增量补列：notes 增加 kind / task_id（已存在则忽略报错）
  addColumnIfMissing('notes', 'kind', "TEXT NOT NULL DEFAULT 'idea'");
  addColumnIfMissing('notes', 'task_id', 'TEXT');
  // MIT 完成回写：tasks 增加完成质量 / 注意力峰值
  addColumnIfMissing('tasks', 'completion_quality', 'INTEGER');
  addColumnIfMissing('tasks', 'attention_peak', 'INTEGER');
  // 日历/看板：tasks 增加描述 / 优先级
  addColumnIfMissing('tasks', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('tasks', 'priority', "TEXT NOT NULL DEFAULT 'medium'");

  // —— 财务模块对齐 life-manager（增量补列，兼容旧库）——
  // 债务：还款模型
  addColumnIfMissing('debts', 'debt_type', "TEXT NOT NULL DEFAULT 'other'");
  addColumnIfMissing('debts', 'term_months', 'INTEGER');
  addColumnIfMissing('debts', 'repayment_method', "TEXT NOT NULL DEFAULT 'equal_installment'");
  addColumnIfMissing('debts', 'start_date', 'TEXT');
  addColumnIfMissing('debts', 'rate_type', 'TEXT');
  addColumnIfMissing('debts', 'base_rate', 'REAL');
  addColumnIfMissing('debts', 'rate_spread', 'REAL');
  addColumnIfMissing('debts', 'rate_adjustments', 'TEXT');
  addColumnIfMissing('debts', 'prepayments', 'TEXT');
  addColumnIfMissing('debts', 'parent_debt_id', 'TEXT');
  addColumnIfMissing('debts', 'note', "TEXT NOT NULL DEFAULT ''");
  // P0-1 重定价规则自动化
  addColumnIfMissing('debts', 'repricing', 'TEXT');
  // 收入源模型
  addColumnIfMissing('incomes', 'income_type', "TEXT NOT NULL DEFAULT 'salary'");
  addColumnIfMissing('incomes', 'monthly_avg', 'REAL');
  addColumnIfMissing('incomes', 'is_fixed', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('incomes', 'income_mode', "TEXT NOT NULL DEFAULT 'monthly'");
  addColumnIfMissing('incomes', 'pay_day', 'INTEGER');
  addColumnIfMissing('incomes', 'adjustment_day', 'INTEGER');
  addColumnIfMissing('incomes', 'rate_adjustments', 'TEXT');
  // 交易流水：债务关联
  addColumnIfMissing('transactions', 'debt_id', 'TEXT');
  addColumnIfMissing('transactions', 'income_source_id', 'TEXT');
  // 资产：关联收入源
  addColumnIfMissing('assets', 'linked_income_source_id', 'TEXT');
}

/** 仅在列不存在时 ALTER，避免重复列报错中断启动 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  try {
    sqlDb!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    /* 列已存在 → 跳过 */
  }
}
