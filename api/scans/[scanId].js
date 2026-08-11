// api/scans/[scanId].js
//
// GET /api/scans/:scanId
//
// Reads `${scanId}.json` from the Supabase `scans` storage bucket
// (written by api/analyze.js) and returns it as-is. The stored payload
// already matches the shape frontend/dashboard.js expects:
//   { status: "COMPLETED", scanId, projectName, project, files, hotspots, violations }
//
// A missing scan returns HTTP 200 with { status: "FAILED", errorMessage }
// rather than a raw 404 -- dashboard.js branches on the `status` field
// in the body, not on the HTTP status code, so this keeps the "scan not
// found" case rendering through the same clean error panel as a real
// analysis failure instead of falling into the generic "Polling failed"
// catch-all.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export default async function handler(req, res) {
  const { scanId } = req.query;

  if (!scanId || typeof scanId !== "string") {
    res.status(400).json({ status: "FAILED", errorMessage: "Missing scan id." });
    return;
  }

  try {
    const { data, error } = await supabase.storage.from("scans").download(`${scanId}.json`);
    if (error || !data) {
      res.status(200).json({ status: "FAILED", errorMessage: "Scan not found." });
      return;
    }

    const text = await data.text();
    const payload = JSON.parse(text);
    res.status(200).json(payload);
  } catch (err) {
    console.error("Scan fetch error:", err);
    res.status(200).json({
      status: "FAILED",
      errorMessage: err?.message || "Could not retrieve scan.",
    });
  }
}
