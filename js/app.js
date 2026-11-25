import { salvarEstado, carregarEstado, salvarFoto, carregarFoto, apagarFoto, limparTudo, salvarSessao, carregarSessao } from './db.js';
import { gerarRelatorioPdf } from './relatorio.js';
import { acessoAtivo, entrar, iniciarVistoria, mensagemDoMotivo, normalizarEmail, normalizarCodigo } from './acesso.js';

const app = document.getElementById('app');
const topoInfo = document.getElementById('topo-info');
const avisoEl = document.getElementById('aviso');

let config = null;
let estado = null;
let pdfAtual = null; // { blob, nome }
let sessao = null; // acesso confirmado: { email, codigo, validade_ate }
const urlsFotos = new Map(); // id da foto -> URL temporária para mostrar a miniatura

// ---------------------------------------------------------------- utilidades
function h(tag, atributos = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    el.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return el;
}

let timerAviso = null;
function avisar(texto) {
  avisoEl.textContent = texto;
  avisoEl.classList.add('on');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => avisoEl.classList.remove('on'), 3500);
}

const rotulo = (lista, id) => lista.find((x) => x.id === id)?.rotulo ?? id;
const gravar = () => salvarEstado(estado).catch(() => avisar('Não consegui salvar no aparelho. Termine esta vistoria sem fechar o navegador.'));

function novoCodigo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'VZ-' + [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('');
}

function estadoNovo() {
  return { v: 2, tela: 'dados', nome: '', imovel: '', unidade: '', tipoId: null, codigo: novoCodigo(), criadaEm: Date.now(), itens: [], atual: null, creditoOk: false };
}

// Vistorias iniciadas em versões anteriores usavam outros nomes de complemento; converte para os atuais.
function migrar(e) {
  if (!e) return e;
  const novoId = { secundario: 'c02', hospedes: 'c03' };
  const ajusta = (o) => {
    if (!o) return;
    if (o.ambienteId === 'quarto' && o.complementoId === 'suite') {
      o.ambienteId = 'suite';
      o.complementoId = 'principal';
    } else if (novoId[o.complementoId]) {
      o.complementoId = novoId[o.complementoId];
    }
  };
  (e.itens ?? []).forEach(ajusta);
  ajusta(e.atual);
  if (typeof e.unidade !== 'string') e.unidade = '';
  e.v = 2;
  return e;
}

// Nome do arquivo: "Nome do empreendimento - DD-MM-AAAA.pdf" (sem acentos e sem os caracteres que o sistema de arquivos não aceita).
function nomeDoArquivo(imovel, quando) {
  const limpo = String(imovel ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sem acentos: evita nome quebrado em alguns aparelhos
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[.\s]+$/, '');
  const dd = String(quando.getDate()).padStart(2, '0');
  const mm = String(quando.getMonth() + 1).padStart(2, '0');
  return `${limpo || 'Vistoria'} - ${dd}-${mm}-${quando.getFullYear()}.pdf`;
}

function irPara(tela) {
  estado.tela = tela;
  gravar();
  render();
}

function chaveItem(a) {
  return `${a.ambienteId}|${a.complementoId}|${a.itemId}`;
}

// ---------------------------------------------------------------- fotos
async function comprimir(arquivo) {
  const MAX = 1280;
  let fonte;
  try {
    fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    fonte = await new Promise((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = erro;
      img.src = URL.createObjectURL(arquivo);
    });
  }
  const larg = fonte.width || fonte.naturalWidth;
  const alt = fonte.height || fonte.naturalHeight;
  const escala = Math.min(1, MAX / Math.max(larg, alt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(larg * escala);
  canvas.height = Math.round(alt * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error('falha ao comprimir'))), 'image/jpeg', 0.8));
}

async function urlDaFoto(id) {
  if (urlsFotos.has(id)) return urlsFotos.get(id);
  const reg = await carregarFoto(id);
  if (!reg) return null;
  const url = URL.createObjectURL(reg.blob);
  urlsFotos.set(id, url);
  return url;
}

