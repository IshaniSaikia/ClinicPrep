import { useEffect, useState } from 'react';
import { createAppointment, deleteAppointment, generateAppointmentDraft, getAppointment, getAppointments, getBackendHealth, updateAppointment } from './api';
import { downloadPreparationPdf } from './createPreparationPdf';
import './App.css';

const empty = { type: 'Primary care', date: '', concern: '', notes: '', medicines: '', allergies: '', questions: '' };
const sample = { type: 'Primary care', date: '2026-11-05', concern: 'Occasional headaches after long workdays.', notes: 'They usually happen in the evening. I would like to discuss possible patterns and details I should track.', medicines: 'Fictional demo: none listed', allergies: 'Fictional demo: seasonal pollen', questions: 'What information should I track before my next visit?\nCould sleep or screen breaks be useful to discuss?' };

function lines(text) { return text.split('\n').map((line) => line.trim()).filter(Boolean); }
function summaryFor(form) {
  const list = (text) => lines(text).map((item) => `• ${item}`).join('\n') || '• None provided';
  return [
    'APPOINTMENT PREPARATION', `Visit: ${form.type || 'Not specified'}${form.date ? ` · ${new Date(`${form.date}T12:00:00`).toLocaleDateString()}` : ''}`,
    '', 'MAIN CONCERN', form.concern.trim(), '', 'NOTES TO DISCUSS', list(form.notes), '',
    'CURRENT MEDICINES', list(form.medicines), '', 'ALLERGIES', list(form.allergies), '', 'MY QUESTIONS', list(form.questions), '',
    'QUESTIONS TO CONSIDER', '• What information would be useful to track before or after this visit?\n• What should I keep in mind when following up?\n• Are there reliable resources you recommend?', '',
    'This organizational draft is not medical advice.'
  ].join('\n');
}

