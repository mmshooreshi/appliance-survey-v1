#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "openpyxl>=3.1.0",
# ]
# ///
"""
Appliance Survey - Historic Order Recovery & Thesis Dataset Exporter
Recovers the appliance presentation order for all records, supports custom date ranges,
and separates the official research study cohort (from 2026-10-22) from older pilot tests.
"""

import os
import sys
import json
import csv
import argparse
import urllib.request
from datetime import datetime
from collections import Counter, defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BACKEND_URLS = [
    "http://91.212.174.223:9090/api/data",
    "https://engine.dentnet.space/api/appliance_survey/data",
]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "exports")
os.makedirs(OUTPUT_DIR, exist_ok=True)

DEFAULT_STUDY_START = "2026-10-22"

APPLIANCE_EN_TO_FA = {
    "aligner": "الاینر شفاف",
    "ceramic": "براکت سرامیکی",
    "metal": "براکت فلزی",
}

def fetch_data():
    for url in BACKEND_URLS:
        try:
            print(f"Connecting to {url}...")
            req = urllib.request.Request(url, headers={"User-Agent": "ThesisExporter/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list) and len(data) > 0:
                    print(f"Successfully loaded {len(data)} total records from {url}")
                    return data
        except Exception as e:
            print(f"Failed to fetch from {url}: {e}")
    print("Error: Could not retrieve data from any backend endpoint.")
    sys.exit(1)

def detect_appliance_order(row):
    """
    Detects the presentation order of appliances.
    If 'appliance_order' is explicitly stored in the record, use it.
    Otherwise, inspect the JSON key insertion sequence to reconstruct it.
    """
    if "appliance_order" in row and row["appliance_order"]:
        explicit_order = [s.strip() for s in row["appliance_order"].replace(">", ",").split(",") if s.strip()]
        if explicit_order:
            order_en = [s for s in explicit_order if s in ("aligner", "ceramic", "metal")]
            if order_en:
                return order_en

    # Reconstruct from key insertion order
    keys = list(row.keys())
    detected = []
    seen = set()
    for k in keys:
        for app in ["aligner", "ceramic", "metal"]:
            if app in k and app not in seen:
                detected.append(app)
                seen.add(app)
    return detected

def build_dataset(raw_data, start_date=None, end_date=None):
    processed_records = []
    
    demographic_keys = [
        "q_age", "q_gender", "q_edu", "q_marital", "q_dentist_screen",
        "q_history", "q_current_need", "q_satisfaction", "q_importance_appearance",
        "q_social_media", "q_familiarity"
    ]
    
    for item in raw_data:
        row = dict(item.get("responses", {})) if "responses" in item and isinstance(item["responses"], dict) else dict(item)
        if "id" in item and "id" not in row:
            row["id"] = item["id"]
        if "timestamp" in item and "timestamp" not in row:
            row["timestamp"] = item["timestamp"]

        ts = row.get("timestamp", "")
        row_date = ts.split(" ")[0] if ts else ""

        # Date filtering
        if start_date and row_date and row_date < start_date:
            continue
        if end_date and row_date and row_date > end_date:
            continue

        order = detect_appliance_order(row)
        order_str_en = " > ".join(order) if order else "Unknown"
        order_str_fa = " > ".join([APPLIANCE_EN_TO_FA.get(a, a) for a in order]) if order else "نامشخص"

        record = {
            "id": row.get("id", ""),
            "timestamp": row.get("timestamp", ""),
            "cohort_group": "Official Study" if (row_date >= DEFAULT_STUDY_START) else "Pilot Test (Pre-Oct 22)",
            "appliance_order": order_str_en,
            "appliance_order_fa": order_str_fa,
            "first_appliance": order[0] if len(order) > 0 else "",
            "second_appliance": order[1] if len(order) > 1 else "",
            "third_appliance": order[2] if len(order) > 2 else "",
        }

        # Add demographics
        for dk in demographic_keys:
            record[dk] = row.get(dk, "")

        # Add all other keys from the row
        for k, v in row.items():
            if k not in record and k != "responses":
                record[k] = v

        processed_records.append(record)

    return processed_records

def export_csv(records, filepath):
    if not records:
        print(f"No records to write for {filepath}")
        return
    fieldnames = []
    for r in records:
        for k in r.keys():
            if k not in fieldnames:
                fieldnames.append(k)

    with open(filepath, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)
    print(f"Exported CSV ({len(records)} records): {filepath}")

def export_excel(records, filepath, title="Study Cohort Responses"):
    wb = Workbook()
    
    # Styles
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    accent_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
    order_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
    border_thin = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )

    # Sheet 1: Data Responses
    ws1 = wb.active
    ws1.title = "Responses"
    ws1.views.sheetView[0].showGridLines = True

    fieldnames = []
    for r in records:
        for k in r.keys():
            if k not in fieldnames:
                fieldnames.append(k)

    ws1.append(fieldnames)
    for col_num in range(1, len(fieldnames) + 1):
        cell = ws1.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r_idx, r in enumerate(records, start=2):
        row_vals = [r.get(f, "") for f in fieldnames]
        ws1.append(row_vals)
        for c_idx in range(1, len(fieldnames) + 1):
            c = ws1.cell(row=r_idx, column=c_idx)
            c.border = border_thin
            col_name = fieldnames[c_idx - 1]
            if "order" in col_name:
                c.fill = order_fill
            c.alignment = Alignment(horizontal="center", vertical="center")

    # Sheet 2: Order Bias & Sequence Distribution
    ws2 = wb.create_sheet(title="Sequence Bias Analysis")
    ws2.views.sheetView[0].showGridLines = True

    ws2.append(["Appliance Presentation Order Distribution (Thesis Check)"])
    ws2.cell(row=1, column=1).font = Font(size=14, bold=True, color="1F4E79")
    ws2.append([])

    orders_count = Counter([r["appliance_order"] for r in records])
    total_records = len(records)

    ws2.append(["Presentation Sequence", "Persian Translation", "Count (N)", "Percentage (%)"])
    for c_idx in range(1, 5):
        cell = ws2.cell(row=3, column=c_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    for o_idx, (seq, count) in enumerate(orders_count.most_common(), start=4):
        pct = (count / total_records) * 100 if total_records > 0 else 0
        fa_trans = " > ".join([APPLIANCE_EN_TO_FA.get(x.strip(), x.strip()) for x in seq.split(">")])
        ws2.append([seq, fa_trans, count, f"{pct:.1f}%"])
        for c_idx in range(1, 5):
            c = ws2.cell(row=o_idx, column=c_idx)
            c.border = border_thin
            c.alignment = Alignment(horizontal="center")

    # Position Cross-Tab
    next_row = ws2.max_row + 3
    ws2.cell(row=next_row, column=1, value="Appliance Attractiveness (VAS Overall) by Presentation Position (Order Effect Check)").font = Font(size=12, bold=True, color="1F4E79")
    next_row += 1
    
    ws2.cell(row=next_row, column=1, value="Appliance")
    ws2.cell(row=next_row, column=2, value="Seen 1st (Mean ± SD)")
    ws2.cell(row=next_row, column=3, value="Seen 2nd (Mean ± SD)")
    ws2.cell(row=next_row, column=4, value="Seen 3rd (Mean ± SD)")
    ws2.cell(row=next_row, column=5, value="Total Mean")
    for c_idx in range(1, 6):
        cell = ws2.cell(row=next_row, column=c_idx)
        cell.fill = accent_fill
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center")

    def calc_stats(vals):
        clean = [float(v) for v in vals if str(v).strip() and str(v).replace('.', '', 1).isdigit()]
        if not clean:
            return "N/A"
        mean = sum(clean) / len(clean)
        variance = sum((x - mean) ** 2 for x in clean) / (len(clean) - 1) if len(clean) > 1 else 0
        sd = variance ** 0.5
        return f"{mean:.2f} ± {sd:.2f}"

    for app in ["aligner", "ceramic", "metal"]:
        vas_key = f"vas_{app}_overall"
        row_pos = [f"{app.title()} ({APPLIANCE_EN_TO_FA.get(app)})"]
        for pos_key in ["first_appliance", "second_appliance", "third_appliance"]:
            subset = [r[vas_key] for r in records if r.get(pos_key) == app and vas_key in r]
            row_pos.append(calc_stats(subset))
        total_vals = [r[vas_key] for r in records if vas_key in r]
        row_pos.append(calc_stats(total_vals))
        
        next_row += 1
        ws2.append(row_pos)
        for c_idx in range(1, 6):
            c = ws2.cell(row=next_row, column=c_idx)
            c.border = border_thin
            c.alignment = Alignment(horizontal="center")

    # Auto-adjust column widths
    for sheet in wb.worksheets:
        for col in sheet.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            sheet.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 40)

    wb.save(filepath)
    print(f"Exported Excel ({len(records)} records): {filepath}")

def main():
    parser = argparse.ArgumentParser(description="Export appliance survey data with reconstructed order.")
    parser.add_argument("--start-date", default=DEFAULT_STUDY_START, help=f"Filter start date (default: {DEFAULT_STUDY_START})")
    parser.add_argument("--end-date", default=None, help="Filter end date (e.g. 2026-10-30)")
    parser.add_argument("--all", action="store_true", help="Include all records (including pre-Oct 22 pilot tests)")
    args = parser.parse_args()

    raw_data = fetch_data()

    if args.all:
        start_date = None
        end_date = None
        prefix = "all_records"
    else:
        start_date = args.start_date
        end_date = args.end_date
        prefix = f"study_from_{start_date}"

    study_records = build_dataset(raw_data, start_date=start_date, end_date=end_date)
    all_records = build_dataset(raw_data, start_date=None, end_date=None)

    # 1. Export the official study dataset (default: from 2026-10-22 onwards)
    csv_study = os.path.join(OUTPUT_DIR, "appliance_survey_study_cohort_latest.csv")
    xlsx_study = os.path.join(OUTPUT_DIR, "appliance_survey_study_cohort_latest.xlsx")
    export_csv(study_records, csv_study)
    export_excel(study_records, xlsx_study, title="Study Cohort (Oct 22+)")

    # 2. Export the master archival dataset (all records)
    csv_all = os.path.join(OUTPUT_DIR, "appliance_survey_all_raw_latest.csv")
    xlsx_all = os.path.join(OUTPUT_DIR, "appliance_survey_all_raw_latest.xlsx")
    export_csv(all_records, csv_all)
    export_excel(all_records, xlsx_all, title="All Raw Records")

    print("\n" + "="*60)
    print("SUMMARY:")
    print(f"Total raw records in database: {len(all_records)}")
    print(f"Official Study Cohort (from {DEFAULT_STUDY_START}): {len(study_records)} records")
    print(f"Pilot / Test records (before {DEFAULT_STUDY_START}): {len(all_records) - len(study_records)} records (filtered out)")
    print("="*60)

if __name__ == "__main__":
    main()
