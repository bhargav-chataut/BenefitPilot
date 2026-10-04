-- database: :memory:
CREATE TABLE upcoming_care (
  care_id INTEGER PRIMARY KEY,
  employee_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  procedure_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  estimated_cost INTEGER NOT NULL CHECK (estimated_cost >= 0),
  estimated_benefit INTEGER NOT NULL CHECK (estimated_benefit >= 0),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),

  FOREIGN KEY (employee_id)
    REFERENCES employees(employee_id)
);

INSERT INTO upcoming_care (
  care_id,
  employee_id,
  scheduled_date,
  procedure_name,
  provider,
  estimated_cost,
  estimated_benefit,
  status
)
VALUES
  (1, 'EMP021', '2026-11-14', 'Crown consultation', 'Codelinc Dental', 350, 210, 'scheduled'),
  (2, 'EMP021', '2026-12-05', 'Filling', 'Codelinc Dental', 225, 75, 'scheduled');