async function removerFotoDoDisco(id) {
  await apagarFoto(id).catch(() => {});
  const url = urlsFotos.get(id);
  if (url) URL.revokeObjectURL(url);
  urlsFotos.delete(id);
}

// ---------------------------------------------------------------- cabeçalho
function atualizarTopo() {
  topoInfo.replaceChildren();
  if (!estado || !estado.imovel) return;
  topoInfo.append(h('strong', {}, estado.unidade ? `${estado.imovel} - ${estado.unidade}` : estado.imovel));
  const a = estado.atual;
  if (a?.ambienteId) {
    topoInfo.append(`${rotulo(config.ambientes, a.ambienteId)}${a.complementoId ? ' - ' + rotulo(config.complementos, a.complementoId) : ''}`);
  }
}

// ---------------------------------------------------------------- telas
const TELAS = {};

TELAS.inicio = () => {
  const temAndamento = estado.itens.length > 0 || !!estado.nome;
  return [
    h('h1', {}, 'Faça a vistoria do seu imóvel'),
    h('p', { class: 'sub' }, 'Passo a passo, cômodo por cômodo. No final, você recebe um relatório fotográfico em PDF.'),
    h('div', { class: 'cartao' },
      h('p', {}, h('strong', {}, 'Antes de começar')),
      h('p', {}, 'Deixe a bateria carregada e leve um carregador de celular para testar as tomadas.'),
      h('p', { class: 'pequeno' }, 'Tudo fica salvo neste aparelho. Se parar no meio, é só abrir de novo e continuar. Para escrever por voz, use o microfone do teclado do celular.'),
    ),
    temAndamento && h('button', { class: 'botao', onclick: () => render(estado.tela) }, 'Continuar vistoria em andamento'),
    h('button', {
      class: temAndamento ? 'botao sec' : 'botao',
      onclick: async () => {
        if (temAndamento) {
          const aviso = acessoAtivo() && estado.creditoOk
            ? 'Atenção: o seu acesso vale para 1 imóvel. Se apagar esta vistoria, não será possível iniciar outra com o mesmo acesso. Gere e salve o PDF antes. Apagar mesmo assim?'
            : 'Isso apaga a vistoria em andamento neste aparelho. Deseja começar uma nova?';
          if (!confirm(aviso)) return;
        }
        await limparTudo();
        urlsFotos.forEach((u) => URL.revokeObjectURL(u));
        urlsFotos.clear();
        pdfAtual = null;
        estado = estadoNovo();
        await gravar();
        render();
      },
    }, temAndamento ? 'Começar uma nova vistoria' : 'Começar vistoria'),
  ];
};

