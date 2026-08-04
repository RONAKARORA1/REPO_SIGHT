/**
 * frontend/js/api.js
 * 
 * Simple wrapper around the Fetch API for talking to the Vercel backend.
 * All functions return promises that resolve to the parsed JSON response
 * (or reject with an error object containing a message and status).
 */

const API_BASE = ''; // relative to the same origin (Vercel serves API at /api/...)

/**
 * Internal helper: perform a fetch and return parsed JSON or throw.
 */
async function fetchJSON(input, options = {}) {
  const response = await fetch(`${API_BASE}${input}`, {
    credentials: 'include', // send cookies (JWT) with requests
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    // Try to get error message from body; fallback to status text.
    let errorMsg = `${response.status} ${response.statusText}`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.error) errorMsg = errBody.error;
    } catch (_) { /* ignore */ }
    throw new Error(errorMsg);
  }

  // Some endpoints (e.g., logout) may return empty body; handle gracefully.
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

/**
 * ----------------- AUTH -----------------
 */

export async function signup(email, password) {
  return fetchJSON('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email, password) {
  return fetchJSON('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return fetchJSON('/api/auth/logout', { method: 'POST' });
}

/**
 * ----------------- PROJECTS -----------------
 */

export async function getProjects(limit = 20, offset = 0) {
  return fetchJSON(`/api/projects?limit=${limit}&offset=${offset}`, {
    method: 'GET',
  });
}

export async function createProject(name, description = '') {
  return fetchJSON('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function getProject(projectId) {
  return fetchJSON(`/api/projects/${projectId}`, { method: 'GET' });
}

export async function updateProject(projectId, name, description) {
  return fetchJSON(`/api/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteProject(projectId) {
  return fetchJSON(`/api/projects/${projectId}`, { method: 'DELETE' });
}

/**
 * ----------------- SCANS -----------------
 */

export async function getScan(scanId) {
  return fetchJSON(`/api/scans/${scanId}`, { method: 'GET' });
}

/**
 * Create a new scan for a project.
 * The caller must first upload the source code ZIP via uploadFile()
 * and pass the returned uploadId.
 */
export async function createScan(projectId, uploadId) {
  return fetchJSON(`/api/projects/${projectId}/scans`, {
    method: 'POST',
    body: JSON.stringify({ uploadId }),
  });
}

/**
 * ----------------- UPLOADS -----------------
 */

/**
 * Upload a file (expects a File object from an <input type="file">).
 * Returns the uploadId (blob ID) that can be passed to createScan().
 */
export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${API_BASE}/api/uploads`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorMsg = `${response.status} ${response.statusText}`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.error) errorMsg = errBody.error;
    } catch (_) { /* ignore */ }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  // The upload route returns { uploadId, url, ... }
  return data.uploadId;
}

/**
 * ----------------- MISC -----------------
 */

export async function healthCheck() {
  return fetchJSON('/api/health', { method: 'GET' });
}

/**
 * Utility: check if the user is authenticated by trying to fetch a harmless endpoint.
 * In a real app you might also read the cookie directly.
 */
export async function checkAuth() {
  try {
    await healthCheck(); // health endpoint doesn't require auth, but we can call /api/projects with limit 0
    const { projects } = await getProjects(0, 0);
    return true;
  } catch (err) {
    return false;
  }
}
