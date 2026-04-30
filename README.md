# 🚀 CRM Ventas Pro — Guía de Instalación y Despliegue

## 📁 Archivos del proyecto

```
crm-ventas/
├── index.html        ← Interfaz principal
├── styles.css        ← Estilos (diseño oscuro profesional)
├── app.js            ← Lógica de la aplicación
├── firebase.js       ← Conexión y servicios de Firebase
├── manifest.json     ← Configuración PWA
├── service-worker.js ← Cache offline
└── README.md         ← Este archivo
```

---

## 🔧 PASO 1 — Crear proyecto en Firebase

1. Ve a **https://console.firebase.google.com/**
2. Haz clic en **"Crear un proyecto"**
3. Ponle nombre: `crm-ventas-pro` (o el que quieras)
4. Desactiva Google Analytics (opcional)
5. Clic en **"Crear proyecto"**

---

## 🔐 PASO 2 — Obtener credenciales

1. En la consola de Firebase, haz clic en el ícono **`</>`** (Web)
2. Registra la app con nombre: `crm-ventas-web`
3. **NO** marques Firebase Hosting todavía
4. Copia el objeto `firebaseConfig` que aparece:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "crm-ventas-pro.firebaseapp.com",
  projectId: "crm-ventas-pro",
  storageBucket: "crm-ventas-pro.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

5. Abre `firebase.js` y **reemplaza** el bloque `firebaseConfig` con tus datos.

---

## 🗄️ PASO 3 — Configurar Firestore

1. En Firebase Console → **"Firestore Database"**
2. Clic en **"Crear base de datos"**
3. Selecciona **"Modo de producción"**
4. Elige la región más cercana (ej: `us-east1`)

### Reglas de seguridad recomendadas:

En la pestaña **"Reglas"** de Firestore, pega esto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Solo usuarios autenticados pueden leer/escribir
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 🗂️ PASO 4 — Configurar Storage (para fotos)

1. Firebase Console → **"Storage"**
2. Clic en **"Comenzar"**
3. Modo producción → Elige región

### Reglas de Storage:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 👤 PASO 5 — Crear usuarios (Authentication)

1. Firebase Console → **"Authentication"**
2. Clic en **"Comenzar"**
3. Habilita **"Correo electrónico/contraseña"**
4. Ve a la pestaña **"Usuarios"**
5. Clic en **"Agregar usuario"**
6. Crea los usuarios:
   - `vendedor@empresa.com` / contraseña segura
   - `oficina@empresa.com` / contraseña segura

> ⚠️ Después del primer login, el perfil del usuario se guarda automáticamente en Firestore con su rol.

---

## 🌐 PASO 6 — Desplegar GRATIS en Firebase Hosting

### Instalar Firebase CLI:
```bash
npm install -g firebase-tools
```

### Login:
```bash
firebase login
```

### Inicializar en tu carpeta del proyecto:
```bash
cd crm-ventas
firebase init hosting
```

Responde:
- **Project:** selecciona tu proyecto
- **Public directory:** `.` (punto, carpeta actual)
- **Single-page app:** `Yes`
- **Overwrite index.html:** `No`

### Desplegar:
```bash
firebase deploy
```

Tu app estará en: `https://crm-ventas-pro.web.app` 🎉

---

## 📱 PASO 7 — Instalar como app en celular

### Android (Chrome):
1. Abre la URL en Chrome
2. Aparece banner **"Instalar app"** → toca **Instalar**
3. O toca menú ⋮ → **"Agregar a pantalla de inicio"**

### iPhone (Safari):
1. Abre la URL en Safari
2. Toca el ícono **Compartir** (cajita con flecha)
3. Selecciona **"Agregar a pantalla de inicio"**
4. Ponle nombre y toca **Agregar**

---

## 🖥️ Alternativa: Desplegar en GitHub Pages (también gratis)

1. Sube los archivos a un repositorio GitHub
2. Ve a **Settings → Pages**
3. Selecciona rama `main` y carpeta `/` (root)
4. Tu app estará en: `https://tuusuario.github.io/crm-ventas`

> ⚠️ En GitHub Pages necesitas agregar un archivo `.nojekyll` vacío en la raíz.

---

## 📄 Cómo usar los reportes PDF

1. Ve a la sección **"Reportes"** (ícono 📄 en la navegación)
2. Selecciona el tipo:
   - **Ventas** — total vendido, cobrado, detalle de pedidos
   - **Clientes nuevos** — registros del período
   - **Inactivos** — clientes sin actividad en +30 días
   - **Consignaciones** — stock pendiente por cliente
3. Elige el **rango de fechas** (inicio y fin)
4. Toca **"Generar PDF"**
5. El archivo se descarga automáticamente

**Nombre del archivo:** `reporte_ventas_abril_2025.pdf`

---

## 🔑 Roles de usuario

| Rol       | Descripción                              |
|-----------|------------------------------------------|
| vendedor  | Crea pedidos, ve sus propios pedidos     |
| oficina   | Ve todos los pedidos, genera reportes    |

Para asignar rol `oficina`, después del primer login del usuario, busca su documento en Firestore (`colección: usuarios`) y cambia `rol` a `"oficina"`.

---

## 🐛 Solución de problemas frecuentes

**Error: "Firebase not configured"**
→ Verifica que reemplazaste las credenciales en `firebase.js`

**Error: "permission-denied"**
→ Verifica las reglas de Firestore y Storage

**La app no carga offline**
→ Asegúrate de que el Service Worker está registrado (abre DevTools → Application → Service Workers)

**PDF no se descarga**
→ Verifica que los CDN de jsPDF carguen (requiere internet para la primera carga)

---

## 📞 Estructura de datos en Firestore

### Colección `pedidos`
```json
{
  "escuela": "Primaria Benito Juárez",
  "contacto": "María García",
  "telefono": "5512345678",
  "producto": "Juguetes educativos",
  "cantidad": 20,
  "precioUnitario": 150,
  "tipoVenta": "consignacion",
  "estado": "entregado",
  "cantidadDejada": 20,
  "cantidadVendida": 8,
  "cantidadRestante": 12,
  "estadoConsignacion": "parcial",
  "ubicacion": { "lat": 19.432, "lng": -99.133 },
  "vendedorId": "uid-del-vendedor",
  "createdAt": "timestamp"
}
```

### Colección `clientes`
```json
{
  "escuela": "Primaria Benito Juárez",
  "contacto": "María García",
  "telefono": "5512345678",
  "direccion": "Av. Principal 123",
  "ultimoContacto": "timestamp",
  "createdAt": "timestamp"
}
```
