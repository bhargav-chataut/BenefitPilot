-- database: :memory:
CREATE TABLE plans (
  plan_id TEXT PRIMARY KEY,
  plan_name TEXT,
  plan_type TEXT,
  provider TEXT,

  annual_maximum INTEGER,
  deductible INTEGER,

  preventive_coverage INTEGER,
  basic_coverage INTEGER,
  major_coverage INTEGER,
  orthodontic_coverage INTEGER,

  in_network_supported BOOLEAN,
  out_of_network_supported BOOLEAN,

  plan_reset_month INTEGER,
  plan_reset_day INTEGER
);

INSERT INTO plans VALUES
(
  'PLAN_PPO_STANDARD',
  'DentalConnect PPO Standard',
  'PPO',
  'Lincoln Financial',

  1500,
  50,

  100,
  80,
  50,
  0,

  TRUE,
  TRUE,

  1,
  1
),

(
  'PLAN_PPO_PLUS',
  'DentalConnect PPO Plus',
  'PPO',
  'Lincoln Financial',

  2000,
  50,

  100,
  90,
  60,
  50,

  TRUE,
  TRUE,

  1,
  1
),

(
  'PLAN_INO',
  'DentalConnect In-Network Only',
  'INO',
  'Lincoln Financial',

  1750,
  25,

  100,
  80,
  50,
  0,

  TRUE,
  FALSE,

  1,
  1
);