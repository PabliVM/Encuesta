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
  const cookieKey = `survey_done_${surveyId}`;
  if (getCookie(cookieKey)) {
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
    card.innerHTML = `
      <div class="aspect-header">
        <span class="aspect-icon">${aspect.icon || '📋'}</span>
        <h3 class="aspect-title">${aspect.title}</h3>
      </div>
      ${(aspect.questions || []).map((q, qIdx) => `
        <div class="question-row">
          <label class="question-label">${q}</label>
          <div class="rating-group" data-aspect="${aIdx}" data-question="${qIdx}">
            ${[1,2,3,4,5].map(n => `<button class="rating-btn" data-val="${n}">${n}</button>`).join('')}
          </div>
          <textarea class="comment-input question-comment"
            data-question-comment="${aIdx}_${qIdx}"
            placeholder="Comentario (opcional)…" rows="2"></textarea>
        </div>
      `).join('')}
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
      if (!answers[`${aIdx}_${qIdx}`]) {
        hasError = true;
        const group = document.querySelector(`.rating-group[data-aspect="${aIdx}"][data-question="${qIdx}"]`);
        if (group) {
          group.querySelectorAll('.rating-btn').forEach(b => b.classList.add('error'));
          setTimeout(() => group.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('error')), 800);
        }
      }
    });
  });

  const fixedFields = [
    'coordinatorPersonalScore','coordinatorProfessionalScore',
    'coachPersonalScore','coachProfessionalScore','globalScore'
  ];
  fixedFields.forEach(key => {
    if (!answers[key]) {
      hasError = true;
      const group = document.querySelector(`.rating-group[data-field="${key}"]`);
      if (group) {
        group.querySelectorAll('.rating-btn').forEach(b => b.classList.add('error'));
        setTimeout(() => group.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('error')), 800);
      }
    }
  });

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
      const score = answers[`${aIdx}_${qIdx}`];
      sec.innerHTML += `
        <div class="review-row">
          <span class="review-q">${q}</span>
          <span class="review-score score-${score}">${score} / 5</span>
        </div>`;
      const qc = document.querySelector(`[data-question-comment="${aIdx}_${qIdx}"]`)?.value?.trim();
      if (qc) sec.innerHTML += `<div class="review-comment">"${qc}"</div>`;
    });
    const ac = document.querySelector(`[data-aspect-comment="${aIdx}"]`)?.value?.trim();
    if (ac) sec.innerHTML += `<div class="review-comment">"${ac}"</div>`;
    container.appendChild(sec);
  });

  // Bloques fijos
  const fixedSec = document.createElement('div');
  fixedSec.className = 'review-section';
  fixedSec.innerHTML = `<div class="review-section-title">💼 Profesional / 👤 Personal / ⭐ Global</div>
    ${[
      { label:'Val. profesional coordinador', key:'coordinatorProfessionalScore' },
      { label:'Val. profesional propia',      key:'coachProfessionalScore' },
      { label:'Val. personal coordinador',    key:'coordinatorPersonalScore' },
      { label:'Val. personal propia',         key:'coachPersonalScore' },
      { label:'Valoración global',            key:'globalScore' },
    ].map(({ label, key }) => `
      <div class="review-row">
        <span class="review-q">${label}</span>
        <span class="review-score score-${answers[key]}">${answers[key]} / 5</span>
      </div>
    `).join('')}`;
  container.appendChild(fixedSec);
}

window.backToSurvey = function() {
  showView('viewSurvey');
  window.scrollTo({ top:0, behavior:'smooth' });
};

// ── ENVIAR ────────────────────────────────────────────────
window.submitSurvey = async function() {
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

    const coordinatorComment = document.querySelector('[data-field="coordinatorComment"]')?.value?.trim() || '';
    const coachComment       = document.querySelector('[data-field="coachComment"]')?.value?.trim()       || '';
    const finalComment       = document.querySelector('[data-field="finalComment"]')?.value?.trim()       || '';

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
      coordinatorPersonalScore:     answers.coordinatorPersonalScore,
      coordinatorProfessionalScore: answers.coordinatorProfessionalScore,
      coordinatorComment,
      coachPersonalScore:           answers.coachPersonalScore,
      coachProfessionalScore:       answers.coachProfessionalScore,
      coachComment,
      globalScore:                  answers.globalScore,
      finalComment,
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
