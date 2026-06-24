// js/survey.js — Encuesta pública · Cantera RM
// Acceso: index.html?survey=SURVEY_ID
// Control de respuesta única: cookie por dispositivo

import { db } from "./firebase-init.js";
import {
  doc, getDoc, addDoc, collection, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Estado global ─────────────────────────────────────────
let surveyData = null;
let surveyId   = null;
let answers    = {};

// ── Helpers DOM ───────────────────────────────────────────
const show = id => document.getElementById(id).style.display = '';
const hide = id => document.getElementById(id).style.display = 'none';

function showView(name) {
  ['viewLoading','viewInvalid','viewSurvey','viewReview','viewSent']
    .forEach(v => hide(v));
  show(name);
}

function showInvalid(msg) {
  document.getElementById('invalidMsg').textContent = msg;
  showView('viewInvalid');
}

// ── Cookie helpers ────────────────────────────────────────
function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Strict`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

// ── INIT ──────────────────────────────────────────────────
(async function init() {
  const params   = new URLSearchParams(window.location.search);
  surveyId       = params.get('survey');

  // Sin survey ID → enlace inválido
  if (!surveyId) {
    showInvalid("No se ha proporcionado ningún enlace de encuesta válido.");
    return;
  }

  // Comprobar cookie — ya respondió en este dispositivo
  // En modo preview (desde el admin) se salta esta comprobación
  const isPreview = params.get('preview') === '1';
  const cookieKey = `survey_done_${surveyId}`;
  if (!isPreview && getCookie(cookieKey)) {
    showInvalid("Ya has completado esta encuesta en este dispositivo.");
    return;
  }

  try {
    // Cargar encuesta de Firestore
    const surveyRef  = doc(db, "survey", surveyId);
    const surveySnap = await getDoc(surveyRef);

    if (!surveySnap.exists()) {
      showInvalid("Esta encuesta no existe.");
      return;
    }

    surveyData = { id: surveySnap.id, ...surveySnap.data() };

    if (surveyData.active === false) {
      showInvalid("Esta encuesta no está disponible actualmente.");
      return;
    }

    renderSurvey();
    showView('viewSurvey');
    show('progressWrap');
    updateProgress();

  } catch (err) {
    console.error(err);
    showInvalid("Error al cargar la encuesta. Inténtalo de nuevo.");
  }
})();

// ── Renderizar input según tipo de pregunta ──────────────
function renderQuestionInput(qn, aIdx, qIdx) {
  const key = `${aIdx}_${qIdx}`;
  switch(qn.type) {
    case 'scale':
      return `<div class="rating-group" data-aspect="${aIdx}" data-question="${qIdx}">
        ${[1,2,3,4,5].map(n => `<button class="rating-btn" data-val="${n}">${n}</button>`).join('')}
      </div>`;

    case 'text':
      return `<textarea class="comment-input" data-text-answer="${key}"
        placeholder="Escribe tu respuesta…" rows="3"
        oninput="answers['${key}']=this.value"></textarea>`;

    case 'yesno':
      return `<div class="rating-group yesno-group">
        <button class="rating-btn yesno-btn" data-key="${key}" data-val="Sí" onclick="selectYesNo(this,'${key}')">Sí</button>
        <button class="rating-btn yesno-btn" data-key="${key}" data-val="No" onclick="selectYesNo(this,'${key}')">No</button>
      </div>`;

    case 'radio':
      return `<div class="options-group" data-key="${key}">
        ${(qn.options||[]).map((opt,i) => `
          <label class="option-label">
            <input type="radio" name="q_${key}" value="${opt}"
              onchange="answers['${key}']=this.value;updateProgress()">
            <span>${opt}</span>
          </label>`).join('')}
      </div>`;

    case 'checkbox':
      return `<div class="options-group" data-key="${key}">
        ${(qn.options||[]).map((opt,i) => `
          <label class="option-label">
            <input type="checkbox" value="${opt}"
              onchange="updateCheckbox('${key}',this)">
            <span>${opt}</span>
          </label>`).join('')}
      </div>`;

    case 'select':
      return `<select class="form-select-survey" onchange="answers['${key}']=this.value;updateProgress()">
        <option value="">Selecciona una opción…</option>
        ${(qn.options||[]).map(opt => `<option value="${opt}">${opt}</option>`).join('')}
      </select>`;

    default:
      return `<div class="rating-group" data-aspect="${aIdx}" data-question="${qIdx}">
        ${[1,2,3,4,5].map(n => `<button class="rating-btn" data-val="${n}">${n}</button>`).join('')}
      </div>`;
  }
}

window.selectYesNo = function(btn, key) {
  const group = btn.closest('.yesno-group');
  group.querySelectorAll('.yesno-btn').forEach(b => b.className = 'rating-btn yesno-btn');
  btn.classList.add('selected-5');
  answers[key] = btn.dataset.val;
  updateProgress();
};

window.updateCheckbox = function(key, input) {
  const group = input.closest('.options-group');
  const checked = Array.from(group.querySelectorAll('input:checked')).map(i => i.value);
  answers[key] = checked.length ? checked.join(', ') : null;
  updateProgress();
};

// ── Renderizar encuesta ───────────────────────────────────
function renderSurvey() {
  document.getElementById('headerTitle').textContent  = surveyData.title || 'Encuesta de Valoración';
  document.getElementById('headerSeason').textContent = surveyData.season || 'Cantera';
  document.getElementById('surveyTitle').textContent  = surveyData.title || '';
  document.getElementById('surveyDesc').textContent   = surveyData.description || '';

  const container = document.getElementById('aspectsContainer');
  container.innerHTML = '';

  (surveyData.aspects || []).forEach((aspect, aIdx) => {
    if (!aspect.active) return;
    const card = document.createElement('div');
    card.className = 'card aspect-card';

    const questionsHtml = (aspect.questions || []).map((q, qIdx) => {
      // Normalizar pregunta (compatibilidad con formato antiguo string)
      const qn = typeof q === 'string' ? { text: q, type: 'scale', options: [] } : q;
      const inputHtml = renderQuestionInput(qn, aIdx, qIdx);
      const needsComment = qn.type === 'scale'; // solo escala tiene comentario por pregunta
      return `
        <div class="question-row">
          <label class="question-label">${qn.text}</label>
          ${inputHtml}
          ${needsComment ? `<textarea class="comment-input question-comment"
            data-question-comment="${aIdx}_${qIdx}"
            placeholder="Comentario (opcional)…" rows="2"></textarea>` : ''}
        </div>
      `;
    }).join('');

    const isTwoCol = aspect.twoColumns === true && !aspect.isFixed;
    const isFixed  = aspect.isFixed === true;
    if (isFixed) card.classList.add('aspect-card-fixed');
    card.innerHTML = `
      <div class="aspect-header">
        <span class="aspect-icon">${aspect.icon || '📋'}</span>
        <h3 class="aspect-title">${aspect.title}</h3>
      </div>
      ${isTwoCol ? `<div class="two-col-grid">${questionsHtml}</div>` : questionsHtml}
      <div class="comment-wrap">
        <label class="comment-label">Comentario sobre este aspecto <span class="optional">(opcional)</span></label>
        <textarea class="comment-input" data-aspect-comment="${aIdx}"
          placeholder="Escribe aquí tu comentario…" rows="3"></textarea>
      </div>
    `;
    container.appendChild(card);
  });

  attachRatingEvents();
}

// ── Eventos botones 1-5 ───────────────────────────────────
function attachRatingEvents() {
  document.querySelectorAll('.rating-group').forEach(group => {
    group.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.val);
        group.querySelectorAll('.rating-btn').forEach(b => b.className = 'rating-btn');
        btn.classList.add(`selected-${val}`);
        const field       = group.dataset.field;
        const aspectIdx   = group.dataset.aspect;
        const questionIdx = group.dataset.question;
        if (field) answers[field] = val;
        else answers[`${aspectIdx}_${questionIdx}`] = val;
        updateProgress();
      });
    });
  });
}

// ── Progreso ──────────────────────────────────────────────
function updateProgress() {
  const total    = countRequired();
  const answered = Object.keys(answers).filter(k => answers[k] != null).length;
  const pct      = total === 0 ? 0 : Math.round((answered / total) * 100);
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = `${answered} / ${total}`;
}

function countRequired() {
  if (!surveyData) return 0;
  let count = 0;
  (surveyData.aspects || []).forEach(a => { if (a.active) count += (a.questions || []).length; });
  count += 5; // coordinatorPersonal, coordinatorProfessional, coachPersonal, coachProfessional, global
  return count;
}

// ── Validación y revisión ─────────────────────────────────
window.showReview = function() {
  let hasError = false;

  (surveyData.aspects || []).forEach((a, aIdx) => {
    if (!a.active) return;
    (a.questions || []).forEach((q, qIdx) => {
      const qn = typeof q === 'string' ? { text:q, type:'scale' } : q;
      // text y checkbox son opcionales
      if (qn.type === 'text' || qn.type === 'checkbox') return;
      if (!answers[`${aIdx}_${qIdx}`]) {
        hasError = true;
        const group = document.querySelector(`.rating-group[data-aspect="${aIdx}"][data-question="${qIdx}"]`)
          || document.querySelector(`.options-group[data-key="${aIdx}_${qIdx}"]`)
          || document.querySelector(`[data-key="${aIdx}_${qIdx}"]`);
        if (group) {
          group.style.outline = '2px solid var(--red)';
          group.style.borderRadius = 'var(--rs)';
          setTimeout(() => { group.style.outline = ''; }, 800);
        }
      }
    });
  });

  // Los bloques fijos (Profesional/Personal/Global) son ahora aspectos normales
  // su validación ya está cubierta en el loop de aspectos de arriba

  if (hasError) {
    const firstError = document.querySelector('.rating-btn.error');
    if (firstError) firstError.closest('.card').scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }

  buildReview();
  showView('viewReview');
  window.scrollTo({ top:0, behavior:'smooth' });
};

function buildReview() {
  const container = document.getElementById('reviewContent');
  container.innerHTML = '';

  (surveyData.aspects || []).forEach((a, aIdx) => {
    if (!a.active) return;
    const sec = document.createElement('div');
    sec.className = 'review-section';
    sec.innerHTML = `<div class="review-section-title">${a.icon || ''} ${a.title}</div>`;
    (a.questions || []).forEach((q, qIdx) => {
      const qText = typeof q === 'string' ? q : (q.text || '—');
      const qType = typeof q === 'string' ? 'scale' : (q.type || 'scale');
      const score = answers[`${aIdx}_${qIdx}`];
      const scoreDisplay = qType === 'scale' ? `${score} / 5` : (score || '—');
      sec.innerHTML += `
        <div class="review-row">
          <span class="review-q">${qText}</span>
          <span class="review-score score-${score}">${scoreDisplay}</span>
        </div>`;
      const qc = document.querySelector(`[data-question-comment="${aIdx}_${qIdx}"]`)?.value?.trim();
      if (qc) sec.innerHTML += `<div class="review-comment">"${qc}"</div>`;
    });
    const ac = document.querySelector(`[data-aspect-comment="${aIdx}"]`)?.value?.trim();
    if (ac) sec.innerHTML += `<div class="review-comment">"${ac}"</div>`;
    container.appendChild(sec);
  });

  // Bloques fijos ya incluidos como aspectos normales arriba
}

window.backToSurvey = function() {
  showView('viewSurvey');
  window.scrollTo({ top:0, behavior:'smooth' });
};

// ── ENVIAR ────────────────────────────────────────────────
window.submitSurvey = async function() {
  // En modo preview no se guarda nada
  if (new URLSearchParams(window.location.search).get('preview') === '1') {
    alert('Modo preview — las respuestas no se guardan.');
    return;
  }
  const btn = document.getElementById('btnConfirm');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    // Recoger comentarios
    const aspectComments   = {};
    const questionComments = {};
    (surveyData.aspects || []).forEach((a, aIdx) => {
      if (!a.active) return;
      const ac = document.querySelector(`[data-aspect-comment="${aIdx}"]`)?.value?.trim();
      if (ac) aspectComments[aIdx] = ac;
      (a.questions || []).forEach((_, qIdx) => {
        const qc = document.querySelector(`[data-question-comment="${aIdx}_${qIdx}"]`)?.value?.trim();
        if (qc) questionComments[`${aIdx}_${qIdx}`] = qc;
      });
    });

    // Comentarios finales — ya recogidos por aspectos normales

    // Calcular medias
    const aspectAverages = {};
    (surveyData.aspects || []).forEach((a, aIdx) => {
      if (!a.active) return;
      const scores = (a.questions || []).map((_, qIdx) => answers[`${aIdx}_${qIdx}`]).filter(Boolean);
      if (scores.length) aspectAverages[a.title] = +(scores.reduce((s,v)=>s+v,0)/scores.length).toFixed(2);
    });
    const allAvgs = Object.values(aspectAverages);
    const globalAverage = allAvgs.length ? +(allAvgs.reduce((s,v)=>s+v,0)/allAvgs.length).toFixed(2) : null;

    // Guardar respuesta
    await addDoc(collection(db, 'surveyResponses'), {
      surveyId,
      submittedAt:                  serverTimestamp(),
      answers,
      aspectComments,
      questionComments,
      aspectAverages,
      globalAverage,
      // Scores guardados como answers normales (índice de aspecto_pregunta)
    });

    // Marcar cookie — 365 días
    setCookie(`survey_done_${surveyId}`, '1', 365);

    showView('viewSent');
    hide('progressWrap');

  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Enviar encuesta definitivamente';
    alert('Error al enviar. Inténtalo de nuevo.\n' + err.message);
  }
};
