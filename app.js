// ============================================================
// app.js — CRM Ventas Pro (CORREGIDO)
// ============================================================

import { Auth, Pedidos, Clientes, Storage } from './firebase.js';

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
  fotoURL: null,
  fotoOriginal: null,
  fotoFile: null,
  modoEdicion: null,
};

// Exponer App globalmente para que onclick inline pueda acceder
window.App = App;

// ============================================================
// NAVEGACIÓN — expuesta globalmente para onclick en HTML
// ============================================================
window.navigateTo = function (pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  // Al ir a "nuevo-pedido" desde botón limpio
  if (pageId === 'nuevo-pedido' && !App.modoEdicion) {
    resetFormPedido();
    document.getElementById('form-pedido-title').textContent = '📝 Nuevo Pedido';
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
// FOTO
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
// SUBMIT PEDIDO
// ============================================================
async function handleSubmitPedido(e) {
  e.preventDefault();

  const btn = document.getElementById('btn-submit-pedido');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    // Leer tipoVenta desde el radio button
    const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked')?.value || 'directa';

    const datos = {
      escuela: val('escuela'),
      direccion: val('direccion'),
      contacto: val('contacto'),
      telefono: val('telefono'),
      producto: val('producto'),
      cantidad: num('cantidad'),
      precioUnitario: num('precioUnitario'),
      tipoVenta,
      notas: val('notas'),
      vendedorId: App.usuario?.uid || '',
      vendedorNombre: App.perfil?.nombre || '',
      ubicacion: App.ubicacionCapturada,
    };

    if (tipoVenta === 'consignacion') {
      datos.fechaEntrega = val('fechaEntregaConsig') || null;
    }

    // Solo guardar foto si cambió o es nueva
    if (App.fotoURL && App.fotoURL !== App.fotoOriginal) {
      datos.foto = App.fotoURL;
    }

    let result;
    if (App.modoEdicion) {
      result = await Pedidos.actualizar(App.modoEdicion, datos);
    } else {
      result = await Pedidos.crear(datos);
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
// EDITAR PEDIDO
// ============================================================
window.editarPedido = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  App.modoEdicion = id;
  App.fotoOriginal = pedido.foto || null;
  App.fotoURL = pedido.foto || null;

  window.navigateTo('nuevo-pedido');

  document.getElementById('form-pedido-title').textContent = '✏️ Editar Pedido';

  setTimeout(() => {
    setVal('escuela', pedido.escuela);
    setVal('direccion', pedido.direccion);
    setVal('contacto', pedido.contacto);
    setVal('telefono', pedido.telefono);
    setVal('producto', pedido.producto);
    setVal('cantidad', pedido.cantidad);
    setVal('precioUnitario', pedido.precioUnitario);
    setVal('notas', pedido.notas);

    // Tipo de venta
    const tvInput = document.querySelector(`input[name="tipoVenta"][value="${pedido.tipoVenta || 'directa'}"]`);
    if (tvInput) {
      tvInput.checked = true;
      tvInput.dispatchEvent(new Event('change'));
    }

    // Fecha consignación
    if (pedido.fechaEntregaConsignacion) {
      setVal('fechaEntregaConsig', pedido.fechaEntregaConsignacion);
    }

    // Foto existente
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
// LISTENERS FIRESTORE EN TIEMPO REAL
// ============================================================
function iniciarListeners() {
  // Pedidos
  const filtros = App.filtroActivo !== 'todos' ? { estado: App.filtroActivo } : {};
  if (App.perfil?.rol === 'vendedor') {
    filtros.vendedorId = App.usuario.uid;
  }

  App.unsubscribePedidos = Pedidos.escuchar(filtros, (pedidos) => {
    App.pedidosList = pedidos;
    renderPedidos();
    actualizarDashboard();
  });

  // Clientes
  App.unsubscribeClientes = Clientes.escuchar((clientes) => {
    App.clientesList = clientes;
    renderClientes();
    document.getElementById('stat-total-clientes').textContent = clientes.length;
  });
}

// ============================================================
// RENDER PEDIDOS
// ============================================================
function renderPedidos() {
  const container = document.getElementById('pedidos-container');
  if (!container) return;

  let lista = App.pedidosList;

  // Filtro por estado
  if (App.filtroActivo !== 'todos') {
    lista = lista.filter(p => p.estado === App.filtroActivo);
  }

  // Búsqueda
  if (App.busqueda) {
    const q = App.busqueda.toLowerCase();
    lista = lista.filter(p =>
      p.escuela?.toLowerCase().includes(q) ||
      p.producto?.toLowerCase().includes(q) ||
      p.contacto?.toLowerCase().includes(q)
    );
  }

  if (lista.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin pedidos</div>`;
    return;
  }

  container.innerHTML = lista.map(p => {
    const fecha = p.createdAt instanceof Date ? p.createdAt.toLocaleDateString('es-MX') : '—';
    const total = (p.cantidad * p.precioUnitario).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const estadoClass = {
      pendiente: 'badge-warn',
      entregado: 'badge-info',
      pagado: 'badge-ok',
      parcial: 'badge-consig',
      cancelado: 'badge-cancel'
    }[p.estado] || '';

    return `
      <div class="pedido-card" data-id="${p.id}">
        <div class="pedido-header">
          <div>
            <div class="pedido-escuela">${p.escuela}</div>
            <div class="pedido-producto">${p.producto} × ${p.cantidad}</div>
          </div>
          <span class="badge ${estadoClass}">${p.estado}</span>
        </div>
        <div class="pedido-footer">
          <span class="pedido-total">${total}</span>
          <span class="pedido-fecha">${fecha}</span>
        </div>
        <div class="pedido-actions">
          <button class="btn btn-outline btn-sm" onclick="editarPedido('${p.id}')">✏️ Editar</button>
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
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">Sin clientes</div>`;
    return;
  }

  container.innerHTML = lista.map(c => `
    <div class="cliente-card">
      <div class="cliente-nombre">${c.nombre || c.escuela || '—'}</div>
      <div class="cliente-info">${c.escuela || ''} · ${c.telefono}</div>
      <div class="cliente-contacto">${c.contacto || ''}</div>
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

  // Top producto
  const conteo = {};
  pedidos.forEach(p => { conteo[p.producto] = (conteo[p.producto] || 0) + (p.cantidad || 0); });
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
  setText('stat-top-producto', top ? top[0] : '—');

  // Seguimiento inteligente
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
        <div style="font-size:0.85rem;font-weight:600;">${p.escuela}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${p.producto} · ${p.estado}</div>
      </div>
    </div>
  `).join('');
}

// ============================================================
// HELPERS
// ============================================================
function val(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function num(id) {
  return parseFloat(document.getElementById(id)?.value) || 0;
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v ?? '';
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

// ============================================================
// RESET FORM
// ============================================================
function resetFormPedido() {
  document.getElementById('form-pedido')?.reset();
  App.fotoURL = null;
  App.fotoOriginal = null;
  App.modoEdicion = null;
  App.ubicacionCapturada = null;
  const preview = document.getElementById('foto-preview');
  if (preview) preview.innerHTML = '';
  const locResult = document.getElementById('location-result');
  if (locResult) locResult.textContent = '';
  document.getElementById('form-pedido-title').textContent = '📝 Nuevo Pedido';
}

// ============================================================
// UI PANTALLAS
// ============================================================
function mostrarLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Mostrar nombre de usuario
  const nombre = App.perfil?.nombre || App.usuario?.email || 'U';
  setText('user-name', nombre);
  setText('user-avatar', nombre.charAt(0).toUpperCase());
}

function limpiarListeners() {
  if (App.unsubscribePedidos) { App.unsubscribePedidos(); App.unsubscribePedidos = null; }
  if (App.unsubscribeClientes) { App.unsubscribeClientes(); App.unsubscribeClientes = null; }
}

// ============================================================
// EVENTOS
// ============================================================
function inicializarEventos() {

  // Login
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
    // Si éxito, onAuthStateChanged maneja el flujo
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await Auth.logout();
  });

  // Submit pedido
  document.getElementById('form-pedido')?.addEventListener('submit', handleSubmitPedido);

  // Foto
  document.getElementById('foto-input')?.addEventListener('change', handleFotoChange);

  // Navegación inferior
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) window.navigateTo(page);
    });
  });

  // Filtros de pedidos
  document.querySelectorAll('.filtro-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      App.filtroActivo = chip.dataset.estado;
      renderPedidos();
    });
  });

  // Búsqueda pedidos
  document.getElementById('buscar-pedidos')?.addEventListener('input', (e) => {
    App.busqueda = e.target.value;
    renderPedidos();
  });

  // Búsqueda clientes
  document.getElementById('buscar-clientes')?.addEventListener('input', () => {
    renderClientes();
  });

  // Toggle consignación
  document.querySelectorAll('input[name="tipoVenta"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const sec = document.getElementById('consignacion-section');
      if (sec) sec.style.display = radio.value === 'consignacion' ? 'block' : 'none';
    });
  });
  // Estado inicial
  const consigSec = document.getElementById('consignacion-section');
  if (consigSec) consigSec.style.display = 'none';

  // Cálculo automático consignación
  ['cantidad', 'precioUnitario'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcularConsignacion);
  });

  // Ubicación GPS
  document.getElementById('btn-ubicacion')?.addEventListener('click', capturarUbicacion);

  // Botón nuevo pedido en dashboard
  document.getElementById('btn-nuevo-pedido')?.addEventListener('click', () => {
    App.modoEdicion = null;
    window.navigateTo('nuevo-pedido');
  });

  // Generar PDF
  document.getElementById('btn-generar-pdf')?.addEventListener('click', generarPDF);

  // Selección tipo de reporte
  document.querySelectorAll('.reporte-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.reporte-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// ============================================================
// CÁLCULO CONSIGNACIÓN
// ============================================================
function calcularConsignacion() {
  const cantidad = num('cantidad');
  const precio = num('precioUnitario');
  const total = cantidad * precio;
  setText('calc-total', total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));
  setText('calc-restante', cantidad);
  setText('calc-vendido', '$0');
}

// ============================================================
// UBICACIÓN GPS
// ==========================================================
