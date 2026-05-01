// ============================================================
// app.js — Jicmar CRM
// ============================================================

import { Auth, Config, Pedidos, Clientes, Storage } from './firebase.js';

// ============================================================
// CATÁLOGO DE PRODUCTOS
// ============================================================
const PRODUCTOS_CATALOGO = [
  'Charola jícama 250g',
  'Chicharrón garbanzo salsa negra',
  'Chicharrón garbanzo sal y limón',
  'Chicharrón garbanzo flaming hot',
  'Crujientes maíz salsa negra',
  'Crujientes maíz sal y limón',
  'Crujientes maíz flaming hot',
  'Crujientes maíz cheddar',
  'Jícama chips',
  'Jícama chips salsa negra',
  'Jícama chips adobadas',
];

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
  ubicacionBodega: null, // <-- Nueva: ubicación de bodega
};

window.App = App;

// ============================================================
// ALGORITMO DE RUTA ÓPTIMA (Vecino más cercano)
// ============================================================

// Calcula distancia en km entre dos coordenadas (fórmula Haversine)
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

// Ordena pedidos por ruta óptima partiendo desde la bodega
function ordenarPorRutaOptima(pedidos, bodega) {
  // Separar pedidos con y sin ubicación
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

  // Pedidos sin ubicación van al final
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

      // Cargar ubicación de bodega al iniciar sesión
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
        <select class="prod-select" data-idx="${idx}" onchange="actualizarProducto(${idx},'producto',this.value)">
          <option value="">— Elige producto —</option>
          ${PRODUCTOS_CATALOGO.map(p => `<option value="${p}" ${item.producto === p ? 'selected' : ''}>${p}</option>`).join('')}
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

window.quitarProducto = function (idx) {
  App.productosEnPedido.splice(idx, 1);
  renderProductosEnPedido();
};

function agregarProductoVacio() {
  App.productosEnPedido.push({ producto: '', cantidad: 0, precioUnitario: 0 });
  renderProductosEnPedido();
}

// ============================================================
// SUBMIT PEDIDO
// ============================================================
async function handleSubmitPedido(e) {
  e.preventDefault();

  const clienteId = document.getElementById('pedido-cliente-id')?.value;
  if (!clienteId) {
    showToast('Selecciona un cliente', 'error');
    return;
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
    const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked')?.value || 'directa';
    const cliente = App.clientesList.find(c => c.id === clienteId);
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
    };

    if (tipoVenta === 'consignacion') {
      datos.fechaEntrega = val('fechaEntregaConsig') || null;
    }

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

    showToast(App.modoEdicion ? 'Pedido actualizado ✓' : 'Pedido guardado ✓', 'success');
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
// MARCAR COMO ENTREGADO
// ============================================================
window.marcarEntregado = async function (id) {
  const hoy = new Date().toISOString().split('T')[0];
  const result = await Pedidos.actualizar(id, {
    estado: 'entregado',
    fechaEntregadoReal: hoy,
  });
  if (result.success) {
    showToast('Marcado como entregado ✓', 'success');
  } else {
    showToast('Error: ' + result.error, 'error');
  }
};

// ============================================================
// CAMBIAR ESTADO
// ============================================================
window.cambiarEstado = async function (id, estado) {
  const result = await Pedidos.cambiarEstado(id, estado);
  if (!result.success) showToast('Error: ' + result.error, 'error');
};

// ============================================================
// ELIMINAR PEDIDO
// ============================================================
window.eliminarPedido = async function (id) {
  if (!confirm('¿Eliminar este pedido?')) return;
  const result = await Pedidos.eliminar(id);
  if (result.success) {
    showToast('Pedido eliminado', 'success');
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
    actualizarDashboard();
  });

  App.unsubscribeClientes = Clientes.escuchar((clientes) => {
    App.clientesList = clientes;
    renderClientes();
    poblarSelectClientes();
    const el = document.getElementById('stat-total-clientes');
    if (el) el.textContent = clientes.length;
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
    const total = (p.total || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
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

    const esPendiente = p.estado === 'pendiente';

    return `
      <div class="pedido-card" data-id="${p.id}">
        <div class="pedido-header">
          <div>
            <div class="pedido-escuela">${p.clienteNombre || p.clienteEscuela || '—'}${factBadge}</div>
            <div class="pedido-meta">${productosStr}</div>
          </div>
          <span class="badge ${estadoClass}">${p.estado}</span>
        </div>
        <div class="pedido-footer" style="padding:0.5rem 1rem;display:flex;justify-content:space-between;font-size:0.82rem;">
          <span style="font-weight:700;color:var(--accent2);">${total}</span>
          <span style="color:var(--text-muted);">${fecha}</span>
        </div>
        <div class="pedido-actions">
          <button class="btn btn-outline btn-sm" onclick="editarPedido('${p.id}')">✏️ Editar</button>
          ${esPendiente ? `<button class="btn btn-success btn-sm" onclick="marcarEntregado('${p.id}')">📦 Entregado</button>` : ''}
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
    </div>
  `).join('');
}

// ============================================================
// DASHBOARD
// ============================================================
function actualizarDashboard() {
  const pedidos = App.pedidosList;

  const totalVendido = pedidos.reduce((s, p) => s + (p.total || 0), 0);
  const cobrado = pedidos.filter(p => p.estado === 'pagado').reduce((s, p) => s + (p.total || 0), 0);
  const pendiente = pedidos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + (p.total || 0), 0);
  const consignacion = pedidos.filter(p => p.tipoVenta === 'consignacion').reduce((s, p) => s + (p.total || 0), 0);

  const fmt = (v) => v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

  setText('stat-total-vendido', fmt(totalVendido));
  setText('stat-cobrado', fmt(cobrado));
  setText('stat-pendiente', fmt(pendiente));
  setText('stat-consignacion', fmt(consignacion));
  setText('stat-pedidos', pedidos.length);

  const conteo = {};
  pedidos.forEach(p => {
    if (Array.isArray(p.productos)) {
      p.productos.forEach(pr => { conteo[pr.producto] = (conteo[pr.producto] || 0) + (pr.cantidad || 0); });
    }
  });
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
  setText('stat-top-producto', top ? top[0] : '—');

  renderSeguimiento(pedidos);
}

function renderSeguimiento(pedidos) {
  const container = document.getElementById('seguimiento-container');
  if (!container) return;

  const alertas = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'parcial');
  if (alertas.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;">✅ Todo al día</div>`;
    return;
  }

  container.innerHTML = alertas.slice(0, 5).map(p => `
    <div class="seguimiento-item" onclick="editarPedido('${p.id}')">
      <span>${p.estado === 'pendiente' ? '⏳' : '🔄'}</span>
      <div>
        <div style="font-size:0.85rem;font-weight:600;">${p.clienteNombre || p.clienteEscuela || '—'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${p.estado}</div>
      </div>
    </div>
  `).join('');
}

// ============================================================
// REPORTE LOGÍSTICA — WhatsApp e Impresión
// ============================================================

// Obtiene pedidos pendientes ordenados por ruta óptima
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
  const rutaOptima = App.ubicacionBodega ? ' — Ruta optimizada 🗺️' : '';

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
      .ruta-badge { background: #e8f5e9; color: #2e7d32; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; display: inline-block; margin-bottom: 12px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>🚚 Ruta Jicmar</h1>
    <div class="subtitulo">${hoy} — ${pendientes.length} parada(s)</div>
    ${App.ubicacionBodega ? '<div class="ruta-badge">🗺️ Ruta optimizada por distancia</div>' : ''}
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

  document.querySelectorAll('input[name="tipoVenta"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const sec = document.getElementById('consignacion-section');
      if (sec) sec.style.display = radio.value === 'consignacion' ? 'block' : 'none';
    });
  });
  const consigSec = document.getElementById('consignacion-section');
  if (consigSec) consigSec.style.display = 'none';

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

  document.querySelectorAll('.reporte-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.reporte-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  document.getElementById('btn-compartir-whatsapp')?.addEventListener('click', compartirWhatsApp);
  document.getElementById('btn-imprimir-ruta')?.addEventListener('click', imprimirRuta);
  document.getElementById('btn-generar-pdf')?.addEventListener('click', generarPDF);

  renderProductosEnPedido();

  const fechaEl = document.getElementById('fecha-pedido');
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().split('T')[0];
}

