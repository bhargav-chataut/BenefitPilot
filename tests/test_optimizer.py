import unittest
from backend.server import build_options, calculate_schedule, find_best_options, normalize_settings


class OptimizerTests(unittest.TestCase):
    def setUp(self):
        self.employee = dict(
            annual_maximum=1000, remaining_maximum=200,
            deductible=100, remaining_deductible=0,
            preventive_rate=100, basic_rate=80, major_rate=50,
            orthodontic_rate=50, in_network_supported=True,
            out_of_network_supported=True,
        )

    def procedure(self, cost=600, **kwargs):
        return dict(name="Treatment", code="D2391", cost=cost, category="basic", **kwargs)

    def test_year_reset_and_total_payments(self):
        result = calculate_schedule([self.procedure(), self.procedure()], [0, 3], self.employee)
        self.assertEqual(result["benefitUsed"], 200)
        self.assertEqual(result["nextYearUsed"], 400)
        self.assertEqual(result["planPays"], 600)
        self.assertEqual(result["youPay"], 600)
        self.assertEqual(result["monthlyPayments"], [400, 0, 0, 200])

    def test_next_year_cap(self):
        result = calculate_schedule([self.procedure(3000)], [3], self.employee)
        self.assertEqual(result["nextYearUsed"], 1000)
        self.assertEqual(result["youPay"], 2000)

    def test_three_distinct_objectives(self):
        employee = dict(self.employee, remaining_maximum=600, deductible=0)
        procedures = [self.procedure(1000), self.procedure(1000)]
        options = find_best_options(procedures, employee, {"budget": "$1,000"})
        self.assertEqual(options["budget"][0], [0, 3])
        self.assertEqual(options["balanced"][0], [0, 3])
        self.assertEqual(options["premium"][0], [0, 0])
        # Without year-boundary savings, affordability spreads the payments.
        employee.update(remaining_maximum=10000, annual_maximum=10000)
        options = find_best_options(procedures, employee, {"budget": "$250"})
        self.assertEqual(options["budget"][0], [0, 0])
        self.assertEqual(options["balanced"][0], [0, 1])
        self.assertEqual(options["premium"][0], [0, 0])

    def test_all_three_plans_can_differ(self):
        employee = dict(self.employee, remaining_maximum=1200, annual_maximum=1200, deductible=0)
        options = find_best_options([self.procedure(1000) for _ in range(3)], employee,
                                    {"budget": "$600"})
        self.assertEqual(options["budget"][0], [0, 0, 3])
        self.assertEqual(options["balanced"][0], [0, 1, 3])
        self.assertEqual(options["premium"][0], [0, 0, 0])
        self.assertEqual(options["balanced"][1]["peakMonthlyPayment"], 600)

    def test_affordability_when_budget_cannot_be_met(self):
        options = find_best_options([self.procedure(), self.procedure()], self.employee,
                                    {"budget": "$1", "latestMonth": "Dec"})
        self.assertEqual(options["balanced"][1]["peakMonthlyPayment"], 600)
        self.assertNotEqual(options["balanced"][0][0], options["balanced"][0][1])

    def test_deadline_urgency_dependencies(self):
        procedures = [self.procedure(canDelay=False), self.procedure(dependsOn=[0])]
        options = find_best_options(procedures, self.employee, {"latestMonth": "Nov"})
        for schedule, _ in options.values():
            self.assertEqual(schedule, [0, 1])
        with self.assertRaisesRegex(ValueError, "No schedule"):
            find_best_options(procedures, self.employee, {"latestMonth": "Oct"})

    def test_identical_options_and_api_fields(self):
        options = build_options([self.procedure(canDelay=False)], self.employee,
                                normalize_settings({"priority": "Fastest"}))
        self.assertEqual([o["id"] for o in options], ["budget", "balanced", "premium"])
        for option in options:
            self.assertEqual(len(option["sameScheduleAs"]), 2)
            self.assertEqual(option["range"], "Oct 2026")
            self.assertEqual(option["recommended"], option["id"] == "premium")
            self.assertEqual(option["youPay"] + option["planPays"], 600)

    def test_out_of_network_cap_tracks_actual_payment(self):
        result = calculate_schedule([self.procedure()], [0], self.employee, "out")
        self.assertEqual(result["planPays"], 200)
        self.assertEqual(result["benefitRemaining"], 0)

    def test_invalid_constraints(self):
        for procedure in [self.procedure(float("nan")), self.procedure(dependsOn=[8])]:
            with self.assertRaises(ValueError):
                find_best_options([procedure], self.employee)
        with self.assertRaises(ValueError):
            find_best_options([self.procedure()], self.employee, {"budget": "invalid"})


if __name__ == "__main__":
    unittest.main()
