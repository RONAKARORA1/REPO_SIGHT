/* ==========================================================================
   CMA Report Dashboard – client‑side logic
   Features: theme/sound toggle, humour, engagement, progress bar,
   polling for batched analysis, report rendering.
   ========================================================================== */

class CMADashboard {
    constructor() {
        // ---- persisted UI state -------------------------------------------------
        this.theme = localStorage.getItem('cma-theme') || 'modern';
        this.soundEnabled = localStorage.getItem('cma-sound') !== 'false';
        this.lastAnalysisDate = localStorage.getItem('cma-last-analysis');
        this.analysisStreak = parseInt(localStorage.getItem('cma-streak') || '0');

        // ---- UI references ------------------------------------------------------
        this.progressBar = null;          // progress bar DOM element (created on demand)

        // ---- data ---------------------------------------------------------------
        this.jsonData = null;             // holds the final report when COMPLETED

        // ---- static pools for humour / facts ------------------------------------
        this.devJokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs!",
            "There are 10 types of people in the world: those who understand binary, and those who don't.",
            "Debugging: Removing the needles from the haystack.",
            "I told my wife she was drawing her eyebrows too high. She looked surprised.",
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
        this.loadingMessages = [
            "Analyzing your code's inner thoughts...",
            "Counting lines faster than a caffeinated developer...",
            "Detecting technical debt with extreme prejudice...",
            "Calculating your code's karma score...",
            "Sorting your functions by existential crisis level...",
            "Measuring cyclomatic complexity like it's a competitive sport...",
            "Searching for TODO comments like they're Easter eggs...",
            "Validating your code's life choices..."
        ];
        this.healthScoreMemes = [
            { min: 90, max: 100, text: "Your code is cleaner than a junior dev's resume!" },
            { min: 80, max: 89, text: "Solid work! Your code would make a senior dev nod approvingly." },
            { min: 70, max: 79, text: "Decent! Your code is like a well‑commented Stack Overflow answer." },
            { min: 60, max: 69, text: "Getting there! Your code needs more comments than a politician's speech." },
            { min: 50, max: 59, text: "Uh oh... Your code has more surprises than a legacy JavaScript project." },
            { min: 40, max: 49, text: "Yikes! Time to refactor before your code becomes sentient and vengeful." },
            { min: 30, max: 39, text: "Yikes yikes! Your cyclomatic complexity is trying to escape." },
            { min: 0, max: 29, text: "Holy spaghetti, Batman! This code needs more structure than a toddler's LEGO project." }
        ];

        this.init();
    }

    /* -----------------------------------------------------------------
       Initialisation – theme, sound, event listeners, first load
       ----------------------------------------------------------------- */
    init() {
        this.applyTheme();
        this.bindEvents();
        this.loadReport();                // reads ?scan=… from URL and starts polling
        this.playKonamiListener();
        this.updateStreakDisplay();
        this.rotateLoadingMessage();
        this.initTypingTest();
        this.populateDevFact();
    }

