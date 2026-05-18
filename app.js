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
  filtrosDashboard: {
    totalVendido: 'todo',
    cobrado: 'todo',
    pendiente: 'todo',
    consignacion: 'todo',
    pedidos: 'todo',
    topProducto: 'todo'
  }
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
// Guardar fotos INE si el usuario eligió alguna
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

// Variable para guardar el id del pedido que se está procesando
let pedidoEnModal = null;

window.abrirModalEntrega = function (id) {
  const pedido = App.pedidosList.find(p => p.id === id);
  if (!pedido) return;

  pedidoEnModal = id;

  // Badge tipo de venta
  const badge = document.getElementById('modal-entrega-tipo-badge');
  const esConsig = pedido.tipoVenta === 'consignacion';
  badge.innerHTML = esConsig
    ? `<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;">📦 CONSIGNACIÓN</span>`
    : `<span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:4px 12px;border-radius:20px;font-size:0.8rem;font-weight:600;">💵 VENTA DIRECTA</span>`;

  // Mostrar/ocultar secciones según tipo
  document.getElementById('modal-seccion-cobro').style.display = esConsig ? 'none' : 'block';
  document.getElementById('modal-seccion-consig').style.display = esConsig ? 'block' : 'none';

  // Limpiar campos
  const montoInput = document.getElementById('modal-monto-cobrado');
  if (montoInput) montoInput.value = '';
  const notasInput = document.getElementById('modal-notas-entrega');
  if (notasInput) notasInput.value = '';
  const diffInfo = document.getElementById('modal-diferencia-info');
  if (diffInfo) { diffInfo.style.display = 'none'; diffInfo.textContent = ''; }

  // Renderizar productos editables
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

  // Calcular total inicial
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

  // Actualizar total visible
  const totalEl = document.getElementById('modal-total-calculado');
  if (totalEl) totalEl.textContent = totalEntregado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  // Solo mostrar diferencia si es venta directa
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

  // Recoger cantidades entregadas reales
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
      // Consignación: marcar entregado, cobro pendiente
      datos.estado = 'entregado';
      datos.montoCobrado = 0;
      datos.deuda = totalEntregado;
    } else {
      // Venta directa
      const montoCobrado = parseFloat(document.getElementById('modal-monto-cobrado')?.value) || 0;
      const diff = montoCobrado - totalEntregado;
      datos.montoCobrado = montoCobrado;
      datos.deuda = diff < -0.01 ? Math.abs(diff) : 0;
      datos.estado = datos.deuda > 0 ? 'parcial' : 'pagado';
      datos.totalEntregado = totalEntregado;
    }

    const result = await Pedidos.actualizar(pedidoEnModal, datos);
    if (!result.success) throw new Error(result.error);

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

  // Calcular saldo pendiente
  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;