TELAS.acesso = () => {
  const email = h('input', { type: 'text', id: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', placeholder: 'O mesmo e-mail usado na compra' });
  const codigo = h('input', { type: 'text', id: 'codigo', autocapitalize: 'characters', autocomplete: 'off', placeholder: 'Ex.: HP12345678901234' });
  const erro = h('div', { class: 'alerta', hidden: true, role: 'alert' });
  const botao = h('button', { class: 'botao', style: 'margin-top:14px' }, 'Entrar');
  botao.addEventListener('click', async () => {
    erro.hidden = true;
    if (!email.value.includes('@')) { avisar('Digite o e-mail da compra.'); email.focus(); return; }
    if (normalizarCodigo(codigo.value).length < 6) { avisar('Digite o código da compra.'); codigo.focus(); return; }
    botao.disabled = true;
    botao.textContent = 'Confirmando...';
    const resultado = await entrar(email.value, codigo.value);
    botao.disabled = false;
    botao.textContent = 'Entrar';
    if (!resultado.ok) {
      erro.textContent = mensagemDoMotivo(resultado.motivo);
      erro.hidden = false;
      return;
    }
    sessao = { email: normalizarEmail(email.value), codigo: normalizarCodigo(codigo.value), validade_ate: resultado.validade_ate };
    await salvarSessao(sessao).catch(() => {});
    render('inicio');
  });
  return [
    h('h1', {}, 'Acesse sua vistoria'),
    h('p', { class: 'sub' }, 'Digite o e-mail e o código da compra que você recebeu da Hotmart.'),
    h('label', { for: 'email' }, 'E-mail da compra'),
    email,
    h('label', { for: 'codigo' }, 'Código da compra'),
    codigo,
    h('p', { class: 'pequeno', style: 'margin-top:8px' }, 'O código está no e-mail de confirmação da compra, com o nome "código da transação". Ele começa com HP.'),
    erro,
    botao,
    h('p', { class: 'pequeno' }, 'Cada compra vale para 1 imóvel. É preciso internet só para entrar e para iniciar a vistoria.'),
  ];
};

TELAS.dados = () => {
  const erro = h('div', { class: 'alerta', hidden: true, role: 'alert' });
  const botao = h('button', { class: 'botao', style: 'margin-top:14px' }, 'Continuar');
  botao.addEventListener('click', async () => {
    const n = nome.value.trim();
    const i = imovel.value.trim();
    erro.hidden = true;
    if (n.length < 3) { avisar('Digite seu nome completo.'); nome.focus(); return; }
    if (i.length < 3) { avisar('Informe o nome do empreendimento ou o endereço.'); imovel.focus(); return; }
    estado.nome = n;
    estado.imovel = i;
    estado.unidade = unidade.value.trim();
    // Com controle de acesso ligado, o crédito é descontado aqui, uma única vez por vistoria.
    if (acessoAtivo() && !estado.creditoOk) {
      botao.disabled = true;
      botao.textContent = 'Confirmando seu acesso...';
      const resultado = await iniciarVistoria(sessao.email, sessao.codigo, estado.codigo, ''); // o imóvel não é enviado ao servidor (privacidade)
      botao.disabled = false;
      botao.textContent = 'Continuar';
      if (!resultado.ok) {
        erro.textContent = mensagemDoMotivo(resultado.motivo);
        erro.hidden = false;
        return;
      }
      estado.creditoOk = true;
    }
    irPara('tipo');
  });
  const nome = h('input', { type: 'text', id: 'nome', autocomplete: 'name', value: estado.nome, placeholder: 'Seu nome completo' });
  const imovel = h('input', {
    type: 'text', id: 'imovel', value: estado.imovel,
    placeholder: 'Ex.: Residencial Parque das Flores',
  });
  const unidade = h('input', {
    type: 'text', id: 'unidade', value: estado.unidade ?? '',
    placeholder: 'Ex.: Apto 304 - Torre B',
  });
  return [
    h('h1', {}, 'Dados da vistoria'),
    h('p', { class: 'sub' }, 'Essas informações aparecem no relatório.'),
    h('label', { for: 'nome' }, 'Nome completo do proprietário'),
    nome,
    h('label', { for: 'imovel' }, 'Nome do empreendimento ou endereço'),
    imovel,
    h('p', { class: 'pequeno', style: 'margin-top:8px' }, 'Esse nome também será o nome do arquivo PDF.'),
    h('label', { for: 'unidade' }, 'Unidade (apartamento, torre, casa)'),
    unidade,
    erro,
    botao,
  ];
};

TELAS.tipo = () => [
  h('button', { class: 'voltar', onclick: () => irPara('dados') }, '< Voltar'),
  h('h1', {}, 'Qual é o tipo de vistoria?'),
  h('ul', { class: 'lista' },
    config.tipos_vistoria.map((t) =>
      h('li', {}, h('button', { class: 'opcao', onclick: () => { estado.tipoId = t.id; irPara('ambiente'); } }, h('span', { class: 'rot' }, t.rotulo))),
    ),
  ),
];

TELAS.ambiente = () => {
  const contar = (id) => estado.itens.filter((i) => i.ambienteId === id).length;
  return [
    h('h1', {}, 'Qual ambiente você vai vistoriar?'),
    h('p', { class: 'sub' }, `${estado.itens.length} ${estado.itens.length === 1 ? 'item avaliado' : 'itens avaliados'} até agora.`),
    h('ul', { class: 'lista' },
      config.ambientes.map((a) =>
        h('li', {}, h('button', {
          class: 'opcao',
          onclick: () => { estado.atual = { ambienteId: a.id }; irPara('complemento'); },
        }, h('span', { class: 'rot' }, a.rotulo), contar(a.id) > 0 && h('span', { class: 'marca m-aprovado' }, `${contar(a.id)}`))),
      ),
    ),
    estado.itens.length > 0 && h('button', { class: 'botao sec', onclick: () => irPara('final') }, 'Finalizar e gerar relatório'),
  ];
};

TELAS.complemento = () => [
  h('button', { class: 'voltar', onclick: () => irPara('ambiente') }, '< Voltar'),
  h('h1', {}, rotulo(config.ambientes, estado.atual.ambienteId)),
  h('p', { class: 'sub' }, 'Qual deles? Use Principal para o primeiro e 02, 03... para os demais cômodos iguais, como o segundo quarto.'),
  h('ul', { class: 'lista' },
    config.complementos.map((c) =>
      h('li', {}, h('button', {
        class: 'opcao',
        onclick: () => { estado.atual.complementoId = c.id; irPara('item'); },
      }, h('span', { class: 'rot' }, c.rotulo))),
    ),
  ),
];

TELAS.item = () => {
  const a = estado.atual;
  const feitos = Object.fromEntries(
    estado.itens.filter((i) => i.ambienteId === a.ambienteId && i.complementoId === a.complementoId).map((i) => [i.itemId, i]),
  );
  const total = config.itens.length;
  const concluidos = Object.keys(feitos).length;
  return [
    h('button', { class: 'voltar', onclick: () => irPara('complemento') }, '< Voltar'),
    h('h1', {}, 'O que você vai avaliar?'),
    h('div', { class: 'progresso', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': concluidos },
      h('div', { style: `width:${(concluidos / total) * 100}%` })),
    h('ul', { class: 'lista' },
      config.itens.map((it) =>
        h('li', {}, h('button', {
          class: 'opcao',
          onclick: () => {
            a.itemId = it.id;
            a.status = null;
            a.fotoIds = [];
            a.comentario = '';
            irPara('avaliar');
          },
        },
        h('span', { class: 'rot' }, it.rotulo),
        feitos[it.id] && h('span', { class: `marca m-${feitos[it.id].status}` }, rotulo(config.status_item.map((s) => ({ id: s.id, rotulo: s.rotulo_pdf })), feitos[it.id].status)))),
      ),
    ),
    h('button', { class: 'botao sec', onclick: () => irPara('proximo') }, 'Terminei este ambiente'),
  ];
};

TELAS.avaliar = () => {
  const a = estado.atual;
  const item = config.itens.find((i) => i.id === a.itemId);
  return [
    h('button', { class: 'voltar', onclick: () => irPara('item') }, '< Voltar'),
    h('h2', {}, item.rotulo),
    h('div', { class: 'dica' }, item.dica),
    h('p', {}, h('strong', {}, 'Como está este item?')),
    h('ul', { class: 'lista' },
      config.status_item.map((s) =>
        h('li', {}, h('button', {
          class: 'opcao',
          onclick: async () => {
            a.status = s.id;
            if (s.id === 'nao_se_aplica') {
              await confirmarItem();
              irPara('proximo');
            } else {
              irPara('fotos');
            }
          },
        }, h('span', { class: 'rot' }, s.rotulo))),
      ),
    ),
  ];
};

TELAS.fotos = () => {
  const a = estado.atual;
  const obrigatoria = a.status === 'ressalva' || a.status === 'nao_conforme';
  const item = config.itens.find((i) => i.id === a.itemId);
  const grade = h('div', { class: 'fotos' });
  const botaoContinuar = h('button', { class: 'botao' });

  const atualizarBotao = () => {
    const n = a.fotoIds.length;
    if (obrigatoria) {
      botaoContinuar.disabled = n < 1;
      botaoContinuar.textContent = n < 1 ? 'Envie pelo menos 1 foto para continuar' : 'Concluir fotos';
    } else {
      botaoContinuar.disabled = false;
      botaoContinuar.textContent = n < 1 ? 'Continuar sem foto' : 'Concluir fotos';
    }
  };

  const desenhar = async () => {
    grade.replaceChildren();
    for (const id of a.fotoIds) {
      const url = await urlDaFoto(id);
      if (!url) continue;
      grade.append(h('div', { class: 'foto' },
        h('img', { src: url, alt: 'Foto do item' }),
        h('button', {
          'aria-label': 'Remover foto',
          onclick: async () => {
            a.fotoIds = a.fotoIds.filter((x) => x !== id);
            await removerFotoDoDisco(id);
            gravar();
            desenhar();
          },
        }, '×')));
    }
    atualizarBotao();
  };

  const receber = async (evento) => {
    const arquivos = [...evento.target.files];
    evento.target.value = '';
    if (!arquivos.length) return;
    avisar(arquivos.length > 1 ? 'Preparando as fotos...' : 'Preparando a foto...');
    for (const arquivo of arquivos) {
      try {
        const blob = await comprimir(arquivo);
        const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await salvarFoto({ id, blob });
        a.fotoIds.push(id);
        gravar();
      } catch {
        avisar('Não consegui usar uma das fotos. Tente tirar de novo.');
      }
    }
    avisoEl.classList.remove('on');
    desenhar();
  };

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: receber });
  const galeria = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: receber });

  botaoContinuar.addEventListener('click', () => irPara('comentario'));
  desenhar();

  return [
    h('button', { class: 'voltar', onclick: () => irPara('avaliar') }, '< Voltar'),
    h('h2', {}, item.rotulo),
    h('span', { class: `marca m-${a.status}` }, rotulo(config.status_item.map((s) => ({ id: s.id, rotulo: s.rotulo_pdf })), a.status)),
    h('p', { style: 'margin-top:12px' }, obrigatoria ? config.mensagens.pedir_foto_obrigatoria_app : config.mensagens.pedir_foto_opcional_app),
    obrigatoria && h('div', { class: 'alerta' }, 'Neste caso é obrigatório enviar pelo menos 1 foto.'),
    grade,
    camera,
    galeria,
    h('button', { class: 'botao sec', onclick: () => camera.click() }, 'Tirar foto'),
    h('button', { class: 'botao sec', onclick: () => galeria.click() }, 'Escolher da galeria'),
    botaoContinuar,
  ];
};

