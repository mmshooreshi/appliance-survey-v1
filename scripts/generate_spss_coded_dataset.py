#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "openpyxl>=3.1.0",
# ]
# ///
"""
Generates SPSS-Ready Numerically Coded Dataset, Complete Codebook, and SPSS Syntax (.sps)
for the Orthodontic Appliance Aesthetic Perception Study.
"""

import os
import sys
import json
import urllib.request
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BACKEND_URL = "http://91.212.174.223:9090/api/data"
OUTPUT_DIR = "/Users/mamthenebo/Me/projects/appliance-survey-v1/exports/spss"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# -------------------------------------------------------------
# 1. CODING SCHEME & CODEBOOK DEFINITIONS
# -------------------------------------------------------------
CODEBOOK = [
    {
        "name": "id",
        "label": "شناسه پاسخ‌دهنده (Participant ID)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {}
    },
    {
        "name": "timestamp",
        "label": "تاریخ و زمان ثبت (Submission Timestamp)",
        "type": "String",
        "measure": "Nominal",
        "values": {}
    },
    {
        "name": "seq_permutation",
        "label": "جایگشت توالی نمایش ۳ دستگاه (Presentation Permutation)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {
            1: "Aligner > Ceramic > Metal",
            2: "Aligner > Metal > Ceramic",
            3: "Ceramic > Aligner > Metal",
            4: "Ceramic > Metal > Aligner",
            5: "Metal > Aligner > Ceramic",
            6: "Metal > Ceramic > Aligner"
        }
    },
    {
        "name": "order_app_1",
        "label": "دستگاه اول نمایش‌داده‌شده (1st Displayed Appliance)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {1: "Clear Aligner", 2: "Ceramic Bracket", 3: "Metallic Bracket"}
    },
    {
        "name": "order_app_2",
        "label": "دستگاه دوم نمایش‌داده‌شده (2nd Displayed Appliance)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {1: "Clear Aligner", 2: "Ceramic Bracket", 3: "Metallic Bracket"}
    },
    {
        "name": "order_app_3",
        "label": "دستگاه سوم نمایش‌داده‌شده (3rd Displayed Appliance)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {1: "Clear Aligner", 2: "Ceramic Bracket", 3: "Metallic Bracket"}
    },
    {
        "name": "q_age",
        "label": "رده سنی (Age Group)",
        "type": "Numeric",
        "measure": "Ordinal",
        "values": {
            1: "Under 18 (<18)",
            2: "18-24 years",
            3: "25-34 years",
            4: "35-44 years",
            5: "45-54 years",
            6: "55+ years"
        }
    },
    {
        "name": "q_gender",
        "label": "جنسیت (Gender)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {1: "Male (مرد)", 2: "Female (زن)"}
    },
    {
        "name": "q_edu",
        "label": "سطح تحصیلات (Education Level)",
        "type": "Numeric",
        "measure": "Ordinal",
        "values": {
            1: "Diploma / High School",
            2: "University Student (دانشجو)",
            3: "Bachelor (کارشناسی)",
            4: "Master (کارشناسی ارشد)",
            5: "PhD / Professional Doctorate (دکتری و بالاتر)"
        }
    },
    {
        "name": "q_marital",
        "label": "وضعیت تأهل (Marital Status)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {1: "Single (مجرد)", 2: "Married (متأهل)"}
    },
    {
        "name": "q_dentist_screen",
        "label": "وابستگی به حرفه دندان‌پزشکی (Dental Background)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {0: "No / Layperson (خیر)", 1: "Yes / Dental Professional/Student (بله)"}
    },
    {
        "name": "q_history",
        "label": "سابقه قبلی درمان ارتودنسی (Past Orthodontic Treatment)",
        "type": "Numeric",
        "measure": "Nominal",
        "values": {
            1: "None / No History (سابقه ندارم)",
            2: "Fixed Brackets - Metal/Ceramic (براکت ثابت)",
            3: "Clear Aligner (الاینر شفاف)",
            4: "Removable Appliance (پلاک متحرک)",
            5: "Multiple Appliances (بیش از یک نوع)"
        }
    },
    {
        "name": "q_current_need",
        "label": "نیاز ادراک‌شده فعلی به درمان (Perceived Need for Treatment)",
        "type": "Numeric",
        "measure": "Ordinal",
        "values": {
            1: "No Need (خیر)",
            2: "Unsure / Maybe (مطمئن نیستم)",
            3: "Yes, but no plan (نیاز دارم اما اقدام نکرده‌ام)",
            4: "Yes, treatment planned (نیاز دارم و برنامه درمان دارم)"
        }
    },
    {
        "name": "q_satisfaction",
        "label": "رضایت از لبخند فعلی (Smile Satisfaction: 1=Low, 5=High)",
        "type": "Numeric",
        "measure": "Scale",
        "values": {1: "1-Completely Dissatisfied", 5: "5-Completely Satisfied"}
    },
    {
        "name": "q_importance_appearance",
        "label": "اهمیت زیبایی دندان‌ها (Appearance Importance: 1=Low, 5=High)",
        "type": "Numeric",
        "measure": "Scale",
        "values": {1: "1-Not Important At All", 5: "5-Extremely Important"}
    },
    {
        "name": "q_social_media",
        "label": "دنبال‌کردن محتوای زیبایی در شبکه‌های اجتماعی (Social Media Dental Content)",
        "type": "Numeric",
        "measure": "Ordinal",
        "values": {
            1: "Never (اصلاً)",
            2: "Rarely (به‌ندرت)",
            3: "Sometimes (گاهی)",
            4: "Often (زیاد)",
            5: "Everyday (هر روز)"
        }
    },
    {
        "name": "q_familiarity",
        "label": "میزان آشنایی قبلی با انواع دستگاه‌ها (Appliance Familiarity)",
        "type": "Numeric",
        "measure": "Ordinal",
        "values": {
            1: "None (اصلاً آشنا نیستم)",
            2: "Little (کمی آشنایی دارم)",
            3: "Moderate (تا حدودی آشنایی دارم)",
            4: "Good (آشنایی خوبی دارم)",
            5: "Expert / Complete (کاملاً آشنا هستم)"
        }
    }
]

