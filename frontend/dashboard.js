/* ==========================================================================
   CMA Report Dashboard - client-side logic
   Features: theme/sound toggle, tabs, humor, engagement, progress bar,
   polling for scan status, report rendering.
   ========================================================================== */

class CMADashboard {
    constructor() {
        // ---- persisted UI state -------------------------------------------------
        this.theme = localStorage.getItem('cma-theme') || 'modern';
        this.soundEnabled = localStorage.getItem('cma-sound') !== 'false';
        this.lastAnalysisDate = localStorage.getItem('cma-last-analysis');
        this.analysisStreak = parseInt(localStorage.getItem('cma-streak') || '0', 10);

        // ---- UI references ------------------------------------------------------
        this.progressBar = null;

        // ---- data ---------------------------------------------------------------
        this.jsonData = null;

        // ---- static pools for humour / facts ------------------------------------
        this.devJokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs!",
            "There are 10 types of people in the world: those who understand binary, and those who don't.",
            "Debugging: Removing the needles from the haystack.",
            "Why did the programmer quit his job? He didn't get arrays.",
            "A SQL query walks into a bar and sees two tables. He walks up and says 'Can I join you?'",
            "Programmers don't byte, they nibble a bit.",
            "The best thing about a boolean is even if you are wrong, you are only off by a bit."
        ];
        this.devFacts = [
            "The first computer bug was an actual moth found in a Harvard Mark II computer in 1947.",
            "GitHub was originally called 'Logical Awesome' during early development.",
            "The first 1GB hard drive weighed over 500 pounds and cost $40,000 in 1980.",
            "Python was named after Monty Python, not the snake.",
            "The first computer programmer was Ada Lovelace in 1843.",
            "Java was originally called 'Oak' after a tree outside James Gosling's office.",
            "The term 'debugging' was coined by Grace Hopper when she removed a moth from a computer.",
            "The first computer virus was created in 1983 and was called the 'Elk Cloner'."
        ];
        this.healthScoreMemes = [
            { min: 90, max: 100, text: "Your code is cleaner than a junior dev's resume!" },
            { min: 80, max: 89,  text: "Solid work! Your code would make a senior dev nod approvingly." },
            { min: 70, max: 79,  text: "Decent! Your code is like a well-commented Stack Overflow answer." },
            { min: 60, max: 69,  text: "Getting there! Your code needs more comments than a politician's speech." },
            { min: 50, max: 59,  text: "Uh oh... Your code has more surprises than a legacy JavaScript project." },
            { min: 40, max: 49,  text: "Yikes! Time to refactor before your code becomes sentient and vengeful." },
            { min: 30, max: 39,  text: "Yikes yikes! Your cyclomatic complexity is trying to escape." },
            { min: 0,  max: 29,  text: "Holy spaghetti! This code needs more structure than a toddler's LEGO project." }
        ];

