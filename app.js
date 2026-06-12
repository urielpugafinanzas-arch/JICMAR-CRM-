// ============================================================
// app.js — Jicmar CRM
// ============================================================

import { Auth, Config, Catalogo, Pedidos, Clientes, Storage, Inventario } from './firebase.js';

// ============================================================
// CATÁLOGO DE PRODUCTOS — array dinámico (se carga desde Firestore)
// ============================================================
let PRODUCTOS_CATALOGO = [
  { nombre: 'Charola jícama 250g', precio: 0 },
  { nombre: 'Chicharrón garbanzo salsa negra', precio: 0 },
  { nombre: 'Chicharrón garbanzo sal y limón', precio: 0 },
  { nombre: 'Chicharrón garbanzo flaming hot', precio: 0 },
  { nombre: 'Crujientes maíz salsa negra', precio: 0 },
  { nombre: 'Crujientes maíz sal y limón', precio: 0 },
  { nombre: 'Crujientes maíz flaming hot', precio: 0 },
  { nombre: 'Crujientes maíz cheddar', precio: 0 },
  { nombre: 'Jícama chips', precio: 0 },
  { nombre: 'Jícama chips salsa negra', precio: 0 },
  { nombre: 'Jícama chips adobadas', precio: 0 },
];

// Carga el catálogo desde Firestore; si no existe usa los defaults y los guarda
async function cargarCatalogo() {
  const res = await Catalogo.obtener();
  if (res.success && res.productos.length > 0) {
    PRODUCTOS_CATALOGO = res.productos;
  } else {
    // Primera vez: guardar los defaults en Firestore
    await Catalogo.guardar(PRODUCTOS_CATALOGO);
  }
}

// ============================================================
// ESTADO GLOBAL
// ============================================================
const App = {
  usuario: null,
  perfil: null,
  pedidosList: [],
  clientesList: [],
  filtroActivo: 'todos',
  busqueda: '',
  unsubscribePedidos: null,
  unsubscribeClientes: null,
  ubicacionCapturada: null,
  ubicacionClienteCapturada: null,
  fotoURL: null,
  fotoOriginal: null,
  fotoFile: null,
  modoEdicion: null,
  modoEdicionCliente: null,
  productosEnPedido: [],
  ubicacionBodega: null,
filtrosDashboard: {
    totalVendido: 'todo',
    cobrado: 'todo',
    pendiente: 'todo',
    consignacion: 'todo',
    pedidos: 'todo',
    topProducto: 'todo'
  },
  inventarioStock: {},
  unsubscribeInventario: null,
};

window.App = App;

// ============================================================
// ALGORITMO DE RUTA ÓPTIMA (Vecino más cercano)
// ============================================================
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ordenarPorRutaOptima(pedidos, bodega) {
  const conUbicacion = pedidos.filter(p => p.clienteUbicacion?.lat && p.clienteUbicacion?.lng);
  const sinUbicacion = pedidos.filter(p => !p.clienteUbicacion?.lat || !p.clienteUbicacion?.lng);

  if (conUbicacion.length === 0) return pedidos;

  const ordenados = [];
  const pendientes = [...conUbicacion];
  let puntoActual = { lat: bodega.lat, lng: bodega.lng };

  while (pendientes.length > 0) {
    let indiceMasCercano = 0;
    let distanciaMinima = Infinity;

    pendientes.forEach((p, i) => {
      const dist = distanciaKm(
        puntoActual.lat, puntoActual.lng,
        p.clienteUbicacion.lat, p.clienteUbicacion.lng
      );
      if (dist < distanciaMinima) {
        distanciaMinima = dist;
        indiceMasCercano = i;
      }
    });

    const siguiente = pendientes.splice(indiceMasCercano, 1)[0];
    ordenados.push(siguiente);
    puntoActual = { lat: siguiente.clienteUbicacion.lat, lng: siguiente.clienteUbicacion.lng };
  }

  return [...ordenados, ...sinUbicacion];
}

// ============================================================
// NAVEGACIÓN
// ============================================================
window.navigateTo = function (pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  if (pageId === 'nuevo-pedido' && !App.modoEdicion) {
    resetFormPedido();
    document.getElementById('form-pedido-title').textContent = '📝 Nuevo Pedido';
  }
  if (pageId === 'nuevo-cliente' && !App.modoEdicionCliente) {
    resetFormCliente();
    document.getElementById('form-cliente-title').textContent = '👤 Nuevo Cliente';
  }
  if (pageId === 'catalogo') {
    renderCatalogo();
  }
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  Auth.onAuthStateChanged(async (user) => {
    if (user) {
      App.usuario = user;
      const perfilRes = await Auth.getUserProfile(user.uid);
      App.perfil = perfilRes.success ? perfilRes.profile : { rol: 'vendedor', nombre: user.email };

      // Cargar catálogo dinámico
      await cargarCatalogo();
  renderFilasEntrada();

      // Cargar ubicación de bodega
      const bodegaRes = await Config.obtenerBodega();
      if (bodegaRes.success) {
        App.ubicacionBodega = bodegaRes.ubicacion;
      } else {
        console.warn('No se pudo cargar la ubicación de bodega:', bodegaRes.error);
      }

      mostrarApp();
      iniciarListeners();
    } else {
      mostrarLogin();
      limpiarListeners();
    }
  });
  inicializarEventos();
});

// ============================================================
// MODAL CERRAR SESIÓN
// ============================================================
function mostrarModalLogout() {
  document.getElementById('modal-logout').style.display = 'flex';
}

function ocultarModalLogout() {
  document.getElementById('modal-logout').style.display = 'none';
}

// ============================================================
// FOTO PEDIDO
// ============================================================
async function handleFotoChange(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;

  const preview = document.getElementById('foto-preview');
  preview.innerHTML = '⏳ Comprimiendo...';

  const resultado = await Storage.comprimirYConvertir(archivo);
  if (!resultado.success) {
    showToast(resultado.error, 'error');
    preview.innerHTML = '';
    return;
  }

  App.fotoURL = resultado.base64;
  App.fotoFile = null;

  preview.innerHTML = `
    <div style="position:relative">
      <img src="${resultado.base64}" style="width:100%;max-height:180px;border-radius:10px"/>
      <button type="button" onclick="quitarFoto()"
        style="position:absolute;top:5px;right:5px;background:black;color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;">✕</button>
    </div>`;

  showToast('Foto lista ✓', 'success');
}

window.quitarFoto = function () {
  App.fotoURL = null;
  App.fotoFile = null;
  App.fotoOriginal = null;
  document.getElementById('foto-preview').innerHTML = '';
  document.getElementById('foto-input').value = '';
};

// ============================================================
// PRODUCTOS EN PEDIDO
// ============================================================
function renderProductosEnPedido() {
  const container = document.getElementById('productos-lista');
  if (!container) return;

  if (App.productosEnPedido.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:0.75rem;color:var(--text-muted);font-size:0.82rem;">Sin productos. Agrega al menos uno.</div>`;
    return;
  }

  container.innerHTML = App.productosEnPedido.map((item, idx) => `
    <div class="producto-row" data-idx="${idx}">
      <div class="form-group" style="margin-bottom:0.4rem;">
        <label style="font-size:0.72rem;">Producto</label>
        <select class="prod-select" data-idx="${idx}" onchange="actualizarProductoYPrecio(${idx},this.value)">
          <option value="">— Elige producto —</option>
          ${PRODUCTOS_CATALOGO.map(p => { const n = typeof p === 'string' ? p : p.nombre; return `<option value="${n}" ${item.producto === n ? 'selected' : ''}>${n}</option>`; }).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group" style="margin-bottom:0.4rem;">
          <label style="font-size:0.72rem;">Cantidad</label>
          <input type="number" min="1" value="${item.cantidad || ''}" placeholder="0" inputmode="numeric"
            onchange="actualizarProducto(${idx},'cantidad',this.value)" />
        </div>
        <div class="form-group" style="margin-bottom:0.4rem;">
          <label style="font-size:0.72rem;">Precio unit. ($)</label>
          <input type="number" min="0" step="0.01" value="${item.precioUnitario || ''}" placeholder="0.00" inputmode="decimal"
            onchange="actualizarProducto(${idx},'precioUnitario',this.value)" />
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <span style="font-size:0.78rem;color:var(--accent2);">
          Total: ${((item.cantidad||0)*(item.precioUnitario||0)).toLocaleString('es-MX',{style:'currency',currency:'MXN'})}
        </span>
        <button type="button" class="btn btn-danger btn-sm" onclick="quitarProducto(${idx})">🗑️ Quitar</button>
      </div>
      <hr style="border-color:var(--border);margin:0.4rem 0;" />
    </div>
  `).join('');
}

window.actualizarProducto = function (idx, campo, valor) {
  if (!App.productosEnPedido[idx]) return;
  if (campo === 'cantidad' || campo === 'precioUnitario') {
    App.productosEnPedido[idx][campo] = parseFloat(valor) || 0;
  } else {
    App.productosEnPedido[idx][campo] = valor;
  }
  renderProductosEnPedido();
};
window.actualizarProductoYPrecio = function (idx, nombreProducto) {
  if (!App.productosEnPedido[idx]) return;
  App.productosEnPedido[idx].producto = nombreProducto;
  const entrada = PRODUCTOS_CATALOGO.find(p =>
    (typeof p === 'string' ? p : p.nombre) === nombreProducto
  );
  if (entrada && typeof entrada === 'object' && entrada.precio > 0) {
    App.productosEnPedido[idx].precioUnitario = entrada.precio;
  }
  renderProductosEnPedido();
};
window.quitarProducto = function (idx) {
  App.productosEnPedido.splice(idx, 1);
  renderProductosEnPedido();
};

function agregarProductoVacio() {
  App.productosEnPedido.push({ producto: '', cantidad: 0, precioUnitario: 0 });
  renderProductosEnPedido();
}