APPLIANCE_PREFIXES = [
    ("aligner", "الاینر شفاف (Clear Aligner)"),
    ("ceramic", "براکت سرامیکی (Ceramic Bracket)"),
    ("metal", "براکت فلزی (Metallic Bracket)")
]

APPLIANCE_METRICS = [
    ("vas_{app}_overall", "نمره جذابیت کلی در مقیاس دیداری (VAS Overall Attractiveness: 1-10)", "Numeric", "Scale", {1: "1-Completely Unattractive", 10: "10-Completely Attractive"}),
    ("vas_{app}_distract", "میزان جلب توجه و حواس‌پرتی دستگاه (Visual Detraction: 1-5)", "Numeric", "Scale", {1: "1-Not distracting", 5: "5-Extremely distracting"}),
    ("vas_{app}_prof", "مناسبت برای محیط رسمی و کاری (Professional Setting: 1-5)", "Numeric", "Scale", {1: "1-Completely inappropriate", 5: "5-Completely appropriate"}),
    ("acc_{app}_work", "احساس خجالت استفاده در محیط کار (Workplace Embarrassment: 1-5)", "Numeric", "Scale", {1: "1-No embarrassment", 5: "5-Extreme embarrassment"}),
    ("acc_{app}_social", "احساس راحتی در مهمانی و دورهمی (Social Comfort: 1-5)", "Numeric", "Scale", {1: "1-Completely uncomfortable", 5: "5-Completely comfortable"}),
    ("vas_{app}_device_impact", "تأثیر خودِ دستگاه بر نازیبایی لبخند (Negative Device Impact: 1-5)", "Numeric", "Scale", {1: "1-No negative impact", 5: "5-Severe negative impact"}),
    ("vas_{app}_color_harmony", "هماهنگی رنگ دستگاه با دندان (Color Harmony: 1-5)", "Numeric", "Scale", {1: "1-No harmony", 5: "5-Complete harmony"}),
    ("psy_{app}_intel", "ادراک هوش و ذکاوت فرد (Perceived Intelligence: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_hygiene", "ادراک بهداشت دهان و دندان (Perceived Hygiene: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_attract", "ادراک جذابیت چهره به‌طور کلی (Perceived Facial Attractiveness: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_trust", "ادراک قابل اعتماد بودن (Perceived Trustworthiness: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_social", "ادراک مهارت اجتماعی و برون‌گرایی (Perceived Extraversion/Social Skill: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_ses", "ادراک طبقه اقتصادی-اجتماعی (Perceived Socioeconomic Status: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"}),
    ("psy_{app}_confidence", "ادراک اعتمادبه‌نفس فرد (Perceived Self-Confidence: 1-5)", "Numeric", "Scale", {1: "1-Low", 5: "5-High"})
]

