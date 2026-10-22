#!/usr/bin/env python3
"""Official Draft 2020-12 candidate T01 Schema conformance. Does NOT prove native correction/ACL."""
from __future__ import annotations
import copy
import json
import unittest
from pathlib import Path
try:
    from jsonschema import Draft202012Validator
except ImportError as exc:
    raise SystemExit("Install jsonschema (Draft 2020-12) to run T01 source tests") from exc

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas/github/v4.16/report.schema.json"
FIXTURES = ROOT / "tests/fixtures/v416/t01/scenarios.json"
A = "a" * 40
B = "b" * 40
D = "d" * 64
ISSUE = "https://github.com/kaicreator-mm/ai-development-standard/issues/1265"
COMMENT = ISSUE + "#issuecomment-1234"

def currentness(state: str = "UNKNOWN") -> dict:
    return {"state": state, "source_refs": [], "limits": []}

def subject(pinned: bool = False) -> dict:
    return {
        "repository": "kaicreator-mm/ai-development-standard", "issue_ref": ISSUE,
        "task_ref": "#1265", "attempt_ref": "attempt:source-01",
        "attempt_binding": "COLLECTOR_ONLY",
        "source_sha": A if pinned else None,
        "ads_revision": B, "ads_profile": "ads/github/v5:report",
        "currentness": currentness("CURRENT" if pinned else "UNKNOWN"),
        "publisher_source_sha": B, "source_status": "PINNED" if pinned else "UNPINNED",
        "source_currentness": "CURRENT" if pinned else "UNKNOWN",
        "source_reason": None if pinned else "No immutable execution bytes",
        "collector_observation_refs": [] if pinned else ["public:qualified-collector-observation"]
    }

def common(kind: str, pinned: bool) -> dict:
    return {
        "report_id": "t01-001", "revision": 1, "publisher_namespace": "collector:example",
        "report_kind": kind, "subject": subject(pinned),
        "actor": {"role": "builder", "operator_kind": "other", "operator_id": "t01-fixture",
                  "session_ref": "t01-source", "transport_actor": None},
        "observed_at": "2026-10-22T12:00:00Z", "source_refs": [], "limits": [],
        "supersedes": None,
        "publication": {"classification": "PUBLISHABLE", "clearance_ref": "source-authority:example",
                        "projection_digest": D}
    }

def valid(kind: str) -> dict:
    if kind == "summary":
        d = common("EXECUTION_SUMMARY", False)
        d.update({"capture_coverage": "UNKNOWN", "metrics": [],
                  "cost": {"value": None, "currency": None, "basis": "UNKNOWN", "pricing_basis": None,
                           "epistemic": "UNKNOWN", "source_refs": [], "currentness": currentness(),
                           "accounting_ref": None, "economic_scope_ref": None,
                           "billing_window_ref": None, "cost_category": None},
                  "aggregation": {"mode": "LEAF_ATTEMPTS_ONLY", "attempt_refs": ["attempt:source-01"],
                                  "excluded_attempt_refs": [], "limits": []},
                  "verifier": {"subject_sha": None, "source_refs": [], "checked": [], "failed": [],
                               "skipped": [], "unchecked": [], "coverage": "UNKNOWN",
                               "epistemic": "UNKNOWN", "currentness": currentness(),
                               "status": "NOT_RUN"},
                  "manifest_ref": "private:manifest", "manifest_sha256": D,
                  "manifest_access": "PROJECT_PRIVATE",
                  "learning": {"state": "NONE_MATERIAL", "source_refs": []}})
    elif kind == "correction":
        d = common("EXECUTION_CORRECTION", True)
        d.update({"notice": "REVOKE", "reason": "Authorized notice candidate",
                  "notice_publisher_source_sha": B,
                  "target": {"repository": "kaicreator-mm/ai-development-standard",
                             "comment_id": 1234, "comment_ref": COMMENT,
                             "issue_ref": ISSUE, "task_ref": "#1265", "attempt_ref": "attempt:source-01",
                             "ads_profile": "ads/github/v5:report", "target_source_status": "UNPINNED",
                             "target_source_sha": None, "report_id": "t01-old",
                             "revision": 1, "report_kind": "EXECUTION_SUMMARY",
                             "publisher_namespace": "collector:example", "data_digest": D}})
    elif kind == "feedback":
        d = common("EXPERIENCE_USE_FEEDBACK", True)
        d.update({"publisher_source_sha": B, "ads_subject_sha": B, "experience_ref": "experience:1",
                  "procedure_revision": "v1", "phase": "PRESENTED",
                  "epistemic": "OBSERVED", "verifier_refs": []})
    elif kind == "associated":
        d = valid("summary")["data"]
        d["subject"] = subject(True)
        d["revision"] = 2
        d["supersedes"] = {"revision": 1, "data_digest": D, "comment_ref": COMMENT}
        d["source_association"] = {"original_material_sha256": D, "source_sha": A,
                                   "artifact_witness_refs": ["public:exact-original-bytes"],
                                   "association_currentness": "CURRENT"}
    else:
        raise AssertionError(kind)
    return {"schema": "ads/github/v5", "kind": "report", "data": d}

def mutate(obj: dict, actions: list) -> dict:
    x = copy.deepcopy(obj)
    for item in actions:
        parts = item["path"].split(".")
        parent = x
        for p in parts[:-1]:
            parent = parent[p]
        if item.get("remove"):
            parent.pop(parts[-1], None)
        else:
            parent[parts[-1]] = item["value"]
    return x

class T01StrictReportV5Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf8"))
        cls.fixtures = json.loads(FIXTURES.read_text(encoding="utf8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)

    def test_fixture_uniqueness_and_coverage(self):
        self.assertEqual(self.fixtures["schema"], "ads/v416-t01-fixtures/v1")
        ids = [x["id"] for x in self.fixtures["cases"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 25)
        for case in ("C01", "C06", "C07", "C08", "C09", "C10"):
            self.assertTrue(any(x.startswith(case + "_") for x in ids), case)

    def test_positive_negative_json_schema(self):
        for case in self.fixtures["cases"]:
            obj = mutate(valid(case["base"]), case["mutations"])
            errors = list(self.validator.iter_errors(obj))
            with self.subTest(case=case["id"]):
                self.assertEqual(not errors, case["valid"],
                                 "; ".join(x.message for x in errors[:4]))

    def test_cross_object_checks_not_schema_authority(self):
        # JSON Schema cannot prove two independently sourced immutable subjects equal;
        # these must be resolved against actual native GitHub evidence and owner grants.
        correction = valid("correction")
        correction["data"]["notice_publisher_source_sha"] = A
        self.assertFalse(list(self.validator.iter_errors(correction)),
                         "cross-field equality is an explicit native authority check")
        self.assertNotEqual(correction["data"]["notice_publisher_source_sha"],
                            correction["data"]["subject"]["publisher_source_sha"])

    def test_legacy_profile_is_separate(self):
        self.assertEqual(self.schema["properties"]["schema"]["const"], "ads/github/v5")
        self.assertEqual(self.schema["properties"]["kind"]["const"], "report")
        self.assertEqual(self.schema["$defs"]["subject"]["properties"]["ads_profile"]["const"],
                         "ads/github/v5:report")

if __name__ == "__main__":
    unittest.main(verbosity=2)
