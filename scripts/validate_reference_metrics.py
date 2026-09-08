#!/usr/bin/env python3
"""Independently recompute baseline project metrics from raw mock data.

This is a source-data sanity check for the mock test oracle.
It intentionally does not import application code.
"""
from __future__ import annotations

import csv
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "mock" / "summit_mep"
RAW = DATA / "raw"
REF = DATA / "reference"

def rows(path):
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def dt(s):
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()

def n(v):
    return float(v) if v not in (None, "") else 0.0

projects = rows(RAW / "erp" / "projects.csv")
mapping = rows(RAW / "master_data" / "project_id_map.csv")
job_cost = rows(RAW / "erp" / "job_cost_transactions.csv")
commitments = rows(RAW / "erp" / "commitments.csv")
invoices = rows(RAW / "erp" / "ap_invoices.csv")
forecasts = rows(RAW / "project_management" / "pm_forecasts.csv")
change_orders = rows(RAW / "project_management" / "change_orders.csv")
billings = rows(RAW / "project_management" / "billings.csv")
expected = rows(REF / "expected_baseline_project_metrics.csv")

erp_to_pid = {r["erp_job_id"]: r["canonical_project_id"] for r in mapping if r["erp_job_id"] and r["canonical_project_id"]}
pid_to_erp = {v: k for k, v in erp_to_pid.items()}
pm_to_pid = {r["pm_project_id"]: r["canonical_project_id"] for r in mapping if r["pm_project_id"] and r["canonical_project_id"]}
pid_to_pm = {v: k for k, v in pm_to_pid.items()}
project_by_pid = {erp_to_pid[r["erp_job_id"]]: r for r in projects}

# duplicate identification
ordered = sorted(invoices, key=lambda r: (r["vendor_id"], r["invoice_number"], r["invoice_date"], r["invoice_id"]))
seen = set()
duplicate_ids = set()
for r in ordered:
    key = (r["vendor_id"], r["invoice_number"])
    if key in seen:
        duplicate_ids.add(r["invoice_id"])
    else:
        seen.add(key)

def valid_invoices(as_of):
    cutoff = dt(as_of)
    out = []
    for r in invoices:
        approved = dt(r["approved_date"])
        if (
            r["approval_status"] == "approved"
            and r["invoice_id"] not in duplicate_ids
            and approved
            and approved <= cutoff
        ):
            out.append(r)
    return out

def latest_forecast(pmid, as_of):
    cutoff = dt(as_of)
    eligible = [r for r in forecasts if r["pm_project_id"] == pmid and dt(r["as_of_date"]) <= cutoff]
    if not eligible:
        return []
    latest = max(dt(r["as_of_date"]) for r in eligible)
    return [r for r in eligible if dt(r["as_of_date"]) == latest]

def project_metrics(pid, as_of):
    cutoff = dt(as_of)
    erp = pid_to_erp[pid]
    pmid = pid_to_pm[pid]
    p = project_by_pid[pid]

    approved_co = sum(
        n(r["approved_value"])
        for r in change_orders
        if r["pm_project_id"] == pmid
        and r["status"] == "approved"
        and dt(r["approval_date"])
        and dt(r["approval_date"]) <= cutoff
    )
    revised = n(p["original_contract_value"]) + approved_co

    posted = sum(
        n(r["amount"])
        for r in job_cost
        if r["erp_job_id"] == erp and dt(r["posting_date"]) <= cutoff
    )

    valid = valid_invoices(as_of)
    invoice_by_po = defaultdict(float)
    for r in valid:
        if r["erp_job_id"] == erp:
            invoice_by_po[r["commitment_id"]] += n(r["invoice_amount"])

    remaining = sum(
        max(n(po["committed_amount"]) - invoice_by_po[po["commitment_id"]], 0.0)
        for po in commitments
        if po["erp_job_id"] == erp
    )

    pm_remaining = sum(n(r["pm_remaining_uncommitted_cost"]) for r in latest_forecast(pmid, as_of))
    eac = posted + remaining + pm_remaining
    profit = revised - eac
    margin = None if revised == 0 else profit / revised

    if eac == 0:
        pct = 0.0 if posted == 0 else None
    else:
        pct = min(max(posted / eac, 0.0), 1.0)
    earned = None if pct is None else revised * pct

    project_bills = [r for r in billings if r["pm_project_id"] == pmid]
    if as_of == "2026-07-31":
        billed = sum(n(r["billed_to_date"]) for r in project_bills)
    elif as_of == "2026-06-30":
        billed = sum(n(r["billed_to_date"]) - n(r["current_billed"]) for r in project_bills)
    else:
        raise ValueError("This V0 oracle supports the configured two comparison dates.")

    position = None if earned is None else billed - earned

    return {
        "revised_contract_value": revised,
        "posted_cost_to_date": posted,
        "remaining_commitment": remaining,
        "pm_remaining_uncommitted_cost": pm_remaining,
        "baseline_eac": eac,
        "projected_profit": profit,
        "projected_margin_pct": None if margin is None else margin * 100,
        "draft_percent_complete_pct": None if pct is None else pct * 100,
        "draft_earned_revenue": earned,
        "billed_to_date": billed,
        "billing_position": position,
    }

errors = []
numeric_fields = [
    "revised_contract_value", "posted_cost_to_date", "remaining_commitment",
    "pm_remaining_uncommitted_cost", "baseline_eac", "projected_profit",
    "projected_margin_pct", "draft_percent_complete_pct", "draft_earned_revenue",
    "billed_to_date", "billing_position",
]

for exp in expected:
    calc = project_metrics(exp["project_id"], exp["as_of_date"])
    for field in numeric_fields:
        expected_value = None if exp[field] == "" else n(exp[field])
        actual = calc[field]
        if expected_value is None and actual is None:
            continue
        if expected_value is None or actual is None or abs(expected_value - actual) > 0.02:
            errors.append(
                f"{exp['project_id']} {exp['as_of_date']} {field}: "
                f"expected {expected_value}, calculated {actual}"
            )

if errors:
    print("REFERENCE METRIC VALIDATION: FAIL")
    for e in errors:
        print("ERROR:", e)
    sys.exit(1)

print("REFERENCE METRIC VALIDATION: PASS")
print(f"- recomputed {len(expected)} project/date baseline rows independently from raw CSVs")
print("- all reference values tie within $0.02 / 0.02 percentage points")
