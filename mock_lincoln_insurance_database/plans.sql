-- database: :memory:

PRAGMA foreign_keys = ON;

-- =========================================================
-- BenefitPilot Mock Database
-- 3-table version:
--   1) plans
--   2) employees
--   3) benefit_usage
-- =========================================================

-- -------------------------
-- 1. PLANS
-- -------------------------
CREATE TABLE plans (
  plan_id TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  provider TEXT NOT NULL,

  annual_maximum INTEGER NOT NULL,
  deductible INTEGER NOT NULL,

  preventive_coverage INTEGER NOT NULL,
  basic_coverage INTEGER NOT NULL,
  major_coverage INTEGER NOT NULL,
  orthodontic_coverage INTEGER NOT NULL DEFAULT 0,

  in_network_supported INTEGER NOT NULL DEFAULT 1,
  out_of_network_supported INTEGER NOT NULL DEFAULT 1,

  plan_reset_month INTEGER NOT NULL DEFAULT 1,
  plan_reset_day INTEGER NOT NULL DEFAULT 1
);

INSERT INTO plans (
  plan_id,
  plan_name,
  plan_type,
  provider,
  annual_maximum,
  deductible,
  preventive_coverage,
  basic_coverage,
  major_coverage,
  orthodontic_coverage,
  in_network_supported,
  out_of_network_supported,
  plan_reset_month,
  plan_reset_day
)
VALUES
(
  'PLAN_STANDARD',
  'Dental PPO Standard',
  'PPO',
  'Lincoln Financial',
  1500,
  50,
  100,
  80,
  50,
  0,
  1,
  1,
  1,
  1
),
(
  'PLAN_PLUS',
  'Dental PPO Plus',
  'PPO',
  'Lincoln Financial',
  2000,
  50,
  100,
  90,
  60,
  50,
  1,
  1,
  1,
  1
),
(
  'PLAN_INO',
  'Dental In-Network',
  'INO',
  'Lincoln Financial',
  1750,
  25,
  100,
  80,
  50,
  0,
  1,
  0,
  1,
  1
);