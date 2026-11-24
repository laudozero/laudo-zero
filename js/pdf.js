// Gerador de PDF mínimo e sem dependências: texto (Helvetica), retângulos, linhas e imagens JPEG.
// Roda no navegador e no Node (para testes). Coordenadas em pontos, com a origem no canto superior esquerdo.

export const PAGE_W = 595.28; // A4
export const PAGE_H = 841.89;

// Larguras dos caracteres 32..126 (milésimos de em) das fontes padrão Helvetica e Helvetica-Bold.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const HELV_B = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

// Caracteres fora do Latin-1 que existem na codificação WinAnsi do PDF.
const ESPECIAIS = {
  0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20ac: 0x80,
};

/** Mantém só o que a fonte do PDF sabe desenhar (letras, acentos, pontuação). Emojis são descartados. */
export function limparTexto(texto) {
  let saida = '';
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c === 10) saida += '\n';
    else if (c === 9 || c === 160) saida += ' ';
    else if ((c >= 32 && c <= 126) || (c >= 161 && c <= 255)) saida += ch;
    else if (c >= 0x80 && c <= 0x9f) saida += ch; // já convertido para WinAnsi (a função é chamada mais de uma vez)
    else if (ESPECIAIS[c] !== undefined) saida += String.fromCharCode(ESPECIAIS[c]);
  }
  return saida;
}

function larguraChar(ch, negrito) {
  const tabela = negrito ? HELV_B : HELV;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tabela[c - 32];
  if (c === 0x96 || c === 0x97) return 556;
  if (c === 0x95) return 350;
  if (c === 0x85) return 1000;
  const base = ch.normalize('NFD').charCodeAt(0);
  if (base >= 32 && base <= 126) return tabela[base - 32];
  return 556;
}

export function larguraTexto(texto, tamanho, negrito = false) {
  let soma = 0;
  for (const ch of limparTexto(texto).replace(/\n/g, ' ')) soma += larguraChar(ch, negrito);
  return (soma * tamanho) / 1000;
}

/** Quebra o texto em linhas que cabem em maxLargura. Respeita quebras de linha digitadas. */
export function quebrarLinhas(texto, tamanho, negrito, maxLargura) {
  const saida = [];
  for (const paragrafo of limparTexto(texto).split('\n')) {
    if (paragrafo.trim() === '') {
      saida.push('');
      continue;
    }
    let linha = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (larguraTexto(tentativa, tamanho, negrito) <= maxLargura) {
        linha = tentativa;
        continue;
      }
      if (linha) {
        saida.push(linha);
        linha = '';
      }
      let resto = palavra;
      while (larguraTexto(resto, tamanho, negrito) > maxLargura && resto.length > 1) {
        let i = 1;
        while (i < resto.length - 1 && larguraTexto(resto.slice(0, i + 1), tamanho, negrito) <= maxLargura) i++;
        saida.push(resto.slice(0, i));
        resto = resto.slice(i);
      }
      linha = resto;
    }
    saida.push(linha);
  }
  return saida;
}

/** Lê largura, altura e nº de componentes de um JPEG. */
export function tamanhoJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Arquivo não é um JPEG válido.');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marcador = bytes[i + 1];
    if (marcador === 0xff) {
      i++;
      continue;
    }
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return {
        altura: (bytes[i + 5] << 8) | bytes[i + 6],
        largura: (bytes[i + 7] << 8) | bytes[i + 8],
        componentes: bytes[i + 9],
      };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  throw new Error('Não foi possível ler o tamanho do JPEG.');
}

function paraBytes(texto) {
  const saida = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) saida[i] = texto.charCodeAt(i) & 0xff;
  return saida;
}

function escaparTexto(texto) {
  let saida = '';
  for (const ch of limparTexto(texto).replace(/\n/g, ' ')) {
    const c = ch.charCodeAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') saida += `\\${ch}`;
    else if (c > 126) saida += `\\${c.toString(8).padStart(3, '0')}`;
    else saida += ch;
  }
  return saida;
}

const n = (valor) => Number(valor.toFixed(2)).toString();
const cor = (c) => c.map((v) => (v / 255).toFixed(3)).join(' ');

export class PdfDoc {
  constructor({ titulo = 'Documento' } = {}) {
    this.titulo = titulo;
    this.paginas = [];
    this.imagens = [];
  }

  addJpeg(bytes) {
    const { largura, altura, componentes } = tamanhoJpeg(bytes);
    const id = this.imagens.length;
    this.imagens.push({ bytes, largura, altura, componentes });
    return { id, largura, altura };
  }

  addPagina() {
    const pagina = { ops: [], imagens: new Set() };
    this.paginas.push(pagina);
    return pagina;
  }

