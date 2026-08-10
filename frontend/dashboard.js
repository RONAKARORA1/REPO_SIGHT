/* ==========================================================================
   repo-sight dashboard — client-side logic
   Same data contract as before: reads ?scan=<id> from the URL, polls
   GET /api/scans/:id every 3s until COMPLETED/FAILED, then renders the
   merged { project, files, hotspots, violations } report.
   ========================================================================== */

const GRADE_COLOR = { A: "#5EEAD4", B: "#5EEAD4", C: "#F5A524", D: "#F5A524", F: "#F97066" };
const SEV_COLOR = { warning: "#F5A524", info: "#5B8DEF" };
const LANG_LABEL = { cpp: "C++", python: "Python", java: "Java" };

const LOADING_MESSAGES = [
  "Tokenizing your source files…",
  "Walking the token stream…",
  "Counting cyclomatic complexity…",
  "Scanning for anti-patterns…",
  "Cross-referencing git history…",
  "Computing the health score…",
];

const LOADING_TIPS = [
  "Tip: repo-sight badges embed live in your README and update on every scan.",
  "Tip: hotspot score = complexity × commit churn — the files most worth reviewing first.",
  "Tip: rules never fail a build on their own — that's a separate quality-gate step.",
  "Tip: run inside a git repo to unlock hotspot analysis.",
];

class RepoSightDashboard {
  constructor() {
    this.jsonData = null;
    this.activeTab = "overview";
    this.violationFilters = { severity: "all", language: "all", search: "" };
    this.lastAnalysisDate = localStorage.getItem("rs-last-analysis");
    this.analysisStreak = parseInt(localStorage.getItem("rs-streak") || "0", 10);

    this.init();
  }

