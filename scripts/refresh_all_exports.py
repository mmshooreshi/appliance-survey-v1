#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas>=2.1.0",
#     "openpyxl>=3.1.2",
#     "scipy>=1.11.0",
#     "numpy>=1.25.0",
#     "matplotlib>=3.8.0",
#     "seaborn>=0.13.0",
#     "tabulate>=0.9.0",
# ]
# ///
"""
Master Refresh Script for Appliance Survey Study
Regenerates all datasets, thesis tables, and 15 academic figures from the live database.
Usage:
    uv run scripts/refresh_all_exports.py
"""

import sys
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def run_step(step_name, script_path):
    print(f"\n{'='*60}")
    print(f"▶ STEP: {step_name}")
    print(f"  Executing: {os.path.basename(script_path)}")
    print(f"{'='*60}")
    result = subprocess.run([sys.executable, script_path], cwd=os.path.join(SCRIPT_DIR, ".."))
    if result.returncode != 0:
        print(f"❌ Error executing {script_path}")
        sys.exit(result.returncode)

def main():
    print("🚀 Initiating Full Live Data Refresh...")
    
    # 1. Export live raw & study cohort datasets (Excel + CSV)
    run_step("Exporting Live Datasets & Sequence Order", os.path.join(SCRIPT_DIR, "export_with_reconstructed_order.py"))
    
    # 2. Generate 4 APA/BMJ Thesis Tables (Multi-Sheet Excel + Markdown)
    run_step("Generating Thesis Tables (Tables 1-4)", os.path.join(SCRIPT_DIR, "generate_thesis_tables.py"))
    
    # 3. Generate 15 BMJ-grade figures
    run_step("Generating 15 Academic Figures (300 DPI)", os.path.join(SCRIPT_DIR, "generate_academic_figures.py"))

    print(f"\n{'='*60}")
    print("✅ ALL EXPORTS, TABLES & FIGURES SUCCESSFULLY UPDATED TO LATEST DATA")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
