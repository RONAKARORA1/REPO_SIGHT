// api/scans/[scanId].js
//
// GET /api/scans/:scanId
//
// Reads `${scanId}.json` from the Supabase `scans` storage bucket
// (written by api/analyze.js) and returns it as-is.

import { createClient } from "@supabase/supabase-js";

let _supabase;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Server misconfigured: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY " +
        "are not set for this environment in Vercel Project Settings."
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export default async function handler(req, res) {
  const { scanId } = req.query;

  if (!scanId || typeof scanId !== "string") {
    res.status(400).json({ status: "FAILED", errorMessage: "Missing scan id." });
    return;
  }

  try {
    const supabase = getSupabase();
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