export default function App() {
  const [form, setForm] = useState(empty);
  const [summary, setSummary] = useState('');
  const [draftSource, setDraftSource] = useState('none');
  const [records, setRecords] = useState(() => { try { return JSON.parse(localStorage.getItem('clinicprep.records') || '[]'); } catch { return []; } });
  const [page, setPage] = useState('new');
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking');
  const [backendStorage, setBackendStorage] = useState(null);
  const [healthCheckVersion, setHealthCheckVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  useEffect(() => localStorage.setItem('clinicprep.records', JSON.stringify(records)), [records]);
  useEffect(() => {
    const controller = new AbortController();
    getBackendHealth(controller.signal)
      .then((health) => { setBackendStorage(health.storage); setBackendStatus('connected'); })
      .catch(() => setBackendStatus('offline'));
    return () => controller.abort();
  }, [healthCheckVersion]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadAppointments() {
      try {
        const cached = JSON.parse(localStorage.getItem('clinicprep.records') || '[]');
        const cachedRecords = Array.isArray(cached) ? cached : [];
        const remote = await getAppointments(controller.signal);
        const remoteIds = new Set(remote.map((record) => record.id));

        for (const record of cachedRecords) {
          if (!record.id || remoteIds.has(record.id)) continue;
          const { createdAt: _createdAt, updatedAt: _updatedAt, ...values } = record;
          await createAppointment(values, controller.signal);
          remoteIds.add(record.id);
        }

        const synced = await getAppointments(controller.signal);
        if (active) {
          setRecords(synced);
          setBackendStatus('connected');
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') {
          setBackendStatus(error.status && error.status < 500 ? 'connected' : 'offline');
          setMessage('Could not load API records. Showing the browser-saved copy until the backend is available.');
        }
      } finally {
        if (active) setIsLoadingRecords(false);
      }
    }

    loadAppointments();
    return () => { active = false; controller.abort(); };
  }, []);

  function field(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }
  function startNew() { setPage('new'); setForm(empty); setSummary(''); setDraftSource('none'); setEditing(null); setMessage(''); }
  function useSample() { setForm(sample); setSummary(summaryFor(sample)); setDraftSource('local'); setPage('new'); setEditing(null); setMessage('Fictional sample loaded. Review it before saving.'); }
  async function createDraft(event) {
    event.preventDefault();
    setIsGenerating(true);
    setMessage('Requesting an organizational draft from Groq…');
    try {
      const result = await generateAppointmentDraft(form);
      if (result.source !== 'groq' || typeof result.draft !== 'string' || !result.draft.trim()) {
        throw new Error('The backend did not confirm a Groq-generated draft.');
      }
      setSummary(result.draft);
      setDraftSource('groq');
      setMessage('Groq generated an organizational draft. Review it carefully; it is not medical advice.');
    } catch (error) {
      if (error.status === 400) {
        setMessage(error.message);
        return;
      }
      setSummary(summaryFor(form));
      setDraftSource('local');
      setMessage(`${error.message || 'Groq is unavailable.'} A local rule-based fallback was created; Groq did not generate this draft.`);
    } finally {
      setIsGenerating(false);
    }
  }
  async function save() {
    if (!form.concern.trim()) { setMessage('Add your main concern before saving.'); return; }
    const values = { ...form, summary: summary || summaryFor(form) };
    setIsSaving(true);
    try {
      const record = editing ? await updateAppointment(editing, values) : await createAppointment(values);
      setRecords((old) => editing ? old.map((item) => item.id === editing ? record : item) : [record, ...old]);
      setSummary(record.summary); setEditing(record.id); setBackendStatus('connected'); setMessage('Saved to the API and cached in this browser.');
    } catch (error) {
      if (!error.status || error.status >= 500) setBackendStatus('offline');
      setMessage(error.message || 'Could not save this preparation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }
  async function openRecord(record) {
    try {
      const saved = await getAppointment(record.id);
      const { summary: savedSummary, id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = saved;
      setForm(rest); setSummary(savedSummary || ''); setDraftSource('saved'); setEditing(id); setPage('new'); setMessage('Record loaded from the API.');
    } catch (error) {
      const { summary: savedSummary, id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = record;
      setForm(rest); setSummary(savedSummary || ''); setDraftSource('saved'); setEditing(id); setPage('new');
      if (!error.status || error.status >= 500) setBackendStatus('offline');
      setMessage('Opened the browser-saved copy. API update may be unavailable.');
    }
  }
  async function removeRecord(id) {
    try {
      await deleteAppointment(id);
      setRecords((old) => old.filter((record) => record.id !== id));
      if (editing === id) { setEditing(null); setForm(empty); setSummary(''); }
      setBackendStatus('connected'); setMessage('Preparation deleted from the API and browser cache.');
    } catch (error) {
      if (!error.status || error.status >= 500) setBackendStatus('offline');
      setMessage(error.message || 'Could not delete this preparation. Please try again.');
    }
  }
  async function copy() { if (!summary) { setMessage('Create a draft before copying it.'); return; } try { await navigator.clipboard.writeText(summary); setMessage('Summary copied.'); } catch { setMessage('Clipboard access was blocked; select and copy the text instead.'); } }
  async function download() { if (!summary) { setMessage('Create a draft before downloading it.'); return; } try { await downloadPreparationPdf(summary); setMessage('Professional PDF downloaded.'); } catch { setMessage('The PDF could not be created. Please try again.'); } }

  const storageLabel = backendStorage === 'mongodb' ? 'MongoDB Atlas connected' : backendStorage === 'memory' ? 'API connected · memory only' : 'Backend connected';
  const storageDescription = backendStorage === 'mongodb'
    ? 'Preparations are stored in MongoDB Atlas and cached in this browser. Draft requests send the entered fields to Groq for organization; use fictional data only.'
    : backendStorage === 'memory'
      ? 'Preparations are kept in server memory and cached in this browser. Server records may reset on restart. Draft requests send the entered fields to Groq; use fictional data only.'
      : 'Storage mode is not confirmed. A browser cache may be present. Draft requests send the entered fields to Groq; use fictional data only.';
  const privacyDescription = backendStorage === 'mongodb'
    ? 'API records are stored in MongoDB Atlas. This browser profile also keeps a local copy that may be visible to others who use this device.'
    : backendStorage === 'memory'
      ? 'API records are held in server memory until restart. This browser profile also keeps a local copy that may be visible to others who use this device.'
      : 'Storage mode could not be confirmed. This browser profile may contain a local copy that is visible to others who use this device.';

  return <div className="layout">
    <aside className="sidebar"><a className="brand" href="#top" onClick={startNew}><span className="brand-icon">✳</span> clinic<span>prep</span></a><p className="side-caption">WORKSPACE</p>
      <button className={page === 'new' ? 'nav active' : 'nav'} onClick={startNew}>＋ <span>New preparation</span></button>
      <button className={page === 'records' ? 'nav active' : 'nav'} onClick={() => setPage('records')}>▤ <span>Saved preparations</span><b>{records.length}</b></button>
      <div className="side-bottom"><span className="green-dot"/> Demo mode · {backendStorage === 'mongodb' ? 'Atlas + browser cache' : 'local API + cache'}<p>Made for clearer conversations with your healthcare professional.</p></div>
    </aside>
    <main id="top"><header className="topbar"><span>Workspace <i>/</i> {page === 'new' ? 'New preparation' : 'Saved preparations'}</span><div className="topbar-tools"><div className={`backend-status ${backendStatus}`} role="status" aria-live="polite"><span className="connection-dot" aria-hidden="true"/>{backendStatus === 'checking' ? 'Checking backend…' : backendStatus === 'connected' ? storageLabel : 'Backend unavailable'}{backendStatus === 'offline' && <button type="button" onClick={() => setHealthCheckVersion((version) => version + 1)}>Retry</button>}</div><span className="badge">● Prototype</span></div></header>
      <div className="content">{page === 'new' ? <>
        <section className="intro"><div><small>A LITTLE MORE PREPARED</small><h1>Make space for a better<br className="wide"/> conversation.</h1><p>Organize what’s on your mind before your next healthcare visit.</p></div><div className="visit-card"><span>YOUR NEXT VISIT</span><strong>Whenever you’re ready</strong><small>Start a preparation below</small></div></section>
        <div className="notice"><span>✓</span><div><b>Local demo workspace</b><small>{storageDescription}</small></div><button className="link-button" onClick={useSample}>Try fictional sample →</button></div>
        <div className="grid"><section className="card"><div className="card-title"><div className="tile">▤</div><div><h2>Your visit notes</h2><p>Fill in what feels useful. You can leave anything blank.</p></div></div>
          <form onSubmit={createDraft}>
            <div className="row"><label>Appointment type <em>Optional</em><select name="type" value={form.type} onChange={field}><option>Primary care</option><option>Specialist</option><option>Dental</option><option>Mental health</option><option>Other</option></select></label><label>Appointment date <em>Optional</em><input name="date" type="date" value={form.date} onInput={field} onChange={field}/></label></div>
            <label>Main concern <em className="required">Required</em><textarea name="concern" required maxLength={1000} value={form.concern} onChange={field} placeholder="What would you most like to discuss?"/></label>
            <label>Relevant notes <em>Optional</em><textarea name="notes" maxLength={2000} value={form.notes} onChange={field} placeholder="When it started, what you’ve noticed, or anything to remember…"/></label>
            <div className="row"><label>Current medicines <em>Optional</em><textarea name="medicines" maxLength={1000} value={form.medicines} onChange={field} placeholder="Name and dose, if known"/></label><label>Allergies <em>Optional</em><textarea name="allergies" maxLength={1000} value={form.allergies} onChange={field} placeholder="Include “none known” if helpful"/></label></div>
            <label>Questions for your healthcare professional <em>Optional</em><textarea name="questions" maxLength={1500} value={form.questions} onChange={field} placeholder="What would you like to ask?"/></label>
            <div className="form-end"><small>● Fictional data only · Draft requests send these fields to Groq.</small><button className="primary" disabled={isGenerating}>{isGenerating ? 'Generating…' : 'Create draft →'}</button></div>
          </form></section>
          <section className="card summary-card"><div className="summary-label">YOUR PREPARATION <span>{!summary ? 'NO DRAFT YET' : draftSource === 'groq' ? 'GROQ DRAFT · REVIEW' : draftSource === 'saved' ? 'SAVED DRAFT · SOURCE UNKNOWN' : draftSource === 'edited' ? 'USER-EDITED DRAFT' : 'LOCAL RULE-BASED DRAFT'}</span></div><h2>A clear place to start.</h2><p>Your notes, organized for review before the appointment.</p><label className="sr-only" htmlFor="summary">Editable appointment summary</label><textarea id="summary" className="summary" value={summary} onChange={(event) => { setSummary(event.target.value); setDraftSource('edited'); }} placeholder="Complete the form and choose “Create draft” to see your notes here. You can edit the draft before saving or sharing it."/>
            <button className="primary full" onClick={save} disabled={isSaving || isGenerating}>{isSaving ? 'Saving…' : `✓  ${editing ? 'Save changes' : 'Save preparation'}`}</button><div className="actions"><button onClick={copy}>▣ &nbsp;Copy</button><button onClick={download}>↓ &nbsp;Download PDF</button></div><div className="disclaimer">This is an organizational tool only. It does not provide medical advice, diagnose conditions, recommend treatment or medication, or assess emergencies.</div></section>
        </div><p className="footnote">ClinicPrep is an educational prototype. For health concerns, contact a qualified healthcare professional.</p>
      </> : <section className="records"><small>YOUR WORKSPACE</small><div className="records-head"><div><h1>Saved preparations</h1><p>Records come from the local API and are cached in this browser.</p></div><button className="primary" onClick={startNew}>＋ New preparation</button></div>
        {records.length ? <div className="record-grid">{records.map((record) => <article className="record card" key={record.id}><small>▢ &nbsp;{record.date || 'Date not set'}</small><h2>{record.type}</h2><p>{record.concern}</p><div><button onClick={() => openRecord(record)}>Open and edit</button><button className="delete" aria-label={`Delete ${record.type} preparation`} onClick={() => removeRecord(record.id)}>Delete</button></div></article>)}</div> : isLoadingRecords ? <div className="empty card"><div className="tile">…</div><h2>Loading preparations</h2><p>Checking the local API.</p></div> : <div className="empty card"><div className="tile">▤</div><h2>Nothing saved yet</h2><p>When you save a preparation, it will appear here.</p><button className="primary" onClick={startNew}>Start a preparation →</button><button className="link-button" onClick={useSample}>Or try the fictional sample</button></div>}
        <div className="disclaimer privacy"><b>Privacy note</b><br/>{privacyDescription}</div>
      </section>}</div>
      {message && <div className="toast" role="status">✓ &nbsp;{message}<button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
    </main>
  </div>;
}
