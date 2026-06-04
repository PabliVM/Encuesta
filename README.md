# Survey — Encuesta de Valoración · Cantera RM

## Estructura de archivos

```
/
├── index.html           ← App principal (encuestado + admin)
├── css/
│   └── style.css
├── js/
│   ├── firebase-init.js ← Config Firebase
│   └── survey.js        ← Lógica encuesta pública
├── firestore.rules      ← Reglas de seguridad Firestore
├── vercel.json          ← Config despliegue
└── README.md
```

---

## Firestore: estructura de colecciones

### `surveys/{surveyId}`
```json
{
  "title": "Encuesta de Valoración 2024/2025",
  "description": "Valora los siguientes aspectos de la temporada.",
  "season": "2024/2025",
  "createdAt": "<timestamp>",
  "active": true,
  "aspects": [
    {
      "title": "Planificación",
      "icon": "📅",
      "active": true,
      "questions": [
        "¿Cómo valoras la planificación de los entrenamientos?",
        "¿Se han cumplido los objetivos marcados?"
      ]
    },
    {
      "title": "Comunicación",
      "icon": "💬",
      "active": true,
      "questions": [
        "¿Cómo valoras la comunicación interna del equipo?",
        "¿Ha sido fluida la comunicación con coordinación?"
      ]
    }
  ]
}
```

### `surveyTokens/{token}`
```json
{
  "surveyId": "ID_DE_LA_ENCUESTA",
  "used": false,
  "active": true,
  "createdAt": "<timestamp>",
  "usedAt": null,
  "responseId": null
}
```

### `surveyResponses/{responseId}`
```json
{
  "surveyId": "...",
  "token": "...",
  "submittedAt": "<timestamp>",
  "answers": { "0_0": 4, "0_1": 3, "1_0": 5 },
  "aspectComments": { "0": "Buen trabajo", "1": "" },
  "aspectAverages": { "Planificación": 3.5, "Comunicación": 4.0 },
  "globalAverage": 3.75,
  "coordinatorPersonalScore": 4,
  "coordinatorProfessionalScore": 5,
  "coordinatorComment": "...",
  "coachPersonalScore": 3,
  "coachProfessionalScore": 4,
  "coachComment": "...",
  "globalScore": 4,
  "finalComment": "..."
}
```

---

## Cómo crear tokens

En la consola de Firebase (https://console.firebase.google.com):

1. Ir a **Firestore Database → surveyTokens**
2. Añadir documento con ID aleatorio (click en "Auto-ID")
3. Campos:
   - `surveyId` (string): ID del documento de la encuesta
   - `used` (boolean): `false`
   - `active` (boolean): `true`
   - `createdAt` (timestamp): fecha actual

O usar el script de Node.js de administración (Fase 2).

---

## Cómo enviar un enlace único

Una vez creado el token, el enlace es:

```
https://TU-DOMINIO.vercel.app/index.html?token=TOKEN_ID
```

Donde `TOKEN_ID` es el ID del documento en `surveyTokens`.

Ejemplo:
```
https://survey-rm.vercel.app/index.html?token=xK9mP2qRt4
```

Envíalo por WhatsApp, email o como prefieras. Cada persona recibe su propio enlace.

---

## Cómo entra el administrador

**Fase 2** — Panel de administración en construcción.

El admin accederá vía:
```
https://TU-DOMINIO.vercel.app/index.html?admin
```

Necesita login con Firebase Auth (email/contraseña).
Las credenciales se crean manualmente en Firebase Console → Authentication.

---

## Despliegue en Vercel

1. Sube el repo a `PabliVM/Survey` en GitHub
2. Entra en vercel.com → New Project → importa `PabliVM/Survey`
3. No hace falta build command ni output directory (es HTML estático)
4. Deploy

---

## Reglas de Firestore

Copia el contenido de `firestore.rules` en:
Firebase Console → Firestore → Reglas

---

## Notas de seguridad

- El control real de "encuesta ya completada" se hace en Firestore via `runTransaction`.
- `localStorage` no se usa como fuente de verdad, solo podría usarse para preferencias visuales.
- Anonimato real: los tokens no tienen `assignedTo`. El admin no puede saber quién respondió qué.

