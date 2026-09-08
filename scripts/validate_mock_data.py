#!/usr/bin/env python3
"""Validate the synthetic Summit MEP source data before building the V0.

Uses only the Python standard library.
Exit code 0 = pass. Non-zero = validation failure.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "mock" / "summit_mep"
RAW = DATA / "raw"
REF = DATA / "reference"

errors: list[str] = []
warnings: list[str] = []

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def parse_date(value: str | None):
    if value is None or not str(value).strip():
        return None
    return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()

def num(value: str | None) -> float:
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)

def fail(message: str):
    errors.append(message)

# Load
employees = read_csv(RAW / "master_data" / "employees.csv")
vendors = read_csv(RAW / "master_data" / "vendors.csv")
project_map = read_csv(RAW / "master_data" / "project_id_map.csv")
ap = read_csv(RAW / "erp" / "ap_invoices.csv")
commitments = read_csv(RAW / "erp" / "commitments.csv")
receipts = read_csv(RAW / "erp" / "material_receipts.csv")
job_cost = read_csv(RAW / "erp" / "job_cost_transactions.csv")
labor = read_csv(RAW / "timekeeping" / "labor_entries.csv")
change_orders = read_csv(RAW / "project_management" / "change_orders.csv")
forecasts = read_csv(RAW / "project_management" / "pm_forecasts.csv")
budgets = read_csv(RAW / "project_management" / "project_budgets.csv")
progress = read_csv(RAW / "project_management" / "cost_code_progress.csv")

config = json.loads((REF / "client_config.json").read_text(encoding="utf-8"))
close_date = parse_date(config["closeDate"])
t = config["thresholds"]

# Required config keys
required_thresholds = {
    "forecastStaleDays", "apPostingLagDays", "laborPostingLagDays",
    "unmappedCostCodeDollar", "unbudgetedCostDollar", "commitmentOverrunDollar",
    "marginFadePercentagePoints", "eacDeteriorationDollar", "eacDeteriorationPctContract",
    "costCodeOverrunPct", "laborBurnAheadProgressPercentagePoints",
    "rniMediumDollar", "rniHighDollar", "pendingCoDollar", "pendingCoDays",
    "unapprovedCoIncurredCostDollar", "approvedCoUnbilledDollar",
    "approvedCoUnbilledDays", "underbillingDollar", "underbillingPctContract",
    "sovToleranceDollar", "retainageToleranceDollar", "pmChangeCommentDollar",
    "pmChangeCommentPct", "controllerEacChangeDollar",
    "controllerMarginMovementPercentagePoints", "pendingCoCostPctProjectedProfit",
    "completeCostCodeProgressPct", "completeCostCodeRemainingForecastDollar",
}
missing = sorted(required_thresholds - set(t))
if missing:
    fail(f"client_config.json missing thresholds: {missing}")
if float(config.get("overtimeCostMultiplier", 0)) != 1.5:
    fail("overtimeCostMultiplier must be documented as 1.5 for this mock client.")

# Labor physical plausibility + referential integrity
employee_ids = {r["employee_id"] for r in employees}
employee_day = defaultdict(float)
max_work_date = None
for r in labor:
    if r["employee_id"] not in employee_ids:
        fail(f"Labor entry {r['time_entry_id']} references unknown employee {r['employee_id']}.")
    regular = num(r["regular_hours"])
    overtime = num(r["overtime_hours"])
    total = regular + overtime
    if regular < 0 or overtime < 0:
        fail(f"Labor entry {r['time_entry_id']} has negative hours.")
    if regular > 8.0001 or overtime > 4.0001 or total > 12.0001:
        fail(f"Labor entry {r['time_entry_id']} is physically implausible: {total:.1f} total hours.")
    d = parse_date(r["work_date"])
    employee_day[(r["employee_id"], d)] += total
    max_work_date = d if max_work_date is None or d > max_work_date else max_work_date

for (emp, d), hours in employee_day.items():
    if hours > 12.0001:
        fail(f"Employee {emp} has {hours:.1f} hours on {d} across multiple rows.")

if max_work_date != close_date:
    fail(f"Labor data should run through close date {close_date}; max date is {max_work_date}.")

# CO chronology
for r in change_orders:
    submitted = parse_date(r["submitted_date"])
    approved = parse_date(r["approval_date"])
    if approved and submitted and approved < submitted:
        fail(f"{r['change_order_id']} approved {approved} before submission {submitted}.")
    if submitted and int(float(r["days_open"])) != (close_date - submitted).days:
        fail(f"{r['change_order_id']} days_open does not tie to close date.")

# cost_type is economic type, source_type is system/source
if any(r["cost_type"] == "AP" for r in job_cost):
    fail("job_cost_transactions.cost_type contains AP; AP is a source_type, not an economic cost type.")

# Referential integrity
vendor_ids = {r["vendor_id"] for r in vendors}
commitment_ids = {r["commitment_id"] for r in commitments}
for r in commitments:
    if r["vendor_id"] not in vendor_ids:
        fail(f"Commitment {r['commitment_id']} references unknown vendor {r['vendor_id']}.")
for r in ap:
    if r["vendor_id"] not in vendor_ids:
        fail(f"Invoice {r['invoice_id']} references unknown vendor {r['vendor_id']}.")
    if r["commitment_id"] and r["commitment_id"] not in commitment_ids:
        fail(f"Invoice {r['invoice_id']} references unknown commitment {r['commitment_id']}.")
for r in receipts:
    if r["commitment_id"] not in commitment_ids:
        fail(f"Receipt {r['receipt_id']} references unknown commitment {r['commitment_id']}.")

# Every active vendor should have at least one AP/PO use in this mock data.
used_vendors = {r["vendor_id"] for r in commitments} | {r["vendor_id"] for r in ap}
for r in vendors:
    if str(r["active"]).lower() == "true" and r["vendor_id"] not in used_vendors:
        fail(f"Active vendor {r['vendor_id']} is orphaned in the mock dataset.")

# Forecast comment behavior: exactly two deliberately blank material-current changes.
by_project = defaultdict(list)
for r in forecasts:
    by_project[r["pm_project_id"]].append(r)

blank_material = []
for pmid, rows in by_project.items():
    dates = sorted({parse_date(r["as_of_date"]) for r in rows})
    if len(dates) < 2:
        continue
    prev_date, curr_date = dates[-2], dates[-1]
    prev = {r["cost_code"]: r for r in rows if parse_date(r["as_of_date"]) == prev_date}
    current = {r["cost_code"]: r for r in rows if parse_date(r["as_of_date"]) == curr_date}
    for cc, cur in current.items():
        if cc not in prev:
            continue
        old = num(prev[cc]["pm_remaining_uncommitted_cost"])
        new = num(cur["pm_remaining_uncommitted_cost"])
        dollar = abs(new - old)
        pct = abs((new - old) / old) if old else None
        material = dollar >= float(t["pmChangeCommentDollar"]) or (pct is not None and pct >= float(t["pmChangeCommentPct"]))
        if material and not cur["comment"].strip():
            blank_material.append((pmid, cc))
if len(blank_material) != 2:
    fail(f"Expected exactly 2 deliberately blank material PM explanations; found {len(blank_material)}: {blank_material}")

# Closed/full-invoiced negative control
approved = [r for r in ap if r["approval_status"] == "approved"]
# exact duplicate suppression by vendor+invoice_number, keep first by invoice date then id
approved.sort(key=lambda r: (r["vendor_id"], r["invoice_number"], r["invoice_date"], r["invoice_id"]))
seen = set()
valid = []
for r in approved:
    key = (r["vendor_id"], r["invoice_number"])
    if key in seen:
        continue
    seen.add(key)
    if parse_date(r["approved_date"]) and parse_date(r["approved_date"]) <= close_date:
        valid.append(r)
valid_invoice_by_po = defaultdict(float)
for r in valid:
    valid_invoice_by_po[r["commitment_id"]] += num(r["invoice_amount"])

closed = next((r for r in commitments if r["commitment_id"] == "PO-0020"), None)
if not closed or closed["status"] != "closed":
    fail("PO-0020 must be the closed/full-invoiced contrast case.")
elif abs(valid_invoice_by_po["PO-0020"] - num(closed["committed_amount"])) > 0.01:
    fail("PO-0020 valid invoicing does not equal committed amount.")

# Non-approved AP negative control
pending = next((r for r in ap if r["invoice_id"] == "INV-00109"), None)
if not pending or pending["approval_status"] == "approved":
    fail("INV-00109 must remain the pending/non-approved invoice contrast case.")

# Rejected CO negative control
rejected = next((r for r in change_orders if r["change_order_id"] == "CO-1003-C"), None)
if not rejected or rejected["status"] != "rejected" or num(rejected["approved_value"]) != 0:
    fail("CO-1003-C must remain a rejected, zero-approved-value contrast case.")

# Rule oracle exists and is non-empty
rule_counts = read_csv(REF / "expected_rule_counts.csv")
if not rule_counts:
    fail("expected_rule_counts.csv is missing/empty.")

if errors:
    print("MOCK DATA VALIDATION: FAIL")
    for e in errors:
        print(f"ERROR: {e}")
    for w in warnings:
        print(f"WARNING: {w}")
    sys.exit(1)

print("MOCK DATA VALIDATION: PASS")
print(f"- labor rows: {len(labor):,}; max employee-day <= 12h; data runs through {close_date}")
print(f"- change orders: {len(change_orders)}; approval chronology valid")
print(f"- config thresholds present: {len(required_thresholds)}")
print(f"- deliberate blank material forecast explanations: {len(blank_material)}")
print("- closed PO, pending invoice, rejected CO, and referential-integrity controls pass")
