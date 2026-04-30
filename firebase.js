// ============================================================
// firebase.js - Configuración e inicialización de Firebase
// ============================================================
// ✅ Fotos guardadas como base64 en Firestore (SIN Storage)
//    Funciona 100% en el plan gratuito (Spark)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ============================================================
// 🔧 CONFIGURACIÓN
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

// ============================================================
// COLECCIONES FIRESTORE
// ============================================================
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
      console.error('Error en login:', error);
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
      console.error('Error en logout:', error);
      return { success: false, error: error.message };
    }
  },

  // FIX: si addDoc falla, se elimina el usuario de Auth para evitar huérfanos
  async createUser(email, password, rol, nombre) {
    let userCredential = null;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);

      await addDoc(collection(db, COLLECTIONS.USUARIOS), {
        uid: userCredential.user.uid,
        email,
        nombre,
        rol,
        createdAt: serverTimestamp()
      });

      return { success: true, user: userCredential.user };
    } catch (error) {
      console.error('Error creando usuario:', error);

      // Rollback: si el usuario ya se creó en Auth pero falló Firestore, eliminarlo
      if (userCredential?.user) {
        try {
          await deleteUser(userCredential.user);
        } catch (deleteError) {
          console.error('Error en rollback de usuario huérfano:', deleteError);
        }
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
      console.error('Error obteniendo perfil:', error);
      return { success: false, error: error.message };
    }
  },

  onAuthStateChanged: (callback) => onAuthStateChanged(auth, callback)
};

// ============================================================
// 📸 STORAGE LOCAL — Fotos en base64 dentro de Firestore
// ============================================================
const Storage = {
  /**
   * Convierte un File de imagen a base64 comprimido.
   * FIX: el cálculo de tamaño ahora usa byteLength real del string base64.
   */
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

          // FIX: calcular tamaño real del base64 (sin el prefijo data:...;base64,)
          const base64Data = base64.split(',')[1] || '';
          const kb = Math.round((base64Data.length * 0.75) / 1024);

          if (kb > 900) {
            // Recomprimir con calidad más baja si excede límite seguro de Firestore (~1MB)
            base64 = canvas.toDataURL('image/jpeg', 0.4);
          }

          resolve({ success: true, base64 });
        };
        img.onerror = () => resolve({ success: false, error: 'Error al leer la imagen' });
        img.src = e.target.result;
      };
      reader.onerror = () => resolve({ success: false, error: 'Error al leer el archivo' });
      reader.readAsDataURL(archivo);
    });
  },

  /**
   * Sube una foto asociada a un pedido guardándola en Firestore.
   * FIX: captura error si el documento excede el límite de Firestore.
   */
  async subirFoto(archivo, pedidoId) {
    try {
      const resultado = await this.comprimirYConvertir(archivo);
      if (!resultado.success) return resultado;

      // Verificar tamaño final antes de intentar guardar
      const base64Data = resultado.base64.split(',')[1] || '';
      const kb = Math.round((base64Data.length * 0.75) / 1024);
      if (kb > 950) {
        return { success: false, error: 'La imagen es demasiado grande incluso comprimida. Usa una foto de menor resolución.' };
      }

      await updateDoc(doc(db, COLLECTIONS.PEDIDOS, pedidoId), {
        foto: resultado.base64,
        updatedAt: serverTimestamp()
      });

      return { success: true, url: resultado.base64 };
    } catch (error) {
      console.error('Error subiendo foto:', error);
      // Mensaje específico si es error de tamaño de Firestore
      if (error.code === 'invalid-argument' || error.message?.includes('exceeds')) {
        return { success: false, error: 'La foto es demasiado grande para guardar. Intenta con una imagen más pequeña.' };
      }
      return { success: false, error: 'Error al guardar la foto: ' + error.message };
    }
  }
};

