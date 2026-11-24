// Monta o Relatório Fotográfico de Vistoria (PDF A4) a partir dos dados da vistoria.
// Não usa nada do navegador além de Blob, então também roda no Node para testes.

import { PdfDoc, PAGE_W, PAGE_H, quebrarLinhas, larguraTexto } from './pdf.js';

const COR = {
  navy: [16, 29, 102],
  ink: [20, 26, 58],
  muted: [91, 97, 128],
  linha: [223, 226, 239],
  fundo: [241, 243, 250],
  branco: [255, 255, 255],
};

const STATUS = {
  aprovado: { cor: [31, 138, 76], texto: [255, 255, 255] },
  ressalva: { cor: [245, 177, 0], texto: [60, 40, 0] },
  nao_conforme: { cor: [198, 40, 40], texto: [255, 255, 255] },
  nao_se_aplica: { cor: [107, 114, 128], texto: [255, 255, 255] },
};

const M = 40; // margem lateral
const CW = PAGE_W - 2 * M; // largura útil
const TOPO = 90;
const FUNDO = PAGE_H - 52;
const FOTO_MAX_ALTURA = 170;
const FOTO_GAP = 10;

export function itemValido(item) {
  if (!item || !item.status) return false;
  if (item.status === 'aprovado' || item.status === 'nao_se_aplica') return true;
  return (item.fotos?.length ?? 0) >= 1;
}