for app_key, app_label in APPLIANCE_PREFIXES:
    for var_tmpl, label_tmpl, vtype, meas, vals in APPLIANCE_METRICS:
        var_name = var_tmpl.format(app=app_key)
        var_label = f"[{app_label}] {label_tmpl}"
        CODEBOOK.append({
            "name": var_name,
            "label": var_label,
            "type": vtype,
            "measure": meas,
            "values": vals
        })

# -------------------------------------------------------------
# 2. ENCODING LOOKUP DICTIONARIES
# -------------------------------------------------------------
ENCODE_MAPS = {
    "q_gender": {"male": 1, "مرد": 1, "female": 2, "زن": 2},
    "q_age": {
        "<18": 1, "under18": 1,
        "18-24": 2,
        "25-34": 3,
        "35-44": 4,
        "45-54": 5,
        "55+": 6, "55plus": 6
    },
    "q_edu": {
        "diploma": 1,
        "student": 2,
        "bachelor": 3,
        "master": 4,
        "phd_md": 5
    },
    "q_marital": {
        "single": 1, "مجرد": 1,
        "married": 2, "متاهل": 2, "متأهل": 2
    },
    "q_dentist_screen": {
        "no": 0, "خیر": 0, "false": 0,
        "yes": 1, "بله": 1, "true": 1
    },
    "q_history": {
        "no": 1,
        "fixed": 2,
        "aligner": 3,
        "removable": 4,
        "multiple": 5
    },
    "q_current_need": {
        "no": 1,
        "maybe": 2,
        "yes_no_plan": 3,
        "yes_planned": 4
    },
    "q_social_media": {
        "never": 1,
        "rarely": 2,
        "sometimes": 3,
        "often": 4,
        "everyday": 5
    },
    "q_familiarity": {
        "none": 1,
        "little": 2,
        "moderate": 3,
        "good": 4,
        "expert": 5
    },
    "app_map": {
        "aligner": 1,
        "ceramic": 2,
        "metal": 3
    },
    "permutation_map": {
        "aligner > ceramic > metal": 1,
        "aligner > metal > ceramic": 2,
        "ceramic > aligner > metal": 3,
        "ceramic > metal > aligner": 4,
        "metal > aligner > ceramic": 5,
        "metal > ceramic > aligner": 6
    }
}

