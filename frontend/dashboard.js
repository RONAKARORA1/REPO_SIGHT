/* ==========================================================================
   repo-sight dashboard — client-side logic
   Reads ?scan=<id> from the URL and polls GET /api/scans/:id until the
   scan is COMPLETED/FAILED, then renders { project, files, hotspots,
   violations }. With no ?scan= param it renders the "start a new scan"
   form, which POSTs to /api/analyze and redirects to ?scan=<id>.
   ========================================================================== */

const GRADE_COLOR = { A: '#5eead4', B: '#5eead4', C: '#f5a524', D: '#f5a524', F: '#f97066' };
const GAUGE_RADIUS = 54;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const LONG_FUNCTION_THRESHOLD = 100; // matches cpp/py/java-long-*-function rule

const PANEL_ID = {
    overview: 'overview-panel',
    hotspots: 'hotspots-panel-wrap',
    violations: 'violations-panel-wrap',
    dependencies: 'dependencies-panel-wrap',
    files: 'files-panel-wrap',
};

const PAGE_TITLE = {
    overview: 'Overview',
    hotspots: 'Hotspots',
    violations: 'Violations',
    dependencies: 'Dependencies',
    files: 'Files',
};

class RepoSightDashboard {
    constructor() {
        this.jsonData = null;
        this.meta = { projectName: '', scanId: '', createdAt: '' };
        this.activeTab = 'overview';
        this.violationFilters = { severity: 'all', language: 'all', search: '' };
        this.lastAnalysisDate = localStorage.getItem('rs-last-analysis');
        this.analysisStreak = parseInt(localStorage.getItem('rs-streak') || '0', 10);

        this.init();
    }

    init() {
        this.bindStaticEvents();
        this.loadReport();
        this.updateStreakDisplay();
    }

    /* -----------------------------------------------------------------
       Small DOM helpers (defensive -- never throw if markup drifts)
       ----------------------------------------------------------------- */
    $(id) {
        return document.getElementById(id);
    }

