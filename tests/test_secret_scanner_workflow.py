# SPDX-License-Identifier: MPL-2.0
"""Configuration regression tests for the reusable secret scanner caller.

Requires PyYAML. Run from the repository root with:
    python3 -m unittest discover -s tests -p 'test_secret_scanner_workflow.py'

These tests inspect the caller contract; they do not execute the remote scanner
or validate the organisation's Actions allowlist.
"""

from pathlib import Path
import unittest

import yaml


WORKFLOW_PATH = (
    Path(__file__).resolve().parents[1] / ".github/workflows/secret-scanner.yml"
)


class SecretScannerWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # BaseLoader retains the Actions key `on` as a string instead of
        # interpreting it as a YAML 1.1 boolean. All scalar values are strings.
        cls.workflow = yaml.load(
            WORKFLOW_PATH.read_text(encoding="utf-8"), Loader=yaml.BaseLoader
        )

    def test_scanner_does_not_receive_inherited_or_explicit_secrets(self):
        # Reject the entire key, including an explicit mapping or empty value,
        # so replacing `inherit` with named secrets cannot undo the isolation.
        self.assertNotIn("secrets", self.workflow["jobs"]["scan"])

    def test_scanner_inputs_do_not_forward_secret_expressions(self):
        # Cover alternate forwarding paths such as reusable workflow inputs.
        scan = self.workflow["jobs"]["scan"]
        self.assertNotRegex(yaml.dump(scan), r"(?i)\bsecrets\s*(?:\.|\[)")

    def test_workflow_grants_only_read_access_to_contents(self):
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})

    def test_scanner_cannot_override_the_minimum_permissions(self):
        scan = self.workflow["jobs"]["scan"]
        self.assertEqual(
            scan.get("permissions", self.workflow["permissions"]),
            {"contents": "read"},
        )

    def test_scanner_still_calls_the_reviewed_shared_revision(self):
        self.assertEqual(
            self.workflow["jobs"]["scan"]["uses"],
            "hyperpolymath/standards/.github/workflows/"
            "secret-scanner-reusable.yml@"
            "571cc734cd69fb846032ec77a662aa8ee4fc32cd",
        )

    def test_pull_requests_and_primary_branch_pushes_remain_covered(self):
        triggers = self.workflow["on"]
        self.assertEqual(set(triggers), {"pull_request", "push"})
        # No branch or path filters may silently exclude pull requests.
        self.assertIn(triggers["pull_request"], ("", {}))
        self.assertEqual(
            triggers["push"], {"branches": ["main", "master"]}
        )

    def test_required_scan_is_not_conditional_or_allowed_to_fail(self):
        scan = self.workflow["jobs"]["scan"]
        self.assertNotIn("if", scan)
        self.assertIn(scan.get("continue-on-error", "false"), ("false",))


if __name__ == "__main__":
    unittest.main()
