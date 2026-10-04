-- Table 3: benefit_usage

CREATE TABLE benefit_usage (
  employee_id TEXT PRIMARY KEY,

  annual_benefit_used INTEGER NOT NULL DEFAULT 0,
  deductible_used INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (employee_id)
    REFERENCES employees(employee_id)
);