  init() {
    this.bindNav();
    this.bindFilters();
    this.loadReport();
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  bindNav() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => this.setTab(btn.dataset.tab));
    });
    const rerunBtn = document.getElementById("rerun-btn");
    if (rerunBtn) {
      rerunBtn.addEventListener("click", () => window.location.reload());
    }
  }

  setTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    const panels = {
      overview: "overview-panel",
      hotspots: "hotspots-panel-wrap",
      violations: "violations-panel-wrap",
      dependencies: "dependencies-panel-wrap",
      files: "files-panel-wrap",
    };
    Object.entries(panels).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("active", key === tab);
    });
    const titles = {
      overview: "Overview",
      hotspots: "Hotspots",
      violations: "Violations",
      dependencies: "Dependencies",
      files: "Files",
    };
    document.getElementById("page-title").textContent = titles[tab];
  }

  bindFilters() {
    const search = document.getElementById("violation-search");
    if (search) {
      search.addEventListener("input", (e) => {
        this.violationFilters.search = e.target.value;
        this.renderViolations();
      });
    }
    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.violationFilters.severity = btn.dataset.severity;
        this.renderViolations();
      });
    });
    const langSelect = document.getElementById("filter-language");
    if (langSelect) {
      langSelect.addEventListener("change", (e) => {
        this.violationFilters.language = e.target.value;
        this.renderViolations();
      });
    }
    const fileSearch = document.getElementById("file-search");
    if (fileSearch) {
      fileSearch.addEventListener("input", (e) => this.renderFiles(e.target.value));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Load / poll                                                         */
  /* ------------------------------------------------------------------ */

  loadReport() {
    const scanId = new URLSearchParams(window.location.search).get("scan");
    if (!scanId) {
      this.showError(
        "No scan ID provided.",
        "Append ?scan=<id> to the URL, e.g. index.html?scan=abc123.",
      );
      return;
    }

    this.showLoadingState();

    const poll = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}`);
        if (!res.ok) {
          const errTxt = await res.text();
          throw new Error(`HTTP ${res.status}: ${errTxt}`);
        }
        const data = await res.json();

        if (data.status === "QUEUED" || data.status === "PROCESSING") {
          const pct =
            data.totalFiles && data.totalFiles > 0
              ? Math.round((data.processedFiles / data.totalFiles) * 100)
              : null;
          this.updateLoadingProgress(data.status, pct, data.processedFiles, data.totalFiles);
          setTimeout(poll, 3000);
          return;
        }

        if (data.status === "FAILED") {
          this.showError("Analysis failed", data.errorMessage ?? "Unknown error");
          return;
        }

        if (data.status === "COMPLETED") {
          this.jsonData = {
            project: data.project,
            files: data.files || [],
            hotspots: data.hotspots || { gitAvailable: false, topFiles: [] },
            violations: data.violations || [],
          };
          this.hideLoadingState();
          this.populateReport(data.projectName, data.scanId);
          return;
        }

        this.showError("Unknown scan status", String(data.status));
      } catch (err) {
        console.error("Polling error:", err);
        this.showError("Polling failed", err.message);
      }
    };

    poll();
  }

  /* ------------------------------------------------------------------ */
  /* Loading / error UI                                                  */
  /* ------------------------------------------------------------------ */

  showLoadingState() {
    document.getElementById("loading-state").classList.remove("hidden");
    document.getElementById("report-content").classList.add("hidden");
    document.getElementById("loading-message").textContent = this.pick(LOADING_MESSAGES);
    document.getElementById("loading-tip").textContent = this.pick(LOADING_TIPS);
    this._loadingRotator = setInterval(() => {
      const el = document.getElementById("loading-message");
      if (el) el.textContent = this.pick(LOADING_MESSAGES);
    }, 3500);
  }

  updateLoadingProgress(status, pct, processed, total) {
    const label = status === "QUEUED" ? "Queued…" : "Analyzing…";
    document.getElementById("loading-message").textContent = label;
    const progressEl = document.getElementById("loading-progress");
    if (progressEl) {
      progressEl.textContent =
        pct != null ? `${processed ?? 0}/${total} files (${pct}%)` : "";
    }
  }

  hideLoadingState() {
    if (this._loadingRotator) clearInterval(this._loadingRotator);
    document.getElementById("loading-state").classList.add("hidden");
    document.getElementById("report-content").classList.remove("hidden");
  }

  showError(title, detail) {
    if (this._loadingRotator) clearInterval(this._loadingRotator);
    const loadingState = document.getElementById("loading-state");
    loadingState.innerHTML = `
      <div class="error-panel">
        <h2>${this.escape(title)}</h2>
        <p>${this.escape(detail)}</p>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Report rendering                                                    */
  /* ------------------------------------------------------------------ */

  populateReport(projectName, scanId) {
    if (!this.jsonData) return;
    const project = this.jsonData.project || {};

    document.getElementById("sidebar-project").textContent = projectName || "project";
    document.getElementById("sidebar-scan").textContent = scanId
      ? `scan #${String(scanId).slice(0, 8)}`
      : "";
    document.getElementById("page-subtitle").textContent =
      `${project.filesAnalyzed ?? 0} files · ${this.formatNumber(project.totalLines ?? 0)} lines analyzed`;

    document.getElementById("nav-count-hotspots").textContent =
      this.jsonData.hotspots?.topFiles?.length || "";
    document.getElementById("nav-count-violations").textContent =
      this.jsonData.violations?.length || "";
    document.getElementById("nav-count-files").textContent =
      this.jsonData.files?.length || "";

    this.renderOverview(project);
    this.renderHotspots(this.jsonData.hotspots);
    this.renderViolations();
    this.renderDependencies(this.jsonData.files);
    this.renderFiles("");
    this.updateStreak();
  }

  renderOverview(project) {
    const score = project.healthScore ?? 0;
    const grade = project.healthGrade ?? "F";
    const color = GRADE_COLOR[grade] || "#F97066";

    const r = 54;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score));
    const fill = document.getElementById("gauge-fill");
    if (fill) {
      fill.style.stroke = color;
      fill.style.strokeDasharray = String(c);
      fill.style.strokeDashoffset = String(c - (pct / 100) * c);
      fill.style.filter = `drop-shadow(0 0 6px ${color}66)`;
    }
    document.getElementById("health-score-value").textContent = Math.round(score);
    const gradeEl = document.getElementById("health-grade");
    gradeEl.textContent = `GRADE ${grade}`;
    gradeEl.style.color = color;

    const violations = this.jsonData.violations || [];
    document.getElementById("count-critical").textContent = 0;
    document.getElementById("count-warning").textContent = violations.filter(
      (v) => v.severity === "warning",
    ).length;
    document.getElementById("count-info").textContent = violations.filter(
      (v) => v.severity === "info",
    ).length;

    document.getElementById("function-count").textContent = project.functionCount ?? 0;
    document.getElementById("complexity-count").textContent = project.cyclomaticComplexity ?? 0;
    document.getElementById("todo-count").textContent = project.todoCount ?? 0;
    document.getElementById("nesting-depth").textContent = project.maxNestingDepth ?? 0;

    const longestPanel = document.getElementById("longest-fn-panel");
    if (project.longestFunctionLines > 0) {
      longestPanel.classList.remove("hidden");
      document.getElementById("longest-fn-name").textContent = project.longestFunctionName;
      document.getElementById("longest-fn-lines").textContent =
        `${project.longestFunctionLines} lines`;
      const barPct = Math.min(100, (project.longestFunctionLines / 100) * 100);
      document.getElementById("longest-fn-bar").style.width = `${barPct}%`;
    } else {
      longestPanel.classList.add("hidden");
    }
  }

  renderHotspots(hotspots) {
    const wrap = document.getElementById("hotspots-panel-wrap");
    hotspots = hotspots || { gitAvailable: false, topFiles: [] };

    if (!hotspots.gitAvailable) {
      wrap.innerHTML = `
        <div class="empty-state">
          <p>Git history not available for this scan.</p>
          <p class="hint">Run repo-sight inside a git repository to surface complexity × churn hotspots.</p>
        </div>`;
      return;
    }
    if (!hotspots.topFiles || hotspots.topFiles.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><p>No hotspot data available.</p></div>`;
      return;
    }

    const files = hotspots.topFiles;
    const maxComplexity = Math.max(1, ...files.map((f) => f.cyclomaticComplexity));
    const maxCommits = Math.max(1, ...files.map((f) => f.commitCount));

    const rows = files
      .map(
        (h) => `
      <tr>
        <td class="mono">${this.escape(h.path)}</td>
        <td class="mono">${h.cyclomaticComplexity}</td>
        <td class="mono">${h.commitCount}</td>
        <td>
          <div class="hotspot-bar-cell">
            <div class="hotspot-bar-track">
              <div class="hotspot-bar-fill" style="width:${h.hotspotScore}%;background:${
                h.hotspotScore > 50 ? "#F97066" : "#F5A524"
              }"></div>
            </div>
            <span class="mono">${h.hotspotScore.toFixed(1)}</span>
          </div>
        </td>
        <td class="formula">(${h.cyclomaticComplexity}/${maxComplexity}) × (${h.commitCount}/${maxCommits}) × 100</td>
      </tr>`,
      )
      .join("");

    wrap.innerHTML = `
      <div class="panel">
        <table id="hotspots-table">
          <thead><tr><th>File</th><th>Complexity</th><th>Commits</th><th>Score</th><th>Formula</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  renderViolations() {
    const violations = this.jsonData?.violations || [];
    const { severity, language, search } = this.violationFilters;
    const q = search.toLowerCase();

    const filtered = violations.filter(
      (v) =>
        (severity === "all" || v.severity === severity) &&
        (language === "all" || v.language === language) &&
        (q === "" || v.path.toLowerCase().includes(q) || v.ruleId.toLowerCase().includes(q)),
    );

    const tbody = document.querySelector("#violations-table tbody");
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr class="no-data"><td colspan="5">No violations match current filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((v) => {
        const sevColor = SEV_COLOR[v.severity] || "#8B92A3";
        return `
        <tr>
          <td><span class="severity-pill severity-${v.severity}" style="color:${sevColor}">${v.severity}</span></td>
          <td class="mono" style="font-size:12px">${this.escape(v.ruleId)}</td>
          <td>
            <span class="mono" style="font-size:12.5px">${this.escape(v.path)}</span>
            <span class="lang-tag">${LANG_LABEL[v.language] || v.language}</span>
          </td>
          <td class="mono text-faint">${v.line}</td>
          <td style="max-width:380px" title="${this.escape(v.message)}">${this.escape(this.truncate(v.message, 90))}</td>
        </tr>`;
      })
      .join("");
  }

  renderDependencies(files) {
    files = files || [];
    const wrap = document.getElementById("dependencies-panel-wrap");
    const withDeps = files.filter(
      (f) => f.dependencies && (f.dependencies.fanOut > 0 || f.dependencies.fanIn > 0),
    );

    if (withDeps.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <p>No cross-file dependencies detected.</p>
          <p class="hint">Dependencies appear when files import/include other analyzed files.</p>
        </div>`;
      return;
    }

    const rows = withDeps
      .map(
        (f) => `
      <tr>
        <td class="mono">${this.escape(f.path)}</td>
        <td class="mono text-muted">${f.dependencies.fanOut || 0}</td>
        <td class="mono text-muted">${f.dependencies.fanIn || 0}</td>
        <td class="text-muted">${(f.dependencies.dependsOn || []).map((d) => this.escape(d)).join(", ")}</td>
        <td class="text-muted">${(f.dependencies.dependedOnBy || []).map((d) => this.escape(d)).join(", ")}</td>
      </tr>`,
      )
      .join("");

    wrap.innerHTML = `
      <div class="panel">
        <table id="deps-table">
          <thead><tr><th>File</th><th>Fan-out</th><th>Fan-in</th><th>Depends on</th><th>Depended on by</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  renderFiles(searchTerm) {
    const allFiles = this.jsonData?.files || [];
    const files = allFiles.filter((f) =>
      f.path.toLowerCase().includes((searchTerm || "").toLowerCase()),
    );
    const tbody = document.querySelector("#files-table tbody");
    if (!tbody) return;

    if (files.length === 0) {
      tbody.innerHTML = `<tr class="no-data"><td colspan="6">No files match your search.</td></tr>`;
      return;
    }

    tbody.innerHTML = files
      .map(
        (f) => `
      <tr data-path="${this.escape(f.path)}">
        <td class="mono">${this.escape(f.path)}</td>
        <td class="mono text-muted">${this.formatNumber(f.totalLines)}</td>
        <td class="mono text-muted">${f.functionCount || 0}</td>
        <td class="mono text-muted">${f.classCount || 0}</td>
        <td class="mono text-muted">${f.cyclomaticComplexity}</td>
        <td class="mono text-muted">${f.todoCount || 0}</td>
      </tr>`,
      )
      .join("");

    tbody.querySelectorAll("tr[data-path]").forEach((row) => {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const path = row.dataset.path;
        const metrics = allFiles.find((f) => f.path === path);
        this.showFileDetail(path, metrics);
      });
    });
  }

  showFileDetail(path, metrics) {
    if (!metrics) return;
    const root = document.getElementById("detail-root");
    const rows = [
      ["Total lines", this.formatNumber(metrics.totalLines)],
      ["Blank lines", this.formatNumber(metrics.blankLines)],
      ["Comment lines", this.formatNumber(metrics.commentLines)],
      ["Code lines", this.formatNumber(metrics.codeLines)],
      ["Functions", metrics.functionCount || 0],
      ["Classes", metrics.classCount || 0],
      ["Variables", metrics.variableCount || 0],
      ["Includes", metrics.includeCount || 0],
      ["Loops", metrics.loopCount || 0],
      ["Conditions", metrics.conditionCount || 0],
      ["Try/catch", metrics.tryCatchCount || 0],
      ["Max nesting", metrics.maxNestingDepth],
      ["Cyclomatic complexity", metrics.cyclomaticComplexity],
      ["TODOs", metrics.todoCount || 0],
    ];

    root.innerHTML = `
      <div class="detail-overlay" id="detail-overlay"></div>
      <div class="detail-panel">
        <div class="detail-panel-head">
          <span class="detail-panel-title">${this.escape(path)}</span>
          <button class="detail-close" id="detail-close">×</button>
        </div>
        ${rows
          .map(
            ([label, value]) => `
          <div class="detail-row">
            <span class="detail-row-label">${label}</span>
            <span class="detail-row-value">${value}</span>
          </div>`,
          )
          .join("")}
      </div>`;

    const close = () => {
      root.innerHTML = "";
    };
    document.getElementById("detail-overlay").addEventListener("click", close);
    document.getElementById("detail-close").addEventListener("click", close);
  }

  /* ------------------------------------------------------------------ */
  /* Streak                                                              */
  /* ------------------------------------------------------------------ */

  updateStreak() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastAnalysisDate !== today) {
      this.analysisStreak = this.lastAnalysisDate ? this.analysisStreak + 1 : 1;
      this.lastAnalysisDate = today;
      localStorage.setItem("rs-last-analysis", today);
      localStorage.setItem("rs-streak", String(this.analysisStreak));
    }
    const msg = document.getElementById("streak-message");
    const vis = document.getElementById("streak-visual");
    if (msg && vis) {
      const days = this.analysisStreak === 1 ? "day" : "days";
      msg.textContent = `You've analyzed code ${this.analysisStreak} ${days} in a row.`;
      vis.textContent = "●".repeat(Math.min(this.analysisStreak, 5));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  formatNumber(num) {
    return (num ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  truncate(str, len) {
    return str.length > len ? str.slice(0, len - 1) + "…" : str;
  }

  escape(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.repoSightDashboard = new RepoSightDashboard();
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RepoSightDashboard };
}