const montoDevuelto = pedido.montoDevuelto || 0;
const saldoPendiente = (totalEntregado - montoDevuelto) - yaCobrado;

  // Mostrar resumen
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

  // Limpiar campos
  const montoInput = document.getElementById('modal-cobro-monto');
  if (montoInput) montoInput.value = '';
  // Mostrar campo devoluciones solo si hay un solo tipo de producto con vida de anaquel
  const devInput = document.getElementById('modal-cobro-devueltas');
  if (devInput) devInput.value = '';
  const devInfo = document.getElementById('modal-cobro-devueltas-info');
  if (devInfo) devInfo.textContent = '';
  const secDev = document.getElementById('seccion-devoluciones');
  if (secDev) secDev.style.display = 'block'; // siempre visible en consignas
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

  // Calcular descuento por devoluciones
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

  // Mostrar info de devolución
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

  // NUEVO: bloquear si ya está liquidada
  const modoEdicionCheck = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
  if (pedido.estado === 'pagado' && !modoEdicionCheck) {
    showToast('Esta consigna ya está liquidada. Usa "Editar cobro" para corregir.', 'error');
    return;
  }

  const montoPagando = parseFloat(document.getElementById('modal-cobro-monto')?.value) || 0;

  // ── BUG 4 FIX ──
  // Calcular si la devolución cubre el total antes de validar monto 0
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

  // Solo bloquear monto 0 si NO hay devolución total que lo justifique
  if (montoPagando <= 0 && !esDevolucionTotal) {
    showToast('Ingresa un monto mayor a cero', 'error');
    return;
  }

  const notas = document.getElementById('modal-cobro-notas')?.value?.trim() || '';
  const totalEntregado = pedido.totalEntregado || pedido.total || 0;
  const yaCobrado = pedido.montoCobrado || 0;
  const modoEdicion = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
  // En edición: el monto reemplaza. En cobro normal: se suma.
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
  };

  try {
    const result = await Pedidos.actualizar(pedidoEnModal, datos);
    if (!result.success) throw new Error(result.error);

    // Guardar pago en historial (solo en modo cobro normal, no edición)
    const modoEdicionActual = document.getElementById('modal-cobro').dataset.modoEdicion === 'true';
    if (!modoEdicionActual && montoPagando > 0) {
      await Pedidos.registrarPago(pedidoEnModal, {
        monto: montoPagando,
        unidadesDevueltas,
        montoDevuelto,
        notas,
      });
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

    // Badge tipo de venta
    const esConsig = p.tipoVenta === 'consignacion';
    const tipoBadge = esConsig
      ? `<span class="badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;margin-left:0.3rem;">📦 Consig.</span>`
      : `<span class="badge" style="background:rgba(34,197,94,0.15);color:#4ade80;margin-left:0.3rem;">💵 Directa</span>`;

    // Deuda pendiente si hay
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

  // Filtrar solo consignaciones entregadas
  let lista = App.pedidosList.filter(p => p.tipoVenta === 'consignacion' && p.estado !== 'pendiente' && p.estado !== 'cancelado');

  // Aplicar filtro de pestaña
  if (filtroConsignas === 'activas') {
    lista = lista.filter(p => p.estado === 'entregado');
  } else if (filtroConsignas === 'parcial') {
    lista = lista.filter(p => p.estado === 'parcial');
  } else if (filtroConsignas === 'liquidadas') {
    lista = lista.filter(p => p.estado === 'pagado');
  }

  // Búsqueda
  const q = document.getElementById('buscar-consignas')?.value?.toLowerCase() || '';
  if (q) {
    lista = lista.filter(p => p.clienteNombre?.toLowerCase().includes(q));
  }

  // Badge contador — mostrar activas + parciales
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

    // Calcular días entre pedido y entrega
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

    // Productos entregados reales
    const productosEntregados = Array.isArray(p.productosEntregados) ? p.productosEntregados : (Array.isArray(p.productos) ? p.productos : []);
    const productosStr = productosEntregados.map(pr => {
      const cant = pr.cantidadEntregada ?? pr.cantidad;
      return `${pr.producto} ×${cant}`;
    }).join(', ');
<div class="pedido-actions">
          ${puedecobrar ? `<button class="btn btn-primary btn-sm" onclick="abrirModalCobro('${p.id}')">💰 Cobrar</button>` : ''}
          ${puedeeditar ? `<button class="btn btn-outline btn-sm" onclick="editarCobro('${p.id}')">✏️ Editar cobro</button>` : ''}
          ${tieneHistorial ? `<button class="btn btn-outline btn-sm" onclick="verHistorialCobros('${p.id}')">📋 Historial</button>` : ''}
        </div>

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
  document.getElementById('btn-compartir-whatsapp')?.addEventListener('click', compartirWhatsApp);
  document.getElementById('btn-imprimir-ruta')?.addEventListener('click', imprimirRuta);
  document.getElementById('btn-generar-pdf')?.addEventListener('click', generarPDF);
  
// Selectores de período en dashboard
document.querySelectorAll('.stat-periodo').forEach(select => {
  select.addEventListener('change', (e) => {
    const stat = e.target.dataset.stat;
    App.filtrosDashboard[stat] = e.target.value;
    actualizarDashboard();
  });
});

  renderProductosEnPedido();

  const fechaEl = document.getElementById('fecha-pedido');
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().split('T')[0];
}

// ============================================================
// GENERAR PDF — Selección múltiple + diseño profesional
// ============================================================
async function generarPDF() {
  const seleccionadas = [...document.querySelectorAll('.reporte-card.selected')]
    .map(c => c.dataset.tipo);

  if (seleccionadas.length === 0) {
    showToast('Selecciona al menos un tipo de reporte', 'error');
    return;
  }

  const inicio = document.getElementById('fecha-inicio')?.value;
  const fin = document.getElementById('fecha-fin')?.value;
  if (!inicio || !fin) {
    showToast('Selecciona rango de fechas', 'error');
    return;
  }

  showToast('Generando reporte...', 'success');
  const pedidos = await Pedidos.obtenerPorFecha(inicio, fin);
  const hoy = new Date().toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
  const inicioFmt = new Date(inicio + 'T12:00:00').toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });
  const finFmt = new Date(fin + 'T12:00:00').toLocaleDateString('es-MX', { year:'numeric', month:'long', day:'numeric' });

  let seccionesHTML = '';
  for (const tipo of seleccionadas) {
    if (tipo === 'ventas')   seccionesHTML += generarSeccionVentas(pedidos);
    if (tipo === 'clientes') seccionesHTML += generarSeccionClientes(pedidos);
    if (tipo === 'consig')   seccionesHTML += generarSeccionConsignas(pedidos);
    if (tipo === 'perdidos') seccionesHTML += generarSeccionInactivos();
  }

  const html = `
  <html><head><meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; padding: 24px; }

    /* ENCABEZADO */
    .pdf-header { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 3px solid #d4a017; padding-bottom: 14px; margin-bottom: 20px; }
    .pdf-logo-area { display: flex; align-items: center; gap: 12px; }
    .pdf-logo-text { font-size: 26px; font-weight: 900; color: #1a1a1a; letter-spacing: -1px; }
    .pdf-logo-sub { font-size: 10px; color: #888; margin-top: 2px; }
    .pdf-header-right { text-align: right; }
    .pdf-header-right .periodo { font-size: 11px; color: #555; margin-top: 4px; }
    .pdf-header-right .generado { font-size: 10px; color: #aaa; margin-top: 2px; }

    /* SECCIONES */
    .seccion { margin-bottom: 32px; page-break-inside: avoid; }
    .seccion-titulo { font-size: 15px; font-weight: 700; color: #fff;
      background: #1a1a1a; padding: 8px 14px; border-radius: 6px 6px 0 0;
      display: flex; align-items: center; gap: 8px; }
    .seccion-subtitulo { font-size: 11px; color: #555; background: #f5f5f5;
      padding: 5px 14px; border-left: 3px solid #d4a017; margin-bottom: 10px; }

    /* RESUMEN BADGES */
    .resumen-badges { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .badge-stat { padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .badge-verde { background: #e8f5e9; color: #2e7d32; }
    .badge-azul  { background: #e3f2fd; color: #1565c0; }
    .badge-naranja { background: #fff8e1; color: #e65100; }

    /* TABLAS */
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    thead tr { background: #f0f0f0; }
    th { padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 700;
      color: #333; border-bottom: 2px solid #ddd; }
    td { padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    tr:hover td { background: #f5f5f5; }
    .col-num { text-align: right; }
    .col-center { text-align: center; }

    /* FILA TOTALES */
    .fila-total td { background: #1a1a1a !important; color: #fff !important;
      font-weight: 700; font-size: 12px; padding: 8px 10px; }

    /* BLOQUE POR CLIENTE */
    .cliente-bloque { border: 1px solid #e0e0e0; border-radius: 8px;
      margin-bottom: 14px; overflow: hidden; }
    .cliente-bloque-header { background: #f8f8f8; padding: 8px 14px;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #e0e0e0; }
    .cliente-nombre { font-weight: 700; font-size: 13px; color: #1a1a1a; }
    .cliente-total-badge { background: #d4a017; color: #fff; padding: 3px 10px;
      border-radius: 12px; font-size: 11px; font-weight: 700; }

    /* PIE DE PÁGINA */
    .pdf-footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #eee;
      text-align: center; font-size: 10px; color: #aaa; }

    @media print {
      body { padding: 12px; }
      .seccion { page-break-inside: avoid; }
    }
  </style></head><body>

  <!-- ENCABEZADO -->
  <div class="pdf-header">
    <div class="pdf-logo-area">
      <img src="./icon-192.png" style="width:52px;height:52px;border-radius:10px;object-fit:contain;" onerror="this.style.display='none'" />
      <div>
        <div class="pdf-logo-text">JICMAR</div>
        <div class="pdf-logo-sub">Sistema de gestión de ventas</div>
      </div>
    </div>
    <div class="pdf-header-right">
      <div style="font-size:13px;font-weight:700;">Reporte de ventas</div>
      <div class="periodo">📅 ${inicioFmt} — ${finFmt}</div>
      <div class="generado">Generado el ${hoy}</div>
    </div>
  </div>

  ${seccionesHTML}

  <div class="pdf-footer">
    Jicmar CRM · Reporte generado automáticamente · ${hoy}
  </div>
  </body></html>`;

  const v = window.open('', '_blank');
  v.document.write(html);
  v.document.close();
  v.focus();
  setTimeout(() => v.print(), 600);
}