# -------------------------------------------------------------
# 3. FETCH AND PROCESS DATA
# -------------------------------------------------------------
def fetch_data():
    req = urllib.request.Request(BACKEND_URL, headers={"User-Agent": "SPSSDataEncoder/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode('utf-8'))

def detect_order(row):
    if row.get("appliance_order"):
        parts = [p.strip().lower() for p in row["appliance_order"].replace(">", ",").split(",")]
        valid = [p for p in parts if p in ("aligner", "ceramic", "metal")]
        if len(valid) == 3:
            return valid
    keys = list(row.keys())
    order = []
    seen = set()
    for k in keys:
        for app in ("aligner", "ceramic", "metal"):
            if app in k and app not in seen:
                order.append(app)
                seen.add(app)
    return order if len(order) == 3 else ["aligner", "ceramic", "metal"]

def encode_row(row):
    encoded = {}
    encoded["id"] = row.get("id")
    encoded["timestamp"] = row.get("timestamp", "")
    
    order = detect_order(row)
    order_str = " > ".join(order)
    encoded["seq_permutation"] = ENCODE_MAPS["permutation_map"].get(order_str, 1)
    encoded["order_app_1"] = ENCODE_MAPS["app_map"].get(order[0], 1)
    encoded["order_app_2"] = ENCODE_MAPS["app_map"].get(order[1], 2)
    encoded["order_app_3"] = ENCODE_MAPS["app_map"].get(order[2], 3)

    # Demographics
    for k in ["q_gender", "q_age", "q_edu", "q_marital", "q_dentist_screen", "q_history", "q_current_need", "q_social_media", "q_familiarity"]:
        raw_val = str(row.get(k, "")).strip().lower()
        mapping = ENCODE_MAPS.get(k, {})
        encoded[k] = mapping.get(raw_val, None)

    # Numerical ratings
    for item in CODEBOOK:
        k = item["name"]
        if k in encoded:
            continue
        val = row.get(k)
        try:
            encoded[k] = int(val) if val is not None and str(val).strip() != "" else None
        except ValueError:
            try:
                encoded[k] = float(val)
            except:
                encoded[k] = None
                
    return encoded

# -------------------------------------------------------------
# 4. EXPORT TO MULTI-SHEET EXCEL (SPSS-READY)
# -------------------------------------------------------------
def build_spss_excel(cohort, output_path):
    wb = Workbook()
    
    # Styles
    f_header = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    fill_navy = PatternFill("solid", fgColor="1B365D")
    fill_blue = PatternFill("solid", fgColor="2B6CB0")
    f_data = Font(name="Arial", size=9)
    border_thin = Border(
        left=Side(style='thin', color='DDDDDD'),
        right=Side(style='thin', color='DDDDDD'),
        top=Side(style='thin', color='DDDDDD'),
        bottom=Side(style='thin', color='DDDDDD')
    )

    # ---------------------------------------------------------
    # Sheet 1: Coded_Data (Pure numeric matrix)
    # ---------------------------------------------------------
    ws_coded = wb.active
    ws_coded.title = "Coded_Data_SPSS"
    ws_coded.views.sheetView[0].showGridLines = True

    var_names = [item["name"] for item in CODEBOOK]
    ws_coded.append(var_names)
    for col_idx in range(1, len(var_names) + 1):
        cell = ws_coded.cell(row=1, column=col_idx)
        cell.font = f_header
        cell.fill = fill_navy
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r in cohort:
        enc = encode_row(r)
        row_vals = [enc.get(vn, "") for vn in var_names]
        ws_coded.append(row_vals)

    for row in ws_coded.iter_rows(min_row=2, max_row=len(cohort)+1, min_col=1, max_col=len(var_names)):
        for cell in row:
            cell.font = f_data
            cell.border = border_thin
            cell.alignment = Alignment(horizontal="center", vertical="center")

    # ---------------------------------------------------------
    # Sheet 2: Codebook (Variable Dictionary)
    # ---------------------------------------------------------
    ws_cb = wb.create_sheet(title="Codebook_Dictionary")
    ws_cb.views.sheetView[0].showGridLines = True
    cb_headers = ["Variable Name (SPSS)", "Variable Label (Description)", "Type", "Measure Level", "Value Labels / Coding Scheme"]
    ws_cb.append(cb_headers)
    for col_idx in range(1, len(cb_headers) + 1):
        cell = ws_cb.cell(row=1, column=col_idx)
        cell.font = f_header
        cell.fill = fill_blue
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for item in CODEBOOK:
        vals_str = "\n".join([f"{k} = {v}" for k, v in item["values"].items()]) if item["values"] else "Numeric Score"
        ws_cb.append([
            item["name"],
            item["label"],
            item["type"],
            item["measure"],
            vals_str
        ])

    for row in ws_cb.iter_rows(min_row=2, max_row=len(CODEBOOK)+1, min_col=1, max_col=5):
        for cell in row:
            cell.font = f_data
            cell.border = border_thin
            cell.alignment = Alignment(vertical="center", wrap_text=True)

    # ---------------------------------------------------------
    # Sheet 3: Raw_Labels_Reference
    # ---------------------------------------------------------
    ws_raw = wb.create_sheet(title="Raw_Labels_Reference")
    ws_raw.views.sheetView[0].showGridLines = True
    ws_raw.append(var_names)
    for col_idx in range(1, len(var_names) + 1):
        cell = ws_raw.cell(row=1, column=col_idx)
        cell.font = f_header
        cell.fill = PatternFill("solid", fgColor="319795")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r in cohort:
        row_vals = []
        for vn in var_names:
            val = r.get(vn, "")
            row_vals.append(str(val))
        ws_raw.append(row_vals)

    # Auto-fit columns
    for ws in [ws_coded, ws_cb, ws_raw]:
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)

    wb.save(output_path)
    print(f"✅ SPSS Coded Dataset & Codebook saved to: {output_path}")

# -------------------------------------------------------------
# 5. GENERATE SPSS SYNTAX (.SPS)
# -------------------------------------------------------------
def build_spss_syntax(output_path):
    lines = []
    lines.append("* SPSS Syntax for Orthodontic Appliance Aesthetic Survey Dataset.")
    lines.append("* Automatically applies Variable Labels, Value Labels, and Measurement Levels.\n")

    # Variable labels
    lines.append("VARIABLE LABELS")
    for item in CODEBOOK:
        clean_label = item["label"].replace('"', "''")
        lines.append(f'  {item["name"]} "{clean_label}"')
    lines.append(".\n")

    # Value labels
    lines.append("VALUE LABELS")
    for item in CODEBOOK:
        if item["values"]:
            lines.append(f'  {item["name"]}')
            for k, v in item["values"].items():
                clean_v = str(v).replace('"', "''")
                lines.append(f'    {k} "{clean_v}"')
    lines.append(".\n")

    # Variable Level
    lines.append("VARIABLE LEVEL")
    for item in CODEBOOK:
        m = item["measure"].upper()
        if m in ("SCALE", "ORDINAL", "NOMINAL"):
            lines.append(f'  {item["name"]} ({m})')
    lines.append(".\n")

    lines.append("EXECUTE.\n")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"✅ SPSS Syntax (.sps) file saved to: {output_path}")

# -------------------------------------------------------------
# MAIN EXECUTION
# -------------------------------------------------------------
def main():
    raw_data = fetch_data()
    # Filter official study cohort from 2026-10-22
    cohort = [r for r in raw_data if (r.get("timestamp") or "").split(" ")[0] >= "2026-10-22"]
    cohort.sort(key=lambda x: x.get("id", 0))

    print(f"Loaded {len(cohort)} authentic study cohort participants (IDs {cohort[0]['id']} to {cohort[-1]['id']}).")

    excel_path = os.path.join(OUTPUT_DIR, "appliance_survey_spss_coded.xlsx")
    syntax_path = os.path.join(OUTPUT_DIR, "appliance_survey_syntax.sps")

    build_spss_excel(cohort, excel_path)
    build_spss_syntax(syntax_path)

if __name__ == "__main__":
    main()
