#!/usr/bin/env bun
// SPDX-License-Identifier: MPL-2.0
// Configuration checks for the secret scanner caller
// (.github/workflows/secret-scanner.yml). They read the workflow file only;
// they do not invoke GitHub Actions or the remote scanner.
//
// Run from anywhere with:
//     bun tests/secret-scanner-workflow.js
// Exit 0 when every check passes, 1 when any fails.
// Needs only Bun (built-in YAML parser); no packages.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const WORKFLOW_PATH = join(dirname(import.meta.path), "..", ".github", "workflows", "secret-scanner.yml");

// Every scalar becomes text and an empty value becomes "", so the checks
// compare plain strings whatever YAML type a value would otherwise take
// (the GitHub Actions key `on` stays the string "on").
function asText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asText(v)]));
  }
  return String(value);
}

function isMap(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function equal(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b)) return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return equal(ka, kb) && ka.every((k) => equal(a[k], b[k]));
  }
  return a === b;
}

function sameSet(a, b) {
  return equal([...new Set(a)].sort(), [...new Set(b)].sort());
}

const show = (v) => JSON.stringify(v);
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
const assertEqual = (actual, expected) =>
  assert(equal(actual, expected), `${show(actual)} != ${show(expected)}`);
const assertIn = (member, container) =>
  assert(
    Array.isArray(container) ? container.some((x) => equal(x, member))
      : isMap(container) ? Object.hasOwn(container, member)
      : String(container).includes(member),
    `${show(member)} not found in ${show(container)}`,
  );
const assertNotIn = (member, container) =>
  assert(
    !(Array.isArray(container) ? container.some((x) => equal(x, member))
      : isMap(container) ? Object.hasOwn(container, member)
      : String(container).includes(member)),
    `${show(member)} unexpectedly found in ${show(container)}`,
  );
const get = (map, key, fallback) => (isMap(map) && Object.hasOwn(map, key) ? map[key] : fallback);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

let workflow;
try {
  workflow = asText(Bun.YAML.parse(readFileSync(WORKFLOW_PATH, "utf8")));
} catch (e) {
  console.error(`ERROR: cannot load ${WORKFLOW_PATH}: ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
const scan = () => workflow.jobs.scan;

test("scanner does not receive inherited or explicit secrets", () => {
  // Reject the entire key, including an explicit mapping or empty value,
  // so replacing `inherit` with named secrets cannot undo the isolation.
  assertNotIn("secrets", scan());
});

test("scanner inputs do not forward secret expressions", () => {
  // Cover alternate forwarding paths such as reusable workflow inputs.
  const dumped = JSON.stringify(scan());
  assert(!/\bsecrets\s*(?:\.|\[)/i.test(dumped), `secret expression found in ${dumped}`);
});

test("workflow grants only read access to contents", () => {
  assertEqual(workflow.permissions, { contents: "read" });
});

test("scanner cannot override the minimum permissions", () => {
  assertEqual(get(scan(), "permissions", workflow.permissions), { contents: "read" });
});

test("scanner still calls the reviewed shared revision", () => {
  assertEqual(
    scan().uses,
    "hyperpolymath/standards/.github/workflows/" +
      "secret-scanner-reusable.yml@" +
      "571cc734cd69fb846032ec77a662aa8ee4fc32cd",
  );
});

test("pull requests and primary branch pushes remain covered", () => {
  const triggers = workflow.on;
  assert(sameSet(Object.keys(triggers), ["pull_request", "push"]), `${show(Object.keys(triggers))} != {pull_request, push}`);
  // No branch or path filters may silently exclude pull requests.
  assertIn(triggers.pull_request, ["", {}]);
  assertEqual(triggers.push, { branches: ["main", "master"] });
});

test("required scan is not conditional or allowed to fail", () => {
  assertNotIn("if", scan());
  assertIn(get(scan(), "continue-on-error", "false"), ["false"]);
});
// ---------------------------------------------------------------------------

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
console.log(`\nRan ${tests.length} checks: ${failures === 0 ? "OK" : `FAILED (failures=${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
