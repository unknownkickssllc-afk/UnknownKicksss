window.UK_API = {
  async request(path, options = {}) {
    const r = await fetch(`/api${path}`, options);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 404) {
        throw new Error(data.error || "Server endpoint not found. Restart npm start and refresh.");
      }
      throw new Error(data.error || "Request failed");
    }
    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};
