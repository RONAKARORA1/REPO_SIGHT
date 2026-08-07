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