// ============================================================
// GESTIÓN DE CATÁLOGO DE PRODUCTOS
// ============================================================
function renderCatalogo() {
  const container = document.getElementById('catalogo-lista');
  if (!container) return;

  if (PRODUCTOS_CATALOGO.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin productos en el catálogo.</div>`;
    return;
  }

  container.innerHTML = PRODUCTOS_CATALOGO.map((item, idx) => {
    const nombre = typeof item === 'string' ? item : item.nombre;
    const precio = typeof item === 'object' ? (item.precio || 0) : 0;
    return `
    <div style="display:flex;align-items:center;gap:0.6rem;padding:0.65rem 0.75rem;
      background:var(--surface2);border-radius:10px;margin-bottom:0.5rem;border:1px solid var(--border);">
      <span style="font-size:0.75rem;color:var(--text-muted);min-width:1.4rem;">${idx + 1}.</span>
      <span id="cat-texto-${idx}" style="flex:1;font-size:0.88rem;">${nombre}
        <span style="color:var(--accent2);font-size:0.78rem;margin-left:4px;">$${precio}</span>
      </span>
      <div id="cat-inputs-${idx}" style="display:none;flex-direction:column;gap:0.4rem;flex:1;">
        <input id="cat-input-nombre-${idx}" type="text" value="${nombre}"
          style="flex:1;padding:0.3rem 0.5rem;font-size:0.85rem;border-radius:6px;border:1px solid var(--accent);background:var(--surface);color:var(--text);" />
        <input id="cat-input-precio-${idx}" type="number" min="0" step="0.01" value="${precio}" placeholder="Precio"
          style="width:80px;padding:0.3rem 0.5rem;font-size:0.85rem;border-radius:6px;border:1px solid var(--accent);background:var(--surface);color:var(--text);" />
      </div>
      <button class="btn btn-outline btn-sm" onclick="editarProductoCatalogo(${idx})" id="cat-btn-editar-${idx}"
        style="padding:0.25rem 0.55rem;font-size:0.75rem;">✏️</button>
      <button class="btn btn-success btn-sm" onclick="guardarProductoCatalogo(${idx})" id="cat-btn-guardar-${idx}"
        style="display:none;padding:0.25rem 0.55rem;font-size:0.75rem;">💾</button>
      <button class="btn btn-danger btn-sm" onclick="eliminarProductoCatalogo(${idx})"
        style="padding:0.25rem 0.55rem;font-size:0.75rem;">🗑️</button>
    </div>`
  }).join('');
}

window.editarProductoCatalogo = function (idx) {
  const texto = document.getElementById(`cat-texto-${idx}`);
  const inputs = document.getElementById(`cat-inputs-${idx}`);
  const btnEditar = document.getElementById(`cat-btn-editar-${idx}`);
  const btnGuardar = document.getElementById(`cat-btn-guardar-${idx}`);
  if (texto) texto.style.display = 'none';
  if (inputs) { inputs.style.display = 'flex'; inputs.style.gap = '0.4rem'; }
  if (btnEditar) btnEditar.style.display = 'none';
  if (btnGuardar) btnGuardar.style.display = 'inline-flex';
  const inputNombre = document.getElementById(`cat-input-nombre-${idx}`);
  if (inputNombre) inputNombre.focus();
};

window.guardarProductoCatalogo = async function (idx) {
  const nombre = document.getElementById(`cat-input-nombre-${idx}`)?.value?.trim();
  const precio = parseFloat(document.getElementById(`cat-input-precio-${idx}`)?.value) || 0;
  if (!nombre) { showToast('El nombre no puede estar vacío', 'error'); return; }
  PRODUCTOS_CATALOGO[idx] = { nombre, precio };
  const res = await Catalogo.guardar(PRODUCTOS_CATALOGO);
  if (res.success) { showToast('Producto actualizado ✓', 'success'); renderCatalogo(); }
  else showToast('Error al guardar: ' + res.error, 'error');
};

window.eliminarProductoCatalogo = async function (idx) {
  if (!confirm(`¿Eliminar "${PRODUCTOS_CATALOGO[idx]}" del catálogo?`)) return;
  PRODUCTOS_CATALOGO.splice(idx, 1);
  const res = await Catalogo.guardar(PRODUCTOS_CATALOGO);
  if (res.success) {
    showToast('Producto eliminado ✓', 'success');
    renderCatalogo();
  } else {
    showToast('Error al eliminar: ' + res.error, 'error');
  }
};

window.agregarProductoCatalogo = async function () {
  const inputNombre = document.getElementById('catalogo-nuevo-nombre');
  const inputPrecio = document.getElementById('catalogo-nuevo-precio');
  const nombre = inputNombre?.value?.trim();
  const precio = parseFloat(inputPrecio?.value) || 0;
  if (!nombre) { showToast('Escribe el nombre del producto', 'error'); return; }
  const yaExiste = PRODUCTOS_CATALOGO.some(p => (typeof p === 'string' ? p : p.nombre) === nombre);
  if (yaExiste) { showToast('Ese producto ya existe en el catálogo', 'error'); return; }
  PRODUCTOS_CATALOGO.push({ nombre, precio });
  const res = await Catalogo.guardar(PRODUCTOS_CATALOGO);
  if (res.success) {
    inputNombre.value = '';
    if (inputPrecio) inputPrecio.value = '';
    showToast('Producto agregado ✓', 'success');
    renderCatalogo();
  } else {
    PRODUCTOS_CATALOGO.pop();
    showToast('Error al guardar: ' + res.error, 'error');
  }
};

// ============================================================
// SUBMIT PEDIDO
// ============================================================
async function handleSubmitPedido(e) {
  e.preventDefault();

const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked')?.value || 'directa';
  const clienteId = document.getElementById('pedido-cliente-id')?.value;
  if (!clienteId && tipoVenta !== 'muestra') {
    showToast('Selecciona un cliente', 'error');
    return;
  }
  if (tipoVenta === 'muestra' && !clienteId) {
    // Muestra sin cliente — permitido
  }

  const productosValidos = App.productosEnPedido.filter(p => p.producto && p.cantidad > 0);
  if (productosValidos.length === 0) {
    showToast('Agrega al menos un producto con cantidad', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-pedido');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    const cliente = App.clientesList.find(c => c.id === clienteId);
    const muestraProspecto = document.getElementById('muestra-prospecto')?.value?.trim() || '';
    const fechaPedido = document.getElementById('fecha-pedido')?.value || new Date().toISOString().split('T')[0];
    const totalPedido = productosValidos.reduce((s, p) => s + (p.cantidad * p.precioUnitario), 0);

    const datos = {
      clienteId,
      clienteNombre: cliente?.nombre || cliente?.escuela || '',
      clienteEscuela: cliente?.escuela || '',
      clienteDireccion: cliente?.direccion || '',
      clienteTelefono: cliente?.telefono || '',
      clienteContacto: cliente?.contacto || '',
      clienteUbicacion: cliente?.ubicacion || null,
      clienteRequiereFactura: cliente?.requiereFactura === 'si',
      productos: productosValidos,
      total: totalPedido,
      tipoVenta,
      notas: val('notas'),
      fechaPedido,
      vendedorId: App.usuario?.uid || '',
      vendedorNombre: App.perfil?.nombre || '',
      ...(tipoVenta === 'muestra' && muestraProspecto ? { muestraProspecto } : {}),
    };

    if (App.fotoURL && App.fotoURL !== App.fotoOriginal) {
      datos.foto = App.fotoURL;
    }

    let result;
    if (App.modoEdicion) {
      result = await Pedidos.actualizar(App.modoEdicion, datos);
    } else {
      result = await Pedidos.crearNuevo(datos);
    }

    if (!result.success) throw new Error(result.error);

    // Si es muestra: marcar como entregado y descontar inventario automáticamente
    if (tipoVenta === 'muestra' && result.id) {
      const hoy = new Date().toISOString().split('T')[0];
      const productosEntregados = productosValidos.map(p => ({ ...p, cantidadEntregada: p.cantidad }));
      await Pedidos.actualizar(result.id, {
        estado: 'pagado',
        totalEntregado: 0,
        montoCobrado: 0,
        deuda: 0,
        fechaEntregadoReal: hoy,
        productosEntregados,
      });
      const stockActual = { ...App.inventarioStock };
      productosValidos.forEach(pr => {
        if (!pr.producto || pr.cantidad <= 0) return;
        stockActual[pr.producto] = (stockActual[pr.producto] || 0) - pr.cantidad;
      });
      await Inventario.guardar(stockActual);
      await Inventario.registrarMovimiento('muestra', productosValidos.map(pr => ({
        producto: pr.producto, cantidad: pr.cantidad
      })), `Muestra: ${muestraProspecto || 'sin nombre'}`);
    }

    showToast(App.modoEdicion ? 'Pedido actualizado ✓' : tipoVenta === 'muestra' ? 'Muestra registrada ✓' : 'Pedido guardado ✓', 'success');
    resetFormPedido();
    window.navigateTo('pedidos');

  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '💾 Guardar Pedido';
}

// ============================================================
// SUBMIT CLIENTE
// ============================================================
async function handleSubmitCliente(e) {
  e.preventDefault();

  const nombre = val('cli-nombre');
  const telefono = val('cli-telefono');

  if (!nombre) { showToast('El nombre es requerido', 'error'); return; }
  if (!telefono) { showToast('El celular es requerido', 'error'); return; }

  const btn = document.getElementById('btn-submit-cliente');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    const requiereFactura = document.querySelector('input[name="requiereFactura"]:checked')?.value || 'no';

    const datos = {
      nombre,
      escuela: nombre,
      direccion: val('cli-direccion'),
      contacto: val('cli-contacto'),
      telefono,
      ubicacion: App.ubicacionClienteCapturada || null,
      requiereFactura,
      notas: val('cli-notas'),
    };

    let result;
    if (App.modoEdicionCliente) {
      result = await Clientes.actualizar(App.modoEdicionCliente, datos);
    } else {
      result = await Clientes.crearOActualizar(datos);
    }

    if (!result.success) throw new Error(result.error);

    const clienteId = App.modoEdicionCliente || result.id;
    if (clienteId) await subirFotosINE(clienteId);
    showToast('Cliente guardado ✓', 'success');
    resetFormCliente();
    window.navigateTo('clientes');

  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '💾 Guardar Cliente';
}

// ============================================================
// EDITAR PEDIDO
// ============================================================
window.editarPedido = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  App.modoEdicion = id;
  App.fotoOriginal = pedido.foto || null;
  App.fotoURL = pedido.foto || null;
  App.productosEnPedido = Array.isArray(pedido.productos) ? [...pedido.productos] : [];

  window.navigateTo('nuevo-pedido');
  document.getElementById('form-pedido-title').textContent = '✏️ Editar Pedido';

  setTimeout(() => {
    setVal('pedido-cliente-id', pedido.clienteId || '');
    setVal('fecha-pedido', pedido.fechaPedido || '');
    setVal('notas', pedido.notas);

    const tvInput = document.querySelector(`input[name="tipoVenta"][value="${pedido.tipoVenta || 'directa'}"]`);
    if (tvInput) { tvInput.checked = true; tvInput.dispatchEvent(new Event('change')); }

    if (pedido.fechaEntrega) setVal('fechaEntregaConsig', pedido.fechaEntrega);

    renderProductosEnPedido();
    actualizarAvisoFactura(pedido.clienteId);

    if (pedido.foto) {
      document.getElementById('foto-preview').innerHTML = `
        <div style="position:relative">
          <img src="${pedido.foto}" style="width:100%;max-height:180px;border-radius:10px"/>
          <button type="button" onclick="quitarFoto()"
            style="position:absolute;top:5px;right:5px;background:black;color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;">✕</button>
        </div>`;
    }
  }, 100);
};

// ============================================================
// EDITAR CLIENTE
// ============================================================
window.eliminarCliente = async function(id, event) {
  event.stopPropagation();
  if (!confirm('¿Eliminar este cliente permanentemente?')) return;
  const result = await Clientes.eliminar(id);
  if (result.success) {
    showToast('Cliente eliminado', 'success');
  } else {
    showToast('Error al eliminar: ' + result.error, 'error');
  }
};

window.editarCliente = function (id) {
  const cliente = App.clientesList.find(c => c.id === id);
  if (!cliente) return;

  App.modoEdicionCliente = id;
  App.ubicacionClienteCapturada = cliente.ubicacion || null;

  window.navigateTo('nuevo-cliente');
  document.getElementById('form-cliente-title').textContent = '✏️ Editar Cliente';

  setTimeout(() => {
    setVal('cli-nombre', cliente.nombre || cliente.escuela || '');
    setVal('cli-direccion', cliente.direccion || '');
    setVal('cli-contacto', cliente.contacto || '');
    setVal('cli-telefono', cliente.telefono || '');
    setVal('cli-notas', cliente.notas || '');

    const facInput = document.querySelector(`input[name="requiereFactura"][value="${cliente.requiereFactura || 'no'}"]`);
    if (facInput) facInput.checked = true;

    if (cliente.ubicacion) {
      const locEl = document.getElementById('location-result-cliente');
      if (locEl) {
        locEl.textContent = `📍 Ubicación guardada (${cliente.ubicacion.lat.toFixed(4)}, ${cliente.ubicacion.lng.toFixed(4)})`;
        locEl.style.display = 'flex';
      }
    }
    cargarFotosINE(id);
  }, 100);
};

// ============================================================
// AVISO FACTURA EN PEDIDO
// ============================================================
function actualizarAvisoFactura(clienteId) {
  const aviso = document.getElementById('aviso-factura');
  if (!aviso) return;
  const cliente = App.clientesList.find(c => c.id === clienteId);
  aviso.style.display = (cliente?.requiereFactura === 'si') ? 'flex' : 'none';
}

// ============================================================
// MODAL ENTREGA
// ============================================================
let pedidoEnModal = null;

window.abrirModalEntrega = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  pedidoEnModal = id;

  const badge = document.getElementById('modal-entrega-tipo-badge');
  const esConsig = pedido.tipoVenta === 'consignacion';
  badge.innerHTML = esConsig
    ? `<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;">📦 CONSIGNACIÓN</span>`
    : `<span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;">💵 VENTA DIRECTA</span>`;

  document.getElementById('modal-seccion-cobro').style.display = esConsig ? 'none' : 'block';
  document.getElementById('modal-seccion-consig').style.display = esConsig ? 'block' : 'none';

  const montoInput = document.getElementById('modal-monto-cobrado');
  if (montoInput) montoInput.value = '';
  const notasInput = document.getElementById('modal-notas-entrega');
  if (notasInput) notasInput.value = '';
  const diffInfo = document.getElementById('modal-diferencia-info');
  if (diffInfo) { diffInfo.style.display = 'none'; diffInfo.textContent = ''; }

  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const container = document.getElementById('modal-productos-entrega');
  container.innerHTML = productos.map((pr, i) => `
    <div style="background:var(--surface2);border-radius:10px;padding:0.65rem 0.75rem;margin-bottom:0.5rem;">
      <div style="font-size:0.82rem;font-weight:600;margin-bottom:0.4rem;">${pr.producto}</div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <div style="flex:1;">
          <label style="font-size:0.7rem;color:var(--text-muted);">Pedido</label>
          <div style="font-size:0.85rem;font-weight:500;">${pr.cantidad}</div>
        </div>
        <div style="flex:1;">
          <label style="font-size:0.7rem;color:var(--text-muted);">Entregado</label>
          <input type="number" min="0"
            id="entrega-cant-${i}"
            value="${pr.cantidad}"
            inputmode="numeric"
            oninput="calcularDiferenciaModal()"
            style="width:100%;padding:0.35rem 0.5rem;font-size:0.9rem;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);" />
        </div>
        <div style="flex:1;text-align:right;">
          <label style="font-size:0.7rem;color:var(--text-muted);">P.Unit</label>
          <div style="font-size:0.85rem;">$${pr.precioUnitario}</div>
        </div>
      </div>
    </div>
  `).join('');

  const tieneCharola = productos.some(pr => pr.producto === 'Charola jícama 250g');
  const secCaducidad = document.getElementById('modal-seccion-caducidad');
  if (secCaducidad) secCaducidad.style.display = tieneCharola ? 'block' : 'none';
  const fechaCadInput = document.getElementById('modal-fecha-caducidad');
  if (fechaCadInput) fechaCadInput.value = '';

  calcularDiferenciaModal();

  document.getElementById('modal-entrega').style.display = 'flex';
};

window.cerrarModalEntrega = function () {
  document.getElementById('modal-entrega').style.display = 'none';
  pedidoEnModal = null;
};

window.calcularDiferenciaModal = function () {
  const pedido = App.pedidosList.find(p => p.id === pedidoEnModal);
  if (!pedido) return;

  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  let totalEntregado = 0;

  productos.forEach((pr, i) => {
    const cantInput = document.getElementById(`entrega-cant-${i}`);
    const cant = parseFloat(cantInput?.value) || 0;
    totalEntregado += cant * (pr.precioUnitario || 0);
  });

  const totalEl = document.getElementById('modal-total-calculado');
  if (totalEl) totalEl.textContent = totalEntregado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const esConsig = pedido.tipoVenta === 'consignacion';
  const diffInfo = document.getElementById('modal-diferencia-info');
  if (!diffInfo) return;

  if (esConsig) {
    diffInfo.style.display = 'none';
    return;
  }

  const montoInput = document.getElementById('modal-monto-cobrado');
  if (!montoInput?.value) {
    diffInfo.style.display = 'none';
    return;
  }

  const montoCobrado = parseFloat(montoInput.value) || 0;
  const diff = montoCobrado - totalEntregado;
  diffInfo.style.display = 'block';

  if (Math.abs(diff) < 0.01) {
    diffInfo.style.background = 'rgba(34,197,94,0.1)';
    diffInfo.style.color = '#4ade80';
    diffInfo.textContent = '✅ Cobro exacto. Venta cerrada.';
  } else if (diff < 0) {
    diffInfo.style.background = 'rgba(239,68,68,0.1)';
    diffInfo.style.color = '#f87171';
    diffInfo.textContent = `🔴 Queda deuda de ${Math.abs(diff).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`;
  } else {
    diffInfo.style.background = 'rgba(34,197,94,0.1)';
    diffInfo.style.color = '#4ade80';
    diffInfo.textContent = `✅ Pago con excedente de ${diff.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}. Venta cerrada.`;
  }
};

window.confirmarEntrega = async function () {
  const pedido = App.pedidosList.find(p => p.id === pedidoEnModal);
  if (!pedido) return;

  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const esConsig = pedido.tipoVenta === 'consignacion';
  const hoy = new Date().toISOString().split('T')[0];

  const productosEntregados = productos.map((pr, i) => {
    const cantInput = document.getElementById(`entrega-cant-${i}`);
    const cantReal = parseFloat(cantInput?.value) || 0;
    return { ...pr, cantidadEntregada: cantReal };
  });

  const totalEntregado = productosEntregados.reduce((s, pr) => s + (pr.cantidadEntregada * pr.precioUnitario), 0);
  const notas = document.getElementById('modal-notas-entrega')?.value?.trim() || '';

  const btn = document.getElementById('btn-confirmar-entrega');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    let datos = {
      productosEntregados,
      totalEntregado,
      fechaEntregadoReal: hoy,
      notasEntrega: notas,
    };

    if (esConsig) {
      datos.estado = 'entregado';
      datos.montoCobrado = 0;
      datos.deuda = totalEntregado;
      const fechaCad = document.getElementById('modal-fecha-caducidad')?.value || null;
      if (fechaCad) datos.fechaCaducidad = fechaCad;
    } else {
      const montoCobrado = parseFloat(document.getElementById('modal-monto-cobrado')?.value) || 0;
      const diff = montoCobrado - totalEntregado;
      datos.montoCobrado = montoCobrado;
      datos.deuda = diff < -0.01 ? Math.abs(diff) : 0;
      datos.estado = datos.deuda > 0 ? 'parcial' : 'pagado';
      datos.totalEntregado = totalEntregado;
    }

    const result = await Pedidos.actualizar(pedidoEnModal, datos);
    if (!result.success) throw new Error(result.error);

    // Descontar inventario
    const stockActual = { ...App.inventarioStock };
    productosEntregados.forEach(pr => {
      const nombre = pr.producto;
      const cant = pr.cantidadEntregada || 0;
      if (!nombre || cant <= 0) return;
      stockActual[nombre] = (stockActual[nombre] || 0) - cant;
    });
    await Inventario.guardar(stockActual);
    await Inventario.registrarMovimiento('salida', productosEntregados.map(pr => ({
      producto: pr.producto,
      cantidad: pr.cantidadEntregada || 0
    })), `Entrega pedido ${pedidoEnModal}`);

    showToast(esConsig ? 'Entrega registrada ✓ — Cobro pendiente' : 'Entrega confirmada ✓', 'success');
    cerrarModalEntrega();

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = '✅ Confirmar Entrega';
};

window.marcarEntregado = async function (id) {
  window.abrirModalEntrega(id);
};

// ============================================================
// MODAL COBRO (Consignaciones)
// ============================================================
window.abrirModalCobro = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  pedidoEnModal = id;

  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;
  const montoDevuelto = pedido.montoDevuelto || 0;
  const saldoPendiente = (totalEntregado - montoDevuelto) - yaCobrado;

  const resumen = document.getElementById('modal-cobro-resumen');
  resumen.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
      <span style="color:var(--text-muted);">Cliente:</span>
      <span style="font-weight:600;">${pedido.clienteNombre || '—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
      <span style="color:var(--text-muted);">Total entregado:</span>
      <span>${totalEntregado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
      <span style="color:var(--text-muted);">Ya cobrado:</span>
      <span style="color:#4ade80;">${yaCobrado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
    </div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:0.4rem;margin-top:0.4rem;">
      <span style="font-weight:700;">Saldo pendiente:</span>
      <span style="font-weight:700;color:#f87171;">${saldoPendiente.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
    </div>
  `;

  const montoInput = document.getElementById('modal-cobro-monto');
  if (montoInput) montoInput.value = '';
  const devInput = document.getElementById('modal-cobro-devueltas');
  if (devInput) devInput.value = '';
  const devInfo = document.getElementById('modal-cobro-devueltas-info');
  if (devInfo) devInfo.textContent = '';
  const secDev = document.getElementById('seccion-devoluciones');
  if (secDev) secDev.style.display = 'block';
  const notasInput = document.getElementById('modal-cobro-notas');
  if (notasInput) notasInput.value = '';
  const saldoInfo = document.getElementById('modal-cobro-saldo-info');
  if (saldoInfo) { saldoInfo.style.display = 'none'; saldoInfo.textContent = ''; }

  document.getElementById('modal-cobro').style.display = 'flex';
};

window.cerrarModalCobro = function () {
  document.getElementById('modal-cobro').style.display = 'none';
  document.getElementById('modal-cobro').dataset.modoEdicion = 'false';
  pedidoEnModal = null;
};

window.calcularSaldoCobro = function () {
  const pedido = App.pedidosList.find(p => p.id === pedidoEnModal);
  if (!pedido) return;

  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;

  const unidadesDevueltas = parseFloat(document.getElementById('modal-cobro-devueltas')?.value) || 0;
  let precioUnitario = 0;
  const productos = pedido.productosEntregados || pedido.productos || [];
  if (productos.length === 1) {
    precioUnitario = productos[0].precioUnitario || 0;
  } else if (productos.length > 1) {
    const totalUnidades = productos.reduce((s, pr) => s + (pr.cantidadEntregada ?? pr.cantidad ?? 0), 0);
    precioUnitario = totalUnidades > 0 ? totalEntregado / totalUnidades : 0;
  }
  const montoDevuelto = unidadesDevueltas * precioUnitario;
  const totalRealACobrar = totalEntregado - montoDevuelto;

  const devInfo = document.getElementById('modal-cobro-devueltas-info');
  if (devInfo && unidadesDevueltas > 0) {
    devInfo.textContent = `↩️ Descuento por devolución: -${montoDevuelto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} → Cobrar: ${totalRealACobrar.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`;
  } else if (devInfo) {
    devInfo.textContent = '';
  }

  const modoEdicion = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
  const saldoPendiente = modoEdicion ? totalRealACobrar : (totalRealACobrar - yaCobrado);

  const montoPagando = parseFloat(document.getElementById('modal-cobro-monto')?.value) || 0;
  const saldoInfo = document.getElementById('modal-cobro-saldo-info');
  if (!saldoInfo) return;

  if (!document.getElementById('modal-cobro-monto')?.value) {
    saldoInfo.style.display = 'none';
    return;
  }

  const nuevoSaldo = saldoPendiente - montoPagando;
  saldoInfo.style.display = 'block';

  if (nuevoSaldo <= 0.01) {
    saldoInfo.style.background = 'rgba(34,197,94,0.1)';
    saldoInfo.style.color = '#4ade80';
    saldoInfo.textContent = '✅ Saldo liquidado. Consignación cerrada.';
  } else {
    saldoInfo.style.background = 'rgba(239,68,68,0.1)';
    saldoInfo.style.color = '#f87171';
    saldoInfo.textContent = `🔴 Quedará pendiente: ${nuevoSaldo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`;
  }
};

window.confirmarCobro = async function () {
  const pedido = App.pedidosList.find(p => p.id === pedidoEnModal);
  if (!pedido) return;

  const modoEdicionCheck = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
  if (pedido.estado === 'pagado' && !modoEdicionCheck) {
    showToast('Esta consigna ya está liquidada. Usa "Editar cobro" para corregir.', 'error');
    return;
  }

  const montoPagando = parseFloat(document.getElementById('modal-cobro-monto')?.value) || 0;

  const unidadesDevueltasCheck = parseFloat(document.getElementById('modal-cobro-devueltas')?.value) || 0;
  const productosCheck = pedido.productosEntregados || pedido.productos || [];
  const totalEntregadoCheck = pedido.totalEntregado || pedido.total || 0;
  let precioUnitarioCheck = 0;
  if (productosCheck.length === 1) {
    precioUnitarioCheck = productosCheck[0].precioUnitario || 0;
  } else if (productosCheck.length > 1) {
    const totalUnidadesCheck = productosCheck.reduce((s, pr) => s + (pr.cantidadEntregada ?? pr.cantidad ?? 0), 0);
    precioUnitarioCheck = totalUnidadesCheck > 0 ? totalEntregadoCheck / totalUnidadesCheck : 0;
  }
  const montoDevueltoCheck = unidadesDevueltasCheck * precioUnitarioCheck;
  const esDevolucionTotal = montoDevueltoCheck >= totalEntregadoCheck - 0.01;

  if (montoPagando <= 0 && !esDevolucionTotal && !modoEdicionCheck) {
    showToast('Ingresa un monto mayor a cero', 'error');
    return;
  }

  const notas = document.getElementById('modal-cobro-notas')?.value?.trim() || '';
  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;
  const modoEdicion = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
  const nuevoTotalCobrado = modoEdicion ? montoPagando : (yaCobrado + montoPagando);

  const unidadesDevueltas = parseFloat(document.getElementById('modal-cobro-devueltas')?.value) || 0;
  const productos = pedido.productosEntregados || pedido.productos || [];
  let precioUnitario = 0;
  if (productos.length === 1) {
    precioUnitario = productos[0].precioUnitario || 0;
  } else if (productos.length > 1) {
    const totalUnidades = productos.reduce((s, pr) => s + (pr.cantidadEntregada ?? pr.cantidad ?? 0), 0);
    precioUnitario = totalUnidades > 0 ? totalEntregado / totalUnidades : 0;
  }
  const montoDevuelto = unidadesDevueltas * precioUnitario;
  const totalRealDescontado = totalEntregado - montoDevuelto;
  const nuevoSaldo = totalRealDescontado - nuevoTotalCobrado;

const datos = {
    montoCobrado: nuevoTotalCobrado,
    deuda: nuevoSaldo > 0.01 ? nuevoSaldo : 0,
    estado: nuevoSaldo <= 0.01 ? 'pagado' : 'parcial',
    notasCobro: notas,
    unidadesDevueltas: unidadesDevueltas > 0 ? unidadesDevueltas : null,
    montoDevuelto: montoDevuelto > 0 ? montoDevuelto : null,
    ...(nuevoSaldo <= 0.01 ? { fechaCierre: new Date().toISOString().split('T')[0] } : {}),
  };

  try {
    const result = await Pedidos.actualizar(pedidoEnModal, datos);
    if (!result.success) throw new Error(result.error);

    const modoEdicionActual = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
    if (!modoEdicionActual && montoPagando > 0) {
      await Pedidos.registrarPago(pedidoEnModal, {
        monto: montoPagando,
        unidadesDevueltas,
        montoDevuelto,
        notas,
      });
    }

    // Regresar inventario si hay devoluciones
    if (unidadesDevueltas > 0) {
      const stockActual = { ...App.inventarioStock };
      const productos = pedido.productosEntregados || pedido.productos || [];
      if (productos.length === 1) {
        const nombre = productos[0].producto;
        stockActual[nombre] = (stockActual[nombre] || 0) + unidadesDevueltas;
        await Inventario.guardar(stockActual);
        await Inventario.registrarMovimiento('devolucion', [{
          producto: nombre,
          cantidad: unidadesDevueltas
        }], `Devolución cobro ${pedidoEnModal}`);
      }
    }

    showToast(nuevoSaldo <= 0.01 ? '✅ Consignación liquidada' : '💰 Pago registrado', 'success');
    cerrarModalCobro();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
};

// ============================================================
// CAMBIAR ESTADO
// ============================================================
window.cambiarEstado = async function (id, nuevoEstado) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  const estadosEntregados = ['entregado', 'pagado', 'parcial'];
  const estabaEntregado = estadosEntregados.includes(pedido.estado);
  const seEstaCancel = nuevoEstado === 'cancelado';
  const seEstaPendiente = nuevoEstado === 'pendiente';
  const esMuestra = pedido.tipoVenta === 'muestra';

  const result = await Pedidos.cambiarEstado(id, nuevoEstado);
  if (!result.success) {
    showToast('Error: ' + result.error, 'error');
    return;
  }

  // Si tenía productos ya entregados y se cancela o regresa a pendiente → devolver stock
  if (estabaEntregado && (seEstaCancel || seEstaPendiente || esMuestra && seEstaCancel)) {
    const productosEntregados = pedido.productosEntregados || pedido.productos || [];
    const tieneEntregados = productosEntregados.some(pr => (pr.cantidadEntregada ?? pr.cantidad ?? 0) > 0);

    if (tieneEntregados) {
      const stockActual = { ...App.inventarioStock };
      productosEntregados.forEach(pr => {
        const nombre = pr.producto;
        const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
        if (!nombre || cant <= 0) return;
        stockActual[nombre] = (stockActual[nombre] || 0) + cant;
      });

      await Inventario.guardar(stockActual);
      await Inventario.registrarMovimiento(
        'devolucion',
        productosEntregados.map(pr => ({
          producto: pr.producto,
          cantidad: pr.cantidadEntregada ?? pr.cantidad ?? 0
        })),
        `Cancelación/reversión pedido ${id}`
      );
      showToast('Stock regresado al inventario ✓', 'success');
    }
  }
};

// ============================================================
// ELIMINAR PEDIDO
// ============================================================
window.eliminarPedido = async function (id) {
  if (!confirm('¿Eliminar este pedido?')) return;

  const pedido = App.pedidosList.find(p => p.id === id);
  const estadosConStock = ['entregado', 'pagado', 'parcial'];

  if (pedido && estadosConStock.includes(pedido.estado)) {
    const productosEntregados = pedido.productosEntregados || pedido.productos || [];
    const tieneEntregados = productosEntregados.some(pr => (pr.cantidadEntregada ?? pr.cantidad ?? 0) > 0);

    if (tieneEntregados) {
      const stockActual = { ...App.inventarioStock };
      productosEntregados.forEach(pr => {
        const nombre = pr.producto;
        const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
        if (!nombre || cant <= 0) return;
        stockActual[nombre] = (stockActual[nombre] || 0) + cant;
      });
      await Inventario.guardar(stockActual);
      await Inventario.registrarMovimiento(
        'devolucion',
        productosEntregados.map(pr => ({
          producto: pr.producto,
          cantidad: pr.cantidadEntregada ?? pr.cantidad ?? 0
        })),
        `Eliminación pedido ${id} (${pedido.tipoVenta || 'directa'})`
      );
    }
  }

  const result = await Pedidos.eliminar(id);
  if (result.success) {
    showToast('Pedido eliminado ✓', 'success');
  } else {
    showToast('Error al eliminar', 'error');
  }
};

// ============================================================
// LISTENERS FIRESTORE
// ============================================================
function iniciarListeners() {
  const filtros = App.filtroActivo !== 'todos' ? { estado: App.filtroActivo } : {};
  if (App.perfil?.rol === 'vendedor') {
    filtros.vendedorId = App.usuario.uid;
  }

  App.unsubscribePedidos = Pedidos.escuchar(filtros, (pedidos) => {
    App.pedidosList = pedidos;
    renderPedidos();
    renderConsignas();
    actualizarDashboard();
  });

App.unsubscribeClientes = Clientes.escuchar((clientes) => {
    App.clientesList = clientes;
    renderClientes();
    poblarSelectClientes();
    const el = document.getElementById('stat-total-clientes');
    if (el) el.textContent = clientes.length;
  });

  App.unsubscribeInventario = Inventario.escuchar((stock) => {
    App.inventarioStock = stock;
    renderInventario();
  });
}

// ============================================================
// POBLAR SELECT CLIENTES EN PEDIDO
// ============================================================
function poblarSelectClientes() {
  const sel = document.getElementById('pedido-cliente-id');
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">— Elige un cliente —</option>' +
    App.clientesList.map(c => `<option value="${c.id}">${c.nombre || c.escuela} - ${c.telefono}</option>`).join('');
  if (actual) sel.value = actual;
}

// ============================================================
// RENDER PEDIDOS
// ============================================================
function renderPedidos() {
  const container = document.getElementById('pedidos-container');
  if (!container) return;

  let lista = App.pedidosList;

  if (App.filtroActivo !== 'todos') {
    lista = lista.filter(p => p.estado === App.filtroActivo);
  }

  if (App.busqueda) {
    const q = App.busqueda.toLowerCase();
    lista = lista.filter(p =>
      p.clienteNombre?.toLowerCase().includes(q) ||
      p.clienteEscuela?.toLowerCase().includes(q) ||
      (Array.isArray(p.productos) && p.productos.some(pr => pr.producto?.toLowerCase().includes(q)))
    );
  }

  if (lista.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin pedidos</div>`;
    return;
  }

  container.innerHTML = lista.map(p => {
    const fecha = p.createdAt instanceof Date ? p.createdAt.toLocaleDateString('es-MX') : '—';
    const totalMostrar = (p.totalEntregado !== undefined && p.totalEntregado !== null)
      ? p.totalEntregado - (p.montoDevuelto || 0)
      : (p.total || 0);
    const total = totalMostrar.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const estadoClass = {
      pendiente: 'badge-pendiente',
      entregado: 'badge-entregado',
      pagado: 'badge-pagado',
      parcial: 'badge-parcial',
      cancelado: 'badge-cancelado'
    }[p.estado] || '';

    const productosStr = Array.isArray(p.productos)
      ? p.productos.map(pr => `${pr.producto} ×${pr.cantidad}`).join(', ')
      : (p.producto ? `${p.producto} ×${p.cantidad}` : '—');

    const factBadge = p.clienteRequiereFactura
      ? `<span class="badge" style="background:rgba(255,182,39,0.15);color:var(--warning);margin-left:0.3rem;">🧾 Factura</span>`
      : '';

    const esConsig = p.tipoVenta === 'consignacion';
    const tipoBadge = esConsig
      ? `<span class="badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;margin-left:0.3rem;">📦 Consig.</span>`
      : p.tipoVenta === 'muestra'
      ? `<span class="badge" style="background:rgba(168,85,247,0.15);color:#c084fc;margin-left:0.3rem;">🎁 Muestra</span>`
      : `<span class="badge" style="background:rgba(34,197,94,0.15);color:#4ade80;margin-left:0.3rem;">💵 Directa</span>`;

    const deudaBadge = p.deuda > 0
      ? `<div style="font-size:0.75rem;color:#f87171;margin-top:0.2rem;">🔴 Deuda: ${p.deuda.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</div>`
      : '';

    const esPendiente = p.estado === 'pendiente';
    const esEntregadoConsig = p.estado === 'entregado' && esConsig;
    const esParcial = p.estado === 'parcial';

    return `
      <div class="pedido-card" data-id="${p.id}">
        <div class="pedido-header">
          <div>
            <div class="pedido-escuela">${p.clienteNombre || p.clienteEscuela || '—'}${factBadge}${tipoBadge}</div>
            <div class="pedido-meta">${productosStr}</div>
            ${deudaBadge}
          </div>
          <span class="badge ${estadoClass}">${p.estado}</span>
        </div>
        <div class="pedido-footer" style="padding:0.5rem 1rem;display:flex;justify-content:space-between;font-size:0.82rem;">
          <span style="font-weight:700;color:var(--accent2);">${total}</span>
          <span style="color:var(--text-muted);">${fecha}</span>
        </div>
        <div class="pedido-actions">
          <button class="btn btn-outline btn-sm" onclick="editarPedido('${p.id}')">✏️ Editar</button>
          ${esPendiente ? `<button class="btn btn-success btn-sm" onclick="abrirModalEntrega('${p.id}')">📦 Entregar</button>` : ''}
          ${esEntregadoConsig || esParcial ? `<button class="btn btn-primary btn-sm" onclick="abrirModalCobro('${p.id}')">💰 Cobrar</button>` : ''}
          <select class="estado-select" onchange="cambiarEstado('${p.id}', this.value)">
            <option value="pendiente" ${p.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
            <option value="entregado" ${p.estado === 'entregado' ? 'selected' : ''}>📦 Entregado</option>
            <option value="pagado" ${p.estado === 'pagado' ? 'selected' : ''}>✅ Pagado</option>
            <option value="parcial" ${p.estado === 'parcial' ? 'selected' : ''}>🔄 Parcial</option>
            <option value="cancelado" ${p.estado === 'cancelado' ? 'selected' : ''}>✕ Cancelado</option>
          </select>
          <button class="btn btn-danger btn-sm" onclick="eliminarPedido('${p.id}')">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// RENDER CONSIGNAS
// ============================================================
let filtroConsignas = 'activas';

function renderConsignas() {
  const container = document.getElementById('consignas-container');
  if (!container) return;

  let lista = App.pedidosList.filter(p => p.tipoVenta === 'consignacion' && p.estado !== 'pendiente' && p.estado !== 'cancelado');

  if (filtroConsignas === 'activas') {
    lista = lista.filter(p => p.estado === 'entregado');
  } else if (filtroConsignas === 'parcial') {
    lista = lista.filter(p => p.estado === 'parcial');
  } else if (filtroConsignas === 'liquidadas') {
    lista = lista.filter(p => p.estado === 'pagado');
  }

  const q = document.getElementById('buscar-consignas')?.value?.toLowerCase() || '';
  if (q) {
    lista = lista.filter(p => p.clienteNombre?.toLowerCase().includes(q));
  }

  const activas = App.pedidosList.filter(p =>
    p.tipoVenta === 'consignacion' &&
    (p.estado === 'entregado' || p.estado === 'parcial')
  ).length;
  const badge = document.getElementById('badge-consignas');
  if (badge) {
    badge.textContent = activas;
    badge.style.display = activas > 0 ? 'inline-block' : 'none';
  }
  const statEl = document.getElementById('stat-consignas-activas');
  if (statEl) statEl.textContent = activas;

  if (lista.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin consignas en este filtro</div>`;
    return;
  }

  container.innerHTML = lista.map(p => {
    const fechaPedido = p.fechaPedido || (p.createdAt instanceof Date ? p.createdAt.toLocaleDateString('es-MX') : '—');
    const fechaEntrega = p.fechaEntregadoReal || '—';

    let diasTexto = '';
    if (p.fechaPedido && p.fechaEntregadoReal) {
      const diff = Math.round((new Date(p.fechaEntregadoReal) - new Date(p.fechaPedido)) / (1000 * 60 * 60 * 24));
      diasTexto = `<span style="font-size:0.72rem;color:var(--text-muted);">⏱ ${diff} día${diff !== 1 ? 's' : ''} en entregar</span>`;
    }

    const totalEntregado = p.totalEntregado || p.total || 0;
    const yaCobrado = p.montoCobrado || 0;
    const montoDevuelto = p.montoDevuelto || 0;
    const saldoPendiente = (totalEntregado - montoDevuelto) - yaCobrado;

    const estadoClass = {
      entregado: 'badge-entregado',
      parcial: 'badge-parcial',
      pagado: 'badge-pagado',
    }[p.estado] || '';

    const productosEntregados = Array.isArray(p.productosEntregados) ? p.productosEntregados : (Array.isArray(p.productos) ? p.productos : []);
    const productosStr = productosEntregados.map(pr => {
      const cant = pr.cantidadEntregada ?? pr.cantidad;
      return `${pr.producto} ×${cant}`;
    }).join(', ');
    const puedecobrar = p.estado === 'entregado' || p.estado === 'parcial';
    const puedeeditar = p.estado === 'pagado' || p.estado === 'parcial';
    const tieneHistorial = p.estado === 'pagado' || p.estado === 'parcial';

    return `
      <div class="pedido-card" data-id="${p.id}">
        <div class="pedido-header">
          <div>
            <div class="pedido-escuela">${p.clienteNombre || '—'}</div>
            <div class="pedido-meta">${productosStr}</div>
            ${diasTexto}
          </div>
          <span class="badge ${estadoClass}">${p.estado}</span>
        </div>
        <div style="padding:0.5rem 1rem;font-size:0.8rem;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">📅 Pedido:</span>
            <span>${fechaPedido}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">🚚 Entregado:</span>
            <span>${fechaEntrega}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">💰 Total entregado:</span>
            <span style="font-weight:600;">${totalEntregado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">💵 Ya cobrado:</span>
            <span style="color:#4ade80;">${yaCobrado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
          </div>
          ${p.unidadesDevueltas > 0 ? `
          <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
            <span style="color:var(--text-muted);">↩️ Devueltas:</span>
            <span style="color:#f59e0b;">${p.unidadesDevueltas} piezas (${(p.montoDevuelto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})})</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--text-muted);">🔴 Saldo pendiente:</span>
            <span style="color:#f87171;font-weight:700;">${saldoPendiente.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
          </div>
        </div>
        <div class="pedido-actions">
          ${puedecobrar ? `<button class="btn btn-primary btn-sm" onclick="abrirModalCobro('${p.id}')">💰 Cobrar</button>` : ''}
          ${puedeeditar ? `<button class="btn btn-outline btn-sm" onclick="editarCobro('${p.id}')">✏️ Editar cobro</button>` : ''}
          ${tieneHistorial ? `<button class="btn btn-outline btn-sm" onclick="verHistorialCobros('${p.id}')">📋 Historial</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// RENDER CLIENTES
// ============================================================
function renderClientes() {
  const container = document.getElementById('clientes-container');
  if (!container) return;

  let lista = App.clientesList;

  const q = document.getElementById('buscar-clientes')?.value?.toLowerCase() || '';
  if (q) {
    lista = lista.filter(c =>
      c.nombre?.toLowerCase().includes(q) ||
      c.escuela?.toLowerCase().includes(q) ||
      c.telefono?.includes(q)
    );
  }

  if (lista.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin clientes registrados</div>`;
    return;
  }

  container.innerHTML = lista.map(c => `
    <div class="cliente-card" style="cursor:pointer;" onclick="editarCliente('${c.id}')">
      <div class="cliente-avatar">${(c.nombre || c.escuela || '?').charAt(0).toUpperCase()}</div>
      <div class="cliente-info">
        <div class="cliente-nombre">${c.nombre || c.escuela || '—'}
          ${c.requiereFactura === 'si' ? '<span class="badge" style="background:rgba(255,182,39,0.15);color:var(--warning);font-size:0.65rem;margin-left:4px;">🧾</span>' : ''}
        </div>
        <div class="cliente-detalle">${c.direccion || ''}</div>
        <div class="cliente-detalle">📞 ${c.telefono || '—'} · ${c.contacto || ''}</div>
        ${c.notas ? `<div class="cliente-detalle" style="font-style:italic;">📝 ${c.notas}</div>` : ''}
        ${c.ubicacion ? `<div class="cliente-detalle" style="color:var(--accent2);">📍 Ubicación guardada</div>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" onclick="eliminarCliente('${c.id}', event)" style="margin-left:auto; align-self:center; flex-shrink:0;">🗑️</button>
    </div>
  `).join('');
}

// ============================================================
// DASHBOARD
// ============================================================
function actualizarDashboard() {
  const pedidos = App.pedidosList;
  actualizarStatTotalVendido(pedidos);
  actualizarStatCobrado(pedidos);
  actualizarStatPendiente(pedidos);
  actualizarStatConsignacion(pedidos);
  actualizarStatPedidos(pedidos);
  actualizarStatTopProducto(pedidos);
  renderSeguimiento(pedidos);
}

function filtrarPorPeriodo(pedidos, periodo) {
  if (periodo === 'todo') return pedidos;
  const ahora = new Date();
  let desde;
  if (periodo === '7d') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 7);
  } else if (periodo === '30d') {
    desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 30);
  }
  if (!desde) return pedidos;
  return pedidos.filter(p => {
    const fecha = p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt);
    return fecha >= desde;
  });
}

function actualizarStatTotalVendido(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.totalVendido);
  const total = pedidos.reduce((s, p) => {
    const real = (p.totalEntregado !== undefined && p.totalEntregado !== null)
      ? p.totalEntregado - (p.montoDevuelto || 0)
      : (p.total || 0);
    return s + real;
  }, 0);
  setText('stat-total-vendido', total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
}

function actualizarStatCobrado(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.cobrado);
  const cobrado = pedidos.filter(p => p.estado === 'pagado').reduce((s, p) => {
    return s + (p.montoCobrado || p.totalEntregado || p.total || 0);
  }, 0);
  setText('stat-cobrado', cobrado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
}

function actualizarStatPendiente(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.pendiente);
  const pendiente = pedidos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + (p.total || 0), 0);
  setText('stat-pendiente', pendiente.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
}

function actualizarStatConsignacion(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.consignacion);
  const consig = pedidos
    .filter(p => p.tipoVenta === 'consignacion' && (p.estado === 'entregado' || p.estado === 'parcial'))
    .reduce((s, p) => {
      const entregado = p.totalEntregado || p.total || 0;
      const devuelto = p.montoDevuelto || 0;
      const cobrado = p.montoCobrado || 0;
      return s + (entregado - devuelto - cobrado);
    }, 0);
  setText('stat-consignacion', consig.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }));
}

function actualizarStatPedidos(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.pedidos);
  setText('stat-pedidos', pedidos.length);
}

function actualizarStatTopProducto(todos) {
  const pedidos = filtrarPorPeriodo(todos, App.filtrosDashboard.topProducto);
  const conteo = {};
  pedidos.forEach(p => {
    const productos = Array.isArray(p.productos) ? p.productos : (Array.isArray(p.productosEntregados) ? p.productosEntregados : []);
    productos.forEach(pr => {
      const nombre = pr.producto;
      if (!nombre) return;
      const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
      conteo[nombre] = (conteo[nombre] || 0) + cant;
    });
  });
  const top3 = Object.entries(conteo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const listaEl = document.getElementById('stat-top-lista');
  if (!listaEl) return;
  if (top3.length === 0) {
    listaEl.innerHTML = '—';
    return;
  }
  listaEl.innerHTML = top3.map(([prod, cant], i) =>
    `<div style="margin-bottom:2px;">${i+1}. ${prod} <strong>${cant}</strong></div>`
  ).join('');
}

function renderSeguimiento(pedidos) {
  const container = document.getElementById('seguimiento-container');
  if (!container) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const alertasCaducidad = pedidos.filter(p => {
    if (!p.fechaCaducidad) return false;
    const cad = new Date(p.fechaCaducidad + 'T12:00:00');
    const diasRestantes = Math.ceil((cad - hoy) / (1000 * 60 * 60 * 24));
    return diasRestantes <= 2 && p.estado !== 'pagado' && p.estado !== 'cancelado';
  });

  const alertasPedidos = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'parcial');

  if (alertasCaducidad.length === 0 && alertasPedidos.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;">✅ Todo al día</div>`;
    return;
  }

  let html = '';

  alertasCaducidad.forEach(p => {
    const cad = new Date(p.fechaCaducidad + 'T12:00:00');
    const diasRestantes = Math.ceil((cad - hoy) / (1000 * 60 * 60 * 24));
    const esVencido = diasRestantes < 0;
    const esHoy = diasRestantes === 0;
    const color = esVencido ? '#f87171' : diasRestantes <= 1 ? '#fb923c' : '#fbbf24';
    const texto = esVencido ? '¡Vencida!' : esHoy ? '¡Vence hoy!' : `Vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`;

    html += `
      <div class="seguimiento-item" onclick="navigateTo('consignas')" style="border-left:3px solid ${color};">
        <span>🫙</span>
        <div style="flex:1;">
          <div style="font-size:0.85rem;font-weight:600;">${p.clienteNombre || '—'}</div>
          <div style="font-size:0.75rem;color:${color};font-weight:600;">${texto}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Charola jícama · ${p.fechaCaducidad}</div>
        </div>
      </div>`;
  });

  alertasPedidos.slice(0, 5).forEach(p => {
    html += `
      <div class="seguimiento-item" onclick="editarPedido('${p.id}')">
        <span>${p.estado === 'pendiente' ? '⏳' : '🔄'}</span>
        <div>
          <div style="font-size:0.85rem;font-weight:600;">${p.clienteNombre || p.clienteEscuela || '—'}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${p.estado}</div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

// ============================================================
// REPORTE LOGÍSTICA
// ============================================================
function obtenerPendientesOrdenados() {
  const pendientes = App.pedidosList.filter(p => p.estado === 'pendiente');
  if (App.ubicacionBodega && pendientes.length > 0) {
    return ordenarPorRutaOptima(pendientes, App.ubicacionBodega);
  }
  return pendientes;
}

function generarTextoLogistica() {
  const pendientes = obtenerPendientesOrdenados();

  if (pendientes.length === 0) return null;

  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const rutaOptima = App.ubicacionBodega ? ' 🗺️ (ruta optimizada)' : '';

  let texto = `🚚 *RUTA JICMAR — ${hoy.toUpperCase()}*${rutaOptima}\n`;
  texto += `${'─'.repeat(30)}\n\n`;

  pendientes.forEach((p, i) => {
    texto += `*📦 PARADA ${i + 1}*\n`;
    texto += `🏫 *${p.clienteNombre || p.clienteEscuela || 'Sin nombre'}*\n`;
    if (p.clienteDireccion) texto += `📍 Dirección: ${p.clienteDireccion}\n`;
    if (p.clienteTelefono) texto += `📞 Tel: ${p.clienteTelefono}\n`;
    if (p.clienteContacto) texto += `👤 Contacto: ${p.clienteContacto}\n`;
    if (p.clienteUbicacion?.lat && p.clienteUbicacion?.lng) {
      texto += `🗺️ Ubicación: https://maps.google.com/?q=${p.clienteUbicacion.lat},${p.clienteUbicacion.lng}\n`;
    }
    texto += `\n🛍️ *Productos:*\n`;
    if (Array.isArray(p.productos)) {
      p.productos.forEach(pr => {
        texto += `  • ${pr.producto} × ${pr.cantidad} @ $${pr.precioUnitario}\n`;
      });
    }
    const tipoLabel = p.tipoVenta === 'consignacion' ? '📦 CONSIGNACIÓN' : '💵 VENTA DIRECTA';
    texto += `\n💼 Tipo: ${tipoLabel}\n`;
    if (p.clienteRequiereFactura) texto += `⚠️ *REQUIERE FACTURA*\n`;
    const totalFmt = (p.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    texto += `💰 Total: ${totalFmt}\n`;
    if (p.notas) texto += `📝 Notas: ${p.notas}\n`;
    texto += `\n${'─'.repeat(30)}\n\n`;
  });

  texto += `_Total de paradas: ${pendientes.length}_\n`;
  texto += `_Generado por Jicmar CRM_`;

  return texto;
}

function compartirWhatsApp() {
  const texto = generarTextoLogistica();
  if (!texto) {
    showToast('No hay pedidos pendientes para compartir', 'error');
    return;
  }
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

function imprimirRuta() {
  const pendientes = obtenerPendientesOrdenados();

  if (pendientes.length === 0) {
    showToast('No hay pedidos pendientes', 'error');
    return;
  }

  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let html = `
    <html><head><meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 20px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      .subtitulo { color: #555; font-size: 12px; margin-bottom: 20px; }
      .parada { border: 1px solid #ddd; border-radius: 8px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
      .parada-titulo { font-size: 15px; font-weight: bold; margin-bottom: 6px; }
      .detalle { margin: 3px 0; }
      .factura { background: #fff8e1; border-left: 3px solid #f5a623; padding: 5px 10px; margin: 6px 0; font-weight: bold; }
      .productos-tabla { width: 100%; border-collapse: collapse; margin: 8px 0; }
      .productos-tabla th { background: #f0f0f0; padding: 5px 8px; text-align: left; font-size: 12px; }
      .productos-tabla td { padding: 5px 8px; border-top: 1px solid #eee; font-size: 12px; }
      .tipo-venta { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; }
      .directa { background: #e8f5e9; color: #2e7d32; }
      .consignacion { background: #e3f2fd; color: #1565c0; }
      .total { font-weight: bold; font-size: 14px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>🚚 Ruta Jicmar</h1>
    <div class="subtitulo">${hoy} — ${pendientes.length} parada(s)</div>
    ${App.ubicacionBodega ? '<div style="background:#e8f5e9;color:#2e7d32;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:bold;display:inline-block;margin-bottom:12px;">🗺️ Ruta optimizada por distancia</div>' : ''}
  `;

  pendientes.forEach((p, i) => {
    const totalFmt = (p.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const tipoClass = p.tipoVenta === 'consignacion' ? 'consignacion' : 'directa';
    const tipoLabel = p.tipoVenta === 'consignacion' ? 'CONSIGNACIÓN' : 'VENTA DIRECTA';

    let mapsLink = '';
    if (p.clienteUbicacion?.lat && p.clienteUbicacion?.lng) {
      mapsLink = `<div class="detalle">🗺️ <a href="https://maps.google.com/?q=${p.clienteUbicacion.lat},${p.clienteUbicacion.lng}" target="_blank">Ver en Google Maps</a></div>`;
    }

    let productosHtml = '';
    if (Array.isArray(p.productos) && p.productos.length > 0) {
      productosHtml = `<table class="productos-tabla">
        <tr><th>Producto</th><th>Cant.</th><th>P.Unit.</th><th>Subtotal</th></tr>
        ${p.productos.map(pr => `<tr>
          <td>${pr.producto}</td>
          <td>${pr.cantidad}</td>
          <td>$${pr.precioUnitario}</td>
          <td>$${(pr.cantidad * pr.precioUnitario).toFixed(2)}</td>
        </tr>`).join('')}
      </table>`;
    }

    html += `
      <div class="parada">
        <div class="parada-titulo">📦 Parada ${i + 1} — ${p.clienteNombre || p.clienteEscuela || 'Sin nombre'}</div>
        ${p.clienteDireccion ? `<div class="detalle">📍 ${p.clienteDireccion}</div>` : ''}
        ${p.clienteTelefono ? `<div class="detalle">📞 ${p.clienteTelefono}</div>` : ''}
        ${p.clienteContacto ? `<div class="detalle">👤 ${p.clienteContacto}</div>` : ''}
        ${mapsLink}
        ${p.clienteRequiereFactura ? `<div class="factura">⚠️ REQUIERE FACTURA</div>` : ''}
        ${productosHtml}
        <div class="detalle"><span class="tipo-venta ${tipoClass}">${tipoLabel}</span></div>
        ${p.notas ? `<div class="detalle">📝 ${p.notas}</div>` : ''}
        <div class="detalle total">Total: ${totalFmt}</div>
      </div>`;
  });

  html += `<div style="margin-top:16px;color:#888;font-size:11px;">Generado por Jicmar CRM</div></body></html>`;

  const ventana = window.open('', '_blank');
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 500);
}

// ============================================================
// HELPERS
// ============================================================
function val(id) { return document.getElementById(id)?.value?.trim() || ''; }
function num(id) { return parseFloat(document.getElementById(id)?.value) || 0; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ============================================================
// RESET FORMS
// ============================================================
function resetFormPedido() {
  document.getElementById('form-pedido')?.reset();
  App.fotoURL = null;
  App.fotoOriginal = null;
  App.modoEdicion = null;
  App.ubicacionCapturada = null;
  App.productosEnPedido = [];
  const preview = document.getElementById('foto-preview');
  if (preview) preview.innerHTML = '';
  const aviso = document.getElementById('aviso-factura');
  if (aviso) aviso.style.display = 'none';
  const muestraSec = document.getElementById('muestra-section');
  if (muestraSec) muestraSec.style.display = 'none';
  const muestraInput = document.getElementById('muestra-prospecto');
  if (muestraInput) muestraInput.value = '';
  const clienteLabel = document.querySelector('label[for="pedido-cliente-id"]');
  if (clienteLabel) clienteLabel.textContent = 'Seleccionar cliente *';
  renderProductosEnPedido();
  document.getElementById('form-pedido-title').textContent = '📝 Nuevo Pedido';
  const fechaEl = document.getElementById('fecha-pedido');
  if (fechaEl) fechaEl.value = new Date().toISOString().split('T')[0];
}

function resetFormCliente() {
  document.getElementById('form-cliente')?.reset();
  App.modoEdicionCliente = null;
  App.ubicacionClienteCapturada = null;
  const locEl = document.getElementById('location-result-cliente');
  if (locEl) { locEl.textContent = ''; locEl.style.display = 'none'; }
  document.getElementById('form-cliente-title').textContent = '👤 Nuevo Cliente';
  resetINE();
}

// ============================================================
// UI
// ============================================================
function mostrarLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  const nombre = App.perfil?.nombre || App.usuario?.email || 'U';
  setText('user-name', nombre);
  setText('user-avatar', nombre.charAt(0).toUpperCase());
}

function limpiarListeners() {
  if (App.unsubscribePedidos) { App.unsubscribePedidos(); App.unsubscribePedidos = null; }
  if (App.unsubscribeClientes) { App.unsubscribeClientes(); App.unsubscribeClientes = null; }
  if (App.unsubscribeInventario) { App.unsubscribeInventario(); App.unsubscribeInventario = null; }
}

// ============================================================
// UBICACIÓN GPS
// ============================================================
function capturarUbicacion(targetId, resultId) {
  if (!navigator.geolocation) {
    showToast('GPS no disponible', 'error');
    return;
  }
  showToast('Obteniendo ubicación...', 'success');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (targetId === 'cliente') {
        App.ubicacionClienteCapturada = loc;
      } else {
        App.ubicacionCapturada = loc;
      }
      const el = document.getElementById(resultId);
      if (el) {
        el.textContent = `📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
        el.style.display = 'flex';
      }
      showToast('Ubicación capturada ✓', 'success');
    },
    () => showToast('No se pudo obtener la ubicación', 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ============================================================
// EVENTOS
// ============================================================
function inicializarEventos() {

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    const email = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const result = await Auth.login(email, password);
    if (!result.success) {
      showToast(result.error, 'error');
      btn.disabled = false;
      btn.textContent = 'Entrar →';
    }
  });

  document.getElementById('user-chip')?.addEventListener('click', mostrarModalLogout);
  document.getElementById('btn-logout-cancelar')?.addEventListener('click', ocultarModalLogout);
  document.getElementById('btn-logout-confirmar')?.addEventListener('click', async () => {
    ocultarModalLogout();
    await Auth.logout();
  });
  document.getElementById('modal-logout')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-logout')) ocultarModalLogout();
  });

  document.getElementById('form-pedido')?.addEventListener('submit', handleSubmitPedido);
  document.getElementById('form-cliente')?.addEventListener('submit', handleSubmitCliente);
  document.getElementById('foto-input')?.addEventListener('change', handleFotoChange);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) window.navigateTo(page);
    });
  });

  document.querySelectorAll('.filtro-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      App.filtroActivo = chip.dataset.estado;
      renderPedidos();
    });
  });

  document.getElementById('buscar-pedidos')?.addEventListener('input', (e) => {
    App.busqueda = e.target.value;
    renderPedidos();
  });

  document.getElementById('buscar-clientes')?.addEventListener('input', () => renderClientes());
  document.getElementById('buscar-consignas')?.addEventListener('input', () => renderConsignas());

  document.querySelectorAll('.filtro-chip-consig').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filtro-chip-consig').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filtroConsignas = chip.dataset.filtro;
      renderConsignas();
    });
  });

  document.querySelectorAll('input[name="tipoVenta"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const consigSec = document.getElementById('consignacion-section');
      const muestraSec = document.getElementById('muestra-section');
      const clienteSec = document.getElementById('pedido-cliente-id')?.closest('.form-card');
      if (consigSec) consigSec.style.display = radio.value === 'consignacion' ? 'block' : 'none';
      if (muestraSec) muestraSec.style.display = radio.value === 'muestra' ? 'block' : 'none';
      // Cliente opcional en muestra
      const clienteLabel = document.querySelector('label[for="pedido-cliente-id"]');
      if (clienteLabel) clienteLabel.textContent = radio.value === 'muestra'
        ? 'Cliente (opcional para muestras)'
        : 'Seleccionar cliente *';
    });
  });
  const consigSec = document.getElementById('consignacion-section');
  if (consigSec) consigSec.style.display = 'none';
  const muestraSec = document.getElementById('muestra-section');
  if (muestraSec) muestraSec.style.display = 'none';

  document.getElementById('btn-ubicacion-cliente')?.addEventListener('click', () => {
    capturarUbicacion('cliente', 'location-result-cliente');
  });

  document.getElementById('btn-nuevo-cliente')?.addEventListener('click', () => {
    App.modoEdicionCliente = null;
    window.navigateTo('nuevo-cliente');
  });

  document.getElementById('btn-agregar-producto')?.addEventListener('click', agregarProductoVacio);

  document.getElementById('pedido-cliente-id')?.addEventListener('change', (e) => {
    actualizarAvisoFactura(e.target.value);
  });

  document.getElementById('btn-compartir-whatsapp')?.addEventListener('click', compartirWhatsApp);
  document.getElementById('btn-imprimir-ruta')?.addEventListener('click', imprimirRuta);
  document.getElementById('btn-generar-pdf')?.addEventListener('click', generarPDF);

  document.querySelectorAll('.stat-periodo').forEach(select => {
    select.addEventListener('change', (e) => {
      const stat = e.target.dataset.stat;
      App.filtrosDashboard[stat] = e.target.value;
      actualizarDashboard();
    });
  });

  document.getElementById('btn-exportar-json')?.addEventListener('click', exportarJSON);
  document.getElementById('input-importar-json')?.addEventListener('change', importarJSON);

  renderProductosEnPedido();

  const fechaEl = document.getElementById('fecha-pedido');
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().split('T')[0];
}
async function generarPDF() {
  const inicio = document.getElementById('fecha-inicio')?.value;
  const fin = document.getElementById('fecha-fin')?.value;
  if (!inicio || !fin) {
    showToast('Selecciona rango de fechas', 'error');
    return;
  }

  showToast('Generando reporte...', 'success');

  const todosPedidos = await Pedidos.obtenerPorFecha('2020-01-01', fin);


const pedidos = todosPedidos.filter(p => {
  const fechaEntrega = p.fechaEntregadoReal ? new Date(p.fechaEntregadoReal + 'T12:00:00') : null;
  const fechaCierre = p.fechaCierre ? new Date(p.fechaCierre + 'T12:00:00') : null;
  const fechaRef = fechaCierre || fechaEntrega;
  if (!fechaRef) return false;
  return fechaRef >= inicioDate && fechaRef <= finDate;
});
  const hoy = new Date().toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const inicioFmt = new Date(inicio + 'T12:00:00').toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
  const finFmt   = new Date(fin   + 'T12:00:00').toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
  const fmt = v => v.toLocaleString('es-MX', { style:'currency', currency:'MXN' });

  // ── DATOS RESUMEN ──
  const totalFacturado = pedidos.reduce((s,p) => {
    const real = (p.totalEntregado !== undefined && p.totalEntregado !== null)
      ? p.totalEntregado - (p.montoDevuelto || 0) : (p.total || 0);
    return s + real;
  }, 0);
  const totalCobrado = pedidos
    .filter(p => ['pagado','parcial'].includes(p.estado))
    .reduce((s,p) => s + (p.montoCobrado || 0), 0);
  const totalPendiente = pedidos
    .filter(p => ['entregado','parcial'].includes(p.estado))
    .reduce((s,p) => s + (p.deuda || 0), 0);
  const totalPedidos = pedidos.length;

  // Producto más vendido
  const conteoProds = {};
  pedidos.forEach(p => {
    (p.productosEntregados || p.productos || []).forEach(pr => {
      if (!pr.producto) return;
      conteoProds[pr.producto] = (conteoProds[pr.producto] || 0) + (pr.cantidadEntregada ?? pr.cantidad ?? 0);
    });
  });
  const topProd = Object.entries(conteoProds).sort((a,b) => b[1]-a[1])[0];

  // Clientes nuevos en el período
  const inicioDate = new Date(inicio + 'T00:00:00');
  const finDate    = new Date(fin + 'T23:59:59');
  const clientesNuevos = App.clientesList.filter(c => {
    if (!c.createdAt) return false;
    const f = c.createdAt.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
    return f >= inicioDate && f <= finDate;
  }).length;

  // ── TABLA MAESTRA INVENTARIO ──
  const mapaInv = {};
  PRODUCTOS_CATALOGO.forEach(p => {
    const nombre = typeof p === 'string' ? p : p.nombre;
    mapaInv[nombre] = { directa:0, consigna:0, devuelto:0, muestras:0, importe:0 };
  });
  pedidos.forEach(p => {
    const prods = p.productosEntregados || p.productos || [];
    prods.forEach(pr => {
      if (!pr.producto) return;
      if (!mapaInv[pr.producto]) mapaInv[pr.producto] = { directa:0, consigna:0, devuelto:0, muestras:0, importe:0 };
      const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
      const precio = pr.precioUnitario ?? 0;
      if (p.tipoVenta === 'muestra') {
        mapaInv[pr.producto].muestras += cant;
      } else if (p.tipoVenta === 'consignacion') {
        mapaInv[pr.producto].consigna += cant;
        if (['pagado','parcial'].includes(p.estado)) {
          mapaInv[pr.producto].importe += cant * precio - (p.montoDevuelto || 0);
        }
      } else {
        mapaInv[pr.producto].directa += cant;
        mapaInv[pr.producto].importe += cant * precio;
      }
      if (p.unidadesDevueltas > 0 && p.tipoVenta === 'consignacion') {
        mapaInv[pr.producto].devuelto += p.unidadesDevueltas || 0;
      }
    });
  });

  const filasInv = Object.entries(mapaInv).filter(([,v]) =>
    v.directa > 0 || v.consigna > 0 || v.muestras > 0
  );
  const totInv = filasInv.reduce((s,[,v]) => ({
    directa:  s.directa  + v.directa,
    consigna: s.consigna + v.consigna,
    devuelto: s.devuelto + v.devuelto,
    muestras: s.muestras + v.muestras,
    importe:  s.importe  + v.importe,
  }), { directa:0, consigna:0, devuelto:0, muestras:0, importe:0 });
   // ── CONSIGNACIONES ACTIVAS ──
  const consigActivas = pedidos.filter(p =>
    p.tipoVenta === 'consignacion' && ['entregado','parcial'].includes(p.estado)
  );
  const totConsigEntregado = consigActivas.reduce((s,p) => s + (p.totalEntregado || p.total || 0), 0);
  const totConsigCobrado   = consigActivas.reduce((s,p) => s + (p.montoCobrado || 0), 0);
  const totConsigPendiente = totConsigEntregado - totConsigCobrado;

  // ── COBROS Y DEUDAS ──
  const directasDeuda = pedidos.filter(p =>
    p.tipoVenta !== 'consignacion' && p.estado === 'parcial' && p.deuda > 0
  );

  // ── RANKING CLIENTES ──
  const mapaClientes = {};
  pedidos.filter(p => ['pagado','parcial','entregado'].includes(p.estado)).forEach(p => {
    const id = p.clienteId || p.clienteNombre || 'desconocido';
    if (!mapaClientes[id]) mapaClientes[id] = { nombre: p.clienteNombre || '—', tipo: p.tipoVenta, productos:{}, total:0 };
    (p.productosEntregados || p.productos || []).forEach(pr => {
      if (!pr.producto) return;
      if (!mapaClientes[id].productos[pr.producto])
        mapaClientes[id].productos[pr.producto] = { cant:0, precio:0, total:0 };
      const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
      const precio = pr.precioUnitario ?? 0;
      mapaClientes[id].productos[pr.producto].cant  += cant;
      mapaClientes[id].productos[pr.producto].precio = precio;
      mapaClientes[id].productos[pr.producto].total += cant * precio;
      mapaClientes[id].total += cant * precio;
    });
  });
  const rankingClientes = Object.values(mapaClientes).sort((a,b) => b.total - a.total);
  const granTotal = rankingClientes.reduce((s,c) => s + c.total, 0);

  // ── CLIENTES INACTIVOS ──
  const idsActivos = new Set(pedidos.map(p => p.clienteId).filter(Boolean));
  const inactivos  = App.clientesList.filter(c => !idsActivos.has(c.id));

  // ════════════════════════════════════════════
  // HTML DEL REPORTE
  // ════════════════════════════════════════════
  const css = `
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#1a1a2e; background:#fff; padding:28px; }
    /* ENCABEZADO */
    .header { background:#0f172a; padding:24px 32px 20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-bottom:28px; border-radius:8px; }
    .header-logo { display:flex; align-items:center; gap:14px; }
    .logo-img { width:52px; height:52px; border-radius:12px; object-fit:contain; }
    .logo-text-nombre { font-size:22px; font-weight:900; color:#fff; letter-spacing:-0.5px; }
    .logo-text-sub { font-size:10px; color:#94a3b8; margin-top:2px; }
    .header-right { text-align:right; }
    .header-titulo { font-size:15px; font-weight:700; color:#fff; }
    .header-periodo { font-size:11px; color:#f5a623; margin-top:5px; background:rgba(245,166,35,0.12); display:inline-block; padding:3px 10px; border-radius:20px; }
    .header-generado { font-size:10px; color:#64748b; margin-top:5px; }
    /* TARJETAS */
    .tarjetas { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:32px; }
    .tarjeta { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px; position:relative; overflow:hidden; }
    .tarjeta::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; }
    .t-verde::before  { background:#22c55e; }
    .t-naranja::before{ background:#f5a623; }
    .t-rojo::before   { background:#ef4444; }
    .t-azul::before   { background:#3b82f6; }
    .t-morado::before { background:#a855f7; }
    .t-cyan::before   { background:#06b6d4; }
    .tarjeta-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:5px; white-space:nowrap; }
    .tarjeta-valor { font-size:19px; font-weight:800; color:#0f172a; line-height:1; }
    .tarjeta-sub { font-size:10px; color:#94a3b8; margin-top:3px; }
    /* SECCIÓN */
    .seccion { margin-bottom:32px; page-break-inside:avoid; }
    .sec-header { display:flex; align-items:center; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:2px solid #f1f5f9; }
    .sec-icono { width:30px; height:30px; background:#0f172a; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
    .sec-titulo { font-size:14px; font-weight:700; color:#0f172a; }
    .sec-sub { font-size:10px; color:#94a3b8; margin-top:1px; }
    /* TABLA */
    table { width:100%; border-collapse:collapse; font-size:11px; }
    thead tr { background:#0f172a; }
    th { padding:8px 10px; text-align:left; font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.3px; white-space:nowrap; }
    th.r { text-align:right; }
    td { padding:7px 10px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
    td.r { text-align:right; }
    td.c { text-align:center; }
    tr:nth-child(even) td { background:#f8fafc; }
    .fila-total td { background:#0f172a !important; color:#fff !important; font-weight:700; font-size:11.5px; padding:9px 10px; }
    .fila-total td.r { text-align:right; }
    /* NOTA */
    .nota { background:#eff6ff; border-left:3px solid #3b82f6; padding:8px 12px; border-radius:0 8px 8px 0; font-size:10.5px; color:#1e40af; margin-bottom:12px; }
    .nota-warn { background:#fef3c7; border-left:3px solid #f5a623; padding:8px 12px; border-radius:0 8px 8px 0; font-size:10.5px; color:#92400e; margin-bottom:12px; }
    /* BADGES */
    .badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:600; }
    .bg-verde  { background:#dcfce7; color:#15803d; }
    .bg-azul   { background:#dbeafe; color:#1d4ed8; }
    .bg-naranja{ background:#fef3c7; color:#b45309; }
    .bg-rojo   { background:#fee2e2; color:#b91c1c; }
    /* CLIENTE BLOQUE */
    .cli-bloque { border:1px solid #e2e8f0; border-radius:10px; margin-bottom:12px; overflow:hidden; }
    .cli-header { background:#f8fafc; padding:9px 14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; }
    .cli-nombre { font-weight:700; font-size:12px; }
    .cli-rank { font-size:10px; color:#94a3b8; margin-right:6px; }
    .cli-badge { background:#0f172a; color:#f5a623; padding:3px 12px; border-radius:20px; font-size:11px; font-weight:700; }
    .barra-wrap { background:#f1f5f9; border-radius:4px; height:5px; margin-top:4px; }
    .barra-fill { height:5px; border-radius:4px; background:linear-gradient(90deg,#f5a623,#e8860a); }
    /* GRID COBROS */
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .cobros-caja { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; font-size:11px; }
    .cobros-fila { display:flex; justify-content:space-between; margin-bottom:6px; }
    .cobros-fila.total { padding-top:6px; border-top:1px solid #e2e8f0; margin-top:4px; }
    /* FOOTER */
    .footer { margin-top:32px; padding-top:12px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#94a3b8; }
    .footer strong { color:#0f172a; }
    .pie-notas { font-size:9.5px; color:#94a3b8; margin-top:10px; display:flex; gap:16px; flex-wrap:wrap; }
    @media print { body { padding:14px; } .seccion { page-break-inside:avoid; } }
  `;
  // ── 1. ENCABEZADO ──
  let html = `<html><head><meta charset="UTF-8"><style>${css}</style></head><body>
  <div class="header">
    <div class="header-logo">
      <img src="./icon-192.png" class="logo-img" onerror="this.style.display='none'" />
      <div>
        <div class="logo-text-nombre">JICMAR</div>
        <div class="logo-text-sub">Sistema de gestión de ventas</div>
      </div>
    </div>
    <div class="header-right">
      <div class="header-titulo">Reporte de operaciones</div>
      <div class="header-periodo">📅 ${inicioFmt} — ${finFmt}</div>
      <div class="header-generado">Generado el ${hoy}</div>
    </div>
  </div>`;

  // ── 2. RESUMEN EJECUTIVO ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">📊</div>
      <div><div class="sec-titulo">Resumen ejecutivo</div>
      <div class="sec-sub">Totales del período seleccionado</div></div>
    </div>
    <div class="tarjetas">
      <div class="tarjeta t-verde">
        <div class="tarjeta-label">Total cobrado</div>
        <div class="tarjeta-valor">${fmt(totalCobrado)}</div>
        <div class="tarjeta-sub">Dinero ya en mano</div>
      </div>
      <div class="tarjeta t-naranja">
        <div class="tarjeta-label">Total facturado</div>
        <div class="tarjeta-valor">${fmt(totalFacturado)}</div>
        <div class="tarjeta-sub">Ventas cerradas + consignas</div>
      </div>
      <div class="tarjeta t-rojo">
        <div class="tarjeta-label">Pendiente por cobrar</div>
        <div class="tarjeta-valor">${fmt(totalPendiente)}</div>
        <div class="tarjeta-sub">Deuda activa del período</div>
      </div>
      <div class="tarjeta t-azul">
        <div class="tarjeta-label">Total de pedidos</div>
        <div class="tarjeta-valor">${totalPedidos}</div>
        <div class="tarjeta-sub">Registrados en el período</div>
      </div>
      <div class="tarjeta t-morado">
        <div class="tarjeta-label">Producto estrella</div>
        <div class="tarjeta-valor" style="font-size:13px;margin-top:3px;">${topProd ? topProd[0] : '—'}</div>
        <div class="tarjeta-sub">${topProd ? topProd[1] + ' piezas vendidas' : 'Sin datos'}</div>
      </div>
      <div class="tarjeta t-cyan">
        <div class="tarjeta-label">Clientes nuevos</div>
        <div class="tarjeta-valor">${clientesNuevos}</div>
        <div class="tarjeta-sub">Registrados en el período</div>
      </div>
    </div>
  </div>`;

  // ── 3. TABLA MAESTRA INVENTARIO ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">📦</div>
      <div><div class="sec-titulo">Movimiento de productos en el período</div>
      <div class="sec-sub">Ventas directas, consignaciones, devoluciones y muestras por producto</div></div>
    </div>
    <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th style="min-width:160px;">Producto</th>
        <th class="r">V. Directa</th>
        <th class="r">V. Consigna</th>
        <th class="r">Devuelto</th>
        <th class="r">Muestras</th>
        <th class="r">Total piezas</th>
        <th class="r">$ Vendido</th>
      </tr></thead>
      <tbody>`;

  if (filasInv.length === 0) {
    html += `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:16px;">Sin movimientos en este período</td></tr>`;
  } else {
    filasInv.forEach(([nombre, v]) => {
      const totalPiezas = v.directa + v.consigna - v.devuelto;
      html += `<tr>
        <td><strong>${nombre}</strong></td>
        <td class="r">${v.directa > 0 ? v.directa : '—'}</td>
        <td class="r">${v.consigna > 0 ? v.consigna : '—'}</td>
        <td class="r" style="color:${v.devuelto > 0 ? '#f59e0b' : 'inherit'};">${v.devuelto > 0 ? v.devuelto : '—'}</td>
        <td class="r" style="color:#a855f7;">${v.muestras > 0 ? v.muestras : '—'}</td>
        <td class="r"><strong>${totalPiezas}</strong></td>
        <td class="r"><strong>${fmt(v.importe)}</strong></td>
      </tr>`;
    });
  }

  html += `</tbody>
    <tfoot><tr class="fila-total">
      <td>TOTALES</td>
      <td class="r">${totInv.directa}</td>
      <td class="r">${totInv.consigna}</td>
      <td class="r">${totInv.devuelto}</td>
      <td class="r">${totInv.muestras}</td>
      <td class="r">${totInv.directa + totInv.consigna - totInv.devuelto}</td>
      <td class="r">${fmt(totInv.importe)}</td>
    </tr></tfoot>
    </table></div>
    <div class="pie-notas">
      <span>📌 <strong>V. Consigna</strong> — producto que salió a consigna. No cuenta como venta hasta cobrar.</span>
      <span>↩️ <strong>Devuelto</strong> — regresó a bodega desde consigna o cancelación.</span>
      <span>🎁 <strong>Muestras</strong> — salidas sin cobro para prospección.</span>
      <span>💰 <strong>$ Vendido</strong> — solo ventas directas + consignas ya cobradas.</span>
    </div>
  </div>`;
    // ── 4. CONSIGNACIONES ACTIVAS ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">🚚</div>
      <div><div class="sec-titulo">Consignaciones activas</div>
      <div class="sec-sub">Producto en calle — pendiente de cobro total</div></div>
    </div>
    <div class="nota">ℹ️ El saldo es una <strong>deuda posible</strong>. El cliente puede pagar, devolver el producto o una combinación de ambas.</div>`;

  if (consigActivas.length === 0) {
    html += `<p style="color:#94a3b8;font-size:11px;padding:12px 0;">Sin consignaciones activas en este período.</p>`;
  } else {
    html += `<table><thead><tr>
      <th>Cliente</th><th>Productos entregados</th>
      <th class="r">Entregado</th><th class="r">Ya cobrado</th>
      <th class="r">Saldo posible</th><th>Desde</th><th>Estado</th>
    </tr></thead><tbody>`;
    consigActivas.forEach(p => {
      const entregado = p.totalEntregado || p.total || 0;
      const cobrado   = p.montoCobrado || 0;
      const saldo     = entregado - cobrado;
      const prods     = (p.productosEntregados || p.productos || [])
        .map(pr => `${pr.producto} ×${pr.cantidadEntregada ?? pr.cantidad}`).join(', ');
      html += `<tr>
        <td><strong>${p.clienteNombre || '—'}</strong></td>
        <td style="font-size:10px;color:#64748b;">${prods}</td>
        <td class="r">${fmt(entregado)}</td>
        <td class="r" style="color:#22c55e;">${fmt(cobrado)}</td>
        <td class="r" style="color:#ef4444;font-weight:700;">${fmt(saldo)}</td>
        <td style="font-size:10px;">${p.fechaEntregadoReal || p.fechaPedido || '—'}</td>
        <td><span class="badge ${p.estado === 'parcial' ? 'bg-naranja' : 'bg-azul'}">${p.estado}</span></td>
      </tr>`;
    });
    html += `</tbody><tfoot><tr class="fila-total">
      <td colspan="2">TOTAL EN CALLE</td>
      <td class="r">${fmt(totConsigEntregado)}</td>
      <td class="r">${fmt(totConsigCobrado)}</td>
      <td class="r">${fmt(totConsigPendiente)}</td>
      <td colspan="2"></td>
    </tr></tfoot></table>`;
  }
  html += `</div>`;

  // ── 5. COBROS Y DEUDAS ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">💰</div>
      <div><div class="sec-titulo">Cobros y deudas del período</div>
      <div class="sec-sub">Ventas directas con pago incompleto + resumen consignaciones</div></div>
    </div>
    <div class="grid2">
      <div>
        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #dbeafe;">
          💵 Ventas directas con deuda
        </div>`;

  if (directasDeuda.length === 0) {
    html += `<p style="color:#94a3b8;font-size:11px;padding:8px 0;">Sin ventas directas con deuda pendiente.</p>`;
  } else {
    html += `<table><thead><tr style="background:#1d4ed8;">
      <th>Cliente</th><th class="r">Total</th><th class="r">Cobrado</th><th class="r">Debe</th>
    </tr></thead><tbody>`;
    directasDeuda.forEach(p => {
      html += `<tr>
        <td><strong>${p.clienteNombre || '—'}</strong></td>
        <td class="r">${fmt(p.total || 0)}</td>
        <td class="r" style="color:#22c55e;">${fmt(p.montoCobrado || 0)}</td>
        <td class="r" style="color:#ef4444;font-weight:700;">${fmt(p.deuda || 0)}</td>
      </tr>`;
    });
    const totDebe = directasDeuda.reduce((s,p) => s + (p.deuda || 0), 0);
    html += `</tbody><tfoot><tr class="fila-total">
      <td>TOTAL</td><td></td><td></td><td class="r">${fmt(totDebe)}</td>
    </tr></tfoot></table>`;
  }

  html += `</div>
      <div>
        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #dcfce7;">
          📦 Resumen consignaciones
        </div>
        <div class="cobros-caja">
          <div class="cobros-fila"><span style="color:#64748b;">Consignas activas:</span><strong>${consigActivas.length}</strong></div>
          <div class="cobros-fila"><span style="color:#64748b;">Total entregado:</span><strong>${fmt(totConsigEntregado)}</strong></div>
          <div class="cobros-fila"><span style="color:#64748b;">Ya cobrado:</span><strong style="color:#22c55e;">${fmt(totConsigCobrado)}</strong></div>
          <div class="cobros-fila total"><span style="color:#64748b;">Saldo posible:</span><strong style="color:#ef4444;">${fmt(totConsigPendiente)}</strong></div>
        </div>
      </div>
    </div>
  </div>`;
   // ── 6. RANKING CLIENTES ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">🏆</div>
      <div><div class="sec-titulo">Ranking de clientes</div>
      <div class="sec-sub">Ordenado de mayor a menor compra en el período · Gran total: ${fmt(granTotal)}</div></div>
    </div>`;

  if (rankingClientes.length === 0) {
    html += `<p style="color:#94a3b8;font-size:11px;padding:8px 0;">Sin clientes con compras en este período.</p>`;
  } else {
    rankingClientes.forEach((c, idx) => {
      const pct = granTotal > 0 ? Math.round((c.total / granTotal) * 100) : 0;
      const prodOrdenados = Object.entries(c.productos).sort((a,b) => b[1].cant - a[1].cant);
      const tipoBadge = c.tipo === 'consignacion'
        ? `<span class="badge bg-azul" style="margin-left:8px;">Consignación</span>`
        : `<span class="badge bg-verde" style="margin-left:8px;">Directa</span>`;
      html += `
      <div class="cli-bloque">
        <div class="cli-header">
          <div style="display:flex;align-items:center;">
            <span class="cli-rank">#${idx+1}</span>
            <span class="cli-nombre">${c.nombre}</span>
            ${tipoBadge}
          </div>
          <span class="cli-badge">${fmt(c.total)}</span>
        </div>
        <div style="padding:10px 14px;">
          <table><thead><tr style="background:#f1f5f9;">
            <th>Producto</th><th class="r">Cantidad</th><th class="r">P. unit.</th><th class="r">Total</th>
          </tr></thead><tbody>`;
      prodOrdenados.forEach(([nombre, v]) => {
        html += `<tr>
          <td>${nombre}</td>
          <td class="r">${v.cant}</td>
          <td class="r">${fmt(v.precio)}</td>
          <td class="r"><strong>${fmt(v.total)}</strong></td>
        </tr>`;
      });
      html += `</tbody></table>
          <div style="margin-top:8px;">
            <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">${pct}% del total del período</div>
            <div class="barra-wrap"><div class="barra-fill" style="width:${pct}%;"></div></div>
          </div>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  // ── 7. CLIENTES INACTIVOS ──
  html += `
  <div class="seccion">
    <div class="sec-header">
      <div class="sec-icono">😴</div>
      <div><div class="sec-titulo">Clientes sin actividad en el período</div>
      <div class="sec-sub">Sin pedidos entre ${inicioFmt} — ${finFmt}</div></div>
    </div>`;

  if (inactivos.length === 0) {
    html += `<p style="color:#22c55e;font-size:11px;padding:8px 0;">✅ Todos los clientes tuvieron actividad en el período. ¡Excelente!</p>`;
  } else {
    html += `<div class="nota-warn">⚠️ ${inactivos.length} cliente(s) sin pedidos en el período. Considera contactarlos para reactivarlos.</div>
    <table><thead><tr>
      <th>#</th><th>Cliente</th><th>Teléfono</th><th>Dirección</th>
    </tr></thead><tbody>`;
    inactivos.forEach((c, i) => {
      html += `<tr>
        <td class="c">${i+1}</td>
        <td><strong>${c.nombre || c.escuela || '—'}</strong></td>
        <td>${c.telefono || '—'}</td>
        <td style="font-size:10px;color:#64748b;">${c.direccion || '—'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;
// ── 8. INVENTARIO ACTUAL ──
const stockActual = App.inventarioStock;
const productosInv = PRODUCTOS_CATALOGO;

const comprometidoInv = {};
App.pedidosList
  .filter(p => p.estado === 'pendiente')
  .forEach(p => {
    (Array.isArray(p.productos) ? p.productos : []).forEach(pr => {
      if (!pr.producto || !pr.cantidad) return;
      comprometidoInv[pr.producto] = (comprometidoInv[pr.producto] || 0) + pr.cantidad;
    });
  });

let totalBodega = 0;
let totalDisponible = 0;

html += `
<div class="seccion">
  <div class="sec-header">
    <div class="sec-icono">🏭</div>
    <div>
      <div class="sec-titulo">Inventario actual en bodega</div>
      <div class="sec-sub">Stock al momento de generar este reporte</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>Producto</th>
      <th class="r">En bodega</th>
      <th class="r">Pedidos pendientes</th>
      <th class="r">Disponible real</th>
      <th>Estado</th>
    </tr></thead>
    <tbody>
      ${productosInv.map(item => {
        const nombre = typeof item === 'string' ? item : item.nombre;
        const enBodega = stockActual[nombre] || 0;
        const enPedidos = comprometidoInv[nombre] || 0;
        const disponible = enBodega - enPedidos;
        totalBodega += enBodega;
        totalDisponible += disponible;
        const estadoTexto = disponible <= 0
          ? `<span class="badge bg-rojo">Sin stock</span>`
          : disponible <= 5
          ? `<span class="badge bg-naranja">Bajo</span>`
          : `<span class="badge bg-verde">OK</span>`;
        return `<tr>
          <td><strong>${nombre}</strong></td>
          <td class="r">${enBodega}</td>
          <td class="r" style="color:${enPedidos > 0 ? '#f59e0b' : 'inherit'};">
            ${enPedidos > 0 ? enPedidos : '—'}
          </td>
          <td class="r" style="color:${disponible <= 0 ? '#ef4444' : disponible <= 5 ? '#f59e0b' : '#22c55e'};font-weight:700;">
            ${disponible}
          </td>
          <td>${estadoTexto}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot><tr class="fila-total">
      <td>TOTAL</td>
      <td class="r">${totalBodega}</td>
      <td class="r">—</td>
      <td class="r">${totalDisponible}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div class="pie-notas">
    <span>📌 <strong>Pedidos pendientes</strong> — comprometidos pero aún no entregados.</span>
    <span>✅ <strong>Disponible real</strong> — lo que puedes entregar hoy.</span>
  </div>
</div>`;
  // ── FOOTER ──
  html += `
  <div class="footer">
    <span><strong>JICMAR</strong> · Sistema de gestión de ventas</span>
    <span>${inicioFmt} — ${finFmt} · Generado el ${hoy}</span>
  </div>
  </body></html>`;

  const v = window.open('', '_blank');
  v.document.write(html);
  v.document.close();
  v.focus();
  setTimeout(() => v.print(), 700);
}

// ============================================================
// INVENTARIO
// ============================================================
function renderInventario() {
  const container = document.getElementById('inventario-container');
  if (!container) return;

  const selectAjuste = document.getElementById('ajuste-producto');
  if (selectAjuste) {
    const valorActual = selectAjuste.value;
    selectAjuste.innerHTML = '<option value="">— Elige producto —</option>' +
      PRODUCTOS_CATALOGO.map(p => {
        const nombre = typeof p === 'string' ? p : p.nombre;
        return `<option value="${nombre}">${nombre}</option>`;
      }).join('');
    if (valorActual) selectAjuste.value = valorActual;
  }

  const stock = App.inventarioStock;
  const productos = PRODUCTOS_CATALOGO;

  if (productos.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin productos en catálogo.</div>`;
    return;
  }

  const comprometido = {};
  App.pedidosList
    .filter(p => p.estado === 'pendiente')
    .forEach(p => {
      const prods = Array.isArray(p.productos) ? p.productos : [];
      prods.forEach(pr => {
        if (!pr.producto || !pr.cantidad) return;
        comprometido[pr.producto] = (comprometido[pr.producto] || 0) + (pr.cantidad || 0);
      });
    });

  let html = `
    <div style="display:grid;grid-template-columns:1fr repeat(3,auto);gap:0.3rem 0.6rem;
      padding:0.5rem 0.75rem;font-size:0.7rem;font-weight:700;color:var(--text-muted);
      border-bottom:1px solid var(--border);margin-bottom:0.4rem;">
      <span>PRODUCTO</span>
      <span style="text-align:right;">BODEGA</span>
      <span style="text-align:right;">PEDIDOS</span>
      <span style="text-align:right;">DISPONIBLE</span>
    </div>`;

  let hayAlerta = false;

  productos.forEach(item => {
    const nombre = typeof item === 'string' ? item : item.nombre;
    const enBodega = stock[nombre] || 0;
    const enPedidos = comprometido[nombre] || 0;
    const disponible = enBodega - enPedidos;

    const colorBodega = enBodega <= 0 ? '#f87171' : enBodega <= 5 ? '#fbbf24' : '#4ade80';
    const colorDisp = disponible <= 0 ? '#f87171' : disponible <= 3 ? '#fbbf24' : '#4ade80';
    const iconoBodega = enBodega <= 0 ? '🔴' : enBodega <= 5 ? '🟡' : '🟢';

    if (disponible < 0) hayAlerta = true;

    html += `
      <div style="display:grid;grid-template-columns:1fr repeat(3,auto);gap:0.3rem 0.6rem;
        align-items:center;padding:0.65rem 0.75rem;background:var(--surface2);
        border-radius:10px;margin-bottom:0.4rem;border:1px solid var(--border);
        ${disponible < 0 ? 'border-color:#f87171;' : ''}">
        <span style="font-size:0.82rem;">${iconoBodega} ${nombre}</span>
        <span style="font-size:0.95rem;font-weight:700;color:${colorBodega};text-align:right;">${enBodega}</span>
        <span style="font-size:0.9rem;color:${enPedidos > 0 ? '#fbbf24' : 'var(--text-muted)'};text-align:right;">
          ${enPedidos > 0 ? '⏳ ' + enPedidos : '—'}
        </span>
        <span style="font-size:0.95rem;font-weight:700;color:${colorDisp};text-align:right;">${disponible}</span>
      </div>`;
  });

  if (hayAlerta) {
    html = `
      <div style="background:rgba(248,113,113,0.12);border:1px solid #f87171;border-radius:10px;
        padding:0.65rem 0.85rem;margin-bottom:0.75rem;font-size:0.82rem;color:#f87171;display:flex;gap:0.5rem;">
        ⚠️ <span>Tienes pedidos pendientes que superan tu stock. Registra entradas antes de salir.</span>
      </div>` + html;
  }

  container.innerHTML = html;
}

async function registrarEntradaInventario() {
  const container = document.getElementById('entrada-inventario-form');
  if (!container) return;
  console.log('Inventario object:', Inventario);

  const filas = container.querySelectorAll('.entrada-fila');
  const stockActual = { ...App.inventarioStock };
  const movimientos = [];
  let alguno = false;

  filas.forEach(fila => {
    const nombre = fila.querySelector('.entrada-producto')?.value;
    const cantidad = parseInt(fila.querySelector('.entrada-cantidad')?.value) || 0;
    if (!nombre || cantidad <= 0) return;
    stockActual[nombre] = (stockActual[nombre] || 0) + cantidad;
    movimientos.push({ producto: nombre, cantidad });
    alguno = true;
  });

  if (!alguno) {
    showToast('Agrega al menos un producto con cantidad', 'error');
    return;
  }

  const referencia = document.getElementById('entrada-referencia')?.value?.trim() || '';
  await Inventario.guardar(stockActual);
  await Inventario.registrarMovimiento('entrada', movimientos, referencia);
  showToast('Entrada registrada ✓', 'success');
  document.getElementById('entrada-referencia').value = '';
  renderFilasEntrada();
}

function renderFilasEntrada() {
  const container = document.getElementById('entrada-inventario-form');
  if (!container) return;

  container.innerHTML = `
    <div class="entrada-fila" style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
      <select class="entrada-producto" style="flex:1;padding:0.5rem;border-radius:8px;
        border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;">
        <option value="">— Producto —</option>
        ${PRODUCTOS_CATALOGO.map(p => {
          const nombre = typeof p === 'string' ? p : p.nombre;
          return `<option value="${nombre}">${nombre}</option>`;
        }).join('')}
      </select>
      <input type="number" min="1" placeholder="Cant." class="entrada-cantidad"
        style="width:80px;padding:0.5rem;border-radius:8px;border:1px solid var(--border);
        background:var(--surface);color:var(--text);font-size:0.85rem;" />
    </div>`;
}

window.agregarFilaEntrada = function() {
  const container = document.getElementById('entrada-inventario-form');
  if (!container) return;
  const fila = document.createElement('div');
  fila.className = 'entrada-fila';
  fila.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.5rem;';
  fila.innerHTML = `
    <select class="entrada-producto" style="flex:1;padding:0.5rem;border-radius:8px;
      border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;">
      <option value="">— Producto —</option>
      ${PRODUCTOS_CATALOGO.map(p => {
        const nombre = typeof p === 'string' ? p : p.nombre;
        return `<option value="${nombre}">${nombre}</option>`;
      }).join('')}
    </select>
    <input type="number" min="1" placeholder="Cant." class="entrada-cantidad"
      style="width:80px;padding:0.5rem;border-radius:8px;border:1px solid var(--border);
      background:var(--surface);color:var(--text);font-size:0.85rem;" />
    <button type="button" onclick="this.parentElement.remove()"
      style="padding:0.3rem 0.6rem;border-radius:8px;border:none;background:#f87171;color:white;cursor:pointer;">✕</button>`;
  container.appendChild(fila);
};

window.registrarEntradaInventario = registrarEntradaInventario;
window.renderFilasEntrada = renderFilasEntrada;

window.setTipoAjuste = function(tipo) {
  const btnSumar = document.getElementById('ajuste-btn-sumar');
  const btnRestar = document.getElementById('ajuste-btn-restar');
  if (tipo === 'sumar') {
    btnSumar.style.border = '2px solid #4ade80';
    btnSumar.style.background = 'rgba(74,222,128,0.15)';
    btnSumar.style.color = '#4ade80';
    btnRestar.style.border = '2px solid var(--border)';
    btnRestar.style.background = 'var(--surface)';
    btnRestar.style.color = 'var(--text-muted)';
  } else {
    btnRestar.style.border = '2px solid #f87171';
    btnRestar.style.background = 'rgba(248,113,113,0.15)';
    btnRestar.style.color = '#f87171';
    btnSumar.style.border = '2px solid var(--border)';
    btnSumar.style.background = 'var(--surface)';
    btnSumar.style.color = 'var(--text-muted)';
  }
  window._tipoAjuste = tipo;
};

window.registrarAjusteInventario = async function() {
  const producto = document.getElementById('ajuste-producto')?.value;
  const cantidad = parseInt(document.getElementById('ajuste-cantidad')?.value) || 0;
  const motivo = document.getElementById('ajuste-motivo')?.value?.trim() || '';
  const tipo = window._tipoAjuste || 'sumar';

  if (!producto) { showToast('Selecciona un producto', 'error'); return; }
  if (cantidad <= 0) { showToast('Ingresa una cantidad mayor a 0', 'error'); return; }

  const stockActual = { ...App.inventarioStock };
  const antes = stockActual[producto] || 0;
  stockActual[producto] = tipo === 'sumar' ? antes + cantidad : antes - cantidad;

  await Inventario.guardar(stockActual);
  await Inventario.registrarMovimiento('ajuste', [{
    producto, cantidad, tipo
  }], motivo || `Ajuste manual ${tipo}`);

  showToast(`Ajuste aplicado ✓ ${antes} → ${stockActual[producto]}`, 'success');
  document.getElementById('ajuste-cantidad').value = '';
  document.getElementById('ajuste-motivo').value = '';
  document.getElementById('ajuste-producto').value = '';
};
// ============================================================
// TOAST
// ============================================================
function showToast(msg, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.toggleReporteCard = function(card) {
  card.classList.toggle('selected');
};
window.showToast = showToast;

// ============================================================
// INE — Fotos de identificación del cliente
// ============================================================
function comprimirImagenBase64INE(file, maxWidth = 900) {
  return new Promise(res => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const escala = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * escala;
      canvas.height = img.height * escala;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      res(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.src = url;
  });
}

['frente', 'reverso'].forEach(lado => {
  const input = document.getElementById(`ine-${lado}-input`);
  if (!input) return;
  input.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    const preview = document.getElementById(`ine-${lado}-preview`);
    const label   = document.getElementById(`ine-${lado}-label`);
    const imgEl   = document.getElementById(`ine-${lado}-img`);
    preview.style.display = 'block';
    label.style.display = 'none';
    const base64 = await comprimirImagenBase64INE(file);
    imgEl.src = base64;
    showToast(`Foto ${lado} lista ✓`, 'success');
  });
});

window.eliminarFotoINELocal = async function (lado) {
  document.getElementById(`ine-${lado}-img`).src = '';
  document.getElementById(`ine-${lado}-preview`).style.display = 'none';
  document.getElementById(`ine-${lado}-label`).style.display = 'flex';
  document.getElementById(`ine-${lado}-input`).value = '';
  const clienteId = window._ineClienteId;
  if (!clienteId) return;
  try {
    await Clientes.actualizar(clienteId, { [`ine_${lado}`]: null });
    showToast(`Foto ${lado} eliminada`, 'success');
  } catch (e) { console.warn('Error eliminando:', e); }
};

window.abrirVisorINE = function (lado) {
  const src = document.getElementById(`ine-${lado}-img`).src;
  if (!src) return;
  document.getElementById('visor-ine-img').src = src;
  document.getElementById('modal-visor-ine').style.display = 'flex';
};

window.subirFotosINE = async function (clienteId) {
  const actualizacion = {};
  for (const lado of ['frente', 'reverso']) {
    const input = document.getElementById(`ine-${lado}-input`);
    if (!input || !input.files[0]) continue;
    const base64 = await comprimirImagenBase64INE(input.files[0]);
    actualizacion[`ine_${lado}`] = base64;
  }
  if (Object.keys(actualizacion).length > 0) {
    await Clientes.actualizar(clienteId, actualizacion);
  }
};

window.cargarFotosINE = function (clienteId) {
  window._ineClienteId = clienteId;
  const cliente = App.clientesList.find(c => c.id === clienteId);
  if (!cliente) return;
  for (const lado of ['frente', 'reverso']) {
    const url = cliente[`ine_${lado}`];
    if (url) {
      document.getElementById(`ine-${lado}-img`).src = url;
      document.getElementById(`ine-${lado}-preview`).style.display = 'block';
      document.getElementById(`ine-${lado}-label`).style.display = 'none';
    }
  }
};

function resetINE() {
  window._ineClienteId = null;
  for (const lado of ['frente', 'reverso']) {
    const img     = document.getElementById(`ine-${lado}-img`);
    const preview = document.getElementById(`ine-${lado}-preview`);
    const label   = document.getElementById(`ine-${lado}-label`);
    const input   = document.getElementById(`ine-${lado}-input`);
    if (img)     img.src = '';
    if (preview) preview.style.display = 'none';
    if (label)   label.style.display = 'flex';
    if (input)   input.value = '';
  }
}

window.editarCobro = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  pedidoEnModal = id;

  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;

  const resumen = document.getElementById('modal-cobro-resumen');
  resumen.innerHTML = `
    <div style="background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);border-radius:8px;padding:0.6rem;margin-bottom:0.5rem;font-size:0.8rem;color:#f59e0b;">
      ✏️ Modo edición — el monto que ingreses <strong>reemplazará</strong> el cobro anterior.
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
      <span style="color:var(--text-muted);">Cliente:</span>
      <span style="font-weight:600;">${pedido.clienteNombre || '—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
      <span style="color:var(--text-muted);">Total entregado:</span>
      <span>${totalEntregado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <span style="color:var(--text-muted);">Cobro registrado actualmente:</span>
      <span style="color:#4ade80;">${yaCobrado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
    </div>
  `;

  const montoInput = document.getElementById('modal-cobro-monto');
  if (montoInput) montoInput.value = yaCobrado;
  const notasInput = document.getElementById('modal-cobro-notas');
  if (notasInput) notasInput.value = pedido.notasCobro || '';
  const secDev = document.getElementById('seccion-devoluciones');
  if (secDev) secDev.style.display = 'block';
  const devInput = document.getElementById('modal-cobro-devueltas');
  if (devInput) devInput.value = pedido.unidadesDevueltas || '';

  document.getElementById('modal-cobro').dataset.modoEdicion = 'true';
  document.getElementById('modal-cobro').style.display = 'flex';
};

// ============================================================
// RESPALDO — Exportar / Importar JSON
// ============================================================
function exportarJSON() {
  const datos = {
    version: 1,
    fecha: new Date().toISOString(),
    pedidos: App.pedidosList,
    clientes: App.clientesList,
  };
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jicmar-respaldo-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Respaldo descargado ✓', 'success');
}

function importarJSON(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const datos = JSON.parse(ev.target.result);
      if (!datos.pedidos || !datos.clientes) throw new Error('Archivo inválido');
      const resultEl = document.getElementById('importar-resultado');
      resultEl.textContent = '⏳ Importando...';
      let okPedidos = 0, okClientes = 0;
      for (const p of datos.pedidos) {
        const { id, ...resto } = p;
        const r = await Pedidos.setConMerge(id, resto).catch(() => null);
        if (r?.success) okPedidos++;
      }
      for (const c of datos.clientes) {
        const { id, ...resto } = c;
        const r = await Clientes.setConMerge(id, resto).catch(() => null);
        if (r?.success) okClientes++;
      }
      resultEl.style.color = '#4ade80';
      resultEl.textContent = `✅ Importado: ${okPedidos} pedidos, ${okClientes} clientes`;
      showToast('Importación completada ✓', 'success');
    } catch (err) {
      document.getElementById('importar-resultado').textContent = '❌ Error: archivo inválido';
      showToast('Error al importar', 'error');
    }
  };
  reader.readAsText(archivo);
}

// ============================================================
// TIMELINE DE COBROS
// ============================================================
window.verHistorialCobros = async function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  const modal = document.getElementById('modal-timeline-cobros');
  const contenido = document.getElementById('timeline-cobros-contenido');

  contenido.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">⏳ Cargando historial...</div>`;
  modal.style.display = 'flex';

  const res = await Pedidos.obtenerPagos(id);
  const pagos = res.pagos || [];

  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const montoDevueltoTotal = pedido.montoDevuelto || 0;
  const montoCobradoTotal = pedido.montoCobrado || 0;
  const saldoPendiente = (totalEntregado - montoDevueltoTotal) - montoCobradoTotal;

  let html = `
    <div style="background:var(--surface2);border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.82rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;">
        <span style="color:var(--text-muted);">Cliente:</span>
        <span style="font-weight:700;">${pedido.clienteNombre || '—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;">
        <span style="color:var(--text-muted);">Total entregado:</span>
        <span>${totalEntregado.toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;">
        <span style="color:var(--text-muted);">Total cobrado:</span>
        <span style="color:#4ade80;font-weight:700;">${montoCobradoTotal.toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:0.3rem;margin-top:0.3rem;">
        <span style="font-weight:700;">Saldo pendiente:</span>
        <span style="font-weight:700;color:${saldoPendiente > 0.01 ? '#f87171' : '#4ade80'};">
          ${saldoPendiente <= 0.01 ? '✅ Liquidado' : saldoPendiente.toLocaleString('es-MX',{style:'currency',currency:'MXN'})}
        </span>
      </div>
    </div>`;

  if (pagos.length === 0) {
    html += `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem;">
      Sin historial de pagos registrado.<br>
      <span style="font-size:0.75rem;">Los cobros anteriores a esta actualización no aparecen aquí.</span>
    </div>`;
  } else {
    html += `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.75rem;">${pagos.length} pago(s) registrado(s)</div>`;
    let acumulado = 0;
    pagos.forEach((pago, i) => {
      acumulado += pago.monto || 0;
      const tieneDevolucion = pago.unidadesDevueltas > 0;
      html += `
        <div style="display:flex;gap:0.75rem;margin-bottom:0.85rem;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#000;flex-shrink:0;">${i+1}</div>
            ${i < pagos.length - 1 ? `<div style="width:2px;flex:1;background:var(--border);margin:2px 0;min-height:20px;"></div>` : ''}
          </div>
          <div style="flex:1;background:var(--surface2);border-radius:10px;padding:0.65rem 0.85rem;font-size:0.8rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
              <span style="font-weight:700;color:#4ade80;font-size:0.92rem;">+${(pago.monto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</span>
              <span style="font-size:0.7rem;color:var(--text-muted);">${pago.fechaTexto || '—'} · ${pago.hora || ''}</span>
            </div>
            ${tieneDevolucion ? `<div style="font-size:0.75rem;color:#f59e0b;margin-bottom:0.25rem;">↩️ ${pago.unidadesDevueltas} piezas devueltas (${(pago.montoDevuelto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})})</div>` : ''}
            ${pago.notas ? `<div style="font-size:0.75rem;color:var(--text-muted);font-style:italic;">📝 ${pago.notas}</div>` : ''}
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;border-top:1px solid var(--border);padding-top:0.25rem;">
              Acumulado: ${acumulado.toLocaleString('es-MX',{style:'currency',currency:'MXN'})}
            </div>
          </div>
        </div>`;
    });
  }

  contenido.innerHTML = html;
};

window.cerrarModalTimeline = function () {
  document.getElementById('modal-timeline-cobros').style.display = 'none';
};
