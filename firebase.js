// ============================================================
// firebase.js - Jicmar CRM (ACTUALIZADO)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
// CONFIGURACIÓN
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDM0Q8DJmuQ4jVrorDTriPzsEsPAhiKNDc",
  authDomain: "jicmar-crm.firebaseapp.com",
  projectId: "jicmar-crm",
  storageBucket: "jicmar-crm.firebasestorage.app",
  messagingSenderId: "1042921436684",
  appId: "1:1042921436684:web:81e7e99b76258e68ace029"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const COLLECTIONS = {
  PEDIDOS: 'pedidos',
  CLIENTES: 'clientes',
  CONSIGNACIONES: 'consignaciones',
  USUARIOS: 'usuarios'
};

// ============================================================
// AUTH
// ============================================================
const Auth = {
  async login(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: userCredential.user };
    } catch (error) {
      const messages = {
        'auth/user-not-found': 'Usuario no encontrado',
        'auth/wrong-password': 'Contraseña incorrecta',
        'auth/invalid-email': 'Email inválido',
        'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde',
        'auth/invalid-credential': 'Credenciales inválidas'
      };
      return { success: false, error: messages[error.code] || 'Error de autenticación' };
    }
  },

  async logout() {
    try {
      await signOut(auth);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async createUser(email, password, rol, nombre) {
    let userCredential = null;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await addDoc(collection(db, COLLECTIONS.USUARIOS), {
        uid: userCredential.user.uid,
        email, nombre, rol,
        createdAt: serverTimestamp()
      });
      return { success: true, user: userCredential.user };
    } catch (error) {
      if (userCredential?.user) {
        try { await deleteUser(userCredential.user); } catch (_) {}
      }
      return { success: false, error: error.message };
    }
  },

  async getUserProfile(uid) {
    try {
      const q = query(collection(db, COLLECTIONS.USUARIOS), where('uid', '==', uid));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return { success: true, profile: { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } };
      }
      return { success: false, error: 'Perfil no encontrado' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  onAuthStateChanged: (callback) => onAuthStateChanged(auth, callback)
};

// ============================================================
// CONFIG — Bodega
// ============================================================
const Config = {
  async obtenerBodega() {
    try {
      const docRef = doc(db, 'config', 'Bodega');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        return { success: true, ubicacion: { lat: data.lat, lng: data.lng } };
      }
      return { success: false, error: 'No se encontró la ubicación de bodega' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// ============================================================
// CATÁLOGO DE PRODUCTOS
// ============================================================
const Catalogo = {
  async obtener() {
    try {
      const docRef = doc(db, 'config', 'catalogo');
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data().productos)) {
        return { success: true, productos: snap.data().productos };
      }
      return { success: false, productos: [] };
    } catch (error) {
      return { success: false, productos: [], error: error.message };
    }
  },

  async guardar(productos) {
    try {
      const docRef = doc(db, 'config', 'catalogo');
      await setDoc(docRef, { productos, updatedAt: serverTimestamp() });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// ============================================================
// STORAGE
// ============================================================
const Storage = {
  async comprimirYConvertir(archivo, maxAncho = 800, calidad = 0.7) {
    return new Promise((resolve) => {
      if (!archivo || !archivo.type.startsWith('image/')) {
        resolve({ success: false, error: 'El archivo no es una imagen válida' });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let ancho = img.width;
          let alto = img.height;
          if (ancho > maxAncho) {
            alto = Math.round((alto * maxAncho) / ancho);
            ancho = maxAncho;
          }
          const canvas = document.createElement('canvas');
          canvas.width = ancho;
          canvas.height = alto;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, ancho, alto);
          let base64 = canvas.toDataURL('image/jpeg', calidad);
          const base64Data = base64.split(',')[1] || '';
          const kb = Math.round((base64Data.length * 0.75) / 1024);
          if (kb > 900) base64 = canvas.toDataURL('image/jpeg', 0.4);
          resolve({ success: true, base64 });
        };
        img.onerror = () => resolve({ success: false, error: 'Error al leer la imagen' });
        img.src = e.target.result;
      };
      reader.onerror = () => resolve({ success: false, error: 'Error al leer el archivo' });
      reader.readAsDataURL(archivo);
    });
  },

  async subirFoto(archivo, pedidoId) {
    try {
      const resultado = await this.comprimirYConvertir(archivo);
      if (!resultado.success) return resultado;
      const base64Data = resultado.base64.split(',')[1] || '';
      const kb = Math.round((base64Data.length * 0.75) / 1024);
      if (kb > 950) return { success: false, error: 'Imagen demasiado grande.' };
      await updateDoc(doc(db, COLLECTIONS.PEDIDOS, pedidoId), {
        foto: resultado.base64,
        updatedAt: serverTimestamp()
      });
      return { success: true, url: resultado.base64 };
    } catch (error) {
      return { success: false, error: 'Error al guardar la foto: ' + error.message };
    }
  }
};

// ============================================================
// PEDIDOS
// ============================================================
const Pedidos = {
  async crearNuevo(datos) {
    try {
      if (!datos.clienteId) return { success: false, error: 'Se requiere un cliente' };
      if (!Array.isArray(datos.productos) || datos.productos.length === 0) {
        return { success: false, error: 'Se requiere al menos un producto' };
      }

      const pedido = {
        clienteId: datos.clienteId,
        clienteNombre: datos.clienteNombre || '',
        clienteEscuela: datos.clienteEscuela || '',
        clienteDireccion: datos.clienteDireccion || '',
        clienteTelefono: datos.clienteTelefono || '',
        clienteContacto: datos.clienteContacto || '',
        clienteUbicacion: datos.clienteUbicacion || null,
        clienteRequiereFactura: datos.clienteRequiereFactura || false,
        productos: datos.productos,
        total: datos.total || 0,
        tipoVenta: datos.tipoVenta || 'directa',
        estado: 'pendiente',
        foto: datos.foto || null,
        vendedorId: datos.vendedorId || '',
        vendedorNombre: datos.vendedorNombre || '',
        notas: datos.notas || '',
        fechaPedido: datos.fechaPedido || '',
        fechaEntregadoReal: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (datos.tipoVenta === 'consignacion') {
        pedido.fechaEntrega = datos.fechaEntrega || null;
        pedido.estadoConsignacion = 'pendiente';
      }

      const docRef = await addDoc(collection(db, COLLECTIONS.PEDIDOS), pedido);
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creando pedido:', error);
      return { success: false, error: 'Error al crear pedido: ' + error.message };
    }
  },

  async crear(datos) {
    return await this.crearNuevo(datos);
  },

  async actualizar(id, datos) {
    try {
      if (!id) return { success: false, error: 'ID requerido' };
      const ref = doc(db, COLLECTIONS.PEDIDOS, id);
      await updateDoc(ref, { ...datos, updatedAt: serverTimestamp() });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async setConMerge(id, datos) {
    try {
      if (!id) return { success: false, error: 'ID requerido' };
      const ref = doc(db, COLLECTIONS.PEDIDOS, id);
      await setDoc(ref, { ...datos, updatedAt: serverTimestamp() }, { merge: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async cambiarEstado(id, nuevoEstado) {
    const estadosValidos = ['pendiente', 'entregado', 'pagado', 'parcial', 'cancelado'];
    if (!estadosValidos.includes(nuevoEstado)) return { success: false, error: 'Estado inválido' };
    return await this.actualizar(id, { estado: nuevoEstado });
  },

  async eliminar(id) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.PEDIDOS, id));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  escuchar(filtros, callback) {
    try {
      const constraints = [orderBy('createdAt', 'desc')];
      if (filtros?.estado && filtros.estado !== 'todos') {
        constraints.unshift(where('estado', '==', filtros.estado));
      }
      if (filtros?.vendedorId) {
        constraints.unshift(where('vendedorId', '==', filtros.vendedorId));
      }
      const q = query(collection(db, COLLECTIONS.PEDIDOS), ...constraints);
      return onSnapshot(q, (snapshot) => {
        const pedidos = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date()
        }));
        callback(pedidos);
      }, (error) => {
        console.error('Error en listener de pedidos:', error);
        if (error.code === 'failed-precondition') {
          console.error('⚠️ Firestore requiere índice compuesto. Créalo en Firebase Console.');
        }
        callback([]);
      });
    } catch (error) {
      console.error('Error configurando listener:', error);
      return () => {};
    }
  },

  async registrarPago(pedidoId, pago) {
    try {
      const subRef = collection(db, COLLECTIONS.PEDIDOS, pedidoId, 'pagos');
      await addDoc(subRef, {
        monto: pago.monto || 0,
        unidadesDevueltas: pago.unidadesDevueltas || 0,
        montoDevuelto: pago.montoDevuelto || 0,
        notas: pago.notas || '',
        fecha: serverTimestamp(),
        fechaTexto: new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async obtenerPagos(pedidoId) {
    try {
      const subRef = collection(db, COLLECTIONS.PEDIDOS, pedidoId, 'pagos');
      const q = query(subRef, orderBy('fecha', 'asc'));
      const snapshot = await getDocs(q);
      return {
        success: true,
        pagos: snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      };
    } catch (error) {
      return { success: false, pagos: [], error: error.message };
    }
  },

  async obtenerPorFecha(inicio, fin) {
    try {
      const inicioTs = Timestamp.fromDate(new Date(inicio));
      const finTs = Timestamp.fromDate(new Date(fin + 'T23:59:59'));
      const q = query(
        collection(db, COLLECTIONS.PEDIDOS),
        where('createdAt', '>=', inicioTs),
        where('createdAt', '<=', finTs),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date()
      }));
    } catch (error) {
      console.error('Error obteniendo pedidos por fecha:', error);
      return [];
    }
  }
};

// ============================================================
// CLIENTES
// ============================================================
const Clientes = {
  async crearOActualizar(datos) {
    try {
      const tel = datos.telefono?.trim();
      if (!tel) return { success: false, error: 'Teléfono requerido' };

      const q = query(collection(db, COLLECTIONS.CLIENTES), where('telefono', '==', tel));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        const { createdAt, ...datosSinCreatedAt } = datos;
        await updateDoc(doc(db, COLLECTIONS.CLIENTES, docId), {
          ...datosSinCreatedAt,
          updatedAt: serverTimestamp()
        });
        return { success: true, id: docId, existia: true };
      }

      const cliente = {
        nombre: datos.nombre?.trim() || datos.escuela?.trim() || '',
        escuela: datos.escuela?.trim() || datos.nombre?.trim() || '',
        direccion: datos.direccion?.trim() || '',
        contacto: datos.contacto?.trim() || '',
        telefono: tel,
        ubicacion: datos.ubicacion || null,
        requiereFactura: datos.requiereFactura || 'no',
        notas: datos.notas?.trim() || '',
        ultimoContacto: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, COLLECTIONS.CLIENTES), cliente);
      return { success: true, id: docRef.id, existia: false };
    } catch (error) {
      console.error('Error en clientes:', error);
      return { success: false, error: error.message };
    }
  },

  async actualizar(id, datos) {
    try {
      if (!id) return { success: false, error: 'ID requerido' };
      const ref = doc(db, COLLECTIONS.CLIENTES, id);
      const { createdAt, ...datosSinCreatedAt } = datos;
      await updateDoc(ref, { ...datosSinCreatedAt, updatedAt: serverTimestamp() });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async setConMerge(id, datos) {
    try {
      if (!id) return { success: false, error: 'ID requerido' };
      const ref = doc(db, COLLECTIONS.CLIENTES, id);
      const { createdAt, ...datosSinCreatedAt } = datos;
      await setDoc(ref, { ...datosSinCreatedAt, updatedAt: serverTimestamp() }, { merge: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async obtenerTodos() {
    try {
      const snapshot = await getDocs(collection(db, COLLECTIONS.CLIENTES));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      return [];
    }
  },

  async eliminar(id) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.CLIENTES, id));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  escuchar(callback) {
    const q = query(collection(db, COLLECTIONS.CLIENTES), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const clientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(clientes);
    }, (error) => {
      console.error('Error en listener de clientes:', error);
      callback([]);
    });
  }
};

export { db, auth, Auth, Config, Catalogo, Pedidos, Clientes, Storage, Inventario, COLLECTIONS, serverTimestamp, Timestamp, collection, addDoc, getDocs, query, orderBy };
