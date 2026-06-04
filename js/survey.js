// js/survey.js
import { db } from "./firebase-init.js";
import {
  doc, getDoc, updateDoc, addDoc,
  collection, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Estado global ────────────────────────────────────────
let surveyData = null;   // config de la encuesta (de Firestore)
let tokenId    = null;   // ID del token (doc ID en surveyTokens)
let tokenData  = null;   // datos del token
let answers    = {};     // { aspectId_questionIdx: score, coordinatorPersonalScore: n, … }

// ─── Helpers de vistas ────────────────────────────────────
const show = id => document.getElementById(id).style.display = '';
const hide = id => document.getElementById(id).style.display = 'none';

function showView(name) {
  ['viewLoading','viewInvalid','viewSurvey','viewReview','viewSent']
    .forEach(v => hide(v));
  show(name);
}

// ─── INIT ─────────────────────────────────────────────────
(async function init() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');

  // Sin token → redirige a admin si lleva ?admin
  if (!token) {
    if (params.has('admin')) return; // admin.js lo maneja
    showInvalid("No se ha proporcionado ningún token de acceso.");
    return;
  }

  tokenId = token;

  try {
    // 1. Leer token en Firestore
    const tokenRef  = doc(db, "surveyTokens", token);
    const tokenSnap = await getDoc(tokenRef);

    if (!tokenSnap.exists()) {
      showInvalid("El enlace no existe o no es válido.");
      return;
    }

    tokenData = tokenSnap.data();

    if (tokenData.used) {
      showInvalid("Esta encuesta ya ha sido completada.");
      return;
    }
    if (tokenData.active === false) {
      showInvalid("Este enlace ha sido desactivado.");
      return;
    }

    // 2. Leer configuración de la encuesta
    const surveyRef  = doc(db, "survey", tokenData.surveyId);
    const surveySnap = await getDoc(surveyRef);

    if (!surveySnap.exists()) {
      showInvalid("La encuesta asociada a este enlace no existe.");
      return;
    }

    surveyData = { id: surveySnap.id, ...surveySnap.data() };

    // 3. Renderizar encuesta
    renderSurvey();
    showView('viewSurvey');
    show('progressWrap');
    updateProgress();

  } catch (err) {
    console.error(err);
    showInvalid("Error al cargar la encuesta. Inténtalo de nuevo.");
  }
})();

// ─── Mostrar pantalla de error ─────────────────────────────
function showInvalid(msg) {
  document.getElementById('invalidMsg').textContent = msg;
  showView('viewInvalid');
}

// ─── Renderizar aspectos desde surveyData ─────────────────
function renderSurvey() {
  document.getElementById('headerTitle').textContent = surveyData.title || 'Encuesta de Valoración';
  document.getElementById('headerSeason').textContent = surveyData.season || 'Cantera';
  document.getElementById('surveyTitle').textContent  = surveyData.title || '';
  document.getElementById('surveyDesc').textContent   = surveyData.description || '';

  const container = document.getElementById('aspectsContainer');
  container.innerHTML = '';

  const aspects = surveyData.aspects || [];
  aspects.forEach((aspect, aIdx) => {
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
          <textarea class="comment-input question-comment" data-question-comment="${aIdx}_${qIdx}"
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

  // Vincular eventos a todos los rating-groups
  attachRatingEvents();
}

// ─── Eventos de botones de valoración ─────────────────────
function attachRatingEvents() {
  document.querySelectorAll('.rating-group').forEach(group => {
    group.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.val);

        // Limpiar selección anterior del grupo
        group.querySelectorAll('.rating-btn').forEach(b => {
          b.className = 'rating-btn';
        });

        // Marcar seleccionado
        btn.classList.add(`selected-${val}`);

        // Guardar en answers
        const field      = group.dataset.field;
        const aspectIdx  = group.dataset.aspect;
        const questionIdx= group.dataset.question;

        if (field) {
          answers[field] = val;
        } else {
          answers[`${aspectIdx}_${questionIdx}`] = val;
        }

        updateProgress();
      });
    });
  });
}

// ─── Progreso visual ───────────────────────────────────────
function updateProgress() {
  const totalRequired = countRequiredQuestions();
  const answered      = countAnswered();
  const pct           = totalRequired === 0 ? 0 : Math.round((answered / totalRequired) * 100);

  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = `${answered} / ${totalRequired}`;
}