  texto(p, x, y, texto, { tamanho = 10, negrito = false, cor: c = [0, 0, 0] } = {}) {
    p.ops.push(`BT /${negrito ? 'F2' : 'F1'} ${n(tamanho)} Tf ${cor(c)} rg ${n(x)} ${n(PAGE_H - y)} Td (${escaparTexto(texto)}) Tj ET`);
  }

  textoDireita(p, xDireita, y, texto, opcoes = {}) {
    const w = larguraTexto(texto, opcoes.tamanho ?? 10, opcoes.negrito ?? false);
    this.texto(p, xDireita - w, y, texto, opcoes);
  }

  textoCentro(p, xCentro, y, texto, opcoes = {}) {
    const w = larguraTexto(texto, opcoes.tamanho ?? 10, opcoes.negrito ?? false);
    this.texto(p, xCentro - w / 2, y, texto, opcoes);
  }

  retangulo(p, x, y, w, h, { preenchimento = null, borda = null, espessura = 0.8 } = {}) {
    const partes = ['q'];
    if (preenchimento) partes.push(`${cor(preenchimento)} rg`);
    if (borda) partes.push(`${cor(borda)} RG ${n(espessura)} w`);
    partes.push(`${n(x)} ${n(PAGE_H - y - h)} ${n(w)} ${n(h)} re`);
    partes.push(preenchimento && borda ? 'B' : preenchimento ? 'f' : 'S');
    partes.push('Q');
    p.ops.push(partes.join(' '));
  }

  linha(p, x1, y1, x2, y2, { cor: c = [0, 0, 0], espessura = 0.8 } = {}) {
    p.ops.push(`q ${cor(c)} RG ${n(espessura)} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S Q`);
  }

  imagem(p, img, x, y, w, h) {
    p.imagens.add(img.id);
    p.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(PAGE_H - y - h)} cm /Im${img.id} Do Q`);
  }

  /** Monta o arquivo e devolve um Blob application/pdf. */
  gerar() {
    const pedacos = [];
    const posicoes = [];
    let deslocamento = 0;
    const empurrar = (dado) => {
      const bytes = typeof dado === 'string' ? paraBytes(dado) : dado;
      pedacos.push(bytes);
      deslocamento += bytes.length;
    };
    const abrir = (num) => {
      posicoes[num] = deslocamento;
      empurrar(`${num} 0 obj\n`);
    };
    const fechar = () => empurrar('\nendobj\n');

    const base = 6; // 1 catálogo, 2 páginas, 3 e 4 fontes, 5 info
    const primeiraPagina = base + this.imagens.length;
    const objContent = (i) => primeiraPagina + i * 2;
    const objPagina = (i) => primeiraPagina + i * 2 + 1;
    const total = primeiraPagina + this.paginas.length * 2;

    empurrar(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    abrir(1);
    empurrar('<< /Type /Catalog /Pages 2 0 R >>');
    fechar();

    abrir(2);
    empurrar(`<< /Type /Pages /Count ${this.paginas.length} /Kids [${this.paginas.map((_, i) => `${objPagina(i)} 0 R`).join(' ')}] >>`);
    fechar();

    abrir(3);
    empurrar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    fechar();
    abrir(4);
    empurrar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    fechar();

    const agora = new Date();
    const dois = (v) => String(v).padStart(2, '0');
    const dataPdf = `D:${agora.getFullYear()}${dois(agora.getMonth() + 1)}${dois(agora.getDate())}${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
    abrir(5);
    empurrar(`<< /Title (${escaparTexto(this.titulo)}) /Producer (Laudo Zero) /Creator (Laudo Zero) /CreationDate (${dataPdf}) >>`);
    fechar();

    this.imagens.forEach((img, i) => {
      abrir(base + i);
      const espaco = img.componentes === 1 ? '/DeviceGray' : '/DeviceRGB';
      empurrar(`<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace ${espaco} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      empurrar(img.bytes);
      empurrar('\nendstream');
      fechar();
    });

    this.paginas.forEach((pagina, i) => {
      const conteudo = pagina.ops.join('\n');
      abrir(objContent(i));
      empurrar(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
      fechar();

      const xobjetos = [...pagina.imagens].map((id) => `/Im${id} ${base + id} 0 R`).join(' ');
      abrir(objPagina(i));
      empurrar(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${objContent(i)} 0 R ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjetos} >> >> >>`,
      );
      fechar();
    });

    const inicioXref = deslocamento;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let num = 1; num < total; num++) {
      xref += `${String(posicoes[num]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
    empurrar(xref);

    return new Blob(pedacos, { type: 'application/pdf' });
  }
}
