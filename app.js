// ============================================================
// app.js — Jicmar CRM (ACTUALIZADO)
// ============================================================

import { Auth, Pedidos, Clientes, Storage } from './firebase.js';

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
  productosEnPedido: [],   // array de {producto, cantidad, precioUnitario}
};

window.App = App;

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

  // Validar cliente
  const clienteId = document.getElementById('pedido-cliente-id')?.value;
  if (!clienteId) {
    showToast('Selecciona un cliente', 'error');
    return;
  }

  // Validar productos
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
            <option value="entrega
