(() => {
  "use strict";

  /*
   * GetMyCollege — browser-only cutoff matcher.
   * No backend calls, no student-score transmission, and no persistent app storage.
   * Source files are requested only after Predict is pressed or the directory is
   * explicitly used. Remote source hosts may still log ordinary HTTP requests.
   */
  const ROUND_NUMBERS = [1, 2, 3, 4, 5];
  // Final-round snapshots provide genuine historical fallback coverage without
  // downloading the full multi-year archive. 2026 actuals always take priority.
  const HISTORICAL_JEE_SNAPSHOTS = [
    { year: 2024, round: 5 },
    { year: 2023, round: 6 },
    { year: 2022, round: 6 },
    { year: 2021, round: 6 },
    { year: 2020, round: 6 },
  ];
  const FETCH_TIMEOUT_MS = 15000;
  const MAX_RESULTS = 10000;
  const DIRECTORY_PAGE_SIZE = 36;
  const DATA_URLS = {
    jeeRound: (round) => [
      `https://raw.githubusercontent.com/Harith-Y/JoSAA-CSAB-Closing-Rank-Predictor/main/data/Round${round}-2026.csv`,
      `https://cdn.jsdelivr.net/gh/Harith-Y/JoSAA-CSAB-Closing-Rank-Predictor@main/data/Round${round}-2026.csv`,
    ],
    jeeHistorical: (year, round) => [
      `https://raw.githubusercontent.com/PardhavMaradani/josaa-sql-interface/main/csv/josaa-${year}-r${round}-all.csv`,
      `https://cdn.jsdelivr.net/gh/PardhavMaradani/josaa-sql-interface@main/csv/josaa-${year}-r${round}-all.csv`,
    ],
    // Secondary consolidated archive adds 2025 JoSAA rows; it is still JoSAA
    // coverage, not a claim to include every private/state-level JEE college.
    jeeHistoricalArchive: [
      "https://raw.githubusercontent.com/JIGGLEO/JOSAA-CUTOFF_DATASET/main/cutoffsfinal.csv",
      "https://cdn.jsdelivr.net/gh/JIGGLEO/JOSAA-CUTOFF_DATASET@main/cutoffsfinal.csv",
    ],
    csabRound: (round) => [
      `https://raw.githubusercontent.com/Harith-Y/JoSAA-CSAB-Closing-Rank-Predictor/main/data/CSAB_Round${round}-2026.csv`,
      `https://cdn.jsdelivr.net/gh/Harith-Y/JoSAA-CSAB-Closing-Rank-Predictor@main/data/CSAB_Round${round}-2026.csv`,
    ],
    mhtCutoffs: [
      "https://raw.githubusercontent.com/arman0824/MHT-CET-College-predictor/main/public/data/colleges.json",
      "https://cdn.jsdelivr.net/gh/arman0824/MHT-CET-College-predictor@main/public/data/colleges.json",
      "https://cet-vault.vercel.app/data/colleges.json",
      "https://raw.githubusercontent.com/arman0824/MHT-CET-College-predictor/main/data/source/colleges.json",
    ],
    // Public structured CAP dataset covers academic cycles 2022-23 through 2025-26.
    // The legacy JSON above is also loaded and may provide additional dated rows.
    mhtHistoricalCsv: [
      "https://media.githubusercontent.com/media/pratikshabade09/College_Prediction/main/data/processed/MHTCET_CAP_Cutoffs_2022-2026.csv",
      "https://cdn.jsdelivr.net/gh/pratikshabade09/College_Prediction@main/data/processed/MHTCET_CAP_Cutoffs_2022-2026.csv",
      "https://raw.githubusercontent.com/pratikshabade09/College_Prediction/main/data/processed/MHTCET_CAP_Cutoffs_2022-2026.csv",
    ],
    maharashtraDirectory: [
      "https://raw.githubusercontent.com/omkarj920/fe-seat-matrix-2026/main/records.json",
      "https://cdn.jsdelivr.net/gh/omkarj920/fe-seat-matrix-2026@main/records.json",
      "https://huggingface.co/spaces/omkarj920/fe-seat-matrix-2026/resolve/main/records.json?download=true",
    ],
    // Local copy of the supplied Maharashtra & Minority Seats CAP Round I 2025–26 data.
    // This is separate from the general historical data used for the main shortlist.
    mhtCap1Scenario: [
      "./data/maharashtra_cap_round1_2025_26.compact.json",
      "data/maharashtra_cap_round1_2025_26.compact.json",
    ],
  };

  const $ = (id) => document.getElementById(id);
  const state = {
    exam: "jee",
    branch: "CSE",
    loading: false,
    jeeData: null,
    jeeHistoryIndex: null,
    jeeRoundStatuses: [],
    jeeHistoricalStatuses: [],
    jeeCsabStatus: null,
    mhtData: null,
    mhtHistoryIndex: null,
    mhtDataError: null,
    mhtDirectoryRecords: null,
    mhtCap1ScenarioData: null,
    mhtCap1ScenarioPromise: null,
    mhtCap1ScenarioError: null,
    mhtCap1ScenarioSource: null,
    directoryInstitutes: [],
    directoryVisibleCount: DIRECTORY_PAGE_SIZE,
    directoryLoadPromise: null,
    directoryLoadError: null,
  };

  const examTabs = [...document.querySelectorAll(".exam-tab")];
  const branchChips = [...document.querySelectorAll(".branch-chip")];
  const scoreInput = $("score");
  const scoreLabel = $("scoreLabel");
  const scoreHint = $("scoreHint");
  const scoreSuffix = $("scoreSuffix") || document.querySelector(".input-suffix");
  const categoryInput = $("category");
  const genderInput = $("gender");
  const domicileInput = $("domicile");
  const districtInput = $("district");
  const domicileField = $("domicileField");
  const districtField = $("districtField");
  const predictButton = $("predict");
  const predictText = $("predictText");
  const dataState = $("dataState");
  const dataStateText = $("dataStateText");
  const resultsSection = $("results");
  const resultTitle = $("resultTitle");
  const resultSub = $("resultSub");
  const confidenceLabel = $("confidenceLabel");
  const confidence = $("confidence");
  const confidenceBar = $("bar");
  const confidenceCard = document.querySelector(".confidence-card");
  const bestName = $("bestName");
  const bestMeta = $("bestMeta");
  const sourceStatuses = $("sourceStatuses");
  const resultsList = $("list");

  // Keep the original HTML untouched: create the optional percentile-comparison
  // section beside the main results list only when it is not already present.
  if (resultsList && !$("percentileScenarios")) {
    resultsList.insertAdjacentHTML("afterend", `
      <style id="percentileScenarioStyles">
        #percentileScenarios { margin-top:28px; padding:24px; background:var(--panel,#fff); border:1px solid var(--line,#d9dfdf); border-radius:18px; color:var(--text,#233448); }
        #percentileScenarios[hidden] { display:none !important; }
        #percentileScenarios .scenario-heading h2 { margin:12px 0; font-family:"DM Serif Display",Georgia,serif; font-size:clamp(25px,3vw,34px); font-weight:400; }
        #percentileScenarios .scenario-heading p { color:var(--muted,#586773); font-size:13px; line-height:1.7; }
        #percentileScenarios .scenario-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:22px; }
        #percentileScenarios .scenario-card { min-width:0; padding:16px; border:1px solid var(--line,#d9dfdf); border-radius:12px; background:var(--panel,#fff); }
        #percentileScenarios .scenario-card-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
        #percentileScenarios .scenario-card h3 { margin:0; font-size:20px; }
        #percentileScenarios .scenario-target { color:var(--accent,#24655c); font-size:12px; font-weight:700; }
        #percentileScenarios .scenario-count { color:var(--muted,#586773); font-size:12px; line-height:1.6; margin:12px 0; }
        #percentileScenarios .scenario-items { display:grid; gap:10px; }
        #percentileScenarios .scenario-item { padding:12px; border:1px solid var(--line,#d9dfdf); border-radius:9px; overflow-wrap:anywhere; }
        #percentileScenarios .scenario-item-name { font-weight:700; font-size:13px; line-height:1.5; margin-bottom:8px; }
        #percentileScenarios .scenario-item-meta { color:var(--muted,#586773); font-size:12px; line-height:1.8; }
        #percentileScenarios .scenario-item-meta strong { color:var(--accent,#24655c); }
        #percentileScenarios .scenario-item a { display:inline-block; margin-top:10px; color:var(--accent,#24655c); font-size:12px; font-weight:700; text-decoration:none; }
        #percentileScenarios .scenario-item a:hover { text-decoration:underline; }
        #percentileScenarios .scenario-expand { margin-top:12px; padding:10px 14px; border:1px solid var(--line,#d9dfdf); border-radius:8px; background:var(--panel,#fff); color:var(--accent,#24655c); font-weight:700; cursor:pointer; }
        #percentileScenarios .scenario-source-note { margin-top:18px; color:var(--muted,#586773); font-size:11px; line-height:1.7; }
        @media (max-width:850px) { #percentileScenarios .scenario-grid { grid-template-columns:1fr; } }
        @media (max-width:500px) { #percentileScenarios { padding:16px; } }
      </style>
      <section class="percentile-scenarios" id="percentileScenarios" hidden aria-labelledby="scenarioTitle">
        <div class="scenario-heading">
          <div class="eyebrow">EXPLORE YOUR NEXT PERCENTILE</div>
          <h2 id="scenarioTitle">What if your percentile were higher?</h2>
          <p id="scenarioIntro">Compare additional college options at +1, +2 and +3 percentile.</p>
        </div>
        <div class="scenario-grid">
          <article class="scenario-card"><div class="scenario-card-heading"><h3>+1 percentile</h3><span id="scenarioTarget1" class="scenario-target">—</span></div><p id="scenarioCount1" class="scenario-count">Waiting for data…</p><div id="scenarioList1" class="scenario-list"></div></article>
          <article class="scenario-card"><div class="scenario-card-heading"><h3>+2 percentile</h3><span id="scenarioTarget2" class="scenario-target">—</span></div><p id="scenarioCount2" class="scenario-count">Waiting for data…</p><div id="scenarioList2" class="scenario-list"></div></article>
          <article class="scenario-card"><div class="scenario-card-heading"><h3>+3 percentile</h3><span id="scenarioTarget3" class="scenario-target">—</span></div><p id="scenarioCount3" class="scenario-count">Waiting for data…</p><div id="scenarioList3" class="scenario-list"></div></article>
        </div>
        <p id="scenarioSourceNote" class="scenario-source-note">Maharashtra &amp; Minority Seats CAP Round I, 2025–26. Historical comparisons are not admission guarantees.</p>
      </section>
    `);
  }

  const percentileScenarios = $("percentileScenarios");
  const scenarioIntro = $("scenarioIntro");
  const scenarioSourceNote = $("scenarioSourceNote");
  const directorySection = $("maharashtraDirectory");
  const directoryTitle = $("directoryTitle");
  const directoryEyebrow = directorySection?.querySelector(".eyebrow");
  const directoryDescription = directorySection?.querySelector(".directory-heading p");
  const directorySearchLabel = document.querySelector('label[for="directorySearch"]');
  const directoryStats = $("directoryStats");
  const directorySearch = $("directorySearch");
  const directoryProgramFilter = $("directoryProgramFilter");
  const directoryResults = $("directoryResults");
  const directoryShowing = $("directoryShowing");
  const directoryMore = $("directoryMore");

  const BRANCH_PATTERNS = {
    CSE: /computer science and engineering|computer engineering|computer science\b/i,
    IT: /information technology|information systems/i,
    AI: /artificial intelligence|data science|machine learning/i,
    ECE: /electronics and communication|electronics and telecommunication|electronics & communication|electronics and telecommunications/i,
    ME: /mechanical engineering/i,
    CE: /civil engineering/i,
  };
  const CATEGORY_JEE = { OPEN: "OPEN", OBC: "OBC-NCL", EWS: "EWS", SC: "SC", ST: "ST" };
  const CATEGORY_MHT = {
    // CAP datasets commonly use GOPENH/GOPENS/LOPENH/LOPENS; some legacy JSON
    // sources instead use OPEN or GENERAL. Accept both formats without mixing
    // categories such as OBC, SC, or ST into OPEN.
    OPEN: /^(?:GOPEN|LOPEN|OPEN|GENERAL|GN)/i,
    OBC: /^(?:GOBC|LOBC|OBC)/i,
    EWS: /^EWS/i,
    SC: /^(?:GSC|LSC|SC)/i,
    ST: /^(?:GST|LST|ST)/i,
  };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function setStatus(message, kind = "") {
    dataState.classList.remove("ok", "error");
    if (kind) dataState.classList.add(kind);
    dataStateText.textContent = message;
  }

  function clearResults() {
    resultsSection.hidden = true;
    resultsList.innerHTML = "";
    sourceStatuses.innerHTML = "";
    if (percentileScenarios) percentileScenarios.hidden = true;
  }

  function setExam(exam) {
    state.exam = exam;
    examTabs.forEach((tab) => {
      const active = tab.dataset.exam === exam;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    if (directorySection) directorySection.hidden = exam === "jee";
    if (exam === "jee") {
      scoreLabel.textContent = categoryInput.value === "OPEN" ? "JEE Main All India Rank (CRL / AIR)" : "JEE Main category rank";
      scoreInput.min = "1";
      scoreInput.max = "2000000";
      scoreInput.step = "1";
      scoreInput.placeholder = "e.g. 15000";
      scoreSuffix.textContent = "Rank";
      updateJeeRankHint();
      domicileField.hidden = true;
      districtField.hidden = true;
    } else {
      scoreLabel.textContent = "MHT-CET percentile";
      scoreInput.min = "0";
      scoreInput.max = "100";
      scoreInput.step = "0.0001";
      scoreInput.placeholder = "e.g. 92.5";
      scoreSuffix.textContent = "%ile";
      scoreHint.textContent = "Enter your MHT-CET percentile (0–100). Available records are historical; H/S/O cutoff buckets are shown, but this version does not infer home-university eligibility from your district.";
      domicileField.hidden = false;
      districtField.hidden = domicileInput.value !== "MS";
    }
    clearResults();
    setStatus(exam === "jee" ? "JEE Main selected. Click Predict to fetch available national JoSAA/CSAB cutoff records and historical references." : "MHT-CET selected. Click Predict to fetch available historical CAP cutoffs.");
  }

  function updateJeeRankHint() {
    if (categoryInput.value === "OPEN") {
      scoreLabel.textContent = "JEE Main All India Rank (CRL / AIR)";
      scoreHint.textContent = "For OPEN seats, JoSAA closing ranks use Common Rank List (CRL / AIR). IITs are excluded because admission to IITs requires JEE Advanced. Results include available JoSAA/CSAB B.Tech cutoff records; non-JoSAA private/state colleges appear only when a verified rank-cutoff dataset is connected.";
    } else {
      scoreLabel.textContent = "JEE Main category rank";
      scoreHint.textContent = "JoSAA reserved-seat closing ranks use the relevant category rank, not CRL/AIR. Enter your matching category rank for this category.";
    }
  }

  function selectBranch(branch) {
    state.branch = branch;
    branchChips.forEach((chip) => {
      const active = chip.dataset.branch === branch;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    if (state.directoryInstitutes.length) renderDirectory();
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} seconds`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function fetchTextFromAny(urls, validator, timeoutMs = FETCH_TIMEOUT_MS) {
    const controllers = [];
    const timers = [];
    const attempts = urls.map(async (url) => {
      const controller = new AbortController();
      controllers.push(controller);
      timers.push(setTimeout(() => controller.abort(), timeoutMs));
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
      const text = await response.text();
      if (!validator(text)) throw new Error(`Unexpected data format from ${new URL(url).host}`);
      return { text, url };
    });
    try {
      return await Promise.any(attempts);
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error];
      throw new Error(errors.map((item) => item?.message || String(item)).join("; "));
    } finally {
      timers.forEach(clearTimeout);
      controllers.forEach((controller) => controller.abort());
    }
  }

  async function fetchJsonFromAny(urls, validator, timeoutMs = FETCH_TIMEOUT_MS) {
    const { text, url } = await fetchTextFromAny(urls, (body) => {
      try { return validator(JSON.parse(body)); } catch { return false; }
    }, timeoutMs);
    return { payload: JSON.parse(text), url };
  }

  function parseCsv(inputText) {
    const rows = [];
    let row = [], field = "", quoted = false;
    const input = String(inputText).replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '"') {
        if (quoted && input[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(field); field = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && input[i + 1] === "\n") i += 1;
        row.push(field); field = "";
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field.length || row.length) {
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    }
    if (!rows.length) return [];
    const headers = rows.shift().map((h) => h.trim().replace(/^\uFEFF/, ""));
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()])));
  }

  function numberValue(value) {
    const text = String(value ?? "").replace(/,/g, "").trim().replace(/\*$/, "");
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const valueNumber = Number(text);
    return Number.isFinite(valueNumber) ? valueNumber : null;
  }

  function headerValue(row, names, fallback = "") {
    for (const name of names) {
      if (row[name] !== undefined && String(row[name]).trim() !== "") return row[name];
    }
    return fallback;
  }

  function normaliseProgramName(value) {
    return String(value || "")
      .replace(/\s*\(\s*\d+\s*Years?,?\s*Bachelor of Technology\s*\)/i, "")
      .replace(/\s*\(\s*4\s*Years?\s*\)/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEligibleJeeProgram(college, program, category) {
    // IIT seats use JEE Advanced, not JEE Main. The UI has no PwD rank input,
    // so PwD/preparatory rank categories must never be matched to a non-PwD rank.
    // IIT admission requires JEE Advanced, never JEE Main alone. Match both
    // expanded and abbreviated institute names (e.g. "IIT Bombay").
    if (/\bindian institute of technology\b|^\s*IIT(?:\s|[-,]|$)/i.test(String(college || ""))) return false;
    if (/\b(PwD|PWD|Persons? with Disabilities)\b/i.test(String(category || ""))) return false;
    if (!/bachelor of technology|\bb\.?\s?tech\b/i.test(String(program || ""))) return false;
    return true;
  }

  function normaliseJeeQuota(value) {
    const text = String(value || "—").trim();
    const upper = text.toUpperCase();
    if (upper === "AI" || upper === "ALL INDIA") return "AI";
    if (upper === "HS" || upper === "HOME STATE") return "HS";
    if (upper === "OS" || upper === "OTHER STATE") return "OS";
    return text;
  }

  function parseJeeRound(csvText, roundNumber, sourceKind = "JoSAA") {
    return parseCsv(csvText).flatMap((row) => {
      const college = headerValue(row, ["Institute", "Institute Name", "College", "institute"]);
      const rawProgram = headerValue(row, ["Academic Program Name", "Academic Program", "Program", "program", "Branch"]);
      const closingRank = numberValue(headerValue(row, ["Closing Rank", "closingRank", "Closing rank"]));
      const seatType = headerValue(row, ["Seat Type", "Category", "category", "seat_type"], "OPEN");
      const genderSeat = headerValue(row, ["Gender", "Gender Seat", "gender"], "Gender-Neutral");
      const quota = normaliseJeeQuota(headerValue(row, ["Quota", "quota"], "—"));
      if (!college || !rawProgram || closingRank === null || closingRank <= 0) return [];
      if (!isEligibleJeeProgram(college, rawProgram, seatType)) return [];
      // DASA-CIWG ranks have different eligibility rules and are not selected in this UI.
      if (/DASA|CIWG|FOREIGN/i.test(quota)) return [];
      const channel = sourceKind === "CSAB" ? "CSAB" : "JoSAA";
      return [{
        college: college.trim(),
        branch: normaliseProgramName(rawProgram),
        rawProgram,
        cutoffRank: closingRank,
        category: seatType,
        quota,
        genderSeat,
        round: roundNumber,
        dataYear: 2026,
        sourceKind: channel,
        year: channel === "CSAB" ? `CSAB 2026 Special Round ${roundNumber}` : `JoSAA 2026 Round ${roundNumber}`,
        source: channel === "CSAB" ? `CSAB 2026 Special Round ${roundNumber} public CSV` : `JoSAA 2026 Round ${roundNumber} public CSV`,
      }];
    });
  }

  function parseHistoricalJeeCsv(csvText, year, roundNumber) {
    return parseCsv(csvText).flatMap((row) => {
      const college = headerValue(row, ["Institute", "institute", "Institute Name", "College"]);
      const rawProgram = headerValue(row, ["Academic Program Name", "program", "Program", "Branch"]);
      const category = headerValue(row, ["Seat Type", "category", "Category"], "OPEN");
      const quota = normaliseJeeQuota(headerValue(row, ["Quota", "quota"], "—"));
      const genderSeat = headerValue(row, ["Gender", "gender", "Gender Seat"], "Gender-Neutral");
      const closingRank = numberValue(headerValue(row, ["Closing Rank", "crank", "closing rank", "ClosingRank"]));
      if (!college || !rawProgram || closingRank === null || closingRank <= 0) return [];
      if (!isEligibleJeeProgram(college, rawProgram, category)) return [];
      if (/DASA|CIWG|FOREIGN/i.test(quota)) return [];
      return [{
        college: college.trim(),
        branch: normaliseProgramName(rawProgram),
        rawProgram,
        cutoffRank: closingRank,
        category,
        quota,
        genderSeat,
        round: roundNumber,
        dataYear: year,
        sourceKind: "JoSAA historical",
        year: `JoSAA ${year} final round ${roundNumber}`,
        source: `Public JoSAA archive mirror · ${year} final round`,
      }];
    });
  }

  function normalizeSlotPart(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function jeeSlotKey(row) {
    const category = normaliseJeeCategory(row.category);
    const gender = /female/i.test(String(row.genderSeat || "")) ? "female-only" : "gender-neutral";
    return [
      normalizeSlotPart(row.college),
      normalizeSlotPart(normaliseProgramName(row.rawProgram || row.branch)),
      normalizeSlotPart(category),
      normalizeSlotPart(row.quota),
      gender,
      row.sourceKind === "CSAB" ? "CSAB" : "JoSAA",
    ].join("|");
  }

  function parseHistoricalJeeArchiveCsv(csvText) {
    return parseCsv(csvText).flatMap((original) => {
      const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
      const read = (...keys) => {
        for (const key of keys) {
          const value = row[String(key).toLowerCase().replace(/[^a-z0-9]/g, "")];
          if (value !== undefined && String(value).trim() !== "") return value;
        }
        return "";
      };
      const college = String(read("Institute", "Institute Name", "College", "InstituteName")).trim();
      const rawProgram = String(read("Academic Program Name", "Program", "Branch", "AcademicProgram")).trim();
      const category = String(read("Seat Type", "Category", "SeatType")).trim();
      const quota = normaliseJeeQuota(read("Quota", "Quota Type"));
      const genderSeat = String(read("Gender", "Gender Seat")).trim() || "Gender-Neutral";
      const closingRank = numberValue(read("Closing Rank", "ClosingRank", "Closing", "crank"));
      const year = Number(String(read("Year", "Data Year", "Academic Year")).match(/20\d{2}/)?.[0]);
      const round = numberValue(read("Round", "Round No", "RoundNumber")) || 0;
      if (!college || !rawProgram || !Number.isFinite(year) || year < 2020 || year > 2025 || closingRank === null || closingRank <= 0) return [];
      if (!isEligibleJeeProgram(college, rawProgram, category) || /DASA|CIWG|FOREIGN/i.test(quota)) return [];
      return [{ college, branch: normaliseProgramName(rawProgram), rawProgram, cutoffRank: closingRank, category, quota, genderSeat, round, dataYear: year, sourceKind: "JoSAA historical", year: `JoSAA ${year} archive${round ? ` Round ${round}` : ""}`, source: `Public JoSAA consolidated archive · ${year}` }];
    });
  }

  async function loadJeeData() {
    if (state.jeeData) return state.jeeData;

    const currentRoundPromise = Promise.all(ROUND_NUMBERS.map(async (round) => {
      try {
        const { text } = await fetchTextFromAny(DATA_URLS.jeeRound(round), (body) => {
          return parseJeeRound(body, round).length > 0;
        });
        const records = parseJeeRound(text, round);
        return { round, records, ok: true };
      } catch (error) {
        return { round, records: [], ok: false, error: error?.message || "Download failed" };
      }
    }));

    const csabPromise = (async () => {
      const round = 1;
      try {
        const { text } = await fetchTextFromAny(DATA_URLS.csabRound(round), (body) => {
          return parseJeeRound(body, round, "CSAB").length > 0;
        });
        const records = parseJeeRound(text, round, "CSAB");
        return { round, records, ok: records.length > 0 };
      } catch (error) {
        return { round, records: [], ok: false, error: error?.message || "Download failed" };
      }
    })();

    const historicalPromise = Promise.all(HISTORICAL_JEE_SNAPSHOTS.map(async ({ year, round }) => {
      try {
        const { text } = await fetchTextFromAny(DATA_URLS.jeeHistorical(year, round), (body) => {
          return parseHistoricalJeeCsv(body, year, round).length > 0;
        });
        const records = parseHistoricalJeeCsv(text, year, round);
        return { year, round, records, ok: records.length > 0 };
      } catch (error) {
        return { year, round, records: [], ok: false, error: error?.message || "Download failed" };
      }
    }));

    const archivePromise = (async () => {
      try {
        const { text } = await fetchTextFromAny(DATA_URLS.jeeHistoricalArchive, (body) => parseHistoricalJeeArchiveCsv(body).length > 0);
        return { records: parseHistoricalJeeArchiveCsv(text), ok: true };
      } catch (error) {
        return { records: [], ok: false, error: error?.message || "Download failed" };
      }
    })();

    const [currentRounds, historicalRounds, csabRound, archiveRound] = await Promise.all([currentRoundPromise, historicalPromise, csabPromise, archivePromise]);
    state.jeeArchiveStatus = { ok: archiveRound.ok, rows: archiveRound.records.length, error: archiveRound.error };
    state.jeeRoundStatuses = currentRounds.map((item) => ({ round: item.round, ok: item.ok, rows: item.records.length, error: item.error }));
    state.jeeHistoricalStatuses = historicalRounds.map((item) => ({ year: item.year, round: item.round, ok: item.ok, rows: item.records.length, error: item.error }));
    state.jeeCsabStatus = { round: csabRound.round, ok: csabRound.ok, rows: csabRound.records.length, error: csabRound.error };

    const currentRecords = [...currentRounds.flatMap((item) => item.records), ...csabRound.records];
    const historicalRecords = [...historicalRounds.flatMap((item) => item.records), ...archiveRound.records];
    state.jeeHistoryIndex = buildJeeHistoryIndex([...historicalRecords, ...currentRecords]);
    if (!currentRecords.length && !historicalRecords.length) {
      const currentDetail = state.jeeRoundStatuses.map((item) => `2026 R${item.round}: ${item.error || "no rows"}`).join(" | ");
      const historicalDetail = state.jeeHistoricalStatuses.map((item) => `${item.year}: ${item.error || "no rows"}`).join(" | ");
      throw new Error(`No JoSAA cutoff source could be read. ${currentDetail} ${historicalDetail}`);
    }

    // Merge slot-by-slot, preferring the most recent year and then the latest
    // available round. This avoids duplicate old records for the same seat slot.
    const latest = new Map();
    const ordered = [...historicalRecords, ...currentRecords].sort((a, b) =>
      a.dataYear - b.dataYear || a.round - b.round
    );
    for (const row of ordered) latest.set(jeeSlotKey(row), row);
    state.jeeData = [...latest.values()];
    return state.jeeData;
  }

  function normaliseJeeCategory(value) {
    const text = String(value || "").toUpperCase().trim();
    if (/\bPWD\b|PERSONS? WITH DISABILITIES/.test(text)) return "PWD";
    if (text === "OPEN" || text === "GENERAL") return "OPEN";
    if (text.startsWith("OBC")) return "OBC-NCL";
    if (text.startsWith("EWS")) return "EWS";
    if (text === "SC" || text.startsWith("SC ")) return "SC";
    if (text === "ST" || text.startsWith("ST ")) return "ST";
    return text;
  }

  function branchMatches(program, requested) {
    const text = String(program || "");
    if (requested === "CSE") {
      return /computer\s+science(?:\s*(?:and|&)\s*)?(?:engineering)?|computer engineering/i.test(text)
        && !/artificial intelligence|data science|machine learning|internet of things|cyber security|information security|business systems/i.test(text);
    }
    return Boolean(BRANCH_PATTERNS[requested] && BRANCH_PATTERNS[requested].test(text));
  }

  function assessRank(rank, cutoff) {
    const ratio = rank / cutoff;
    if (ratio <= 0.8) return { label: "Safer range vs. closing rank", band: "good" };
    if (ratio <= 1) return { label: "Within closing rank", band: "good" };
    if (ratio <= 1.2) return { label: "Reach · slightly above closing rank", band: "warn" };
    return { label: "Beyond closing rank", band: "bad" };
  }

  function mapJeeResults(records, rank, category, gender, branch) {
    const wantedCategory = CATEGORY_JEE[category] || "OPEN";
    return records.filter((row) => {
      if (normaliseJeeCategory(row.category) !== wantedCategory) return false;
      // Show realistic and near-reach options; omit colleges whose historical
      // closing rank is far more competitive than this rank.
      if (rank > row.cutoffRank * 1.2) return false;
      if (!branchMatches(row.rawProgram || row.branch, branch)) return false;
      const isNeutral = /gender[ -]?neutral|neutral/i.test(row.genderSeat);
      const isFemaleOnly = /female/i.test(row.genderSeat) && !isNeutral;
      if (gender === "Female") return isNeutral || isFemaleOnly;
      return isNeutral || !row.genderSeat;
    }).map((row) => {
      const assessment = assessRank(rank, row.cutoffRank);
      return { ...row, assessment };
    }).sort((a, b) => {
      const order = { good: 0, warn: 1, bad: 2 };
      return (order[a.assessment.band] ?? 9) - (order[b.assessment.band] ?? 9)
        || (b.dataYear - a.dataYear)
        || Math.abs(rank / a.cutoffRank - 1) - Math.abs(rank / b.cutoffRank - 1)
        || a.cutoffRank - b.cutoffRank;
    });
  }

  function asArrayPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.colleges)) return payload.colleges;
    if (Array.isArray(payload?.records)) return payload.records;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  function hasMhtCutoffs(payload) {
    const rows = asArrayPayload(payload);
    return rows.some((college) => {
      const branches = Array.isArray(college.branches) ? college.branches : Array.isArray(college.courses) ? college.courses : [];
      return branches.some((branch) => Object.keys(branch.cutoffs2025 || branch.cutoffs2024 || branch.cutoffs || {}).length > 0);
    });
  }

  function normaliseHeaderKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function parseMhtHistoricalCsv(csvText) {
    const get = (row, names) => {
      for (const name of names) {
        const key = normaliseHeaderKey(name);
        if (row[key] !== undefined && String(row[key]).trim() !== "") return row[key];
      }
      return "";
    };
    const mapped = new Map();
    for (const original of parseCsv(csvText)) {
      const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [normaliseHeaderKey(key), value]));
      const college = String(get(row, ["college_name", "institute_name", "inst_name", "college", "institute"])).trim();
      const branch = String(get(row, ["course_name", "branch_name", "course", "branch", "program"])).trim();
      const rawYear = String(get(row, ["academic_year", "year", "admission_year", "cycle"])).trim();
      // For academic-year strings such as 2024-25, the starting year is the display bucket.
      const yearMatch = rawYear.match(/20\d{2}/);
      const year = yearMatch ? Number(yearMatch[0]) : null;
      const category = String(get(row, ["category_raw", "seat_prefix", "seat_type_code", "seat_category", "category", "seat_type"])).trim();
      const percentile = numberValue(get(row, ["closing_percentile", "closing_perc", "cutoff_percentile", "percentile", "closing_score"]));
      const rank = numberValue(get(row, ["merit_rank", "closing_rank", "closing_merit_rank", "rank"]));
      const round = String(get(row, ["cap_round", "round", "round_no"])).trim();
      const gender = String(get(row, ["gender", "gender_seat", "genderseat"])).trim();
      const seatLevel = String(get(row, ["seat_level", "seat level", "seat_pool", "quota_level", "level"])).trim();
      const stage = String(get(row, ["stage", "allotment_stage"])).trim();
      const collegeKey = String(get(row, ["college_code", "institute_code", "inst_code"])).trim().replace(/\.0$/, "");
      const courseCode = String(get(row, ["course_code", "choice_code"])).trim();
      if (!college || !branch || !year || year < 2020 || year > 2026 || !category || percentile === null || percentile < 0 || percentile > 100) continue;
      const key = `${collegeKey || college.toLowerCase()}|${branch.toLowerCase()}`;
      if (!mapped.has(key)) mapped.set(key, { instCode: collegeKey, instName: college, branches: [] });
      const target = mapped.get(key);
      let course = target.branches.find((item) => item.name.toLowerCase() === branch.toLowerCase());
      if (!course) { course = { code: courseCode, name: branch, cutoffsByYear: [] }; target.branches.push(course); }
      if (!course.code && courseCode) course.code = courseCode;
      const cutoffKey = category.toUpperCase();
      course.cutoffsByYear.push({ year, academicYear: rawYear, round: round || "CAP", category: cutoffKey, percentile, rank, gender, seatLevel, stage, courseCode, collegeCode: collegeKey });
    }
    return [...mapped.values()];
  }

  async function loadMhtCutoffs() {
    if (state.mhtData) return state.mhtData;
    const attempts = await Promise.allSettled([
      fetchJsonFromAny(DATA_URLS.mhtCutoffs, hasMhtCutoffs).then(({ payload }) => asArrayPayload(payload)),
      fetchTextFromAny(DATA_URLS.mhtHistoricalCsv, (body) => body.length > 1000 && /closing[_ ]?percentile|cutoff[_ ]?percentile|percentile/i.test(body.slice(0, 5000)), 45000).then(({ text }) => parseMhtHistoricalCsv(text)),
    ]);
    const jsonRows = attempts[0].status === "fulfilled" ? attempts[0].value : [];
    const historicalRows = attempts[1].status === "fulfilled" ? attempts[1].value : [];
    const merged = [...jsonRows, ...historicalRows];
    if (!merged.length) {
      const errors = attempts.filter((item) => item.status === "rejected").map((item) => item.reason?.message || "Source unavailable");
      throw new Error(`No structured MHT-CET cutoff source could be read. ${errors.join("; ")}`);
    }
    state.mhtData = merged;
    state.mhtHistoryIndex = buildMhtHistoryIndex(merged);
    state.mhtDataSourceYears = historicalRows.length ? "2022–23 through 2025–26 public CAP CSV plus any legacy dated records" : "legacy structured CAP records; historical CSV unavailable";
    return merged;
  }

  function normaliseDirectoryRows(payload) {
    return asArrayPayload(payload).filter((row) => row && (row.instCode || row.instituteCode) && (row.instName || row.instituteName) && (row.courseName || row.branchName || row.choiceCode)).map((row) => ({
      instituteCode: String(row.instCode || row.instituteCode || "").trim(),
      instituteName: String(row.instName || row.instituteName || "").trim(),
      choiceCode: String(row.choiceCode || row.courseCode || "").trim(),
      courseName: String(row.courseName || row.branchName || "").trim(),
      intake: Number.isFinite(Number(row.intake)) ? Number(row.intake) : null,
      msSeats: Number.isFinite(Number(row.msSeats)) ? Number(row.msSeats) : null,
      allIndiaSeats: Number.isFinite(Number(row.allIndia)) ? Number(row.allIndia) : null,
      status: String(row.status || "CAP participating institute"),
      university: String(row.university || ""),
    }));
  }

  function buildInstituteDirectory(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.instituteCode || row.instituteName.toLowerCase();
      if (!map.has(key)) map.set(key, { code: row.instituteCode, name: row.instituteName, status: row.status, university: row.university, courses: [], courseCodes: new Set() });
      const item = map.get(key);
      const courseKey = `${row.choiceCode}|${row.courseName}`;
      if (row.courseName && !item.courseCodes.has(courseKey)) {
        item.courseCodes.add(courseKey);
        item.courses.push({ code: row.choiceCode, name: row.courseName, intake: row.intake, msSeats: row.msSeats, allIndiaSeats: row.allIndiaSeats });
      }
    }
    return [...map.values()].map((item) => ({ ...item, courses: item.courses.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadMaharashtraDirectory() {
    if (state.mhtDirectoryRecords) return state.mhtDirectoryRecords;
    if (state.directoryLoadPromise) return state.directoryLoadPromise;
    state.directoryLoadPromise = (async () => {
      try {
        const { payload } = await fetchJsonFromAny(DATA_URLS.maharashtraDirectory, (value) => normaliseDirectoryRows(value).length > 0);
        const rows = normaliseDirectoryRows(payload);
        if (!rows.length) throw new Error("CAP directory contained no institute/course records.");
        state.mhtDirectoryRecords = rows;
        state.directoryInstitutes = buildInstituteDirectory(rows);
        state.directoryLoadError = null;
        renderDirectory();
        return rows;
      } catch (error) {
        state.directoryLoadError = error?.message || "Could not load directory";
        directoryStats.textContent = "Directory unavailable";
        directoryResults.innerHTML = `<div class="empty-state">The statewide college directory could not be downloaded. Check your connection and retry. No sample colleges have been substituted.</div>`;
        directoryShowing.textContent = "";
        directoryMore.hidden = true;
        throw error;
      } finally {
        state.directoryLoadPromise = null;
      }
    })();
    return state.directoryLoadPromise;
  }

  function mhtBranchMatches(name, requested) {
    const text = String(name || "");
    if (requested === "CSE") return /computer science|computer engineering/i.test(text) && !/artificial intelligence|data science|machine learning|internet of things|cyber security/i.test(text);
    if (requested === "IT") return /information technology/i.test(text);
    if (requested === "AI") return /artificial intelligence|data science|machine learning/i.test(text);
    if (requested === "ECE") return /electronics and telecommunication|electronics and communication|electronics & communication/i.test(text);
    if (requested === "ME") return /mechanical engineering/i.test(text);
    if (requested === "CE") return /civil engineering/i.test(text);
    return false;
  }

  function mergeMhtCutoffsWithDirectory(cutoffPayload, directoryRows) {
    const cutoffs = asArrayPayload(cutoffPayload);
    const map = new Map();
    const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const row of directoryRows || []) {
      const key = row.instituteCode || nameKey(row.instituteName);
      if (!map.has(key)) map.set(key, { code: row.instituteCode, name: row.instituteName, branches: [], _branchKeys: new Set() });
      const college = map.get(key);
      const branchKey = row.choiceCode || nameKey(row.courseName);
      if (!college._branchKeys.has(branchKey)) {
        college._branchKeys.add(branchKey);
        college.branches.push({ code: row.choiceCode, name: row.courseName, intake: row.intake, cutoffs2025: {}, directoryOnly: true });
      }
    }
    const byName = new Map([...map.values()].map((college) => [nameKey(college.name), college]));
    for (const cutoffCollege of cutoffs) {
      const collegeCode = String(cutoffCollege.code || cutoffCollege.instCode || "").trim();
      let target = map.get(collegeCode) || byName.get(nameKey(cutoffCollege.name || cutoffCollege.instName || cutoffCollege.collegeName));
      if (!target) {
        target = { code: collegeCode, name: cutoffCollege.name || cutoffCollege.instName || cutoffCollege.collegeName || "Unknown institute", branches: [], _branchKeys: new Set() };
        map.set(collegeCode || nameKey(target.name), target);
        byName.set(nameKey(target.name), target);
      }
      const branches = Array.isArray(cutoffCollege.branches) ? cutoffCollege.branches : Array.isArray(cutoffCollege.courses) ? cutoffCollege.courses : [];
      for (const cutoffBranch of branches) {
        const branchCode = String(cutoffBranch.code || cutoffBranch.choiceCode || "").trim();
        const branchName = cutoffBranch.name || cutoffBranch.courseName || "";
        let branchTarget = branchCode ? target.branches.find((branch) => String(branch.code || branch.choiceCode || "").trim() === branchCode) : null;
        if (!branchTarget) branchTarget = target.branches.find((branch) => nameKey(branch.name || branch.courseName) === nameKey(branchName));
        if (branchTarget) Object.assign(branchTarget, cutoffBranch, { directoryOnly: false });
        else target.branches.push({ ...cutoffBranch, directoryOnly: false });
      }
    }
    return [...map.values()].map((college) => ({
      code: college.code,
      name: college.name,
      branches: (college.branches || []).map((branch) => { const copy = { ...branch }; delete copy.directoryOnly; return copy; }),
    })).filter((college) => college.name && college.branches.length);
  }

  function cutoffEntriesForCategory(cutoffs, category, gender) {
    const matcher = CATEGORY_MHT[category] || CATEGORY_MHT.OPEN;
    return Object.entries(cutoffs || {}).filter(([key, value]) => {
      if (!matcher.test(key) || !value || numberValue(value.percentile) === null) return false;
      if (/^L/i.test(key) && gender !== "Female") return false;
      return true;
    }).map(([key, value]) => ({ key, percentile: Number(value.percentile), rank: numberValue(value.rank) }));
  }

  function assessMht(percentile, cutoff) {
    const gap = percentile - cutoff;
    if (gap >= 3) return { label: "Safer vs. historical cutoff", band: "good" };
    if (gap >= 0) return { label: "Within historical cutoff", band: "good" };
    if (gap >= -2) return { label: "Reach · near historical cutoff", band: "warn" };
    return { label: "Below historical percentile cutoff", band: "bad" };
  }

  function mapMhtResults(colleges, percentile, category, gender, branch) {
    const mapped = [];
    for (const college of colleges) {
      const branches = Array.isArray(college.branches) ? college.branches : Array.isArray(college.courses) ? college.courses : [];
      for (const item of branches) {
        const branchName = item.name || item.courseName || "";
        if (!mhtBranchMatches(branchName, branch)) continue;
        const cutoffs = item.cutoffs2025 || item.cutoffs2024 || item.cutoffs || {};
        // Keep each historical year/round/category as its own record; never mix
        // a percentile cutoff with a rank from a different year or seat bucket.
        const entries = cutoffEntriesForCategory(cutoffs, category, gender).map((chosen) => ({
          ...chosen,
          year: item.cutoffs2025 ? 2025 : item.cutoffs2024 ? 2024 : null,
          round: "structured JSON",
        }));
        const historical = Array.isArray(item.cutoffsByYear) ? item.cutoffsByYear.filter((entry) => {
          const key = String(entry.category || "").toUpperCase();
          const matcher = CATEGORY_MHT[category] || CATEGORY_MHT.OPEN;
          if (!matcher.test(key) || numberValue(entry.percentile) === null) return false;
          if (/^L/i.test(key) && gender !== "Female") return false;
          return true;
        }).map((entry) => ({ key: entry.category, percentile: Number(entry.percentile), rank: numberValue(entry.rank), year: entry.year, round: entry.round })) : [];
        for (const chosen of [...entries, ...historical]) {
          const assessment = assessMht(percentile, chosen.percentile);
          const yearLabel = chosen.year ? `${chosen.year} CAP ${chosen.round || "reference"}` : "Historical CAP reference";
          mapped.push({
            college: college.name || college.instName || college.collegeName || "Unknown institute",
            collegeCode: String(college.code || college.instCode || college.instituteCode || "").trim(),
            branch: branchName,
            branchCode: String(item.code || item.courseCode || item.choiceCode || "").trim(),
            cutoffPercentile: chosen.percentile,
            cutoffRank: chosen.rank,
            cutoffBucket: chosen.key,
            year: yearLabel,
            source: "",
            assessment,
          });
        }
      }
    }
    const seen = new Set();
    return mapped.filter((row) => {
      const key = `${row.college.toLowerCase()}|${row.branch.toLowerCase()}|${row.cutoffBucket}|${row.year}|${row.cutoffRank ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      const order = { good: 0, warn: 1, bad: 2 };
      return (order[a.assessment.band] ?? 9) - (order[b.assessment.band] ?? 9)
        || Math.abs(percentile - a.cutoffPercentile) - Math.abs(percentile - b.cutoffPercentile)
        || a.college.localeCompare(b.college);
    });
  }

  function sourceCard(title, status, detail, isError = false) {
    return `<div class="source-status ${isError ? "error" : "ok"}"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(status)}</span><span>${escapeHTML(detail)}</span></div>`;
  }

  function renderSourceStatus(cards) {
    sourceStatuses.hidden = false;
    sourceStatuses.innerHTML = cards.join("");
  }

  function collegeDuniaSearchUrl(college, branch = "") {
    const query = [
      "site:collegedunia.com",
      `"${college}"`,
      branch,
      "fees placements reviews"
    ].filter(Boolean).join(" ");

    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  function jeeHistoryKey(row) {
    const channel = String(row.sourceKind || "").toUpperCase() === "CSAB" ? "CSAB" : "JOSAA";
    const gender = /female/i.test(String(row.genderSeat || "")) && !/gender[ -]?neutral|neutral/i.test(String(row.genderSeat || "")) ? "female-only" : "gender-neutral";
    return [
      normalizeSlotPart(row.college),
      normalizeSlotPart(normaliseProgramName(row.rawProgram || row.branch)),
      normalizeSlotPart(normaliseJeeCategory(row.category)),
      normalizeSlotPart(normaliseJeeQuota(row.quota)),
      gender,
      channel,
    ].join("|");
  }

  function buildJeeHistoryIndex(records) {
    const index = new Map();
    const seen = new Set();
    for (const row of records || []) {
      const year = Number(row.dataYear);
      if (!Number.isInteger(year) || year < 2020 || year > 2026) continue;
      const key = jeeHistoryKey(row);
      const unique = `${key}|${year}|${Number(row.round) || 0}|${row.cutoffRank}|${row.sourceKind}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
    for (const rows of index.values()) rows.sort((a, b) => a.dataYear - b.dataYear || (Number(a.round) || 0) - (Number(b.round) || 0));
    return index;
  }

  function mhtHistoryNameKey(college, branch) {
    return `${normalizedCollegeName(college)}|${normalizeSlotPart(branch)}`;
  }

  function mhtHistoryCodeKey(collegeCode, branchCode) {
    const college = String(collegeCode || "").replace(/^0+/, "");
    const course = String(branchCode || "").replace(/^0+/, "");
    return college && course ? `code:${college}|${course}` : "";
  }

  function buildMhtHistoryIndex(colleges) {
    const byName = new Map();
    const byCode = new Map();
    const seen = new Set();
    const add = (college, branch, row) => {
      const year = Number(row.year);
      if (!Number.isInteger(year) || year < 2020 || year > 2026) return;
      const category = String(row.category || "").trim().toUpperCase();
      const percentile = numberValue(row.percentile);
      if (!category || percentile === null || percentile < 0 || percentile > 100) return;
      const item = {
        year,
        academicYear: String(row.academicYear || "").trim(),
        round: String(row.round ?? "").trim(),
        category,
        percentile,
        rank: numberValue(row.rank ?? row.meritRank),
        seatLevel: String(row.seatLevel || row.seatPool || "").trim(),
        stage: String(row.stage || row.allotmentStage || "").trim(),
        source: String(row.source || "Structured MHT-CET cutoff dataset"),
      };
      const dedupeKey = `${mhtHistoryNameKey(college.name, branch.name)}|${year}|${item.round}|${item.category}|${item.percentile}|${item.rank ?? ""}|${item.seatLevel}|${item.stage}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const nameKey = mhtHistoryNameKey(college.name, branch.name);
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(item);
      const codeKey = mhtHistoryCodeKey(college.code, branch.code);
      if (codeKey) {
        if (!byCode.has(codeKey)) byCode.set(codeKey, []);
        byCode.get(codeKey).push(item);
      }
    };

    for (const college of colleges || []) {
      const collegeName = String(college.name || college.instName || college.instituteName || college.collegeName || "").trim();
      const collegeCode = String(college.code || college.instCode || college.instituteCode || "").trim();
      if (!collegeName) continue;
      const branches = Array.isArray(college.branches) ? college.branches : Array.isArray(college.courses) ? college.courses : [];
      for (const originalBranch of branches) {
        const branch = {
          ...originalBranch,
          name: String(originalBranch.name || originalBranch.courseName || originalBranch.branchName || "").trim(),
          code: String(originalBranch.code || originalBranch.courseCode || originalBranch.choiceCode || "").trim(),
        };
        if (!branch.name) continue;
        const collegeRef = { name: collegeName, code: collegeCode };
        const history = Array.isArray(branch.cutoffsByYear) ? branch.cutoffsByYear : [];
        for (const row of history) add(collegeRef, branch, row);

        // Some legacy JSON sources have year-specific objects rather than a long history array.
        for (const [field, value] of Object.entries(branch)) {
          const match = field.match(/^cutoffs?(20\d{2})$/i);
          if (!match || !value || typeof value !== "object" || Array.isArray(value)) continue;
          const year = Number(match[1]);
          for (const [category, cutoff] of Object.entries(value)) {
            if (!cutoff || typeof cutoff !== "object") continue;
            add(collegeRef, branch, {
              year,
              round: cutoff.round || cutoff.capRound || "",
              category,
              percentile: cutoff.percentile ?? cutoff.closingPercentile ?? cutoff.cutoffPercentile,
              rank: cutoff.rank ?? cutoff.meritRank ?? cutoff.closingRank,
              seatLevel: cutoff.seatLevel || cutoff.seatPool || cutoff.quota || "",
              stage: cutoff.stage || cutoff.allotmentStage || "",
              source: "Legacy structured cutoff JSON",
            });
          }
        }
      }
    }
    for (const values of byName.values()) values.sort((a, b) => a.year - b.year || String(a.round).localeCompare(String(b.round)) || b.percentile - a.percentile);
    for (const values of byCode.values()) values.sort((a, b) => a.year - b.year || String(a.round).localeCompare(String(b.round)) || b.percentile - a.percentile);
    return { byName, byCode };
  }

  function getJeeHistory(result) {
    if (!state.jeeHistoryIndex) return [];
    return state.jeeHistoryIndex.get(jeeHistoryKey(result)) || [];
  }

  function isMhtMaharashtraSeat(row) {
    const level = String(row.seatLevel || "").toLowerCase().replace(/[-_]+/g, " ");
    const category = String(row.category || "").trim().toUpperCase();
    if (/all\s*india/.test(level)) return false;
    if (category === "AI" || /^AI\b/.test(category)) return false;
    return true;
  }

  function getMhtHistory(result) {
    const index = state.mhtHistoryIndex;
    if (!index) return [];
    const codeKey = mhtHistoryCodeKey(result.collegeCode, result.branchCode);
    const namedRows = index.byName.get(mhtHistoryNameKey(result.college, result.branch)) || [];
    const codedRows = codeKey ? (index.byCode.get(codeKey) || []) : [];
    const rows = [...new Set([...codedRows, ...namedRows])];
    const category = categoryInput?.value || "OPEN";
    const matcher = CATEGORY_MHT[category] || CATEGORY_MHT.OPEN;
    const gender = genderInput?.value || "Male";
    return rows.filter((row) => {
      if (!isMhtMaharashtraSeat(row)) return false;
      if (!matcher.test(row.category)) return false;
      if (/^L/i.test(row.category) && gender !== "Female") return false;
      return true;
    });
  }

  const MHT_OFFICIAL_YEAR_SOURCES = {
    2020: { label: "Official Maharashtra CAP Round I cutoff PDF", url: "https://fe2021.maha-ara.org/2020/2020ENGG_CAP1_CutOff.pdf" },
    2021: { label: "Official Maharashtra CAP Round I cutoff PDF", url: "https://fe2024.mahacet.org/2021/2021ENGG_CAP1_CutOff.pdf" },
    2022: { label: "Official State CET Cell archive", url: "https://fe2022.maha-ara.org/StaticPages/HomePage" },
    2023: { label: "Official State CET Cell archive", url: "https://fe2023.mahacet.org/StaticPages/HomePage" },
    2024: { label: "Official State CET Cell archive", url: "https://fe2024.mahacet.org/StaticPages/HomePage" },
    2025: { label: "Official State CET Cell archive", url: "https://fe2025.mahacet.org/StaticPages/HomePage" },
    2026: { label: "Official State CET Cell archive", url: "https://fe2026.mahacet.org/StaticPages/HomePage" },
  };

  function historyTable(rows, exam, result) {
    const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
    const tbody = [];
    if (exam === "jee") {
      const history = getJeeHistory(result);
      for (const year of years) {
        const yearly = history.filter((row) => Number(row.dataYear) === year);
        if (!yearly.length) {
          tbody.push(`<tr><td>${year}</td><td colspan="4">No matching record in the loaded JoSAA/CSAB sources for this program and seat bucket.</td></tr>`);
          continue;
        }
        for (const row of yearly) {
          const roundLabel = row.sourceKind === "CSAB" ? `CSAB Special Round ${row.round}` : `JoSAA Round ${row.round}`;
          tbody.push(`<tr><td>${year}</td><td>${escapeHTML(roundLabel)}</td><td>${escapeHTML(normaliseJeeCategory(row.category))}</td><td>${Number(row.cutoffRank).toLocaleString("en-IN")}</td><td>${escapeHTML(row.source || "Loaded public cutoff source")}</td></tr>`);
        }
      }
      return `<div class="cutoff-history-inner"><p class="cutoff-history-summary">${escapeHTML(result.branch)} · ${escapeHTML(normaliseJeeCategory(result.category))} · ${escapeHTML(result.quota || "Quota not specified")} · ${escapeHTML(result.genderSeat || "Gender bucket not specified")}</p><div class="cutoff-history-table-wrap"><table class="cutoff-history-table"><thead><tr><th>Year</th><th>Round</th><th>Category</th><th>Closing rank</th><th>Source</th></tr></thead><tbody>${tbody.join("")}</tbody></table></div><p class="cutoff-history-note">This history contains matching JoSAA/CSAB records found in the connected sources. “No matching record” means the connected sources did not return a matching row; it does not prove that no seat existed.</p></div>`;
    }

    const history = getMhtHistory(result);
    for (const year of years) {
      const yearly = history.filter((row) => Number(row.year) === year);
      if (!yearly.length) {
        const official = MHT_OFFICIAL_YEAR_SOURCES[year];
        const sourceLink = official ? ` <a href="${official.url}" target="_blank" rel="noopener noreferrer">${escapeHTML(official.label)} ↗</a>` : "";
        const isPdfOnlyYear = year === 2020 || year === 2021;
        tbody.push(`<tr><td>${year}</td><td colspan="5">${isPdfOnlyYear ? "The official cutoff is available as a PDF, but this app has not converted it into structured values." : "No matching structured row loaded for this college, branch and selected category."}${sourceLink}</td></tr>`);
        continue;
      }
      for (const row of yearly) {
        const roundText = row.round ? (/round/i.test(row.round) ? row.round : `CAP Round ${row.round}`) : "Round not labelled in source";
        const seatText = [row.category, row.seatLevel, row.stage ? `Stage ${row.stage}` : ""].filter(Boolean).join(" · ");
        const rank = row.rank === null ? "—" : Number(row.rank).toLocaleString("en-IN");
        const official = MHT_OFFICIAL_YEAR_SOURCES[year];
        const sourceLabel = row.source || (official ? official.label : "Connected structured cutoff dataset");
        tbody.push(`<tr><td>${escapeHTML(row.academicYear || String(year))}</td><td>${escapeHTML(roundText)}</td><td>${escapeHTML(seatText || row.category)}</td><td>${Number(row.percentile).toFixed(4)}%</td><td>${escapeHTML(rank)}</td><td>${escapeHTML(sourceLabel)}${official ? ` <a href="${official.url}" target="_blank" rel="noopener noreferrer">Official ↗</a>` : ""}</td></tr>`);
      }
    }
    return `<div class="cutoff-history-inner"><p class="cutoff-history-summary">${escapeHTML(result.branch)} · Selected category: ${escapeHTML(categoryInput?.value || "OPEN")} · Maharashtra-seat rows only; All India seat rows are excluded.</p><div class="cutoff-history-table-wrap"><table class="cutoff-history-table"><thead><tr><th>Year</th><th>CAP round</th><th>Seat code / level</th><th>Closing percentile</th><th>Merit rank</th><th>Source</th></tr></thead><tbody>${tbody.join("")}</tbody></table></div><p class="cutoff-history-note">Structured year/round values are shown when present in the connected dataset (documented for academic cycles 2022–23 through 2025–26, with any additional dated rows shown if a legacy source supplies them). For 2020–2021, the app links to official cutoff PDFs instead of inventing numeric values. A missing structured row does not prove the college had no cutoff or no seats.</p></div>`;
  }

  function bindCutoffHistoryButtons(rows, exam) {
    resultsList.querySelectorAll(".cutoff-history-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.resultIndex);
        const result = rows[index];
        const panel = $(`cutoffHistory${index}`);
        if (!result || !panel) return;
        if (!panel.hidden) {
          panel.hidden = true;
          button.setAttribute("aria-expanded", "false");
          button.textContent = "View cutoff history (2020–2026)";
          return;
        }
        if (!panel.dataset.loaded) {
          panel.innerHTML = historyTable([], exam, result);
          panel.dataset.loaded = "true";
        }
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        button.textContent = "Hide cutoff history";
      });
    });
  }

  function resultCard(result, index, exam) {
    const cutoff = exam === "jee"
      ? `Closing rank: ${result.cutoffRank.toLocaleString("en-IN")}`
      : `Historical closing percentile: ${Number(result.cutoffPercentile).toFixed(4)}%`;
    const admissionMeta = exam === "jee"
      ? `Program: ${result.branch} · Category: ${normaliseJeeCategory(result.category)} · Quota: ${result.quota} · Seat type: ${result.genderSeat}`
      : `Branch: ${result.branch} · Cutoff bucket: ${result.cutoffBucket} · Year: ${result.year}`;
    const quotaNote = exam === "jee" && /^(HS|OS|GO|JK|LA)$/i.test(String(result.quota || ""))
      ? "Quota eligibility depends on the counselling rules and candidate details."
      : "";
    const notice = [result.source || result.year, quotaNote].filter(Boolean).join(" · ");
    return `
      <article class="result-card">
        <div class="result-top">
          <div class="result-main">
            <div class="result-name">${index + 1}. ${escapeHTML(result.college)}</div>
            <div class="result-meta">${escapeHTML(admissionMeta)}<br>${escapeHTML(cutoff)}<br>${escapeHTML(notice)}</div>
          </div>
        </div>
        <div class="result-tags">
  <span class="tag ${result.assessment.band}">
    ${escapeHTML(result.assessment.label)}
  </span>
  <span class="tag">${escapeHTML(result.year)}</span>
</div>

<a
  class="college-dunia-link"
  href="${collegeDuniaSearchUrl(result.college, result.branch)}"
  target="_blank"
  rel="noopener noreferrer"
>
  View Fees, Placements & Reviews ↗
</a>
<button class="cutoff-history-toggle" type="button" data-result-index="${index}" aria-expanded="false" aria-controls="cutoffHistory${index}">View cutoff history (2020–2026)</button>
<div class="cutoff-history-panel" id="cutoffHistory${index}" hidden></div>
      </article>`;
  }

  async function loadMhtCap1ScenarioData() {
    if (state.mhtCap1ScenarioData) {
      return state.mhtCap1ScenarioData;
    }

    if (state.mhtCap1ScenarioPromise) {
      return state.mhtCap1ScenarioPromise;
    }

    state.mhtCap1ScenarioPromise = (async () => {
      // First try the dedicated Maharashtra CAP Round-I data file.
      try {
        const { payload, url } = await fetchJsonFromAny(
          DATA_URLS.mhtCap1Scenario,
          value => Array.isArray(value?.rows) && value.rows.length > 1000,
          12000
        );

        const rows = payload.rows.map(row => ({
          instituteCode: String(row[0] ?? "").trim(),
          college: String(row[1] ?? "").trim(),
          courseCode: String(row[2] ?? "").trim(),
          branch: String(row[3] ?? "").trim(),
          category: String(row[4] ?? "").trim().toUpperCase(),
          percentile: numberValue(row[5]),
          meritRank: numberValue(row[6]),
          seatPool: String(row[7] ?? "").trim(),
          allotmentStage: String(row[8] ?? "").trim(),
          homeUniversity: String(row[9] ?? "").trim()
        })).filter(row =>
          row.college &&
          row.branch &&
          row.category &&
          row.percentile !== null &&
          row.percentile >= 0 &&
          row.percentile <= 100
        );

        if (!rows.length) {
          throw new Error("The dedicated CAP data contained no usable rows.");
        }

        state.mhtCap1ScenarioData = rows;
        state.mhtCap1ScenarioSource = url;
        state.mhtCap1ScenarioKind = "dedicated";
        return rows;

      } catch (dedicatedError) {
        // If the separate file cannot be reached, inspect the predictor's
        // existing data. Do not treat unspecified rounds as Round I.
        const colleges = await loadMhtCutoffs();
        const fallbackRows = [];

        function isRoundOne(value) {
          const round = String(value ?? "")
            .toLowerCase()
            .replace(/[._-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          return /^(?:(?:cap )?round )?(?:1|i)$/.test(round) ||
            /\bround (?:1|i)\b/.test(round);
        }

        function isMaharashtraSeatCode(value) {
          const code = String(value ?? "").trim().toUpperCase();

          // Maharashtra seat codes such as GOPENH, LOPENO and GOBCO.
          // AI / All India seat types are deliberately excluded.
          // Require a Maharashtra CAP seat-code prefix here. Generic bare labels
          // like OPEN are accepted by the main predictor, but are not enough to
          // prove Maharashtra-seat eligibility for this dedicated scenario panel.
          return /^(?:G|L)(?:OPEN|OBC|SC|ST|VJ|NT[1-3]?|SEBC|SBC)(?:H|O|S)?$/.test(code) ||
            /^(?:EWS|TFWS)(?:H|O|S)?$/.test(code);
        }

        for (const college of colleges || []) {
          const branches = Array.isArray(college.branches)
            ? college.branches
            : Array.isArray(college.courses)
              ? college.courses
              : [];

          for (const branch of branches) {
            const branchName = branch.name || branch.courseName || "";
            const history = Array.isArray(branch.cutoffsByYear)
              ? branch.cutoffsByYear
              : [];

            for (const item of history) {
              const year = Number(
                String(item.year ?? "").match(/20\d{2}/)?.[0]
              );

              const category = String(
                item.category ?? item.key ?? ""
              ).trim().toUpperCase();

              const percentile = numberValue(item.percentile);

              if (year !== 2025) continue;
              if (!isRoundOne(item.round)) continue;
              if (!isMaharashtraSeatCode(category)) continue;
              if (percentile === null || percentile < 0 || percentile > 100) continue;
              if (!college || !branchName) continue;

              const seatGroup = category.match(/[HOS]$/)?.[0] || "";

              fallbackRows.push({
                instituteCode: String(
                  college.code || college.instCode || college.instituteCode || ""
                ),
                college: String(
                  college.name || college.instName || college.instituteName || ""
                ),
                courseCode: String(
                  branch.code || branch.choiceCode || branch.courseCode || ""
                ),
                branch: String(branchName),
                category,
                percentile,
                meritRank: numberValue(item.rank),
                seatPool: ({
                  H: "Home University",
                  O: "Other Than Home University",
                  S: "State Level"
                })[seatGroup] || "",
                allotmentStage: "I",
                homeUniversity: ""
              });
            }
          }
        }

        if (!fallbackRows.length) {
          throw new Error(
            "The CAP data file could not be loaded, and the existing cutoff source " +
            "does not contain usable 2025 Maharashtra CAP Round-I records. " +
            "The dedicated CAP data must be hosted at a URL the website can access."
          );
        }

        state.mhtCap1ScenarioData = fallbackRows;
        state.mhtCap1ScenarioKind = "fallback";
        state.mhtCap1ScenarioSource =
          "Existing historical cutoff data filtered to 2025 Maharashtra CAP Round I";

        return fallbackRows;
      }
    })().catch(error => {
      state.mhtCap1ScenarioError = error?.message || String(error);
      state.mhtCap1ScenarioPromise = null;
      throw error;
    });

    return state.mhtCap1ScenarioPromise;
  }

  function scenarioCollegeKey(row) {
    // Show one card per institute (the main prediction list is also college-centric).
    return String(row.instituteCode || normalizedCollegeName(row.college));
  }

  function scenarioCourseKey(row) {
    return `${String(row.instituteCode || normalizedCollegeName(row.college))}|${String(row.courseCode || row.branch || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
  }

  function normalizedCollegeName(name) {
    return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function cap1CategoryMatches(row, category, gender, branch) {
    const matcher = CATEGORY_MHT[category] || CATEGORY_MHT.OPEN;
    if (!matcher.test(row.category)) return false;
    // L-prefixed codes indicate women-reserved seats; keep matching the current app's rule.
    if (/^L/i.test(row.category) && gender !== "Female") return false;
    return mhtBranchMatches(row.branch, branch);
  }

  function scenarioItemCard(row, index, extra = false) {
    const rankText = Number.isFinite(Number(row.meritRank)) && row.meritRank !== null && row.meritRank !== "" ? ` · Maharashtra merit rank ${Number(row.meritRank).toLocaleString("en-IN")}` : "";
    const poolText = row.seatPool ? ` · ${row.seatPool} seat pool` : "";
    const stageText = row.allotmentStage ? ` · allotment stage ${row.allotmentStage}` : "";
    return `<article class="scenario-item">
      <div class="scenario-item-name">${index + 1}. ${escapeHTML(row.college)}</div>
      <div class="scenario-item-meta">${escapeHTML(row.branch)}<br>CAP Round I 2025–26 cutoff: <strong>${row.percentile.toFixed(4)}%</strong><br>Seat code: ${escapeHTML(row.category)}${escapeHTML(poolText)}${escapeHTML(stageText)}${escapeHTML(rankText)}</div>
      <a href="${collegeDuniaSearchUrl(row.college, row.branch)}" target="_blank" rel="noopener noreferrer">View college details ↗</a>
    </article>`;
  }

  function renderScenarioPanel(delta, basePercentile, options) {
    const target = Math.min(100, basePercentile + delta);
    const targetNode = $(`scenarioTarget${delta}`);
    const countNode = $(`scenarioCount${delta}`);
    const listNode = $(`scenarioList${delta}`);
    const capped = basePercentile + delta > 100;
    targetNode.textContent = `Target ${target.toFixed(4)}%${capped ? " (max)" : ""}`;
    if (!options.length) {
      countNode.textContent = basePercentile >= 100
        ? "You are already at 100%; there is no higher percentile to simulate."
        : "No additional colleges matched this cutoff range and your current filters.";
      listNode.innerHTML = `<div class="empty-state">No newly unlocked college options found in the supplied CAP Round I records for this simulation.</div>`;
      return;
    }
    countNode.textContent = `${options.length.toLocaleString("en-IN")} newly unlocked college option${options.length === 1 ? "" : "s"} · ordered by closing percentile`;
    const initialCount = 12;
    const firstItems = options.slice(0, initialCount).map((row, index) => scenarioItemCard(row, index, false)).join("");
    const hiddenItems = options.slice(initialCount).map((row, index) => scenarioItemCard(row, initialCount + index, true)).join("");
    listNode.innerHTML = `<div class="scenario-items">${firstItems}</div>${hiddenItems ? `<div class="scenario-items scenario-more-items" id="scenarioMore${delta}" hidden>${hiddenItems}</div><button class="scenario-expand" type="button" data-scenario-expand="${delta}">Show all ${options.length.toLocaleString("en-IN")} options</button>` : ""}`;
  }

  async function renderPercentileScenarios(basePercentile, category, gender, branch, currentRows) {
    if (!percentileScenarios) return;
    percentileScenarios.hidden = false;
    scenarioIntro.textContent = `Your entered percentile is ${basePercentile.toFixed(4)}%. Each card shows the cumulative extra college options unlocked at that simulated percentile, not an admission guarantee. The main prediction list and its logic are unchanged.`;
    [1, 2, 3].forEach((delta) => {
      $(`scenarioTarget${delta}`).textContent = "Loading…";
      $(`scenarioCount${delta}`).textContent = "Loading Maharashtra CAP Round I cutoff data…";
      $(`scenarioList${delta}`).innerHTML = "";
    });
    try {
      const data = await loadMhtCap1ScenarioData();
      const scoped = data.filter((row) => cap1CategoryMatches(row, category, gender, branch));
      const baselineCollegeKeys = new Set(scoped.filter((row) => row.percentile <= basePercentile + 0.000001).map(scenarioCollegeKey));
      const baselineCourseKeys = new Set(scoped.filter((row) => row.percentile <= basePercentile + 0.000001).map(scenarioCourseKey));
      const alreadyWithinCutoff = new Set((currentRows || [])
        .filter((row) => row.assessment?.band === "good")
        .map((row) => normalizedCollegeName(row.college)));

      const scenarioOptions = (delta) => {
        const target = Math.min(100, basePercentile + delta);
        const byCourse = new Map();
        for (const row of scoped) {
          if (row.percentile <= basePercentile + 0.000001 || row.percentile > target + 0.000001) continue;
          const collegeKey = scenarioCollegeKey(row);
          const courseKey = scenarioCourseKey(row);
          if (baselineCollegeKeys.has(collegeKey) || baselineCourseKeys.has(courseKey)) continue;
          if (alreadyWithinCutoff.has(normalizedCollegeName(row.college))) continue;
          const prior = byCourse.get(collegeKey);
          // Show one entry per institute, using its lowest newly reachable matching cutoff.
          if (!prior || row.percentile < prior.percentile) byCourse.set(collegeKey, row);
        }
        return [...byCourse.values()].sort((a, b) => b.percentile - a.percentile || a.college.localeCompare(b.college));
      };

      [1, 2, 3].forEach((delta) => renderScenarioPanel(delta, basePercentile, scenarioOptions(delta)));
      scenarioSourceNote.textContent =
        state.mhtCap1ScenarioKind === "fallback"
          ? `Source: Existing historical data filtered to Maharashtra CAP Round I records (${data.length.toLocaleString("en-IN")} rows).`
          : `Source: Maharashtra & Minority Seats CAP Round I, 2025–26 (${data.length.toLocaleString("en-IN")} rows).`;
      percentileScenarios.querySelectorAll("[data-scenario-expand]").forEach((button) => {
        button.addEventListener("click", () => {
          const more = $(`scenarioMore${button.dataset.scenarioExpand}`);
          if (more) {
            more.hidden = false;
            more.querySelectorAll("[hidden]").forEach((item) => { item.hidden = false; });
          }
          button.hidden = true;
        });
      });
    } catch (error) {
      const message = error?.message || "Unable to load the CAP Round I data file.";
      [1, 2, 3].forEach((delta) => {
        $(`scenarioTarget${delta}`).textContent = `+${delta}`;
        $(`scenarioCount${delta}`).textContent = "CAP Round I scenario data unavailable.";
        $(`scenarioList${delta}`).innerHTML = `<div class="empty-state">${escapeHTML(message)}<br><br>Make sure the <code>data</code> folder is uploaded beside <code>index.html</code>.</div>`;
      });
      scenarioSourceNote.textContent = "The main college prediction remains available. The extra percentile comparison was not shown because its dedicated Maharashtra CAP Round I data file could not be read.";
    }
  }

  function renderResults({ rows, exam, sourceRows, sourceErrors = [] }) {
    resultsSection.hidden = false;
    if (percentileScenarios) percentileScenarios.hidden = exam !== "mht";
    // Show each college name only once, keeping its first (highest-ranked) entry.
    const seenColleges = new Set();
    rows = rows.filter((row) => {
      const key = String(row.college || "").trim().replace(/\s+/g, " ").toLowerCase();
      if (seenColleges.has(key)) return false;
      seenColleges.add(key);
      return true;
    });
    // Fit-score values were formula-generated, not statistically calibrated admission probabilities.
    // Hide the entire numeric score widget rather than replacing it with another arbitrary number.
    if (confidenceCard) confidenceCard.hidden = true;
    resultTitle.textContent = exam === "jee" ? "JEE Main college shortlist" : "MHT-CET college shortlist";
    resultSub.textContent = exam === "jee"
      ? "All qualifying non-IIT B.Tech records available in the connected JoSAA/CSAB cutoff datasets are shown, including NITs, IIITs and GFTIs; the consolidated historical archive adds 2025 where available. IITs are excluded because they require JEE Advanced. This is not a complete census of private/state-level JEE-accepting colleges; those need their own verified cutoff sources."
      : "Compared against year- and round-labelled MHT-CET CAP cutoff records available in the connected public datasets. The structured historical CSV documents academic cycles 2022–23 through 2025–26; official 2020–2021 cutoff PDFs are linked for verification but are not silently treated as structured numeric rows.";

    if (!rows.length) {
      bestName.textContent = "No matching cutoff records";
      bestMeta.textContent = "No qualifying records were found in the downloaded source for these filters. The app has not invented fallback results.";
      resultsList.innerHTML = `<div class="empty-state">No records matched these filters. Try another branch/category or retry when the public source is available. A source may be reachable but still contain no matching cutoff rows.</div>`;
    } else {
      const top = rows[0];
      bestName.textContent = top.college;
      bestMeta.textContent = `${top.branch} · ${top.assessment.label} · ${exam === "jee" ? `closing rank ${top.cutoffRank.toLocaleString("en-IN")} · ${top.year}` : `closing percentile ${top.cutoffPercentile.toFixed(4)}% (${top.cutoffBucket})`}`;
      resultsList.innerHTML = rows.map((row, index) => resultCard(row, index, exam)).join("");
      bindCutoffHistoryButtons(rows, exam);
    }

    const cards = [];
    if (exam === "jee") {
      const successful = state.jeeRoundStatuses.filter((round) => round.ok);
      cards.push(sourceCard("JoSAA 2026 rounds", `${successful.length}/${ROUND_NUMBERS.length} round files loaded`, `${sourceRows.toLocaleString("en-IN")} unique institute/program/category/quota/seat slots after prioritising the latest round and year. CSAB remains separately identified.`, successful.length === 0));
      const historyLoaded = state.jeeHistoricalStatuses.filter((item) => item.ok);
      const historyRows = historyLoaded.reduce((sum, item) => sum + item.rows, 0);
      cards.push(sourceCard("JoSAA historical cutoffs", `${historyLoaded.length}/${HISTORICAL_JEE_SNAPSHOTS.length} snapshots loaded`, `${historyRows.toLocaleString("en-IN")} historical rows checked across 2020–2024 final rounds; older data only fills slots missing from 2026.`, historyLoaded.length === 0));
      const csab = state.jeeCsabStatus;
      cards.push(sourceCard("CSAB 2026 Special Round 1", csab?.ok ? "Loaded" : "Unavailable", csab?.ok ? `${csab.rows.toLocaleString("en-IN")} cutoff records. Kept separate from JoSAA because it is a different counselling route.` : (csab?.error || "Source unavailable"), !csab?.ok));
      for (const round of state.jeeRoundStatuses) {
        cards.push(sourceCard(`2026 Round ${round.round}`, round.ok ? "Loaded" : "Unavailable", round.ok ? `${round.rows.toLocaleString("en-IN")} parsed records` : (round.error || "Source unavailable"), !round.ok));
      }
      const archive = state.jeeArchiveStatus;
      cards.push(sourceCard("Consolidated JoSAA archive", archive?.ok ? "Loaded" : "Unavailable", archive?.ok ? `${archive.rows.toLocaleString("en-IN")} additional historical records checked, including 2025 where present.` : (archive?.error || "Archive unavailable"), !archive?.ok));
      const missingYears = state.jeeHistoricalStatuses.filter((item) => !item.ok).map((item) => item.year);
      if (missingYears.length) cards.push(sourceCard("Historical source note", "Partial history", `Unavailable snapshots: ${missingYears.join(", ")}. 2026 records are still used when available.`, true));
    } else {
      cards.push(sourceCard("MHT-CET historical CAP cutoffs", state.mhtData ? "Dataset loaded" : "Unavailable", `${sourceRows.toLocaleString("en-IN")} cutoff buckets counted. ${state.mhtDataSourceYears || "Coverage depends on which public sources loaded successfully."}`, !state.mhtData));
      cards.push(sourceCard("2020–2021 official archive", "Reference links", "2020–2021 official cutoff archives are published as PDFs. These older PDF tables are not counted as structured prediction rows unless a matching CSV record was loaded.", false));
      cards.push(sourceCard("Maharashtra 2026–27 directory", state.mhtDirectoryRecords ? "Directory loaded" : "Not loaded", state.mhtDirectoryRecords ? `${state.directoryInstitutes.length.toLocaleString("en-IN")} institutes` : "Directory loads when you use its search/filter.", false));
    }
    cards.push(sourceCard("Prediction method", "Ran in this browser", "No arbitrary /100 fit score is displayed. Student ranks are not included in public-data request URLs; no app backend or persistent browser storage is used."));
    if (sourceErrors.length) cards.push(sourceCard("Source notes", "Partial data", sourceErrors.join(" | "), true));
    // Data-source status boxes are not shown for JEE or MHT-CET predictions.
    sourceStatuses.innerHTML = "";
    sourceStatuses.hidden = true;
  }

  function renderDirectory() {
    if (!directoryResults) return;
    const allInstitutes = state.directoryInstitutes || [];
    if (!allInstitutes.length) return;
    const query = String(directorySearch?.value || "").trim().toLowerCase();
    const selectedOnly = directoryProgramFilter?.value === "selected";
    const filtered = allInstitutes.filter((institute) => {
      const matchingCourses = institute.courses.filter((course) => !selectedOnly || mhtBranchMatches(course.name, state.branch));
      if (selectedOnly && !matchingCourses.length) return false;
      const searchText = `${institute.name} ${institute.code} ${institute.status} ${institute.university} ${institute.courses.map((course) => course.name).join(" ")}`.toLowerCase();
      return !query || searchText.includes(query);
    });
    const shown = filtered.slice(0, state.directoryVisibleCount);
    const totalPrograms = state.mhtDirectoryRecords.length;
    directoryStats.textContent = `${allInstitutes.length.toLocaleString("en-IN")} institutes · ${totalPrograms.toLocaleString("en-IN")} course options`;
    directoryResults.innerHTML = shown.length ? shown.map((institute) => {
      const courses = institute.courses.filter((course) => !selectedOnly || mhtBranchMatches(course.name, state.branch));
      const preview = courses.slice(0, 5).map((course) => course.name);
      const extra = courses.length > preview.length ? ` +${courses.length - preview.length} more` : "";
      const capacity = courses.reduce((sum, course) => sum + (course.intake || 0), 0);
      return `<article class="directory-item">
        <div class="directory-item-head"><div class="directory-item-name">${escapeHTML(institute.name)}</div><span class="directory-code">${escapeHTML(institute.code)}</span></div>
        <div class="directory-item-meta">${courses.length.toLocaleString("en-IN")} listed course options${capacity ? ` · ${capacity.toLocaleString("en-IN")} combined reported intake across listed options` : ""}</div>
        <div class="directory-item-tags">${preview.map((name) => `<span>${escapeHTML(name)}</span>`).join("")}${extra ? `<span>${escapeHTML(extra)}</span>` : ""}</div>
      </article>`;
    }).join("") : `<div class="empty-state">No institutes match that search. Try a shorter college name, city, institute code, or change the course filter.</div>`;
    directoryShowing.textContent = `Showing ${shown.length.toLocaleString("en-IN")} of ${filtered.length.toLocaleString("en-IN")} matching institutes${selectedOnly ? ` offering ${state.branch}` : ""}.`;
    directoryMore.hidden = shown.length >= filtered.length;
  }

  async function ensureDirectoryLoaded() {
    if (state.mhtDirectoryRecords || state.directoryLoadPromise) return state.directoryLoadPromise || state.mhtDirectoryRecords;
    directoryStats.textContent = "Loading directory…";
    directoryResults.innerHTML = `<div class="empty-state">Loading the public Maharashtra CAP directory. No student score is sent with this request.</div>`;
    try { return await loadMaharashtraDirectory(); }
    catch { return null; }
  }

  async function predict() {
    if (state.loading) return;
    const raw = String(scoreInput.value || "").trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < Number(scoreInput.min) || value > Number(scoreInput.max)) {
      setStatus(state.exam === "jee" ? "Enter a valid JEE rank between 1 and 2,000,000." : "Enter a valid MHT-CET percentile between 0 and 100.", "error");
      scoreInput.focus();
      return;
    }

    state.loading = true;
    predictButton.disabled = true;
    predictText.textContent = "Loading cutoff data…";
    setStatus("Fetching public cutoff data in your browser. No student score is sent to a prediction API.");
    clearResults();
    try {
      if (state.exam === "jee") {
        const data = await loadJeeData();
        const rows = mapJeeResults(data, value, categoryInput.value, genderInput.value, state.branch);
        const successful = state.jeeRoundStatuses.filter((round) => round.ok).length;
        const historicalLoaded = state.jeeHistoricalStatuses.filter((item) => item.ok).length;
        const notes = [];
        if (successful < ROUND_NUMBERS.length) notes.push(`Only ${successful} of ${ROUND_NUMBERS.length} JoSAA 2026 rounds loaded.`);
        if (historicalLoaded < HISTORICAL_JEE_SNAPSHOTS.length) notes.push(`Only ${historicalLoaded} of ${HISTORICAL_JEE_SNAPSHOTS.length} historical snapshots loaded.`);
        if (!state.jeeCsabStatus?.ok) notes.push("The CSAB 2026 Special Round 1 source was unavailable; JoSAA data is still shown when available.");
        renderResults({ rows, exam: "jee", sourceRows: data.length, sourceErrors: notes });
        const sourcesComplete = successful === ROUND_NUMBERS.length && historicalLoaded === HISTORICAL_JEE_SNAPSHOTS.length && state.jeeCsabStatus?.ok && state.jeeArchiveStatus?.ok;
        setStatus(sourcesComplete
          ? "Prediction complete using JoSAA rounds, CSAB Special Round 1 and historical coverage."
          : `Prediction complete with partial source coverage (${successful}/${ROUND_NUMBERS.length} JoSAA rounds; ${historicalLoaded}/${HISTORICAL_JEE_SNAPSHOTS.length} historical snapshots; CSAB ${state.jeeCsabStatus?.ok ? "loaded" : "unavailable"}; consolidated archive ${state.jeeArchiveStatus?.ok ? "loaded" : "unavailable"}).`,
          successful > 0 || historicalLoaded > 0 || state.jeeCsabStatus?.ok ? (notes.length ? "error" : "ok") : "error");
      } else {
        const cutoffData = await loadMhtCutoffs();
        // The directory enriches course coverage when available; cutoff matches remain based only on cutoff-bearing records.
        let directoryRows = state.mhtDirectoryRecords;
        if (!directoryRows) directoryRows = await ensureDirectoryLoaded();
        const merged = mergeMhtCutoffsWithDirectory(cutoffData, directoryRows || []);
        let rows = mapMhtResults(merged.length ? merged : cutoffData, value, categoryInput.value, genderInput.value, state.branch).slice(0, MAX_RESULTS);
        // If the broad historical feeds contain no rows for these filters, try the
        // dedicated Maharashtra CAP Round-I records when they are actually available.
        // This does not invent results and does not alter JEE matching.
        if (!rows.length) {
          try {
            const capRows = await loadMhtCap1ScenarioData();
            const grouped = new Map();
            for (const item of capRows) {
              const key = String(item.instituteCode || normalizedCollegeName(item.college));
              if (!grouped.has(key)) grouped.set(key, { instCode: item.instituteCode, instName: item.college, branches: [] });
              const college = grouped.get(key);
              let course = college.branches.find((entry) => String(entry.code || "") === String(item.courseCode || "") && String(entry.name || "") === String(item.branch || ""));
              if (!course) {
                course = { code: item.courseCode, name: item.branch, cutoffsByYear: [] };
                college.branches.push(course);
              }
              course.cutoffsByYear.push({ year: 2025, round: "Round I", category: item.category, percentile: item.percentile, rank: item.meritRank });
            }
            const capFallback = mapMhtResults([...grouped.values()], value, categoryInput.value, genderInput.value, state.branch);
            if (capFallback.length) rows = capFallback.slice(0, MAX_RESULTS);
          } catch (optionalCapError) {
            // Keep the original empty-result state if the optional source is absent.
          }
        }
        const sourceRows = cutoffData.reduce((total, college) => {
          const branches = Array.isArray(college.branches) ? college.branches : Array.isArray(college.courses) ? college.courses : [];
          return total + branches.reduce((sum, branch) => sum + Object.keys(branch.cutoffs2025 || branch.cutoffs2024 || branch.cutoffs || {}).length + (Array.isArray(branch.cutoffsByYear) ? branch.cutoffsByYear.length : 0), 0);
        }, 0);
        renderResults({ rows, exam: "mht", sourceRows, sourceErrors: state.directoryLoadError ? ["The separate statewide directory could not be loaded; prediction used cutoff records only."] : [] });
        // Add-on scenario calculations use only the supplied Maharashtra & Minority Seats CAP Round I 2025–26 dataset.
        // The existing prediction rows and their matching logic are deliberately not modified.
        await renderPercentileScenarios(value, categoryInput.value, genderInput.value, state.branch, rows);
        setStatus(state.directoryLoadError ? "Prediction complete using available historical cutoff data. The separate statewide directory is unavailable." : "Prediction complete against available historical MHT-CET CAP cutoffs and percentile scenarios.", state.directoryLoadError ? "error" : "ok");
      }
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      console.error("GetMyCollege data load failed:", error);
      resultsSection.hidden = false;
      resultTitle.textContent = "Cutoff data could not be loaded";
      resultSub.textContent = "The source request failed, so no sample or invented prediction has been shown.";
      if (confidenceCard) confidenceCard.hidden = true;
      confidence.textContent = "—";
      confidenceBar.style.width = "0%";
      bestName.textContent = "Public data unavailable";
      bestMeta.textContent = "Check your connection and retry. Some networks or browsers may block cross-origin data requests.";
      resultsList.innerHTML = `<div class="empty-state">${escapeHTML(error?.message || "Unknown source error")}<br><br>No fallback colleges have been shown as if they were live data. Consult the official JoSAA or Maharashtra CET Cell cutoff documents for the corresponding seat category and round.</div>`;
      renderSourceStatus([sourceCard("Public cutoff data", "Unavailable", error?.message || "Unknown source error", true)]);
      setStatus("Could not load the cutoff source. No fabricated fallback results were displayed.", "error");
    } finally {
      state.loading = false;
      predictButton.disabled = false;
      predictText.textContent = "Predict my colleges";
    }
  }

  function resetForm() {
    scoreInput.value = "";
    categoryInput.value = "OPEN";
    genderInput.value = "Male";
    domicileInput.value = "MS";
    districtInput.value = "";
    selectBranch("CSE");
    clearResults();
    if (state.exam === "jee") updateJeeRankHint();
    setStatus("Form reset. Enter your score or rank and click Predict to fetch data.");
  }

  examTabs.forEach((tab) => tab.addEventListener("click", () => setExam(tab.dataset.exam)));
  branchChips.forEach((chip) => chip.addEventListener("click", () => selectBranch(chip.dataset.branch)));
  predictButton.addEventListener("click", predict);
  $("reset").addEventListener("click", resetForm);
  categoryInput.addEventListener("change", () => { if (state.exam === "jee") updateJeeRankHint(); });
  domicileInput.addEventListener("change", () => {
    districtField.hidden = state.exam !== "mht" || domicileInput.value !== "MS";
  });
  // The Maharashtra directory belongs to MHT-CET mode only; JEE results show the
  // full available national rank-matched cutoff list instead of a Maharashtra panel.
  if (directorySection) directorySection.hidden = state.exam === "jee";

  // The directory is lazy-loaded only when the user explicitly uses its search/filter.
  directorySearch.addEventListener("focus", () => { if (!state.mhtDirectoryRecords) void ensureDirectoryLoaded(); }, { once: true });
  directorySearch.addEventListener("input", () => { state.directoryVisibleCount = DIRECTORY_PAGE_SIZE; if (state.mhtDirectoryRecords) renderDirectory(); else void ensureDirectoryLoaded(); });
  directoryProgramFilter.addEventListener("focus", () => { if (!state.mhtDirectoryRecords) void ensureDirectoryLoaded(); }, { once: true });
  directoryProgramFilter.addEventListener("change", () => { state.directoryVisibleCount = DIRECTORY_PAGE_SIZE; if (state.mhtDirectoryRecords) renderDirectory(); else void ensureDirectoryLoaded(); });
  directoryMore.addEventListener("click", () => { state.directoryVisibleCount += DIRECTORY_PAGE_SIZE; renderDirectory(); });

  setExam("jee");
  // Intentionally no network calls at startup. Data is fetched only after user interaction.
})();