        this.init();
    }

    /* -----------------------------------------------------------------
       Initialisation
       ----------------------------------------------------------------- */
    init() {
        this.applyTheme();
        this.bindEvents();
        this.loadReport();
        this.playKonamiListener();
        this.updateStreakDisplay();
        this.rotateLoadingMessage();
        this.initTypingTest();
        this.populateDevFact();
    }

    /* -----------------------------------------------------------------
       Small DOM helpers (defensive - never throw if markup drifts)
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

    /* -----------------------------------------------------------------
       Theme handling
       ----------------------------------------------------------------- */
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const themeSelect = this.$('theme');
        if (themeSelect) themeSelect.value = this.theme;
    }

    bindEvents() {
        const themeSelect = this.$('theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', e => {
                this.theme = e.target.value;
                localStorage.setItem('cma-theme', this.theme);
                this.applyTheme();
            });
        }

        const soundToggle = this.$('sound-toggle');
        if (soundToggle) {
            soundToggle.addEventListener('change', e => {
                this.soundEnabled = e.target.checked;
                localStorage.setItem('cma-sound', this.soundEnabled ? 'true' : 'false');
            });
        }

        const fileSearch = this.$('file-search');
        if (fileSearch) {
            fileSearch.addEventListener('input', e => this.filterFiles(e.target.value));
        }

        // Violation filters re-render the violations table on change
        ['filter-info', 'filter-warning', 'filter-language'].forEach(id => {
            const el = this.$(id);
            if (el) {
                el.addEventListener('change', () => {
                    if (this.jsonData) this.populateViolations(this.jsonData.violations || []);
                });
            }
        });

        // Tab switching -- previously missing entirely, so only Overview
        // was ever reachable no matter what the user clicked.
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
    }

    switchTab(tabName) {
        if (!tabName) return;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-panel`);
        });
    }

    /* -----------------------------------------------------------------
       Load report - polling loop
       ----------------------------------------------------------------- */
    loadReport() {
        const scanId = new URLSearchParams(window.location.search).get('scan');
        if (!scanId) {
            this.showError('No scan ID provided. Use ?scan=<id>');
            return;
        }

        this.showLoadingState();

        const poll = async (attempt = 0) => {
            try {
                const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`);

                if (res.status === 404) {
                    // Storage may lag slightly right after a scan is submitted.
                    if (attempt < 8) {
                        setTimeout(() => poll(attempt + 1), 2500);
                    } else {
                        this.showError('Scan not found. The link may be invalid or expired.');
                    }
                    return;
                }

                if (!res.ok) {
                    const errTxt = await res.text().catch(() => '');
                    throw new Error(`HTTP ${res.status}${errTxt ? `: ${errTxt}` : ''}`);
                }

                const data = await res.json();

                // Support both a status-driven contract ({status: 'QUEUED'|...})
                // and an endpoint that just returns the finished report with
                // no status field at all.
                const status = data.status || (data.project ? 'COMPLETED' : 'PROCESSING');

                if (status === 'QUEUED' || status === 'PROCESSING') {
                    const pct = data.totalFiles > 0
                        ? Math.round((data.processedFiles / data.totalFiles) * 100)
                        : 0;
                    this.updateProgressBar(pct);
                    setTimeout(() => poll(0), 3000);
                    return;
                }

                if (status === 'FAILED') {
                    this.hideProgressBar();
                    this.showError(data.errorMessage || 'Analysis failed');
                    return;
                }

                if (status === 'COMPLETED') {
                    this.hideProgressBar();
                    this.jsonData = {
                        project: data.project || {},
                        files: data.files || [],
                        hotspots: data.hotspots || { gitAvailable: false, topFiles: [] },
                        violations: data.violations || []
                    };
                    this.hideLoadingState();
                    this.populateReport();
                    return;
                }

                this.showError(`Unknown scan status: ${status}`);
            } catch (err) {
                console.error('Polling error:', err);
                if (attempt < 3) {
                    setTimeout(() => poll(attempt + 1), 3000);
                } else {
                    this.hideProgressBar();
                    this.showError(`Could not load report: ${err.message}`);
                }
            }
        };

        poll();
    }

    /* -----------------------------------------------------------------
       UI state helpers
       ----------------------------------------------------------------- */
    showLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.remove('hidden');
        if (reportContent) reportContent.classList.add('hidden');
        this.setText('loading-message', this.getRandomJoke());
    }

    hideLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.add('hidden');
        if (reportContent) reportContent.classList.remove('hidden');
    }

    // Bug fix: this used to be called right after hideLoadingState(), which
    // hid the very element the message was written into -- the user saw a
    // blank report-content section instead of an error. Now showError always
    // keeps loading-state visible and report-content hidden, regardless of
    // what was called before it.
    showError(message) {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (reportContent) reportContent.classList.add('hidden');
        if (loadingState) {
            loadingState.classList.remove('hidden');
            loadingState.innerHTML = `
                <div class="error-message">
                    <h2>Oops!</h2>
                    <p>${this.escapeHtml(message)}</p>
                    <p>Tip: Make sure you ran the analysis with a valid scan link.</p>
                </div>
            `;
        }
    }

    /* -----------------------------------------------------------------
       Progress bar
       ----------------------------------------------------------------- */
    updateProgressBar(percent) {
        if (!this.progressBar) {
            const container = document.createElement('div');
            container.style.width = '100%';
            container.style.backgroundColor = '#e0e0e0';
            container.style.borderRadius = '4px';
            container.style.overflow = 'hidden';
            container.style.height = '20px';
            container.style.marginTop = '1rem';

            const bar = document.createElement('div');
            bar.style.width = '0%';
            bar.style.backgroundColor = '#0066cc';
            bar.style.height = '100%';
            bar.style.transition = 'width 0.3s ease';
            bar.id = 'cma-progress-bar';
            container.appendChild(bar);
            this.progressBar = bar;

            const reportContent = this.$('report-content');
            if (reportContent && reportContent.parentNode) {
                reportContent.parentNode.insertBefore(container, reportContent);
            }
        }
        this.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }

    hideProgressBar() {
        if (this.progressBar && this.progressBar.parentNode) {
            this.progressBar.parentNode.parentNode?.removeChild(this.progressBar.parentNode);
            this.progressBar = null;
        }
    }

    /* -----------------------------------------------------------------
       Report rendering
       ----------------------------------------------------------------- */
    populateReport() {
        if (!this.jsonData) return;

        this.populateOverview(this.jsonData.project || {});
        this.populateHotspots(this.jsonData.hotspots || {});
        this.populateViolations(this.jsonData.violations || []);
        this.populateDependencies(this.jsonData.files || []);
        this.populateFiles(this.jsonData.files || []);

        this.updateStreak();
    }

    populateOverview(project) {
        const healthScore = Math.round(project.healthScore || 0);
        const healthGrade = project.healthGrade || 'F';

        const gaugeFill = document.querySelector('.gauge-fill');
        if (gaugeFill) {
            gaugeFill.style.width = `${Math.min(healthScore, 100)}%`;
            const gradeColors = { A: '#4c1', B: '#97ca00', C: '#dfb317', D: '#fe7d37', F: '#e05d44' };
            gaugeFill.style.backgroundColor = gradeColors[healthGrade] || '#e05d44';
        }

        this.setText('health-score-value', `${healthScore}`);
        this.setText('health-grade', healthGrade);
        this.setText('health-score-numeric', healthScore);
        this.setText('health-grade-letter', healthGrade);

        const meme = this.healthScoreMemes.find(m => healthScore >= m.min && healthScore <= m.max);
        this.setText('health-score-meme', meme ? meme.text : '');

        this.setText('files-analyzed', project.filesAnalyzed || 0);
        this.setText('total-lines', this.formatNumber(project.totalLines || 0));
        this.setText('comment-lines', this.formatNumber(project.commentLines || 0));
        this.setText('function-count', project.functionCount || 0);
        this.setText('todo-count', project.todoCount || 0);
    }

    populateHotspots(hotspots) {
        const panel = this.$('hotspots-panel');

        if (!hotspots.gitAvailable) {
            if (panel) {
                panel.innerHTML = `
                    <p class="no-data">No git repository detected. Hotspot analysis requires a git repo.</p>
                    <p class="no-data-hint">Run CMA inside a git repository to see hotspot scores (complexity x churn).</p>
                `;
            }
            return;
        }

        // Bug fix: the server field is "topFiles", not "files"
        // (see ReportGenerator::writeHotspotsJson). Reading hotspots.files
        // meant this table was always empty even with real hotspot data.
        const files = hotspots.topFiles || [];
        if (files.length === 0) {
            if (panel) panel.innerHTML = `<p class="no-data">No hotspot data available.</p>`;
            return;
        }

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
                <td>
                    <div class="hotspot-details">
                        <p><strong>Path:</strong> ${this.escapeHtml(h.path)}</p>
                        <p><strong>Lines Added:</strong> ${this.formatNumber(h.linesAdded || 0)}</p>
                        <p><strong>Lines Deleted:</strong> ${this.formatNumber(h.linesDeleted || 0)}</p>
                        <p><strong>Hotspot Formula:</strong> (${h.cyclomaticComplexity}/${maxComplexity}) x (${h.commitCount}/${maxCommits}) x 100</p>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        const loading = this.$('hotspots-loading');
        if (loading) loading.classList.add('hidden');
    }

    populateViolations(violations) {
        const tbody = document.querySelector('#violations-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const showInfo = this.$('filter-info')?.checked ?? true;
        const showWarning = this.$('filter-warning')?.checked ?? true;
        const filterLang = this.$('filter-language')?.value ?? 'all';

        const filtered = violations
            .filter(v => (showInfo && v.severity === 'info') || (showWarning && v.severity === 'warning'))
            .filter(v => filterLang === 'all' || v.language === filterLang);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">No violations match current filters.</td></tr>';
        } else {
            filtered.forEach(v => {
                const tr = document.createElement('tr');
                const safeMessage = this.escapeHtml(v.message);
                tr.innerHTML = `
                    <td>${this.escapeHtml(this.shortenPath(v.path))}</td>
                    <td>${v.line}</td>
                    <td><code>${this.escapeHtml(v.ruleId)}</code></td>
                    <td title="${safeMessage}">${this.escapeHtml(this.truncate(v.message || '', 50))}</td>
                    <td class="severity-${this.escapeHtml(v.severity)}">${this.escapeHtml((v.severity || '').toUpperCase())}</td>
                `;
                tr.addEventListener('click', () => {
                    alert(`Rule Explanation:\n${v.message}\n\nFile: ${v.path}\nLine: ${v.line}`);
                });
                tbody.appendChild(tr);
            });
        }

        const loading = this.$('violations-loading');
        if (loading) loading.classList.add('hidden');
    }

    populateDependencies(files) {
        const hasDeps = files.some(f => f.dependencies && (f.dependencies.fanOut > 0 || f.dependencies.fanIn > 0));

        if (!hasDeps) {
            const panel = this.$('dependencies-panel');
            if (panel) {
                panel.innerHTML = `
                    <p class="no-data">No external dependencies detected.</p>
                    <p class="no-data-hint">Dependencies are shown when files import/include other files in your project.</p>
                `;
            }
            return;
        }

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

        const loading = this.$('deps-loading');
        if (loading) loading.classList.add('hidden');
    }

    populateFiles(files) {
        const tbody = document.querySelector('#files-table tbody');
        if (!tbody) return;

        if (files.length === 0) {
            const panel = this.$('files-panel');
            if (panel) panel.innerHTML = `<p class="no-data">No files analyzed.</p>`;
            return;
        }

        tbody.innerHTML = '';

        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.escapeHtml(this.shortenPath(f.path))}</td>
                <td>${this.formatNumber(f.totalLines || 0)}</td>
                <td>${f.functionCount || 0}</td>
                <td>${f.classCount || 0}</td>
                <td>${f.cyclomaticComplexity || 0}</td>
                <td>
                    <button class="details-btn" data-path="${this.escapeHtml(f.path)}">Details</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const path = e.target.getAttribute('data-path');
                const fileMetrics = files.find(f => f.path === path);
                this.showFileDetails(path, fileMetrics);
            });
        });
    }

    /* -----------------------------------------------------------------
       File search
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

    showFileDetails(path, metrics) {
        if (!metrics) return;
        const details = `
File: ${path}

Lines: ${this.formatNumber(metrics.totalLines || 0)}
Functions: ${metrics.functionCount || 0}
Classes: ${metrics.classCount || 0}
Cyclomatic Complexity: ${metrics.cyclomaticComplexity || 0}
TODO count: ${metrics.todoCount || 0}
Comment lines: ${this.formatNumber(metrics.commentLines || 0)}
Blank lines: ${this.formatNumber(metrics.blankLines || 0)}
        `;
        alert(details.trim());
    }

    /* -----------------------------------------------------------------
       Streak / achievement logic
       ----------------------------------------------------------------- */
    updateStreak() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.lastAnalysisDate !== today) {
            this.analysisStreak = this.lastAnalysisDate ? this.analysisStreak + 1 : 1;
            this.lastAnalysisDate = today;
            localStorage.setItem('cma-last-analysis', today);
            localStorage.setItem('cma-streak', this.analysisStreak);
        }
        this.updateStreakDisplay();
    }

    updateStreakDisplay() {
        const streakMsg = this.$('streak-message');
        const streakVis = this.$('streak-visual');
        if (streakMsg && streakVis) {
            streakMsg.textContent = `You've analysed code ${this.analysisStreak} ${this.analysisStreak === 1 ? 'day' : 'days'} in a row!`;
            streakVis.textContent = '\u{1F525}'.repeat(Math.min(this.analysisStreak, 5));
        }
    }

    /* -----------------------------------------------------------------
       Sound effects
       ----------------------------------------------------------------- */
    playSound(type) {
        if (!this.soundEnabled) return;
        const audioMap = { success: 'success-sound', error: 'error-sound', konami: 'konami-sound' };
        const el = this.$(audioMap[type]);
        if (el) {
            el.currentTime = 0;
            el.play().catch(() => {});
        }
    }

    /* -----------------------------------------------------------------
       Konami code easter egg
       ----------------------------------------------------------------- */
    playKonamiListener() {
        const konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; // up up down down left right left right B A
        let index = 0;
        window.addEventListener('keydown', e => {
            const key = e.keyCode || e.which;
            if (key === konami[index]) {
                index++;
                if (index === konami.length) {
                    this.playSound('konami');
                    alert('Konami code unlocked! You get a free coffee (virtually).');
                    index = 0;
                }
            } else {
                index = 0;
            }
        });
    }

    /* -----------------------------------------------------------------
       Rotate loading message while waiting
       ----------------------------------------------------------------- */
    rotateLoadingMessage() {
        setInterval(() => {
            const msgEl = this.$('loading-message');
            const loadingState = this.$('loading-state');
            if (msgEl && loadingState && !loadingState.classList.contains('hidden')) {
                msgEl.textContent = this.getRandomJoke();
            }
        }, 4000);
    }

    /* -----------------------------------------------------------------
       Mini-game: typing speed test (shown while waiting)
       ----------------------------------------------------------------- */
    initTypingTest() {
        const container = this.$('mini-game-container');
        if (!container) return;
        container.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Type this: "the quick brown fox jumps over the lazy dog"';
        input.style.width = '100%';
        input.style.padding = '0.5rem';
        input.style.marginTop = '0.5rem';

        const result = document.createElement('div');
        result.style.marginTop = '0.5rem';
        result.style.fontSize = '0.9rem';

        container.appendChild(input);
        container.appendChild(result);

        let startTime = null;
        input.addEventListener('input', () => {
            const target = 'the quick brown fox jumps over the lazy dog';
            const value = input.value;
            if (startTime === null && value.length > 0) startTime = Date.now();
            if (value === target) {
                const elapsed = (Date.now() - startTime) / 1000;
                const wpm = Math.round((target.split(' ').length / elapsed) * 60);
                result.textContent = `Done! ${wpm} WPM`;
                input.disabled = true;
            } else if (value.length > target.length) {
                result.textContent = 'Too long - start over';
                input.value = '';
                startTime = null;
            }
        });
    }

    populateDevFact() {
        const el = this.$('dev-fact');
        if (el) el.textContent = this.getRandomFact();
    }

    /* -----------------------------------------------------------------
       Helpers
       ----------------------------------------------------------------- */
    getRandomJoke() {
        return this.devJokes[Math.floor(Math.random() * this.devJokes.length)];
    }

    getRandomFact() {
        return this.devFacts[Math.floor(Math.random() * this.devFacts.length)];
    }

    shortenPath(path) {
        if (!path) return '';
        if (path.length <= 20) return path;
        return '\u2026' + path.slice(-20);
    }

    truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.slice(0, len - 1) + '\u2026' : str;
    }

    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
}

/* -----------------------------------------------------------------
   Bootstrap
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    window.cmaDashboard = new CMADashboard();
});

/* -----------------------------------------------------------------
   Export for testing
   ----------------------------------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CMADashboard };
}
