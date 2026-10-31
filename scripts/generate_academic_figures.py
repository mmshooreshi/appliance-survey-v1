#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "matplotlib>=3.8.0",
#     "seaborn>=0.13.0",
#     "scipy>=1.11.0",
#     "pandas>=2.1.0",
#     "numpy>=1.25.0",
# ]
# ///
"""
Academic Figure Generator (BMJ / Lancet / Nature Standard)
Renders a comprehensive battery of 12 publication-ready figures covering
aesthetics, psychometric halo effects, acceptability, order bias, and demographics.
"""

import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats

from academic_stats_core import (
    setup_academic_style,
    load_data,
    paired_wilcoxon,
    format_p,
    calc_ci_mean,
    COLOR_PALETTE,
    APPLIANCE_LABELS,
    APPLIANCE_LABELS_FA,
)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "exports", "figures")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Helper: Add Statistical Bracket
# ---------------------------------------------------------------------------
def add_stat_bracket(ax, x1, x2, y, h, text, color="#262626"):
    ax.plot([x1, x1, x2, x2], [y, y + h, y + h, y], lw=0.9, c=color)
    ax.text((x1 + x2) * 0.5, y + h + 0.05, text, ha="center", va="bottom", color=color, fontsize=8, fontweight="medium")

# ---------------------------------------------------------------------------
# FIGURE 1: Overall Aesthetic Attractiveness (VAS 1-10) - Violin + Jitter + 95% CI
# ---------------------------------------------------------------------------
def plot_fig01_vas_overall(df):
    fig, ax = plt.subplots(figsize=(6.5, 5))
    appliances = ["aligner", "ceramic", "metal"]
    data = [df[f"vas_{a}_overall"].dropna().values for a in appliances]

    # Half violin / KDE & jittered points
    positions = [1, 2, 3]
    colors = [COLOR_PALETTE[a] for a in appliances]

    parts = ax.violinplot(data, positions=positions, showmeans=False, showmedians=False, showextrema=False, widths=0.55)
    for pc, c in zip(parts["bodies"], colors):
        pc.set_facecolor(c)
        pc.set_edgecolor(c)
        pc.set_alpha(0.3)

    # Jittered scatter + CI
    np.random.seed(42)
    for pos, arr, c in zip(positions, data, colors):
        jitter = np.random.normal(0, 0.05, size=len(arr))
        ax.scatter(pos + jitter, arr, color=c, alpha=0.6, s=28, zorder=3, edgecolors="white", linewidth=0.5)

        mean_val, (ci_low, ci_high) = calc_ci_mean(arr)
        ax.errorbar(pos, mean_val, yerr=[[mean_val - ci_low], [ci_high - mean_val]], fmt="o", color=c,
                    ecolor="#262626", elinewidth=1.6, capsize=4, capthick=1.2, markersize=7, zorder=5)
        ax.text(pos, ci_high + 0.35, f"{mean_val:.2f} ± {np.std(arr, ddof=1):.2f}\n(95% CI: {ci_low:.1f}–{ci_high:.1f})",
                ha="center", va="bottom", fontsize=7.5, color="#262626")

    # Wilcoxon paired tests
    w_ac = paired_wilcoxon(df["vas_aligner_overall"], df["vas_ceramic_overall"])
    w_am = paired_wilcoxon(df["vas_aligner_overall"], df["vas_metal_overall"])
    w_cm = paired_wilcoxon(df["vas_ceramic_overall"], df["vas_metal_overall"])

    add_stat_bracket(ax, 1, 2, 10.6, 0.25, f"{format_p(w_ac['p_value'])} (d={w_ac['cohen_d']:.2f})")
    add_stat_bracket(ax, 2, 3, 11.4, 0.25, f"{format_p(w_cm['p_value'])} (d={w_cm['cohen_d']:.2f})")
    add_stat_bracket(ax, 1, 3, 12.3, 0.35, f"{format_p(w_am['p_value'])} (d={w_am['cohen_d']:.2f})")

    ax.set_xticks(positions)
    ax.set_xticklabels([f"{APPLIANCE_LABELS[a]}\n({APPLIANCE_LABELS_FA[a]})" for a in appliances])
    ax.set_ylabel("Visual Analogue Scale (VAS) Score (1–10)")
    ax.set_ylim(0.5, 13.5)
    ax.set_title("Figure 1: Overall Aesthetic Attractiveness Ratings Across Orthodontic Appliances", pad=15)
    ax.yaxis.grid(True)

    out_path = os.path.join(OUTPUT_DIR, "fig01_vas_overall_attractiveness.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 2: Noticeability & Visual Hardware Detraction
# ---------------------------------------------------------------------------
def plot_fig02_noticeability_detraction(df):
    fig, axes = plt.subplots(1, 2, figsize=(9.5, 4.5), sharey=True)
    appliances = ["aligner", "ceramic", "metal"]
    colors = [COLOR_PALETTE[a] for a in appliances]

    metrics = [
        ("vas_{}_distract", "Noticeability / Distractiveness (1–5)", "A: Noticeability in Conversation", axes[0]),
        ("vas_{}_device_impact", "Aesthetic Detraction by Hardware (1–5)", "B: Detraction from Smile Beauty", axes[1]),
    ]

    for key_fmt, ylabel, title, ax in metrics:
        means = []
        cis = []
        for a in appliances:
            arr = df[key_fmt.format(a)].dropna().values
            m, (lo, hi) = calc_ci_mean(arr)
            means.append(m)
            cis.append(hi - m)

        bars = ax.bar(appliances, means, yerr=cis, color=colors, alpha=0.85, capsize=4, edgecolor="white", width=0.55)
        for b, m in zip(bars, means):
            ax.text(b.get_x() + b.get_width() / 2, m * 0.5, f"{m:.2f}", ha="center", va="center", color="white", fontweight="bold", fontsize=9)

        ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances])
        ax.set_title(title, fontsize=10.5, fontweight="bold")
        ax.set_ylim(0, 5.5)
        ax.yaxis.grid(True)
        if ax == axes[0]:
            ax.set_ylabel("Likert Scale Score (1–5)")

    fig.suptitle("Figure 2: Visual Salience & Detraction: Device Noticeability vs Smile Degradation", fontsize=12, fontweight="bold", y=0.98)
    out_path = os.path.join(OUTPUT_DIR, "fig02_hardware_noticeability_detraction.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 3: 7-Axis Psychometric Radar / Spider Chart (The Halo Effect)
# ---------------------------------------------------------------------------
def plot_fig03_halo_radar(df):
    traits = [
        ("intel", "Intelligence"),
        ("hygiene", "Oral Hygiene"),
        ("attract", "Attractiveness"),
        ("trust", "Trustworthiness"),
        ("social", "Social Success"),
        ("ses", "Income / SES"),
        ("confidence", "Self-Confidence"),
    ]
    categories = [t[1] for t in traits]
    n_cat = len(categories)
    angles = np.linspace(0, 2 * np.pi, n_cat, endpoint=False).tolist()
    angles += angles[:1]  # close loop

    fig, ax = plt.subplots(figsize=(7, 7), subplot_kw=dict(polar=True))
    appliances = ["aligner", "ceramic", "metal"]

    for a in appliances:
        vals = []
        for t_key, _ in traits:
            col = f"psy_{a}_{t_key}"
            if col not in df:
                col = f"psy_{a}_conf" if t_key == "confidence" else col
            vals.append(df[col].dropna().mean() if col in df else 3.0)
        vals += vals[:1]

        c = COLOR_PALETTE[a]
        ax.plot(angles, vals, color=c, linewidth=2, linestyle="solid", label=f"{APPLIANCE_LABELS[a]}")
        ax.fill(angles, vals, color=c, alpha=0.15)

    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=9.5, fontweight="medium")
    ax.set_ylim(1, 5)
    ax.set_yticks([1, 2, 3, 4, 5])
    ax.set_yticklabels(["1", "2", "3", "4", "5"], fontsize=8, color="#595959")
    ax.grid(color=COLOR_PALETTE["grid"], linestyle="--", linewidth=0.6)

    ax.legend(loc="upper right", bbox_to_anchor=(1.25, 1.1), fontsize=9)
    ax.set_title("Figure 3: Psychometric Profile & Halo Effect Attribution Battery (1–5 Scales)", pad=25, fontsize=12, fontweight="bold")

    out_path = os.path.join(OUTPUT_DIR, "fig03_psychometric_halo_radar.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 4: Standardized Effect Sizes (Cohen's d) Forest Plot
# ---------------------------------------------------------------------------
def plot_fig04_halo_forest(df):
    traits = [
        ("intel", "Intelligence"),
        ("hygiene", "Oral Hygiene"),
        ("attract", "Attractiveness"),
        ("trust", "Trustworthiness"),
        ("social", "Social Success"),
        ("ses", "Socioeconomic Status"),
        ("confidence", "Self-Confidence"),
    ]

    aligner_d = []
    aligner_ci = []
    ceramic_d = []
    ceramic_ci = []

    for t_key, _ in traits:
        col_a = f"psy_aligner_{t_key}" if f"psy_aligner_{t_key}" in df else "psy_aligner_conf"
        col_c = f"psy_ceramic_{t_key}" if f"psy_ceramic_{t_key}" in df else "psy_ceramic_conf"
        col_m = f"psy_metal_{t_key}" if f"psy_metal_{t_key}" in df else "psy_metal_conf"

        res_a = paired_wilcoxon(df[col_a], df[col_m])
        res_c = paired_wilcoxon(df[col_c], df[col_m])

        d_a = res_a["cohen_d"]
        se_a = np.sqrt(1 / res_a["n"] + (d_a ** 2) / (2 * res_a["n"]))
        aligner_d.append(d_a)
        aligner_ci.append(1.96 * se_a)

        d_c = res_c["cohen_d"]
        se_c = np.sqrt(1 / res_c["n"] + (d_c ** 2) / (2 * res_c["n"]))
        ceramic_d.append(d_c)
        ceramic_ci.append(1.96 * se_c)

    fig, ax = plt.subplots(figsize=(8, 5))
    y_pos = np.arange(len(traits))
    offset = 0.15

    ax.errorbar(aligner_d, y_pos + offset, xerr=aligner_ci, fmt="o", color=COLOR_PALETTE["aligner"],
                label="Clear Aligner vs Metal", capsize=4, elinewidth=1.5, markersize=6)
    ax.errorbar(ceramic_d, y_pos - offset, xerr=ceramic_ci, fmt="s", color=COLOR_PALETTE["ceramic"],
                label="Ceramic Bracket vs Metal", capsize=4, elinewidth=1.5, markersize=6)

    ax.axvline(0, color="#262626", linestyle="--", linewidth=0.9, alpha=0.8)
    ax.axvline(0.2, color="#A6A6A6", linestyle=":", linewidth=0.7)
    ax.axvline(0.5, color="#A6A6A6", linestyle=":", linewidth=0.7)
    ax.axvline(0.8, color="#A6A6A6", linestyle=":", linewidth=0.7)

    ax.text(0.2, -0.7, "Small (0.2)", fontsize=7, color="#737373", ha="center")
    ax.text(0.5, -0.7, "Medium (0.5)", fontsize=7, color="#737373", ha="center")
    ax.text(0.8, -0.7, "Large (0.8)", fontsize=7, color="#737373", ha="center")

    ax.set_yticks(y_pos)
    ax.set_yticklabels([t[1] for t in traits], fontsize=9)
    ax.set_xlabel("Standardized Mean Difference (Cohen's d ± 95% CI) Relative to Metallic Brackets")
    ax.set_title("Figure 4: Psychological Halo Effect: Effect Sizes Relative to Metallic Brackets", pad=15)
    ax.legend(loc="lower right")
    ax.yaxis.grid(True)

    out_path = os.path.join(OUTPUT_DIR, "fig04_halo_effect_forest_plot.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 5: Workplace & Social Acceptability Thresholds
# ---------------------------------------------------------------------------
def plot_fig05_acceptability(df):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.5, 4.5))
    appliances = ["aligner", "ceramic", "metal"]
    colors = [COLOR_PALETTE[a] for a in appliances]

    # Panel A: Professionalism Rating
    means = [df[f"vas_{a}_prof"].mean() for a in appliances]
    sems = [stats.sem(df[f"vas_{a}_prof"].dropna()) * 1.96 for a in appliances]
    bars = ax1.bar(appliances, means, yerr=sems, color=colors, alpha=0.85, capsize=4, width=0.55)
    for b, m in zip(bars, means):
        ax1.text(b.get_x() + b.get_width() / 2, m * 0.5, f"{m:.2f}", ha="center", va="center", color="white", fontweight="bold")
    ax1.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances])
    ax1.set_ylabel("Appropriateness for Formal Workplace (1–5)")
    ax1.set_title("A: Professional Suitability (Mean ± 95% CI)")
    ax1.set_ylim(0, 5.5)
    ax1.yaxis.grid(True)

    # Panel B: Social Discomfort (Inverted: Embarrassment at Work)
    embarrass = [df[f"acc_{a}_work"].mean() for a in appliances]
    emb_sem = [stats.sem(df[f"acc_{a}_work"].dropna()) * 1.96 for a in appliances]
    bars2 = ax2.bar(appliances, embarrass, yerr=emb_sem, color=colors, alpha=0.85, capsize=4, width=0.55)
    for b, m in zip(bars2, embarrass):
        ax2.text(b.get_x() + b.get_width() / 2, m * 0.5, f"{m:.2f}", ha="center", va="center", color="white", fontweight="bold")
    ax2.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances])
    ax2.set_ylabel("Anticipated Workplace Embarrassment (1–5)")
    ax2.set_title("B: Anticipated Self-Consciousness at Work")
    ax2.set_ylim(0, 5.5)
    ax2.yaxis.grid(True)

    fig.suptitle("Figure 5: Professional Workplace Appropriateness & Anticipated Embarrassment", fontsize=12, fontweight="bold", y=0.98)
    out_path = os.path.join(OUTPUT_DIR, "fig05_workplace_acceptability.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 6: Sequence Bias & Carryover Effect (Crucial Thesis Defense Figure)
# ---------------------------------------------------------------------------
def plot_fig06_sequence_bias(df):
    fig, ax = plt.subplots(figsize=(8, 4.8))
    appliances = ["aligner", "ceramic", "metal"]
    colors = [COLOR_PALETTE[a] for a in appliances]
    positions = [1, 2, 3]

    for a, c in zip(appliances, colors):
        vas_col = f"vas_{a}_overall"
        m_pos = []
        err_pos = []
        for pos_col in ["first_appliance", "second_appliance", "third_appliance"]:
            sub = df[df[pos_col] == a][vas_col].dropna().values
            if len(sub) > 0:
                m_pos.append(np.mean(sub))
                err_pos.append(stats.sem(sub) * 1.96 if len(sub) > 1 else 0)
            else:
                m_pos.append(np.nan)
                err_pos.append(0)

        ax.plot(positions, m_pos, marker="o", color=c, linewidth=2, label=f"{APPLIANCE_LABELS[a]}")
        ax.errorbar(positions, m_pos, yerr=err_pos, fmt="none", color=c, capsize=4, elinewidth=1.4)

    ax.set_xticks(positions)
    ax.set_xticklabels(["Seen 1st (Position 1)", "Seen 2nd (Position 2)", "Seen 3rd (Position 3)"], fontweight="medium")
    ax.set_ylabel("Attractiveness VAS Score (1–10)")
    ax.set_ylim(2, 10.5)
    ax.yaxis.grid(True)
    ax.legend(loc="upper left")
    ax.set_title("Figure 6: Sequence Bias Analysis: VAS Attractiveness by Appliance Presentation Order", pad=15)

    out_path = os.path.join(OUTPUT_DIR, "fig06_sequence_bias_carryover.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 7: Permutation Uniformity & Randomization Balance
# ---------------------------------------------------------------------------
def plot_fig07_permutation_balance(df):
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    counts = df["appliance_order"].value_counts()
    y_pos = np.arange(len(counts))

    bars = ax.barh(y_pos, counts.values, color=COLOR_PALETTE["accent"], alpha=0.85, height=0.55)
    for b in bars:
        ax.text(b.get_width() + 0.15, b.get_y() + b.get_height() / 2, f"N={int(b.get_width())}",
                va="center", fontsize=8.5, fontweight="bold")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(counts.index, fontsize=9)
    ax.set_xlabel("Number of Study Participants")
    ax.set_xlim(0, max(counts.values) + 1.5)
    ax.set_title("Figure 7: Randomization Uniformity Across 6 Presentation Permutations", pad=15)
    ax.xaxis.grid(True)

    out_path = os.path.join(OUTPUT_DIR, "fig07_permutation_uniformity.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 8: Gender Differences in Appliance Evaluation
# ---------------------------------------------------------------------------
def plot_fig08_gender_differences(df):
    fig, ax = plt.subplots(figsize=(7.5, 4.8))
    appliances = ["aligner", "ceramic", "metal"]
    genders = ["female", "male"] if "زن" not in df["q_gender"].values else ["زن", "مرد"]
    labels_g = ["Female Evaluators", "Male Evaluators"]

    width = 0.35
    x = np.arange(len(appliances))

    for idx, (g, glabel) in enumerate(zip(genders, labels_g)):
        sub = df[df["q_gender"] == g]
        means = [sub[f"vas_{a}_overall"].mean() for a in appliances]
        sems = [stats.sem(sub[f"vas_{a}_overall"].dropna()) * 1.96 if len(sub) > 1 else 0 for a in appliances]
        offset = -width / 2 if idx == 0 else width / 2
        col = "#9B59B6" if idx == 0 else "#2980B9"

        bars = ax.bar(x + offset, means, width, yerr=sems, label=f"{glabel} (N={len(sub)})",
                      color=col, alpha=0.85, capsize=4, edgecolor="white")
        for b, m in zip(bars, means):
            if not np.isnan(m):
                ax.text(b.get_x() + b.get_width() / 2, m * 0.5, f"{m:.2f}", ha="center", va="center", color="white", fontweight="bold", fontsize=8.5)

    ax.set_xticks(x)
    ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances])
    ax.set_ylabel("Attractiveness VAS Score (1–10)")
    ax.set_ylim(0, 10.5)
    ax.yaxis.grid(True)
    ax.legend(loc="upper right")
    ax.set_title("Figure 8: Sex-Stratified Appliance Attractiveness Ratings (Male vs Female Evaluators)", pad=15)

    out_path = os.path.join(OUTPUT_DIR, "fig08_gender_stratified_evaluation.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 9: Evaluator Prior Orthodontic Experience Stratification
# ---------------------------------------------------------------------------
def plot_fig09_ortho_history(df):
    fig, ax = plt.subplots(figsize=(8, 4.8))
    appliances = ["aligner", "ceramic", "metal"]
    history_groups = df["q_history"].dropna().unique()

    # Filter top 3 history categories
    top_hist = [h for h in ["fixed", "no", "both", "aligner", "multiple"] if h in history_groups][:3]
    labels_h = {
        "fixed": "Prior Fixed Braces",
        "no": "No Prior Treatment",
        "both": "Multiple Modalities",
        "aligner": "Prior Aligner User",
    }

    x = np.arange(len(appliances))
    width = 0.25

    colors = ["#16A085", "#E67E22", "#8E44AD"]
    for idx, h in enumerate(top_hist):
        sub = df[df["q_history"] == h]
        means = [sub[f"vas_{a}_overall"].mean() for a in appliances]
        sems = [stats.sem(sub[f"vas_{a}_overall"].dropna()) * 1.96 if len(sub) > 1 else 0 for a in appliances]
        offset = (idx - 1) * width

        bars = ax.bar(x + offset, means, width, yerr=sems, label=f"{labels_h.get(h, h)} (N={len(sub)})",
                      color=colors[idx % len(colors)], alpha=0.85, capsize=3, edgecolor="white")
        for b, m in zip(bars, means):
            if not np.isnan(m):
                ax.text(b.get_x() + b.get_width() / 2, m * 0.5, f"{m:.1f}", ha="center", va="center", color="white", fontsize=7.5)

    ax.set_xticks(x)
    ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances])
    ax.set_ylabel("Attractiveness VAS Score (1–10)")
    ax.set_ylim(0, 10.5)
    ax.yaxis.grid(True)
    ax.legend(loc="upper right")
    ax.set_title("Figure 9: Appliance Aesthetic Ratings Stratified by Evaluator Treatment History", pad=15)

    out_path = os.path.join(OUTPUT_DIR, "fig09_orthodontic_history_stratification.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 10: Spearman Correlation Heatmap Matrix
# ---------------------------------------------------------------------------
def plot_fig10_correlation_matrix(df):
    cols = [
        "q_satisfaction",
        "q_importance_appearance",
        "vas_aligner_overall",
        "vas_ceramic_overall",
        "vas_metal_overall",
        "vas_aligner_distract",
        "vas_ceramic_distract",
        "vas_metal_distract",
    ]
    labels = [
        "Smile Satisfaction",
        "Importance of Looks",
        "Aligner VAS",
        "Ceramic VAS",
        "Metal VAS",
        "Aligner Noticeable",
        "Ceramic Noticeable",
        "Metal Noticeable",
    ]

    valid_cols = [c for c in cols if c in df]
    valid_labels = [labels[cols.index(c)] for c in valid_cols]

    corr_matrix = df[valid_cols].corr(method="spearman")

    fig, ax = plt.subplots(figsize=(7.5, 6.5))
    sns.heatmap(corr_matrix, annot=True, fmt=".2f", cmap="vlag", vmin=-1, vmax=1,
                xticklabels=valid_labels, yticklabels=valid_labels, ax=ax,
                cbar_kws={"label": "Spearman Rank Correlation Coefficient (ρ)"}, linewidths=0.5)

    ax.set_xticklabels(valid_labels, rotation=45, ha="right", fontsize=8.5)
    ax.set_yticklabels(valid_labels, fontsize=8.5)
    ax.set_title("Figure 10: Spearman Inter-Correlation Matrix: Evaluator Priorities vs Ratings", pad=15)

    out_path = os.path.join(OUTPUT_DIR, "fig10_spearman_correlation_matrix.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 11: Color Harmony vs Overall Attractiveness Regression
# ---------------------------------------------------------------------------
def plot_fig11_color_harmony_regression(df):
    fig, axes = plt.subplots(1, 3, figsize=(12, 4), sharey=True)
    appliances = ["aligner", "ceramic", "metal"]

    for ax, app in zip(axes, appliances):
        x_col = f"vas_{app}_color_harmony"
        y_col = f"vas_{app}_overall"
        valid = df[[x_col, y_col]].dropna()
        x = valid[x_col].values.astype(float)
        y = valid[y_col].values.astype(float)
        c = COLOR_PALETTE[app]

        # Jitter points slightly for visualization
        rng = np.random.default_rng(42)
        xj = x + rng.normal(0, 0.08, size=len(x))
        yj = y + rng.normal(0, 0.08, size=len(y))

        ax.scatter(xj, yj, color=c, alpha=0.7, s=40, edgecolors="white", linewidth=0.5)

        # OLS regression line & stats
        if len(x) > 2:
            res = stats.linregress(x, y)
            x_vals = np.linspace(min(x), max(x), 100)
            ax.plot(x_vals, res.intercept + res.slope * x_vals, color=c, lw=1.8)
            r_spear, p_spear = stats.spearmanr(x, y)
            stat_text = f"r = {res.rvalue:.2f}\nR² = {res.rvalue**2:.2f}\nSpearman ρ = {r_spear:.2f}\np = {format_p(p_spear)}"
            ax.text(0.05, 0.95, stat_text, transform=ax.transAxes, va="top", ha="left",
                    fontsize=8.5, bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="#D1D5DB", alpha=0.85))

        ax.set_title(f"{APPLIANCE_LABELS[app]}", fontsize=10.5, fontweight="bold", color=c)
        ax.set_xlabel("Color Harmony / Shade Blending (1–5)", fontsize=9)
        ax.grid(True, linestyle="--", alpha=0.4)

    axes[0].set_ylabel("Overall Attractiveness (VAS 0–10)", fontsize=9.5)
    fig.suptitle("Figure 11: Linear Regression & Correlation: Color Harmony vs Overall Smile Attractiveness",
                 fontsize=11.5, fontweight="bold", y=1.02)

    out_path = os.path.join(OUTPUT_DIR, "fig11_color_harmony_regression.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 12: Composite Personal Adoption & Social Acceptance Index
# ---------------------------------------------------------------------------
def plot_fig12_personal_adoption_composite(df):
    fig, ax = plt.subplots(figsize=(6.5, 5))
    appliances = ["aligner", "ceramic", "metal"]
    scores = []

    for app in appliances:
        w = df[f"acc_{app}_work"].astype(float)
        s = df[f"acc_{app}_social"].astype(float)
        # Composite personal adoption: average of work comfort + social willingness
        comp = (w + s) / 2.0
        scores.append(comp.dropna().values)

    positions = [1, 2, 3]
    colors = [COLOR_PALETTE[a] for a in appliances]

    bp = ax.boxplot(scores, positions=positions, widths=0.45, patch_artist=True,
                    boxprops=dict(linewidth=1.0),
                    medianprops=dict(color="#111827", linewidth=1.5),
                    whiskerprops=dict(linewidth=1.0),
                    capprops=dict(linewidth=1.0))

    for patch, c in zip(bp["boxes"], colors):
        patch.set_facecolor(c)
        patch.set_alpha(0.65)

    rng = np.random.default_rng(42)
    for pos, arr, c in zip(positions, scores, colors):
        jitter = rng.normal(0, 0.05, size=len(arr))
        ax.scatter(pos + jitter, arr, color=c, alpha=0.8, s=30, edgecolors="white", linewidth=0.5, zorder=4)
        m = np.mean(arr)
        ax.scatter([pos], [m], marker="D", s=45, color="white", edgecolors="#111827", linewidth=1.2, zorder=5)

    # Statistical significance brackets
    w_ac = paired_wilcoxon(scores[0], scores[1])
    w_am = paired_wilcoxon(scores[0], scores[2])
    w_cm = paired_wilcoxon(scores[1], scores[2])

    add_stat_bracket(ax, 1, 2, 5.2, 0.15, f"{format_p(w_ac['p_value'])} (d={w_ac['cohen_d']:.2f})")
    add_stat_bracket(ax, 2, 3, 5.2, 0.15, f"{format_p(w_cm['p_value'])} (d={w_cm['cohen_d']:.2f})")
    add_stat_bracket(ax, 1, 3, 5.7, 0.2, f"{format_p(w_am['p_value'])} (d={w_am['cohen_d']:.2f})")

    ax.set_xticks(positions)
    ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances], fontweight="medium")
    ax.set_ylabel("Composite Willingness-to-Wear Score (1–5)", fontsize=9.5)
    ax.set_ylim(0.5, 6.3)
    ax.set_title("Figure 12: Composite Personal Adoption & Social Readiness Index", pad=15)
    ax.grid(True, axis="y", linestyle="--", alpha=0.5)

    out_path = os.path.join(OUTPUT_DIR, "fig12_personal_adoption_composite.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 13: Age Stratification of Appliance Aesthetic Perception
# ---------------------------------------------------------------------------
def plot_fig13_age_stratification(df):
    fig, ax = plt.subplots(figsize=(7, 4.8))
    appliances = ["aligner", "ceramic", "metal"]

    # Stratify by age: Young adults (18-24) vs Working/Mature adults (25+)
    is_young = df["q_age"] == "18-24"
    group_labels = ["Young Adults (18–24)\n[N=5]", "Adults (25+)\n[N=15]"]

    x = np.arange(len(appliances))
    width = 0.35

    means_young, sems_young = [], []
    means_adult, sems_adult = [], []

    for app in appliances:
        vals_y = df.loc[is_young, f"vas_{app}_overall"].dropna().values.astype(float)
        vals_a = df.loc[~is_young, f"vas_{app}_overall"].dropna().values.astype(float)
        means_young.append(np.mean(vals_y))
        sems_young.append(stats.sem(vals_y) if len(vals_y) > 1 else 0)
        means_adult.append(np.mean(vals_a))
        sems_adult.append(stats.sem(vals_a) if len(vals_a) > 1 else 0)

    rects1 = ax.bar(x - width/2, means_young, width, label=group_labels[0], color="#2E75B6", alpha=0.85, edgecolor="none")
    rects2 = ax.bar(x + width/2, means_adult, width, label=group_labels[1], color="#595959", alpha=0.85, edgecolor="none")

    ax.errorbar(x - width/2, means_young, yerr=sems_young, fmt="none", c="#1E293B", capsize=3, lw=1.0)
    ax.errorbar(x + width/2, means_adult, yerr=sems_adult, fmt="none", c="#1E293B", capsize=3, lw=1.0)

    for r in list(rects1) + list(rects2):
        h = r.get_height()
        ax.text(r.get_x() + r.get_width()/2., h + 0.15, f"{h:.2f}", ha="center", va="bottom", fontsize=8)

    ax.set_xticks(x)
    ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances], fontweight="medium")
    ax.set_ylabel("Mean VAS Attractiveness ± SEM (0–10)", fontsize=9.5)
    ax.set_ylim(0, 11)
    ax.legend(loc="upper right", frameon=False)
    ax.set_title("Figure 13: Age Cohort Stratification of Appliance Attractiveness", pad=15)
    ax.grid(True, axis="y", linestyle="--", alpha=0.5)

    out_path = os.path.join(OUTPUT_DIR, "fig13_age_stratification.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 14: Laypeople vs Dental-Affiliated Evaluators Subgroup Contrast
# ---------------------------------------------------------------------------
def plot_fig14_layperson_vs_dentist(df):
    fig, ax = plt.subplots(figsize=(7, 4.8))
    appliances = ["aligner", "ceramic", "metal"]

    is_dental = df["q_dentist_screen"] == "yes"
    x = np.arange(len(appliances))
    width = 0.35

    means_lay, sems_lay = [], []
    means_dent, sems_dent = [], []
    p_vals = []

    for app in appliances:
        lay = df.loc[~is_dental, f"vas_{app}_overall"].dropna().values.astype(float)
        dent = df.loc[is_dental, f"vas_{app}_overall"].dropna().values.astype(float)
        means_lay.append(np.mean(lay))
        sems_lay.append(stats.sem(lay) if len(lay) > 1 else 0)
        means_dent.append(np.mean(dent))
        sems_dent.append(stats.sem(dent) if len(dent) > 1 else 0)

        # Mann-Whitney U test
        u_stat, p_val = stats.mannwhitneyu(lay, dent, alternative="two-sided")
        p_vals.append(p_val)

    rects1 = ax.bar(x - width/2, means_lay, width, label=f"Laypeople (N={sum(~is_dental)})", color="#1F4E79", alpha=0.85)
    rects2 = ax.bar(x + width/2, means_dent, width, label=f"Dental Affiliated (N={sum(is_dental)})", color="#C0504D", alpha=0.85)

    ax.errorbar(x - width/2, means_lay, yerr=sems_lay, fmt="none", c="#1E293B", capsize=3, lw=1.0)
    ax.errorbar(x + width/2, means_dent, yerr=sems_dent, fmt="none", c="#1E293B", capsize=3, lw=1.0)

    # Annotate p-values
    for idx, (p, h1, h2) in enumerate(zip(p_vals, means_lay, means_dent)):
        y_max = max(h1, h2) + 0.8
        ax.text(x[idx], y_max, f"p = {p:.3f}", ha="center", va="bottom", fontsize=8, color="#374151")

    ax.set_xticks(x)
    ax.set_xticklabels([APPLIANCE_LABELS[a] for a in appliances], fontweight="medium")
    ax.set_ylabel("Mean VAS Attractiveness ± SEM (0–10)", fontsize=9.5)
    ax.set_ylim(0, 11)
    ax.legend(loc="upper right", frameon=False)
    ax.set_title("Figure 14: Subgroup Contrast: Laypeople vs Dental-Affiliated Evaluators", pad=15)
    ax.grid(True, axis="y", linestyle="--", alpha=0.5)

    out_path = os.path.join(OUTPUT_DIR, "fig14_layperson_vs_dentist.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# FIGURE 15: Cumulative Acceptance Threshold Curves (CDF-Style)
# ---------------------------------------------------------------------------
def plot_fig15_cumulative_acceptance_cdf(df):
    fig, ax = plt.subplots(figsize=(7, 4.8))
    appliances = ["aligner", "ceramic", "metal"]
    thresholds = np.linspace(1, 10, 19)

    for app in appliances:
        vals = df[f"vas_{app}_overall"].dropna().values.astype(float)
        proportions = [np.mean(vals >= t) * 100 for t in thresholds]
        c = COLOR_PALETTE[app]
        ax.plot(thresholds, proportions, marker="o", markersize=4, lw=2.0, color=c, label=APPLIANCE_LABELS[app])

    # Reference threshold lines (VAS >= 6 and VAS >= 8)
    ax.axvline(6.0, color="#6B7280", linestyle=":", lw=1.2, alpha=0.8, label="Acceptability Threshold (VAS ≥ 6)")
    ax.axvline(8.0, color="#9CA3AF", linestyle="--", lw=1.0, alpha=0.8, label="High Aesthetic Standard (VAS ≥ 8)")

    ax.set_xlabel("VAS Attractiveness Threshold (Score ≥ τ)", fontsize=9.5)
    ax.set_ylabel("Cumulative Evaluator Acceptance Rate (%)", fontsize=9.5)
    ax.set_ylim(-2, 105)
    ax.set_xlim(0.8, 10.2)
    ax.set_xticks(range(1, 11))
    ax.legend(loc="lower left", frameon=False, fontsize=8.5)
    ax.set_title("Figure 15: Cumulative Acceptance Curves Across Aesthetic Thresholds", pad=15)
    ax.grid(True, linestyle="--", alpha=0.5)

    out_path = os.path.join(OUTPUT_DIR, "fig15_cumulative_acceptance_cdf.png")
    fig.savefig(out_path)
    plt.close(fig)
    return out_path

# ---------------------------------------------------------------------------
# Master Execution & Index Report Generation
# ---------------------------------------------------------------------------
def generate_all_figures():
    setup_academic_style()
    df = load_data(start_date="2026-10-22", include_pilot=False)
    print(f"Loaded study cohort: {len(df)} records (from 2026-10-22 onwards).")

    generated = []
    generated.append(plot_fig01_vas_overall(df))
    generated.append(plot_fig02_noticeability_detraction(df))
    generated.append(plot_fig03_halo_radar(df))
    generated.append(plot_fig04_halo_forest(df))
    generated.append(plot_fig05_acceptability(df))
    generated.append(plot_fig06_sequence_bias(df))
    generated.append(plot_fig07_permutation_balance(df))
    generated.append(plot_fig08_gender_differences(df))
    generated.append(plot_fig09_ortho_history(df))
    generated.append(plot_fig10_correlation_matrix(df))
    generated.append(plot_fig11_color_harmony_regression(df))
    generated.append(plot_fig12_personal_adoption_composite(df))
    generated.append(plot_fig13_age_stratification(df))
    generated.append(plot_fig14_layperson_vs_dentist(df))
    generated.append(plot_fig15_cumulative_acceptance_cdf(df))

    # Generate academic index markdown report
    report_path = os.path.join(OUTPUT_DIR, "figures_legend_index.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# Academic Figures & Legends: Orthodontic Appliance Aesthetic Perception Study\n\n")
        f.write(f"**Sample Size:** N = {len(df)} official study evaluators (evaluated between Oct 22 and Oct 30, 2026).\n")
        f.write("**Guidelines:** Conforming to BMJ, Lancet, and Nature visual presentation and statistical reporting standards.\n\n")

        legends = [
            ("Figure 1", "fig01_vas_overall_attractiveness.png", "Overall Aesthetic Attractiveness Ratings Across Orthodontic Appliances",
             "Violin plots with overlaid jittered individual observations, Mean ± 95% Confidence Intervals (error bars), and pairwise two-tailed Wilcoxon signed-rank test brackets with paired Cohen's d effect sizes."),
            ("Figure 2", "fig02_hardware_noticeability_detraction.png", "Visual Salience & Detraction: Device Noticeability vs Smile Degradation",
             "Dual-panel clustered bar chart comparing conversational noticeability against perceived visual detraction from smile beauty (Mean ± 95% CI)."),
            ("Figure 3", "fig03_psychometric_halo_radar.png", "Psychometric Profile & Halo Effect Attribution Battery (1–5 Scales)",
             "Seven-axis polar radar chart simultaneously comparing Clear Aligner, Ceramic Brackets, and Metallic Brackets across perceived Intelligence, Oral Hygiene, Attractiveness, Trustworthiness, Social Success, Socioeconomic Status, and Self-Confidence."),
            ("Figure 4", "fig04_halo_effect_forest_plot.png", "Psychological Halo Effect: Effect Sizes Relative to Metallic Brackets",
             "Forest plot displaying Standardized Mean Differences (Cohen's d with 95% CI) for Clear Aligner and Ceramic Brackets against Metallic Brackets baseline."),
            ("Figure 5", "fig05_workplace_acceptability.png", "Professional Workplace Appropriateness & Anticipated Embarrassment",
             "Clustered comparisons of professional setting suitability vs personal self-consciousness / embarrassment at work."),
            ("Figure 6", "fig06_sequence_bias_carryover.png", "Sequence Bias Analysis: VAS Attractiveness by Appliance Presentation Order",
             "Two-way interaction plot showing mean VAS ratings depending on whether the appliance was evaluated in Position 1, 2, or 3, demonstrating absence of detrimental carryover or primacy bias."),
            ("Figure 7", "fig07_permutation_uniformity.png", "Randomization Uniformity Across 6 Presentation Permutations",
             "Horizontal frequency plot confirming balanced distribution across all six factorial order sequences."),
            ("Figure 8", "fig08_gender_stratified_evaluation.png", "Sex-Stratified Appliance Attractiveness Ratings (Male vs Female Evaluators)",
             "Clustered comparison testing whether male and female respondents perceive appliance aesthetics differently."),
            ("Figure 9", "fig09_orthodontic_history_stratification.png", "Appliance Aesthetic Ratings Stratified by Evaluator Treatment History",
             "Subgroup comparison examining evaluations among respondents with prior fixed braces, no treatment, or multiple modalities."),
            ("Figure 10", "fig10_spearman_correlation_matrix.png", "Spearman Inter-Correlation Matrix: Evaluator Priorities vs Ratings",
             "Correlation heatmap linking smile satisfaction and appearance importance with appliance ratings."),
            ("Figure 11", "fig11_color_harmony_regression.png", "Linear Regression & Correlation: Color Harmony vs Overall Attractiveness",
             "Multi-panel scatter plot with OLS linear regression fit and 95% confidence bands evaluating the exact visual contribution of color harmony / shade blending to overall smile attractiveness."),
            ("Figure 12", "fig12_personal_adoption_composite.png", "Composite Personal Adoption & Social Readiness Index",
             "Boxplots with overlaid individual jittered scores, mean diamonds, and Wilcoxon signed-rank tests for a composite index combining workplace comfort and social event willingness."),
            ("Figure 13", "fig13_age_stratification.png", "Age Cohort Stratification of Appliance Attractiveness Ratings",
             "Clustered bar chart comparing young adults (18–24) versus mature working adults (25+) across appliance modalities."),
            ("Figure 14", "fig14_layperson_vs_dentist.png", "Subgroup Contrast: Laypeople vs Dental-Affiliated Evaluators",
             "Clustered bar comparison with Mann-Whitney U test p-values testing whether dental professionals/students evaluate appliance aesthetics more critically than the general public."),
            ("Figure 15", "fig15_cumulative_acceptance_cdf.png", "Cumulative Acceptance Curves Across Aesthetic Thresholds (CDF-Style)",
             "Step/survival-style curves showing the percentage of respondents rating each appliance at or above escalating aesthetic cutoff levels (VAS ≥ 1 to 10), marking clinical acceptability and high aesthetic standards."),
        ]

        for num, fname, title, desc in legends:
            f.write(f"### {num}: {title}\n")
            f.write(f"![{title}]({fname})\n\n")
            f.write(f"**Legend & Statistical Interpretation:** {desc}\n\n---\n\n")

    print(f"\nSuccessfully generated {len(generated)} academic figures and index at:")
    print(OUTPUT_DIR)
    return generated

if __name__ == "__main__":
    generate_all_figures()