// ── Sección: VENTAS — lógica corregida ──
function generarSeccionVentas(pedidos) {

  const fmt = v => v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const vendidos = pedidos.filter(p =>
    ['pagado', 'parcial'].includes(p.estado)
  );

  const consignasActivas = pedidos.filter(p =>
    p.tipoVenta === 'consignacion' && p.estado === 'entregado'
  );

  const mapa = {};

  vendidos.forEach(p => {
    const prods = p.productosEntregados || p.productos || [];
    prods.forEach(pr => {
      if (!pr.producto) return;
      if (!mapa[pr.producto]) {
        mapa[pr.producto] = {
          ventaDirecta: 0,
          consigLiquidada: 0,
          devuelto: 0,
          precio: 0,
          total: 0
        };
      }
      const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
      const precio = pr.precioUnitario ?? 0;

      if (p.tipoVenta === 'consignacion') {
        mapa[pr.producto].consigLiquidada += cant;
        const devUnidades = p.unidadesDevueltas || 0;
        mapa[pr.producto].devuelto += devUnidades;
      } else {
        mapa[pr.producto].ventaDirecta += cant;
      }

      mapa[pr.producto].precio = precio;
      mapa[pr.producto].total += cant * precio;
    });
  });

  Object.values(mapa).forEach(v => {
    if (v.devuelto > 0) {
      v.total -= v.devuelto * v.precio;
    }
  });

  const filas = Object.entries(mapa)
    .sort((a, b) => (b[1].ventaDirecta + b[1].consigLiquidada) - (a[1].ventaDirecta + a[1].consigLiquidada));

  const totalDirecta     = filas.reduce((s, [, v]) => s + v.ventaDirecta, 0);
  const totalConsigLiq   = filas.reduce((s, [, v]) => s + v.consigLiquidada, 0);
  const totalDevuelto    = filas.reduce((s, [, v]) => s + v.devuelto, 0);
  const totalVendido     = totalDirecta + totalConsigLiq - totalDevuelto;
  const totalImporte     = filas.reduce((s, [, v]) => s + v.total, 0);

  const cobrado = pedidos
    .filter(p => p.estado === 'pagado')
    .reduce((s, p) => s + (p.montoCobrado || p.totalEntregado || p.total || 0), 0);

  const parcialCobrado = pedidos
    .filter(p => p.estado === 'parcial')
    .reduce((s, p) => s + (p.montoCobrado || 0), 0);

  const totalCobrado = cobrado + parcialCobrado;

  const totalEnCalle = consignasActivas.reduce((s, p) => {
    const entregado = p.totalEntregado || p.total || 0;
    const yaCobrado = p.montoCobrado || 0;
    return s + (entregado - yaCobrado);
  }, 0);

  let html = `
  <div class="seccion">
    <div class="seccion-titulo">📊 Ventas por producto</div>
    <div class="seccion-subtitulo">
      Venta directa + consignaciones liquidadas · ${vendidos.length} pedido(s) cerrado(s) en el período
    </div>
    <div class="resumen-badges">
      <span class="badge-stat badge-verde">✅ Total cobrado: ${fmt(totalCobrado)}</span>
      <span class="badge-stat badge-azul">🔄 Parcial cobrado: ${fmt(parcialCobrado)}</span>
      <span class="badge-stat badge-naranja">💰 Total facturado: ${fmt(totalImporte)}</span>
    </div>`;

  if (filas.length === 0) {
    html += `<p style="padding:14px;color:#888;">Sin ventas cerradas en este período.</p>`;
  } else {
    html += `
    <table>
      <thead><tr>
        <th>#</th>
        <th>Producto</th>
        <th class="col-num">V. Directa</th>
        <th class="col-num">Consig. Liquidada</th>
        <th class="col-num">Devuelto</th>
        <th class="col-num">Total Vendido</th>
        <th class="col-num">P. Unit.</th>
        <th class="col-num">Importe</th>
      </tr></thead>
      <tbody>`;

    filas.forEach(([nombre, v], i) => {
      const totalPiezas = v.ventaDirecta + v.consigLiquidada - v.devuelto;
      html += `<tr>
        <td class="col-center">${i + 1}</td>
        <td>${nombre}</td>
        <td class="col-num">${v.ventaDirecta}</td>
        <td class="col-num">${v.consigLiquidada}</td>
        <td class="col-num" style="color:${v.devuelto > 0 ? '#e65100' : '#aaa'};">
          ${v.devuelto > 0 ? v.devuelto : '—'}
        </td>
        <td class="col-num"><strong>${totalPiezas}</strong></td>
        <td class="col-num">${fmt(v.precio)}</td>
        <td class="col-num"><strong>${fmt(v.total)}</strong></td>
      </tr>`;
    });

    html += `</tbody>
      <tfoot><tr class="fila-total">
        <td colspan="2">TOTALES</td>
        <td class="col-num">${totalDirecta}</td>
        <td class="col-num">${totalConsigLiq}</td>
        <td class="col-num">${totalDevuelto}</td>
        <td class="col-num">${totalVendido}</td>
        <td></td>
        <td class="col-num">${fmt(totalImporte)}</td>
      </tr></tfoot>
    </table>`;
  }

  html += `
    <div style="margin-top: 20px; border: 1px solid #e3f2fd; border-radius: 8px; overflow: hidden;">
      <div style="background: #1565c0; color: #fff; padding: 8px 14px; font-size: 13px; font-weight: 700;">
        📦 En consigna activa — stock en calle (no suma a ventas)
      </div>`;

  if (consignasActivas.length === 0) {
    html += `<p style="padding:12px 14px;color:#888;font-size:11px;">Sin consignas activas en este período.</p>`;
  } else {
    html += `
      <table>
        <thead><tr>
          <th>Cliente</th>
          <th>Productos</th>
          <th class="col-num">Entregado</th>
          <th class="col-num">Ya cobrado</th>
          <th class="col-num">Pendiente</th>
        </tr></thead>
        <tbody>`;

    consignasActivas.forEach(p => {
      const entregado = p.totalEntregado || p.total || 0;
      const yaCobrado = p.montoCobrado || 0;
      const pendiente = entregado - yaCobrado;
      const prods = (p.productosEntregados || p.productos || [])
        .map(pr => `${pr.producto} ×${pr.cantidadEntregada ?? pr.cantidad}`).join(', ');

      html += `<tr>
        <td><strong>${p.clienteNombre || '—'}</strong></td>
        <td style="font-size:10px;color:#555;">${prods}</td>
        <td class="col-num">${fmt(entregado)}</td>
        <td class="col-num" style="color:#2e7d32;">${fmt(yaCobrado)}</td>
        <td class="col-num" style="color:#e65100;font-weight:700;">${fmt(pendiente)}</td>
      </tr>`;
    });

    html += `</tbody>
      <tfoot><tr class="fila-total">
        <td colspan="2">TOTAL EN CALLE</td>
        <td class="col-num">${fmt(totalEnCalle + consignasActivas.reduce((s,p) => s + (p.montoCobrado||0), 0))}</td>
        <td class="col-num">${fmt(consignasActivas.reduce((s,p) => s + (p.montoCobrado||0), 0))}</td>
        <td class="col-num">${fmt(totalEnCalle)}</td>
      </tr></tfoot>
    </table>`;
  }

  html += `</div></div>`;
  return html;
}