async function confirmarItem() {
  const a = estado.atual;
  const chave = chaveItem(a);
  const existente = estado.itens.find((i) => chaveItem(i) === chave);
  const fotoIds = a.status === 'nao_se_aplica' ? [] : [...(a.fotoIds ?? [])];
  const registro = {
    ordem: existente ? existente.ordem : estado.itens.length ? Math.max(...estado.itens.map((i) => i.ordem)) + 1 : 1,
    ambienteId: a.ambienteId,
    complementoId: a.complementoId,
    itemId: a.itemId,
    status: a.status,
    comentario: a.status === 'nao_se_aplica' ? '' : (a.comentario || '').trim() || config.regras.comentario_sem_observacoes_texto,
    fotoIds,
  };
  if (existente) {
    for (const id of existente.fotoIds) if (!fotoIds.includes(id)) await removerFotoDoDisco(id);
    estado.itens[estado.itens.indexOf(existente)] = registro;
  } else {
    estado.itens.push(registro);
  }
  a.fotoIds = [];
  pdfAtual = null;
  await gravar();
}

TELAS.comentario = () => {
  const a = estado.atual;
  const item = config.itens.find((i) => i.id === a.itemId);
  const texto = h('textarea', { id: 'comentario', placeholder: 'Ex.: Rejunte falhado perto do box, cerca de 20 cm.' });
  texto.value = a.comentario || '';
  const salvar = async (valor) => {
    a.comentario = valor;
    await confirmarItem();
    irPara('proximo');
  };
  return [
    h('button', { class: 'voltar', onclick: () => irPara('fotos') }, '< Voltar'),
    h('h2', {}, item.rotulo),
    h('label', { for: 'comentario' }, 'Descreva o que você encontrou'),
    h('p', { class: 'pequeno' }, 'Pode digitar ou usar o microfone do teclado do celular para falar.'),
    texto,
    h('button', { class: 'botao', style: 'margin-top:14px', onclick: () => salvar(texto.value) }, 'Salvar e continuar'),
    h('button', { class: 'botao sec', onclick: () => salvar('') }, 'Sem observações'),
  ];
};

