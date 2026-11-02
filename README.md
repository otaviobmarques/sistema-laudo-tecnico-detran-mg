# Projeto Técnico DETRAN MG

Sistema web para montar o **Laudo Técnico de Infraestrutura (Anexo II)** e a **Declaração de Requisitos de Equipamentos (Anexo III)** das ECVs das redes **Auto Visão** e **Royal** em Minas Gerais, conforme a **Portaria CET-MG nº 01524/2025** (que altera a Portaria nº 1.290/2023). Implementa a Especificação v2.1.

Desenvolvido por **Domma Tecnologia**.

## Como rodar

Requisitos: **Node.js 22.5 ou mais novo** e `poppler-utils` (`pdftoppm`/`pdftotext`, usados para ler a planta em PDF, a ART/RRT e os certificados de calibração).

```bash
npm install
npm start
```

Abra `http://localhost:3000`. Na primeira execução o sistema cria o banco (`storage/`) e, no modo demonstração, gera uma rede fictícia com fotos sintéticas. Isso leva de 2 a 3 minutos.

- **Administrador:** `admin@domma.com.br` / senha `admin123`.
- **Perfis:** só três. **Administrador** (e-mail e senha), **Franqueadora** (cria e exclui lojas, solicita e exclui preenchimentos, valida o laudo e faz a revisão técnica) e **Loja** (preenche). Franqueadora e Loja entram por link pessoal. O sistema não envia e-mail nem WhatsApp: ele gera o link e uma mensagem pronta para a franqueadora copiar e enviar.
- Não há cadastro de **responsável técnico**: a loja pega com o engenheiro ou arquiteto a ART/RRT e o Anexo II assinado (gov.br) e envia os dois como anexo. O sistema confere o ano da ART e a integridade da assinatura, e registra o nome do signatário.

Para apagar tudo e recriar a demonstração, rode `npm run reset`.

### Variáveis de ambiente

| Variável | Uso |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `BASE_URL` | Endereço público, usado nos links pessoais, no link de consulta e no QR code (ex.: `https://laudo.suaempresa.com.br`) |
| `DATA_DIR` | Pasta do banco e dos arquivos (padrão `./storage`) |
| `DEMO_MODE` | `0` desliga a demonstração: sem dados fictícios e sem o simulador de assinatura |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Credenciais do primeiro Administrador (com `DEMO_MODE=0` a senha padrão é aleatória e aparece no console) |

O `Dockerfile` já inclui o poppler e as fontes. Monte um volume em `/data`.

**Instalação em VPS (Hostinger):** veja [`deploy/HOSTINGER.md`](deploy/HOSTINGER.md) — Docker Compose com HTTPS automático (Caddy) e backup diário.

## O que está implementado

**Acesso (Seção 3).** O Administrador entra com e-mail e senha. Franqueadora e Loja entram por um link pessoal longo, que pode ser revogado. Quem perdeu o link pede outro à franqueadora. Há aceite dos termos (LGPD) no primeiro acesso, e o Administrador pode "entrar como" outro perfil, com o registro na auditoria.

**Painel da Franqueadora (13.1–13.4).**
- Indicadores por status, com filtros de marca e município.
- Lista "Quem está faltando", com cobrança por loja ou em lote.
- Alertas de vencimento do credenciamento (180/120/90 dias), de calibração, de links do Drive e de prazos de exigência.
- Ranking dos motivos de devolução e tempo médio de conferência.
- Cadastro de loja pelo CNPJ: BrasilAPI, ReceitaWS como reserva, situação cadastral e QSA. Também há importação por planilha com pré-visualização.
- Solicitação de preenchimento com envio do link, matriz de pendências e exportações em CSV.

**Área da loja (5–9).**
- Etapa 1 com porte travado, faixas de boxes e escolha do equipamento de elevação.
- Checklist personalizado nos blocos A/B/C, com a fórmula de quantidades da Seção 6.4, em PDF ou para enviar por WhatsApp.
- Um card por item do Anexo II, com fotos por posição, medidas por box e validação imediata no campo.
- Marcação do item na planta, com recorte e destaque automáticos.
- Marcações na foto (seta, retângulo e texto), que também saem no PDF.
- Câmera com moldura e GPS, ou upload pela galeria.
- Rejeição de foto em preto e branco e de foto repetida (hash e dHash). Alerta para foto escura, borrada, de baixa resolução, antiga ou com GPS fora do raio.
- Fila sem internet (IndexedDB) e salvamento automático.
- Cadastro permanente de equipamentos, com leitura do certificado de calibração e checagem de divergências.
- Links do Drive com teste de acesso público e upload direto como alternativa.
- Equipe com colaboradores por bloco e aviso de presença quando duas pessoas estão no mesmo item.

**Motor de validação (11).** Regras R01–R28 e C01–C13, mais regras de completude. Todos os valores numéricos ficam em parâmetros versionados (B.30).

