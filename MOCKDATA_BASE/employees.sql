-- database: :memory:
CREATE TABLE employees (
  employee_id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  employer TEXT,
  plan_id TEXT,

  hsa_enrolled BOOLEAN,
  hsa_balance INTEGER,

  fsa_enrolled BOOLEAN,
  fsa_balance INTEGER,

  FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
);

INSERT INTO employees VALUES
(
  'EMP1001',
  'Alex',
  'Carter',
  'alex@acme.com',
  'demo_hash',
  'Acme Corporation',
  'PLAN_PPO_PLUS',

  TRUE,
  500,

  TRUE,
  300
),

(
  'EMP1002',
  'Maya',
  'Patel',
  'maya@acme.com',
  'demo_hash',
  'Acme Corporation',
  'PLAN_PPO_STANDARD',

  FALSE,
  0,

  TRUE,
  400
),

(
  'EMP1003',
  'Jordan',
  'Lee',
  'jordan@acme.com',
  'demo_hash',
  'Acme Corporation',
  'PLAN_INO',

  TRUE,
  900,

  FALSE,
  0
);