    setText(id, value) {
        const el = this.$(id);
        if (el) el.textContent = value;
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    formatNumber(num) {
        return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    shortenPath(path) {
        if (!path) return '';
        if (path.length <= 34) return path;
        return '\u2026' + path.slice(-34);
    }

    truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.slice(0, len - 1) + '\u2026' : str;
    }

    /* -----------------------------------------------------------------
       Static event bindings (nav, rerun, filters, search) -- these
       elements exist in index.html from page load, unlike the report
       tables/panels which only get their listeners once data renders.
       ----------------------------------------------------------------- */
    bindStaticEvents() {
        // Sidebar nav -- was previously wired to a ".tab-btn" class that
        // doesn't exist in the markup (nav items use ".nav-item"), so
        // every click on Hotspots/Violations/Dependencies/Files silently
        // did nothing and only Overview was ever reachable.
        document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        const rerunBtn = this.$('rerun-btn');
        if (rerunBtn) {
            rerunBtn.addEventListener('click', () => window.location.reload());
        }

        document.querySelectorAll('.filter-btn[data-severity]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn[data-severity]').forEach(b =>
                    b.classList.toggle('active', b === btn)
                );
                this.violationFilters.severity = btn.dataset.severity;
                this.renderViolations();
            });
        });

        const langSelect = this.$('filter-language');
        if (langSelect) {
            langSelect.addEventListener('change', e => {
                this.violationFilters.language = e.target.value;
                this.renderViolations();
            });
        }

        const violationSearch = this.$('violation-search');
        if (violationSearch) {
            violationSearch.addEventListener('input', e => {
                this.violationFilters.search = e.target.value.toLowerCase();
                this.renderViolations();
            });
        }

        const fileSearch = this.$('file-search');
        if (fileSearch) {
            fileSearch.addEventListener('input', e => this.filterFiles(e.target.value));
        }
    }

    switchTab(tabName) {
        if (!tabName || !PANEL_ID[tabName]) return;
        this.activeTab = tabName;

        document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === PANEL_ID[tabName]);
        });

        this.setText('page-title', PAGE_TITLE[tabName] || tabName);
    }

    /* -----------------------------------------------------------------
       Entry point -- either poll an existing scan or show the "start a
       new scan" form.
       ----------------------------------------------------------------- */
    loadReport() {
        const scanId = new URLSearchParams(window.location.search).get('scan');
        if (!scanId) {
            this.renderNewScanForm();
            return;
        }

        this.meta.scanId = scanId;
        this.showLoadingState();
        this.pollScan(scanId);
    }

    pollScan(scanId, attempt = 0) {
        const poll = async at => {
            try {
                const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`);
                const data = await res.json().catch(() => ({}));

                // The API always answers 200 (even "not found"), signalling
                // state through the body's `status` field instead of the
                // HTTP status code -- so lag right after submission shows
                // up as status: "FAILED" with a "Scan not found" message,
                // not a 404. Retry that specific case a few times before
                // treating it as a real failure.
                const notFoundYet =
                    data.status === 'FAILED' &&
                    /not found/i.test(data.errorMessage || '') &&
                    at < 6;
                if (notFoundYet) {
                    setTimeout(() => poll(at + 1), 2000);
                    return;
                }

                if (!res.ok && data.status === undefined) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const status = data.status || (data.project ? 'COMPLETED' : 'PROCESSING');

                if (status === 'QUEUED' || status === 'PROCESSING') {
                    const pct = data.totalFiles > 0
                        ? Math.round((data.processedFiles / data.totalFiles) * 100)
                        : null;
                    this.updateLoadingProgress(pct);
                    setTimeout(() => poll(0), 3000);
                    return;
                }

                if (status === 'FAILED') {
                    this.showError(data.errorMessage || 'Analysis failed.');
                    return;
                }

                if (status === 'COMPLETED') {
                    this.meta.projectName = data.projectName || '';
                    this.meta.createdAt = data.createdAt || '';
                    this.jsonData = {
                        project: data.project || {},
                        files: data.files || [],
                        hotspots: data.hotspots || { gitAvailable: false, topFiles: [] },
                        violations: data.violations || [],
                    };
                    this.hideLoadingState();
                    this.populateReport();
                    return;
                }

                this.showError(`Unknown scan status: ${status}`);
            } catch (err) {
                console.error('Polling error:', err);
                if (at < 3) {
                    setTimeout(() => poll(at + 1), 3000);
                } else {
                    this.showError(`Could not load report: ${err.message}`);
                }
            }
        };

        poll(attempt);
    }

    /* -----------------------------------------------------------------
       New-scan form (no ?scan= in the URL)
       ----------------------------------------------------------------- */
    renderNewScanForm() {
        const loadingState = this.$('loading-state');
        if (!loadingState) return;

        loadingState.innerHTML = `
            <div class="new-scan-panel">
                <h2>Analyze a GitHub repository</h2>
                <p>Paste a public repo URL to scan it for complexity, hotspots, and rule violations.</p>
                <form id="new-scan-form">
                    <input type="text" id="new-scan-url" placeholder="https://github.com/owner/repo" autocomplete="off" />
                    <button type="submit" class="btn-primary" id="new-scan-submit">Analyze</button>
                </form>
                <p class="new-scan-error hidden" id="new-scan-error"></p>
            </div>
        `;

        const form = this.$('new-scan-form');
        const urlInput = this.$('new-scan-url');
        const submitBtn = this.$('new-scan-submit');
        const errorEl = this.$('new-scan-error');

        form.addEventListener('submit', async e => {
            e.preventDefault();
            const repoUrl = urlInput.value.trim();
            if (!repoUrl) return;

            errorEl.classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Analyzing\u2026';

            try {
                const res = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repoUrl }),
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.scanId) {
                    throw new Error(data.error || `HTTP ${res.status}`);
                }

                window.location.search = `?scan=${encodeURIComponent(data.scanId)}`;
            } catch (err) {
                errorEl.textContent = err.message || 'Could not start analysis.';
                errorEl.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Analyze';
            }
        });
    }

    /* -----------------------------------------------------------------
       Loading / error state
       ----------------------------------------------------------------- */
    showLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.remove('hidden');
        if (reportContent) reportContent.classList.add('hidden');
        this.setText('loading-message', 'Starting analysis\u2026');
        this.setText('loading-progress', '');
        this.setText('loading-tip', 'Tip: hotspot score = complexity \u00d7 commit churn \u2014 the files most worth reviewing first.');
    }

    updateLoadingProgress(pct) {
        this.setText('loading-message', 'Analyzing source files\u2026');
        this.setText('loading-progress', pct === null ? '' : `${pct}%`);
    }

    hideLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.add('hidden');
        if (reportContent) reportContent.classList.remove('hidden');
    }

    // Keeps loading-state visible (with report-content hidden) so the
    // error message is actually seen, instead of hiding the element the
    // message was written into.
    showError(message) {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (reportContent) reportContent.classList.add('hidden');
        if (loadingState) {
            loadingState.classList.remove('hidden');
            loadingState.innerHTML = `
                <div class="error-panel">
                    <h2>Analysis failed</h2>
                    <p>${this.escapeHtml(message)}</p>
                </div>
            `;
        }
    }

    /* -----------------------------------------------------------------
       Report rendering
       ----------------------------------------------------------------- */
    populateReport() {
        if (!this.jsonData) return;

        this.populateOverview(this.jsonData.project || {});
        this.renderHotspots();
        this.renderViolations();
        this.renderDependencies();
        this.renderFiles();
        this.updateSidebarMeta();
        this.updateStreak();
    }

    updateSidebarMeta() {
        const project = this.jsonData.project || {};
        this.setText('sidebar-project', this.meta.projectName || '\u2014');
        this.setText('sidebar-scan', this.meta.scanId ? `scan ${this.meta.scanId.slice(0, 8)}` : '');
        this.setText(
            'page-subtitle',
            `${this.formatNumber(project.filesAnalyzed)} files \u00b7 ${this.formatNumber(project.totalLines)} lines analyzed`
        );

        const violations = this.jsonData.violations || [];
        const hotspots = this.jsonData.hotspots || {};
        this.setText('nav-count-hotspots', hotspots.gitAvailable ? (hotspots.topFiles || []).length : '');
        this.setText('nav-count-violations', violations.length || '');
        this.setText('nav-count-files', (this.jsonData.files || []).length || '');
    }

    populateOverview(project) {
        const healthScore = Math.round(project.healthScore || 0);
        const healthGrade = project.healthGrade || 'F';

        this.setGauge(healthScore, healthGrade);
        this.setText('health-score-value', `${healthScore}`);
        this.setText('health-grade', `GRADE ${healthGrade}`);

        const violations = this.jsonData.violations || [];
        const bySeverity = sev => violations.filter(v => v.severity === sev).length;
     
        this.setText('count-warning', bySeverity('warning'));
        this.setText('count-info', bySeverity('info'));

        this.setText('function-count', project.functionCount || 0);
        this.setText('complexity-count', project.cyclomaticComplexity || 0);
        this.setText('todo-count', project.todoCount || 0);
        this.setText('nesting-depth', project.maxNestingDepth || 0);

        const longestName = project.longestFunctionName || '\u2014';
        const longestLines = project.longestFunctionLines || 0;
        this.setText('longest-fn-name', longestName);
        this.setText('longest-fn-lines', longestLines ? `${longestLines} lines` : '');
        const bar = this.$('longest-fn-bar');
        if (bar) {
            const pct = Math.max(0, Math.min(100, (longestLines / LONG_FUNCTION_THRESHOLD) * 100));
            bar.style.width = `${pct}%`;
        }
    }

    setGauge(score, grade) {
        const fill = this.$('gauge-fill');
        if (!fill) return;
        const pct = Math.max(0, Math.min(100, score)) / 100;
        fill.style.strokeDasharray = `${GAUGE_CIRCUMFERENCE}`;
        fill.style.strokeDashoffset = `${GAUGE_CIRCUMFERENCE * (1 - pct)}`;
        fill.style.stroke = GRADE_COLOR[grade] || GRADE_COLOR.F;
    }

    renderHotspots() {
        const hotspots = this.jsonData.hotspots || {};
        const wrap = this.$('hotspots-panel-wrap');
        const table = this.$('hotspots-table');

        if (!hotspots.gitAvailable) {
            if (table) table.classList.add('hidden');
            this.renderEmptyState(
                wrap,
                'No git history available',
                'This scan\u2019s source was fetched as a tarball snapshot with no git history, so hotspot scoring (complexity \u00d7 commit churn) has nothing to rank against.'
            );
            return;
        }

        const files = hotspots.topFiles || [];
        if (files.length === 0) {
            if (table) table.classList.add('hidden');
            this.renderEmptyState(wrap, 'No hotspot data', 'No files had both complexity and commit history to score.');
            return;
        }
        if (table) table.classList.remove('hidden');
        this.clearEmptyState(wrap);

        const tbody = document.querySelector('#hotspots-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const maxComplexity = Math.max(1, ...files.map(f => f.cyclomaticComplexity || 0));
        const maxCommits = Math.max(1, ...files.map(f => f.commitCount || 0));

        files.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.escapeHtml(this.shortenPath(h.path))}</td>
                <td>${h.cyclomaticComplexity}</td>
                <td>${h.commitCount}</td>
                <td>${(h.hotspotScore || 0).toFixed(1)}</td>
                <td>(${h.cyclomaticComplexity}/${maxComplexity}) \u00d7 (${h.commitCount}/${maxCommits}) \u00d7 100</td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderViolations() {
        if (!this.jsonData) return;
        const all = this.jsonData.violations || [];
        const { severity, language, search } = this.violationFilters;

        const filtered = all
            .filter(v => severity === 'all' || v.severity === severity)
            .filter(v => language === 'all' || v.language === language)
            .filter(v => {
                if (!search) return true;
                return (
                    (v.path || '').toLowerCase().includes(search) ||
                    (v.ruleId || '').toLowerCase().includes(search) ||
                    (v.message || '').toLowerCase().includes(search)
                );
            });

        const tbody = document.querySelector('#violations-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (filtered.length === 0) {
            const msg = all.length === 0 ? 'No violations detected.' : 'No violations match the current filters.';
            tbody.innerHTML = `<tr class="no-data"><td colspan="5">${this.escapeHtml(msg)}</td></tr>`;
            return;
        }

        filtered.forEach(v => {
            const tr = document.createElement('tr');
            const safeMessage = this.escapeHtml(v.message || '');
            const sev = this.escapeHtml(v.severity || '');
            tr.innerHTML = `
                <td><span class="severity-pill severity-${sev}">${sev}</span></td>
                <td><code>${this.escapeHtml(v.ruleId)}</code><span class="lang-tag">${this.escapeHtml(v.language)}</span></td>
                <td>${this.escapeHtml(this.shortenPath(v.path))}</td>
                <td>${v.line}</td>
                <td title="${safeMessage}">${this.escapeHtml(this.truncate(v.message || '', 70))}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderDependencies() {
        const files = this.jsonData.files || [];
        const wrap = this.$('dependencies-panel-wrap');
        const table = this.$('deps-table');
        const hasDeps = files.some(f => f.dependencies && (f.dependencies.fanOut > 0 || f.dependencies.fanIn > 0));

        if (!hasDeps) {
            if (table) table.classList.add('hidden');
            this.renderEmptyState(
                wrap,
                'No dependencies detected',
                'Dependencies show up when scanned files #include/import other files in the same project.'
            );
            return;
        }
        if (table) table.classList.remove('hidden');
        this.clearEmptyState(wrap);

        const tbody = document.querySelector('#deps-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        files.forEach(f => {
            if (!f.dependencies) return;
            const deps = f.dependencies;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.escapeHtml(this.shortenPath(f.path))}</td>
                <td>${deps.fanOut || 0}</td>
                <td>${deps.fanIn || 0}</td>
                <td>${this.escapeHtml((deps.dependsOn || []).join(', '))}</td>
                <td>${this.escapeHtml((deps.dependedOnBy || []).join(', '))}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderFiles() {
        const files = this.jsonData.files || [];
        this._allFiles = files;

        const tbody = document.querySelector('#files-table tbody');
        if (!tbody) return;

        if (files.length === 0) {
            tbody.innerHTML = `<tr class="no-data"><td colspan="6">No files analyzed.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td>${this.escapeHtml(this.shortenPath(f.path))}</td>
                <td>${this.formatNumber(f.totalLines || 0)}</td>
                <td>${f.functionCount || 0}</td>
                <td>${f.classCount || 0}</td>
                <td>${f.cyclomaticComplexity || 0}</td>
                <td>${f.todoCount || 0}</td>
            `;
            tr.addEventListener('click', () => this.showFileDetails(f));
            tbody.appendChild(tr);
        });
    }

    renderEmptyState(panelWrap, title, body) {
        if (!panelWrap) return;
        let el = panelWrap.querySelector('.panel-empty-state');
        if (!el) {
            el = document.createElement('div');
            el.className = 'panel panel-empty-state empty-state';
            panelWrap.appendChild(el);
        }
        el.innerHTML = `<p>${this.escapeHtml(title)}</p><p class="hint">${this.escapeHtml(body)}</p>`;
        el.classList.remove('hidden');
    }

    clearEmptyState(panelWrap) {
        if (!panelWrap) return;
        const el = panelWrap.querySelector('.panel-empty-state');
        if (el) el.classList.add('hidden');
    }

    /* -----------------------------------------------------------------
       File search (Files tab)
       ----------------------------------------------------------------- */
    filterFiles(searchTerm) {
        const tbody = document.querySelector('#files-table tbody');
        if (!tbody) return;
        const term = searchTerm.toLowerCase();
        Array.from(tbody.getElementsByTagName('tr')).forEach(row => {
            const fileName = row.cells[0]?.textContent || '';
            row.style.display = fileName.toLowerCase().includes(term) ? '' : 'none';
        });
    }

    /* -----------------------------------------------------------------
       File detail slide-over
       ----------------------------------------------------------------- */
    showFileDetails(f) {
        this.closeFileDetails();

        const overlay = document.createElement('div');
        overlay.className = 'detail-overlay';
        overlay.addEventListener('click', () => this.closeFileDetails());

        const rows = [
            ['Total lines', this.formatNumber(f.totalLines || 0)],
            ['Blank lines', this.formatNumber(f.blankLines || 0)],
            ['Comment lines', this.formatNumber(f.commentLines || 0)],
            ['Code lines', this.formatNumber(f.codeLines || 0)],
            ['Functions', f.functionCount || 0],
            ['Classes', f.classCount || 0],
            ['Variables', f.variableCount || 0],
            ['Loops', f.loopCount || 0],
            ['Conditions', f.conditionCount || 0],
            ['Try/catch', f.tryCatchCount || 0],
            ['Max nesting', f.maxNestingDepth || 0],
            ['Cyclomatic complexity', f.cyclomaticComplexity || 0],
            ['TODOs', f.todoCount || 0],
        ];

        const panel = document.createElement('div');
        panel.className = 'detail-panel';
        panel.innerHTML = `
            <div class="detail-panel-head">
                <div class="detail-panel-title">${this.escapeHtml(f.path)}</div>
                <button class="detail-close" aria-label="Close">&times;</button>
            </div>
            ${rows
                .map(
                    ([label, value]) =>
                        `<div class="detail-row"><span class="detail-row-label">${this.escapeHtml(label)}</span><span class="detail-row-value">${this.escapeHtml(value)}</span></div>`
                )
                .join('')}
        `;
        panel.querySelector('.detail-close').addEventListener('click', () => this.closeFileDetails());

        const root = this.$('detail-root');
        if (!root) return;
        root.appendChild(overlay);
        root.appendChild(panel);
    }

    closeFileDetails() {
        const root = this.$('detail-root');
        if (root) root.innerHTML = '';
    }

    /* -----------------------------------------------------------------
       Streak
       ----------------------------------------------------------------- */
    updateStreak() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.lastAnalysisDate !== today) {
            this.analysisStreak = this.lastAnalysisDate ? this.analysisStreak + 1 : 1;
            this.lastAnalysisDate = today;
            localStorage.setItem('rs-last-analysis', today);
            localStorage.setItem('rs-streak', String(this.analysisStreak));
        }
        this.updateStreakDisplay();
    }

    updateStreakDisplay() {
        const msg = this.$('streak-message');
        const vis = this.$('streak-visual');
        if (!msg || !vis) return;
        if (this.analysisStreak > 0) {
            msg.textContent = `You've analyzed code ${this.analysisStreak} ${this.analysisStreak === 1 ? 'day' : 'days'} in a row!`;
            vis.textContent = '\u{1F525}'.repeat(Math.min(this.analysisStreak, 5));
        }
    }
}

/* -----------------------------------------------------------------
   Bootstrap
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    window.repoSightDashboard = new RepoSightDashboard();
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RepoSightDashboard };
}