**Validação e revisão técnica pela franqueadora (10).**
- Conferência item a item, com motivo padrão, comentário na foto, aceite formal de alertas, "aprovar todos sem alerta" e comparação antes × depois no reenvio.
- Validação do registro do RT pela franqueadora.
- Revisão do RT com texto-base montado a partir das medidas, declaração de acessibilidade, ART/RRT com checagem do ano e devolução de itens.

**Documentos e assinatura (9.3, 10.3, 10.4, 12).**
- Anexo II e Anexo III gerados com a identidade visual da marca (Apêndice A).
- Página de orientações, figuras numeradas e QR code no rodapé.
- Compressão em escada até 2,9 MB, aplicada antes da assinatura.
- Trava com as 7 condições.
- Conferência do PDF devolvido: assinatura presente e íntegra, mesmo arquivo gerado (prefixo e SHA-256), signatário esperado (nome e CPF do certificado) e versão atual.
- Firma reconhecida aceita no Anexo III. Pacote para o SCE com o tamanho de cada arquivo.

**Pós-protocolo (4.1, 4.2).** Protocolo, exigência da CET-MG (reabre só os itens afetados, invalida as assinaturas e cria nova versão), deferido ou indeferido. A renovação é criada automaticamente 180 dias antes do vencimento, reaproveitando dados e equipamentos, com fotos novas e confirmação de cada equipamento.

**Versões e consulta (12.2).** Cada envio, devolução, exigência ou liberação gera uma versão com link próprio, que pode ter senha, validade ou ser revogado. A página pública mostra a autenticidade, as assinaturas, os originais em alta resolução, os vídeos e os anexos, com CPFs mascarados e contagem de acessos.

**Administração.** Marcas com cores, grafismo, formas, logos e pré-visualização com dados fictícios. Também há usuários e escopos, parâmetros, porte dos municípios (853 de MG, importação da lista da CET e da tabela do IBGE, ajuste com justificativa e alerta de divergência), auditoria imutável (bloqueada no banco) com exportação, lixeira de 90 dias e notificações enviadas.

## O que depende de configuração ou de informação externa

- **Assinatura gov.br:** o sistema confere a estrutura PKCS#7, o resumo criptográfico, a integridade, o signatário e a versão. Não valida a cadeia ICP-Brasil, ou seja, se o certificado foi emitido pelo ITI/gov.br. Para isso, recomenda-se integrar o validador do ITI antes da produção. O botão "simular assinatura gov.br" existe só no modo demonstração.
- **Leitura de certificados:** funciona em PDFs com texto (via `pdftotext`). Certificados escaneados como imagem precisam de um OCR (por exemplo, Tesseract), e o sistema avisa quando não consegue ler.
- **Porte dos municípios:** os 853 municípios de MG estão carregados. As populações da demonstração são aproximadas e só cobrem as cidades maiores. Importe a **lista oficial da CET-MG** e a **tabela do IBGE** em *Administração → Porte dos municípios* (Seção 18, item 1).
- **Pontos em aberto da Seção 18:** a validade aceita das calibrações (parâmetro, hoje 12 meses e alerta em 30 dias), os documentos de incêndio, os textos jurídicos (termos e declaração de veracidade estão como rascunho) e a fonte dos títulos (opção por marca).
- **Escala:** o banco é SQLite (`node:sqlite`) e os arquivos ficam em disco local. Para 100+ lojas e cerca de 150 fotos por laudo, isso funciona num único servidor. Para alta disponibilidade, troque por PostgreSQL e armazenamento de objetos no Brasil.

## Estrutura

```
server/
  index.js       rotas da API, acesso, rotinas automáticas
  catalog.js     itens dos Anexos II/III, parâmetros padrão, fórmula de quantidades
  rules.js       motor de validação (R01–R28, C01–C13)
  laudo.js       fluxo de status, versões, trava de assinatura, PDFs finais
  checklist.js   checklist do franqueado
  pdf.js         geração dos Anexos e do checklist por marca
  signature.js   conferência do PDF assinado
  services.js    fotos (sharp), CNPJ, Drive, notificações, auditoria
  seed.js        carga inicial e dados de demonstração
public/          front-end (SPA sem build, responsivo, PWA)
```

## Identidade visual das marcas

A área da loja, o checklist e os PDFs seguem a **Direção Visual Auto Visão v1.0** e a **Direção Visual Royal v1.0**, com os logos e as faixas oficiais em `public/brand/`. Auto Visão: vermelho `#ED3237`, preto `#151415`, Nunito + Inter, cantos arredondados, faixa quadriculada. Royal: laranja `#ED712F`, preto `#101419`, off-white `#F7F3E2`, Raleway 900 em caixa alta + Inter, chanfros de 45°, faixa oficial.

## Calibração

Quais equipamentos exigem certificado de calibração fica em **Administração → Parâmetros das regras → Equipamentos**. O padrão segue as exigências do Detran-MG: paquímetros, profundímetros, trenas (5 m e 50 m) e medidores de espessura.
