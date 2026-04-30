// ============================================================
// CAMBIO EN app.js
// Reemplaza la función handleFotoChange que ya existe
// ============================================================
//
// BUSCA esta función en tu app.js:
//
//   async function handleFotoChange(e) { ... }
//
// Y REEMPLÁZALA COMPLETA con esto:
// ============================================================

async function handleFotoChange(e) {
  const archivo = e.target.files[0];
  if (!archivo) return;

  const preview = document.getElementById('foto-preview');
  preview.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem">⏳ Comprimiendo foto...</div>';

  // Comprimir y convertir a base64 (sin Storage, sin costo)
  const resultado = await Storage.comprimirYConvertir(archivo);

  if (!resultado.success) {
    showToast(resultado.error, 'error');
    preview.innerHTML = '';
    return;
  }

  // Guardar base64 en el estado de la app
  App.fotoURL = resultado.base64;
  App.fotoFile = null; // Ya no necesitamos el archivo original

  // Mostrar preview de la foto
  preview.innerHTML = `
    <div style="position:relative;display:inline-block;margin-top:8px">
      <img src="${resultado.base64}" 
           style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;display:block" 
           alt="Preview foto">
      <button type="button" 
              onclick="quitarFoto()" 
              style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);
                     color:white;border:none;border-radius:50%;width:28px;height:28px;
                     font-size:14px;cursor:pointer;line-height:1">✕</button>
    </div>`;
  showToast('📷 Foto lista', 'success');
}

// Agregar también esta función si no existe en tu app.js:
window.quitarFoto = function() {
  App.fotoURL = null;
  App.fotoFile = null;
  document.getElementById('foto-preview').innerHTML = '';
  document.getElementById('foto-input').value = '';
};

// ============================================================
// En handleSubmitPedido, el bloque de foto también cambia.
// BUSCA este bloque:
//
//   if (App.fotoFile) {
//     const fotoRes = await Storage.subirFoto(App.fotoFile, result.id);
//     if (fotoRes.success) {
//       await Pedidos.actualizar(result.id, { foto: fotoRes.url });
//     }
//   }
//
// Y REEMPLÁZALO con esto:
// ============================================================

// La foto ya viene en datos.foto como base64 (App.fotoURL),
// así que se guarda automáticamente al crear el pedido.
// No necesitas hacer nada extra — el bloque anterior se elimina.
// datos.foto = App.fotoURL  ← ya está en el código original ✅
