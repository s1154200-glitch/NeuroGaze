# NeuroGaze — ADHD Eye-Tracking Screening Suite

NeuroGaze is a browser-based ADHD screening tool that uses your webcam and the [WebGazer.js](https://webgazer.cs.brown.edu/) library to measure eye-movement biomarkers associated with attention and impulse control. No installation is required — just open the HTML files in a modern desktop browser.

---

## Features

- **9-point gaze calibration** with accuracy scoring
- **4 clinical ADHD tests** each measuring distinct biomarkers
- **4 training games** that exercise the same cognitive skills as the tests
- **Dashboard** showing test status and per-biomarker zone indicators
- **Results page** with detailed charts and per-test breakdowns
- **Analysis page** with trend tracking across multiple sessions
- **Fake data generator** (`fake-data.html`) for development and demo purposes

---

## Requirements

| Requirement | Details |
|---|---|
| Browser | Chrome or Edge (desktop) — WebGazer relies on the MediaPipe FaceMesh API |
| Webcam | Any standard webcam; a front-facing laptop camera works fine |
| Lighting | Stable, even front lighting (avoid backlighting) |
| Screen | Laptop or monitor; avoid mobile/tablet (gaze accuracy degrades at small sizes) |
| Internet | Required on first load to fetch MediaPipe FaceMesh assets from CDN |

---

## Getting Started

### 1. Open the dashboard

```bash
# Python 3
python3 -m http.server 8080
# then open http://localhost:8080/dashboard.html
```

### 2. Calibrate

Click **Calibration** in the sidebar (or the calibration card on the dashboard).

1. Allow camera access when the browser prompts.
2. Position your face inside the guide box — centred, ~50–70 cm from the screen.
3. Click **Start Calibration** and follow each of the **9 dots** by looking directly at them and clicking.
4. After all 9 points, a brief accuracy check runs. If accuracy is ≥ 70 % the calibration is saved.
5. Re-calibrate any time accuracy feels off (button in the top-right of every test page).

> Good calibration is essential. Poor lighting or a moving head will reduce accuracy.

### 3. Run the tests

Navigate to any test from the sidebar under **ADHD Tests**. Each test has an intro screen explaining the task. Complete them in any order.

| Test | Duration | What it measures |
|---|---|---|
| **Fixation Stability** | ~30 s | BCEA, variance drift, square-wave jerks, quiet-eye % |
| **Antisaccade** | ~3 min | Directional error rate, saccadic latency, latency CV, correction time |
| **CPT (Go/No-Go)** | ~5 min | Commission errors, omission errors, response-time variability, gaze wander, attentional decay |
| **Distractor Recovery** | ~2 min | Gaze reorientation latency (GRL), distractor capture rate, off-task time |

### 4. View results

- **Dashboard** — shows the latest ADHD probability from each test and live biomarker zone indicators.
- **Results** (`results.html`) — full breakdown with charts for the most recent session, including scatter plots, latency histograms, and per-test detail panels.
- **Analysis** (`analyze.html`) — trend view across all saved sessions; shows improvement/regression badges and AI-generated insights per test.

---

## Calibration Features

After calibration completes, three real-time systems activate to keep gaze estimates accurate as your head moves.

---

### Face Positioning

A face-boundary box and info badge are overlaid on the camera preview. Using 468-point MediaPipe face-mesh landmarks, the system computes your nose-tip position, inter-pupillary distance (IPD), and face bounding box and saves them as a **reference state** at calibration time.

Each frame, the live face state is compared to that reference:

| Deviation | Status | Visual indicator |
|---|---|---|
| ≤ 25 % | OK | Green boundary box |
| 25 – 50 % | Shifted | Yellow / warning banner |
| > 50 % | Out of Range | Red banner + accuracy recheck after 3 s |

The info badge shows real-time **positional offset (px)** and **depth (IPD %)** values alongside an OK / Shifted / Out of Range label.

---

### Range Check

When enabled, the system monitors whether your face has drifted significantly from the calibration position. If the **Out of Range** state persists for more than **3 seconds**, an accuracy recheck is triggered automatically — you are asked to look at the centre dot and the gaze model is verified against the known target.

If you disable Range Check, the warning banners are suppressed and no automatic recheck occurs (useful when testing with a head-mounted display or fixed chin-rest).

---

### Offset Correction

Raw WebGazer gaze predictions assume your head is in the same position it was during calibration. Offset Correction compensates for head movement in real time using three components:

| Component | What it compensates |
|---|---|
| **Position shift** | Horizontal/vertical nose-tip displacement (mirrored) scaled to screen pixels |
| **Depth (IPD ratio)** | Lean closer/farther — gaze prediction contracts/expands outward from screen centre |
| **Z-depth fine-tune** | Residual nose-landmark z-delta applied at ×0.002 scale |

The corrected coordinates are used by every test instead of the raw WebGazer output.

Disabling Offset Correction passes raw WebGazer coordinates directly to the tests — helpful for measuring baseline WebGazer accuracy or matching earlier datasets.

---

### Tolerance Radius — tol80

After calibration completes, all gaze samples collected during the accuracy check are sorted by their Euclidean distance from the target dot. The **80th-percentile distance** of this sorted list is stored as `tol80` and saved to `localStorage` as `neurogaze_cal_tol80`.

$$\text{tol80} = \text{sorted\_distances}\left[\lfloor n \times 0.8 \rfloor\right]$$

where $n$ is the number of accuracy-check samples and distances are computed as:

$$d_i = \sqrt{(x_i - c_x)^2 + (y_i - c_y)^2}$$

with $(c_x, c_y)$ being the centre of the target dot in screen pixels.

`tol80` is used across the app as a **personalised gaze tolerance window** calibrated to the user's actual webcam accuracy:

| Consumer | How tol80 is applied | Hard limits |
|---|---|---|
| Fixation Stability test | Sets `QE_RADIUS_PX` — the radius for Quiet Eye scoring | 20 – 300 px |
| Antisaccade test | Sets `lastTol80` for hit detection on each trial | — |
| Distractor Recovery game | Sets `HIT_RADIUS` for target-hit detection | 80 – 250 px |
| Calibration gaze-demo | Sets `toleranceRadius` for the on-screen accuracy ring | 15 – 400 px |

This means users with lower-quality webcams or poor lighting still get fair hit detection, because tolerances expand proportionally to their actual measured gaze error rather than using a fixed pixel value.

---

## ADHD Tests — Details

### Fixation Stability Test
You look at a stationary dot for 30 seconds. The test measures how stable your gaze is.

- **BCEA (Bivariate Contour Ellipse Area)** — the area (in degrees²) that contains 68 % of gaze samples. Higher = less stable.
- **Variance Drift** — whether gaze scatter increases over time (early vs. late 10 s).
- **Square Wave Jerks (SWJ)** — involuntary rapid eye movements away from and back to fixation.
- **Quiet Eye %** — fraction of time gaze stays within 50 px of the target.

### Antisaccade Test
A stimulus flashes on one side of the screen. You must look to the **opposite** side. This requires suppressing a reflexive glance.

- **Error Rate** — how often you looked toward the stimulus instead of away.
- **Saccadic Latency** — how quickly you initiated the correct eye movement.
- **Latency CV** — coefficient of variation of latency; higher = more inconsistent.
- **Correction Time** — how quickly you corrected a wrong saccade.

### Continuous Performance Test (CPT)
Letters appear one at a time. Press **Space** for every letter **except X**. Tests sustained attention over time.

- **Commission Rate** — pressing Space on X (false alarm / impulsive response).
- **Omission Rate** — missing a Go letter (inattention).
- **Response Time Variability (RTV)** — SD of correct reaction times; higher = more variable attention.
- **Gaze Wander** — % of time gaze strayed from the screen centre.
- **Attentional Decay** — difference in omission rate between the first and second half.

### CPT Training Game
The gamified CPT (**Goldfish Scooping**) uses a **3-life system** represented by three bamboo nets in the HUD. Press **Space** to scoop koi fish; do not press for lotus leaves. Each mistake (scooping a lotus leaf or letting a fish escape) costs one life. The game ends when all 3 lives are lost.

### Distractor Recovery Test
Track a smoothly moving dot (figure-8 path). Four times during the task a bright coloured flash appears on the periphery. After each distractor, the test measures how quickly and reliably you return focus to the target.

- **Gaze Reorientation Latency (GRL)** — time from distractor offset to stable return to target.
- **Capture Rate** — fraction of distractors that pulled gaze away from target.
- **Off-Task Time** — total percentage of task time gaze was away from the target zone.

---

## Training Games

The **ADHD Trains** section in the sidebar contains gamified versions of each test. They use the same eye-tracking mechanics but are designed to be engaging rather than clinical.

| Game | Theme |
|---|---|
| **Fixation Stability Game** | Hold gaze on a vault dial to crack it |
| **Antisaccade Game** | Deflect incoming orbs by looking to the correct shield |
| **CPT Game** | Catch koi fish (Go) while ignoring lotus leaves (No-Go) — 3 lives |
| **Distractor Recovery Game** | Aim a fire hose at burning windows while ignoring distractions |

Games do **not** record data to the test history and do not affect your ADHD probability scores.

---

## ADHD Probability Calculation

Each test produces an **ADHD probability score (0–100 %)** by combining biomarker sub-scores through a weighted formula. Each sub-score is a smooth sigmoid mapping from the neurotypical (TD) threshold (→ 0) to the ADHD threshold (→ 1), clamped to [0, 1].

---

### Fixation Stability Test

| Biomarker | Weight | TD threshold | ADHD threshold |
|---|---|---|---|
| BCEA | **40 %** | 3.5 °² | 5.0 °² |
| Square Wave Jerks | **25 %** | 3 SWJ / 30 s | 8 SWJ / 30 s |
| Variance Drift | **20 %** | 0 % increase | 75 % increase |
| Quiet Eye % | **15 %** | > 60 % on-target | < 35 % on-target |

$$P_{fix} = 0.40 \cdot S_{BCEA} + 0.25 \cdot S_{SWJ} + 0.20 \cdot S_{drift} + 0.15 \cdot S_{QE}$$

---

### Antisaccade Test

| Biomarker | Weight | TD threshold | ADHD threshold |
|---|---|---|---|
| Error Rate | **55 %** | 15 % | 35 % |
| Latency CV | **30 %** | 30 % | 60 % |
| Correction Time | **15 %** | 200 ms | 500 ms |

$$P_{anti} = 0.55 \cdot S_{err} + 0.30 \cdot S_{CV} + 0.15 \cdot S_{cor}$$

---

### Continuous Performance Test (CPT)

| Biomarker | Weight | TD threshold | ADHD threshold |
|---|---|---|---|
| Response Time Variability (RTV) | **30 %** | 80 ms SD | 160 ms SD |
| Commission Rate | **25 %** | 5 % | 15 % |
| Omission Rate | **20 %** | 2 % | 10 % |
| Gaze Wander | **15 %** | 10 % | 30 % |
| Attentional Decay (Δ omission) | **10 %** | 3 % | 10 % |

$$P_{CPT} = 0.30 \cdot S_{RTV} + 0.25 \cdot S_{com} + 0.20 \cdot S_{omi} + 0.15 \cdot S_{gaze} + 0.10 \cdot S_{decay}$$

---

### Distractor Recovery Test

Sub-scores are linear interpolations between TD and ADHD thresholds (0–100 scale), not sigmoid.

| Biomarker | Weight | TD threshold | ADHD threshold |
|---|---|---|---|
| Gaze Reorientation Latency (GRL) | **50 %** | ≤ 100 ms | ≥ 720 ms |
| Distractor Capture Rate | **25 %** | ≤ 50 % | ≥ 80 % |
| Off-Task Time | **25 %** | ≤ 10 % | ≥ 25 % |

$$P_{DR} = 0.50 \cdot S_{GRL} + 0.25 \cdot S_{cap} + 0.25 \cdot S_{OT}$$

where each $S$ is linearly scaled: $S = \dfrac{\text{value} - \text{TD threshold}}{\text{ADHD threshold} - \text{TD threshold}}$, clamped to [0, 100].

---

### Final ADHD Probability Score

The global score combines all four per-test probabilities into a single weighted composite. If a test has not been completed, its weight is redistributed proportionally among the remaining tests.

| Test | Weight | Rationale |
|---|---|---|
| Antisaccade | **35 %** | Gold standard for inhibitory control |
| CPT | **30 %** | Primary marker for sustained attention / variability |
| Distractor Recovery | **20 %** | Marker for attentional stickiness |
| Fixation Stability | **15 %** | Baseline oculomotor noise |

$$P_{final} = 0.35 \cdot P_{anti} + 0.30 \cdot P_{CPT} + 0.20 \cdot P_{DR} + 0.15 \cdot P_{fix}$$

---

### Interpretation

| Score | Interpretation |
|---|---|
| 0 – 35 % | Neurotypical pattern |
| 35 – 60 % | Borderline / monitor |
| > 60 % | ADHD-like pattern |

> Scores are indicators derived from webcam-based gaze data and should not be interpreted as clinical diagnoses.

---

## Data & Privacy

All data is stored **locally in your browser's `localStorage`**. Nothing is sent to any server.

| Key | Contents |
|---|---|
| `neurogaze_cal_done` | Whether calibration has been completed |
| `neurogaze_cal_accuracy` | Last calibration accuracy (%) |
| `neurogaze_cal_time` | Timestamp of last calibration |
| `neurogaze_test_history` | Array of Fixation / Antisaccade / CPT result objects |
| `neurogaze_dr_results` | Array of Distractor Recovery result objects |

To clear all data: open **DevTools → Application → Local Storage** and delete the keys above, or use the **Delete Calibration Data** button on the dashboard calibration card.

---

## File Structure

```
dashboard.html              — Main entry point
calibration.html            — 9-point gaze calibration
fixation-stability-test.html
antisaccade-test.html
cpt-test.html
distractor-recovery-test.html
fixation-stability-game.html
antisaccade-game.html
cpt-game.html
distractor-recovery-game.html
results.html                — Per-session results viewer
analyze.html                — Multi-session trend analysis
fake-data.html              — Dev tool: inject fake test results

js/                         — All JavaScript modules
css/                        — Stylesheets per page
webgazer.js                 — WebGazer eye-tracking library
```

---

## Troubleshooting

**Camera access denied**
Go to your browser's site settings and allow camera access for the current origin (`file://` or `localhost`).

**"Calibration not done" shown after calibrating**
Calibration data is stored in `localStorage`. Make sure you are opening the same file path each session, or use a local server so the origin is consistent.

**Gaze dot is far from where I'm looking**
Re-calibrate. Ensure even lighting, sit at a consistent distance, and avoid moving your head during calibration. The accuracy check at the end must reach ≥ 70 %.

**Tests show NaN or — for all values**
Run a calibration first, then complete the desired test. The dashboard reads from `localStorage` which is empty until at least one test has been saved.

**Results look unrealistic**
WebGazer adds ~2–4° of gaze scatter compared to clinical eye trackers. Thresholds in the tests are adjusted for this, but results are best interpreted as trends across multiple sessions rather than single absolute values.

---

## Development

### Fake Data Generator (`fake-data.html`)

To inject realistic fake data for UI testing without running real tests, open `fake-data.html` in the browser:

1. Tick the tests you want to generate data for.
2. Choose a profile: **Mixed**, **Neurotypical (TD)**, or **ADHD**.
3. Click **Generate & Save** — data is written to `localStorage` immediately.
4. Reload `dashboard.html` to see the results.

### Gaze Test Page (`gaze-test.html`)

This page is for development use only. Regular users do not need to open it.

`gaze-test.html` is an internal diagnostic tool used during development to tune and verify three low-level eye-tracking systems:

- **Tolerance radius** — visualises the gaze hit radius used by the tests to determine whether the user is looking at a target.
- **Calibration accuracy** — lets developers inspect raw gaze predictions against known screen positions to validate calibration quality.
- **Blink detection** — shows real-time blink events and the artifact-rejection logic that filters out eyelid-closing frames from gaze data.

This page does not save any results and has no effect on test scores.
