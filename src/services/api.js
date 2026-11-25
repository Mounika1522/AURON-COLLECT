const API_BASE_URL = import.meta.env.VITE_API_URL;

export async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || "API request failed");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

export async function apiDownload(endpoint, token) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || "Download failed");
    error.status = response.status;
    throw error;
  }

  return response.blob();
}