function countRequiredQuestions() {
  if (!surveyData) return 0;
  let count = 0;
  (surveyData.aspects || []).forEach((a, aIdx) => {
    if (a.active) count += (a.questions || []).length;
  });
  count += 5; // coordinatorPersonal, coordinatorProfessional, coachPersonal, coachProfessional, global
  return count;
}

function countAnswered() {
  return Object.keys(answers).filter(k => answers[k] != null).length;
}

// ─── Validación previa al resumen ─────────────────────────
window.showReview = function() {
  const missing = [];

  // Aspectos dinámicos
  (surveyData.aspects || []).forEach((a, aIdx) => {
    if (!a.active) return;
    (a.questions || []).forEach((q, qIdx) => {
      const key = `${aIdx}_${qIdx}`;
      if (!answers[key]) {
        missing.push(`${a.title}: ${q}`);
        // Marcar botones con error visual
        const group = document.querySelector(
          `.rating-group[data-aspect="${aIdx}"][data-question="${qIdx}"]`
        );
        if (group) group.querySelectorAll('.rating-btn').forEach(b => b.classList.add('error'));
        setTimeout(() => {
          if (group) group.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('error'));
        }, 800);
      }
    });
  });

  // Bloques fijos
  const fixedFields = [
    { key:'coordinatorPersonalScore',     label:'Valoración personal del coordinador' },
    { key:'coordinatorProfessionalScore', label:'Valoración profesional del coordinador' },
    { key:'coachPersonalScore',           label:'Valoración personal propia' },
    { key:'coachProfessionalScore',       label:'Valoración profesional propia' },
    { key:'globalScore',                  label:'Valoración global de la temporada' },
  ];
  fixedFields.forEach(({ key, label }) => {
    if (!answers[key]) {
      missing.push(label);
      const group = document.querySelector(`.rating-group[data-field="${key}"]`);
      if (group) {
        group.querySelectorAll('.rating-btn').forEach(b => b.classList.add('error'));
        setTimeout(() => {
          group.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('error'));
        }, 800);
      }
    }
  });

  if (missing.length > 0) {
    // Scroll al primer campo sin respuesta
    const firstError = document.querySelector('.rating-btn.error');
    if (firstError) firstError.closest('.card').scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }

  buildReview();
  showView('viewReview');
  window.scrollTo({ top:0, behavior:'smooth' });
};

// ─── Construir pantalla de revisión ───────────────────────
function buildReview() {
  const container = document.getElementById('reviewContent');
  container.innerHTML = '';

  const aspects = surveyData.aspects || [];
  aspects.forEach((a, aIdx) => {
    if (!a.active) return;

    const sec = document.createElement('div');
    sec.className = 'review-section';
    sec.innerHTML = `<div class="review-section-title">${a.icon || ''} ${a.title}</div>`;

    (a.questions || []).forEach((q, qIdx) => {
      const score = answers[`${aIdx}_${qIdx}`];
      const row = document.createElement('div');
      row.className = 'review-row';
      row.innerHTML = `
        <span class="review-q">${q}</span>
        <span class="review-score score-${score}">${score} / 5</span>
      `;
      sec.appendChild(row);
    });

    const comment = document.querySelector(`[data-aspect-comment="${aIdx}"]`)?.value?.trim();
    if (comment) {
      const c = document.createElement('div');
      c.className = 'review-comment';
      c.textContent = `"${comment}"`;
      sec.appendChild(c);
    }

    container.appendChild(sec);
  });

  // Bloques fijos
  const fixedSec = document.createElement('div');
  fixedSec.className = 'review-section';
  fixedSec.innerHTML = `<div class="review-section-title">👤 Coordinador / Técnico / Global</div>`;

  const fixedRows = [
    { label:'Val. personal coordinador',      key:'coordinatorPersonalScore' },
    { label:'Val. profesional coordinador',   key:'coordinatorProfessionalScore' },
    { label:'Val. personal propia',           key:'coachPersonalScore' },
    { label:'Val. profesional propia',        key:'coachProfessionalScore' },
    { label:'Valoración global temporada',    key:'globalScore' },
  ];
  fixedRows.forEach(({ label, key }) => {
    const score = answers[key];
    const row = document.createElement('div');
    row.className = 'review-row';
    row.innerHTML = `
      <span class="review-q">${label}</span>
      <span class="review-score score-${score}">${score} / 5</span>
    `;
    fixedSec.appendChild(row);
  });

  // Comentarios fijos
  ['coordinatorComment','coachComment','finalComment'].forEach(field => {
    const val = document.querySelector(`[data-field="${field}"]`)?.value?.trim();
    if (val) {
      const c = document.createElement('div');
      c.className = 'review-comment';
      c.textContent = `"${val}"`;
      fixedSec.appendChild(c);
    }
  });

  container.appendChild(fixedSec);
}

