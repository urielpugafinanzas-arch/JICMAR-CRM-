};;();  });

  // Búsqueda pedidos
  document.getElementById('buscar-pedidos')?.addEventListener('input', (e) => {
    App.busqueda = e.target.value;
    renderPedidos();
  });

  // Búsqueda clientes
  document.getElementById('buscar-clientes')?.addEventListener('input', () => renderClientes());

  // Toggle consignación
  document.querySelectorAll('input[name="tipoVenta"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const sec = document.getElementById('consignacion-section');
      if (sec) sec.style.display = radio.value === 'consignacion' ? 'block' : 'none';
    });
  });
  const consigSec = document.getElementById('consignacion-section');
  if (consigSec) consigSec.style.display = 'none';

  // Ubicación cliente
  document.getElementById('btn-ubicacion-cliente')?.addEventListener('click', () => {
    capturarUbicacion('cliente', 'location-result-cliente');
  });

  // Botón nuevo cliente
  document.getElementById('btn-nuevo-cliente')?.addEventListener('click', () => {
    App.modoEdicionCliente = null;
    window.navigateTo('nuevo-cliente');
  });

  // Agregar producto
  document.getElementById('btn-agregar-producto')?.addEventListener('click', agregarProductoVacio);

  // Selector de cliente → aviso factura
  document.getElementById('pedido-cliente-id')?.addEventListener('change', (e) => {
    actualizarAvisoFactura(e.target.value);
  });

  // Reportes
  document.querySelectorAll('.reporte-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.reporte-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  document.getElementById('btn-compartir-whatsapp')?.addEventListener('click', compartirWhatsApp);
  document.getElementById('btn-imprimir-ruta')?.addEventListener('click', imprimirRuta);
  document.getElementById('btn-generar-pdf')?.addEventListener('click', generarPDF);

  // Init productos vacíos
  renderProductosEnPedido();

  // Fecha de hoy por defecto
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