TELAS.proximo = () => {
  const a = estado.atual;
  return [
    h('h1', {}, 'Item salvo'),
    h('p', { class: 'sub' }, `${estado.itens.length} ${estado.itens.length === 1 ? 'item avaliado' : 'itens avaliados'} até agora. O que deseja fazer?`),
    h('ul', { class: 'lista' },
      h('li', {}, h('button', { class: 'opcao', onclick: () => irPara('item') }, h('span', { class: 'rot' }, 'Avaliar outro item neste mesmo ambiente'))),
      h('li', {}, h('button', {
        class: 'opcao',
        onclick: () => { estado.atual = { ambienteId: a.ambienteId }; irPara('ambiente'); },
      }, h('span', { class: 'rot' }, 'Ir para outro ambiente'))),
      h('li', {}, h('button', { class: 'opcao', onclick: () => irPara('final') }, h('span', { class: 'rot' }, 'Finalizar vistoria e gerar meu relatório em PDF'))),
    ),
  ];
};

TELAS.final = () => {
  const c = { aprovado: 0, ressalva: 0, nao_conforme: 0, nao_se_aplica: 0 };
  estado.itens.forEach((i) => c[i.status]++);
  const area = h('div');

  const mostrarPdf = () => {
    area.replaceChildren(
      h('div', { class: 'cartao' }, h('strong', {}, 'Relatório pronto!'), h('p', { class: 'pequeno', style: 'margin:6px 0 0' }, 'Salve ou envie o PDF para guardar com você.')),
      navigator.canShare?.({ files: [new File([pdfAtual.blob], pdfAtual.nome, { type: 'application/pdf' })] }) &&
        h('button', {
          class: 'botao',
          onclick: async () => {
            try {
              await navigator.share({ files: [new File([pdfAtual.blob], pdfAtual.nome, { type: 'application/pdf' })], title: 'Relatório de vistoria - Laudo Zero' });
            } catch (e) {
              if (e.name !== 'AbortError') avisar('Não consegui compartilhar. Use o botão Baixar PDF.');
            }
          },
        }, 'Compartilhar (WhatsApp, e-mail...)'),
      h('button', { class: 'botao sec', onclick: baixar }, 'Baixar PDF'),
    );
  };

  const baixar = () => {
    const url = URL.createObjectURL(pdfAtual.blob);
    const link = h('a', { href: url, download: pdfAtual.nome });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const gerar = async (botao) => {
    botao.disabled = true;
    botao.textContent = 'Gerando relatório...';
    try {
      const logoBytes = new Uint8Array(await (await fetch('assets/logo.jpg')).arrayBuffer());
      const itens = [];
      for (const i of estado.itens) {
        const fotos = [];
        for (const id of i.fotoIds) {
          const reg = await carregarFoto(id);
          if (reg) fotos.push({ blob: reg.blob });
        }
        itens.push({ ...i, fotos });
      }
      const agora = new Date();
      const blob = await gerarRelatorioPdf({
        vistoria: { codigo: estado.codigo, nome: estado.nome, imovel: estado.imovel, unidade: estado.unidade, tipoId: estado.tipoId, finalizadaEm: agora.getTime() },
        itens, config, logoBytes,
      });
      pdfAtual = { blob, nome: nomeDoArquivo(estado.imovel, agora) };
      mostrarPdf();
    } catch (e) {
      console.error(e);
      avisar('Não consegui gerar o PDF. Tente de novo; se repetir, remova algumas fotos.');
      botao.disabled = false;
      botao.textContent = 'Gerar relatório em PDF';
    }
  };

  const botaoGerar = h('button', { class: 'botao', onclick: () => gerar(botaoGerar) }, 'Gerar relatório em PDF');
  if (pdfAtual) mostrarPdf();
  else area.append(botaoGerar);

  return [
    h('button', { class: 'voltar', onclick: () => irPara('ambiente') }, '< Voltar e continuar vistoriando'),
    h('h1', {}, 'Resumo da vistoria'),
    h('div', { class: 'resumo' },
      h('div', {}, h('b', {}, c.aprovado + c.ressalva + c.nao_conforme), h('span', {}, 'Itens avaliados')),
      h('div', {}, h('b', { style: 'color:var(--verde)' }, c.aprovado), h('span', {}, 'Aprovados')),
      h('div', {}, h('b', { style: 'color:#b07d00' }, c.ressalva), h('span', {}, 'Com ressalva')),
      h('div', {}, h('b', { style: 'color:var(--vermelho)' }, c.nao_conforme), h('span', {}, 'Não conformes'))),
    estado.itens.length === 0 ? h('div', { class: 'alerta' }, 'Avalie pelo menos um item antes de gerar o relatório.') : area,
    h('button', { class: 'link', onclick: () => render('inicio') }, 'Voltar ao início'),
  ];
};

// ---------------------------------------------------------------- render
function render(forcar) {
  let tela = forcar || estado.tela;
  if (!TELAS[tela]) tela = 'inicio';
  // Controle de acesso: sem login, só a tela de acesso; sem crédito descontado, só início e dados.
  if (acessoAtivo()) {
    if (!sessao) tela = 'acesso';
    else if (!estado.creditoOk && !['inicio', 'acesso', 'dados'].includes(tela)) tela = estado.nome ? 'dados' : 'inicio';
  }
  // evita telas que dependem de um item em edição que não existe mais
  const precisaAtual = ['complemento', 'item', 'avaliar', 'fotos', 'comentario', 'proximo'];
  if (precisaAtual.includes(tela) && !estado.atual) tela = 'ambiente';
  if (['item', 'avaliar', 'fotos', 'comentario'].includes(tela) && !estado.atual.complementoId) tela = 'complemento';
  if (['avaliar', 'fotos', 'comentario'].includes(tela) && !estado.atual.itemId) tela = 'item';
  if (['fotos', 'comentario'].includes(tela) && !estado.atual.status) tela = 'avaliar';
  if (tela !== 'inicio' && !estado.tipoId && ['ambiente', 'complemento', 'item', 'avaliar', 'fotos', 'comentario', 'proximo', 'final'].includes(tela)) {
    tela = estado.nome ? 'tipo' : 'dados';
  }
  if (!estado.atual?.fotoIds) { if (estado.atual) estado.atual.fotoIds = []; }
  atualizarTopo();
  app.replaceChildren(...[].concat(TELAS[tela]()).filter(Boolean));
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- início
async function iniciar() {
  try {
    config = await (await fetch('checklist-config.json')).json();
    config.mensagens.pedir_foto_opcional_app = 'Se quiser, registre o item com fotos. Você também pode continuar sem foto.';
    config.mensagens.pedir_foto_obrigatoria_app = 'Registre o problema com fotos. Depois de enviar, toque em Concluir fotos.';
  } catch {
    app.replaceChildren(h('div', { class: 'alerta' }, 'Não consegui carregar o checklist. Verifique a internet e abra de novo.'));
    return;
  }
  try {
    estado = migrar((await carregarEstado()) || null);
  } catch {
    estado = null;
  }
  if (!estado) {
    estado = estadoNovo();
    estado.tela = 'inicio';
  }
  try {
    sessao = (await carregarSessao()) || null;
  } catch {
    sessao = null;
  }
  render('inicio');
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
