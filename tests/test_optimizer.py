import unittest
from unittest.mock import patch
from backend.server import build_options, calculate_schedule, find_best_options, normalize_settings, benefits_response, project_response, optimize_response


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
        self.assertEqual(options["budget"][0], [2, 3])
        self.assertEqual(options["balanced"][0], [0, 3])
        self.assertEqual(options["premium"][0], [0, 0])
        # Without year-boundary savings, affordability spreads the payments.
        employee.update(remaining_maximum=10000, annual_maximum=10000)
        options = find_best_options(procedures, employee, {"budget": "$250"})
        self.assertEqual(options["budget"][0], [3, 3])
        self.assertEqual(options["balanced"][0], [0, 1])
        self.assertEqual(options["premium"][0], [0, 0])

    def test_all_three_plans_can_differ(self):
        employee = dict(self.employee, remaining_maximum=1200, annual_maximum=1200, deductible=0)
        options = find_best_options([self.procedure(1000) for _ in range(3)], employee,
                                    {"budget": "$600"})
        self.assertEqual(options["budget"][0], [2, 3, 3])
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

    def test_explicit_priority_overrides_automatic(self):
        for priority, expected in [("Lowest cost", "budget"), ("Balanced", "balanced"), ("Fastest", "premium")]:
            options = build_options([self.procedure()], self.employee,
                                    normalize_settings({"priority": priority}))
            chosen = [o for o in options if o["recommended"]]
            self.assertEqual([o["id"] for o in chosen], [expected])
            self.assertIn("you selected", chosen[0]["reasoning"])

    def test_automatic_budget_when_benefits_exhausted(self):
        options = build_options([self.procedure()], self.employee, normalize_settings(None))
        chosen = next(o for o in options if o["recommended"])
        self.assertEqual(chosen["id"], "budget")
        self.assertIn("nearly exhausted", chosen["reasoning"])
        self.assertIn("$200.00 versus Fastest", chosen["reasoning"])

    def test_automatic_balanced_for_monthly_affordability(self):
        employee = dict(self.employee, remaining_maximum=10000, annual_maximum=10000)
        options = build_options([self.procedure(1000), self.procedure(1000)], employee,
                                normalize_settings({"budget": "$250"}))
        self.assertEqual(next(o["id"] for o in options if o["recommended"]), "balanced")

    def test_automatic_fastest_for_identical_results(self):
        options = build_options([self.procedure(canDelay=False)], self.employee, normalize_settings(None))
        self.assertEqual(next(o["id"] for o in options if o["recommended"]), "premium")
        self.assertEqual(len({o["youPay"] for o in options}), 1)
        self.assertEqual(options[1]["description"], "Same schedule also satisfies your monthly budget.")
        self.assertIn("earliest feasible", options[2]["description"])

    def test_reasoning_contains_plan_facts_for_every_option(self):
        employee = dict(self.employee, remaining_deductible=50)
        options = build_options([self.procedure()], employee, normalize_settings(None))
        for option in options:
            reason = option["reasoning"]
            self.assertIn("$200.00 of current-year benefits", reason)
            self.assertIn("$50.00 left on your current-year deductible", reason)
            self.assertIn("$500.00 monthly budget", reason)
            self.assertIn(option["completionMonth"], reason)
            if 3 in option["schedule"]:
                self.assertIn("same plan renews", reason)
                self.assertIn("$100.00 deductible", reason)
            else:
                self.assertIn("No procedures move", reason)

    def test_over_budget_reasoning_does_not_claim_affordability(self):
        options = build_options([self.procedure(canDelay=False)], self.employee,
                                normalize_settings({"budget": "$1"}))
        self.assertIn("No schedule fits", options[1]["description"])
        self.assertIn("above your $1.00 monthly budget", options[1]["reasoning"])

    def test_budget_latest_tie_respects_deadline_and_fixed_procedures(self):
        employee = dict(self.employee, remaining_maximum=10000, annual_maximum=10000)
        procedures = [self.procedure(canDelay=False), self.procedure(canDelay=True)]
        options = build_options(procedures, employee, normalize_settings({"latestMonth": "Dec"}))
        self.assertEqual(options[0]["schedule"], [0, 2])
        self.assertEqual(options[2]["schedule"], [0, 0])
        self.assertEqual(options[0]["youPay"], options[2]["youPay"])
        self.assertIn("latest feasible completion and latest overall schedule among cost ties", options[0]["reasoning"])
        self.assertIn("Savings compared with Fastest: $0.00", options[0]["reasoning"])
        self.assertIn("from Oct to Dec", options[0]["reasoning"])
        self.assertIn("No procedures move into the next benefit year", options[0]["reasoning"])

    def test_balanced_peak_precedes_cost_and_fastest_delay_precedes_cost(self):
        # Candidate scores isolate ranking from the separate coverage calculation.
        schedules = [[0, 0], [0, 1], [1, 1], [0, 2]]
        scores = [(200, 200), (220, 110), (180, 180), (220, 110)]
        with patch("backend.server.generate_schedules", return_value=iter(schedules)), patch(
            "backend.server.calculate_schedule",
            side_effect=[dict(youPay=cost, peakMonthlyPayment=peak) for cost, peak in scores],
        ):
            options = find_best_options([self.procedure(), self.procedure()], self.employee,
                                        {"budget": "$250"})
        self.assertEqual(options["balanced"][0], [0, 1])
        self.assertEqual(options["budget"][0], [1, 1])
        self.assertEqual(options["premium"][0], [0, 0])

    def test_reasoning_reports_savings_and_payment_impact(self):
        options = build_options([self.procedure(canDelay=True)], self.employee, normalize_settings(None))
        reason = options[0]["reasoning"]
        self.assertIn("Saves $200.00 compared with Fastest", reason)
        self.assertIn("Peak monthly payment is $200.00 lower", reason)
        self.assertIn("$400.00 in estimated next-year coverage", reason)
        self.assertIn("from Oct to Jan", reason)

    def test_demo_network_multiplier_preserves_calculation(self):
        employee = dict(self.employee, remaining_maximum=1000)
        result = calculate_schedule([self.procedure()], [0], employee, "out")
        self.assertEqual(result["planPays"], 336)
        self.assertEqual(result["youPay"], 264)

    def test_dashboard_and_treatment_numbers_share_employee_plan(self):
        benefits = benefits_response(None)
        response = optimize_response({"procedures": [self.procedure()]})
        self.assertEqual(response["insurance"], benefits["insurance"])
        self.assertEqual(sum(month["amount"] for month in benefits["months"]), benefits["used"])
        self.assertEqual(benefits["used"] + benefits["remaining"], benefits["annualMax"])
        for option in response["options"]:
            projection = project_response({"procedures": [self.procedure()], "schedule": option["schedule"]})
            scenario = projection["scenario"]
            self.assertEqual(scenario, option["scenario"]["in"])
            self.assertAlmostEqual(sum(scenario["monthlyBenefitPayments"][:3]), scenario["benefitUsed"])
            self.assertEqual(scenario["monthlyBenefitPayments"][3], scenario["nextYearUsed"])
            self.assertEqual(scenario["benefitRemaining"], benefits["remaining"] - scenario["benefitUsed"])

    def test_projection_rejects_invalid_or_disallowed_schedules(self):
        for schedule in [[3], [9], [], [True]]:
            with self.assertRaises(ValueError):
                project_response({"procedures": [self.procedure(canDelay=False)], "schedule": schedule})

    def test_invalid_constraints(self):
        for procedure in [self.procedure(float("nan")), self.procedure(dependsOn=[8])]:
            with self.assertRaises(ValueError):
                find_best_options([procedure], self.employee)
        with self.assertRaises(ValueError):
            find_best_options([self.procedure()], self.employee, {"budget": "invalid"})


if __name__ == "__main__":
    unittest.main()