function formatarDataHora(valor) {
  const d = new Date(valor);
  return {
    data: d.toLocaleDateString('pt-BR'),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

async function bytesDe(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param vistoria { codigo, nome, imovel, tipoId, finalizadaEm }
 * @param itens    [{ ordem, ambienteId, complementoId, itemId, status, comentario, fotos:[{blob}] }]
 * @param config   conteúdo de checklist-config.json
 * @param logoBytes Uint8Array do logo em JPEG
 * @returns Blob (application/pdf)
 */
export async function gerarRelatorioPdf({ vistoria, itens, config, logoBytes }) {
  const rotulos = {
    ambiente: Object.fromEntries(config.ambientes.map((a) => [a.id, a.rotulo])),
    complemento: Object.fromEntries(config.complementos.map((c) => [c.id, c.rotulo])),
    item: Object.fromEntries(config.itens.map((i) => [i.id, i.rotulo])),
    status: Object.fromEntries(config.status_item.map((s) => [s.id, s.rotulo_pdf])),
    tipo: Object.fromEntries(config.tipos_vistoria.map((t) => [t.id, t.rotulo])),
  };

  const validos = itens.filter(itemValido).sort((a, b) => a.ordem - b.ordem);

  // Agrupa por ambiente + complemento, na ordem em que apareceram.
  const grupos = [];
  const porChave = new Map();
  for (const item of validos) {
    const chave = `${item.ambienteId}|${item.complementoId}`;
    if (!porChave.has(chave)) {
      const grupo = {
        titulo: `${rotulos.ambiente[item.ambienteId] ?? item.ambienteId} - ${rotulos.complemento[item.complementoId] ?? item.complementoId}`,
        itens: [],
      };
      porChave.set(chave, grupo);
      grupos.push(grupo);
    }
    porChave.get(chave).itens.push(item);
  }

  const contagem = { aprovado: 0, ressalva: 0, nao_conforme: 0, nao_se_aplica: 0 };
  for (const item of validos) contagem[item.status]++;
  const avaliados = contagem.aprovado + contagem.ressalva + contagem.nao_conforme;

  const doc = new PdfDoc({ titulo: `Relatorio de vistoria ${vistoria.codigo}` });
  const logo = doc.addJpeg(logoBytes);
  const concluidaEm = formatarDataHora(vistoria.finalizadaEm ?? Date.now());

  let p = null;
  let y = 0;

  const cabecalho = (pagina) => {
    const altura = 34;
    doc.imagem(pagina, logo, M, 26, (altura * logo.largura) / logo.altura, altura);
    doc.textoDireita(pagina, PAGE_W - M, 38, 'RELATÓRIO FOTOGRÁFICO DE VISTORIA DE IMÓVEL', { tamanho: 9, negrito: true, cor: COR.navy });
    doc.textoDireita(pagina, PAGE_W - M, 51, `Concluída em ${concluidaEm.data} às ${concluidaEm.hora}`, { tamanho: 8, cor: COR.muted });
    doc.textoDireita(pagina, PAGE_W - M, 62, `Código da vistoria: ${vistoria.codigo}`, { tamanho: 8, cor: COR.muted });
    doc.linha(pagina, M, 74, PAGE_W - M, 74, { cor: COR.navy, espessura: 1.2 });
  };

  const novaPagina = () => {
    p = doc.addPagina();
    cabecalho(p);
    y = TOPO;
  };
  const garantir = (altura) => {
    if (y + altura > FUNDO) novaPagina();
  };
  const titulo = (texto) => {
    garantir(40);
    doc.texto(p, M, y + 11, texto, { tamanho: 12, negrito: true, cor: COR.navy });
    y += 22;
  };

  novaPagina();

  // ---------- Identificação ----------
  titulo('Identificação');
  const linhasId = [
    ['Cliente / proprietário', vistoria.nome || '-'],
    ['Imóvel', vistoria.imovel || '-'],
    ['Tipo de vistoria', rotulos.tipo[vistoria.tipoId] ?? '-'],
    ['Modalidade', 'Autovistoria guiada, realizada pelo próprio proprietário'],
  ].map(([rotulo, valor]) => ({ rotulo, linhas: quebrarLinhas(valor, 10.5, false, CW - 24) }));
  const alturaBox = 10 + linhasId.reduce((soma, l) => soma + 11 + l.linhas.length * 13 + 5, 0);
  garantir(alturaBox + 10);
  doc.retangulo(p, M, y, CW, alturaBox, { preenchimento: COR.fundo, borda: COR.linha });
  let yy = y + 10;
  for (const l of linhasId) {
    doc.texto(p, M + 12, yy + 7, l.rotulo, { tamanho: 8, cor: COR.muted });
    yy += 11;
    for (const linha of l.linhas) {
      doc.texto(p, M + 12, yy + 9, linha, { tamanho: 10.5, cor: COR.ink });
      yy += 13;
    }
    yy += 5;
  }
  y += alturaBox + 18;

  // ---------- Resumo executivo ----------
  titulo('Resumo executivo');
  garantir(80);
  const caixas = [
    ['Itens avaliados', avaliados, COR.navy],
    ['Aprovados', contagem.aprovado, STATUS.aprovado.cor],
    ['Com ressalva', contagem.ressalva, [200, 140, 0]],
    ['Não conformes', contagem.nao_conforme, STATUS.nao_conforme.cor],
  ];
  const gap = 8;
  const larguraCaixa = (CW - gap * 3) / 4;
  caixas.forEach(([rotulo, valor, corCaixa], i) => {
    const x = M + i * (larguraCaixa + gap);
    doc.retangulo(p, x, y, larguraCaixa, 54, { borda: COR.linha });
    doc.retangulo(p, x, y, 4, 54, { preenchimento: corCaixa });
    doc.texto(p, x + 14, y + 30, String(valor), { tamanho: 22, negrito: true, cor: corCaixa });
    doc.texto(p, x + 14, y + 46, rotulo, { tamanho: 8.5, cor: COR.muted });
  });
  y += 54 + 12;
  doc.texto(p, M, y + 8, `Não se aplica: ${contagem.nao_se_aplica}     Ambientes vistoriados: ${grupos.length}`, { tamanho: 9, cor: COR.muted });
  y += 26;

  // ---------- Pontos de atenção ----------
  titulo('Pontos de atenção');
  const atencao = [];
  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      if (item.status === 'nao_conforme' || item.status === 'ressalva') atencao.push({ grupo: grupo.titulo, item });
    }
  }
  atencao.sort((a, b) => (a.item.status === b.item.status ? 0 : a.item.status === 'nao_conforme' ? -1 : 1));
  if (atencao.length === 0) {
    doc.texto(p, M, y + 10, 'Nenhum ponto de atenção registrado nesta vistoria.', { tamanho: 10, cor: COR.ink });
    y += 22;
  } else {
    for (const { grupo, item } of atencao) {
      const texto = `${grupo} - ${rotulos.item[item.itemId] ?? item.itemId}: ${rotulos.status[item.status]}`;
      const linhas = quebrarLinhas(texto, 9.5, false, CW - 16);
      garantir(linhas.length * 12 + 6);
      doc.retangulo(p, M, y + 2.5, 6, 6, { preenchimento: STATUS[item.status].cor });
      linhas.forEach((linha, i) => doc.texto(p, M + 14, y + 9 + i * 12, linha, { tamanho: 9.5, cor: COR.ink }));
      y += linhas.length * 12 + 5;
    }
    y += 8;
  }

  // ---------- Detalhamento por ambiente ----------
  y += 6;
  titulo('Detalhamento por ambiente');
  const larguraFoto = (CW - FOTO_GAP) / 2;

  for (const grupo of grupos) {
    // o título do ambiente nunca fica sozinho no fim da página: precisa caber junto com o primeiro item
    garantir(grupo.itens[0].fotos?.length ? 280 : 100);
    doc.retangulo(p, M, y, CW, 22, { preenchimento: COR.navy });
    doc.texto(p, M + 10, y + 15, grupo.titulo, { tamanho: 11, negrito: true, cor: COR.branco });
    y += 22 + 12;

    for (const item of grupo.itens) {
      const nome = rotulos.item[item.itemId] ?? item.itemId;
      const estilo = STATUS[item.status];
      const rotuloStatus = rotulos.status[item.status];
      const naoAplica = item.status === 'nao_se_aplica';

      const textoComentario = naoAplica ? '' : (item.comentario || '').trim() || 'Sem observações adicionais.';
      const linhasComentario = naoAplica ? [] : quebrarLinhas(textoComentario, 9.5, false, CW - 16);

      const fotos = [];
      if (!naoAplica) {
        for (const foto of item.fotos ?? []) fotos.push(doc.addJpeg(await bytesDe(foto.blob)));
      }

      const alturaCabecalho = 20 + linhasComentario.length * 12.5 + 6;
      const alturaPrimeiraLinhaFotos = fotos.length
        ? Math.min(FOTO_MAX_ALTURA, (larguraFoto * fotos[0].altura) / fotos[0].largura) + 26
        : 0;
      garantir(alturaCabecalho + alturaPrimeiraLinhaFotos);

      // nome do item + selo de status
      doc.retangulo(p, M, y, 3, 14, { preenchimento: estilo.cor });
      doc.texto(p, M + 10, y + 11, nome, { tamanho: 10.5, negrito: true, cor: COR.ink });
      const larguraSelo = larguraTexto(rotuloStatus, 8, true) + 14;
      doc.retangulo(p, PAGE_W - M - larguraSelo, y - 1, larguraSelo, 16, { preenchimento: estilo.cor });
      doc.textoCentro(p, PAGE_W - M - larguraSelo / 2, y + 10.5, rotuloStatus, { tamanho: 8, negrito: true, cor: estilo.texto });
      y += 20;

      linhasComentario.forEach((linha, i) => doc.texto(p, M + 10, y + 8 + i * 12.5, linha, { tamanho: 9.5, cor: COR.ink }));
      y += linhasComentario.length * 12.5 + 6;

      // grade de fotos, 2 colunas
      for (let i = 0; i < fotos.length; i += 2) {
        const par = fotos.slice(i, i + 2).map((foto) => {
          const escala = Math.min(larguraFoto / foto.largura, FOTO_MAX_ALTURA / foto.altura);
          return { foto, w: foto.largura * escala, h: foto.altura * escala };
        });
        const alturaLinha = Math.max(...par.map((f) => f.h)) + 26;
        garantir(alturaLinha);
        par.forEach((f, coluna) => {
          const x = M + coluna * (larguraFoto + FOTO_GAP);
          doc.imagem(p, f.foto, x, y, f.w, f.h);
          doc.retangulo(p, x, y, f.w, f.h, { borda: COR.linha, espessura: 0.6 });
          doc.texto(p, x, y + f.h + 11, `${nome} - foto ${i + coluna + 1}`, { tamanho: 8, cor: COR.muted });
        });
        y += alturaLinha;
      }

      y += 6;
      doc.linha(p, M, y, PAGE_W - M, y, { cor: COR.linha, espessura: 0.5 });
      y += 10;
    }
    y += 6;
  }

  // ---------- Encerramento ----------
  garantir(120);
  y += 10;
  doc.linha(p, M, y, PAGE_W - M, y, { cor: COR.navy, espessura: 1 });
  y += 28;
  doc.textoCentro(p, PAGE_W / 2, y, 'LAUDO ZERO', { tamanho: 16, negrito: true, cor: COR.navy });
  y += 14;
  doc.textoCentro(p, PAGE_W / 2, y, 'Sua Vistoria de Confiança', { tamanho: 9, cor: COR.muted });
  y += 20;
  const aviso =
    'Este relatório é um registro fotográfico produzido pelo próprio proprietário a partir de um roteiro de autovistoria. ' +
    'Ele organiza as observações feitas por quem vistoriou e não substitui laudo técnico de engenharia nem perícia.';
  for (const linha of quebrarLinhas(aviso, 8, false, CW - 60)) {
    doc.textoCentro(p, PAGE_W / 2, y, linha, { tamanho: 8, cor: COR.muted });
    y += 10.5;
  }

  // ---------- Rodapé com numeração (depois de saber o total de páginas) ----------
  const totalPaginas = doc.paginas.length;
  doc.paginas.forEach((pagina, i) => {
    doc.linha(pagina, M, PAGE_H - 36, PAGE_W - M, PAGE_H - 36, { cor: COR.linha, espessura: 0.6 });
    doc.texto(pagina, M, PAGE_H - 24, 'LAUDO ZERO', { tamanho: 8, negrito: true, cor: COR.navy });
    doc.textoDireita(pagina, PAGE_W - M, PAGE_H - 24, `Página ${i + 1} de ${totalPaginas}`, { tamanho: 8, cor: COR.muted });
  });

  return doc.gerar();
}
