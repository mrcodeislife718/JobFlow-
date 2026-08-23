const $ = (selector) => document.querySelector(selector);
const conversation = $('#conversation');

async function request(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `request failed: ${response.status}`);
  return payload;
}

function money(cents = 0) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

async function refresh() {
  const dashboard = await request('/api/dashboard');
  $('#metrics').innerHTML = `<p>Paid ${money(dashboard.revenue.paidCents)}</p><p>Recovered ${money(dashboard.revenue.recoveredCents)}</p><p>${dashboard.revenue.appointments} appointments</p>`;
  $('#appointments').innerHTML = dashboard.appointments.map((item) => `<article><strong>${item.service}</strong><div>${item.startsAt}</div><div>${item.status}</div></article>`).join('') || '<p>No appointments yet.</p>';
  const recovery = dashboard.recentEvents.filter((event) => ['recovery.started','rebooking.required'].includes(event.type));
  $('#recovery').innerHTML = recovery.map((event) => `<article><strong>${event.type}</strong><div>${event.at}</div></article>`).join('') || '<p>No recovery actions pending.</p>';
}

$('#receptionist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const message = String(form.get('message') ?? '').trim();
  if (!message) return;
  conversation.insertAdjacentHTML('beforeend', `<p><strong>You:</strong> ${message}</p>`);
  try {
    const result = await request('/api/receptionist', { method: 'POST', body: JSON.stringify({ message }) });
    conversation.insertAdjacentHTML('beforeend', `<p><strong>Receptionist:</strong> ${result.text}</p>`);
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    conversation.insertAdjacentHTML('beforeend', `<p><strong>Error:</strong> ${error.message}</p>`);
  }
});

refresh().catch((error) => { $('#metrics').textContent = error.message; });
