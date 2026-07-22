import asyncio
import json
import os
import unittest
import httpx
from pathlib import Path
from unittest.mock import patch

from api.main import app
import openhfta_core.ai as ai

ROOT = Path(__file__).parent


class TestAPI(unittest.TestCase):
    def request(self, method, url, **kwargs):
        async def run():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.request(method, url, **kwargs)
        return asyncio.run(run())

    def test_health(self):
        response = self.request("GET", "/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertTrue(response.json()["core_available"])

    def test_bundled_prns_are_available(self):
        response = self.request("GET", "/api/prns")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["files"], sorted(path.name for path in (ROOT / "prns").glob("*.PRN")))

    def test_invalid_profile_is_rejected(self):
        response = self.request(
            "POST",
            "/api/analyze",
            data={"frequency": "20m"},
            files={"profile": ("bad.PRO", b"feet\n0 1\n0 2\n", "text/plain")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("increasing", response.json()["detail"])

    def test_reference_analysis(self):
        profile = ROOT / "test/pro/PR1T-torre1-332.00.PRO"
        response = self.request(
            "POST",
            "/api/analyze",
            data={"frequency": "20m", "units": "meters", "heights": "10"},
            files={"profile": (profile.name, profile.read_bytes(), "text/plain")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload["angles_deg"]), 140)
        self.assertAlmostEqual(max(payload["pattern_db"]), 9.999393, places=4)
        self.assertEqual(payload["configuration"]["antenna_phases"], [1, 1, 1, 1])
        self.assertIn("beamwidth_3db", payload["metrics"])
        self.assertAlmostEqual(payload["metrics"]["peak"]["angle_deg"], 27.25)
        self.assertIn("beginner", payload["interpretation"])

    def test_csv_export(self):
        profile = ROOT / "test/pro/PR1T-torre1-332.00.PRO"
        response = self.request("POST", "/api/analyze", data={"frequency": "20m", "export_format": "csv"}, files={"profile": (profile.name, profile.read_bytes(), "text/plain")})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"angle_deg,pattern_db"))

    def test_analysis_with_aoa_and_flat_reference(self):
        profile = ROOT / "test/pro/PR1T-torre1-332.00.PRO"
        prn = b"Test path\nElev      20m\n 1        10.0\n 5        20.0\n10        30.0\n"
        response = self.request(
            "POST", "/api/analyze", data={"frequency": "20m"},
            files={
                "profile": (profile.name, profile.read_bytes(), "text/plain"),
                "aoa_file": ("TEST.PRN", prn, "text/plain"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["aoa"]["band"], "20m")
        self.assertEqual(len(payload["flat_pattern_db"]), len(payload["pattern_db"]))
        self.assertIn("figure_of_merit_db", payload["metrics"])

    def test_compare_scenarios(self):
        profile = ROOT / "test/pro/PR1T-torre1-332.00.PRO"
        response = self.request("POST", "/api/compare", data={"frequency": "20m", "heights_a": "10", "antenna_type_a": "Dipole", "heights_b": "10 20", "antenna_type_b": "2-Ele"}, files={"profile": (profile.name, profile.read_bytes(), "text/plain")})
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload["scenarios"]), 2)
        self.assertIn("rmse_db", payload["comparison"])
        self.assertIn("headline", payload["interpretation"])

    def test_compare_four_scenarios_and_profiles(self):
        profile = ROOT / "test/pro/PR1T-torre1-332.00.PRO"
        profile_bytes = profile.read_bytes()
        configs = [
            {"name": "Norte", "heights": "10", "antenna_type": "Dipole"},
            {"name": "Leste", "heights": "15", "antenna_type": "Dipole"},
            {"name": "Sul", "heights": "10 20", "antenna_type": "2-Ele"},
            {"name": "Oeste", "heights": "12 22*", "antenna_type": "2-Ele"},
        ]
        files = [
            ("profiles", (f"{name}.PRO", profile_bytes, "text/plain"))
            for name in ("north", "east", "south", "west")
        ]
        response = self.request(
            "POST", "/api/compare",
            data={"frequency": "20m", "scenario_configs": json.dumps(configs)},
            files=files,
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(payload["scenarios"]), 4)
        self.assertEqual(len(payload["comparison"]["pairwise"]), 3)
        self.assertEqual(len(payload["scenarios"][0]["profile"]["distances_m"]), 148)
        self.assertTrue(payload["limitations"])

    def test_ai_status_without_key(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}), patch.object(ai, "_DOTENV_VALUES", {**ai._DOTENV_VALUES, "OPENROUTER_API_KEY": ""}):
            response = self.request("GET", "/api/ai/status")
        self.assertEqual(response.status_code, 200)
        self.assertIn("enabled", response.json())

    def test_ai_explain_requires_configuration(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}), patch.object(ai, "_DOTENV_VALUES", {**ai._DOTENV_VALUES, "OPENROUTER_API_KEY": ""}):
            response = self.request("POST", "/api/ai/explain", json={"analysis": {"metrics": {}}})
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