// ─── Volver a editar desde revisión ───────────────────────
window.backToSurvey = function() {
  showView('viewSurvey');
  window.scrollTo({ top:0, behavior:'smooth' });
};

// ─── ENVIAR ENCUESTA ──────────────────────────────────────
window.submitSurvey = async function() {
  const btn = document.getElementById('btnConfirm');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    // Recoger comentarios desde el DOM
    const aspectComments = {};
    const questionComments = {};
    (surveyData.aspects || []).forEach((a, aIdx) => {
      if (!a.active) return;
      const val = document.querySelector(`[data-aspect-comment="${aIdx}"]`)?.value?.trim();
      if (val) aspectComments[aIdx] = val;
      (a.questions || []).forEach((_, qIdx) => {
        const qVal = document.querySelector(`[data-question-comment="${aIdx}_${qIdx}"]`)?.value?.trim();
        if (qVal) questionComments[`${aIdx}_${qIdx}`] = qVal;
      });
    });

    const coordinatorComment = document.querySelector('[data-field="coordinatorComment"]')?.value?.trim() || '';
    const coachComment       = document.querySelector('[data-field="coachComment"]')?.value?.trim()       || '';
    const finalComment       = document.querySelector('[data-field="finalComment"]')?.value?.trim()       || '';

    // Calcular medias por aspecto
    const aspectAverages = {};
    (surveyData.aspects || []).forEach((a, aIdx) => {
      if (!a.active) return;
      const scores = (a.questions || []).map((_, qIdx) => answers[`${aIdx}_${qIdx}`]).filter(Boolean);
      if (scores.length) {
        aspectAverages[a.title] = +(scores.reduce((s,v) => s+v, 0) / scores.length).toFixed(2);
      }
    });

    // Media global (todas las preguntas de aspectos)
    const allAspectScores = Object.values(aspectAverages);
    const globalAverage = allAspectScores.length
      ? +(allAspectScores.reduce((s,v) => s+v, 0) / allAspectScores.length).toFixed(2)
      : null;

    // Construir objeto de respuesta
    const responseData = {
      surveyId:                   surveyData.id,
      token:                      tokenId,
      submittedAt:                serverTimestamp(),
      answers:                    answers,
      aspectComments:             aspectComments,
      questionComments:           questionComments,
      aspectAverages:             aspectAverages,
      globalAverage:              globalAverage,
      coordinatorPersonalScore:   answers.coordinatorPersonalScore,
      coordinatorProfessionalScore: answers.coordinatorProfessionalScore,
      coordinatorComment:         coordinatorComment,
      coachPersonalScore:         answers.coachPersonalScore,
      coachProfessionalScore:     answers.coachProfessionalScore,
      coachComment:               coachComment,
      globalScore:                answers.globalScore,
      finalComment:               finalComment,
    };

    // Transacción atómica: crear respuesta + marcar token como usado
    const tokenRef    = doc(db, "surveyTokens", tokenId);
    const responsesRef = collection(db, "surveyResponses");

    let responseId;

    await runTransaction(db, async (transaction) => {
      const tokenSnap = await transaction.get(tokenRef);

      if (!tokenSnap.exists() || tokenSnap.data().used) {
        throw new Error("Token ya utilizado o no existe.");
      }

      const newResponseRef = doc(responsesRef);
      responseId = newResponseRef.id;

      transaction.set(newResponseRef, responseData);
      transaction.update(tokenRef, {
        used:       true,
        usedAt:     serverTimestamp(),
        responseId: responseId,
      });
    });

    showView('viewSent');
    hide('progressWrap');

  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Enviar encuesta definitivamente';
    alert('Error al enviar la encuesta: ' + err.message + '\nInténtalo de nuevo.');
  }
};
