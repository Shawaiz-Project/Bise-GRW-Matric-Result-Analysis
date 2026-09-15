"""API endpoint tests."""
import unittest
from backend.app import create_app

class TestApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.client = cls.app.test_client()

    def test_frontend_routes(self):
        for route in ["/", "/admin", "/robots.txt", "/sitemap.xml"]:
            with self.subTest(route=route):
                res = self.client.get(route)
                self.assertEqual(res.status_code, 200)

    def test_datasets(self):
        res = self.client.get("/api/datasets")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertGreater(len(data["data"]), 0)

    def test_summary(self):
        res = self.client.get("/api/summary")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertTrue("total_extracted" in data["data"] or "total_candidates" in data["data"])
        self.assertIn("pass_percentage", data["data"])


    def test_students(self):
        res = self.client.get("/api/students?limit=10")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["data"]["students"]), 10)
        self.assertGreater(data["data"]["total"], 0)

    def test_student_detail(self):
        res = self.client.get("/api/students?limit=1")
        student = res.get_json()["data"]["students"][0]
        roll = student["roll_no"]
        detail_res = self.client.get(f"/api/students/{roll}")
        self.assertEqual(detail_res.status_code, 200)
        d = detail_res.get_json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["data"]["roll_no"], roll)

    def test_schools(self):
        res = self.client.get("/api/schools?limit=10")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["data"]["schools"]), 10)

    def test_rankings(self):
        res = self.client.get("/api/rankings/schools?limit=10")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["data"]), 10)

    def test_subjects(self):
        res = self.client.get("/api/subjects")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertIn("subjects", data["data"])

    def test_insights(self):
        res = self.client.get("/api/insights")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertIsInstance(data["data"], list)

    def test_quality(self):
        res = self.client.get("/api/quality")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])

    def test_csv_export(self):
        res = self.client.get("/api/export/students.csv?limit=5")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res.headers.get("Content-Type", ""))

if __name__ == "__main__":
    unittest.main()
