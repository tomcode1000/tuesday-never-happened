// Thin client for the server's DeepSeek proxy.
export async function llm(messages, { json = false, temperature = 0.9, max_tokens = 800, timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, json, temperature, max_tokens }),
      signal: ctrl.signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data.content;
  } finally {
    clearTimeout(t);
  }
}

export async function llmJson(messages, opts = {}) {
  const raw = await llm(messages, { ...opts, json: true });
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Bad JSON from model');
  }
}
