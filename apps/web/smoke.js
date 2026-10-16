const $ = id => document.getElementById(id);
function row(values) {
  const tr = document.createElement('tr');
  for (const value of values) { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = String(value); tr.append(td); }
  return tr;
}
async function refresh() {
  try {
    const response = await fetch('/api/dev/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('The API is unavailable.');
    const state = await response.json();
    $('api').textContent = 'Ready'; $('instance').textContent = state.instance_id;
    $('worker').textContent = state.worker_last_seen && Date.now() - state.worker_last_seen < 2500 ? 'Running' : 'Not ready';
    $('migrations').textContent = `${state.migrations.length} applied`;
    $('marker-count').textContent = `${state.markers.length} records`;
    $('job-count').textContent = `${state.jobs.length} jobs`;
    $('marker-rows').replaceChildren(...state.markers.map(m => row([m.id, m.value])));
    $('job-rows').replaceChildren(...state.jobs.map(j => {
      let attachment = '—';
      if (j.state === 'completed') { attachment = document.createElement('a'); attachment.href = '/api/dev/attachments/' + encodeURIComponent(j.id); attachment.textContent = 'Inspect JSON'; }
      return row([j.id, j.state, j.attempts, attachment]);
    }));
    $('error').hidden = true;
  } catch (error) { $('api').textContent = 'Unavailable'; $('worker').textContent = 'Unknown'; $('error').hidden = false; $('error').textContent = error.message; }
}
async function submit(kind) {
  const form = $('marker-form'); if (!form.reportValidity()) return;
  const data = new FormData(form);
  try {
    const response = await fetch('/api/dev/' + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: data.get('id'), value: data.get('value') }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Request failed');
    $('form-status').textContent = kind === 'jobs' ? 'Job persisted. The worker will create its local attachment.' : 'Marker saved in this instance.';
    await refresh();
  } catch (error) { $('form-status').textContent = error.message; }
}
$('marker-form').addEventListener('submit', event => { event.preventDefault(); submit('markers'); });
$('queue-marker').addEventListener('click', () => submit('jobs'));
await refresh(); setInterval(refresh, 1000);