// ============================================================
// PEDIDOS
// ============================================================
const Pedidos = {
  async crear(datos) {
    try {
      const requeridos = ['escuela', 'contacto', 'telefono', 'producto', 'cantidad', 'tipoVenta'];
      for (const campo of requeridos) {
        if (!datos[campo] || datos[campo].toString().trim() === '') {
          return { success: false, error: `El campo "${campo}" es requerido` };
        }
      }

      // FIX: validar que cantidad >= 1 y precioUnitario >= 0
      const cantidad = Number(datos.cantidad);
      const precioUnitario = Number(datos.precioUnitario) || 0;

      if (!Number.isInteger(cantidad) || cantidad < 1) {
        return { success: false, error: 'La cantidad debe ser un número entero mayor a 0' };
      }
      if (precioUnitario < 0) {
        return { success: false, error: 'El precio unitario no puede ser negativo' };
      }

      const pedido = {
        escuela: datos.escuela.trim(),
        direccion: datos.direccion?.trim() || '',
        contacto: datos.contacto.trim(),
        telefono: datos.telefono.trim(),
        producto: datos.producto.trim(),
        cantidad,
        precioUnitario,
        tipoVenta: datos.tipoVenta,
        estado: 'pendiente',
        foto: datos.foto || null,
        ubicacion: datos.ubicacion || null,
        vendedorId: datos.vendedorId || '',
        vendedorNombre: datos.vendedorNombre || '',
        notas: datos.notas?.trim() || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      if (datos.tipoVenta === 'consignacion') {
        pedido.cantidadDejada = cantidad;
        pedido.cantidadVendida = 0;
        pedido.cantidadRestante = cantidad;
        pedido.fechaEntregaConsignacion = datos.fechaEntrega || null;
        pedido.estadoConsignacion = 'pendiente';
      }

      pedido.total = cantidad * precioUnitario;

      const docRef = await addDoc(collection(db, COLLECTIONS.PEDIDOS), pedido);
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creando pedido:', error);
      return { success: false, error: 'Error al crear pedido: ' + error.message };
    }
  },

  async actualizar(id, datos) {
    try {
      if (!id) return { success: false, error: 'ID requerido' };
      const ref = doc(db, COLLECTIONS.PEDIDOS, id);
      await updateDoc(ref, { ...datos, updatedAt: serverTimestamp() });
      return { success: true };
    } catch (error) {
      console.error('Error actualizando pedido:', error);
      return { success: false, error: error.message };
    }
  },

  async actualizarConsignacion(id, cantidadVendida) {
    try {
      const pedidoRef = doc(db, COLLECTIONS.PEDIDOS, id);
      const pedidoSnap = await getDoc(pedidoRef);
      if (!pedidoSnap.exists()) return { success: false, error: 'Pedido no encontrado' };

      const pedido = pedidoSnap.data();
      const cantidadDejada = pedido.cantidadDejada || pedido.cantidad;
      const vendida = Number(cantidadVendida);

      if (!Number.isFinite(vendida) || vendida < 0 || vendida > cantidadDejada) {
        return { success: false, error: 'Cantidad inválida' };
      }

      const cantidadRestante = cantidadDejada - vendida;
      const totalVendido = vendida * (pedido.precioUnitario || 0);

      let estadoConsignacion = 'pendiente';
      if (vendida === cantidadDejada) estadoConsignacion = 'liquidado';
      else if (vendida > 0) estadoConsignacion = 'parcial';

      let estado = pedido.estado;
      if (estadoConsignacion === 'liquidado') estado = 'pagado';
      else if (estadoConsignacion === 'parcial') estado = 'parcial';

      await updateDoc(pedidoRef, {
        cantidadVendida: vendida,
        cantidadRestante,
        totalVendido,
        estadoConsignacion,
        estado,
        updatedAt: serverTimestamp()
      });

      return { success: true, cantidadRestante, totalVendido, estadoConsignacion };
    } catch (error) {
      console.error('Error actualizando consignación:', error);
      return { success: false, error: error.message };
    }
  },

  async cambiarEstado(id, nuevoEstado) {
    const estadosValidos = ['pendiente', 'entregado', 'pagado', 'parcial', 'cancelado'];
    if (!estadosValidos.includes(nuevoEstado)) {
      return { success: false, error: 'Estado inválido' };
    }
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

  // FIX: manejo de error explícito si Firestore requiere índice compuesto
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
        // FIX: si es error de índice faltante, informar claramente en consola
        if (error.code === 'failed-precondition') {
          console.error(
            '⚠️ Firestore requiere un índice compuesto para esta consulta. ' +
            'Crea el índice en: https://console.firebase.google.com → Firestore → Índices'
          );
        }
        callback([]);
      });
    } catch (error) {
      console.error('Error configurando listener:', error);
      return () => {};
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

        // FIX: no sobreescribir createdAt al actualizar
        const { createdAt, ...datosSinCreatedAt } = datos;

        await updateDoc(doc(db, COLLECTIONS.CLIENTES, docId), {
          ...datosSinCreatedAt,
          updatedAt: serverTimestamp()
        });
        return { success: true, id: docId, existia: true };
      }

      const cliente = {
        nombre: datos.nombre?.trim() || datos.escuela?.trim() || '',
        escuela: datos.escuela?.trim() || '',
        direccion: datos.direccion?.trim() || '',
        contacto: datos.contacto?.trim() || '',
        telefono: tel,
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

  async obtenerTodos() {
    try {
      const snapshot = await getDocs(collection(db, COLLECTIONS.CLIENTES));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error obteniendo clientes:', error);
      return [];
    }
  },

  async sinActividad(dias = 30) {
    try {
      const limite = new Date();
      limite.setDate(limite.getDate() - dias);
      const limiteTs = Timestamp.fromDate(limite);

      const q = query(
        collection(db, COLLECTIONS.CLIENTES),
        where('ultimoContacto', '<=', limiteTs)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error buscando clientes inactivos:', error);
      return [];
    }
  },

  async actualizarContacto(id) {
    try {
      await updateDoc(doc(db, COLLECTIONS.CLIENTES, id), {
        ultimoContacto: serverTimestamp()
      });
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

export { db, auth, Auth, Pedidos, Clientes, Storage, COLLECTIONS, serverTimestamp, Timestamp };
                        
