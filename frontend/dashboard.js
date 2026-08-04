// CMA Report Dashboard - Client-side logic for HTML report viewer
// Features: Humor, engagement, data visualization, theme switching, API integration

class CMADashboard {
    constructor() {
        this.theme = localStorage.getItem('cma-theme') || 'modern';
        this.soundEnabled = localStorage.getItem('cma-sound') !== 'false';
        this.lastAnalysisDate = localStorage.getItem('cma-last-analysis');
        this.analysisStreak = parseInt(localStorage.getItem('cma-streak') || '0');
        this.jsonData = null;
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
            { min: 70, max: 79, text: "Decent! Your code is like a well-commented Stack Overflow answer." },
            { min: 60, max: 69, text: "Getting there! Your code needs more comments than a politician's speech." },
            { min: 50, max: 59, text: "Uh oh... Your code has more surprises than a legacy JavaScript project." },
            { min: 40, max: 49, text: "Yikes! Time to refactor before your code becomes sentient and vengeful." },
            { min: 30, max: 39, text: "Yikes yikes! Your cyclomatic complexity is trying to escape." },
            { min: 0, max: 29, text: "Holy spaghetti, Batman! This code needs more structure than a toddler's LEGO project." }
        ];
        
        this.init();
    }

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

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const themeSelect = document.getElementById('theme');
        if (themeSelect) themeSelect.value = this.theme;
    }

    bindEvents() {
        // Theme selector
        const themeSelect = document.getElementById('theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                this.theme = e.target.value;
                localStorage.setItem('cma-theme', this.theme);
                this.applyTheme();
            });
        }

        // Sound toggle
        const soundToggle = document.getElementById('sound-toggle');
        if (soundToggle) {
            soundToggle.addEventListener('change', (e) => {
                this.soundEnabled = e.target.checked;
                localStorage.setItem('cma-sound', this.soundEnabled ? 'true' : 'false');
            });
        }

        // File search
        const fileSearch = document.getElementById('file-search');
        if (fileSearch) {
            fileSearch.addEventListener('input', (e) => this.filterFiles(e.target.value));
        }
    }

    // -----------------------------------------------------------------
    // Load report from API (expects scan ID in URL query param ?scan=123)
    // -----------------------------------------------------------------
    loadReport() {
        const scanId = new URLSearchParams(window.location.search).get('scan');
        if (!scanId) {
            this.showError('No scan ID provided. Use ?scan=123');
            return;
        }

        // Show loading state immediately
        this.showLoadingState();

        // Fetch scan status
        fetch(`/api/scans/${scanId}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
                    this.showProcessingState(data.status);
                    this.startPolling(scanId);
                } else if (data.status === 'COMPLETED') {
                    this.hideLoadingState();
                    this.populateReport(data);
                } else if (data.status === 'FAILED') {
                    this.showError(data.errorMessage || 'Analysis failed');
                } else {
                    this.showError(`Unknown status: ${data.status}`);
                }
            })
            .catch(err => {
                console.error('Error loading scan:', err);
                this.showError(`Failed to load scan: ${err.message}`);
            });
    }

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
        // Update mini-game and fact while waiting
        this.initTypingTest();
        this.populateDevFact();
    }

    startPolling(scanId) {
        this.pollInterval = setInterval(() => {
            fetch(`/api/scans/${scanId}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
                        clearInterval(this.pollInterval);
                        this.loadReport(); // Reload to show final state
                    } else {
                        // Still processing – update message with a joke
                        document.getElementById('loading-message').textContent = this.getRandomJoke();
                    }
                })
                .catch(err => {
                    clearInterval(this.pollInterval);
                    this.showError(`Polling error: ${err.message}`);
                });
        }, 3000); // Poll every 3 seconds
    }

    hideLoadingState() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('report-content').classList.remove('hidden');
    }

    showError(message) {
        const loadingState = document.getElementById('loading-state');
        loadingState.innerHTML = `
            <div class="error-message">
                <h2>❌ Oops!</h2>
                <p>${message}</p>
                <p>Tip: Make sure you ran the analysis with a valid scan ID.</p>
            </div>
        `;
    }

    // -----------------------------------------------------------------
    // Populate the report UI with data from the API
    // -----------------------------------------------------------------
    populateReport(data) {
        if (!data) return;

        // The API should return the same shape as your existing report.json
        // We expect: { project: {...}, files: [...], hotspots: {...}, violations: [...] }
        this.jsonData = {
            project: data.project || {},
            files: data.files || [],
            hotspots: data.hotspots || { gitAvailable: false, files: [] },
            violations: data.violations || []
        };

        this.populateOverview();
        this.populateHotspots();
        this.populateViolations();
        this.populateDependencies();
        this.populateFiles();
        this.playSound('success');
        this.updateStreak();
    }

    populateOverview() {
        const project = this.jsonData.project || {};
        
        // Health score and grade
        const healthScore = project.healthScore || 0;
        const healthGrade = project.healthGrade || 'F';
        document.getElementById('health-score-value').textContent = `${healthScore}`;
        document.getElementById('health-grade').textContent = healthGrade;
        document.getElementById('health-score-numeric').textContent = healthScore;
        document.getElementById('health-grade-letter').textContent = healthGrade;
        
        // Health score gauge fill percentage
        const gaugeFill = document.querySelector('.gauge-fill');
        if (gaugeFill) {
            gaugeFill.style.width = `${Math.min(healthScore, 100)}%`;
            const gradeColors = { A: '#4c1', B: '#97ca00', C: '#dfb317', D: '#fe7d37', F: '#e05d44' };
            gaugeFill.style.backgroundColor = gradeColors[healthGrade] || '#e05d44';
        }

        // Health score meme
        const meme = this.healthScoreMemes.find(m => healthScore >= m.min && healthScore <= m.max);
        document.getElementById('health-score-meme').textContent = meme ? meme.text : '';

        // Other metrics
        document.getElementById('files-analyzed').textContent = project.filesAnalyzed || 0;
        document.getElementById('total-lines').textContent = this.formatNumber(project.totalLines || 0);
        document.getElementById('comment-lines').textContent = this.formatNumber(project.commentLines || 0);
        document.getElementById('function-count').textContent = project.functionCount || 0;
        document.getElementById('todo-count').textContent = project.todoCount || 0;
    }

    populateHotspots() {
        const hotspots = this.jsonData.hotspots || {};
        const tbody = document.querySelector('#hotspots-table tbody');
        tbody.innerHTML = '';

        if (!hotspots.gitAvailable) {
            document.getElementById('hotspots-panel').innerHTML = `
                <p class="no-data">📊 No git repository detected. Hotspot analysis requires a git repo.</p>
                <p class="no-data-hint">Run CMA inside a git repository to see hotspot scores (complexity × churn).</p>
            `;
            return;
        }

        const files = hotspots.files || [];
        if (files.length === 0) {
            document.getElementById('hotspots-panel').innerHTML = `
                <p class="no-data">📊 No hotspot data available.</p>
            `;
            return;
        }

        document.getElementById('hotspots-loading').classList.add('hidden');

        // Compute max values for normalization (same as backend)
        const maxComplexity = Math.max(1, ...files.map(f => f.cyclomaticComplexity));
        const maxCommits = Math.max(1, ...files.map(f => f.commitCount));

        files.forEach((hotspot, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${this.shortenPath(hotspot.path)}</td>
                <td>${hotspot.cyclomaticComplexity}</td>
                <td>${hotspot.commitCount}</td>
                <td>${hotspot.hotspotScore.toFixed(1)}</td>
                <td>
                    <div class="hotspot-details">
                        <p>📍 <strong>Path:</strong> ${hotspot.path}</p>
                        <p>📈 <strong>Lines Added:</strong> ${this.formatNumber(hotspot.linesAdded)}</p>
                        <p>📉 <strong>Lines Deleted:</strong> ${this.formatNumber(hotspot.linesDeleted)}</p>
                        <p>🔥 <strong>Hotspot Formula:</strong> (${hotspot.cyclomaticComplexity}/${maxComplexity}) × (${hotspot.commitCount}/${maxCommits}) × 100</p>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    populateViolations() {
        const violations = this.jsonData.violations || [];
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

    populateDependencies() {
        // Check if we have dependency data in files
        const files = this.jsonData.files || [];
        const hasDeps = files.some(f => 
            f.dependencies && 
            (f.dependencies.fanOut > 0 || f.dependencies.fanIn > 0)
        );

        if (!hasDeps) {
            document.getElementById('dependencies-panel').innerHTML = `
                <p class="no-data">🔗 No external dependencies detected.</p>
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

    populateFiles() {
        const files = this.jsonData.files || [];
        const tbody = document.querySelector('#files-table tbody');
        tbody.innerHTML = '';

        if (files.length === 0) {
            document.getElementById('files-panel').innerHTML = `
                <p class="no-data">📄 No files analyzed.</p>
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

        // Add event listeners to details buttons
        document.querySelectorAll('.details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const path = e.target.getAttribute('data-path');
                const fileMetrics = files.find(f => f.path === path);
                this.showFileDetails(path, fileMetrics);
            });
        });
    }

    filterFiles(searchTerm) {
        const tbody = document.querySelector('#files-table tbody');
        const rows = tbody.getElementsByTagName('tr');
        
        Array.from(rows).forEach(row => {
            const fileName = row.cells[0].textContent;
            row.style.display = fileName.toLowerCase().includes(searchTerm.toLowerCase()) ? '' : 'none';
        });
    }

    showFileDetails(path, metrics) {
        const details = `
            File: ${path}