// ── Sección: CLIENTES ──
function generarSeccionClientes(pedidos) {
  const relevantes = pedidos.filter(p =>
    ['pagado','parcial','entregado'].includes(p.estado)
  );

  const mapaClientes = {};
  relevantes.forEach(p => {
    const id = p.clienteId || p.clienteNombre || 'desconocido';
    if (!mapaClientes[id]) {
      mapaClientes[id] = { nombre: p.clienteNombre || '—', productos: {}, total: 0 };
    }
    const prods = p.productosEntregados || p.productos || [];
    prods.forEach(pr => {
      if (!pr.producto) return;
      if (!mapaClientes[id].productos[pr.producto]) {
        mapaClientes[id].productos[pr.producto] = { vendido: 0, precio: 0, total: 0 };
      }
      const cant = pr.cantidadEntregada ?? pr.cantidad ?? 0;
      mapaClientes[id].productos[pr.producto].vendido += cant;
      mapaClientes[id].productos[pr.producto].precio   = pr.precioUnitario ?? 0;
      mapaClientes[id].productos[pr.producto].total   += cant * (pr.precioUnitario ?? 0);
      mapaClientes[id].total += cant * (pr.precioUnitario ?? 0);
    });
  });

  const clientesOrdenados = Object.values(mapaClientes)
    .sort((a,b) => b.total - a.total);

  if (clientesOrdenados.length === 0) return `<div class="seccion"><div class="seccion-titulo">👤 Compras por cliente</div><p style="padding:14px;color:#888;">Sin datos en este período.</p></div>`;

  const fmt = v => v.toLocaleString('es-MX', { style:'currency', currency:'MXN' });
  const granTotal = clientesOrdenados.reduce((s,c) => s + c.total, 0);

  let html = `
  <div class="seccion">
    <div class="seccion-titulo">👤 Compras por cliente</div>
    <div class="seccion-subtitulo">Ordenado del cliente que más compró al que menos · Gran total: ${fmt(granTotal)}</div>`;

  clientesOrdenados.forEach((cliente, idx) => {
    const prodOrdenados = Object.entries(cliente.productos)
      .sort((a,b) => b[1].vendido - a[1].vendido);

    html += `
    <div class="cliente-bloque">
      <div class="cliente-bloque-header">
        <div>
          <span style="color:#888;font-size:10px;margin-right:6px;">#${idx+1}</span>
          <span class="cliente-nombre">${cliente.nombre}</span>
        </div>
        <span class="cliente-total-badge">${fmt(cliente.total)}</span>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Producto</th>
          <th class="col-num">Cantidad</th>
          <th class="col-num">P. Unit.</th>
          <th class="col-num">Total</th>
        </tr></thead>
        <tbody>`;

    prodOrdenados.forEach(([nombre, v], i) => {
      html += `<tr>
        <td class="col-center">${i+1}</td>
        <td>${nombre}</td>
        <td class="col-num">${v.vendido}</td>
        <td class="col-num">${fmt(v.precio)}</td>
        <td class="col-num"><strong>${fmt(v.total)}</strong></td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  html += `</div>`;
  return html;
}

// ── Sección: CONSIGNACIONES EN CALLE ──
function generarSeccionConsignas(pedidos) {
  const enCalle = pedidos.filter(p =>
    p.tipoVenta === 'consignacion' && ['entregado','parcial'].includes(p.estado)
  );

  const fmt = v => v.toLocaleString('es-MX', { style:'currency', currency:'MXN' });

  if (enCalle.length === 0) return `<div class="seccion"><div class="seccion-titulo">📦 Consignaciones en calle</div><p style="padding:14px;color:#888;">Sin consignaciones activas en este período.</p></div>`;

  const totalEnCalle = enCalle.reduce((s,p) => s + (p.totalEntregado || p.total || 0), 0);
  const totalCobrado = enCalle.reduce((s,p) => s + (p.montoCobrado || 0), 0);
  const totalPendiente = totalEnCalle - totalCobrado;

  let html = `
  <div class="seccion">
    <div class="seccion-titulo">📦 Consignaciones en calle</div>
    <div class="seccion-subtitulo">Producto entregado aún no cobrado totalmente</div>
    <div class="resumen-badges">
      <span class="badge-stat badge-azul">📦 Total entregado: ${fmt(totalEnCalle)}</span>
      <span class="badge-stat badge-verde">✅ Ya cobrado: ${fmt(totalCobrado)}</span>
      <span class="badge-stat badge-naranja">🔴 Pendiente por cobrar: ${fmt(totalPendiente)}</span>
    </div>
    <table>
      <thead><tr>
        <th>Cliente</th><th>Productos</th>
        <th class="col-num">Entregado</th>
        <th class="col-num">Cobrado</th>
        <th class="col-num">Pendiente</th>
        <th>Estado</th>
      </tr></thead><tbody>`;

  enCalle.forEach(p => {
    const entregado  = p.totalEntregado || p.total || 0;
    const cobrado    = p.montoCobrado || 0;
    const pendiente  = entregado - cobrado;
    const prods = (p.productosEntregados || p.productos || [])
      .map(pr => `${pr.producto} ×${pr.cantidadEntregada ?? pr.cantidad}`).join(', ');
    html += `<tr>
      <td><strong>${p.clienteNombre || '—'}</strong></td>
      <td style="font-size:10px;color:#555;">${prods}</td>
      <td class="col-num">${fmt(entregado)}</td>
      <td class="col-num" style="color:#2e7d32;">${fmt(cobrado)}</td>
      <td class="col-num" style="color:${pendiente > 0 ? '#e65100' : '#2e7d32'};font-weight:700;">${fmt(pendiente)}</td>
      <td class="col-center"><span style="background:${p.estado==='parcial'?'#fff8e1':'#e3f2fd'};color:${p.estado==='parcial'?'#e65100':'#1565c0'};padding:2px 8px;border-radius:10px;font-size:10px;">${p.estado}</span></td>
    </tr>`;
  });

  html += `</tbody>
    <tfoot><tr class="fila-total">
      <td colspan="2">TOTALES</td>
      <td class="col-num">${fmt(totalEnCalle)}</td>
      <td class="col-num">${fmt(totalCobrado)}</td>
      <td class="col-num">${fmt(totalPendiente)}</td>
      <td></td>
    </tr></tfoot>
    </table>
  </div>`;
  return html;
}

// ── Sección: INACTIVOS ──
function generarSeccionInactivos() {
  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 30);

  const clientesActivos = new Set(
    App.pedidosList
      .filter(p => p.createdAt instanceof Date && p.createdAt > hace30)
      .map(p => p.clienteId)
  );

  const inactivos = App.clientesList.filter(c => !clientesActivos.has(c.id));

  if (inactivos.length === 0) return `<div class="seccion"><div class="seccion-titulo">😴 Clientes inactivos</div><p style="padding:14px;color:#888;">Todos los clientes tuvieron actividad en los últimos 30 días. ¡Excelente!</p></div>`;

  let html = `
  <div class="seccion">
    <div class="seccion-titulo">😴 Clientes sin actividad en +30 días</div>
    <div class="seccion-subtitulo">${inactivos.length} cliente(s) sin pedidos recientes</div>
    <table>
      <thead><tr><th>#</th><th>Cliente</th><th>Teléfono</th><th>Dirección</th></tr></thead>
      <tbody>`;

  inactivos.forEach((c, i) => {
    html += `<tr>
      <td class="col-center">${i+1}</td>
      <td>${c.nombre || c.escuela || '—'}</td>
      <td>${c.telefono || '—'}</td>
      <td style="font-size:10px;color:#888;">${c.direccion || '—'}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  return html;
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

// ============================================================
// TOGGLE SELECCIÓN MÚLTIPLE DE REPORTES
// ============================================================
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
        // Bug 3 fix: usar setConMerge para crear el doc si no existe en Firebase
        const r = await Pedidos.setConMerge(id, resto).catch(() => null);
        if (r?.success) okPedidos++;
      }
      for (const c of datos.clientes) {
        const { id, ...resto } = c;
        // Bug 3 fix: usar setConMerge para crear el doc si no existe en Firebase
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
    html += `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.75rem;">
      ${pagos.length} pago(s) registrado(s)
    </div>`;

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
              <span style="font-weight:700;color:#4ade80;font-size:0.92rem;">
                +${(pago.monto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})}
              </span>
              <span style="font-size:0.7rem;color:var(--text-muted);">${pago.fechaTexto || '—'} · ${pago.hora || ''}</span>
            </div>
            ${tieneDevolucion ? `
            <div style="font-size:0.75rem;color:#f59e0b;margin-bottom:0.25rem;">
              ↩️ ${pago.unidadesDevueltas} piezas devueltas (${(pago.montoDevuelto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})})
            </div>` : ''}
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
document.getElementById('btn-exportar-json')?.addEventListener('click', exportarJSON);
document.getElementById('input-importar-json')?.addEventListener('change', importarJSON); 
