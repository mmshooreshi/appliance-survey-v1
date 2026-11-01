* =========================================================================.
* SPSS SYNTAX FOR ORTHODONTIC APPLIANCE AESTHETIC PERCEPTION THESIS.
* Supervised by Dr. Amirhossein Mirhashemi & Dr. Atefe Saffar Shahroudi.
* Statistical Consultant: Dr. Mohammad Javad Kharazifard (TUMS).
* Target Dataset: Proposal_Core_SPSS Sheet.
* =========================================================================.

VARIABLE LABELS
  id "شناسه شرکت‌کننده (Participant ID)"
  gender "جنسیت (Gender)"
  age_group "رده سنی (Age Group)"
  edu_level "سطح تحصیلات (Education Level)"
  seq_order "کد جایگشت توالی نمایش ۳ دستگاه (Presentation Order Permutation)"
  order_first_app "اولین دستگاه مشاهده‌شده (First Displayed Appliance)"
  vas_aligner "نمره ادراک زیبایی کلیر الاینر (Clear Aligner Aesthetic VAS: 0-10)"
  vas_ceramic "نمره ادراک زیبایی براکت سرامیکی (Ceramic Bracket Aesthetic VAS: 0-10)"
  vas_metal "نمره ادراک زیبایی براکت فلزی (Metallic Bracket Aesthetic VAS: 0-10)"
  dentist_screen "غربالگری دندان‌پزشکی / معیار ورود (Dental Profession Screen / Inclusion)"
  ortho_history "سابقه درمان ارتودنسی / معیار خروج (Past Orthodontic Treatment / Exclusion)"
  eligible_proposal "انطباق با معیارهای ورود و خروج پروپوزال (Strict Proposal Eligibility)"
.

VALUE LABELS
  gender
    1 "Male (مرد)"
    2 "Female (زن)"
  age_group
    1 "Under 18 (<18)"
    2 "18-24 years"
    3 "25-34 years"
    4 "35-44 years"
    5 "45-54 years"
    6 "55+ years"
  edu_level
    1 "Diploma / High School"
    2 "University Student (دانشجو)"
    3 "Bachelor (کارشناسی)"
    4 "Master (کارشناسی ارشد)"
    5 "PhD / Professional Doctorate (دکتری و بالاتر)"
  seq_order
    1 "Aligner > Ceramic > Metal"
    2 "Aligner > Metal > Ceramic"
    3 "Ceramic > Aligner > Metal"
    4 "Ceramic > Metal > Aligner"
    5 "Metal > Aligner > Ceramic"
    6 "Metal > Ceramic > Aligner"
  order_first_app
    1 "Clear Aligner"
    2 "Ceramic Bracket"
    3 "Metallic Bracket"
  vas_aligner
    0 "0-Completely Unattractive"
    10 "10-Completely Attractive"
  vas_ceramic
    0 "0-Completely Unattractive"
    10 "10-Completely Attractive"
  vas_metal
    0 "0-Completely Unattractive"
    10 "10-Completely Attractive"
  dentist_screen
    0 "Layperson / Eligible (خیر - فرد عادی)"
    1 "Dental Student/Dentist / Excluded (بله - دندانپزشک)"
  ortho_history
    1 "None / No History (بدون سابقه قبلی)"
    2 "Fixed Brackets (براکت ثابت)"
    3 "Clear Aligner (الاینر شفاف)"
    4 "Removable Appliance (پلاک متحرک)"
    5 "Multiple Appliances (بیش از یک نوع)"
  eligible_proposal
    0 "Excluded (دارای معیار خروج: دندانپزشک یا سابقه ارتودنسی)"
    1 "Eligible (واجد شرایط کامل: فرد عادی بدون سابقه ارتودنسی)"
.

VARIABLE LEVEL
  id (NOMINAL)
  gender (NOMINAL)
  age_group (ORDINAL)
  edu_level (ORDINAL)
  seq_order (NOMINAL)
  order_first_app (NOMINAL)
  vas_aligner (SCALE)
  vas_ceramic (SCALE)
  vas_metal (SCALE)
  dentist_screen (NOMINAL)
  ortho_history (NOMINAL)
  eligible_proposal (NOMINAL)
