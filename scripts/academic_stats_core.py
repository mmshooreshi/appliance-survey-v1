#!/usr/bin/env python3
"""
Academic Statistics & Plotting Core (BMJ / Lancet / Nature Guidelines)
Provides standardized data loading, statistical tests, and visual aesthetics
for the Orthodontic Appliance Aesthetic Perception Study.
"""

import os
import json
import urllib.request
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib as mpl
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# Visual & Typography Configuration (BMJ / Lancet Standard)
# ---------------------------------------------------------------------------
COLOR_PALETTE = {
    "aligner": "#1F4E79",   # Deep Slate Navy
    "ceramic": "#C0504D",   # Warm Terracotta
    "metal": "#5A6B7C",     # Muted Steel Gray
    "accent": "#2E75B6",
    "neutral_dark": "#262626",
    "neutral_light": "#F2F4F7",
    "grid": "#E5E7EB",
}

APPLIANCE_LABELS = {
    "aligner": "Clear Aligner",
    "ceramic": "Ceramic Bracket",
    "metal": "Metallic Bracket",
}

APPLIANCE_LABELS_FA = {
    "aligner": "الاینر شفاف",
    "ceramic": "براکت سرامیکی",
    "metal": "براکت فلزی",
}

def setup_academic_style():
    """Sets publication-grade rcParams conforming to BMJ/Lancet recommendations."""
    mpl.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "Liberation Sans"],
        "font.size": 10,
        "axes.titlesize": 12,
        "axes.titleweight": "bold",
        "axes.labelsize": 10,
        "axes.labelweight": "medium",
        "axes.edgecolor": "#737373",
        "axes.linewidth": 0.8,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "xtick.direction": "out",
        "ytick.direction": "out",
        "xtick.major.size": 4,
        "ytick.major.size": 4,
        "xtick.major.width": 0.8,
        "ytick.major.width": 0.8,
        "grid.color": COLOR_PALETTE["grid"],
        "grid.linestyle": "--",
        "grid.linewidth": 0.5,
        "grid.alpha": 0.7,
        "legend.frameon": False,
        "legend.fontsize": 9,
        "figure.titlesize": 13,
        "figure.titleweight": "bold",
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.1,
    })

# ---------------------------------------------------------------------------
# Data Loading & Order Recovery
# ---------------------------------------------------------------------------
BACKEND_URLS = [
    "http://91.212.174.223:9090/api/data",
    "https://engine.dentnet.space/api/appliance_survey/data",
]

def detect_appliance_order(row):
    if "appliance_order" in row and row["appliance_order"]:
        parts = [s.strip().lower() for s in row["appliance_order"].replace(">", ",").split(",") if s.strip()]
        valid = [s for s in parts if s in ("aligner", "ceramic", "metal")]
        if valid:
            return valid

    keys = list(row.keys())
    detected = []
    seen = set()
    for k in keys:
        for app in ["aligner", "ceramic", "metal"]:
            if app in k and app not in seen:
                detected.append(app)
                seen.add(app)
    return detected

def load_data(start_date="2026-10-22", end_date=None, include_pilot=False):
    """Fetches backend data, reconstructs order, and filters to official study cohort."""
    raw_data = None
    for u in BACKEND_URLS:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "AcademicStatsCore/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list) and len(data) > 0:
                    raw_data = data
                    break
        except Exception:
            continue

    if not raw_data:
        # Fallback to local export file if available
        local_path = os.path.join(os.path.dirname(__file__), "..", "exports", "appliance_survey_all_raw_latest.csv")
        if os.path.exists(local_path):
            df = pd.read_csv(local_path)
            return df
        raise RuntimeError("Could not load data from backend or local files.")

    rows = []
    for item in raw_data:
        r = dict(item.get("responses", {})) if "responses" in item and isinstance(item["responses"], dict) else dict(item)
        if "id" in item and "id" not in r:
            r["id"] = item["id"]
        if "timestamp" in item and "timestamp" not in r:
            r["timestamp"] = item["timestamp"]

        ts = str(r.get("timestamp", ""))
        row_date = ts.split(" ")[0] if ts else ""

        if not include_pilot and start_date and row_date and row_date < start_date:
            continue
        if end_date and row_date and row_date > end_date:
            continue

        order = detect_appliance_order(r)
        r["appliance_order"] = " > ".join(order) if order else "Unknown"
        r["first_appliance"] = order[0] if len(order) > 0 else ""
        r["second_appliance"] = order[1] if len(order) > 1 else ""
        r["third_appliance"] = order[2] if len(order) > 2 else ""

        rows.append(r)

    df = pd.DataFrame(rows)
    # Convert numerical columns
    for col in df.columns:
        if col.startswith(("vas_", "acc_", "psy_")) or col in ("q_satisfaction", "q_importance_appearance"):
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df

# ---------------------------------------------------------------------------
# Statistical Inference Utilities
# ---------------------------------------------------------------------------
def paired_wilcoxon(series_a, series_b):
    """Calculates Wilcoxon signed-rank test and paired Cohen's d effect size."""
    if not isinstance(series_a, pd.Series):
        series_a = pd.Series(series_a)
    if not isinstance(series_b, pd.Series):
        series_b = pd.Series(series_b)
    mask = series_a.notna() & series_b.notna()
    a = series_a[mask].to_numpy(dtype=float)
    b = series_b[mask].to_numpy(dtype=float)
    n = len(a)
    if n < 3:
        return {"p_value": 1.0, "stat": 0, "cohen_d": 0.0, "n": n}

    diff = a - b
    if np.all(diff == 0):
        return {"p_value": 1.0, "stat": 0, "cohen_d": 0.0, "n": n}

    res = stats.wilcoxon(a, b, alternative="two-sided")
    # Paired Cohen's d
    diff_sd = np.std(diff, ddof=1)
    cohen_d = (np.mean(diff) / diff_sd) if diff_sd > 0 else 0.0
    return {
        "p_value": float(res.pvalue),
        "stat": float(res.statistic),
        "cohen_d": float(cohen_d),
        "n": n
    }

def format_p(p_val):
    """BMJ-style p-value formatting."""
    if p_val < 0.001:
        return "p < 0.001***"
    if p_val < 0.01:
        return f"p = {p_val:.3f}**"
    if p_val < 0.05:
        return f"p = {p_val:.3f}*"
    return f"p = {p_val:.3f} (ns)"

def calc_ci_mean(arr, confidence=0.95):
    """Computes Mean and 95% Confidence Interval bounds."""
    clean = arr[~np.isnan(arr)]
    n = len(clean)
    if n == 0:
        return 0.0, (0.0, 0.0)
    mean = np.mean(clean)
    if n < 2:
        return mean, (mean, mean)
    sem = stats.sem(clean)
    h = sem * stats.t.ppf((1 + confidence) / 2.0, n - 1)
    return mean, (mean - h, mean + h)
