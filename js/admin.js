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
// Mostrar spinner mientras Firebase restaura la sesión
const authSpinner = document.createElement('div');
authSpinner.id = 'authSpinner';
authSpinner.className = 'view-center';
authSpinner.innerHTML = '<div class="spinner"></div><p class="loading-text">Comprobando sesión…</p>';
document.querySelector('.main').prepend(authSpinner);
hide('viewLogin');

// Recordar última pestaña activa
const LAST_TAB_KEY = 'admin_last_tab';

onAuthStateChanged(auth, user => {
  hide('authSpinner');
  if (user) {
    currentUser = user;
    $('adminEmail').textContent = user.email;
    show('btnLogout');
    hide('viewLogin');
    show('viewDash');
    loadAllSurveys();
    // Restaurar última pestaña — por defecto Encuestas
    const lastTab = localStorage.getItem(LAST_TAB_KEY) || 'tabEncuestas';
    showTab(lastTab);
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
  const idx = ['tabEncuestas','tabResultados'].indexOf(tabId);
  document.querySelectorAll('.tab-btn')[idx]?.classList.add('active');
  // Recordar pestaña activa para restaurar al refrescar
  localStorage.setItem(LAST_TAB_KEY, tabId);
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
        <button class="btn-sm" onclick="openPreview('${s.id}')">👁 Ver encuesta</button>
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
  // filterResultSurvey ya no existe — resultados usa tarjetas
}

window.openPreview = function(surveyId) {
  const frame = document.getElementById('previewFrame');
  frame.src = `/index.html?survey=${surveyId}`;
  document.getElementById('modalPreview').style.display = 'flex';
};

window.closePreview = function() {
  document.getElementById('previewFrame').src = '';
  document.getElementById('modalPreview').style.display = 'none';
};

window.copyLink = function(surveyId) {
  const link = `${location.origin}/index.html?survey=${surveyId}`;
  navigator.clipboard.writeText(link).then(() => {
    alert('Enlace copiado:\n' + link);
  }).catch(() => {
    prompt('Copia este enlace:', link);
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

// ── Tipos de pregunta disponibles ────────────────────────
const QUESTION_TYPES = [
  { value:'scale',    label:'Escala 1-5' },
  { value:'text',     label:'Texto libre' },
  { value:'radio',    label:'Opción única' },
  { value:'checkbox', label:'Opción múltiple' },
  { value:'yesno',    label:'Sí / No' },
  { value:'select',   label:'Desplegable' },
];

// Normaliza preguntas antiguas (string) al nuevo formato (objeto)
function normalizeQuestion(q) {
  if (typeof q === 'string') return { text: q, type: 'scale', options: [] };
  return { text: q.text||'', type: q.type||'scale', options: q.options||[] };
}

// ── Editor de aspectos ────────────────────────────────────
function syncAspectsFromDOM() {
  document.querySelectorAll('.aspect-editor-item').forEach((el, aIdx) => {
    if (!aspectsData[aIdx]) return;
    const titleInput = el.querySelector('.aspect-title-input');
    const iconInput  = el.querySelector('.aspect-icon-input');
    if (titleInput) aspectsData[aIdx].title = titleInput.value;
    if (iconInput)  aspectsData[aIdx].icon  = iconInput.value;
    el.querySelectorAll('.question-editor-row').forEach((row, qIdx) => {
      if (!aspectsData[aIdx].questions[qIdx]) return;
      const textInput = row.querySelector('.question-text-input');
      const typeSelect = row.querySelector('.question-type-select');
      if (textInput)  aspectsData[aIdx].questions[qIdx].text = textInput.value;
      if (typeSelect) aspectsData[aIdx].questions[qIdx].type = typeSelect.value;
      // Opciones (para radio/checkbox/select)
      const optInputs = row.querySelectorAll('.option-input');
      if (optInputs.length) {
        aspectsData[aIdx].questions[qIdx].options = Array.from(optInputs).map(i => i.value).filter(Boolean);
      }
    });
  });
}

function renderOptionsEditor(aIdx, qIdx, options) {
  const hasOptions = ['radio','checkbox','select'].includes(aspectsData[aIdx]?.questions[qIdx]?.type);
  if (!hasOptions) return '';
  const opts = (options||[]).length ? options : [''];
  return `
    <div class="options-editor" style="margin-top:6px;padding:8px;background:var(--bg);border-radius:var(--rs)">
      <div style="font-size:11px;font-weight:700;color:var(--text-mut);margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px">Opciones</div>
      ${opts.map((opt, oIdx) => `
        <div style="display:flex;gap:6px;margin-bottom:4px">
          <input class="form-input option-input" value="${(opt||'').replace(/"/g,'&quot;')}"
            placeholder="Opción ${oIdx+1}" style="height:32px;font-size:12px">
          <button class="btn-remove" onclick="removeOption(${aIdx},${qIdx},${oIdx})">✕</button>
        </div>
      `).join('')}
      <button class="add-question-btn" onclick="addOption(${aIdx},${qIdx})">+ Añadir opción</button>
    </div>
  `;
}

function renderAspectsEditor() {
  const el = $('aspectsEditor');
  const total = aspectsData.length;
  el.innerHTML = aspectsData.map((a, aIdx) => {
    const totalQ = (a.questions||[]).length;
    return `
    <div class="aspect-editor-item">
      <div class="aspect-editor-header">
        <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
          <button class="btn-order" onclick="moveAspect(${aIdx},-1)" ${aIdx===0?'disabled':''}>↑</button>
          <button class="btn-order" onclick="moveAspect(${aIdx},1)" ${aIdx===total-1?'disabled':''}>↓</button>
        </div>
        <input class="form-input aspect-title-input" value="${(a.title||'').replace(/"/g,'&quot;')}"
          placeholder="Nombre del aspecto (ej: Metodología)">
        <input class="form-input aspect-icon-input" style="width:60px" value="${a.icon || '📋'}"
          placeholder="Icono">
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-sec);white-space:nowrap;flex-shrink:0;cursor:pointer">
          <input type="checkbox" ${a.twoColumns?'checked':''} onchange="toggleTwoColumns(${aIdx},this.checked)">
          2 col.
        </label>
        <button class="btn-remove" onclick="removeAspect(${aIdx})">✕</button>
      </div>
      <div class="questions-list">
        ${(a.questions||[]).map((q, qIdx) => {
          const qn = normalizeQuestion(q);
          aspectsData[aIdx].questions[qIdx] = qn;
          return `
          <div class="question-editor-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <div style="display:flex;gap:4px;align-items:center">
              <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0">
                <button class="btn-order" onclick="moveQuestion(${aIdx},${qIdx},-1)" ${qIdx===0?'disabled':''}>↑</button>
                <button class="btn-order" onclick="moveQuestion(${aIdx},${qIdx},1)" ${qIdx===totalQ-1?'disabled':''}>↓</button>
              </div>
              <input class="form-input question-text-input" value="${(qn.text||'').replace(/"/g,'&quot;')}"
                placeholder="Texto de la pregunta" style="flex:1">
              <select class="form-select question-type-select" onchange="changeQuestionType(${aIdx},${qIdx},this.value)" style="width:130px">
                ${QUESTION_TYPES.map(t => `<option value="${t.value}" ${qn.type===t.value?'selected':''}>${t.label}</option>`).join('')}
              </select>
              <button class="btn-remove" onclick="removeQuestion(${aIdx},${qIdx})">✕</button>
            </div>
            ${renderOptionsEditor(aIdx, qIdx, qn.options)}
          </div>`;
        }).join('')}
      </div>
      <button class="add-question-btn" onclick="addQuestion(${aIdx})">+ Añadir pregunta</button>
    </div>`;
  }).join('');
}

window.changeQuestionType = function(aIdx, qIdx, type) {
  syncAspectsFromDOM();
  aspectsData[aIdx].questions[qIdx].type = type;
  if (['radio','checkbox','select'].includes(type) && !aspectsData[aIdx].questions[qIdx].options?.length) {
    aspectsData[aIdx].questions[qIdx].options = ['',''];
  }
  renderAspectsEditor();
};

window.addOption = function(aIdx, qIdx) {
  syncAspectsFromDOM();
  if (!aspectsData[aIdx].questions[qIdx].options) aspectsData[aIdx].questions[qIdx].options = [];
  aspectsData[aIdx].questions[qIdx].options.push('');
  renderAspectsEditor();
};

window.removeOption = function(aIdx, qIdx, oIdx) {
  syncAspectsFromDOM();
  aspectsData[aIdx].questions[qIdx].options.splice(oIdx, 1);
  renderAspectsEditor();
};
window.moveAspect = function(idx, dir) {
  syncAspectsFromDOM();
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= aspectsData.length) return;
  [aspectsData[idx], aspectsData[newIdx]] = [aspectsData[newIdx], aspectsData[idx]];
  renderAspectsEditor();
};

