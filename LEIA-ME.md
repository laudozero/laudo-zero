# Laudo Zero - App de autovistoria (versão 1)

Este é o app completo, pronto para publicar de graça. Ele funciona no navegador do celular,
pode ser instalado na tela inicial e guarda tudo no próprio aparelho do cliente.

## O que o app faz
1. Pede nome, identificação do imóvel e tipo de vistoria.
2. O cliente escolhe o ambiente (e qual, como "Suíte" ou "Secundário") e o item.
3. Mostra a dica "O que olhar" e os 4 status (Aprovado, Com Ressalva, Não Conforme, Não se Aplica).
4. Foto: obrigatória em Com Ressalva e Não Conforme; opcional em Aprovado; nenhuma em Não se Aplica.
5. Comentário digitado (o microfone do teclado do celular serve para falar).
6. Repete por item e ambiente e, no fim, gera o PDF com a sua marca, resumo, pontos de atenção e fotos.
7. Botão para compartilhar (WhatsApp, e-mail) ou baixar o PDF.
8. Salva sozinho: se fechar o navegador, ao reabrir aparece "Continuar vistoria em andamento".
9. Funciona sem internet depois do primeiro acesso.

## Como publicar de graça no GitHub Pages
1. Crie uma conta gratuita em github.com.
2. Clique em **New repository**. Nome: `laudo-zero`. Marque **Public**. Clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Descompacte este zip no computador e arraste para a página **todo o conteúdo da pasta**
   (o arquivo index.html, as pastas assets, css e js, e os demais arquivos). Clique em **Commit changes**.
5. Vá em **Settings > Pages**. Em **Branch**, escolha `main` e a pasta `/ (root)`. Clique em **Save**.
6. Espere 1 a 2 minutos. O endereço aparece nessa mesma tela, no formato
   `https://SEU-USUARIO.github.io/laudo-zero/`.

## Como testar no celular
1. Abra o endereço no celular.
2. Faça uma vistoria completa em um cômodo da sua casa, com fotos de verdade.
3. Gere o PDF e confira se abre e se as fotos aparecem.
4. Teste fechar o navegador no meio e reabrir (deve oferecer continuar).
5. Para instalar: no Android, menu do Chrome > **Instalar app**. No iPhone, Safari > Compartilhar > **Adicionar à Tela de Início**.

## Para mudar textos do checklist
Edite o arquivo `checklist-config.json` (ambientes, itens, dicas). Não precisa mexer em código.
Depois de mudar, suba o arquivo de novo no GitHub. Se o celular continuar mostrando a versão antiga,
abra o app com internet uma vez e feche e abra de novo.

## Atenções
- O repositório público deixa o código e as dicas visíveis. Para vender, a proteção hoje é o link ficar
  só na área de membros da Hotmart. Quem tiver o link consegue usar. O controle por código vem depois.
- As fotos e os dados ficam só no aparelho. Se o cliente limpar os dados do navegador antes de gerar o
  PDF, perde a vistoria. Oriente a gerar e salvar o PDF no mesmo dia.
- Limite de tamanho: as fotos são reduzidas automaticamente para o PDF não ficar pesado.
