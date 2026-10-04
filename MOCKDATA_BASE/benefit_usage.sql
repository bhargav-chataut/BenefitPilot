-- database: :memory:
CREATE TABLE benefit_usage (
  employee_id TEXT PRIMARY KEY,

  annual_benefit_used INTEGER NOT NULL DEFAULT 0,
  deductible_used INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (employee_id)
    REFERENCES employees(employee_id)
);

INSERT INTO benefit_usage (employee_id, annual_benefit_used, deductible_used)
VALUES
  ('EMP001', 980, 50),
  ('EMP002', 620, 50),
  ('EMP003', 740, 25),
  ('EMP004', 430, 50),
  ('EMP005', 810, 50),
  ('EMP006', 560, 50),
  ('EMP007', 1180, 25),
  ('EMP008', 350, 50),
  ('EMP009', 1250, 50),
  ('EMP010', 690, 50),
  ('EMP011', 900, 25),
  ('EMP012', 520, 50),
  ('EMP013', 760, 50),
  ('EMP014', 410, 50),
  ('EMP015', 1500, 25),
  ('EMP016', 275, 50),
  ('EMP017', 1640, 50),
  ('EMP018', 480, 50),
  ('EMP019', 700, 25),
  ('EMP020', 850, 50),
  ('EMP021', 250, 50),
  ('EMP022', 200, 50),
  ('EMP023', 600, 50);


SELECT
  e.employee_id,
  e.first_name,
  e.last_name,
  e.email,
  e.employer,

  p.plan_id,
  p.plan_name,
  p.plan_type,
  p.provider,

  p.annual_maximum,
  p.deductible,
  p.preventive_coverage,
  p.basic_coverage,
  p.major_coverage,
  p.orthodontic_coverage,

  p.in_network_supported,
  p.out_of_network_supported,

  p.plan_reset_month,
  p.plan_reset_day,

  b.annual_benefit_used,
  b.deductible_used,

  (p.annual_maximum - b.annual_benefit_used)
    AS annual_benefit_remaining,

  CASE
    WHEN (p.deductible - b.deductible_used) < 0 THEN 0
    ELSE (p.deductible - b.deductible_used)
  END AS deductible_remaining,

  e.hsa_enrolled,
  e.hsa_balance,
  e.fsa_enrolled,
  e.fsa_balance

FROM employees e

JOIN plans p
  ON e.plan_id = p.plan_id

JOIN benefit_usage b
  ON e.employee_id = b.employee_id

WHERE e.email = 'alex.carter@usm-demo.com';