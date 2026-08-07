loadReport() {
    const scanId = new URLSearchParams(window.location.search).get('scan');
    if (!scanId) {
        this.showError('No scan ID provided. Use ?scan=123');
        return;
    }

    // Show the loading UI (spinner, “while you wait” mini‑games, etc.)
    this.showLoadingState();

    // -----------------------------------------------------------------
    // POLLING LOOP – we will call the API every 3 seconds until the scan
    // finishes or fails.
    // -----------------------------------------------------------------
    const poll = async () => {
        try {
            const res = await fetch(`/api/scans/${scanId}`);
            if (!res.ok) {
                // Non‑2xx response → treat as failure
                const errTxt = await res.text();
                throw new Error(`HTTP ${res.status}: ${errTxt}`);
            }
            const data = await res.json();

            // ---------- QUEUED / PROCESSING ----------
            if (data.status === 'QUEUED' || data.status === 'PROCESSING') {
                // Update progress bar (if we have file counts)
                const pct = data.totalFiles && data.totalFiles > 0
                    ? Math.round((data.processedFiles / data.totalFiles) * 100)
                    : 0;
                this.updateProgressBar(pct);   // <-- you’ll add this method next
                // Keep polling
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
                // The full JSON/HTML blobs are already stored in Vercel Blob.
                // Re‑use the existing routine that draws the report.
                this.fetchFullReport(scanId);
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
// -----------------------------------------------------------------
// Show a simple progress bar (you can style it however you like)
// -----------------------------------------------------------------
updateProgressBar(percent) {
    // Create the bar element the first time we need it
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

        // Insert the bar just above the report‑content section (or wherever you prefer)
        const reportContent = document.getElementById('report-content');
        if (reportContent && reportContent.parentNode) {
            reportContent.parentNode.insertBefore(container, reportContent);
        }
    }
    // Update width
    this.progressBar.style.width = `${percent}%`;
},

// -----------------------------------------------------------------
// Hide / remove the progress bar when the scan is done
// -----------------------------------------------------------------
hideProgressBar() {
    if (this.progressBar && this.progressBar.parentNode) {
        this.progressBar.parentNode.removeChild(this.progressBar);
        this.progressBar = null;
    }
},

// -----------------------------------------------------------------
// Re‑use your existing routine that pulls the final JSON/HTML blobs
// and builds the report (you already had something like this)
// -----------------------------------------------------------------
fetchFullReport(scanId) {
    // Example – adjust to match the way you previously loaded the report
    fetch(`/api/scans/${scanId}`)
        .then(r => r.json())
        .then(data => {
            // data now contains the merged JSON report (project, files, hotspots, violations)
            this.jsonData = {
                project: data.project,
                files: data.files,
                hotspots: data.hotspots,
                violations: data.violations
            };
            this.hideLoadingState();
            this.populateReport();   // your existing method that fills the UI
        })
        .catch(err => {
            this.showError(`Could not fetch final report: ${err.message}`);
        });
}