    /* -----------------------------------------------------------------
       Theme handling
       ----------------------------------------------------------------- */
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const themeSelect = document.getElementById('theme');
        if (themeSelect) themeSelect.value = this.theme;
    }

    bindEvents() {
        // Theme selector
        const themeSelect = document.getElementById('theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', e => {
                this.theme = e.target.value;
                localStorage.setItem('cma-theme', this.theme);
                this.applyTheme();
            });
        }

        // Sound toggle
        const soundToggle = document.getElementById('sound-toggle');
        if (soundToggle) {
            soundToggle.addEventListener('change', e => {
                this.soundEnabled = e.target.checked;
                localStorage.setItem('cma-sound', this.soundEnabled ? 'true' : 'false');
            });
        }

        // File search (in the Files tab)
        const fileSearch = document.getElementById('file-search');
        if (fileSearch) {
            fileSearch.addEventListener('input', e => this.filterFiles(e.target.value));
        }
    }

    /* -----------------------------------------------------------------
       Load report – polling loop
       ----------------------------------------------------------------- */
    loadReport() {
        const scanId = new URLSearchParams(window.location.search).get('scan');
        if (!scanId) {
            this.showError('No scan ID provided. Use ?scan=123');
            return;
        }

        // Show loading UI (spinner, while‑you‑wait mini‑games, etc.)
        this.showLoadingState();

        // -----------------------------------------------------------------
        // Polling function – calls /api/scans/:id every 3 seconds
        // -----------------------------------------------------------------
        const poll = async () => {
            try {
                const res = await fetch(`/api/scans/${scanId}`);
                if (!res.ok) {
                    const errTxt = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errTxt}`);
                }
                const data = await res.json();

                // ---------- QUEUED / PROCESSING ----------
                if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
                    const pct = data.totalFiles && data.totalFiles > 0
                        ? Math.round((data.processedFiles / data.totalFiles) * 100)
                        : 0;
                    this.updateProgressBar(pct);
                    setTimeout(poll, 3000);
                    return;
                }

                // ---------- FAILED ----------
                if (data.status === 'FAILED') {
                    this.hideLoadingState();
                    this.showError(data.errorMessage ?? 'Analysis failed');
                    return;
                }

                // ---------- COMPLETED ----------
                if (data.status === 'COMPLETED') {
                    this.hideLoadingState();
                    this.hideProgressBar();
                    // data already contains the merged report (project, files, hotspots, violations)
                    this.jsonData = {
                        project: data.project,
                        files: data.files,
                        hotspots: data.hotspots,
                        violations: data.violations
                    };
                    this.populateReport();          // render the full report
                    return;
                }

                // ---------- UNKNOWN STATUS ----------
                this.hideLoadingState();
                this.showError(`Unknown scan status: ${data.status}`);
            } catch (err) {
                console.error('Polling error:', err);
                this.hideLoadingState();
                this.showError(`Polling failed: ${err.message}`);
            }
        };

        // Start the first poll immediately
        poll();
    }

    /* -----------------------------------------------------------------
       UI state helpers
       ----------------------------------------------------------------- */
    showLoadingState() {
        document.getElementById('loading-state').classList.remove('hidden');
        document.getElementById('report-content').classList.add('hidden');
        document.getElementById('loading-message').textContent = this.getRandomJoke();
    }

    showProcessingState(currentStatus) {
        document.getElementById('loading-state').classList.remove('hidden');
        document.getElementById('report-content').classList.add('hidden');
        const msg = currentStatus === 'QUEUED'
            ? 'Your analysis is queued...'
            : 'Analyzing your code...';
        document.getElementById('loading-message').textContent = msg;
        // keep the mini‑game / fact alive while we wait
        this.initTypingTest();
        this.populateDevFact();
    }

    hideLoadingState() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('report-content').classList.remove('hidden');
    }

    showError(message) {
        const loadingState = document.getElementById('loading-state');
        loadingState.innerHTML = `
            <div class="error-message">
                <h2>��� Oops!</h2>
                <p>${message}</p>
                <p>Tip: Make sure you ran the analysis with a valid scan ID.</p>
            </div>
        `;
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

            const reportContent = document.getElementById('report-content');
            if (reportContent && reportContent.parentNode) {
                reportContent.parentNode.insertBefore(container, reportContent);
            }
        }
        this.progressBar.style.width = `${percent}%`;
    }

    hideProgressBar() {
        if (this.progressBar && this.progressBar.parentNode) {
            this.progressBar.parentNode.removeChild(this.progressBar);
            this.progressBar = null;
        }
    }

    /* -----------------------------------------------------------------
       Report rendering – called when status becomes COMPLETED
       ----------------------------------------------------------------- */
    populateReport() {
        if (!this.jsonData) return;

        const project = this.jsonData.project || {};

        // ---------- Overview ----------
        this.populateOverview(project);
        this.populateHotspots(this.jsonData.hotspots || {});
        this.populateViolations(this.jsonData.violations || []);
        this.populateDependencies(this.jsonData.files || []);
        this.populateFiles(this.jsonData.files || []);

        // ---------- Streak / achievement ----------
        this.updateStreak();
    }

    // -----------------------------------------------------------------
    // Overview panel
    // -----------------------------------------------------------------
    populateOverview(project) {
        const healthScore = project.healthScore || 0;
        const healthGrade = project.healthGrade || 'F';

        // gauge fill
        const gaugeFill = document.querySelector('.gauge-fill');
        if (gaugeFill) {
            gaugeFill.style.width = `${Math.min(healthScore, 100)}%`;
            const gradeColors = { A: '#4c1', B: '#97ca00', C: '#dfb317', D: '#fe7d37', F: '#e05d44' };
            gaugeFill.style.backgroundColor = gradeColors[healthGrade] || '#e05d44';
        }

        // gauge label / grade
        document.getElementById('health-score-value').textContent = `${healthScore}`;
        document.getElementById('health-grade').textContent = healthGrade;
        document.getElementById('health-score-numeric').textContent = healthScore;
        document.getElementById('health-grade-letter').textContent = healthGrade;

        // meme
        const meme = this.healthScoreMemes.find(m => healthScore >= m.min && healthScore <= m.max);
        document.getElementById('health-score-meme').textContent = meme ? meme.text : '';

        // other metrics
        document.getElementById('files-analyzed').textContent = project.filesAnalyzed || 0;
        document.getElementById('total-lines').textContent = this.formatNumber(project.totalLines || 0);
        document.getElementById('comment-lines').textContent = this.formatNumber(project.commentLines || 0);
        document.getElementById('function-count').textContent = project.functionCount || 0;
        document.getElementById('todo-count').textContent = project.todoCount || 0;
    }

    // -----------------------------------------------------------------
    // Hotspots panel
    // -----------------------------------------------------------------
    populateHotspots(hotspots) {
        const tbody = document.querySelector('#hotspots-table tbody');
        tbody.innerHTML = '';

        if (!hotspots.gitAvailable) {
            document.getElementById('hotspots-panel').innerHTML = `
                <p class="no-data">���� No git repository detected. Hotspot analysis requires a git repo.</p>
                <p class="no-data-hint">Run CMA inside a git repository to see hotspot scores (complexity × churn).</p>
            `;
            return;
        }

        const files = hotspots.files || [];
        if (files.length === 0) {
            document.getElementById('hotspots-panel').innerHTML = `
                <p class="no-data">���� No hotspot data available.</p>
            `;
            return;
        }

        document.getElementById('hotspots-loading').classList.add('hidden');

        // Normalise for display (same formula as backend)
        const maxComplexity = Math.max(1, ...files.map(f => f.cyclomaticComplexity));
        const maxCommits = Math.max(1, ...files.map(f => f.commitCount));

        files.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.shortenPath(h.path)}</td>
                <td>${h.cyclomaticComplexity}</td>
                <td>${h.commitCount}</td>
                <td>${h.hotspotScore.toFixed(1)}</td>
                <td>
                    <div class="hotspot-details">
                        <p>���� <strong>Path:</strong> ${h.path}</p>
                        <p>���� <strong>Lines Added:</strong> ${this.formatNumber(h.linesAdded)}</p>
                        <p>���� <strong>Lines Deleted:</strong> ${this.formatNumber(h.linesDeleted)}</p>
                        <p>���� <strong>Hotspot Formula:</strong> (${h.cyclomaticComplexity}/${maxComplexity}) × (${h.commitCount}/${maxCommits}) × 100</p>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // -----------------------------------------------------------------
    // Violations panel
    // -----------------------------------------------------------------
    populateViolations(violations) {
        const tbody = document.querySelector('#violations-table tbody');
        tbody.innerHTML = '';

        const showInfo = document.getElementById('filter-info').checked;
        const showWarning = document.getElementById('filter-warning').checked;
        const filterLang = document.getElementById('filter-language').value;

        const filtered = violations.filter(v =>
            (showInfo && v.severity === 'info') ||
            (showWarning && v.severity === 'warning')
        ).filter(v => filterLang === 'all' || v.language === filterLang);

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">No violations match current filters.</td></tr>';
        } else {
            filtered.forEach(v => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${this.shortenPath(v.path)}</td>
                    <td>${v.line}</td>
                    <td><code>${v.ruleId}</code></td>
                    <td title="${v.message}">${this.truncate(v.message, 50)}</td>
                    <td class="severity-${v.severity}">${v.severity.toUpperCase()}</td>
                `;
                tr.addEventListener('click', () => {
                    alert(`Rule Explanation:\n${v.message}\n\nFile: ${v.path}\nLine: ${v.line}`);
                });
                tbody.appendChild(tr);
            });
        }

        document.getElementById('violations-loading').classList.add('hidden');
    }

    // -----------------------------------------------------------------
    // Dependencies panel
    // -----------------------------------------------------------------
    populateDependencies(files) {
        const hasDeps = files.some(f =>
            f.dependencies &&
            (f.dependencies.fanOut > 0 || f.dependencies.fanIn > 0)
        );

        if (!hasDeps) {
            document.getElementById('dependencies-panel').innerHTML = `
                <p class="no-data">���� No external dependencies detected.</p>
                <p class="no-data-hint">Dependencies are shown when files import/include other files in your project.</p>
            `;
            return;
        }

        document.getElementById('deps-loading').classList.add('hidden');
        const tbody = document.querySelector('#deps-table tbody');
        tbody.innerHTML = '';

        files.forEach(f => {
            if (!f.dependencies) return;
            const path = f.path;
            const deps = f.dependencies;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.shortenPath(path)}</td>
                <td>${deps.fanOut || 0}</td>
                <td>${deps.fanIn || 0}</td>
                <td>${deps.dependsOn ? deps.dependsOn.join(', ') : ''}</td>
                <td>${deps.dependedOnBy ? deps.dependedOnBy.join(', ') : ''}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // -----------------------------------------------------------------
    // Files panel
    // -----------------------------------------------------------------
    populateFiles(files) {
        const tbody = document.querySelector('#files-table tbody');
        tbody.innerHTML = '';

        if (files.length === 0) {
            document.getElementById('files-panel').innerHTML = `
                <p class="no-data">���� No files analyzed.</p>
            `;
            return;
        }

        files.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.shortenPath(f.path)}</td>
                <td>${this.formatNumber(f.totalLines)}</td>
                <td>${f.functionCount || 0}</td>
                <td>${f.classCount || 0}</td>
                <td>${f.cyclomaticComplexity}</td>
                <td>
                    <button class="details-btn" data-path="${f.path}">Details</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // attach click handlers to the details buttons
        document.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const path = e.target.getAttribute('data-path');
                const fileMetrics = files.find(f => f.path === path);
                this.showFileDetails(path, fileMetrics);
            });
        });
    }

    // -----------------------------------------------------------------
    // File search
    // -----------------------------------------------------------------
    filterFiles(searchTerm) {
        const tbody = document.querySelector('#files-table tbody');
        const rows = tbody.getElementsByTagName('tr');
        Array.from(rows).forEach(row => {
            const fileName = row.cells[0].textContent;
            row.style.display = fileName.toLowerCase().includes(searchTerm.toLowerCase()) ? '' : 'none';
        });
    }

    // -----------------------------------------------------------------
    // Show detailed metrics for a single file
    // -----------------------------------------------------------------
    showFileDetails(path, metrics) {
        if (!metrics) return;
        const details = `
            File: ${path}

            Lines: ${this.formatNumber(metrics.totalLines)}
            Functions: ${metrics.functionCount || 0}
            Classes: ${metrics.classCount || 0}
            Cyclomatic Complexity: ${metrics.cyclomaticComplexity}
            TODO count: ${metrics.todoCount || 0}
            Comment lines: ${this.formatNumber(metrics.commentLines)}
            Blank lines: ${this.formatNumber(metrics.blankLines)}
        `;
        alert(details.trim());
    }

    // -----------------------------------------------------------------
    // Streak / achievement logic
    // -----------------------------------------------------------------
    updateStreak() {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        if (this.lastAnalysisDate !== today) {
            this.analysisStreak = (this.lastAnalysisDate ? this.analysisStreak + 1 : 1);
            this.lastAnalysisDate = today;
            localStorage.setItem('cma-last-analysis', today);
            localStorage.setItem('cma-streak', this.analysisStreak);
        }
        this.updateStreakDisplay();
    }

    updateStreakDisplay() {
        const streakMsg = document.getElementById('streak-message');
        const streakVis = document.getElementById('streak-visual');
        if (streakMsg && streakVis) {
            streakMsg.textContent = `You've analysed code ${this.analysisStreak} ${this.analysisStreak === 1 ? 'day' : 'days'} in a row!`;
            // simple visual: show a fire emoji repeated
            streakVis.textContent = '����'.repeat(Math.min(this.analysisStreak, 5));
        }
    }

    // -----------------------------------------------------------------
    // Sound effects
    // -----------------------------------------------------------------
    playSound(type) {
        if (!this.soundEnabled) return;
        const audioMap = {
            success: 'success-sound',
            error: 'error-sound',
            konami: 'konami-sound'
        };
        const el = document.getElementById(audioMap[type]);
        if (el) {
            el.currentTime = 0;
            el.play().catch(() => {}); // ignore autoplay errors
        }
    }

    // -----------------------------------------------------------------
    // Konami code easter egg
    // -----------------------------------------------------------------
    playKonamiListener() {
        const konami = [38,38,40,40,37,39,37,39,66,65]; // ↑���������←→←→BA
        let index = 0;
        const handler = e => {
            const key = e.keyCode || e.which;
            if (key === konami[index]) {
                index++;
                if (index === konami.length) {
                    this.playSound('konami');
                    alert('���� Konami code unlocked! You get a free coffee (virtually).');
                    index = 0;
                }
            } else {
                index = 0;
            }
        };
        window.addEventListener('keydown', handler);
    }

    // -----------------------------------------------------------------
    // Rotate loading message (joke) every few seconds while waiting
    // -----------------------------------------------------------------
    rotateLoadingMessage() {
        setInterval(() => {
            const msgEl = document.getElementById('loading-message');
            if (msgEl && document.getElementById('loading-state').classList.contains('hidden') === false) {
                msgEl.textContent = this.getRandomJoke();
            }
        }, 4000);
    }

    // -----------------------------------------------------------------
    // Mini‑game: typing speed test (shown while waiting)
    // -----------------------------------------------------------------
    initTypingTest() {
        const container = document.getElementById('mini-game-container');
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
                const endTime = Date.now();
                const elapsed = (endTime - startTime) / 1000;
                const wpm = Math.round((target.split(' ').length / elapsed) * 60);
                result.textContent = `��� Done! ${wpm} WPM`;
                input.disabled = true;
            } else if (value.length > target.length) {
                result.textContent = '��� Too long – start over';
                input.value = '';
                startTime = null;
            }
        });
    }

    // -----------------------------------------------------------------
    // Populate a random developer fact
    // -----------------------------------------------------------------
    populateDevFact() {
        const el = document.getElementById('dev-fact');
        if (el) {
            el.textContent = this.getRandomFact();
        }
    }

    // -----------------------------------------------------------------
    // Helper: random joke / fact
    // -----------------------------------------------------------------
    getRandomJoke() {
        return this.devJokes[Math.floor(Math.random() * this.devJokes.length)];
    }
    getRandomFact() {
        return this.devFacts[Math.floor(Math.random() * this.devFacts.length)];
    }

    // -----------------------------------------------------------------
    // Helper: shorten long paths for display
    // -----------------------------------------------------------------
    shortenPath(path) {
        if (path.length <= 20) return path;
        return '…' + path.slice(-20);
    }

    // -----------------------------------------------------------------
    // Helper: truncate text
    // -----------------------------------------------------------------
    truncate(str, len) {
        return str.length > len ? str.slice(0, len - 1) + '…' : str;
    }

    // -----------------------------------------------------------------
    // Helper: format large numbers with commas
    // -----------------------------------------------------------------
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
}

/* -----------------------------------------------------------------
   Bootstrap – wait for DOM to be ready then instantiate the dashboard
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    window.cmaDashboard = new CMADashboard();
});

/* -----------------------------------------------------------------
   Export for possible testing (not used in production)
   ----------------------------------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CMADashboard };
}
