// Salvamento no próprio celular (IndexedDB). Nada sai do aparelho.
const NOME = 'laudo-zero';
let conexao = null;

function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((ok, erro) => {
    const req = indexedDB.open(NOME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('estado');
      req.result.createObjectStore('fotos', { keyPath: 'id' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
  return conexao;
}

function pedido(loja, modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((ok, erro) => {
        const tx = db.transaction(loja, modo);
        const r = fn(tx.objectStore(loja));
        tx.oncomplete = () => ok(r && r.result);
        tx.onerror = () => erro(tx.error);
      }),
  );
}

export const salvarEstado = (estado) => pedido('estado', 'readwrite', (s) => s.put(estado, 'atual'));
export const carregarEstado = () => pedido('estado', 'readonly', (s) => s.get('atual'));
export const salvarFoto = (foto) => pedido('fotos', 'readwrite', (s) => s.put(foto));
export const carregarFoto = (id) => pedido('fotos', 'readonly', (s) => s.get(id));
export const apagarFoto = (id) => pedido('fotos', 'readwrite', (s) => s.delete(id));
export const limparTudo = () =>
  Promise.all([pedido('estado', 'readwrite', (s) => s.clear()), pedido('fotos', 'readwrite', (s) => s.clear())]);