// ============================================================
// GENERAR PDF (reportes)
// ============================================================
async function generarPDF() {
  const tipoCard = document.querySelector('.reporte-card.selected');
  const tipo = tipoCard?.dataset.tipo || 'ventas';
  const inicio = document.getElementById('fecha-inicio')?.value;
  const fin = document.getElementById('fecha-fin')?.value;

  if (!inicio || !fin) {
    showToast('Selecciona rango de fechas', 'error');
    return;
  }

  showToast('Generando reporte...', 'success');

  const pedidos = await Pedidos.obtenerPorFecha(inicio, fin);
  const hoy = new Date().toLocaleDateString('es-MX');

  let html = `<html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;font-size:13px;padding:20px;}
    h1{font-size:18px;} table{width:100%;border-collapse:collapse;margin-top:12px;}
    th{background:#f0f0f0;padding:6px;text-align:left;font-size:12px;}
    td{padding:6px;border-top:1px solid #eee;font-size:12px;}
    .total{font-weight:bold;}
  </style></head><body>
  <h1>Reporte Jicmar — ${tipo}</h1>
  <p>Período: ${inicio} al ${fin} · Generado: ${hoy}</p>
  <table><tr><th>Cliente</th><th>Productos</th><th>Tipo</th><th>Estado</th><th>Total</th></tr>`;

  let gran_total = 0;
  pedidos.forEach(p => {
    const total = p.total || 0;
    gran_total += total;
    const productosStr = Array.isArray(p.productos) ? p.productos.map(pr => `${pr.producto}×${pr.cantidad}`).join(', ') : '';
    html += `<tr>
      <td>${p.clienteNombre || '—'}</td>
      <td>${productosStr}</td>
      <td>${p.tipoVenta || '—'}</td>
      <td>${p.estado || '—'}</td>
      <td>$${total.toLocaleString('es-MX')}</td>
    </tr>`;
  });

  html += `<tr><td colspan="4" class="total">TOTAL</td><td class="total">$${gran_total.toLocaleString('es-MX')}</td></tr>`;
  html += `</table></body></html>`;

  const v = window.open('', '_blank');
  v.document.write(html);
  v.document.close();
  v.focus();
  setTimeout(() => v.print(), 500);
}

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

window.showToast = showToast;
