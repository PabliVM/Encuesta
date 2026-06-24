// js/admin.js — Panel de administración · Cantera RM
import { db, auth } from "./firebase-init.js";
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Estado global ────────────────────────────────────────
let currentUser  = null;
let allSurveys   = [];
let editingSurveyId = null;  // null = nueva encuesta
let aspectsData  = [];       // aspectos del editor temporal
let allResponses = [];

// ── Helpers DOM ──────────────────────────────────────────
const $  = id => document.getElementById(id);
const show = id => $(id).style.display = '';
const hide = id => $(id).style.display = 'none';

// ── AUTH ─────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    $('adminEmail').textContent = user.email;
    show('btnLogout');
    hide('viewLogin');
    show('viewDash');
    loadAllSurveys();
  } else {
    currentUser = null;
    hide('viewDash');
    show('viewLogin');
    hide('btnLogout');
  }
});

window.doLogin = async function() {
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPass').value;
  const btn   = $('btnLogin');
  $('loginError').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    $('loginError').textContent = 'Email o contraseña incorrectos.';
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
};

window.logout = async function() {
  await signOut(auth);
};

// ── TABS ─────────────────────────────────────────────────
window.showTab = function(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => {
    t.style.display = 'none';
    t.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $(tabId).style.display = 'block';
  $(tabId).classList.add('active');
  const idx = ['tabEncuestas','tabTokens','tabResultados'].indexOf(tabId);
  document.querySelectorAll('.tab-btn')[idx]?.classList.add('active');

  if (tabId === 'tabTokens')    loadTokens();
  if (tabId === 'tabResultados') loadResults();
};

// ── ENCUESTAS ─────────────────────────────────────────────
async function loadAllSurveys() {
  const snap = await getDocs(collection(db, 'survey'));
  allSurveys = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSurveyList();
  populateSurveySelects();
}

function renderSurveyList() {
  const el = $('surveyList');
  if (!allSurveys.length) {
    el.innerHTML = '<p style="color:var(--text-mut);font-size:13px">No hay encuestas. Crea la primera.</p>';
    return;
  }
  el.innerHTML = allSurveys.map(s => `
    <div class="survey-item">
      <div class="survey-item-info">
        <div class="survey-item-title">${s.title || 'Sin título'}</div>
        <div class="survey-item-meta">${s.season || ''} · ${(s.aspects||[]).length} aspectos</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="badge ${s.active ? 'badge-green' : 'badge-gray'}">${s.active ? 'Activa' : 'Inactiva'}</span>
        <button class="btn-copy" onclick="copyLink('${s.id}')">📋 Copiar enlace</button>
        <button class="btn-sm" onclick="editSurvey('${s.id}')">Editar</button>
        <button class="btn-danger" onclick="toggleSurveyActive('${s.id}', ${s.active})">
          ${s.active ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>
  `).join('');
}

function populateSurveySelects() {
  const opts = allSurveys.map(s =>
    `<option value="${s.id}">${s.title || s.id}</option>`
  ).join('');
  $('filterSurvey').innerHTML = '<option value="">Todas las encuestas</option>' + opts;
  $('tokenSurveyId').innerHTML = opts;
  $('filterResultSurvey').innerHTML = '<option value="">Selecciona encuesta</option>' + opts;
}

window.copyLink = function(surveyId) {
  // El enlace requiere un token, copiamos la base con instrucción
  const base = `${location.origin}/index.html?token=`;
  navigator.clipboard.writeText(base).then(() => {
    alert('Base del enlace copiada. Añade el token al final:\n' + base + 'TOKEN_AQUI');
  });
};

window.toggleSurveyActive = async function(id, current) {
  await updateDoc(doc(db, 'survey', id), { active: !current });
  await loadAllSurveys();
};

// ── EDITOR DE ENCUESTA ────────────────────────────────────
window.openNewSurvey = function() {
  editingSurveyId = null;
  aspectsData = [];
  $('surveyTitle').value  = '';
  $('surveyDesc').value   = '';
  $('surveySeason').value = '';
  $('surveyActive').value = 'true';
  $('modalSurveyTitle').textContent = 'Nueva encuesta';
  renderAspectsEditor();
  show('modalSurvey');
};

window.editSurvey = function(id) {
  const s = allSurveys.find(x => x.id === id);
  if (!s) return;
  editingSurveyId = id;
  aspectsData = JSON.parse(JSON.stringify(s.aspects || []));
  $('surveyTitle').value  = s.title || '';
  $('surveyDesc').value   = s.description || '';
  $('surveySeason').value = s.season || '';
  $('surveyActive').value = String(s.active !== false);
  $('modalSurveyTitle').textContent = 'Editar encuesta';
  renderAspectsEditor();
  show('modalSurvey');
};

window.saveSurvey = async function() {
  syncAspectsFromDOM();
  const data = {
    title:       $('surveyTitle').value.trim(),
    description: $('surveyDesc').value.trim(),
    season:      $('surveySeason').value.trim(),
    active:      $('surveyActive').value === 'true',
    aspects:     aspectsData,
    updatedAt:   serverTimestamp(),
  };
  if (!data.title) { alert('El título es obligatorio.'); return; }

  if (editingSurveyId) {
    await updateDoc(doc(db, 'survey', editingSurveyId), data);
  } else {
    data.createdAt = serverTimestamp();
    await addDoc(collection(db, 'survey'), data);
  }
  closeModal('modalSurvey');
  await loadAllSurveys();
};

// ── Editor de aspectos ────────────────────────────────────
function syncAspectsFromDOM() {
  document.querySelectorAll('.aspect-editor-item').forEach((el, aIdx) => {
    if (!aspectsData[aIdx]) return;
    const titleInput = el.querySelector('.aspect-title-input');
    const iconInput  = el.querySelector('.aspect-icon-input');
    if (titleInput) aspectsData[aIdx].title = titleInput.value;
    if (iconInput)  aspectsData[aIdx].icon  = iconInput.value;
    el.querySelectorAll('.question-input').forEach((qInput, qIdx) => {
      if (aspectsData[aIdx].questions) aspectsData[aIdx].questions[qIdx] = qInput.value;
    });
  });
}

function renderAspectsEditor() {
  const el = $('aspectsEditor');
  el.innerHTML = aspectsData.map((a, aIdx) => `
    <div class="aspect-editor-item">
      <div class="aspect-editor-header">
        <input class="form-input aspect-title-input" value="${(a.title||'').replace(/"/g,'&quot;')}"
          placeholder="Nombre del aspecto (ej: Metodología)">
        <input class="form-input aspect-icon-input" style="width:60px" value="${a.icon || '📋'}"
          placeholder="Icono">
        <button class="btn-remove" onclick="removeAspect(${aIdx})">✕</button>
      </div>
      <div class="questions-list">
        ${(a.questions||[]).map((q, qIdx) => `
          <div class="question-editor-row">
            <input class="form-input question-input" value="${(q||'').replace(/"/g,'&quot;')}"
              placeholder="Pregunta ${qIdx+1}">
            <button class="btn-remove" onclick="removeQuestion(${aIdx},${qIdx})">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="add-question-btn" onclick="addQuestion(${aIdx})">+ Añadir pregunta</button>
    </div>
  `).join('');
}

window.addAspect = function() {
  syncAspectsFromDOM();
  aspectsData.push({ title:'', icon:'📋', active:true, questions:[''] });
  renderAspectsEditor();
};

window.removeAspect = function(idx) {
  syncAspectsFromDOM();
  aspectsData.splice(idx, 1);
  renderAspectsEditor();
};

window.addQuestion = function(aIdx) {
  syncAspectsFromDOM();
  if (!aspectsData[aIdx].questions) aspectsData[aIdx].questions = [];
  aspectsData[aIdx].questions.push('');
  renderAspectsEditor();
};


// ── TOKENS ────────────────────────────────────────────────
window.loadTokens = async function() {
  const surveyFilter = $('filterSurvey').value;
  const usedFilter   = $('filterUsed').value;

  let q = collection(db, 'surveyTokens');
  const snap = await getDocs(q);
  let tokens = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (surveyFilter) tokens = tokens.filter(t => t.surveyId === surveyFilter);
  if (usedFilter !== '') tokens = tokens.filter(t => String(t.used) === usedFilter);

  const el = $('tokenList');
  if (!tokens.length) {
    el.innerHTML = '<p style="color:var(--text-mut);font-size:13px">No hay tokens con estos filtros.</p>';
    return;
  }

  el.innerHTML = tokens.map(t => {
    const surveyName = allSurveys.find(s => s.id === t.surveyId)?.title || t.surveyId;
    const link = `${location.origin}/index.html?token=${t.id}`;
    return `
      <div class="token-item">
        <div class="token-id">${t.id}</div>
        <div style="font-size:11px;color:var(--text-mut);flex:1">${surveyName}</div>
        <span class="badge ${t.used ? 'badge-gray' : 'badge-green'}">${t.used ? 'Usado' : 'Pendiente'}</span>
        <div class="token-actions">
          <button class="btn-copy" onclick="copyTokenLink('${link}')">📋 Copiar</button>
          ${!t.used ? `<button class="btn-danger" onclick="deactivateToken('${t.id}')">Desactivar</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
};

window.copyTokenLink = function(link) {
  navigator.clipboard.writeText(link).then(() => {
    alert('Enlace copiado:\n' + link);
  });
};

window.deactivateToken = async function(id) {
  if (!confirm('¿Desactivar este token?')) return;
  await updateDoc(doc(db, 'surveyTokens', id), { active: false });
  loadTokens();
};

window.openGenTokens = function() {
  $('tokenQty').value = '1';
  show('modalTokens');
};

window.generateTokens = async function() {
  const surveyId = $('tokenSurveyId').value;
  const qty      = parseInt($('tokenQty').value) || 1;
  if (!surveyId) { alert('Selecciona una encuesta.'); return; }

  const generated = [];
  for (let i = 0; i < qty; i++) {
    const ref = await addDoc(collection(db, 'surveyTokens'), {
      surveyId,
      used:      false,
      active:    true,
      createdAt: serverTimestamp(),
      usedAt:    null,
      responseId: null,
    });
    generated.push(ref.id);
  }

  closeModal('modalTokens');
  showTab('tabTokens');

  const links = generated.map(id =>
    `${location.origin}/index.html?token=${id}`
  ).join('\n');
  alert(`✅ ${qty} token(s) generado(s):\n\n${links}`);
};

// ── RESULTADOS ────────────────────────────────────────────
window.loadResults = async function() {
  const surveyId = $('filterResultSurvey').value;
  if (!surveyId) {
    $('resultsSummary').innerHTML = '';
    $('resultsList').innerHTML = '';
    return;
  }

  const snap = await getDocs(
    query(collection(db, 'surveyResponses'), where('surveyId', '==', surveyId))
  );
  allResponses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const survey = allSurveys.find(s => s.id === surveyId);
  renderResultsSummary(survey);
  renderResponsesList();
};

function renderResultsSummary(survey) {
  if (!allResponses.length) {
    $('resultsSummary').innerHTML = '<p style="color:var(--text-mut);font-size:13px">No hay respuestas todavía.</p>';
    return;
  }

  const total = allResponses.length;
  const globalAvgs = allResponses.map(r => r.globalAverage).filter(Boolean);
  const globalMean = globalAvgs.length
    ? (globalAvgs.reduce((a,b) => a+b, 0) / globalAvgs.length).toFixed(2)
    : '—';

  let html = `
    <div class="results-summary">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Respuestas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${globalMean}</div>
        <div class="stat-label">Media global</div>
      </div>
    </div>
  `;

  // Media por aspecto
  if (survey?.aspects) {
    survey.aspects.forEach((a, aIdx) => {
      if (!a.active) return;
      const questions = a.questions || [];
      let aspectHtml = `
        <div class="aspect-result">
          <div class="aspect-result-header">
            <span class="aspect-result-title">${a.icon || ''} ${a.title}</span>
            <span class="aspect-result-avg">${calcAspectAvg(aIdx, questions)}</span>
          </div>
      `;
      questions.forEach((q, qIdx) => {
        const scores = allResponses
          .map(r => r.answers?.[`${aIdx}_${qIdx}`])
          .filter(Boolean);
        const avg = scores.length
          ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)
          : '—';
        const dist = [1,2,3,4,5].map(v => scores.filter(s=>s===v).length);
        const max  = Math.max(...dist, 1);

        const colors = ['#dc2626','#ea580c','#ca8a04','#16a34a','#2563eb'];
        aspectHtml += `
          <div style="margin-bottom:10px">
            <div style="font-size:12px;color:var(--text-sec);margin-bottom:4px;font-weight:600">
              ${q} <span style="color:var(--rm-blue);font-weight:800">${avg}</span>
            </div>
            ${dist.map((count, i) => `
              <div class="bar-row">
                <span class="bar-label">${i+1}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${(count/max*100).toFixed(0)}%;background:${colors[i]}"></div>
                </div>
                <span class="bar-count">${count}</span>
              </div>
            `).join('')}
          </div>
        `;
      });
      aspectHtml += '</div>';
      html += aspectHtml;
    });
  }

  $('resultsSummary').innerHTML = html;
}

function calcAspectAvg(aIdx, questions) {
  const scores = [];
  allResponses.forEach(r => {
    questions.forEach((_, qIdx) => {
      const s = r.answers?.[`${aIdx}_${qIdx}`];
      if (s) scores.push(s);
    });
  });
  return scores.length
    ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2)
    : '—';
}

function renderResponsesList() {
  const el = $('resultsList');
  if (!allResponses.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <h3 style="font-size:14px;font-weight:700;margin:16px 0 8px">Respuestas individuales</h3>
    ${allResponses.map(r => {
      const date = r.submittedAt?.toDate
        ? r.submittedAt.toDate().toLocaleString('es-ES')
        : '—';
      return `
        <div class="response-item" onclick="openResponse('${r.id}')">
          <div>
            <div style="font-size:13px;font-weight:600">Token: ${r.token}</div>
            <div class="response-date">${date}</div>
          </div>
          <div class="response-avg">${r.globalAverage || '—'}</div>
        </div>
      `;
    }).join('')}
  `;
}

window.openResponse = function(id) {
  const r = allResponses.find(x => x.id === id);
  if (!r) return;

  const surveyId = $('filterResultSurvey').value;
  const survey   = allSurveys.find(s => s.id === surveyId);
  const date = r.submittedAt?.toDate
    ? r.submittedAt.toDate().toLocaleString('es-ES') : '—';

  let html = `<p style="font-size:12px;color:var(--text-mut);margin-bottom:16px">Enviado: ${date}</p>`;

  (survey?.aspects || []).forEach((a, aIdx) => {
    if (!a.active) return;
    html += `<div class="detail-section">
      <div class="detail-section-title">${a.icon || ''} ${a.title}</div>`;
    (a.questions || []).forEach((q, qIdx) => {
      const score = r.answers?.[`${aIdx}_${qIdx}`] || '—';
      const comment = r.questionComments?.[`${aIdx}_${qIdx}`] || '';
      html += `<div class="detail-row">
        <span class="detail-q">${q}</span>
        <span class="detail-score score-${score}">${score}/5</span>
      </div>`;
      if (comment) html += `<div class="detail-comment">"${comment}"</div>`;
    });
    const ac = r.aspectComments?.[aIdx];
    if (ac) html += `<div class="detail-comment">💬 ${ac}</div>`;
    html += '</div>';
  });

  // Bloques fijos
  html += `<div class="detail-section">
    <div class="detail-section-title">💼 Valoración Profesional</div>
    <div class="detail-row"><span class="detail-q">Coordinador</span><span class="detail-score">${r.coordinatorProfessionalScore||'—'}/5</span></div>
    <div class="detail-row"><span class="detail-q">Propia</span><span class="detail-score">${r.coachProfessionalScore||'—'}/5</span></div>
    ${r.coordinatorComment ? `<div class="detail-comment">"${r.coordinatorComment}"</div>` : ''}
  </div>
  <div class="detail-section">
    <div class="detail-section-title">👤 Valoración Personal</div>
    <div class="detail-row"><span class="detail-q">Coordinador</span><span class="detail-score">${r.coordinatorPersonalScore||'—'}/5</span></div>
    <div class="detail-row"><span class="detail-q">Propia</span><span class="detail-score">${r.coachPersonalScore||'—'}/5</span></div>
    ${r.coachComment ? `<div class="detail-comment">"${r.coachComment}"</div>` : ''}
  </div>
  <div class="detail-section">
    <div class="detail-section-title">⭐ Global</div>
    <div class="detail-row"><span class="detail-q">Valoración global</span><span class="detail-score">${r.globalScore||'—'}/5</span></div>
    ${r.finalComment ? `<div class="detail-comment">"${r.finalComment}"</div>` : ''}
  </div>`;

  $('modalResponseBody').innerHTML = html;
  show('modalResponse');
};

// ── EXPORTAR CSV ──────────────────────────────────────────
window.exportCSV = function() {
  if (!allResponses.length) { alert('No hay respuestas para exportar.'); return; }

  const surveyId = $('filterResultSurvey').value;
  const survey   = allSurveys.find(s => s.id === surveyId);

  const headers = ['token','fecha','media_global','val_prof_coordinador','val_prof_propia','val_pers_coordinador','val_pers_propia'];
  (survey?.aspects || []).forEach(a => {
    (a.questions || []).forEach(q => headers.push(`${a.title}_${q}`.replace(/,/g,' ')));
  });

  const rows = allResponses.map(r => {
    const date = r.submittedAt?.toDate
      ? r.submittedAt.toDate().toLocaleString('es-ES') : '';
    const base = [
      r.token, date, r.globalAverage||'',
      r.coordinatorProfessionalScore||'', r.coachProfessionalScore||'',
      r.coordinatorPersonalScore||'', r.coachPersonalScore||''
    ];
    (survey?.aspects || []).forEach((a, aIdx) => {
      (a.questions || []).forEach((_, qIdx) => {
        base.push(r.answers?.[`${aIdx}_${qIdx}`] || '');
      });
    });
    return base.join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `respuestas_${surveyId}.csv`;
  a.click(); URL.revokeObjectURL(url);
};

// ── MODALES ───────────────────────────────────────────────
window.closeModal = function(id) {
  hide(id);
};