.

EXECUTE.

* -------------------------------------------------------------------------.
* 1. DESCRIPTIVE STATISTICS & FREQUENCIES.
* -------------------------------------------------------------------------.
FREQUENCIES VARIABLES=gender age_group edu_level seq_order dentist_screen ortho_history eligible_proposal
  /ORDER=ANALYSIS.

DESCRIPTIVES VARIABLES=vas_aligner vas_ceramic vas_metal
  /STATISTICS=MEAN STDDEV MIN MAX SEMEAN.

* -------------------------------------------------------------------------.
* 2. TEST OF NORMALITY (SHAPIRO-WILK).
* -------------------------------------------------------------------------.
EXAMINE VARIABLES=vas_aligner vas_ceramic vas_metal
  /PLOT NPPLOT
  /STATISTICS DESCRIPTIVES.

* -------------------------------------------------------------------------.
* 3. PRIMARY OBJECTIVE: REPEATED MEASURES ANOVA (WITHIN-SUBJECT: APPLIANCE).
* -------------------------------------------------------------------------.
GLM vas_aligner vas_ceramic vas_metal
  /WSFACTOR=Appliance 3 Polynomial
  /METHOD=SSTYPE(3)
  /EMMEANS=TABLES(Appliance) COMPARE ADJ(BONFERRONI)
  /PRINT=DESCRIPTIVE ETASQ HOMOGENEITY
  /CRITERIA=ALPHA(.05)
  /WSDESIGN=Appliance.

* -------------------------------------------------------------------------.
* 4. NON-PARAMETRIC ALTERNATIVE: FRIEDMAN TEST & POST-HOC WILCOXON.
* -------------------------------------------------------------------------.
NPAR TESTS
  /FRIEDMAN=vas_aligner vas_ceramic vas_metal.

NPAR TESTS
  /WILCOXON=vas_aligner WITH vas_ceramic (PAIRED)
            vas_aligner WITH vas_metal (PAIRED)
            vas_ceramic WITH vas_metal (PAIRED)
  /CRITERIA=ALPHA(0.05).

* -------------------------------------------------------------------------.
* 5. SECONDARY OBJECTIVES: EFFECTS OF GENDER, AGE, AND EDUCATION.
* -------------------------------------------------------------------------.
GLM vas_aligner vas_ceramic vas_metal BY gender
  /WSFACTOR=Appliance 3 Polynomial
  /EMMEANS=TABLES(gender*Appliance) COMPARE(Appliance) ADJ(BONFERRONI)
  /WSDESIGN=Appliance
  /DESIGN=gender.

GLM vas_aligner vas_ceramic vas_metal BY age_group
  /WSFACTOR=Appliance 3 Polynomial
  /WSDESIGN=Appliance
  /DESIGN=age_group.

GLM vas_aligner vas_ceramic vas_metal BY edu_level
  /WSFACTOR=Appliance 3 Polynomial
  /WSDESIGN=Appliance
  /DESIGN=edu_level.

* -------------------------------------------------------------------------.
* 6. ORDER EFFECT / COUNTERBALANCING VERIFICATION.
* -------------------------------------------------------------------------.
GLM vas_aligner vas_ceramic vas_metal BY seq_order
  /WSFACTOR=Appliance 3 Polynomial
  /WSDESIGN=Appliance
  /DESIGN=seq_order.

* -------------------------------------------------------------------------.
* 7. STRICT PROPOSAL ELIGIBILITY FILTER (EXCLUDING DENTISTS & PAST ORTHO).
* -------------------------------------------------------------------------.
USE ALL.
COMPUTE filter_$=(eligible_proposal = 1).
VARIABLE LABELS filter_$ 'eligible_proposal = 1 (FILTER)'.
VALUE LABELS filter_$ 0 'Not Selected' 1 'Selected'.
FORMATS filter_$ (f1.0).
FILTER BY filter_$.

GLM vas_aligner vas_ceramic vas_metal
  /WSFACTOR=Appliance 3 Polynomial
  /EMMEANS=TABLES(Appliance) COMPARE ADJ(BONFERRONI)
  /WSDESIGN=Appliance.

FILTER OFF.
EXECUTE.
