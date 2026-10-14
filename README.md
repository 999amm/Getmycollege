# GetMyCollege — percentile comparison add-on

## What's added
- The existing prediction flow, result cards, filters, and main cutoff logic remain unchanged.
- An additional section appears after an MHT-CET prediction, with +1, +2, and +3 percentile scenarios.
- Each scenario is cumulative from the entered percentile and shows CAP Round I options whose cutoff sits above the entered score and at/below the simulated score, excluding options already represented as within-cutoff in the current shortlist.
- The JEE Main mode does not show this section because the site's JEE input is a rank, not a percentile.

## Keep this folder structure when deploying

```text
index.html
styles.css
script.js
assets/
  diems-logo.png
  naac-grade-a.webp
data/
  maharashtra_cap_round1_2025_26.compact.json
```

Upload/deploy the entire folder. The scenario data file must remain at the relative path shown above. The image paths already referenced by `index.html` are kept intact.

## Scenario data note
The new section uses the supplied **Maharashtra & Minority Seats CAP Round I, academic year 2025–26** cutoff text export—not an All India cutoff file. The compact JSON contains 34,422 parsed rows. The source was parsed from a text export rather than consumed as an official structured data feed, and some source cutoff pairs were missing. Seat category, minority, home-university and other counselling eligibility may vary; these are historical comparisons, not admission guarantees. Verify details against official counselling records.


## Per-college cutoff history (2020–2026)

Each prediction card now includes an expandable **View cutoff history (2020–2026)** section. The section reuses the loaded data for the exact displayed college and branch, applies the selected category and gender rules, and shows year/round/category/seat-bucket details without changing the main prediction matching logic. JEE history uses the connected JoSAA/CSAB records. MHT-CET history uses structured rows available from the connected cutoff sources and excludes rows explicitly marked as All India seats.

**Coverage note:** the connected MHT-CET historical CSV advertises structured CAP records for 2022–2026. Official Maharashtra CAP cutoff PDFs are linked for 2020 and 2021, but the browser-only app does not extract their PDF tables into numeric rows yet. Missing records are labelled as unavailable in connected structured sources, not as zero cutoffs or proof that no seat existed. Verify final choices against official CET Cell / JoSAA records.