window.moveQuestion = function(aIdx, qIdx, dir) {
  syncAspectsFromDOM();
  const qs = aspectsData[aIdx].questions;
  const newIdx = qIdx + dir;
  if (newIdx < 0 || newIdx >= qs.length) return;
  [qs[qIdx], qs[newIdx]] = [qs[newIdx], qs[qIdx]];
  renderAspectsEditor();
};

window.toggleTwoColumns = function(aIdx, val) {
  syncAspectsFromDOM();
  aspectsData[aIdx].twoColumns = val;
  renderAspectsEditor();
};

window.addAspect = function() {
  syncAspectsFromDOM();
  aspectsData.push({ title:'', icon:'📋', active:true, questions:[{ text:'', type:'scale', options:[] }] });
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
  aspectsData[aIdx].questions.push({ text:'', type:'scale', options:[] });
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
// ── Resultados: lista de encuestas ───────────────────────
window.loadResults = async function() {
  // Cargar conteo de respuestas por encuesta
  const snap = await getDocs(collection(db, 'surveyResponses'));
  const allResp = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const cards = $('resultsSurveyCards');
  if (!allSurveys.length) {
    cards.innerHTML = '<p style="color:var(--text-mut);font-size:13px">No hay encuestas.</p>';
    return;
  }

  cards.innerHTML = allSurveys.map(s => {
    const responses = allResp.filter(r => r.surveyId === s.id);
    const count = responses.length;
    const avgs  = responses.map(r => r.globalAverage).filter(Boolean);
    const mean  = avgs.length ? (avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(2) : '—';

    return `
      <div class="survey-item" style="cursor:pointer" onclick="openResultsSurvey('${s.id}')">
        <div class="survey-item-info">
          <div class="survey-item-title">${s.title || 'Sin título'}</div>
          <div class="survey-item-meta">${s.season || ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
          <div style="text-align:center">
            <div style="font-size:22px;font-weight:800;color:var(--rm-blue)">${count}</div>
            <div style="font-size:10px;color:var(--text-mut);text-transform:uppercase;letter-spacing:.3px">Respuestas</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:22px;font-weight:800;color:var(--green)">${mean}</div>
            <div style="font-size:10px;color:var(--text-mut);text-transform:uppercase;letter-spacing:.3px">Media</div>
          </div>
          <span style="color:var(--text-mut);font-size:18px">›</span>
        </div>
      </div>
    `;
  }).join('');
};

// ── Resultados: entrar al detalle de una encuesta ─────────
window.openResultsSurvey = async function(surveyId) {
  const survey = allSurveys.find(s => s.id === surveyId);
  $('resultsDetailTitle').textContent = survey?.title || 'Resultados';

  const snap = await getDocs(
    query(collection(db, 'surveyResponses'), where('surveyId', '==', surveyId))
  );
  allResponses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  hide('resultsSurveyList');
  show('resultsDetail');

  renderResultsSummary(survey);
  renderResponsesList();
};

window.backToResultsList = function() {
  hide('resultsDetail');
  show('resultsSurveyList');
  $('resultsSummary').innerHTML = '';
  $('resultsList').innerHTML = '';
  allResponses = [];
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
        const qText = typeof q === 'string' ? q : (q.text || '—');
        const qType = typeof q === 'string' ? 'scale' : (q.type || 'scale');
        const allAnswers = allResponses.map(r => r.answers?.[`${aIdx}_${qIdx}`]).filter(v => v != null && v !== '');

        // Comentarios por pregunta
        const qComments = allResponses.map(r => r.questionComments?.[`${aIdx}_${qIdx}`]).filter(Boolean);
        const commentsHtml = qComments.length ? `
          <div style="margin-top:6px;padding:6px 10px;background:var(--surface-alt);border-radius:var(--rs)">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--text-mut);margin-bottom:4px">Comentarios (${qComments.length})</div>
            ${qComments.map((c,i) => `<div style="font-size:12px;color:var(--text-sec);font-style:italic;padding:2px 0;border-bottom:1px solid var(--border-light)">${i+1}. "${c}"</div>`).join('')}
          </div>` : '';

        let qBodyHtml = '';

        if (qType === 'scale') {
          // Barras 1-5
          const scores = allAnswers.map(v => parseInt(v)).filter(v => !isNaN(v));
          const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
          const dist = [1,2,3,4,5].map(v => scores.filter(s=>s===v).length);
          const max  = Math.max(...dist, 1);
          const colors = ['#dc2626','#ea580c','#ca8a04','#16a34a','#2563eb'];
          qBodyHtml = `
            <div style="font-size:11px;color:var(--text-mut);margin-bottom:4px">${scores.length} respuesta(s) · Media: <strong style="color:var(--rm-blue)">${avg}</strong></div>
            ${dist.map((count,i) => `
              <div class="bar-row">
                <span class="bar-label">${i+1}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(count/max*100).toFixed(0)}%;background:${colors[i]}"></div></div>
                <span class="bar-count">${count}</span>
              </div>`).join('')}`;

        } else if (qType === 'text') {
          // Lista de respuestas de texto
          qBodyHtml = allAnswers.length
            ? `<div style="font-size:11px;color:var(--text-mut);margin-bottom:6px">${allAnswers.length} respuesta(s)</div>
               ${allAnswers.map((v,i) => `<div style="font-size:12px;color:var(--text-sec);font-style:italic;padding:4px 8px;background:var(--surface-alt);border-radius:var(--rs);margin-bottom:4px">${i+1}. "${v}"</div>`).join('')}`
            : `<div style="font-size:11px;color:var(--text-mut)">Sin respuestas</div>`;

        } else if (qType === 'yesno') {
          // Conteo Sí / No
          const si = allAnswers.filter(v => v === 'Sí').length;
          const no = allAnswers.filter(v => v === 'No').length;
          const tot = si + no || 1;
          qBodyHtml = `
            <div style="font-size:11px;color:var(--text-mut);margin-bottom:6px">${allAnswers.length} respuesta(s)</div>
            <div class="bar-row">
              <span class="bar-label" style="width:24px">Sí</span>
              <div class="bar-track"><div class="bar-fill" style="width:${(si/tot*100).toFixed(0)}%;background:#16a34a"></div></div>
              <span class="bar-count">${si}</span>
            </div>
            <div class="bar-row">
              <span class="bar-label" style="width:24px">No</span>
              <div class="bar-track"><div class="bar-fill" style="width:${(no/tot*100).toFixed(0)}%;background:#dc2626"></div></div>
              <span class="bar-count">${no}</span>
            </div>`;

        } else if (qType === 'radio' || qType === 'select') {
          // Conteo por opción
          const counts = {};
          allAnswers.forEach(v => { counts[v] = (counts[v]||0) + 1; });
          const max = Math.max(...Object.values(counts), 1);
          qBodyHtml = `
            <div style="font-size:11px;color:var(--text-mut);margin-bottom:6px">${allAnswers.length} respuesta(s)</div>
            ${Object.entries(counts).map(([opt,count]) => `
              <div class="bar-row">
                <span style="font-size:11px;color:var(--text-sec);min-width:80px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${opt}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(count/max*100).toFixed(0)}%;background:var(--rm-blue)"></div></div>
                <span class="bar-count">${count}</span>
              </div>`).join('')}`;

        } else if (qType === 'checkbox') {
          // Conteo por opción (múltiple)
          const counts = {};
          allAnswers.forEach(v => {
            String(v).split(', ').forEach(opt => { counts[opt] = (counts[opt]||0) + 1; });
          });
          const max = Math.max(...Object.values(counts), 1);
          qBodyHtml = `
            <div style="font-size:11px;color:var(--text-mut);margin-bottom:6px">${allAnswers.length} respuesta(s) (selección múltiple)</div>
            ${Object.entries(counts).map(([opt,count]) => `
              <div class="bar-row">
                <span style="font-size:11px;color:var(--text-sec);min-width:80px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${opt}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(count/max*100).toFixed(0)}%;background:var(--rm-blue)"></div></div>
                <span class="bar-count">${count}</span>
              </div>`).join('')}`;
        }

        aspectHtml += `
          <div style="margin-bottom:14px">
            <div style="font-size:12px;color:var(--text-sec);margin-bottom:6px;font-weight:600">${qText}</div>
            ${qBodyHtml}
            ${commentsHtml}
          </div>`;
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
  if (!allResponses.length) {
    el.innerHTML = '<p style="color:var(--text-mut);font-size:13px;margin-top:12px">No hay respuestas todavía.</p>';
    return;
  }

  el.innerHTML = `
    <h3 style="font-size:14px;font-weight:700;margin:16px 0 8px">Respuestas individuales (${allResponses.length})</h3>
    ${allResponses.map((r, idx) => {
      const date = r.submittedAt?.toDate
        ? r.submittedAt.toDate().toLocaleString('es-ES')
        : '—';
      return `
        <div class="response-item">
          <div style="cursor:pointer;flex:1" onclick="openResponse('${r.id}')">
            <div style="font-size:13px;font-weight:700">Respuesta ${idx + 1}</div>
            <div class="response-date">${date}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            <div class="response-avg">${r.globalAverage || '—'}</div>
            <button class="btn-danger" onclick="deleteResponse('${r.id}', event)" style="height:30px;padding:0 10px">🗑</button>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

window.openResponse = function(id) {
  const r = allResponses.find(x => x.id === id);
  if (!r) return;

  const surveyId = allResponses[0]?.surveyId || '';
  const survey   = allSurveys.find(s => s.id === surveyId);
  const date = r.submittedAt?.toDate
    ? r.submittedAt.toDate().toLocaleString('es-ES') : '—';

  let html = `<p style="font-size:12px;color:var(--text-mut);margin-bottom:16px">Enviado: ${date}</p>`;

  (survey?.aspects || []).forEach((a, aIdx) => {
    if (!a.active) return;
    html += `<div class="detail-section">
      <div class="detail-section-title">${a.icon || ''} ${a.title}</div>`;
    (a.questions || []).forEach((q, qIdx) => {
      // Normalizar — preguntas pueden ser string (antiguo) u objeto (nuevo)
      const qText = typeof q === 'string' ? q : (q.text || '—');
      const qType = typeof q === 'string' ? 'scale' : (q.type || 'scale');
      const score   = r.answers?.[`${aIdx}_${qIdx}`];
      const comment = r.questionComments?.[`${aIdx}_${qIdx}`] || '';
      const scoreDisplay = score != null ? score : '—';
      const scoreLabel = qType === 'scale' ? `${scoreDisplay}/5` : (scoreDisplay || '—');
      html += `<div class="detail-row">
        <span class="detail-q">${qText}</span>
        <span class="detail-score score-${scoreDisplay}">${scoreLabel}</span>
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
window.deleteResponse = async function(id, event) {
  event.stopPropagation();
  if (!confirm('¿Eliminar esta respuesta? Esta acción no se puede deshacer.')) return;
  await deleteDoc(doc(db, 'surveyResponses', id));
  allResponses = allResponses.filter(r => r.id !== id);
  renderResponsesList();
  // Actualizar también la lista de tarjetas
  loadResults();
};

window.exportCSV = function() {
  if (!allResponses.length) { alert('No hay respuestas para exportar.'); return; }

  const surveyId = allResponses[0]?.surveyId || '';
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
